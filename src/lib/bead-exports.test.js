import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEAD_PALETTES } from '../data/bead-palettes';
const require = createRequire(import.meta.url);
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const ExcelJS = dependencies('exceljs');
const JSZip = dependencies('jszip');
const { createBeadExport, createBeadBundle } = require('../../electron/bead-exports.cjs');
function document(columns = 8, rows = 8) {
  const colors = [['R1', '红', '#FF0000', 'solid'], ['W1', '白', '#FFFFFF', 'solid'], ['T1', '透明实体珠', '#FFFFFF', 'transparent'], ['LONGCODE1234', '长色号', '#000000', 'solid']].map(([code, name, hex, kind]) => ({ code, name, hex, rgb: [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)), kind, automatic: kind === 'solid' }));
  const cells = new Array(columns * rows).fill(0); cells[0] = 1; cells[1] = 2; cells[2] = 3; cells[cells.length - 1] = 4;
  return { type: 'xuzuo-bead-document', version: 1, id: 'export-fixture', projectId: 'project', revision: 7, title: '可交付拼豆图纸', referenceId: 'original-id', sourceSha256: 'a'.repeat(64), settings: { columns, rows, fit: 'contain', maxColors: 32, alphaThreshold: 128, boardColumns: 4, boardRows: 4 },
    pattern: { type: 'xuzuo-bead-pattern', version: 1, columns, rows, palette: { id: 'test-palette', name: '测试色卡', brand: 'fixture', version: 'pinned-v1', sourceUrl: 'https://example.com/palette', sourceNote: '固定来源说明', license: 'MIT fixture licence\nRetain this permission notice.', colors }, cells },
    procurement: { copies: 2, lossPercent: 5, defaultPackSize: 3, stock: { R1: 1 }, packSizes: {} }, updatedAt: '2026-11-07T00:00:00Z' };
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw Error('Exports must stay local'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('real bead export binaries and snapshot consistency', () => {
  it('performs actual PNG export in a separate worker and keeps the caller event loop available', async () => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');require(workerData.module).createBeadExport(workerData.input).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:error.message}));`, { eval: true, workerData: { module: fileURLToPath(new URL('../../electron/bead-exports.cjs', import.meta.url)), input: { document: document(), format: 'png' } } });
    let ticks = 0; const timer = setInterval(() => ticks++, 1);
    try {
      const result = await new Promise((resolve, reject) => { worker.once('message', value => value.error ? reject(Error(value.error)) : resolve(value.result)); worker.once('error', reject); });
      expect(PNG.sync.read(Buffer.from(result.buffer)).width).toBe(192); expect(ticks).toBeGreaterThan(0);
    } finally { clearInterval(timer); await worker.terminate(); }
  });
  it('encodes actual PNG pixels while differentiating empty, white and physical transparent beads', async () => {
    const input = document(), before = JSON.stringify(input), result = await createBeadExport({ document: input, format: 'png' }, dependencies), image = PNG.sync.read(result.buffer);
    expect(result).toMatchObject({ mimeType: 'image/png', extension: 'png' }); expect(image.width).toBeLessThanOrEqual(4096); expect(image.height).toBeLessThanOrEqual(4096);
    const cell = image.width / 8, pixel = (x, y) => [...image.data.subarray((Math.floor(y) * image.width + Math.floor(x)) * 4, (Math.floor(y) * image.width + Math.floor(x)) * 4 + 4)];
    expect(pixel(cell / 2, cell / 2)).toEqual([255, 0, 0, 255]); expect(pixel(cell * 1.5, cell / 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(cell * 2.5, cell / 2)[3]).toBe(255); expect(pixel(cell * 3.5, cell / 2)[3]).toBe(0); expect(JSON.stringify(input)).toBe(before);
  });
  it('writes real numeric XLSX values from core procurement and retains complete source/licence information', async () => {
    const input = document(); input.pattern.palette.colors[0].name = '=HYPERLINK("https://invalid")';
    const result = await createBeadExport({ document: input, format: 'xlsx' }, dependencies), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.buffer);
    const usage = workbook.getWorksheet('用量与采购'), rows = usage.getSheetValues().slice(2).map(row => row?.slice(1)).filter(Boolean), red = rows.find(row => row[0] === 'R1');
    expect(red).toEqual(['R1', input.pattern.palette.colors[0].name, '普通实心', '#FF0000', 1, 2, 2, 1, 1, 2, 3, 1]);
    expect(usage.getCell('B2').type).not.toBe(ExcelJS.ValueType.Formula); expect(red.slice(4).every(value => typeof value === 'number')).toBe(true);
    const info = workbook.getWorksheet('说明'); expect(info).toBeDefined(); const text = JSON.stringify(info.getSheetValues());
    for (const value of ['pinned-v1', 'https://example.com/palette', '固定来源说明', 'MIT fixture licence', 'permission notice']) expect(text).toContain(value);
  });
  it('exports UTF8 CSV with BOM/LF and protects formulas even behind whitespace', async () => {
    const input = document(); input.pattern.palette.colors[0].name = '  =1+1'; input.title = '@title';
    const result = await createBeadExport({ document: input, format: 'csv' }, dependencies), text = result.buffer.toString('utf8');
    expect(result.buffer.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191])); expect(text).not.toContain('\r\n'); expect(text).toContain("'  =1+1"); expect(text).toContain("'@title"); expect(text).toContain('R1'); expect(text).toContain('permission notice');
  });
  it('canonicalizes editable JSON instead of leaking arbitrary private frontend fields', async () => {
    const input = document(); input.apiKey = 'private-fixture-secret'; input.prompt = 'private-fixture-prompt'; input.settings.apiKey = 'nested-secret'; input.pattern.palette.colors[0].secret = 'colour-secret';
    const result = await createBeadExport({ document: input, format: 'json' }, dependencies), json = JSON.parse(result.buffer.toString('utf8'));
    expect(json.revision).toBe(7); expect(json.pattern.cells).toEqual(input.pattern.cells); expect(json.pattern.palette.colors[2].kind).toBe('transparent');
    expect(result.buffer.toString('utf8')).not.toMatch(/private-fixture|nested-secret|colour-secret|apiKey/);
  });
  it('uses the same immutable revision for all bundle components', async () => {
    const input = document(), originalLicence = input.pattern.palette.license, pending = createBeadExport({ document: input, format: 'bundle' }, dependencies); input.pattern.cells[0] = 0; input.revision = 99; input.pattern.palette.license = 'late changed licence';
    const result = await pending; expect(result.parts.map(part => part.extension).sort()).toEqual(['csv', 'json', 'png', 'xlsx']);
    const json = JSON.parse(result.parts.find(part => part.extension === 'json').buffer.toString('utf8')); expect(json.revision).toBe(7); expect(json.pattern.cells[0]).toBe(1);
    expect(result.pdf.pages).toBeGreaterThanOrEqual(3); expect(result.readme).toContain('100%'); expect(result.license).toBe(originalLicence);
  });
  it('preserves numeric colour codes in JSON/XLSX and protects leading zeroes in an Excel-facing CSV', async () => {
    const input = document(); input.pattern.palette.colors[0].code = '001'; input.pattern.palette.colors[1].code = '0'; input.procurement.stock = {};
    const csv = await createBeadExport({ document: input, format: 'csv' }, dependencies); expect(csv.buffer.toString('utf8')).toContain("'001");
    const pdf = await createBeadExport({ document: input, format: 'pdf' }, dependencies); expect(pdf.html).toContain('JSON 格子索引 0'); expect(pdf.html).toContain('001');
    const xlsx = await createBeadExport({ document: input, format: 'xlsx' }, dependencies), book = new ExcelJS.Workbook(); await book.xlsx.load(xlsx.buffer);
    const values = book.getWorksheet('色卡').getSheetValues(); expect(values[2][1]).toBe('001'); expect(values[3][1]).toBe('0');
  });
  it.each(['png', 'pdf', 'csv', 'xlsx', 'bundle'])('blocks an entirely empty non-JSON product: %s', async format => {
    const value = document(); value.pattern.cells.fill(0); await expect(createBeadExport({ document: value, format }, dependencies)).rejects.toThrow('空');
    expect((await createBeadExport({ document: value, format: 'json' }, dependencies)).extension).toBe('json');
  });
});

