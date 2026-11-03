import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { editorFromText } from './editor-generated';
import { spreadsheetFromText } from './spreadsheet-generated';
import type { ArtifactMetadata } from '../live-types';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (options: Record<string, unknown>) => { write: (input: Record<string, unknown>) => Promise<ArtifactMetadata>; read: (id: string) => Promise<ArtifactMetadata & { buffer: Buffer }>; exportOffice: (input: Record<string, unknown>) => Promise<ArtifactMetadata[]> } };
const { normalizeOfficeDocument } = require('../../electron/office-content.cjs') as { normalizeOfficeDocument: (kind: string, text: string, title: string) => unknown };
const root = fileURLToPath(new URL('../../', import.meta.url)), staged = path.join(root, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(staged) ? staged : path.join(root, 'package.json'));
interface Zip { files: Record<string, unknown>; file: (name: string) => { async: (type: string) => Promise<string> } | null; }
const JSZip = dependencies('jszip') as { loadAsync: (bytes: Buffer) => Promise<Zip> };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-normalized-office-')); const store = createArtifactStore({ directory, loadModule: dependencies }); const image = await store.write({ name: '明确插图.png', mimeType: 'image/png', buffer: PNG, projectId: 'qa-project' }); return { store, image }; }
function withoutIds(value: unknown): unknown { if (Array.isArray(value)) return value.map(withoutIds); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, content]) => [key, withoutIds(content)])); return value; }

