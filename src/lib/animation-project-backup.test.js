import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture } = require('./animation-integration-fixtures.cjs'), { dependencies } = require('./production-test-fixtures.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs'), { createAnimationStore } = require('../../electron/animation-store.cjs');
const { createAnimationJournal } = require('../../electron/animation-journal.cjs');
const Zip = dependencies('jszip'), owned = [], stamp = '2026-11-08T07:00:00.000Z', secret = 'SYNTHETIC_SECRET_MUST_NOT_BE_EXPORTED';
const hash = value => createHash('sha256').update(value).digest('hex');
async function setup() { const f = await fixture(); f.backup = createProjectBackup({ directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, loadModule: dependencies }); owned.push(f); return f; }
afterEach(async () => { for (const f of owned.splice(0).reverse()) { await f.backup.flush(); await f.close(); } });

async function metadata(f, extras = []) {
  const snapshot = await f.engine.snapshot(), locations = await f.workspaceStorage.list();
  return { workspaces: [{ id: f.project.workspaceId, name: '动画备份合成验收', createdAt: stamp }], projects: [f.project, ...extras].map(project => ({ ...project, costCents: snapshot.ledger.filter(row => row.projectId === project.id).reduce((sum, row) => sum + row.costCents, 0), directory: locations.projects.find(row => row.projectId === project.id).directory })), ledger: snapshot.ledger, customPrompts: [], preferencesByWorkspace: {}, apiKey: secret, configuration: { version: 1, connections: f.context.connections, models: f.context.models, workflows: [], categories: [], studioActions: [], useTemplates: [], credentials: [{ secret }] } };
}

async function originalProject(f) {
  await f.service.generate(f.input); const first = await f.completed(); expect(first.job.status).toBe('complete');
  await f.store.mutate(f.project.id, document => { document.entries[0].caption = '第二版角色文案'; return document; });
  const result = await f.service.compose(f.input); expect(result.job.status).toBe('complete'); expect(result.document.entries[0].inspection).toBeTruthy();
  const sourceId = result.document.entries[0].frames[0].atlasArtifactId, run = (await f.engine.snapshot()).runs[0];
  await f.journal.mutate(f.project.id, state => { state.jobs.push({ id: 'pending-backup-job', projectId: f.project.id, kind: 'generate', request: { projectId: f.project.id, entryIds: [result.document.entries[0].id] }, status: 'running', stage: 'generating', entryIds: [result.document.entries[0].id], completedEntryIds: [], runIds: [run.id], operations: [{ entryId: result.document.entries[0].id, entryIds: [result.document.entries[0].id], sourceHash: 'a'.repeat(64), dispatchKey: 'b'.repeat(64), runId: run.id, artifactId: sourceId, status: 'running' }], createdAt: stamp, updatedAt: stamp }); return state; });
  await fs.writeFile(path.join(f.workspace, 'credentials-v1.json'), JSON.stringify({ apiKey: secret }));
  return result.document;
}

async function archive(f, extras = []) { const filePath = path.join(f.directory, 'animation-complete-backup.zip'); await f.backup.exportBackup({ meta: await metadata(f, extras), workspaceIds: [f.project.workspaceId], filePath }); return { filePath, zip: await Zip.loadAsync(await fs.readFile(filePath), { checkCRC32: true, createFolders: false }) }; }

