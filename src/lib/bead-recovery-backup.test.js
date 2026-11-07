import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs');
async function profile(directory) {
  await fs.mkdir(directory);
  const storage = createWorkspaceStorage({ directory });
  const artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
  return { storage, artifacts, engine, backup: createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: dependencies }) };
}
describe('opaque damaged bead recovery bytes in real workspace backup', () => {
  it('keeps diagnostic bytes intact instead of parsing them as active JSON or blocking whole-project recovery', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-bead-backup-')), source = await profile(path.join(directory, 'source'));
    let target;
    try {
      const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
      await source.storage.bindRoot({ workspaceId: 'workspace-one', name: '图纸资料', directory: workspace });
      await source.storage.ensureProject({ projectId: 'project-one', workspaceId: 'workspace-one', name: '拼豆工程' });
      const projectDirectory = await source.storage.projectDirectory('project-one'), internal = path.join(projectDirectory, '.xuzuo');
      const history = path.join(internal, 'bead-revisions-v1'); await fs.mkdir(history, { recursive: true });
      const filenames = ['bead-before-restore-11111111-1111-4111-8111-111111111111.json', 'index-invalid-22222222-2222-4222-8222-222222222222.json'];
      const corrupt = Buffer.from([255, 254, 0, 123, 34, 98, 97, 100]);
      await fs.writeFile(path.join(internal, filenames[0]), corrupt); await fs.writeFile(path.join(history, filenames[1]), corrupt);
      const time = '2026-11-07T00:00:00Z';
      const project = { id: 'project-one', workspaceId: 'workspace-one', name: '拼豆工程', kind: 'image', status: 'draft', description: '', updatedAt: time, costCents: 0, version: 0, accent: 'blue', directory: projectDirectory };
      const meta = { workspaces: [{ id: 'workspace-one', name: '图纸资料', createdAt: time }], projects: [project], ledger: [], preferencesByWorkspace: {}, customPrompts: [], configuration: { version: 1, connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] } };
      const archive = path.join(directory, 'beads.zip');
      await source.backup.exportBackup({ meta, workspaceIds: ['workspace-one'], filePath: archive });
      target = await profile(path.join(directory, 'target')); const destination = path.join(directory, 'restored'); await fs.mkdir(destination);
      const result = await target.backup.importBackup({ filePath: archive, directory: destination });
      const restoredDirectory = await target.storage.projectDirectory(result.idMap['project-one']);
      expect(await fs.readFile(path.join(restoredDirectory, '.xuzuo', filenames[0]))).toEqual(corrupt);
      expect(await fs.readFile(path.join(restoredDirectory, '.xuzuo', 'bead-revisions-v1', filenames[1]))).toEqual(corrupt);
      expect(await fs.readFile(path.join(internal, filenames[0]))).toEqual(corrupt);
      expect((await source.engine.snapshot()).ledger).toEqual([]); expect((await target.engine.snapshot()).ledger).toEqual([]);
    } finally {
      await source.engine.shutdown(); await target?.engine.shutdown();
      expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir())); expect(path.basename(directory).startsWith('xuzuo-bead-backup-')).toBe(true);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
