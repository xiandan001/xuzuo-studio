import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createBatchProduction } = require('../../electron/batch-production.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const ownedRoot = fileURLToPath(new URL('../../work/', import.meta.url)), fixtures = [];
const input = { name: '目录复用验收', rows: [{ 客户: '甲' }], request: { project: { id: 'template', workspaceId: 'source', name: '模板', kind: 'word' }, workflow: { id: 'directory-fixture', workspaceId: 'source', outputKind: 'word', steps: [{ id: 'text', kind: 'text', prompt: '{{客户}}', enabled: true }] }, input: '{{客户}}', models: [], connections: [], variables: {}, attachmentIds: [] } };
async function until(read, predicate) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) { const result = await read(); if (predicate(result)) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Owned batch directory fixture did not settle');
}
async function fixture() {
  await fs.mkdir(ownedRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(ownedRoot, 'batch-submit-directory-'));
  const commits = [], migrations = [], requests = [], runs = [], control = path.join(directory, 'control');
  const fileSystem = { ...fs, rename: async (from, to) => { await fs.rename(from, to); if (['workspace-directories-v1.json', 'workspace-directories-transition-v1.json'].includes(path.basename(to))) commits.push(to); } };
  const storage = createWorkspaceStorage({ directory: control, fileSystem });
  const artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage: storage });
  storage.setArtifactMigrator((...args) => { migrations.push(args); return artifacts.migrateProject(...args); });
  for (const id of ['source', 'target']) { const root = path.join(directory, id); await fs.mkdir(root); await storage.bindRoot({ workspaceId: id, name: id, directory: root }); }
  const engine = {
    preflight: async () => ({ ok: true, errors: [] }),
    snapshot: async () => structuredClone({ revision: 1, runs, ledger: [] }),
    start: async request => {
      requests.push(structuredClone(request));
      const run = { id: 'owned-run', projectId: request.project.id, workspaceId: request.project.workspaceId, createdAt: new Date().toISOString(), status: 'complete', attempts: [], snapshot: request.workflow };
      runs.push(run); return structuredClone(run);
    },
  };
  const batch = createBatchProduction({ directory: control, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine });
  const f = { directory, control, storage, batch, commits, migrations, requests }; fixtures.push(f);
  f.record = await batch.create(input); f.project = f.record.items[0].project;
  f.marker = path.join(f.project.directory, '.xuzuo', 'project-v1.json');
  return f;
}
const saved = async f => (await f.batch.exportRecords([f.project.id]))[0];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.batch.shutdown();
    const relative = path.relative(ownedRoot, f.directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Non-owned directory cleanup');
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

describe('batch submission reads its already registered project directory', () => {
  it('does not commit or migrate again, preserves a later rename and submits the authoritative path', async () => {
    const f = await fixture();
    const renamed = await f.storage.ensureProject({ projectId: f.project.id, workspaceId: 'source', name: '用户之后修改的名称' });
    const before = await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'));
    f.commits.length = 0; f.migrations.length = 0;
    await f.batch.control({ id: f.record.id, action: 'start' });
    await until(() => saved(f), record => record.status === 'complete');
    expect(f.commits).toEqual([]); expect(f.migrations).toEqual([]);
    expect(f.requests).toHaveLength(1); expect(f.requests[0].project.directory).toBe(await f.storage.projectDirectory(f.project.id));
    expect(f.requests[0].project.directory).toBe(renamed.directory);
    expect((await f.storage.list()).projects.find(project => project.projectId === f.project.id).name).toBe('用户之后修改的名称');
    expect(await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'))).toEqual(before);
    expect((await f.batch.get({ id: f.record.id })).items[0].ledger).toEqual([]);
  });

  it.each(['damaged-marker', 'moved-workspace'])('%s rejects before start and does not repair or reassign the project', async problem => {
    const f = await fixture(); let markerBytes;
    if (problem === 'damaged-marker') { markerBytes = Buffer.from('{broken-owned-marker'); await fs.writeFile(f.marker, markerBytes); }
    else await f.storage.moveProject({ projectId: f.project.id, workspaceId: 'target', name: '已移至另一个工作区' });
    const before = await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'));
    f.commits.length = 0; f.migrations.length = 0;
    await f.batch.control({ id: f.record.id, action: 'start' });
    const stopped = await until(() => saved(f), record => record.status === 'paused');
    expect(stopped.items[0].status).toBe('failed'); expect(f.requests).toEqual([]);
    expect(f.commits).toEqual([]); expect(f.migrations).toEqual([]);
    expect(await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'))).toEqual(before);
    if (markerBytes) expect(await fs.readFile(f.marker)).toEqual(markerBytes);
    else expect((await f.storage.list()).projects.find(project => project.projectId === f.project.id).workspaceId).toBe('target');
    expect((await f.batch.get({ id: f.record.id })).items[0].ledger).toEqual([]);
  });
});