describe('bounded printable layout and client bundle', () => {
  it('chooses black for pure magenta and keeps every preset solid-cell label above 4.5:1 contrast', async () => {
    const luminance = hex => {
      const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const magenta = document(); magenta.pattern.palette.colors[0] = { ...magenta.pattern.palette.colors[0], hex: '#FF00FF', rgb: [255, 0, 255] };
    expect((await createBeadExport({ document: magenta, format: 'pdf' }, dependencies)).html).toContain('background-color:#FF00FF;color:#000000');
    for (const palette of BEAD_PALETTES) {
      const input = document(16, 16); input.pattern.palette = structuredClone(palette); input.pattern.cells.fill(0); input.settings.maxColors = 0;
      palette.colors.forEach((color, index) => { if (color.kind === 'solid') input.pattern.cells[index] = index + 1; });
      const result = await createBeadExport({ document: input, format: 'pdf' }, dependencies);
      const pairs = [...result.html.matchAll(/background-color:(#[0-9A-F]{6});color:(#[0-9A-F]{6})/g)];
      expect(pairs).toHaveLength(palette.colors.filter(color => color.kind === 'solid').length);
      for (const pair of pairs) {
        const a = luminance(pair[1]), b = luminance(pair[2]); expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), pair[1]).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('tiles charts at 30x40 with 6mm cells, exact global coordinates and a short-symbol legend', async () => {
    const result = await createBeadExport({ document: document(61, 81), format: 'pdf' }, dependencies), { html, pages } = result;
    expect(html.match(/class="sheet chart-sheet"/g)).toHaveLength(9); expect(html).toContain('列 61–61 · 行 81–81'); expect(html).toContain('6mm'); expect(html).toContain('LONGCODE1234'); expect(html).toContain('短号');
    expect(html.match(/class="sheet /g)).toHaveLength(pages); expect(pages).toBeLessThanOrEqual(100); expect(html).not.toMatch(/<script|<img|<iframe|<link|\b(?:src|href)=|url\(/i);
    const firstChart = html.split('<section class="sheet chart-sheet"')[1].split('</section>')[0]; expect(firstChart).not.toMatch(/>R1<|>LONGCODE1234</); expect(firstChart).toContain('>1</b>');
  });
  it('escapes metadata and splits all valid long source/licence text into readable information pages', async () => {
    const input = document(); input.title = '<img onerror="unsafe">' + '题'.repeat(90); input.pattern.palette.sourceNote = '来源说明<&>'.repeat(500); input.pattern.palette.license = 'MIT permission retained <&> '.repeat(250);
    const result = await createBeadExport({ document: input, format: 'pdf' }, dependencies);
    expect(result.html).toContain('&lt;img'); expect(result.html).not.toContain('<img'); expect(result.html).toContain('完整标题'); expect(result.html).toContain('许可'); expect(result.html).toContain('permission retained'); expect(result.html).toContain('来源说明'); expect(result.pages).toBeLessThanOrEqual(100);
    const decode = value => value.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[name]);
    const field = name => [...result.html.matchAll(new RegExp(`<div data-field="${name}">([^<]*)</div>`, 'g'))].map(match => decode(match[1])).join('').replace(/\s/g, '');
    expect(field('licence')).toBe(input.pattern.palette.license.replace(/\s/g, '')); expect(field('sourceNote')).toBe(input.pattern.palette.sourceNote.replace(/\s/g, ''));
  });
  it('rejects content whose planned information pages exceed the bound instead of clipping licence text', async () => {
    const input = document(); input.pattern.palette.license = 'x\n'.repeat(3999); input.pattern.palette.sourceNote = 'y\n'.repeat(1999);
    await expect(createBeadExport({ document: input, format: 'pdf' }, dependencies)).rejects.toThrow('100');
  });
  it('normalizes valid Unicode line separators into individually planned information rows', async () => {
    const input = document(); input.pattern.palette.license = 'Line one\u2028Line two\u2029Line three'; input.pattern.palette.colors[0].name = '多\n行\t名称';
    const result = await createBeadExport({ document: input, format: 'pdf' }, dependencies);
    const lines = [...result.html.matchAll(/data-field="licence">([^<]*)<\/div>/g)].map(match => match[1]);
    expect(lines).toEqual(['Line one', 'Line two', 'Line three']); expect(result.html).not.toMatch(/\u2028|\u2029/);
  });
  it('produces a real safe STORE ZIP with client parts and full README/licence', async () => {
    const buffer = await createBeadBundle({ parts: [{ name: '图纸.png', buffer: Buffer.from([1, 2]) }, { name: '采购.csv', buffer: Buffer.from('fixture') }], readme: '客户说明', license: '许可原文' }, dependencies);
    const zip = await JSZip.loadAsync(buffer); expect(Object.keys(zip.files).sort()).toEqual(['LICENSE.txt', 'README.txt', '图纸.png', '采购.csv'].sort()); expect(await zip.file('LICENSE.txt').async('string')).toBe('许可原文'); expect([...await zip.file('图纸.png').async('uint8array')]).toEqual([1, 2]);
    expect(Object.values(zip.files).every(file => file._data.compression.magic === '\x00\x00')).toBe(true);
  });
  it.each(['../image.png', 'a/b.csv', 'a\\b.json', 'C:evil.txt', 'CON.txt', 'bad?.png'])('rejects unsafe ZIP basenames: %s', async name => await expect(createBeadBundle({ parts: [{ name, buffer: Buffer.from('x') }], readme: '', license: '' }, dependencies)).rejects.toThrow('文件名'));
  it('rejects case-colliding names and an aggregate payload above 100MiB before generating a ZIP', async () => {
    await expect(createBeadBundle({ parts: [{ name: 'README.txt', buffer: Buffer.from('x') }], readme: '', license: '' }, dependencies)).rejects.toThrow('重复');
    const shared = Buffer.alloc(7 * 1024 * 1024); await expect(createBeadBundle({ parts: Array.from({ length: 16 }, (_, i) => ({ name: `part${i}.bin`, buffer: shared })), readme: '', license: '' }, dependencies)).rejects.toThrow('100MB');
  });
});
