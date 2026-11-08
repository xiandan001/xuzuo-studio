import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs'), { createProjectBackup } = require('../../electron/project-backup.cjs');
const { createBusinessStore } = require('../../electron/business-store.cjs'), { createCommerceImageStore } = require('../../electron/commerce-image-store.cjs');
const core = require('../../electron/business-data.runtime.cjs');
const stamp = '2026-11-08T00:00:00Z', directories = [], profiles = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => { for (const value of profiles.splice(0)) { await value.engine.shutdown(); await value.artifacts.drain(); } for (const directory of directories.splice(0)) { if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-business-backup-')) throw Error('Not an owned backup fixture'); await fs.rm(directory, { recursive: true, force: true }); } });
async function profile(directory) {
  await fs.mkdir(directory);
  const storage = createWorkspaceStorage({ directory }), artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
  const value = { storage, artifacts, engine, business: createBusinessStore({ workspaceStorage: storage, artifactStore: artifacts }), layers: createCommerceImageStore({ workspaceStorage: storage }), backup: createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: dependencies }) }; profiles.push(value); return value;
}
function order(projectId = 'project') { return { id: 'order', name: '完整制作单', recipe: 'merchant', sourceProjectId: projectId, brief: '', productIds: ['product'], projectIds: [projectId], runIds: ['paid-run'], outputIds: [], includedRevisions: 1, status: 'paused', factsRevision: 1, facts: { id: 'order', 商品编号: 'project' }, outputKinds: ['image'], imageCount: 1, sizes: [], tasks: [{ id: 'task', label: '样稿', kind: 'image', productId: 'product', projectId, runId: 'paid-run', status: 'running', artifactIds: [], factsRevision: 1, dispatchKey: 'b'.repeat(64), inputHash: 'c'.repeat(64) }], bindings: { text: { modelConfigId: 'model', credentialId: 'do-not-export' } }, createdAt: stamp, updatedAt: stamp }; }
describe('real business and commerce file backup recovery', () => {
  it('rebinds only trusted business-assist description markers and preserves ordinary customer prose and request identity', () => {
    const { remapBusinessAssistMarkers } = require('../../electron/business-backup.cjs');
    const marker = JSON.stringify({ type: 'xuzuo-business-assist', workspaceId: 'old-workspace', orderId: 'old-order', purpose: 'listing', requestId: 'original-request' });
    const records = [{ run: { purpose: 'business-assist', snapshot: { description: marker } }, request: { workflow: { description: marker } } }, { run: { snapshot: { description: marker } } }, { run: { purpose: 'business-assist', snapshot: { description: '客户希望保留old-workspace old-order文字' } } }];
    const restored = remapBusinessAssistMarkers(records, { 'old-workspace': 'new-workspace', 'old-order': 'new-order', 'original-request': 'must-not-change-request' });
    expect(JSON.parse(restored[0].run.snapshot.description)).toMatchObject({ workspaceId: 'new-workspace', orderId: 'new-order', requestId: 'original-request' });
    expect(restored[0].request.workflow.description).toBe(restored[0].run.snapshot.description);
    const expectedWorkflow = 'bizassist-' + digest(Buffer.from('new-order')).slice(0, 24) + '-original-request';
    expect(restored[0].run.workflowId).toBe(expectedWorkflow); expect(restored[0].run.snapshot.id).toBe(expectedWorkflow); expect(restored[0].request.workflow.id).toBe(expectedWorkflow);
    expect(restored[1].run.snapshot.description).toBe(marker); expect(restored[2].run.snapshot.description).toBe(records[2].run.snapshot.description); expect(records[0].run.snapshot.description).toBe(marker);
  });
  it('recovers accepted dispatch identities from the backup and preserves an unresolved submission marker', () => {
    const { businessAfterRestore } = require('../../electron/business-backup.cjs'), state = core.newBusinessState('workspace');
    state.orders.push({ ...order(), productIds: [], runIds: [], tasks: [
      { id: 'known-task', label: '已受理', kind: 'image', projectId: 'project', status: 'running', artifactIds: [], factsRevision: 1, submittedAt: stamp, dispatchKey: 'a'.repeat(64) },
      { id: 'unknown-task', label: '未知', kind: 'image', projectId: 'project', status: 'running', artifactIds: [], factsRevision: 1, submittedAt: stamp, dispatchKey: 'b'.repeat(64) },
    ] });
    const restored = businessAfterRestore(state, [{ id: 'accepted', projectId: 'project', dispatchKey: 'a'.repeat(64) }]);
    expect(restored.orders[0].runIds).toEqual(['accepted']); expect(restored.orders[0].tasks[0]).toMatchObject({ runId: 'accepted', status: 'stale' }); expect(restored.orders[0].tasks[0].submittedAt).toBeUndefined();
    expect(restored.orders[0].tasks[1].submittedAt).toBe(stamp); expect(restored.orders[0].tasks[1].dispatchKey).toBeUndefined();
    expect(restored.orders[0].status).toBe('paused'); expect(state.orders[0].tasks[0].dispatchKey).toBe('a'.repeat(64));
  });
  it('remaps business relations, keeps cash and fees, restores image history directories and requires fresh export proof', async () => {
    const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'xuzuo-business-backup-')); directories.push(directory);
    const source = await profile(path.join(directory, 'source')), workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
    await source.storage.bindRoot({ workspaceId: 'workspace', name: '商家资料', directory: workspace }); const location = await source.storage.ensureProject({ projectId: 'project', workspaceId: 'workspace', name: '原图项目' });
    const { PNG } = dependencies('pngjs'), bytes = PNG.sync.write(new PNG({ width: 8, height: 8 }));
    const original = await source.artifacts.write({ projectId: 'project', name: 'original.png', mimeType: 'image/png', buffer: bytes });
    const artifact = await source.artifacts.write({ projectId: 'project', name: 'edited.png', runId: 'paid-run', mimeType: 'image/png', buffer: bytes });
    const document = { type: 'xuzuo-commerce-image', version: 1, id: source.layers.scope({ projectId: 'project', sourceArtifactId: original.id }).documentId, projectId: 'project', sourceArtifactId: original.id, sourceSha256: digest(bytes), revision: 0, title: '实物图层', width: 8, height: 8, background: '#FFFFFF', layers: [{ id: 'image-layer', name: '商品', x: 0, y: 0, width: 8, height: 8, visible: true, locked: true, opacity: 1, type: 'image', role: 'product', artifactId: original.id }], updatedAt: stamp };
    const savedDocument = await source.layers.save({ projectId: 'project', sourceArtifactId: original.id, expectedRevision: 0, document });
    const commerce = path.join(location.directory, '.xuzuo/commerce-images'), exportsDirectory = path.join(commerce, 'exports'); await fs.mkdir(exportsDirectory, { recursive: true });
    const snapshot = await source.artifacts.write({ projectId: 'project', runId: 'paid-run', name: 'layers.json', mimeType: 'application/json', text: JSON.stringify(savedDocument) });
    await fs.writeFile(path.join(exportsDirectory, artifact.id + '.json'), JSON.stringify({ version: 1, projectId: 'project', artifactId: artifact.id, snapshotId: snapshot.id, workingDocumentId: document.id }));
    const project = { id: 'project', workspaceId: 'workspace', name: '原图项目', kind: 'image', status: 'paused', description: '', updatedAt: stamp, costCents: 17, version: 1, accent: 'blue' };
    const workflow = { id: 'workflow', workspaceId: 'workspace', name: '历史制作', outputKind: 'image', steps: [{ id: 'step', kind: 'image-generation', enabled: true, prompt: '历史' }] }, attempt = { id: 'attempt', stepId: 'step', status: 'complete', artifacts: [artifact], summary: '已有结果', costCents: 17 };
    const run = { id: 'paid-run', workspaceId: 'workspace', projectId: 'project', workflowId: 'workflow', status: 'paused', snapshot: workflow, attempts: [attempt], createdAt: stamp, updatedAt: stamp };
    const ledger = [{ id: 'paid', projectId: 'project', projectName: '原图项目', workflowRunId: 'paid-run', workflowAttemptId: 'attempt', action: '初次生成', model: '历史', costCents: 17, billingMode: 'live', costState: 'manual', status: 'complete', time: stamp }];
    await source.engine.importRecords([{ run, request: { project, workflow, connections: [], models: [] }, ledger }]);
    const state = core.newBusinessState('workspace'); state.products.push({ id: 'product', sku: '00001', name: '杯子', projectId: 'project', referenceArtifactIds: [original.id], facts: { id: 'order', material: '陶瓷' }, updatedAt: stamp }); state.orders.push(order());
    state.transactions.push({ id: 'sale', orderId: 'order', productId: 'product', kind: 'receipt', amountCents: 9900, occurredAt: stamp, note: '', source: '店铺', externalId: '000012' });
    await source.business.save({ workspaceId: 'workspace', expectedRevision: 0, state });
    const meta = { workspaces: [{ id: 'workspace', name: '商家资料', createdAt: stamp }], projects: [project], ledger, customPrompts: [], preferencesByWorkspace: {}, configuration: { connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] } }, archive = path.join(directory, 'full.zip');
    await source.backup.exportBackup({ meta, workspaceIds: ['workspace'], filePath: archive });
    const target = await profile(path.join(directory, 'target')), destination = path.join(directory, 'restore'); await fs.mkdir(destination);
    const result = await target.backup.importBackup({ filePath: archive, directory: destination }), restored = await target.business.snapshot(result.idMap.workspace);
    expect(restored.orders[0]).toMatchObject({ id: result.idMap.order, sourceProjectId: result.idMap.project, productIds: [result.idMap.product], runIds: [result.idMap['paid-run']], status: 'paused' });
    expect(restored.orders[0].tasks[0].dispatchKey).toBeUndefined(); expect(restored.orders[0].tasks[0].inputHash).toBeUndefined(); expect(restored.orders[0].bindings.text.credentialId).toBeUndefined();
    expect(restored.products[0].referenceArtifactIds).toEqual([result.idMap[original.id]]); expect(restored.products[0].sku).toBe('00001'); expect(restored.products[0].facts.id).toBe('order'); expect(restored.orders[0].facts.id).toBe('order');
    expect(restored.transactions[0]).toMatchObject({ id: result.idMap.sale, orderId: result.idMap.order, productId: result.idMap.product, externalId: '000012', amountCents: 9900 });
    expect((await target.engine.snapshot()).ledger[0].costCents).toBe(17);
    const reloaded = await target.layers.read({ projectId: result.idMap.project, sourceArtifactId: result.idMap[original.id] });
    expect(reloaded.id).toBe(result.idMap[document.id]); expect(reloaded.layers[0].artifactId).toBe(result.idMap[original.id]);
    const history = await target.layers.history({ projectId: result.idMap.project, sourceArtifactId: result.idMap[original.id] }); expect(history).toHaveLength(1);
    const restoredProject = await target.storage.projectDirectory(result.idMap.project);
    const proof = JSON.parse(await fs.readFile(path.join(restoredProject, '.xuzuo/commerce-images/exports', result.idMap[artifact.id] + '.json'), 'utf8'));
    expect(proof).toMatchObject({ artifactId: result.idMap[artifact.id], snapshotId: result.idMap[snapshot.id], workingDocumentId: result.idMap[document.id], requiresReexport: true });
    const { createCommerceImages } = require('../../electron/commerce-images.cjs'), { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
    const cpu = createCpuTasks(), images = createCommerceImages({ workspaceStorage: target.storage, artifactStore: target.artifacts, cpuTasks: cpu, store: target.layers });
    const reopened = await images.read({ projectId: result.idMap.project, sourceArtifactId: result.idMap[artifact.id] });
    expect(reopened.document.projectId).toBe(result.idMap.project); expect(reopened.document.layers[0].artifactId).toBe(result.idMap[original.id]);
    const savedSnapshot = await target.artifacts.read(result.idMap[snapshot.id]);
    expect(JSON.parse(savedSnapshot.buffer.toString('utf8')).projectId).toBe(result.idMap.project);
    const snapshotMetadata = (await target.artifacts.backupEntries([result.idMap.project])).find(row => row.id === result.idMap[snapshot.id]);
    expect(savedSnapshot.bytes).toBe(savedSnapshot.buffer.length); expect(digest(savedSnapshot.buffer)).toBe(snapshotMetadata.sha256);
    expect((await target.artifacts.read(result.idMap[artifact.id])).buffer).toEqual(bytes);
    await images.shutdown(); await cpu.drain();
  });
  it('rejects project-only backups of half a multi-project order rather than restoring income with missing cost context', async () => {
    const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'xuzuo-business-backup-')); directories.push(directory);
    const source = await profile(path.join(directory, 'source')), workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
    await source.storage.bindRoot({ workspaceId: 'workspace', name: '商家', directory: workspace });
    for (const id of ['project', 'child']) await source.storage.ensureProject({ projectId: id, workspaceId: 'workspace', name: id });
    const state = core.newBusinessState('workspace'); state.orders.push({ ...order(), productIds: [], projectIds: ['project', 'child'], runIds: [], tasks: [] });
    await source.business.save({ workspaceId: 'workspace', expectedRevision: 0, state });
    const meta = { workspaces: [{ id: 'workspace', name: '商家', createdAt: stamp }], projects: ['project', 'child'].map(id => ({ id, workspaceId: 'workspace', name: id, kind: 'image', status: 'draft', description: '', updatedAt: stamp, costCents: 0, version: 0, accent: 'blue' })), ledger: [], customPrompts: [], preferencesByWorkspace: {}, configuration: { connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] } };
    await expect(source.backup.exportBackup({ meta, workspaceIds: ['workspace'], projectIds: ['project'], filePath: path.join(directory, 'partial.zip') })).rejects.toThrow('全部项目');
    expect((await source.business.snapshot('workspace')).orders[0].projectIds).toEqual(['project', 'child']);
  });
});
