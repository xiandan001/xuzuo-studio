import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url)), deps = createRequire(path.join(root, 'work/ui-build/package.json'));
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs'), { createProjectBackup } = require('../../electron/project-backup.cjs'), { validateManifest } = require('../../electron/backup-format.cjs');
const time = '2026-11-04T04:00:00.000Z';
async function profile(directory) {
  await fs.mkdir(directory); const storage = createWorkspaceStorage({ directory }), artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage: storage, loadModule: deps }); storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
  return { storage, engine, backup: createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: deps }) };
}
const project = (id, extras = {}) => ({ id, workspaceId: 'workspace-one', name: id, kind: 'word', status: 'draft', description: 'PRIVATE-PROJECT-BODY', updatedAt: time, costCents: 0, version: 2, accent: 'purple', ...extras });
const meta = projects => ({ workspaces: [{ id: 'workspace-one', name: 'Owned审计备份', createdAt: time, description: '' }], projects, ledger: [], preferencesByWorkspace: {}, customPrompts: [], configuration: { categories: [], workflows: [], models: [], studioActions: [], useTemplates: [], connections: [] } });
const audit = id => ({ projectId: id, workspaceId: 'workspace-one', name: id, kind: 'word', purgedAt: time, trashedAt: time, costCents: 137, updatedAt: time, requestId: 'owned-purge-request' });
async function setup() {
  const directory = await fs.mkdtemp(path.join(root, 'work/project-purge-backup-')), source = await profile(path.join(directory, 'source')), workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace); await source.storage.bindRoot({ workspaceId: 'workspace-one', name: 'Owned审计备份', directory: workspace });
  return { directory, source, workspace };
}
async function readManifest(filename) { const zip = await deps('jszip').loadAsync(await fs.readFile(filename)); return { zip, manifest: JSON.parse(await zip.file('manifest.json').async('string')) }; }
async function paidRecord(source, id) {
  const owner = project(id), flow = { id: 'paid-flow', workspaceId: owner.workspaceId, name: 'Historical flow', outputKind: 'word', description: 'PRIVATE-OLD-FLOW', steps: [] };
  const fee = { id: 'paid-fee', projectId: id, projectName: id, action: '初次生成', model: 'Owned historical', costCents: 137, billingMode: 'live', costState: 'manual', status: 'complete', time, workflowRunId: 'paid-run' };
  await source.engine.importRecords([{ run: { id: 'paid-run', workspaceId: owner.workspaceId, projectId: id, workflowId: flow.id, workflowName: flow.name, snapshot: flow, status: 'complete', stepIndex: 0, attempts: [], variables: {}, input: 'PRIVATE-OLD-INPUT', createdAt: time, updatedAt: time }, request: { project: owner, workflow: flow, connections: [], models: [], attachmentIds: [] }, ledger: [fee] }]);
  return fee;
}

