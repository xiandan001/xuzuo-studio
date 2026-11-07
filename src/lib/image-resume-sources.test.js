import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { quickImageWorkflowSteps, quickWorkflowTail } from './quick-workflow';

const require = createRequire(import.meta.url);
const { dependencies } = require('./production-test-fixtures.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createRunHistoryStore } = require('../../electron/run-history-store.cjs');
const GIF = Buffer.from('47494638396101000100800000ff00000000ff21f90400140000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="blue"/></svg>');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
async function fixture(format = 'gif', count = 4, editing = false) {
  const temporary = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporary, 'xuzuo-image-resume-'));
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
  const bytes = format === 'gif' ? GIF : SVG;
  const fetchImpl = vi.fn(async (_url, init) => {
    if (editing) { expect(init.body).toBeInstanceOf(FormData); expect(init.body.getAll('image[]').map(file => file.type)).toEqual(['image/png']); }
    return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }], usage: { input_tokens: 30, output_tokens: 196 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-resume' } });
  });
  const modelRuntime = createModelRuntime({ artifactStore: store, credentialStore: { withSecret: async (_id, _connection, action) => action('fixture-secret-not-an-account') }, fetchImpl });
  const credentials = { list: async () => [{ id: 'fixture-key', connectionId: 'connection', enabled: true }] };
  const createEngine = () => createLiveWorkflowEngine({ directory, artifactStore: store, modelRuntime, credentials });
  let engine = createEngine();
  const kind = editing ? 'image-editing' : 'image-generation';
  const source = editing ? await store.write({ projectId: 'project', name: '原始参考.png', mimeType: 'image/png', buffer: PNG }) : undefined;
  const input = {
    project: { id: 'project', workspaceId: 'workspace', name: '真实格式恢复', kind: 'image', costCents: 0 },
    workflow: { id: 'workflow', workspaceId: 'workspace', name: '逐张制作和原格式交付', outputKind: 'image', steps: quickImageWorkflowSteps({ id: 'producer', name: '制作图片', kind, enabled: true, inputSource: 'project', prompt: '本地假请求测试', count, modelConfigId: 'model', credentialId: 'fixture-key', imageOutputFormat: format, ...(format === 'gif' ? { imageFrameCount: 2, imageFrameDurationMs: 200, imageSize: 'auto' } : {}) }, quickWorkflowTail('image', kind, editing ? 'AI 精修' : '初次生成')) },
    models: [{ id: 'model', name: '隔离模型', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }],
    connections: [{ id: 'connection', providerId: 'custom', protocol: 'image', baseUrl: 'https://fixture.example/v1', enabled: true }],
    attachmentIds: source ? [source.id] : [], input: '制作并保留本次独立实际图片', variables: {}, acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
  };
  return { get engine() { return engine; }, store, input, fetchImpl, source, directory,
    async rewriteRun(id, action) { await engine.shutdown(); const history = createRunHistoryStore({ directory, fileSystem: fs }), state = await history.load(); action(state.records.find(record => record.run.id === id)); await history.save(state.records, state.revision + 1, { changedIds: [id] }); engine = createEngine(); },
    async close() { await engine.shutdown(); await store.drain(); expect(path.dirname(directory)).toBe(temporary); expect(path.basename(directory)).toMatch(/^xuzuo-image-resume-/); expect((await fs.lstat(directory)).isSymbolicLink()).toBe(false); await fs.rm(directory, { recursive: true, force: true }); },
  };
}
async function waitFor(engine, id, status) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const snapshot = await engine.snapshot(), run = snapshot.runs.find(item => item.id === id);
    if (run?.status === status) return { snapshot, run };
    if (run?.status === 'failed') throw Error(run.error);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Fixture engine deadline');
}
const pictures = run => run.attempts.filter(attempt => attempt.status === 'complete' && run.snapshot.steps.some(step => step.id === attempt.stepId && ['image-generation', 'image-editing'].includes(step.kind))).flatMap(attempt => attempt.artifacts || []).filter(file => file.kind === 'image');

