import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { fixture, word, PNG, dependencies } = require('./production-test-fixtures.cjs');
const { createDeliveryStore } = require('../../electron/delivery-store.cjs');
const active = []; afterEach(async () => { for (const f of active.splice(0)) await f.engine.shutdown(); });
async function exported(text) { const f = await fixture(); active.push(f); const location = await f.workspaceStorage.ensureProject({ projectId: 'delivery-project', workspaceId: 'production-workspace', name: '客户文稿' }); const result = await f.editorStore.export({ projectId: 'delivery-project', expectedRevision: 0, document: word(text) }); await f.engine.recordLocalExport({ projectId: 'delivery-project', workspaceId: 'production-workspace', name: '客户文稿', kind: 'word', sourceRevision: result.record.revision, artifacts: result.artifacts }); const file = result.artifacts.find(item => item.kind === 'office'); return { ...f, location, file, selection: { projectId: 'delivery-project', kind: 'word', artifactIds: [file.id], sourceRevision: 1, checks: [] } }; }
async function reviewed(store, selection) { const inspection = await store.inspect(selection); return store.saveReview({ ...selection, fingerprint: inspection.fingerprint, checkedIds: inspection.checks.filter(item => item.status === 'manual').map(item => item.id) }); }
describe('版本交付与客户ZIP', () => {
  it('确认绑定实际文件哈希/保存版本/验收时间；ZIP只含成品与客户清单，旧交付可追溯', async () => {
    const f = await exported(), store = createDeliveryStore(f); await f.artifactStore.write({ projectId: 'delivery-project', name: '原始参考.txt', mimeType: 'text/plain', text: 'PRIVATE_REFERENCE_DO_NOT_EXPORT' });
    const inspection = await reviewed(store, f.selection); expect(inspection.ready).toBe(true); const receipt = await store.confirm({ ...f.selection, fingerprint: inspection.fingerprint }); expect(receipt.revision).toBe('editor:1'); expect(receipt.files[0].sha256).toMatch(/^[a-f0-9]{64}$/); expect(receipt.confirmedAt).toBeTruthy();
    expect((await store.confirm({ ...f.selection, fingerprint: inspection.fingerprint })).id).toBe(receipt.id);
    const destination = path.join(f.directory, '客户成品.zip'); await store.exportZip({ projectId: 'delivery-project', deliveryId: receipt.id, destination }); const zip = await dependencies('jszip').loadAsync(await fs.readFile(destination));
    expect(Object.keys(zip.files)).toHaveLength(2); expect(Object.keys(zip.files).every(name => !name.includes('/') && !name.includes('..'))).toBe(true);
    const manifest = JSON.parse(await zip.file('交付说明.json').async('string')); expect(manifest.files[0].sha256).toBe(receipt.files[0].sha256); expect(await zip.file(manifest.files[0].name).async('nodebuffer')).toEqual((await f.artifactStore.read(f.file.id)).buffer); expect(JSON.stringify(manifest)).not.toMatch(/credential|prompt|ledger|PRIVATE_REFERENCE/);
    await f.editorStore.save({ projectId: 'delivery-project', expectedRevision: 1, document: word('更新后的已保存正文') }); const changed = await store.inspect({ ...f.selection, sourceRevision: 2 }); expect(changed.currentReceipt).toBeUndefined(); expect(changed.ready).toBe(false); expect((await store.history({ projectId: 'delivery-project' }))[0].id).toBe(receipt.id);
  });
  it('UI宣称passed不能越过后端占位/实际版本检查', async () => {
    const f = await exported('TODO 请填写客户资料'), store = createDeliveryStore(f); const selection = { ...f.selection, checks: [{ id: 'placeholders', label: '客户端宣称通过', detail: '', status: 'passed' }] }; const checked = await reviewed(store, selection); expect(checked.checks.find(item => item.id === 'placeholders').status).toBe('failed'); expect(checked.ready).toBe(false); await expect(store.confirm({ ...selection, fingerprint: checked.fingerprint })).rejects.toThrow('尚未完成');
  });
  it('验收持久化失败不显示已保存、不允许确认交付', async () => {
    const f = await exported(); const broken = createDeliveryStore({ ...f, fileSystem: { ...fs, rename: async (source, target) => { if (target.endsWith('deliveries-v1.json')) throw new Error('owned review persistence failure'); return fs.rename(source, target); } } }); const inspection = await broken.inspect(f.selection);
    await expect(broken.saveReview({ ...f.selection, fingerprint: inspection.fingerprint, checkedIds: ['facts', 'layout', 'rights'] })).rejects.toThrow(); expect((await broken.inspect(f.selection)).ready).toBe(false); expect(await broken.history({ projectId: 'delivery-project' })).toEqual([]);
  });
  it('坏结构的交付记录明确拒绝读取，不把异常记录交给界面或覆盖原文件', async () => {
    const f = await exported(), store = createDeliveryStore(f), filename = path.join(f.location.directory, '.xuzuo/deliveries-v1.json'), raw = JSON.stringify({ version: 1, projectId: 'delivery-project', reviews: {}, receipts: [null] });
    await fs.writeFile(filename, raw); await expect(store.history({ projectId: 'delivery-project' })).rejects.toThrow('无法读取'); expect(await fs.readFile(filename, 'utf8')).toBe(raw);
  });
  it('确认后文件字节改变使旧fingerprint失效，ZIP不装入已变化文件', async () => {
    const f = await exported(), store = createDeliveryStore(f), inspected = await reviewed(store, f.selection), receipt = await store.confirm({ ...f.selection, fingerprint: inspected.fingerprint }); await fs.appendFile(f.file.path, 'OWNED_BYTES_CHANGED');
    await expect(store.confirm({ ...f.selection, fingerprint: inspected.fingerprint })).rejects.toThrow(/改变|变化/); await expect(store.exportZip({ projectId: 'delivery-project', deliveryId: receipt.id, destination: path.join(f.directory, 'changed.zip') })).rejects.toThrow(/改变|变化/);
  });
  it('图片仅接受成功生成/编辑产物，不能把参考原图或假的透明检查混入交付', async () => {
    const f = await fixture(); active.push(f); await f.workspaceStorage.ensureProject({ projectId: 'image-project', workspaceId: 'production-workspace', name: '图片' });
    const reference = await f.artifactStore.write({ projectId: 'image-project', name: '参考.png', mimeType: 'image/png', buffer: PNG }), result = await f.artifactStore.write({ projectId: 'image-project', runId: 'image-run', name: '成品.png', mimeType: 'image/png', buffer: PNG });
    const run = { id: 'image-run', mode: 'live', projectId: 'image-project', snapshot: { steps: [{ id: 'generate', kind: 'image-generation', imageSize: 'auto', imageBackground: 'transparent' }] }, attempts: [{ id: 'image-attempt', stepId: 'generate', status: 'complete', artifacts: [result] }] };
    const store = createDeliveryStore({ ...f, liveEngine: { snapshot: async () => ({ runs: [run], ledger: [] }) }, inspectImage: async () => ({ width: 1, height: 1, transparency: 'opaque' }) });
    const original = await store.inspect({ projectId: 'image-project', kind: 'image', artifactIds: [reference.id], checks: [] }); expect(original.errors.join('')).toContain('原图');
    const selected = { projectId: 'image-project', kind: 'image', artifactIds: [result.id], checks: [{ id: 'alpha', label: 'UI称透明', detail: '', status: 'passed' }] }; const checked = await reviewed(store, selected); expect(checked.ready).toBe(false); expect(checked.checks.some(item => item.id.startsWith('alpha-') && item.status === 'failed')).toBe(true);
  });
});