describe('工作台规范内容与实际Office字节一致', () => {
  it('Word/PPT前言JSON围栏与完整canonical使用和UI同源的规范内容', () => {
    const word = '以下是正文：\n```json\n' + JSON.stringify({ title: '完整说明', sections: [{ heading: '范围', paragraphs: ['第一段完整正文。', '第二段含数字 0 与事实。'] }], meta: { missingInputs: ['交付日期'] } }) + '\n```\n正文已整理。';
    expect(withoutIds(normalizeOfficeDocument('word', word, '备用'))).toEqual(withoutIds(editorFromText('word', '备用', word)));
    const ppt = JSON.stringify({ schemaVersion: 1, kind: 'ppt', title: '保持主题', theme: 'forest', slides: [{ id: 'one', title: '唯一页', body: '左栏\n---\n右栏', notes: '真实备注', layout: 'two-columns', fontSize: 24, align: 'right' }] });
    expect(normalizeOfficeDocument('ppt', ppt, '备用')).toEqual(editorFromText('ppt', '备用', ppt));
  });
  it('PPT六要点和长内容仍一页，正文/备注完整而不偷偷分页', async () => {
    const { store } = await fixture();
    const bullets = Array.from({ length: 6 }, (_, index) => `完整要点 ${index + 1}：${'说明'.repeat(35)}`);
    const source = JSON.stringify({ title: '用户指定一页', slides: [{ title: '保持一页', bullets, notes: '完整补充说明' }], meta: { missingInputs: ['最终日期'] } });
    const ui = editorFromText('ppt', '备用', source); expect(ui.kind).toBe('ppt');
    const artifacts = await store.exportOffice({ kind: 'ppt', title: '备用', text: source });
    const zip = await JSZip.loadAsync((await store.read(artifacts[0].id)).buffer);
    expect(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(1);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string'); bullets.forEach(bullet => expect(xml).toContain(bullet));
    const notes = await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string'); expect(notes).toContain('完整补充说明'); expect(notes).toContain('最终日期');
  });
  it('canonical Word样式/换行/明确插图位置进入真实DOCX，不把JSON当正文', async () => {
    const { store, image } = await fixture();
    const document = { schemaVersion: 1, kind: 'word', title: '商业说明', blocks: [{ id: 'heading', type: 'heading', text: '交付范围', fontSize: 20, bold: true, italic: false, align: 'center' }, { id: 'body', type: 'paragraph', text: '第一行\n第二行', fontSize: 16, bold: true, italic: true, align: 'right' }, { id: 'picture', type: 'image', text: '对应图注', fontSize: 12, bold: false, italic: false, align: 'center', imageId: image.id }] };
    for (const source of [JSON.stringify(document), JSON.stringify({ editorDocument: document })]) {
      const artifacts = await store.exportOffice({ kind: 'word', title: '备用文件名', text: source, assets: [image.id] });
      const zip = await JSZip.loadAsync((await store.read(artifacts[0].id)).buffer), xml = await zip.file('word/document.xml')!.async('string');
      for (const text of ['商业说明', '交付范围', '第一行', '第二行', '对应图注']) expect(xml).toContain(text);
      expect(xml).toContain('w:val="right"'); expect(xml).toContain('w:val="32"'); expect(xml).toContain('<w:b'); expect(xml).toContain('<w:i'); expect(xml).toContain('<w:br'); expect(xml).not.toContain('&quot;blocks&quot;');
      expect(Object.keys(zip.files).filter(name => /^word\/media\//.test(name))).toHaveLength(1);
    }
  });
  it('Excel对象表头/对象行保留0false/style，公式字符串是文字，公式对象重算5', async () => {
    const { store } = await fixture();
    const source = '已整理：\n```json\n' + JSON.stringify({ title: '完整业务表', sheets: [{ name: '业务', columns: [{ header: '名称', key: 'name' }, { header: '数量', key: 'quantity' }, { header: '确认', key: 'confirmed' }, { header: '表达式', key: 'expression' }], rows: [{ name: '甲', quantity: 0, confirmed: false, expression: '=2+3' }, { name: '乙', quantity: 2, confirmed: true, expression: { formula: 'SUM(B2:B3)+3', result: 999, bold: true, align: 'center', format: 'number' } }] }], meta: { missingInputs: ['最终签署日期'] } }) + '\n```';
    const ui = spreadsheetFromText(source, '备用'); expect(normalizeOfficeDocument('excel', source, '备用')).toEqual(ui);
    const artifacts = await store.exportOffice({ kind: 'excel', title: '备用', text: source });
    const ExcelJS = dependencies('exceljs') as { Workbook: new () => { xlsx: { load: (bytes: Buffer) => Promise<void> }; worksheets: { name: string }[]; getWorksheet: (name: string) => { getCell: (address: string) => { value: unknown; result: unknown; formula: unknown; font: { bold: boolean }; alignment: { horizontal: string } } } } };
    const book = new ExcelJS.Workbook(); await book.xlsx.load((await store.read(artifacts[0].id)).buffer);
    const sheet = book.getWorksheet('业务'); expect(sheet.getCell('B2').value).toBe(0); expect(sheet.getCell('C2').value).toBe(false); expect(sheet.getCell('D2').value).toBe('=2+3'); expect(sheet.getCell('D2').formula).toBeUndefined(); expect(sheet.getCell('D3').result).toBe(5); expect(sheet.getCell('D3').font.bold).toBe(true); expect(sheet.getCell('D3').alignment.horizontal).toBe('center');
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(ui.sheets.map(sheet => sheet.name));
    expect(book.getWorksheet('资料说明').getCell('A2').value).toBe('最终签署日期');
  });
  it('canonical稀疏Excel直入真实XLSX不被误作columns/rows，错误JSON不写文件', async () => {
    const { store } = await fixture();
    const document = { schemaVersion: 1, kind: 'excel', title: '规范工作簿', sheets: [{ id: 'stable', name: '数据', rowCount: 10, columnCount: 4, cells: { A1: { value: 2 }, B1: { value: 3 }, C1: { value: 999, formula: 'SUM(A1:B1)' }, D1: { value: null, formula: 'SQRT(A1)' } } }] };
    const artifacts = await store.exportOffice({ kind: 'excel', text: JSON.stringify(document) }); const zip = await JSZip.loadAsync((await store.read(artifacts[0].id)).buffer), xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<f>SUM(A1:B1)</f><v>5</v>'); expect(xml).toContain('<f>SQRT(A1)</f>'); expect(xml).not.toContain('<v>999</v>');
    await expect(store.exportOffice({ kind: 'excel', title: '残稿', text: '生成结果：\n```json\n{"sheets":[' })).rejects.toThrow();
    await expect(store.exportOffice({ kind: 'word', title: '残稿', text: '```json\n{"sections":\n```' })).rejects.toThrow('JSON');
  });
});
