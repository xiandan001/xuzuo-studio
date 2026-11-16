import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { fixture, word, PNG } = require('./production-test-fixtures.cjs');
const { createProjectTemplates } = require('../../electron/project-templates.cjs');
const roots = []; afterEach(async () => { for (const root of roots.splice(0)) { if (!path.isAbsolute(root) || !path.basename(root).startsWith('xuzuo-production-')) throw Error('Unowned test directory'); await fs.rm(root, { recursive: true, force: true }); } });
async function setup(extra = {}) { const f = await fixture(); roots.push(f.directory); for (const id of ['source', 'target', 'other']) await f.workspaceStorage.ensureProject({ projectId: id, workspaceId: 'production-workspace', name: id }); const options = { directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, editorStore: f.editorStore, spreadsheetStore: f.spreadsheetStore, loadModule: f.loadModule, ...extra }; return { ...f, options, templates: createProjectTemplates(options) }; }
const save = (kind, changes = {}) => ({ workspaceId: 'production-workspace', sourceProjectId: 'source', kind, name: '可复用模板', ...changes });
const copy = (kind, changes = {}) => ({ ...save(kind), targetProjectId: 'target', mode: 'copy', ...changes });
describe('项目模板与真实成品另存', () => {
  it('exports real DOCX and PPTX from saved structure, leaves source and client billing untouched, and retries idempotently', async () => {
    for (const kind of ['word', 'ppt']) {
      const onCopied = vi.fn(), f = await setup({ onCopied });
      const document = kind === 'word' ? word('客户甲的最终正文') : { schemaVersion: 1, kind, title: '品牌提案', theme: 'forest', slides: [{ id: 'first-slide', title: '客户甲的第一页', body: '客户甲产品信息', notes: '内部备注', layout: 'two-columns', fontSize: 20, align: 'left' }] };
      await f.editorStore.save({ projectId: 'source', expectedRevision: 0, document });
      const original = await f.editorStore.load({ projectId: 'source', kind }), result = await f.templates.instantiate(copy(kind));
      const exported = result.artifacts.find(file => file.name.endsWith(kind === 'word' ? '.docx' : '.pptx')); expect(exported).toBeTruthy(); const Zip = f.loadModule('jszip'), zip = await Zip.loadAsync((await f.artifactStore.read(exported.id)).buffer); expect(zip.file(kind === 'word' ? 'word/document.xml' : 'ppt/slides/slide1.xml')).not.toBeNull();
      expect(await f.editorStore.load({ projectId: 'source', kind })).toEqual(original);
      const again = await f.templates.instantiate(copy(kind)); expect(again.artifacts.map(file => file.id)).toEqual(result.artifacts.map(file => file.id)); expect(onCopied).toHaveBeenCalledTimes(1); expect(onCopied.mock.calls[0][0].copyId).toBe('template-copy-target');
      await expect(f.templates.instantiate(copy(kind, { targetProjectId: 'source' }))).rejects.toThrow('独立');
    }
  });
  it('clears private text and pictures by default while preserving styles; exact historical export never uses the current document', async () => {
    const f = await setup(), image = await f.artifactStore.write({ projectId: 'source', name: '客户照片.png', mimeType: 'image/png', buffer: PNG });
    const document = word('客户手机号13800138000'); document.blocks.push({ id: 'client-image', type: 'image', text: '原客户照片', imageId: image.id, fontSize: 12, bold: false, italic: false, align: 'center' }); document.blocks[0].bold = true;
    const old = await f.editorStore.export({ projectId: 'source', expectedRevision: 0, document, sourceArtifactIds: [image.id] }); const office = old.artifacts.find(file => file.name.endsWith('.docx'));
    await f.editorStore.save({ projectId: 'source', expectedRevision: 1, document: word('当前新稿不应混入历史成品') });
    const templates = createProjectTemplates({ ...f.options, readDocumentArtifact: async artifact => artifact.id === office.id ? { text: JSON.stringify({ editorDocument: document }), sourceRevision: 1 } : undefined });
    const template = await templates.save(save('word', { sourceArtifactId: office.id })); expect(template.sourceRevision).toBe(1); expect(template.files).toBe(0);
    await templates.instantiate(copy('word', { mode: 'template', templateId: template.id })); const current = await f.editorStore.load({ projectId: 'target', kind: 'word' }); expect(JSON.stringify(current.document)).not.toContain('13800138000'); expect(current.document.blocks[0].bold).toBe(true); expect(current.document.blocks.some(block => !!block.imageId)).toBe(false);
    await templates.instantiate(copy('word', { sourceArtifactId: office.id, targetProjectId: 'other' })); expect(JSON.stringify((await f.editorStore.load({ projectId: 'other', kind: 'word' })).document)).toContain('13800138000'); expect(JSON.stringify((await f.editorStore.load({ projectId: 'other', kind: 'word' })).document)).not.toContain('当前新稿');
  });
  it('builds real XLSX with cleared data and optional validated formulas, without old sheet/customer names', async () => {
    const f = await setup(); const document = { schemaVersion: 1, kind: 'excel', title: '客户销售', sheets: [{ id: 'source-sheet', name: '客户甲销售', rowCount: 3, columnCount: 3, cells: { A1: { value: '客户隐私' }, B1: { value: 10, format: 'currency' }, C1: { value: null, formula: '=B1*2' } }, columnWidths: { A: 120 } }] };
    await f.spreadsheetStore.save({ projectId: 'source', expectedRevision: 0, document }); const template = await f.templates.save(save('excel', { retain: { formulas: true } })); const result = await f.templates.instantiate(copy('excel', { mode: 'template', templateId: template.id }));
    const record = await f.spreadsheetStore.load({ projectId: 'target' }); expect(record.document.sheets[0].name).toBe('工作表1'); expect(record.document.sheets[0].cells.A1.value).toBeNull(); expect(record.document.sheets[0].cells.C1.formula).toBe('B1*2'); expect(record.document.sheets[0].columnWidths.A).toBe(120); expect(result.artifacts.some(file => file.name.endsWith('.xlsx'))).toBe(true); expect(JSON.stringify(await f.templates.exportWorkspace('production-workspace'))).not.toContain('客户隐私');
  });
  it('image templates store dimensions without private pixels; raw file copy is explicit and workflow credentials are scrubbed', async () => {
    const f = await setup(), image = await f.artifactStore.write({ projectId: 'source', name: '客户原图.png', mimeType: 'image/png', buffer: PNG });
    const template = await f.templates.save(save('image', { sourceArtifactId: image.id })); expect(template.imageSettings).toEqual({ width: 1, height: 1, mimeType: 'image/png' }); expect(template.files).toBe(0);
    const snapshot = await f.templates.exportWorkspace('production-workspace'); expect(snapshot.files).toEqual([]);
    const result = await f.templates.instantiate(copy('image', { sourceArtifactId: image.id })); expect(result.artifacts).toHaveLength(1); expect((await f.artifactStore.read(result.artifacts[0].id)).buffer).toEqual(PNG);
    const workflow = { outputKind: 'image', name: '旧客户', goalBrief: { secret: '旧客户机密' }, steps: [{ id: 'step', name: '旧客户名', kind: 'image-generation', prompt: '旧客户机密', enabled: true, inputSource: 'project', credentialId: 'OLD_KEY', modelConfigId: 'OLD_MODEL', imageSize: '1024x1024' }] };
    await f.templates.save(save('image', { sourceArtifactId: image.id, retain: { workflow: true }, workflow })); const text = JSON.stringify(await f.templates.exportWorkspace('production-workspace')); expect(text).not.toContain('OLD_KEY'); expect(text).not.toContain('OLD_MODEL'); expect(text).not.toContain('旧客户机密');
  });
  it('keeps new project on failed Office export and permits direct retry without copying its material twice', async () => {
    const f = await setup(), image = await f.artifactStore.write({ projectId: 'source', name: '插图.png', mimeType: 'image/png', buffer: PNG }), document = word(); document.blocks.push({ id: 'illustration', type: 'image', text: '', imageId: image.id, fontSize: 12, bold: false, italic: false, align: 'left' }); await f.editorStore.save({ projectId: 'source', expectedRevision: 0, document }); let fail = true;
    const templates = createProjectTemplates({ ...f.options, editorStore: { ...f.editorStore, export: async input => { if (fail) { fail = false; throw Error('disk busy'); } return f.editorStore.export(input); } } });
    await expect(templates.instantiate(copy('word'))).rejects.toThrow('disk busy'); expect(await f.artifactStore.listProject('target')).toHaveLength(1);
    const result = await templates.instantiate(copy('word')); expect(result.artifacts.filter(file => file.kind === 'image')).toHaveLength(1); expect(result.artifacts.some(file => file.name.endsWith('.docx'))).toBe(true);
  });
  it('includes local templates in full workspace ZIP, restores into a new workspace, and keeps material identity mapped', async () => {
    const f = await setup(), { createProjectBackup } = require('../../electron/project-backup.cjs');
    const image = await f.artifactStore.write({ projectId: 'source', name: '可复用配图.png', mimeType: 'image/png', buffer: PNG }); await f.templates.save(save('image', { sourceArtifactId: image.id, retain: { assets: true } }));
    const backup = createProjectBackup({ directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, templateProvider: () => f.templates, loadModule: f.loadModule });
    const registry = await f.workspaceStorage.list(), meta = { workspaces: [{ id: 'production-workspace', name: '固定验收', directory: f.workspace, createdAt: '2026-11-12T00:00:00Z' }], projects: registry.projects.map(item => ({ id: item.projectId, workspaceId: item.workspaceId, name: item.name, kind: 'image', status: 'draft', description: '', updatedAt: '2026-11-12T00:00:00Z', costCents: 0, version: 0, accent: 'purple' })), ledger: [], customPrompts: [], preferencesByWorkspace: {}, configuration: { connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] } };
    const filePath = path.join(f.directory, 'workspace-templates.zip'); await backup.exportBackup({ meta, workspaceIds: ['production-workspace'], filePath }); const destination = path.join(f.directory, 'restore-target'); await fs.mkdir(destination); const restored = await backup.importBackup({ filePath, directory: destination });
    const fresh = await f.templates.exportWorkspace(restored.idMap['production-workspace']); expect(fresh.items).toHaveLength(1); expect(fresh.items[0].id).not.toBe((await f.templates.list('production-workspace'))[0].id); expect(fresh.files[0].buffer).toEqual(PNG); expect(fresh.items[0].materials[0].fileName).toBe(`${fresh.items[0].id}-${fresh.files[0].id}.bin`);
    await backup.acknowledgeImport(restored.backupId); await expect(backup.importBackup({ filePath, directory: destination })).rejects.toThrow('已导入');
  });
});
