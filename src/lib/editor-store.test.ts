import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EditorBridge, EditorRecord, PresentationEditorDocument, WordEditorDocument } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
import { editorFromText, newEditorSlide, newWordBlock } from './editor-document';
const require = createRequire(import.meta.url);
const { createEditorStore } = require('../../electron/editor-store.cjs') as { createEditorStore: (options: Record<string, unknown>) => EditorBridge };
interface ArtifactStore { write: (input: Record<string, unknown>) => Promise<ArtifactMetadata>; read: (id: string) => Promise<ArtifactMetadata & { buffer: Buffer }>; exportOffice: (input: Record<string, unknown>) => Promise<ArtifactMetadata[]>; }
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (options: Record<string, unknown>) => ArtifactStore };
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = path.join(root, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(manifest) ? manifest : path.join(root, 'package.json'));
interface Zip { files: Record<string, unknown>; file: (name: string) => { async: (type: string) => Promise<string> } | null; }
const JSZip = dependencies('jszip') as { loadAsync: (buffer: Buffer) => Promise<Zip> };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
function word(): WordEditorDocument { return { schemaVersion: 1, kind: 'word', title: '真实编辑标题', blocks: [newWordBlock('heading', '第一章'), { ...newWordBlock('paragraph', '修改前的文字'), bold: true, italic: true, fontSize: 16, align: 'center' }, newWordBlock('bullet', '真实列表条目')] }; }
async function fixture(fileSystem?: Record<string, unknown>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-editor-tests-'));
  for (const id of ['project-one', 'project-two']) await fs.mkdir(path.join(directory, id, '.xuzuo'), { recursive: true });
  const workspaceStorage = { projectDirectory: async (id: string) => { if (!['project-one', 'project-two'].includes(id)) throw new Error('项目未登记'); return path.join(directory, id); } };
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
  const options = { workspaceStorage, artifactStore, ...(fileSystem ? { fileSystem } : {}) };
  return { directory, artifactStore, options, store: createEditorStore(options) };
}
function input(document = word(), expectedRevision = 0) { return { projectId: 'project-one', expectedRevision, document }; }
describe('项目编辑源和真实版本', () => {
  it('保存到项目目录、重开最新源、历史内容可载入为新版本，项目之间独立', async () => {
    const f = await fixture(); expect(await f.store.load({ projectId: 'project-one', kind: 'word', title: '' })).toBeNull();
    const first = await f.store.save(input());
    const updated = { ...word(), blocks: [newWordBlock('paragraph', '人工修改后的最终内容')] };
    await f.store.save(input(updated, first.revision));
    const reopened = createEditorStore(f.options); const latest = await reopened.load({ projectId: 'project-one', kind: 'word', title: '' });
    expect(latest?.document).toEqual(updated); expect(latest?.revision).toBe(2);
    expect(await reopened.load({ projectId: 'project-two', kind: 'word', title: '' })).toBeNull();
    expect((await fs.readFile(path.join(f.directory, 'project-one/.xuzuo/editor-v1.json'), 'utf8'))).toContain('人工修改后的最终内容');
    const history = await reopened.history({ projectId: 'project-one' }); expect(history.map(item => item.revision)).toEqual([2, 1]);
    const old = await reopened.loadVersion({ projectId: 'project-one', revision: 1 });
    expect((await reopened.save({ ...input(old.document as WordEditorDocument, 2) })).revision).toBe(3);
    expect((await reopened.loadVersion({ projectId: 'project-one', revision: 2 })).document).toEqual(updated);
  });
  it('版本冲突与落盘失败保留旧源，不覆盖另一个修改或伪称成功', async () => {
    const f = await fixture(); await f.store.save(input());
    await expect(f.store.save(input())).rejects.toThrow('另一处更新');
    const failing = createEditorStore({ ...f.options, fileSystem: { ...fs, rename: async () => { throw new Error('disk write failed'); } } });
    await expect(failing.save(input(word(), 1))).rejects.toThrow('disk write failed');
    expect((await f.store.load({ projectId: 'project-one', kind: 'word', title: '' }))?.revision).toBe(1);
    expect((await fs.readdir(path.join(f.directory, 'project-one/.xuzuo'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
  it('未登记路径、链接目录、损坏编辑源及跨项目图片被拒绝', async () => {
    const f = await fixture(); await expect(f.store.load({ projectId: '../outside', kind: 'word', title: '' })).rejects.toThrow();
    const other = await f.artifactStore.write({ name: '他项目.png', mimeType: 'image/png', buffer: PNG, projectId: 'project-two' });
    const document = word(); document.blocks.push({ ...newWordBlock('image'), imageId: other.id });
    await expect(f.store.save(input(document))).rejects.toThrow('不属于当前项目');
    await fs.writeFile(path.join(f.directory, 'project-one/.xuzuo/editor-v1.json'), '{broken');
    await expect(f.store.load({ projectId: 'project-one', kind: 'word', title: '' })).rejects.toThrow('损坏');
    const linked = path.join(f.directory, 'project-two/.xuzuo'); await fs.rmdir(linked);
    await fs.symlink(path.join(f.directory, 'project-one/.xuzuo'), linked, 'junction');
    await expect(f.store.load({ projectId: 'project-two', kind: 'word', title: '' })).rejects.toThrow('链接');
  });
  it('导出失败不增加编辑源版本，可使用原expectedRevision继续保存和重试', async () => {
    const f = await fixture(); await f.store.save(input());
    const document = { ...word(), blocks: [newWordBlock('paragraph', '失败后仍需要保存的正文')] };
    const failing = createEditorStore({ ...f.options, artifactStore: { ...f.artifactStore, exportOffice: async () => { throw new Error('image decode or output write failed'); } } });
    await expect(failing.export(input(document, 1))).rejects.toThrow('image decode or output write failed');
    expect((await f.store.load({ projectId: 'project-one', kind: 'word', title: '' }))?.revision).toBe(1);
    const retry = await f.store.save(input(document, 1)); expect(retry.revision).toBe(2); expect(retry.document).toEqual(document);
  });
});
describe('结构化内容和 Office 导出一致', () => {
  it('Word格式与插图顺序写入DOCX，导出后重开仍是最新编辑源', async () => {
    const f = await fixture(), image = await f.artifactStore.write({ name: '插图.png', mimeType: 'image/png', buffer: PNG, projectId: 'project-one' });
    const document = word(); document.blocks.splice(2, 0, { ...newWordBlock('image', '图片说明'), imageId: image.id });
    const result = await f.store.export(input(document));
    const docx = result.artifacts.find(item => item.name.endsWith('.docx'))!;
    const zip = await JSZip.loadAsync((await f.artifactStore.read(docx.id)).buffer), xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('真实编辑标题'); expect(xml).toContain('修改前的文字'); expect(xml).toContain('w:jc w:val="center"'); expect(xml).toContain('w:sz w:val="32"');
    expect(xml.indexOf('图片说明')).toBeLessThan(xml.indexOf('真实列表条目'));
    expect(Object.keys(zip.files).filter(name => /^word\/media\/.*\.png$/.test(name))).toHaveLength(1);
    const reopened = createEditorStore(f.options); expect((await reopened.load({ projectId: 'project-one', kind: 'word', title: '' }))?.document).toEqual(document);
  });
  it('PPT保持手工页序和页数，图片在对应页面而不额外增加图片页，备注保留', async () => {
    const f = await fixture(), image = await f.artifactStore.write({ name: '页面插图.png', mimeType: 'image/png', buffer: PNG, projectId: 'project-one' });
    const document: PresentationEditorDocument = { schemaVersion: 1, kind: 'ppt', title: '逐页编辑结果', theme: 'forest', slides: [{ ...newEditorSlide('第二页移到第一'), body: '这里是第一张的人工修订。', layout: 'image-right', imageId: image.id, notes: '这是真实备注' }, { ...newEditorSlide('保留长正文原页'), body: '原页内容 '.repeat(150), layout: 'two-columns' }] };
    const result = await f.store.export({ projectId: 'project-one', expectedRevision: 0, document });
    const pptx = result.artifacts.find(item => item.name.endsWith('.pptx'))!, zip = await JSZip.loadAsync((await f.artifactStore.read(pptx.id)).buffer);
    expect(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(2);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('第二页移到第一');
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('image');
    expect(await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')).toContain('这是真实备注');
    expect((await f.store.load({ projectId: 'project-one', kind: 'ppt', title: '' }))?.document).toEqual(document);
  });
  it('结构校验拒绝重复编号和错误插图，并从生成正文保留真正多页结构', async () => {
    const f = await fixture(); const invalid = word(); invalid.blocks[1].id = invalid.blocks[0].id;
    await expect(f.store.save(input(invalid))).rejects.toThrow('重复');
    const parsed = editorFromText('ppt', '原标题', JSON.stringify({ title: '生成标题', slides: [{ title: '一页', bullets: ['甲', '乙'], notes: '备注' }, { title: '二页', bullets: ['丙'] }] }));
    expect(parsed.kind).toBe('ppt'); if (parsed.kind !== 'ppt') throw new Error('wrong kind'); expect(parsed.slides).toHaveLength(2); expect(parsed.slides[0].body).toBe('甲\n乙'); expect(parsed.slides[0].notes).toBe('备注');
    const saved: EditorRecord = await f.store.save({ projectId: 'project-one', expectedRevision: 0, document: parsed });
    expect(saved.document).toEqual(parsed);
  });
});
