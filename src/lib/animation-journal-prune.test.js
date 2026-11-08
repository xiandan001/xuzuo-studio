import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture } = require('./animation-integration-fixtures.cjs');
const owned = [], stamp = '2026-11-08T10:00:00.000Z', hash = text => createHash('sha256').update(text).digest('hex');
async function setup(options) { const f = await fixture(options); owned.push(f); return f; }
afterEach(async () => { for (const f of owned.splice(0).reverse()) await f.close(); });

describe('动画日志留存按真实派发去重（真实FS/引擎/账本，模型及编码替身）', () => {
  it('同一未知请求复制30个恢复job后仍保留原owner，可lookup接回并免费本地合成', async () => {
    const holder = {}, f = await setup({ start: async input => { await holder.value.engine.start(input); throw Error('Synthetic start response lost'); } }); holder.value = f;
    const lookup = f.engine.lookupStart.bind(f.engine); f.engine.lookupStart = async () => { throw Error('Synthetic lookup temporarily unavailable'); };
    await f.service.generate(f.input); const failure = await f.completed(); expect(failure.job.status).toBe('failed'); await f.until(() => f.engine.snapshot(), value => value.runs.some(run => run.status === 'complete')); const ledger = structuredClone((await f.engine.snapshot()).ledger); expect(f.calls).toHaveLength(1);
    const original = structuredClone((await f.journal.read(f.project.id)).jobs[0]); expect(original.operations[0].status).toBe('unknown');
    await f.journal.mutate(f.project.id, state => { state.jobs = Array.from({ length: 30 }, (_, index) => index === 0 ? structuredClone(original) : { ...structuredClone(original), id: `duplicate-recovery-${index}`, request: { ...original.request, resumeJobId: original.id }, status: 'failed' }); return state; });
    const description = (await f.store.read(f.input)).entries[0].description; await f.store.mutate(f.project.id, document => { document.entries[0].description = '修改源需求，改为双手举起'; return document; });
    await f.service.control({ ...f.input, action: 'continue' }); const changed = await f.completed(); expect(changed.job.status).toBe('failed'); expect(changed.job.error).toMatch(/源稿|需求/); expect((await f.journal.read(f.project.id)).jobs.some(job => job.id === original.id)).toBe(true); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    await f.store.mutate(f.project.id, document => { document.entries[0].description = description; return document; });
    f.engine.lookupStart = lookup; await f.service.control({ ...f.input, action: 'continue' }); const recovered = await f.completed();
    expect(recovered.job.status).toBe('complete'); expect(recovered.document.entries[0].status).toBe('ready'); expect(f.calls).toHaveLength(1); expect(f.tools).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    const jobs = (await f.journal.read(f.project.id)).jobs; expect(jobs).toHaveLength(30); expect(jobs.some(job => job.id === original.id)).toBe(true); expect(jobs.at(-1).request.resumeJobId).toBe(original.id); expect(jobs.at(-1).operations[0].dispatchKey).toBe(original.operations[0].dispatchKey); expect(jobs.filter(job => job.operations.some(operation => operation.status === 'unknown'))).toEqual([]); expect(new Set(jobs.flatMap(job => job.operations.map(operation => operation.dispatchKey))).size).toBe(1);
  });

  it('30个真正独立未知派发仍被保护，拒绝新增而不改旧日志、请求或费用', async () => {
    const f = await setup();
    await f.journal.mutate(f.project.id, state => { state.jobs = Array.from({ length: 30 }, (_, index) => ({ id: `independent-job-${index}`, projectId: f.project.id, kind: 'generate', request: { projectId: f.project.id, entryIds: ['entry-1'] }, status: 'failed', stage: 'generating', entryIds: ['entry-1'], completedEntryIds: [], runIds: [], operations: [{ entryId: 'entry-1', entryIds: ['entry-1'], sourceHash: hash('source-' + index), dispatchKey: hash('independent-dispatch-' + index), status: 'unknown' }], createdAt: stamp, updatedAt: stamp })); return state; });
    const filename = path.join(await f.workspaceStorage.projectDirectory(f.project.id), '.xuzuo/animation-jobs-v1.json'), before = await fs.readFile(filename);
    await expect(f.service.generate(f.input)).rejects.toThrow('较多动画派发结果待核对'); expect(await fs.readFile(filename)).toEqual(before); expect((await f.journal.read(f.project.id)).jobs).toHaveLength(30); expect(f.calls).toHaveLength(0); expect(f.tools).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]); expect(f.service.isProjectBusy(f.project.id)).toBe(false);
  });
});
