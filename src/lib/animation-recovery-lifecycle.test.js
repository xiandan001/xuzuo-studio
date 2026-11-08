import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { fixture, deferred, png } = require('./animation-integration-fixtures.cjs'), core = require('../../electron/animation-document.runtime.cjs');
const owned = [];
async function setup(options) { const f = await fixture(options), prepareClose = f.tool.prepareClose; f.resetTestTool = () => { f.tool.prepareClose = prepareClose; }; owned.push(f); return f; }
afterEach(async () => { for (const f of owned.splice(0).reverse()) { f.resetTestTool(); await f.close(); } });

async function localWorkflowFixture() {
  const holder = {}, callbacks = [];
  const f = await setup({ engineOverrides: { localAnimationStatus: () => holder.value.service.status(), localAnimationStep: input => { callbacks.push(input); return holder.value.service.executeWorkflowStep(input); } } }); holder.value = f;
  const source = await f.artifactStore.write({ name: '本地既有PNG图集.png', mimeType: 'image/png', buffer: png(), projectId: f.project.id }), document = await f.store.read(f.input), draft = core.makeAnimationWorkflow(document, f.context);
  const request = { project: f.project, workflow: { ...draft, id: 'local-recovery-workflow', workspaceId: f.project.workspaceId, updatedAt: '', steps: [{ ...draft.steps[1], imageSourceStepId: undefined, referenceArtifactIds: [source.id], inputSource: 'project' }, draft.steps[2]] }, connections: [], models: [], input: '只本地合成，不调用模型', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
  return { ...f, callbacks, source, request };
}

async function framesDocument(f, count = 4) {
  const before = await f.store.read(f.input), document = { ...before, style: 'pixel-actions', columns: 2, rows: 2 }, source = await f.source(document, document.entries[0], count);
  source.entry.frames = source.entry.frames.map((frame, index) => ({ ...frame, cell: [index % 2, Math.floor(index / 2)], grid: [2, 2] }));
  await f.store.save({ ...f.input, expectedRevision: before.revision, document: { ...document, entries: [source.entry] } }); return source;
}

describe('动画恢复与关闭边界（真实Engine/service/FS/账本，模型与编码器替身）', () => {
  it('真实localOnly回调直连动画服务，关闭先中断tool再排空，busy随实际回调消失且无模型费用', async () => {
    const f = await localWorkflowFixture(), gate = deferred(), entered = deferred(), events = []; f.controls.toolGate = gate.promise; f.releases.push(gate.resolve); let signal;
    const runTool = f.tool.run.bind(f.tool); f.tool.run = async (manifest, directory, options) => { signal = options.signal; events.push('tool-start'); entered.resolve(); return runTool(manifest, directory, options); }; f.tool.prepareClose = async () => { events.push('tool-close'); expect(signal.aborted).toBe(true); };
    const run = await f.engine.start(f.request); await entered.promise; expect(f.callbacks).toHaveLength(1); expect(f.service.isProjectBusy(f.project.id)).toBe(true); expect(f.service.isWorkspaceBusy(f.project.workspaceId)).toBe(true); expect(f.service.isWorkspaceBusy('other-workspace')).toBe(false);
    await f.service.prepareClose(); const cancelled = await f.until(() => f.engine.runDetail(run.id), value => value.status === 'cancelled' && value.attempts.some(attempt => attempt.status === 'cancelled'));
    expect(events).toEqual(['tool-start','tool-close']); expect(cancelled.attempts[0].costCents).toBe(0); expect(f.service.isProjectBusy(f.project.id)).toBe(false); expect(f.service.isWorkspaceBusy(f.project.workspaceId)).toBe(false); expect(f.tools).toHaveLength(1); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]); expect((await f.store.read(f.input)).entries[0].outputArtifactId).toBeUndefined(); gate.resolve();
  });
  it('本地回调等待源IO时关闭仍持有busy，迟到读取释放后不会再启动tool或覆盖工程', async () => {
    const f = await localWorkflowFixture(), gate = deferred(), entered = deferred(); f.releases.push(gate.resolve); let held = false;
    const original = await f.store.read(f.input), read = f.artifactStore.read.bind(f.artifactStore);
    f.artifactStore.read = async id => { if (id === f.source.id && f.service.isProjectBusy(f.project.id) && !held) { held = true; entered.resolve(); await gate.promise; } return read(id); };
    const run = await f.engine.start(f.request); await entered.promise; expect(f.service.isProjectBusy(f.project.id)).toBe(true); expect(f.service.isWorkspaceBusy(f.project.workspaceId)).toBe(true);
    let finished = false; const closing = f.service.prepareClose().then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false); expect(f.service.isProjectBusy(f.project.id)).toBe(true); gate.resolve(); await closing; await f.until(() => f.engine.runDetail(run.id), value => value.status === 'cancelled');
    expect(f.tools).toHaveLength(0); expect(f.calls).toHaveLength(0); expect(f.service.isProjectBusy(f.project.id)).toBe(false); expect(f.service.isWorkspaceBusy(f.project.workspaceId)).toBe(false); expect(await f.store.read(f.input)).toEqual(original); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('whole-refine未知之后源crop/顺序改变，反复continue与retry均不得变成新收费请求', async () => {
    const holder = {}, f = await setup({ start: async input => { await holder.value.engine.start(input); throw Error('Synthetic whole refine response lost'); } }); holder.value = f; await framesDocument(f);
    const lookup = f.engine.lookupStart.bind(f.engine); f.engine.lookupStart = async () => { throw Error('Synthetic lookup unavailable'); };
    await f.service.refine({ ...f.input, entryId: 'entry-1', instruction: '保留顺序，只修好角色双手' }); const failed = await f.completed(); expect(failed.job.status).toBe('failed'); await f.until(() => f.engine.snapshot(), value => value.runs.some(run => run.status === 'complete')); const ledger = structuredClone((await f.engine.snapshot()).ledger); expect(f.calls).toHaveLength(1);
    await f.store.mutate(f.project.id, document => { document.entries[0].frames.reverse(); document.entries[0].frames[0].crop = [0, 0, 32, 32]; return document; });
    for (const action of ['continue','retry','continue']) { await f.service.control({ ...f.input, action }); const stopped = await f.completed(); expect(stopped.job.status).toBe('failed'); expect(stopped.job.error).toMatch(/源稿|需求|原任务|恢复操作|新收费|派发记录/); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger); }
    f.engine.lookupStart = lookup;
  });
  it('两次显式整条目精修即使指令及PNG源字节完全相同，也各自派发并保留两笔原生费用', async () => {
    const f = await setup(), source = await framesDocument(f), bytes = (await f.artifactStore.read(source.artifact.id)).buffer;
    f.engineOptions.modelRuntime.execute = async input => { f.calls.push(input); return { artifacts: [await f.artifactStore.write({ name: '合成恒定源PNG.png', mimeType: 'image/png', buffer: bytes, projectId: f.project.id, runId: input.runId })], usage: { images: 1, inputTokens: 5, outputTokens: 5 } }; };
    const input = { ...f.input, entryId: 'entry-1', instruction: '只微调手部，保留其余画面' }; await f.service.refine(input); const first = await f.completed(); expect(first.job.status).toBe('complete'); const ledger = structuredClone((await f.engine.snapshot()).ledger), firstOutput = first.document.entries[0].frames[0].atlasArtifactId;
    await f.service.refine(input); const second = await f.completed(); expect(second.job.status).toBe('complete'); expect(f.calls).toHaveLength(2); expect(f.calls[0].prompt).toBe(f.calls[1].prompt); const after = (await f.engine.snapshot()).ledger; expect(after).toHaveLength(2); expect(after.find(entry => entry.id === ledger[0].id)).toEqual(ledger[0]); expect(after.reduce((total, entry) => total + entry.costCents, 0)).toBe(ledger[0].costCents * 2);
    const jobs = (await f.journal.read(f.project.id)).jobs; expect(jobs.at(-1).operations[0].sourceHash).toBe(jobs.at(-2).operations[0].sourceHash); expect(jobs.at(-1).operations[0].dispatchKey).not.toBe(jobs.at(-2).operations[0].dispatchKey); expect(second.document.entries[0].frames[0].atlasArtifactId).not.toBe(firstOutput); expect((await f.artifactStore.read(firstOutput)).buffer).toEqual(bytes); expect((await f.artifactStore.read(second.document.entries[0].frames[0].atlasArtifactId)).buffer).toEqual(bytes);
  });
});
