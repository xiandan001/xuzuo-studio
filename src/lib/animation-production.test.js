import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { fixture, deferred } = require('./animation-integration-fixtures.cjs');
const { createAnimationProduction } = require('../../electron/animation-production.cjs'), core = require('../../electron/animation-document.runtime.cjs');
const active = [];
async function setup(changes) { const f = await fixture(changes); active.push(f); return f; }
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });

describe('动画制图派发：真实原生引擎/文件/账本，合成模型替身，不连接供应商', () => {
  it('完整PNG生成记一次真实原生费用，重新读取相同源稿复用原run不再次调用', async () => {
    const f = await setup(), document = await f.store.read(f.input), jobId = await f.job();
    const first = await f.production.generate({ document, entries: document.entries, jobId });
    expect(first.artifact.mimeType).toBe('image/png'); expect(f.calls).toHaveLength(1);
    const ledger = structuredClone((await f.engine.snapshot()).ledger); expect(ledger).toHaveLength(1); expect(ledger[0].costCents).toBeGreaterThan(0);
    const second = await f.production.generate({ document, entries: document.entries, jobId: await f.job() });
    expect(second.runId).toBe(first.runId); expect(second.artifact.id).toBe(first.artifact.id); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    expect(f.calls[0].options.outputFormat).toBe('png'); expect(f.calls[0].options.background).toBe('transparent');
  });
  it('派发回包丢失且lookup不可读时保存unknown，不自动重发；lookup恢复后接回原run和费用', async () => {
    const f = await setup(), lookup = f.engine.lookupStart.bind(f.engine), document = await f.store.read(f.input);
    f.engine.lookupStart = async () => { throw Error('Synthetic lookup unavailable'); };
    const production = createAnimationProduction({ ...f.options, core, start: async input => { await f.engine.start(input); throw Error('Synthetic start response lost'); } });
    await expect(production.generate({ document, entries: document.entries, jobId: await f.job() })).rejects.toThrow(/可靠读取|未知/);
    await f.until(() => f.engine.snapshot(), value => value.runs.some(run => run.status === 'complete')); const ledger = structuredClone((await f.engine.snapshot()).ledger);
    expect((await f.journal.read(f.project.id)).jobs[0].operations[0].status).toBe('unknown');
    await expect(production.generate({ document, entries: document.entries, jobId: await f.job() })).rejects.toThrow('Synthetic lookup unavailable'); expect(f.calls).toHaveLength(1);
    await expect(production.generate({ document, entries: document.entries, jobId: await f.job(), retry: true })).rejects.toThrow(/未知|未再次/); expect(f.calls).toHaveLength(1);
    f.engine.lookupStart = lookup; const recovered = await production.generate({ document, entries: document.entries, jobId: await f.job() }); expect(recovered.runId).toBe(ledger[0].workflowRunId); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
  });
  it('跨项目、删除和回收站参考图在派发前拒绝，不新增run或费用', async () => {
    const f = await setup(), document = await f.store.read(f.input); await f.workspaceStorage.ensureProject({ projectId: 'foreign-project', workspaceId: f.project.workspaceId, name: '外项目' });
    const { png } = require('./animation-integration-fixtures.cjs');
    const foreign = await f.artifactStore.write({ projectId: 'foreign-project', name: '外项目.png', mimeType: 'image/png', buffer: png() });
    await expect(f.production.generate({ document, entries: document.entries, jobId: await f.job(), referenceIds: [foreign.id] })).rejects.toThrow(/当前项目/);
    const own = await f.artifactStore.write({ projectId: f.project.id, name: '本项目.png', mimeType: 'image/png', buffer: png() }); await f.artifactStore.trash(own.id);
    await expect(f.production.generate({ document, entries: document.entries, jobId: await f.job(), referenceIds: [own.id] })).rejects.toThrow(/当前项目|读取|回收站/);
    await expect(f.production.generate({ document, entries: document.entries, jobId: await f.job(), referenceIds: ['missing-artifact'] })).rejects.toThrow(); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('上下文预检查期间取消，迟到的配置不会启动模型或写派发操作', async () => {
    const f = await setup(), gate = deferred(), controller = new AbortController(); f.releases.push(gate.resolve);
    const production = createAnimationProduction({ ...f.options, core, getContext: async () => { await gate.promise; return structuredClone(f.context); } }), document = await f.store.read(f.input), jobId = await f.job();
    const task = production.generate({ document, entries: document.entries, jobId, signal: controller.signal }), rejected = expect(task).rejects.toHaveProperty('name', 'AbortError');
    controller.abort(); gate.resolve(); await rejected; expect(f.calls).toHaveLength(0); expect((await f.journal.read(f.project.id)).jobs[0].operations).toEqual([]);
  });
  it('明确重生图只追加一次费用，原账目和原源图不被覆盖', async () => {
    const f = await setup(), document = await f.store.read(f.input), first = await f.production.generate({ document, entries: document.entries, jobId: await f.job() }); const before = structuredClone((await f.engine.snapshot()).ledger), original = await f.artifactStore.read(first.artifact.id);
    const next = await f.production.generate({ document, entries: document.entries, jobId: await f.job(), retry: true }); expect(next.runId).not.toBe(first.runId); expect(f.calls).toHaveLength(2); const after = (await f.engine.snapshot()).ledger; expect(after).toHaveLength(2); expect(after.find(row => row.id === before[0].id)).toEqual(before[0]); expect((await f.artifactStore.read(first.artifact.id)).buffer).toEqual(original.buffer);
  });
  it('明确未启动的拒绝可以由用户重试，正常继续不会暗中重发', async () => {
    const f = await setup(), document = await f.store.read(f.input); let rejected = true;
    const production = createAnimationProduction({ ...f.options, core, start: async input => { if (rejected) { rejected = false; throw Error('Synthetic request rejected before start'); } return f.engine.start(input); } });
    await expect(production.generate({ document, entries: document.entries, jobId: await f.job() })).rejects.toThrow('Synthetic request rejected'); expect(f.calls).toHaveLength(0);
    await expect(production.generate({ document, entries: document.entries, jobId: await f.job() })).rejects.toThrow(/未知|未自动/); expect(f.calls).toHaveLength(0);
    const result = await production.generate({ document, entries: document.entries, jobId: await f.job(), retry: true }); expect(result.artifact.mimeType).toBe('image/png'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('缓存run归属串到外项目时先拒绝，取消不能控制外项目运行', async () => {
    const f = await setup(), document = await f.store.read(f.input), first = await f.production.generate({ document, entries: document.entries, jobId: await f.job() }), original = await f.engine.runDetail(first.runId), controller = new AbortController(), controlled = [];
    await f.journal.mutate(f.project.id, state => { state.jobs[0].operations[0].runId = 'foreign-run'; return state; });
    const detail = f.engine.runDetail.bind(f.engine); f.engine.runDetail = async id => { if (id === 'foreign-run') { controller.abort(); return { ...original, id, projectId: 'foreign-project', workspaceId: 'foreign-workspace', dispatchKey: 'c'.repeat(64), status: 'running' }; } return detail(id); };
    const control = f.engine.control.bind(f.engine); f.engine.control = async input => { controlled.push(input.id); if (input.id === 'foreign-run') return undefined; return control(input); };
    await expect(f.production.generate({ document, entries: document.entries, jobId: await f.job(), signal: controller.signal })).rejects.toThrow(/归属|不属于|来源|派发|匹配/); expect(controlled).not.toContain('foreign-run'); expect(f.calls).toHaveLength(1);
  });
});