describe('永久移除只携带审计和账本的真实ZIP往返', () => {
  it('原生审计覆盖迟到active界面，保留本机旧文件却不打入ZIP，恢复新ID无目录且禁止同ID复活', async () => {
    const f = await setup(); let target;
    try {
      const old = await f.source.storage.ensureProject({ projectId: 'purged-one', workspaceId: 'workspace-one', name: 'purged-one' }), active = await f.source.storage.ensureProject({ projectId: 'active-one', workspaceId: 'workspace-one', name: 'active-one' });
      const hidden = path.join(old.directory, 'files/private.txt'); await fs.writeFile(hidden, 'MUST-NOT-ENTER-BACKUP'); await fs.writeFile(path.join(old.directory, '.xuzuo/editor-v1.json'), '{"private":"MUST-NOT-ENTER-BACKUP"}'); await fs.writeFile(path.join(active.directory, 'files/active.txt'), 'KEEP-ACTIVE-FILE');
      const fee = await paidRecord(f.source, 'purged-one'), before = await f.source.engine.snapshot();
      await f.source.storage.forgetProject({ projectId: 'purged-one', workspaceId: 'workspace-one', audit: audit('purged-one') });
      const archive = path.join(f.directory, 'audit.zip'); await f.source.backup.exportBackup({ meta: meta([project('purged-one', { directory: old.directory }), project('active-one')]), workspaceIds: ['workspace-one'], filePath: archive });
      const { zip, manifest } = await readManifest(archive), removed = manifest.meta.projects.find(item => item.id === 'purged-one');
      expect(manifest.version).toBe(3); expect(manifest.locations.projects.map(item => item.projectId)).toEqual(['active-one']); expect(removed).toMatchObject({ purgedAt: time, description: '', costCents: 137 });
      for (const field of ['directory', 'referenceFiles', 'confirmedDelivery']) expect(removed).not.toHaveProperty(field);
      expect(manifest.records).toEqual([]); expect(manifest.artifacts).toEqual([]); expect(manifest.meta.ledger).toEqual([fee]);
      expect(Object.keys(zip.files).some(name => name.includes(path.basename(old.directory)))).toBe(false); expect(JSON.stringify(manifest)).not.toContain('PRIVATE-OLD-INPUT'); expect(JSON.stringify(manifest)).not.toContain('PRIVATE-OLD-FLOW');
      expect(await fs.readFile(hidden, 'utf8')).toBe('MUST-NOT-ENTER-BACKUP'); expect((await f.source.engine.snapshot()).ledger).toEqual(before.ledger);
      target = await profile(path.join(f.directory, 'target')); const destination = path.join(f.directory, 'restored'); await fs.mkdir(destination);
      const restored = await target.backup.importBackup({ filePath: archive, directory: destination }), newId = restored.idMap['purged-one'], newWorkspace = restored.idMap['workspace-one'];
      const restoredAudit = restored.meta.projects.find(item => item.id === newId); expect(restoredAudit.purgedAt).toBe(time); expect(restoredAudit.directory).toBeUndefined(); expect(restored.locations.projects.some(item => item.projectId === newId)).toBe(false); expect(restored.meta.ledger[0]).toMatchObject({ id: restored.idMap['paid-fee'], projectId: newId, workflowRunId: restored.idMap['paid-run'], costCents: 137 });
      expect((await target.storage.listPurges()).find(item => item.projectId === newId)).toMatchObject({ workspaceId: newWorkspace, purgedAt: time, directories: [] });
      await expect(target.storage.ensureProject({ projectId: newId, workspaceId: newWorkspace, name: 'Never revive' })).rejects.toThrow('永久');
      const directoryEntries = await fs.readdir(restored.locations.workspaces[0].directory); expect(directoryEntries.some(name => name.includes('purged-one'))).toBe(false);
      const again = await target.backup.importBackup({ filePath: archive, directory: destination }); expect(again.idMap).toEqual(restored.idMap); expect(again.meta.ledger).toEqual(restored.meta.ledger);
      const secondArchive = path.join(f.directory, 'audit-restored.zip'); await target.backup.exportBackup({ meta: restored.meta, workspaceIds: [newWorkspace], filePath: secondArchive }); const second = (await readManifest(secondArchive)).manifest;
      expect(second.meta.projects.find(item => item.id === newId).purgedAt).toBe(time); expect(second.meta.ledger).toEqual(restored.meta.ledger); expect(second.locations.projects.some(item => item.projectId === newId)).toBe(false);
      const inspected = await target.backup.inspectBackup(secondArchive); expect(inspected.projects).toHaveLength(1); expect(inspected.projects.some(item => item.id === newId)).toBe(false);
    } finally { await f.source.engine.flush(); if (target) await target.engine.flush(); }
  });
  it('仅审计项目和外部已不存在的旧路径不需读取目录，也能保留账本创建/恢复备份', async () => {
    const f = await setup(); let target;
    try {
      await paidRecord(f.source, 'missing-one'); await f.source.storage.forgetProject({ projectId: 'missing-one', workspaceId: 'workspace-one', audit: { ...audit('missing-one'), directories: [path.join(f.workspace, 'never-present')] } });
      const archive = path.join(f.directory, 'missing.zip'); await f.source.backup.exportBackup({ meta: meta([]), workspaceIds: ['workspace-one'], filePath: archive });
      const { manifest } = await readManifest(archive); expect(manifest.locations.projects).toEqual([]); expect(manifest.meta.projects).toHaveLength(1); expect(manifest.meta.ledger[0].costCents).toBe(137);
      target = await profile(path.join(f.directory, 'target')); const destination = path.join(f.directory, 'restored'); await fs.mkdir(destination); const result = await target.backup.importBackup({ filePath: archive, directory: destination });
      expect(result.locations.projects).toEqual([]); expect(result.meta.ledger[0].costCents).toBe(137); expect((await fs.readdir(result.locations.workspaces[0].directory)).filter(name => name !== '.xuzuo-workspace-v1.json')).toEqual([]);
    } finally { await f.source.engine.flush(); if (target) await target.engine.flush(); }
  });
  it('审计中夹带目录/正文、恢复产物或可运行历史会在清单校验时拒绝', async () => {
    const f = await setup();
    try {
      await f.source.storage.forgetProject({ projectId: 'gone-one', workspaceId: 'workspace-one', audit: audit('gone-one') }); const archive = path.join(f.directory, 'clean.zip'); await f.source.backup.exportBackup({ meta: meta([]), workspaceIds: ['workspace-one'], filePath: archive }); const { manifest } = await readManifest(archive);
      for (const change of [value => { value.meta.projects[0].directory = 'D:/forbidden'; }, value => { value.meta.projects[0].description = 'OLD-CONTENT'; }, value => { value.locations.projects.push({ projectId: 'gone-one', workspaceId: 'workspace-one', directory: 'D:/forbidden' }); }, value => { value.artifacts.push({ id: 'old-image', projectId: 'gone-one' }); }, value => { value.records.push({ run: { id: 'old-run', projectId: 'gone-one', snapshot: { steps: [] }, attempts: [] }, ledger: [] }); }, value => { value.version = 2; }]) { const bad = structuredClone(manifest); change(bad); expect(() => validateManifest(bad)).toThrow(); }
      expect(validateManifest(manifest)).toBe(manifest);
    } finally { await f.source.engine.flush(); }
  });
  it('原路径后来登记新项目时只备份新身份，不把永久审计路径当作新的删除目标', async () => {
    const f = await setup();
    try {
      const old = await f.source.storage.ensureProject({ projectId: 'gone-one', workspaceId: 'workspace-one', name: 'old' });
      await f.source.storage.forgetProject({ projectId: 'gone-one', workspaceId: 'workspace-one', audit: audit('gone-one') });
      expect(path.relative(f.directory, old.directory).startsWith('..')).toBe(false); await fs.rename(old.directory, path.join(f.directory, 'external-retained-old'));
      await fs.mkdir(old.directory); const replacement = await f.source.storage.claimProjectFolder({ projectId: 'replacement-one', workspaceId: 'workspace-one', name: 'Replacement', directory: old.directory }); await fs.writeFile(path.join(replacement.directory, 'files/new.txt'), 'KEEP-NEW-IDENTITY');
      const archive = path.join(f.directory, 'replacement.zip'); await f.source.backup.exportBackup({ meta: meta([project('replacement-one')]), workspaceIds: ['workspace-one'], filePath: archive }); const { zip, manifest } = await readManifest(archive);
      expect(manifest.locations.projects.map(item => item.projectId)).toEqual(['replacement-one']); const file = Object.keys(zip.files).find(name => name.endsWith('/files/new.txt')); expect(await zip.file(file).async('string')).toBe('KEEP-NEW-IDENTITY'); expect(await fs.readFile(path.join(replacement.directory, 'files/new.txt'), 'utf8')).toBe('KEEP-NEW-IDENTITY');
    } finally { await f.source.engine.flush(); }
  });
});
