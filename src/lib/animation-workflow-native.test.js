import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { fixture, png, gif, deferred } = require('./animation-integration-fixtures.cjs'), core = require('../../electron/animation-document.runtime.cjs');
const { createDeliverySource } = require('../../electron/delivery-source.cjs');
const active = [];
async function setup() {
  const holder = {}, local = [], controls = {};
  const f = await fixture({ engineOverrides: { localAnimationStatus: async () => controls.unavailable ? { available: false, reason: '合成测试：后台工具缺失' } : { available: true }, localAnimationStep: async input => { local.push(input); if (controls.error) throw controls.error; if (controls.hold) await new Promise((resolve, reject) => { const abort = () => reject(Object.assign(Error('本地合成测试已取消'), { name: 'AbortError' })); input.signal.addEventListener('abort', abort, { once: true }); controls.hold.then(() => { input.signal.removeEventListener('abort', abort); resolve(); }); }); const f = holder.value, main = await f.artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '合成本地成品.gif', mimeType: 'image/gif', buffer: gif(input.step.animation.width, input.step.animation.height) }), cover = await f.artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '合成本地封面.png', mimeType: 'image/png', buffer: png(input.step.animation.width, input.step.animation.height) }); return { artifacts: [main, cover], summary: '真实文件/原生引擎边界验收，编码器为明确替身，不代表实际GIF工厂质量。' }; } } });
  holder.value = f; active.push(f); f.local = local; f.workflowControls = controls;
  f.request = async () => { const document = await f.store.read(f.input), draft = core.makeAnimationWorkflow(document, { ...f.context, credentials: f.context.credentials }); return { project: f.project, workflow: { ...draft, id: 'animation-test-workflow', workspaceId: f.project.workspaceId, updatedAt: '' }, connections: f.context.connections, models: f.context.models, input: '用PNG图集制作一个GIF样片', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true }; };
  return f;
}
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
describe('受限本地动画工作流：真实原生engine/FS/账本，模型和编码器替身', () => {
  it('PNG模型后实际执行本地步骤，不把本地视作模型；只记一次模型流水，人工检查前可读取GIF', async () => {
    const f = await setup(), request = await f.request(), preflight = await f.engine.preflight(request); expect(preflight.ok).toBe(true); expect(preflight.steps[1].estimatedCents).toBe(0); expect(preflight.warnings.some(value => value.includes('未包含交付'))).toBe(false);
    const run = await f.engine.start(request), result = await f.until(() => f.engine.runDetail(run.id), value => value.status === 'waiting-review'); expect(f.calls).toHaveLength(1); expect(f.local).toHaveLength(1); expect(f.local[0].assets).toHaveLength(1); expect(f.local[0].assets[0].buffer.subarray(1, 4).toString()).toBe('PNG');
    const attempt = result.attempts.find(row => row.stepId === 'animation-compose'); expect(attempt).toMatchObject({ status: 'complete', costCents: 0, costState: 'not-incurred', action: '本地导出', modelLabel: '本地动画合成' }); expect(attempt.artifacts.find(file => file.mimeType === 'image/gif').runId).toBe(run.id); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
    const source = createDeliverySource({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, editorStore: f.editorStore, spreadsheetStore: f.spreadsheetStore }), delivery = await source({ projectId: f.project.id, kind: 'image', artifactIds: [] }); expect(delivery.errors).toEqual([]); expect(delivery.files.map(file => file.mimeType)).toEqual(['image/gif']); const originalPNG = result.attempts[0].artifacts[0]; const invalid = await source({ projectId: f.project.id, kind: 'image', artifactIds: [originalPNG.id] }); expect(invalid.errors.some(value => value.includes('不是当前版本'))).toBe(true);
  });
  it('helper不可用或本地参数含任意命令在模型前拒绝，不产生费用', async () => {
    const f = await setup(), request = await f.request(); f.workflowControls.unavailable = true; await expect(f.engine.start(request)).rejects.toThrow('后台工具缺失'); expect(f.calls).toHaveLength(0);
    f.workflowControls.unavailable = false; request.workflow.steps[1].animation.command = 'run arbitrary code'; await expect(f.engine.start(request)).rejects.toThrow('仅支持'); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('选择已存在本项目PNG可只跑本地，无Key也不访问模型凭证列表', async () => {
    const f = await setup(), request = await f.request(), reference = await f.artifactStore.write({ projectId: f.project.id, name: '已有图集.png', mimeType: 'image/png', buffer: png() }); request.workflow.steps = [{ ...request.workflow.steps[1], inputSource: 'project', imageSourceStepId: undefined, referenceArtifactIds: [reference.id] }, request.workflow.steps[2]]; request.models = []; request.connections = []; request.acknowledgePaidCalls = false; request.acknowledgeUnknownCost = false; f.engineOptions.credentials.list = async () => { throw Error('纯本地合成不应读取模型凭证'); };
    const run = await f.engine.start(request), result = await f.until(() => f.engine.runDetail(run.id), value => value.status === 'waiting-review'); expect(result.attempts[0].modelLabel).toBe('本地动画合成'); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]); expect(f.local[0].assets[0].id).toBe(reference.id);
  });
  it('包含远程PNG模型步骤时仍须确认调用，未确认不派发也不记费用', async () => {
    const f = await setup(), request = await f.request(); request.acknowledgePaidCalls = false; request.acknowledgeUnknownCost = false;
    await expect(f.engine.start(request)).rejects.toThrow('请确认真实调用'); expect(f.calls).toHaveLength(0); expect(f.local).toHaveLength(0); const snapshot = await f.engine.snapshot(); expect(snapshot.runs).toEqual([]); expect(snapshot.ledger).toEqual([]);
  });
  it('来源必须是准确前置PNG，错误/后置/其他项目引用在收费前拒绝', async () => {
    const f = await setup(); for (const change of [{ imageSourceStepId: 'missing' }, { imageSourceStepId: 'animation-review' }]) { const request = await f.request(); Object.assign(request.workflow.steps[1], change); await expect(f.engine.start(request)).rejects.toThrow('PNG图集'); }
    const invalidFormat = await f.request(); invalidFormat.workflow.steps[0].imageOutputFormat = 'gif'; await expect(f.engine.start(invalidFormat)).rejects.toThrow();
    await f.workspaceStorage.ensureProject({ projectId: 'foreign-project', workspaceId: f.project.workspaceId, name: '外项目' }); const foreign = await f.artifactStore.write({ projectId: 'foreign-project', name: '外项目.png', mimeType: 'image/png', buffer: png() }); const standalone = await f.request(); standalone.workflow.steps = [{ ...standalone.workflow.steps[1], inputSource: 'project', imageSourceStepId: undefined, referenceArtifactIds: [foreign.id] }]; await expect(f.engine.start(standalone)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
  it('本地失败继续和重试都只合成，不重复已成功图片请求与费用', async () => {
    const f = await setup(); f.workflowControls.error = Error('合成测试：本地失败'); const run = await f.engine.start(await f.request()); await f.until(() => f.engine.runDetail(run.id), value => value.status === 'failed'); const ledger = structuredClone((await f.engine.snapshot()).ledger); expect(f.calls).toHaveLength(1);
    f.workflowControls.error = undefined; await f.engine.control({ id: run.id, action: 'continue' }); await f.until(() => f.engine.runDetail(run.id), value => value.status === 'waiting-review'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    await f.engine.control({ id: run.id, action: 'cancel' }); await f.engine.control({ id: run.id, action: 'retry', stepId: 'animation-compose' }); await f.until(() => f.engine.runDetail(run.id), value => value.status === 'complete'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
  });
  it('取消正在合成的本地步骤后可恢复，不重新调用模型，不能把GIF直接送到后续图片精修', async () => {
    const f = await setup(), gate = deferred(); f.releases.push(gate.resolve); f.workflowControls.hold = gate.promise; const run = await f.engine.start(await f.request()); await f.until(async () => f.local.length, count => count === 1); const ledger = structuredClone((await f.engine.snapshot()).ledger); await f.engine.control({ id: run.id, action: 'cancel' }); await f.until(() => f.engine.runDetail(run.id), value => value.attempts.some(attempt => attempt.stepId === 'animation-compose' && attempt.status === 'cancelled'));
    f.workflowControls.hold = undefined; gate.resolve(); await f.engine.control({ id: run.id, action: 'continue' }); await f.until(() => f.engine.runDetail(run.id), value => value.status === 'waiting-review'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    const next = await f.request(); next.workflow.steps.splice(2, 0, { ...next.workflow.steps[0], id: 'bad-image-edit', kind: 'image-editing', referenceArtifactIds: undefined, inputSource: 'previous' }); const check = await f.engine.preflight(next); expect(check.ok).toBe(false); expect(check.errors.some(error => error.includes('GIF动画不能直接'))).toBe(true);
  });
});
