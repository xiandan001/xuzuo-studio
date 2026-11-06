import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createBatchProduction } = require('../../electron/batch-production.cjs');
const ownedRoot = fileURLToPath(new URL('../../work/', import.meta.url)), fixtures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await wait(5); }
  throw Error('Controlled batch poll did not settle');
}
const input = rows => ({ name: '轮询范围回归', rows: Array.from({ length: rows }, (_, index) => ({ 客户: String(index) })), request: { project: { id: 'template', workspaceId: 'owned-workspace', kind: 'word', name: '模板' }, workflow: { id: 'controlled-poll', workspaceId: 'owned-workspace', outputKind: 'word', steps: [{ id: 'text', kind: 'text', prompt: '{{客户}}', enabled: true }] }, input: '{{客户}}', variables: {}, attachmentIds: [], models: [], connections: [] } });

async function fixture(rows = 1) {
  await fs.mkdir(ownedRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(ownedRoot, 'batch-poll-scope-'));
  const state = { revision: 1, calls: [], starts: [], controls: [], runs: [], ledger: [], locations: [] };
  const engine = {
    preflight: async () => ({ ok: true, errors: [] }),
    snapshot: async (afterRevision, options = {}) => {
      const call = { afterRevision, options: structuredClone(options), revision: state.revision };
      state.calls.push(call);
      if (Number.isSafeInteger(afterRevision) && afterRevision >= state.revision) { call.unchanged = true; return null; }
      const runs = state.runs.filter(run => !options.projectIds || options.projectIds.includes(run.projectId));
      const ledger = state.ledger.filter(entry => !options.projectIds || options.projectIds.includes(entry.projectId));
      call.returnedRuns = runs.map(run => run.id); call.returnedLedger = ledger.map(entry => entry.id);
      return structuredClone({ revision: state.revision, runs, ledger });
    },
    start: async request => {
      const run = { id: 'run-' + (state.starts.length + 1), projectId: request.project.id, workspaceId: request.project.workspaceId, createdAt: new Date().toISOString(), status: 'running', attempts: [], workflowId: request.workflow.id, snapshot: request.workflow };
      state.starts.push(run.id); state.runs.push(run); return structuredClone(run);
    },
    control: async ({ id, action }) => { state.controls.push({ id, action }); state.runs.find(run => run.id === id).status = action === 'cancel' ? 'cancelled' : 'running'; state.revision++; },
  };
  const workspaceStorage = {
    list: async () => ({ workspaces: [{ workspaceId: 'owned-workspace' }], projects: state.locations }),
    assertProject: async () => undefined,
    projectDirectory: async projectId => {
      const location = state.locations.find(item => item.projectId === projectId);
      if (!location) throw Error('Project is not registered in this owned fixture');
      return location.directory;
    },
    ensureProject: async project => {
      let location = state.locations.find(item => item.projectId === project.projectId);
      if (!location) { location = { ...project, directory: path.join(directory, project.projectId) }; state.locations.push(location); await fs.mkdir(location.directory); }
      return location;
    },
  };
  const batch = createBatchProduction({ directory, workspaceStorage, liveEngine: engine });
  const f = { directory, state, batch }; fixtures.push(f);
  f.record = await batch.create(input(rows));
  await batch.control({ id: f.record.id, action: 'start' });
  await until(() => state.starts.length, count => count === 1);
  await batch.drain(); state.calls.length = 0;
  return f;
}
async function saved(f) { return (await f.batch.exportRecords(f.record.items.map(item => item.project.id)))[0]; }
async function quietPolls(f, count = 2) { await until(() => f.state.calls.length, length => length >= count); }
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.batch.shutdown();
    const relative = path.relative(ownedRoot, f.directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Non-owned test cleanup');
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

describe('batch pump reads only changed current-project summaries', () => {
  it('quiet polls reuse a complete scoped result instead of copying global history', async () => {
    const f = await fixture();
    await quietPolls(f, 3);
    expect(f.state.calls.every(call => call.options.summaryOnly && call.options.projectIds?.join() === f.record.items[0].project.id)).toBe(true);
    expect(f.state.calls.some(call => call.unchanged)).toBe(true);
    expect(f.state.calls.filter(call => !call.unchanged).length).toBeLessThanOrEqual(1);
    expect((await saved(f)).items[0].status).toBe('running');
    expect(f.state.starts).toHaveLength(1);
  });

  it('unrelated revisions exclude foreign ledgers; own completion and all public fees remain current', async () => {
    const f = await fixture(), projectId = f.record.items[0].project.id;
    await quietPolls(f); f.state.calls.length = 0;
    f.state.ledger.push({ id: 'foreign-fee', projectId: 'foreign-project', costCents: 999, time: '2026-11-06T00:00:00Z' }); f.state.revision++;
    await quietPolls(f);
    const changed = f.state.calls.find(call => !call.unchanged);
    expect(changed.options.projectIds).toEqual([projectId]); expect(changed.returnedLedger).toEqual([]);
    expect((await saved(f)).items[0].status).toBe('running');
    const artifact = { id: 'owned-result', projectId };
    f.state.runs[0].status = 'complete'; f.state.runs[0].attempts = [{ artifacts: [artifact] }];
    f.state.ledger.push({ id: 'earlier-fee', projectId, costCents: 2, time: '2026-11-06T00:00:00Z' }, { id: 'current-fee', projectId, costCents: 3, time: '2026-11-06T01:00:00Z' }); f.state.revision++;
    await until(() => saved(f), record => record.status === 'complete');
    const current = await f.batch.get({ id: f.record.id });
    expect(current.items[0].artifacts).toEqual([artifact]); expect(current.items[0].costCents).toBe(5);
    expect(current.items[0].ledger.map(entry => entry.id)).toEqual(['earlier-fee', 'current-fee']);
    expect(f.state.calls.at(-1).options.projectIds).toBeUndefined(); expect(f.state.starts).toHaveLength(1);
  });

  it('a changed complete snapshot replaces removed runs rather than retaining a stale run', async () => {
    const f = await fixture(); await quietPolls(f);
    f.state.runs.length = 0; f.state.revision++;
    const stopped = await until(() => saved(f), record => record.status === 'paused');
    expect(stopped.items[0].status).toBe('interrupted'); expect(stopped.items[0].error).toContain('未自动重发');
    expect(f.state.starts).toHaveLength(1);
  });

  it('a different item resets the project and revision before its first poll', async () => {
    const f = await fixture(2); await quietPolls(f);
    f.state.runs[0].status = 'complete'; f.state.revision++;
    await until(() => f.state.starts.length, count => count === 2);
    await until(() => f.state.calls.filter(call => call.options.projectIds?.[0] === f.record.items[1].project.id), calls => calls.length >= 2);
    const second = f.state.calls.find(call => call.options.projectIds?.[0] === f.record.items[1].project.id);
    expect(second.afterRevision === undefined || second.afterRevision < 0).toBe(true);
    expect(second.returnedRuns).toEqual(['run-2']); expect((await saved(f)).items[1].status).toBe('running');
    f.state.runs[1].status = 'complete'; f.state.revision++;
    await until(() => saved(f), record => record.status === 'complete'); expect(f.state.starts).toHaveLength(2);
  });

  it('cancel uses a fresh independent read while a pump snapshot is cached', async () => {
    const f = await fixture(); await quietPolls(f); f.state.calls.length = 0;
    f.state.runs[0].status = 'waiting-review'; f.state.revision++;
    const result = await f.batch.control({ id: f.record.id, action: 'cancel' });
    expect(f.state.calls.filter(call => !call.options.projectIds).length).toBeGreaterThanOrEqual(2);
    expect(f.state.controls).toEqual([{ id: 'run-1', action: 'cancel' }]); expect(result.status).toBe('cancelled');
    await wait(120); expect(f.state.starts).toHaveLength(1);
  });
});
