import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createBusinessStore } = require('../../electron/business-store.cjs');
const { createBusinessData } = require('../../electron/business-data.cjs');
const { dependencies } = require('./production-test-fixtures.cjs');
const core = require('../../electron/business-data.runtime.cjs');
const time = '2026-11-08T00:00:00Z', areas = [];
afterEach(async () => { for (const directory of areas.splice(0)) { if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-business-data-') || (await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('Not an owned business data fixture'); await fs.rm(directory, { recursive: true, force: true }); } });
function order() { return { id: 'order', name: '新品制作', recipe: 'merchant', sourceProjectId: 'project', brief: '', productIds: [], projectIds: ['project'], runIds: [], outputIds: [], includedRevisions: 1, status: 'draft', factsRevision: 1, facts: {}, outputKinds: ['image'], imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: time, updatedAt: time }; }
async function fixture() {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'xuzuo-business-data-')); areas.push(directory);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'registry') });
  const artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  const workspace = path.join(directory, 'workspace'), foreign = path.join(directory, 'foreign'); await fs.mkdir(workspace); await fs.mkdir(foreign);
  await storage.bindRoot({ workspaceId: 'workspace', name: '本地业务', directory: workspace });
  await storage.bindRoot({ workspaceId: 'other', name: '另一工作区', directory: foreign });
  await storage.ensureProject({ projectId: 'project', workspaceId: 'workspace', name: '原图' });
  await storage.ensureProject({ projectId: 'foreign-project', workspaceId: 'other', name: '其他原图' });
  const store = createBusinessStore({ workspaceStorage: storage, artifactStore: artifacts });
  const state = { ...core.newBusinessState('workspace'), orders: [order()] };
  return { directory, workspace, storage, artifacts, store, state, filename: path.join(workspace, '.xuzuo-business/state-v1.json') };
}
describe('native business CAS, scope and financial retention', () => {
  it('emits one small change notice per durable commit and never emits on failed CAS or reads', async () => {
    const f = await fixture(), onChanged = vi.fn(() => { throw Error('closed observer'); }), store = createBusinessStore({ workspaceStorage: f.storage, artifactStore: f.artifacts, onChanged });
    await store.snapshot('workspace'); expect(onChanged).not.toHaveBeenCalled();
    const saved = await store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    expect(onChanged).toHaveBeenCalledTimes(1); expect(onChanged).toHaveBeenLastCalledWith({ workspaceId: 'workspace', revision: 1 });
    await expect(store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state })).rejects.toMatchObject({ code: 'BUSINESS_CONFLICT' });
    expect(onChanged).toHaveBeenCalledTimes(1);
    await store.mutate('workspace', state => ({ ...state, orders: [{ ...saved.orders[0], name: '已更新' }] }));
    expect(onChanged).toHaveBeenCalledTimes(2); expect(onChanged).toHaveBeenLastCalledWith({ workspaceId: 'workspace', revision: 2 });
    expect((await store.snapshot('workspace')).revision).toBe(2);
  });
  it('serializes conflicting saves and uses fresh state for native mutation without overwriting another update', async () => {
    const f = await fixture(), first = structuredClone(f.state), second = structuredClone(f.state); first.orders[0].name = '第一份'; second.orders[0].name = '第二份';
    const results = await Promise.allSettled([f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: first }), f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: second })]);
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected']);
    const result = await f.store.mutate('workspace', state => ({ ...state, brands: [{ id: 'brand', name: '品牌', contact: '', colors: [], font: '', voice: '', forbiddenClaims: [], approvedSampleIds: [], updatedAt: time }] }));
    expect(result.revision).toBe(2); expect(result.orders[0].name).toBe('第一份'); expect(result.brands).toHaveLength(1);
  });
  it('rejects corruption, missing saved pointers and unsafe links without creating an empty replacement', async () => {
    const f = await fixture(); await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    const original = await fs.readFile(f.filename); await fs.writeFile(f.filename, Buffer.from([255, 254, 0, 123]));
    await expect(f.store.snapshot('workspace')).rejects.toThrow('无法安全读取');
    expect(await fs.readFile(f.filename)).toEqual(Buffer.from([255, 254, 0, 123]));
    await fs.writeFile(f.filename, original); await fs.unlink(f.filename);
    await expect(f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state })).rejects.toThrow('无法安全读取');
    await expect(fs.stat(f.filename)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('validates new source metadata in the same workspace without opening original image buffers', async () => {
    const f = await fixture(), { PNG } = dependencies('pngjs'), bytes = PNG.sync.write(new PNG({ width: 2, height: 2 }));
    const original = await f.artifacts.write({ projectId: 'project', name: 'cup.png', mimeType: 'image/png', buffer: bytes, preserveOriginalName: true });
    const foreign = await f.artifacts.write({ projectId: 'foreign-project', name: 'foreign.png', mimeType: 'image/png', buffer: bytes, preserveOriginalName: true });
    const read = vi.spyOn(f.artifacts, 'read');
    f.state.products.push({ id: 'product', sku: '001', name: '杯子', projectId: 'project', referenceArtifactIds: [original.id], facts: {}, updatedAt: time });
    const saved = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    expect(read).not.toHaveBeenCalled();
    saved.products[0].referenceArtifactIds = [foreign.id];
    await expect(f.store.save({ workspaceId: 'workspace', expectedRevision: saved.revision, state: saved })).rejects.toThrow('工作区');
    expect((await f.store.snapshot('workspace')).products[0].referenceArtifactIds).toEqual([original.id]);
  });
  it('never removes or rewrites old receipt amounts, native run bindings or validated delivery history', async () => {
    const f = await fixture(); f.state.orders[0].runIds = ['paid'];
    f.state.transactions.push({ id: 'sale', orderId: 'order', kind: 'receipt', amountCents: 10000, occurredAt: time, note: '' });
    let current = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    const changed = structuredClone(current); changed.transactions[0].amountCents = 1;
    await expect(f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: changed })).rejects.toThrow('改写');
    const removed = structuredClone(current); removed.orders[0].runIds = [];
    await expect(f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: removed })).rejects.toThrow('费用');
    current.transactions[0].voidedAt = time; current = await f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: current });
    expect(current.transactions[0].amountCents).toBe(10000);
    delete current.transactions[0].voidedAt;
    await expect(f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: current })).rejects.toThrow('恢复');
  });
  it('imports real CSV rows with exact photo names and commits source-less product drafts without charging a model', async () => {
    const f = await fixture(); let current = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    const filename = path.join(f.directory, 'products.csv'); await fs.writeFile(filename, '\uFEFF商品编号,商品名称,材质\n0001,杯子,陶瓷\n');
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [filename] })) }, service = createBusinessData({ workspaceStorage: f.storage, artifactStore: f.artifacts, store: f.store, dialog, loadModule: dependencies });
    const preview = await service.importPreview({ workspaceId: 'workspace', kind: 'products', projectId: 'project', orderId: 'order' });
    expect(preview.issues).toEqual([]); current = await service.importCommit({ workspaceId: 'workspace', expectedRevision: current.revision, token: preview.token });
    expect(current.products[0]).toMatchObject({ sku: '0001', facts: { material: '陶瓷' }, referenceArtifactIds: [] });
    await expect(service.importCommit({ workspaceId: 'workspace', expectedRevision: current.revision, token: preview.token })).rejects.toThrow('预览');
  });
  it('does not double count a repeated external transaction and blocks same-key altered values', async () => {
    const f = await fixture(); let current = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    const filename = path.join(f.directory, 'sales.csv'), original = '流水号,类型,金额,日期,来源\n001,收入,29.90,2026-11-08,店铺\n'; await fs.writeFile(filename, original);
    const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [filename] }) }, service = createBusinessData({ workspaceStorage: f.storage, artifactStore: f.artifacts, store: f.store, dialog, loadModule: dependencies });
    let preview = await service.importPreview({ workspaceId: 'workspace', kind: 'transactions', orderId: 'order' });
    current = await service.importCommit({ workspaceId: 'workspace', expectedRevision: current.revision, token: preview.token });
    preview = await service.importPreview({ workspaceId: 'workspace', kind: 'transactions', orderId: 'order' });
    expect(preview.duplicates).toBe(1); current = await service.importCommit({ workspaceId: 'workspace', expectedRevision: current.revision, token: preview.token }); expect(current.transactions).toHaveLength(1);
    await fs.writeFile(filename, original.replace('29.90', '30.00'));
    preview = await service.importPreview({ workspaceId: 'workspace', kind: 'transactions', orderId: 'order' });
    expect(preview.conflicts).toHaveLength(1);
    await expect(service.importCommit({ workspaceId: 'workspace', expectedRevision: current.revision, token: preview.token })).rejects.toThrow('不同');
    expect((await f.store.snapshot('workspace')).transactions[0].amountCents).toBe(2990);
  });
  it('invalidates semantic inputs exactly once but keeps paid results and permits contact or cash updates while active', async () => {
    const f = await fixture(); f.state.brands.push({ id: 'brand', name: '品牌', contact: '', colors: ['#FFFFFF'], font: '', voice: '', forbiddenClaims: [], approvedSampleIds: [], updatedAt: time });
    f.state.orders[0] = { ...f.state.orders[0], status: 'complete', brandId: 'brand', factsConfirmedAt: time, preparedHash: 'a'.repeat(64), runIds: ['paid'] };
    let current = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    current.brands[0].colors = ['#000000']; current.orders[0].factsRevision = 99;
    current = await f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: current });
    expect(current.orders[0]).toMatchObject({ factsRevision: 2, status: 'draft', runIds: ['paid'] }); expect(current.orders[0].preparedHash).toBeUndefined(); expect(current.orders[0].factsConfirmedAt).toBeUndefined();
    current = await f.store.mutate('workspace', value => { value.orders[0].status = 'running'; return value; });
    const style = structuredClone(current); style.brands[0].colors = ['#FFFFFF'];
    await expect(f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: style })).rejects.toThrow('执行');
    current.brands[0].contact = '新的业务电话'; current.transactions.push({ id: 'deposit', orderId: 'order', kind: 'receipt', amountCents: 100, occurredAt: time, note: '' });
    current = await f.store.save({ workspaceId: 'workspace', expectedRevision: current.revision, state: current }); expect(current.orders[0].factsRevision).toBe(2); expect(current.orders[0].status).toBe('running');
  });
  it('surfaces the first-sheet XLSX warning without treating a valid chosen sheet as an error', async () => {
    const f = await fixture(), current = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    const ExcelJS = dependencies('exceljs'), workbook = new ExcelJS.Workbook(); workbook.addWorksheet('商品').addRows([['SKU', '商品名称'], ['001', '杯子']]); workbook.addWorksheet('说明').addRow(['不会自动导入']);
    const filename = path.join(f.directory, 'products.xlsx'); await fs.writeFile(filename, Buffer.from(await workbook.xlsx.writeBuffer()));
    const service = createBusinessData({ workspaceStorage: f.storage, artifactStore: f.artifacts, store: f.store, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filename] }) }, loadModule: dependencies });
    const preview = await service.importPreview({ workspaceId: 'workspace', kind: 'products', projectId: 'project', orderId: 'order' });
    expect(preview.warnings.join(' ')).toContain('第一张'); expect(preview.issues).toEqual([]);
    const imported = await service.importCommit({ workspaceId: 'workspace', expectedRevision: current.revision, token: preview.token }); expect(imported.products).toHaveLength(1); expect(imported.orders[0].productIds).toEqual([imported.products[0].id]);
  });
  it('exports and reads back the in-memory recovery JSON while the workspace disk is unavailable, and never overwrites it', async () => {
    const f = await fixture(), current = await f.store.save({ workspaceId: 'workspace', expectedRevision: 0, state: f.state });
    const offline = path.join(f.directory, 'offline-workspace');
    if (!f.workspace.startsWith(f.directory + path.sep) || !offline.startsWith(f.directory + path.sep)) throw Error('Unowned workspace move');
    await fs.rename(f.workspace, offline);
    const filename = path.join(f.directory, 'recovery.json'), service = createBusinessData({ workspaceStorage: f.storage, artifactStore: f.artifacts, store: f.store, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: filename }) } });
    expect(await service.exportRecovery({ workspaceId: 'workspace', state: current })).toMatchObject({ saved: true });
    expect(JSON.parse(await fs.readFile(filename, 'utf8'))).toEqual(current); const bytes = await fs.readFile(filename);
    await expect(service.exportRecovery({ workspaceId: 'workspace', state: current })).rejects.toThrow('已存在'); expect(await fs.readFile(filename)).toEqual(bytes);
  });
});
