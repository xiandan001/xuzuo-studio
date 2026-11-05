import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url)), deps = createRequire(path.join(root, 'work/ui-build/package.json'));
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs'), { createProjectBackup } = require('../../electron/project-backup.cjs');
async function profile(directory) {
  await fs.mkdir(directory); const storage = createWorkspaceStorage({ directory }), artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage: storage, loadModule: deps }); storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
  return { storage, engine, backup: createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: deps }) };
}
describe('报价记录真实ZIP备份恢复', () => {
  it('只导出所选项目、排除秘密字段，并与费用实体ID一同重绑', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-quote-backup-')), source = await profile(path.join(directory, 'source')); let target;
    try {
      const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace); await source.storage.bindRoot({ workspaceId: 'workspace-one', name: '报价工作区', directory: workspace });
      for (const projectId of ['project-one', 'project-two']) await source.storage.ensureProject({ projectId, workspaceId: 'workspace-one', name: projectId });
      const inputs = { minutes: '30', rate: '60', remaining: '0', other: '0', reserve: '0', fee: '10', profit: '20', price: '19.9', variable: '0' }, saved = { type: 'xuzuo-project-quote', version: 1, workspaceId: 'workspace-one', projectId: 'project-one', inputs, mode: 'single', scope: 'live', savedAt: '2026-11-03', pendingCostEntryIds: ['paid-one'], apiKey: 'DO-NOT-INCLUDE-FAKE-SECRET' }, customer = { client: '客户', scope: '12页PPT', quantity: '1', revisions: '1', deliveryDate: '', validUntil: '', notes: '', contact: '' };
      const projects = ['project-one', 'project-two'].map(id => ({ id, workspaceId: 'workspace-one', name: id, kind: 'word', status: 'draft', description: '', updatedAt: '2026-11-03', costCents: 17, version: 1, accent: 'purple' }));
      const meta = { workspaces: [{ id: 'workspace-one', name: '报价工作区' }], projects, ledger: [{ id: 'paid-one', projectId: 'project-one', projectName: '项目一', action: '初次生成', model: '历史', costCents: 17, billingMode: 'live', costState: 'manual', status: 'complete', time: '2026-11-03' }], preferencesByWorkspace: {}, customPrompts: [], configuration: { categories: [], workflows: [], models: [], studioActions: [], useTemplates: [], connections: [] }, quoteDrafts: [{ workspaceId: 'workspace-one', projectId: 'project-one', saved, working: { type: 'xuzuo-quote-working', version: 1, workspaceId: 'workspace-one', projectId: 'project-one', inputs, mode: 'single', scope: 'live', customer, baseSaved: saved, baseSavedMatchesCurrent: true, updatedAt: '2026-11-03' } }, { workspaceId: 'workspace-one', projectId: 'project-two', saved: { ...saved, projectId: 'project-two' } }] };
      const archive = path.join(directory, 'quote.zip'); await source.backup.exportBackup({ meta, workspaceIds: ['workspace-one'], projectIds: ['project-one'], filePath: archive });
      const Zip = deps('jszip'), zip = await Zip.loadAsync(await fs.readFile(archive)), manifestEntry = Object.keys(zip.files).find(name => name.endsWith('manifest.json')), raw = await zip.file(manifestEntry).async('string'), manifest = JSON.parse(raw);
      expect(manifest.meta.quoteDrafts).toHaveLength(1); expect(raw).not.toContain('DO-NOT-INCLUDE-FAKE-SECRET'); expect(raw).not.toContain('baseSavedRaw');
      target = await profile(path.join(directory, 'target')); const destination = path.join(directory, 'restored'); await fs.mkdir(destination); const restored = await target.backup.importBackup({ filePath: archive, directory: destination }), record = restored.meta.quoteDrafts[0];
      expect(record.projectId).toBe(restored.idMap['project-one']); expect(record.workspaceId).toBe(restored.idMap['workspace-one']); expect(record.saved.projectId).toBe(record.projectId); expect(record.working.baseSaved.projectId).toBe(record.projectId); expect(record.saved.pendingCostEntryIds).toEqual([restored.idMap['paid-one']]); expect(restored.meta.ledger.reduce((sum, item) => sum + item.costCents, 0)).toBe(17);
    } finally { await source.engine.flush(); if (target) await target.engine.flush(); }
  });
});
