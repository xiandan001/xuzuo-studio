import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata } from '../live-types';

interface WriteInput { name: string; mimeType: string; buffer?: Buffer; text?: string; runId?: string; projectId?: string; }
interface ExportInput { kind: 'ppt' | 'word' | 'excel' | 'image'; title: string; text: string; assets?: (string | Pick<ArtifactMetadata, 'id'>)[]; runId?: string; projectId?: string; }
interface ReadArtifact extends ArtifactMetadata { buffer: Buffer; }
interface ArtifactPreview { artifact: ArtifactMetadata; supported: boolean; dataUrl?: string; text?: string; reason?: string; }
interface Store { write: (input: WriteInput) => Promise<ArtifactMetadata>; read: (id: string) => Promise<ReadArtifact>; list: (ids: string[]) => Promise<ArtifactMetadata[]>; importPaths: (paths: string[], scope?: { runId?: string; projectId?: string }) => Promise<ArtifactMetadata[]>; preview: (id: string) => Promise<ArtifactPreview>; exportOffice: (input: ExportInput) => Promise<ArtifactMetadata[]>; }
interface ZipEntry { async: (type: 'string' | 'nodebuffer') => Promise<string | Buffer>; }
interface Zip { files: Record<string, { dir: boolean }>; file: (filename: string) => ZipEntry | null; }
interface Workbook { xlsx: { load: (buffer: Buffer) => Promise<void> }; getWorksheet: (name: string) => { getCell: (address: string) => { value: unknown; formula?: string; result?: unknown } } | undefined; }
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (options: { directory: string; loadModule: NodeRequire }) => Store };
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimeManifest = path.join(projectRoot, 'work', 'ui-build', 'package.json');
const dependencies = createRequire(existsSync(runtimeManifest) ? runtimeManifest : path.join(projectRoot, 'package.json'));
const JSZip = dependencies('jszip') as { loadAsync: (buffer: Buffer) => Promise<Zip> };
const ExcelJS = dependencies('exceljs') as { Workbook: new () => Workbook };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-office-tests-'));
  const store = createArtifactStore({ directory, loadModule: dependencies });
  const image = await store.write({ name: '测试图像.png', mimeType: 'image/png', buffer: PNG, runId: 'test-run', projectId: 'test-project' });
  return { directory, store, image };
}

async function reportFrom(store: Store, artifacts: ArtifactMetadata[]) {
  const report = artifacts.find(artifact => artifact.name.endsWith('-检查报告.json'));
  if (!report) throw new Error('missing report');
  return JSON.parse((await store.read(report.id)).buffer.toString('utf8')) as { embeddedImages: number; unplacedImageIds: string[]; rendered: boolean; originalLayoutPreserved: boolean; status: string; pages?: number; formulas: { count: number; cells: string[]; recalculated: boolean; resultsVerified: boolean } };
}