describe('动画工程完整项目备份恢复（真实FS/原生引擎账本，模型及编码替身）', () => {
  it('PNG、主工程、独立历史、检查与任务日志整体恢复到新项目，重写哈希且本地合成不改旧费用', async () => {
    const source = await setup(), original = await originalProject(source), ledger = structuredClone((await source.engine.snapshot()).ledger), sourceFile = await source.artifactStore.read(original.entries[0].frames[0].atlasArtifactId), sourceDirectory = await source.workspaceStorage.projectDirectory(source.project.id), sourceBytes = await fs.readFile(path.join(sourceDirectory, '.xuzuo/animation-v1.json'));
    expect(ledger).toHaveLength(1); expect(ledger[0].costCents).toBeGreaterThan(0); expect(original.entries[0].sourceHash).toMatch(/^[a-f0-9]{64}$/); expect(original.entries[0].renderedHash).toMatch(/^[a-f0-9]{64}$/); expect((await source.store.history(source.input)).length).toBeGreaterThanOrEqual(2);
    const exported = await archive(source), manifest = JSON.parse(await exported.zip.file('manifest.json').async('string')); expect(manifest.secretsIncluded).toBe(false); expect(JSON.stringify(manifest)).not.toContain(secret); expect(Object.keys(exported.zip.files).some(name => /(?:^|\/)credentials-v1\.json$/.test(name))).toBe(false);
    const target = await setup(), destination = path.join(target.directory, '恢复位置'); await fs.mkdir(destination); const imported = await target.backup.importBackup({ filePath: exported.filePath, directory: destination }), projectId = imported.idMap[source.project.id], workspaceId = imported.idMap[source.project.workspaceId]; expect(projectId).not.toBe(source.project.id); expect(workspaceId).not.toBe(source.project.workspaceId);
    const restoredDirectory = await target.workspaceStorage.projectDirectory(projectId); expect(restoredDirectory.startsWith(destination + path.sep)).toBe(true); const restoredStore = createAnimationStore({ workspaceStorage: target.workspaceStorage }), document = await restoredStore.read({ projectId });
    expect(document.projectId).toBe(projectId); expect(document.credentialId).toBe(original.credentialId); expect(document.credentialId).toBe('metadata-only'); expect(document.entries[0].id).toBe(original.entries[0].id); expect(document.entries[0].frames.map(frame => frame.id)).toEqual(original.entries[0].frames.map(frame => frame.id));
    const mappedSource = imported.idMap[sourceFile.id]; expect(document.entries[0].frames[0].atlasArtifactId).toBe(mappedSource); const restoredSource = await target.artifactStore.read(mappedSource); expect(restoredSource.projectId).toBe(projectId); expect(restoredSource.buffer).toEqual(sourceFile.buffer); expect(hash(restoredSource.buffer)).toBe(hash(sourceFile.buffer));
    expect(document.entries[0].status).toBe('stale'); for (const field of ['sourceHash', 'renderedHash', 'inspection']) expect(document.entries[0][field]).toBeUndefined(); expect(JSON.stringify(document)).not.toContain(secret);
    const historyDirectory = path.join(restoredDirectory, '.xuzuo/animation-revisions-v1'), index = JSON.parse(await fs.readFile(path.join(historyDirectory, 'index-v1.json'), 'utf8'));
    expect(index.projectId).toBe(projectId); expect(index.entries.length).toBeGreaterThanOrEqual(2);
    for (const item of index.entries) { const raw = await fs.readFile(path.join(historyDirectory, item.fileName), 'utf8'), snapshot = JSON.parse(raw); expect(snapshot.projectId).toBe(projectId); expect(snapshot.record.document.projectId).toBe(projectId); expect(item.fileName).toBe(`revision-${item.revision}-${item.hash}.json`); expect(snapshot.hash).toBe(item.hash); expect(hash(JSON.stringify(snapshot.record))).toBe(item.hash); expect(snapshot.record.document.entries[0].id).toBe(original.entries[0].id); }
    const history = await restoredStore.history({ projectId }); expect(history.length).toBeGreaterThanOrEqual(2); expect(history[0].revision).toBe(document.revision);
    const journal = createAnimationJournal({ workspaceStorage: target.workspaceStorage }), restoredJobs = await journal.read(projectId); expect(restoredJobs.jobs.some(job => job.status === 'running')).toBe(false); expect(restoredJobs.jobs.every(job => job.requiresExplicitRestart)).toBe(true); const pending = restoredJobs.jobs.find(job => job.id === 'pending-backup-job'); expect(pending.status).toBe('interrupted'); expect(pending.request.projectId).toBe(projectId); expect(pending.operations[0]).toMatchObject({ status: 'unknown', artifactId: mappedSource, runId: imported.idMap[ledger[0].workflowRunId] });
    const restoredLedger = structuredClone((await target.engine.snapshot()).ledger); expect(restoredLedger).toHaveLength(1); expect(restoredLedger[0].costCents).toBe(ledger[0].costCents); expect(restoredLedger[0].projectId).toBe(projectId);
    const composed = await target.service.compose({ projectId }); expect(composed.job.status).toBe('complete'); expect(target.calls).toHaveLength(0); expect((await target.engine.snapshot()).ledger).toEqual(restoredLedger); expect((await target.artifactStore.read(composed.document.entries[0].outputArtifactId)).mimeType).toBe('image/gif');
    const recoverable = history.find(item => item.revision > 1 && item.revision < document.revision) || history[0]; const restoredAgain = await restoredStore.restore({ projectId, versionId: recoverable.id, expectedRevision: composed.document.revision }); expect(restoredAgain.revision).toBeGreaterThan(composed.document.revision); expect((await target.engine.snapshot()).ledger).toEqual(restoredLedger); expect(await fs.readFile(path.join(sourceDirectory, '.xuzuo/animation-v1.json'))).toEqual(sourceBytes); expect((await source.engine.snapshot()).ledger).toEqual(ledger);
    await Promise.all([restoredStore.drain(), journal.drain()]);
  }, 30000);

  it.each(['main', 'revision'])('外项目动画%s即使外层清单和内部SHA都匹配，也不能放在另一项目目录冒充其工程', async kind => {
    const source = await setup(); await originalProject(source); const foreign = { ...source.project, id: 'foreign-project', name: '已登记的另一个项目' }; await source.workspaceStorage.ensureProject({ projectId: foreign.id, workspaceId: foreign.workspaceId, name: foreign.name }); const foreignDraft = await source.store.read({ projectId: foreign.id }); await source.store.save({ projectId: foreign.id, expectedRevision: 0, document: { ...foreignDraft, prompt: '只属于外项目的工程内容' } });
    const exported = await archive(source, [foreign]), manifest = JSON.parse(await exported.zip.file('manifest.json').async('string'));
    const projectPath = id => { const location = manifest.locations.projects.find(row => row.projectId === id), workspace = manifest.locations.workspaces.find(row => row.workspaceId === location.workspaceId); return `workspaces/${workspace.workspaceId}/${path.relative(workspace.directory, location.directory).split(path.sep).join('/')}/.xuzuo/`; }, ownedPrefix = projectPath(source.project.id), foreignPrefix = projectPath(foreign.id);
    expect(exported.zip.file(ownedPrefix + 'animation-v1.json')).not.toBeNull();
    const replace = (relative, bytes, oldRelative = relative) => { const entry = manifest.files.find(file => file.path === oldRelative); expect(entry).toBeTruthy(); if (relative !== oldRelative) exported.zip.remove(oldRelative); exported.zip.file(relative, bytes, { createFolders: false }); Object.assign(entry, { path: relative, bytes: bytes.length, sha256: hash(bytes) }); };
    if (kind === 'main') { const bytes = await exported.zip.file(foreignPrefix + 'animation-v1.json').async('nodebuffer'); replace(ownedPrefix + 'animation-v1.json', bytes); }
    else {
      const foreignRevision = manifest.files.find(file => file.path.startsWith(foreignPrefix + 'animation-revisions-v1/revision-')), sourceRevision = manifest.files.find(file => file.path.startsWith(ownedPrefix + 'animation-revisions-v1/revision-1-')), bytes = await exported.zip.file(foreignRevision.path).async('nodebuffer'), snapshot = JSON.parse(bytes), newName = `revision-${snapshot.record.revision}-${snapshot.hash}.json`;
      replace(ownedPrefix + 'animation-revisions-v1/' + newName, bytes, sourceRevision.path);
      const indexPath = ownedPrefix + 'animation-revisions-v1/index-v1.json', index = JSON.parse(await exported.zip.file(indexPath).async('string')), row = index.entries.find(item => item.revision === snapshot.record.revision); row.fileName = newName; row.hash = snapshot.hash; replace(indexPath, Buffer.from(JSON.stringify(index) + '\n'));
      expect(hash(JSON.stringify(snapshot.record))).toBe(snapshot.hash); expect(snapshot.projectId).toBe(foreign.id);
    }
    exported.zip.file('manifest.json', JSON.stringify(manifest) + '\n', { createFolders: false }); const malformed = path.join(source.directory, `malicious-${kind}.zip`); await fs.writeFile(malformed, await exported.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const target = await setup(), before = await target.workspaceStorage.list(), destination = path.join(target.directory, '拒绝后的空位置'); await fs.mkdir(destination); await expect(target.backup.importBackup({ filePath: malformed, directory: destination })).rejects.toThrow('角色动画保存记录无效'); expect(await target.workspaceStorage.list()).toEqual(before); expect(await fs.readdir(destination)).toEqual([]); expect(target.calls).toHaveLength(0); expect((await target.engine.snapshot()).ledger).toEqual([]);
  }, 30000);
});
