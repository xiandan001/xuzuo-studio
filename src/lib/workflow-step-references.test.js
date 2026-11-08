import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { fixture, request, PNG, until } = require('./production-test-fixtures.cjs');
const { stepReferenceIssue, explicitStepReferences } = require('../../electron/workflow-references.cjs');
const { validateRecords } = require('../../electron/run-history-store.cjs');
const owned = [];
async function referencesFixture() {
  const f = await fixture(); owned.push(f);
  const project = { ...request().project, id: 'sku-project', kind: 'image', name: '商品图隔离验收' };
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  const a = await f.artifactStore.write({ projectId: project.id, name: 'A原图.png', mimeType: 'image/png', buffer: PNG }), b = await f.artifactStore.write({ projectId: project.id, name: 'B原图.png', mimeType: 'image/png', buffer: PNG });
  f.engineOptions.modelRuntime.execute = async input => { for (const file of input.attachments) await f.artifactStore.read(file.id); f.calls.push(input); return { text: '', artifacts: [await f.artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '实际图.png', mimeType: 'image/png', buffer: PNG })], usage: { images: 1 } }; };
  const producer = (id, referenceArtifactIds, kind = 'image-editing') => ({ id, name: id, kind, referenceArtifactIds, prompt: '仅处理本步骤指定的商品，不使用其他商品。', inputSource: 'project', modelConfigId: 'model', credentialId: 'metadata-only', count: 1, enabled: true });
  const input = { ...request(), project, input: '逐商品制作', workflow: { ...request().workflow, outputKind: 'image', steps: [producer('sku-a', [a.id]), { ...producer('sku-b', [b.id]), inputSource: 'previous' }, producer('background', [], 'image-generation')] }, attachmentIds: ['unused-global'], connections: [{ ...request().connections[0], protocol: 'image' }], models: [{ ...request().models[0], capabilities: ['image-generation', 'image-editing', 'vision'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }] };
  return Object.assign(f, { input, project, a, b, producer });
}
afterEach(async () => { for (const f of owned.splice(0)) { await f.engine.shutdown(); await f.artifactStore.drain(); expect(path.dirname(await fs.realpath(f.directory))).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(f.directory)).toMatch(/^xuzuo-production-/); await fs.rm(f.directory, { recursive: true, force: true }); } });
describe('每步商品参考图隔离', () => {
  it('preflight仅查当前步元数据，真实执行不混入全局、相邻SKU或上一结果', async () => {
    const f = await referencesFixture(), read = vi.spyOn(f.artifactStore, 'read');
    expect((await f.engine.preflight(f.input)).ok).toBe(true); expect(read).not.toHaveBeenCalled();
    const started = await f.engine.start(f.input); const snapshot = await until(() => f.engine.snapshot(), state => state.runs.some(run => run.id === started.id && run.status === 'complete'));
    expect(f.calls.map(call => call.attachments.map(file => file.id))).toEqual([[f.a.id], [f.b.id], []]);
    expect(snapshot.ledger).toHaveLength(3); expect(snapshot.ledger.every(entry => entry.costCents === 100 && entry.status === 'complete')).toBe(true);
  });
  it('拒跨项目附件与重复/非法引用，未发生模型调用', async () => {
    const f = await referencesFixture(); await f.workspaceStorage.ensureProject({ projectId: 'foreign', workspaceId: f.project.workspaceId, name: '其他项目' });
    const foreign = await f.artifactStore.write({ projectId: 'foreign', name: '他项目.png', mimeType: 'image/png', buffer: PNG });
    f.input.workflow.steps[0].referenceArtifactIds = [foreign.id]; expect((await f.engine.preflight(f.input)).errors.join()).toContain('不属于当前项目');
    f.input.workflow.steps[0].referenceArtifactIds = [f.a.id, f.a.id]; expect((await f.engine.preflight(f.input)).ok).toBe(false);
    expect(stepReferenceIssue({ referenceArtifactIds: 'not-an-array' })).toContain('0–16'); expect(f.calls).toHaveLength(0);
  });
  it('显式空引用不能靠上一张图通过vision预检', async () => {
    const f = await referencesFixture(); f.input.workflow.steps[1] = { ...f.input.workflow.steps[1], kind: 'vision', referenceArtifactIds: [] }; expect((await f.engine.preflight(f.input)).errors.join()).toContain('需要参考图片'); expect(f.calls).toHaveLength(0);
  });
  it('恢复前复核待执行步的真实文件，失败保留原费用，恢复原图后只调用下一项', async () => {
    const f = await referencesFixture(); f.input.workflow.steps.splice(1, 0, { id: 'sample', name: '检查样稿', kind: 'manual-review', prompt: '', inputSource: 'previous', referenceArtifactIds: [], enabled: true });
    const started = await f.engine.start(f.input); await until(() => f.engine.snapshot(), state => state.runs.some(run => run.id === started.id && run.status === 'waiting-review'));
    const before = structuredClone((await f.engine.snapshot()).ledger); await fs.unlink(f.b.path);
    await expect(f.engine.control({ id: started.id, action: 'resume' })).rejects.toThrow('参考文件无法读取'); expect((await f.engine.snapshot()).ledger).toEqual(before); expect(f.calls).toHaveLength(1);
    await fs.writeFile(f.b.path, PNG); await f.engine.control({ id: started.id, action: 'resume' }); await until(() => f.engine.snapshot(), state => state.runs.some(run => run.id === started.id && run.status === 'complete')); expect(f.calls.map(call => call.attachments.map(file => file.id))).toEqual([[f.a.id], [f.b.id], []]);
  });
  it('持久运行记录拒绝坏引用结构；尺寸元数据在调用前有界', async () => {
    const f = await referencesFixture(), history = { run: { id: 'run', projectId: f.project.id, workspaceId: f.project.workspaceId, snapshot: { steps: [{ referenceArtifactIds: [f.a.id, f.a.id] }] }, attempts: [] }, ledger: [], request: f.input };
    expect(() => validateRecords([history])).toThrow('参考文件无效');
    await expect(explicitStepReferences({ referenceArtifactIds: ['large'] }, f.project.id, { list: async () => [{ id: 'large', projectId: f.project.id, bytes: 33 * 1024 * 1024 }] })).rejects.toThrow('32MB');
  });
});