describe('实际产物登记与 Office 导出', () => {
  it('同名文件不会覆盖，重开登记表仍能读取，只接受管理产物ID', async () => {
    const { directory, store } = await fixture();
    const first = await store.write({ name: '../../同名.txt', mimeType: 'text/plain', text: '第一份' });
    const second = await store.write({ name: '同名.txt', mimeType: 'text/plain', text: '第二份' });
    expect(first.id).not.toBe(second.id);
    expect(first.path).not.toBe(second.path);
    expect(first.name).toBe('同名.txt');
    const reopened = createArtifactStore({ directory, loadModule: dependencies });
    expect((await reopened.read(first.id)).buffer.toString()).toBe('第一份');
    expect((await reopened.read(second.id)).buffer.toString()).toBe('第二份');
    expect(await reopened.list([first.id, second.id])).toHaveLength(2);
    await expect(reopened.read('../../outside.txt')).rejects.toThrow('产物编号');
    await expect(reopened.read('missing-id')).rejects.toThrow('找不到');
  });

  it('导入真实选择文件为副本，预览图片/UTF8文字，Office与PDF不冒充解析', async () => {
    const { directory, store } = await fixture();
    const sourceDirectory = path.join(directory, 'selected');
    await fs.mkdir(sourceDirectory);
    const textFile = path.join(sourceDirectory, '说明.txt');
    const pngFile = path.join(sourceDirectory, '图片.png');
    const pdfFile = path.join(sourceDirectory, '样例.pdf');
    await fs.writeFile(textFile, '本机输入文字', 'utf8'); await fs.writeFile(pngFile, PNG); await fs.writeFile(pdfFile, '%PDF-1.4 test-only');
    const imported = await store.importPaths([textFile, pngFile, pdfFile], { projectId: 'local-project' });
    expect(imported.every(item => item.projectId === 'local-project' && item.path !== textFile)).toBe(true);
    expect((await store.preview(imported[0].id)).text).toBe('本机输入文字');
    expect((await store.preview(imported[1].id)).dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(await store.preview(imported[2].id)).toMatchObject({ supported: false, reason: expect.stringContaining('不支持') });
    const binary = await store.write({ name: '错误编码.txt', mimeType: 'text/plain', buffer: Buffer.from([255, 254, 0]) });
    expect(await store.preview(binary.id)).toMatchObject({ supported: false, reason: expect.stringContaining('UTF-8') });
  });

  it('生成真实PPTX，ZIP包含可编辑文字、演讲备注、图片与引用关系', async () => {
    const { store, image } = await fixture();
    const result = await store.exportOffice({ kind: 'ppt', title: '茶园品牌提案', text: JSON.stringify({ slides: [{ title: '品牌定位', bullets: ['依据真实资料组织内容', '保留重要数字 2026'], notes: '讲解提示 保留原始口径', imageId: image.id, layout: 'image-right' }, { title: '下一步', bullets: ['人工复核后交付'] }] }), assets: [image], runId: 'test-run', projectId: 'test-project' });
    const artifact = result.find(item => item.name.endsWith('.pptx'))!;
    expect(artifact.kind).toBe('office'); expect((await fs.stat(artifact.path)).size).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync((await store.read(artifact.id)).buffer);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('保留重要数字 2026');
    expect(await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')).toContain('讲解提示');
    expect(Object.keys(zip.files).filter(name => /^ppt\/media\/.+\.png$/.test(name))).toHaveLength(1);
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('image');
    expect(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(2);
    expect(await reportFrom(store, result)).toMatchObject({ pages: 2, embeddedImages: 1, rendered: false, originalLayoutPreserved: false, status: 'requires-human-review' });
  });

  it('生成真实DOCX，Title样式和中文完整保留，未指定位置的图片不擅自追加', async () => {
    const { store, image } = await fixture();
    const result = await store.exportOffice({ kind: 'word', title: '项目说明', text: JSON.stringify({ sections: [{ heading: '交付范围', paragraphs: ['生成可编辑的文字。', '原始金额为 1000 元，不补造数据。'] }] }), assets: [{ id: image.id, path: 'C:/must-not-be-read' } as Pick<ArtifactMetadata, 'id'>] });
    const artifact = result.find(item => item.name.endsWith('.docx'))!;
    const zip = await JSZip.loadAsync((await store.read(artifact.id)).buffer);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('项目说明'); expect(documentXml).toContain('交付范围'); expect(documentXml).toContain('原始金额为 1000 元'); expect(documentXml).toContain('w:val="Title"');
    expect(Object.keys(zip.files).filter(name => /^word\/media\/.+\.png$/.test(name))).toHaveLength(0);
    expect(await reportFrom(store, result)).toMatchObject({ embeddedImages: 0, unplacedImageIds: [image.id], rendered: false });
  });

  it('生成真实XLSX，同源重算不信缓存，未定位图片不添加隐藏工作表', async () => {
    const { store, image } = await fixture();
    const result = await store.exportOffice({ kind: 'excel', title: '项目金额表', text: JSON.stringify({ sheets: [{ name: '项目', columns: ['名称', '金额'], rows: [['甲', 2], ['乙', 3], ['合计', { formula: 'SUM(B2:B3)', result: 999 }]] }] }), assets: [image.id] });
    const artifact = result.find(item => item.name.endsWith('.xlsx'))!;
    const buffer = (await store.read(artifact.id)).buffer;
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('<f>SUM(B2:B3)</f>');
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).not.toContain('<v>999</v>');
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('fullCalcOnLoad="1"');
    expect(Object.keys(zip.files).some(name => /^xl\/media\/.+\.png$/.test(name))).toBe(false);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet('项目')!.getCell('B4').formula).toBe('SUM(B2:B3)');
    expect(workbook.getWorksheet('项目')!.getCell('B4').result).toBe(5);
    expect(workbook.getWorksheet('图像附件')).toBeUndefined(); expect(workbook.getWorksheet('检查说明')).toBeUndefined();
    expect(await reportFrom(store, result)).toMatchObject({ embeddedImages: 0, unplacedImageIds: [image.id], formulas: { count: 1, cells: ['项目!B4'], recalculated: true, resultsVerified: false } });
  });

  it('Markdown和CSV降级保留文字，CSV中的等号内容不会自动成为公式', async () => {
    const { store } = await fixture();
    const result = await store.exportOffice({ kind: 'excel', title: '导入文字', text: '名称,说明\n测试,"=1+1"' });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await store.read(result[0].id)).buffer);
    expect(workbook.getWorksheet('数据')!.getCell('B2').value).toBe('=1+1');
    expect(workbook.getWorksheet('数据')!.getCell('B2').formula).toBeUndefined();
    const word = await store.exportOffice({ kind: 'word', title: '段落说明', text: '# 概述\n\n这段文字来自真实输入。\n\n## 交付\n- 检查后交付' });
    const zip = await JSZip.loadAsync((await store.read(word[0].id)).buffer);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('这段文字来自真实输入。');
  });

  it('非法JSON、过长正文和外部公式明确拒绝，宽于表头的数据完整保留', async () => {
    const { store } = await fixture();
    await expect(store.exportOffice({ kind: 'word', title: '测试', text: '{"sections":' })).rejects.toThrow('JSON');
    await expect(store.exportOffice({ kind: 'ppt', title: '测试', text: '文'.repeat(200001) })).rejects.toThrow('200000');
    await expect(store.exportOffice({ kind: 'excel', title: '测试', text: JSON.stringify({ sheets: [{ name: '数据', columns: ['值'], rows: [[{ formula: 'WEBSERVICE("https://example.com")' }]] }] }) })).rejects.toThrow('外部');
    const extra = await store.exportOffice({ kind: 'excel', title: '测试', text: JSON.stringify({ sheets: [{ name: '数据', columns: ['值'], rows: [[1, 2]] }] }) });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await store.read(extra[0].id)).buffer);
    expect(workbook.getWorksheet('数据')!.getCell('A2').value).toBe(1); expect(workbook.getWorksheet('数据')!.getCell('B2').value).toBe(2);
    await expect(store.exportOffice({ kind: 'ppt', title: '测试', text: JSON.stringify({ slides: [{ title: '很多内容', bullets: ['文'.repeat(25000)] }] }) })).rejects.toThrow('字符');
  });

  it('图像导出返回实际图像和内容说明，不能伪造Office或忽略不支持的WebP嵌入', async () => {
    const { store, image } = await fixture();
    const result = await store.exportOffice({ kind: 'image', title: '图像作品', text: '原创图像说明', assets: [image.id] });
    expect(result[0].id).toBe(image.id); expect((await store.read(result[0].id)).buffer).toEqual(PNG);
    expect(result[1].name.endsWith('.md')).toBe(true); expect(result.some(item => item.kind === 'office')).toBe(false);
    await expect(store.exportOffice({ kind: 'image', title: '未生成', text: '仅描述', assets: [] })).rejects.toThrow('没有真实图像');
    const webp = await store.write({ name: '图片.webp', mimeType: 'image/webp', buffer: Buffer.from('RIFFtestonlyWEBP') });
    await expect(store.exportOffice({ kind: 'word', title: '测试', text: '内容', assets: [webp] })).rejects.toThrow('WebP');
  });
});