describe('图片继续执行按用途验证真实格式', () => {
  it.each([['gif', false], ['gif', true], ['svg', false]])('4份%s editing=%s在人检后原格式交付，不重新调用模型或改旧费用', async (format, editing) => {
    const f = await fixture(format, 4, editing);
    try {
      const started = await f.engine.start(f.input), before = await waitFor(f.engine, started.id, 'waiting-review'), originals = pictures(before.run);
      expect(originals).toHaveLength(4); expect(f.fetchImpl).toHaveBeenCalledTimes(4);
      if (format === 'gif') expect(before.snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(400);
      else expect(before.snapshot.ledger.every(entry => entry.costState === 'unknown')).toBe(true);
      await f.engine.control({ id: started.id, action: 'resume' }); const after = await waitFor(f.engine, started.id, 'complete');
      const delivered = after.run.attempts.at(-1).artifacts.filter(file => file.kind === 'image');
      expect(delivered.map(file => file.id)).toEqual(originals.map(file => file.id)); expect(delivered.every(file => file.mimeType === (format === 'gif' ? 'image/gif' : 'image/svg+xml'))).toBe(true);
      for (const file of delivered) expect((await f.store.read(file.id)).buffer).toEqual(format === 'gif' ? GIF : SVG);
      expect(after.snapshot.ledger).toEqual(before.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(4);
    } finally { await f.close(); }
  });
  it.each(['missing', 'trashed', 'changed'])('%s具名持久化错误，旧尝试/费用不动，恢复后可继续原图交付', async reason => {
    const f = await fixture('gif', 1);
    try {
      const started = await f.engine.start(f.input), before = await waitFor(f.engine, started.id, 'waiting-review'), source = pictures(before.run)[0];
      expect(path.dirname(source.path)).toBe(path.join(f.directory, 'artifacts', 'files'));
      if (reason === 'missing') await fs.unlink(source.path);
      else if (reason === 'trashed') await f.store.trash(source.id);
      else await fs.writeFile(source.path, Buffer.from('changed-owned-test-image'));
      await expect(f.engine.control({ id: started.id, action: 'resume' })).rejects.toThrow(source.name);
      const blocked = await f.engine.snapshot(), run = blocked.runs.find(item => item.id === started.id);
      expect(run.referenceIssue).toMatchObject({ artifactId: source.id, reason }); expect(run.error).toContain('本次未继续调用模型'); expect(run.status).toBe('waiting-review');
      expect(run.attempts).toEqual(before.run.attempts); expect(blocked.ledger).toEqual(before.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
      if (reason === 'trashed') await f.store.restore(source.id); else await fs.writeFile(source.path, GIF);
      await f.engine.control({ id: started.id, action: 'resume' }); const complete = await waitFor(f.engine, started.id, 'complete');
      expect(complete.run.referenceIssue).toBeUndefined(); expect(complete.snapshot.ledger).toEqual(before.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });
  it.each(['foreign-project', 'unsupported-format', 'incomplete'])('%s来源在真实store/history恢复时阻断，给文件或步骤名称且不发新请求', async reason => {
    const f = await fixture('gif', 1);
    try {
      const started = await f.engine.start(f.input); await waitFor(f.engine, started.id, 'waiting-review');
      const invalid = reason === 'foreign-project' ? await f.store.write({ projectId: 'other-project', name: '外项目.png', mimeType: 'image/png', buffer: PNG }) : reason === 'unsupported-format' ? await f.store.write({ projectId: 'project', name: '损坏内容.png', mimeType: 'image/png', buffer: Buffer.from('not image content') }) : undefined;
      await f.rewriteRun(started.id, record => { record.run.attempts.find(attempt => attempt.stepId === 'producer').artifacts = invalid ? [invalid] : []; });
      const before = await f.engine.snapshot();
      await expect(f.engine.control({ id: started.id, action: 'resume' })).rejects.toThrow(invalid?.name || '制作图片');
      const after = await f.engine.snapshot(); expect(after.runs.find(run => run.id === started.id).referenceIssue.reason).toBe(reason);
      expect(after.ledger).toEqual(before.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });
  it('GIF可作为交付成果但不能直接成为后续图片编辑的静态原图，挡在第二次付费请求前', async () => {
    const f = await fixture('gif', 1);
    try {
      const review = f.input.workflow.steps[1];
      f.input.workflow.steps = [f.input.workflow.steps[0], review, { id: 'edit', name: '直接精修动图', kind: 'image-editing', modelConfigId: 'model', credentialId: 'fixture-key', enabled: true, inputSource: 'project', imageSourceStepId: 'producer', prompt: '不应直接发GIF', imageOutputFormat: 'png' }];
      const started = await f.engine.start(f.input), before = await waitFor(f.engine, started.id, 'waiting-review'), source = pictures(before.run)[0];
      await expect(f.engine.control({ id: started.id, action: 'resume' })).rejects.toThrow('继续修改动画');
      const after = await f.engine.snapshot(); expect(after.runs.find(run => run.id === started.id).error).toContain(source.name);
      expect(after.ledger).toEqual(before.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect((await f.store.read(source.id)).buffer).toEqual(GIF);
    } finally { await f.close(); }
  });
});
