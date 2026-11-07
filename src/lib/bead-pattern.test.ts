import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadDocument, BeadPalette, BeadPattern, BeadRaster } from '../bead-types';
import { DEFAULT_BEAD_SETTINGS, DEFAULT_BEAD_PROCUREMENT, beadSettingsIssue, beadPaletteIssue, beadPatternIssue, beadProcurementIssue, beadDocumentIssue, createBeadPattern, beadUsage, beadTotals, editBeadCells, replaceBeadColor } from './bead-pattern';

function palette(): BeadPalette {
  const values = [['R1', '#FF0000'], ['B1', '#0000FF'], ['G1', '#00FF00'], ['W1', '#FFFFFF'], ['K1', '#000000'], ['T1', '#FFFFFF'], ['P1', '#800080'], ['D1', '#800000']];
  return { id: 'fixture-palette', name: '可核对测试色卡', brand: 'fixture', version: '2026-11-07', sourceUrl: '', sourceNote: 'synthetic', license: 'test fixture', colors: values.map(([code, hex]) => ({ code, name: code, hex, rgb: [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)], kind: code === 'T1' ? 'transparent' : 'solid', automatic: code !== 'T1' })) };
}
const settings = () => ({ ...DEFAULT_BEAD_SETTINGS, columns: 8, rows: 8, maxColors: 0 });
function raster(width = 8, height = 8, pixel = (x: number, _y: number): number[] => x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]): BeadRaster {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, pixels };
}
function pattern(): BeadPattern { return createBeadPattern(raster(), settings(), palette()); }
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw Error('Bead core must remain local'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('deterministic reference-to-bead cells', () => {
  it('uses actual palette indexes with exact counts and an independent pinned palette snapshot', () => {
    const colors = palette(), source = raster(), previous = Array.from(source.pixels);
    const result = createBeadPattern(source, settings(), colors);
    expect(result.cells.slice(0, 8)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(beadTotals(result)).toEqual({ totalCells: 64, beads: 64, emptyCells: 0, colorsUsed: 2 });
    expect(beadUsage(result, DEFAULT_BEAD_PROCUREMENT).map(row => [row.code, row.cells])).toEqual([['B1', 32], ['R1', 32]]);
    colors.colors[0].rgb[0] = 0; expect(result.palette.colors[0].rgb[0]).toBe(255); expect(Array.from(source.pixels)).toEqual(previous);
  });
  it('separates empty image alpha, opaque white beads and manually painted physical transparent beads', () => {
    const result = createBeadPattern(raster(8, 8, (x, y) => y === 0 ? [255, 255, 255, 0] : x < 4 ? [255, 255, 255, 255] : [0, 0, 255, 255]), settings(), palette());
    expect(beadTotals(result)).toEqual({ totalCells: 64, beads: 56, emptyCells: 8, colorsUsed: 2 });
    expect(beadUsage(result, DEFAULT_BEAD_PROCUREMENT).map(row => row.code)).not.toContain('T1');
    const painted = editBeadCells(result, [{ index: 0, value: 6 }]);
    expect(beadUsage(painted, DEFAULT_BEAD_PROCUREMENT).find(row => row.code === 'T1')).toMatchObject({ cells: 1, required: 1, kind: 'transparent' });
    expect(beadTotals(painted).beads).toBe(57); expect(result.cells[0]).toBe(0);
    const allTransparent = createBeadPattern(raster(8, 8, () => [255, 0, 0, 0]), { ...settings(), alphaThreshold: 0 }, palette());
    expect(beadTotals(allTransparent).beads).toBe(0);
  });
  it('retains the complete reference with empty margins and offers explicit cover cropping', () => {
    const source = raster(8, 4);
    const contained = createBeadPattern(source, settings(), palette());
    expect(beadTotals(contained)).toMatchObject({ beads: 32, emptyCells: 32 }); expect(contained.cells.slice(0, 16).every(cell => cell === 0)).toBe(true);
    const covered = createBeadPattern(source, { ...settings(), fit: 'cover' }, palette());
    expect(beadTotals(covered)).toMatchObject({ beads: 64, emptyCells: 0 });
  });
  it('area-averages a high-frequency reference before matching instead of taking one arbitrary pixel', () => {
    const result = createBeadPattern(raster(16, 16, (x, y) => (x + y) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]), settings(), palette());
    expect(new Set(result.cells)).toEqual(new Set([7]));
  });
  it('correctly unpremultiplies native BGRA before palette matching and applies the alpha threshold', () => {
    const source = raster(8, 8, () => [0, 0, 128, 128]); source.format = 'bgra'; source.premultiplied = true;
    expect(new Set(createBeadPattern(source, settings(), palette()).cells)).toEqual(new Set([1]));
    expect(beadTotals(createBeadPattern(source, { ...settings(), alphaThreshold: 129 }, palette())).beads).toBe(0);
    expect(new Set(createBeadPattern(raster(8, 8, () => [255, 0, 0, 255]), { ...settings(), alphaThreshold: 255 }, palette()).cells)).toEqual(new Set([1]));
  });
  it('limits procurement colour count without inventing a colour or selecting manual materials', () => {
    const result = createBeadPattern(raster(8, 8, (x, y) => y < 6 ? [255, 0, 0, 255] : x < 4 ? [0, 0, 255, 255] : [0, 255, 0, 255]), { ...settings(), maxColors: 1 }, palette());
    expect(beadTotals(result)).toMatchObject({ beads: 64, colorsUsed: 1 }); expect(new Set(result.cells)).toEqual(new Set([1]));
  });
  it('supports the maximum 256×256 grid using bounded source pixels', () => {
    const result = createBeadPattern(raster(1024, 1024, () => [255, 0, 0, 255]), { ...settings(), columns: 256, rows: 256 }, palette());
    expect(result.cells).toHaveLength(65536); expect(beadTotals(result).beads).toBe(65536);
  });
  it('rejects malformed buffers, dimensions and settings before sampling', () => {
    expect(() => createBeadPattern({ ...raster(), pixels: new Uint8Array(3) }, settings(), palette())).toThrow('像素');
    expect(() => createBeadPattern(raster(), { ...settings(), columns: 257 }, palette())).toThrow('8–256');
    expect(() => createBeadPattern({ ...raster(), width: 1025 }, settings(), palette())).toThrow('1024');
  });
});

describe('cell-based usage, editing and procurement', () => {
  it('rejects numeric IDs, colour codes and Hex instead of coercing them into valid export metadata', () => {
    const numericId = palette(); numericId.id = 123 as unknown as string; expect(beadPaletteIssue(numericId)).toBeTruthy();
    const numericCode = palette(); numericCode.colors[0].code = 1 as unknown as string; expect(beadPaletteIssue(numericCode)).toBeTruthy();
    const numericHex = palette(); numericHex.colors[0].hex = 123456 as unknown as string; expect(beadPaletteIssue(numericHex)).toBeTruthy();
  });
  it('rejects sparse IPC arrays instead of counting nonexistent cells or accepting missing RGB channels', () => {
    const value = pattern(); expect(beadPatternIssue({ ...value, cells: new Array(64) })).toBeTruthy();
    expect(() => beadTotals({ ...value, cells: new Array(64) })).toThrow('格子');
    const colors = palette(); colors.colors[0].rgb = new Array(3) as [number, number, number]; expect(beadPaletteIssue(colors)).toContain('RGB');
    expect(() => editBeadCells(value, new Array(1))).toThrow('格子');
  });
  it('calculates copies, reserve, stock deficits and per-colour pack sizes from the current cells', () => {
    const rows = beadUsage(pattern(), { copies: 2, lossPercent: 5, defaultPackSize: 25, stock: { R1: 1, B1: 100 }, packSizes: { R1: 30 } });
    expect(rows.find(row => row.code === 'R1')).toMatchObject({ cells: 32, required: 64, reserve: 4, stock: 1, shortage: 67, packSize: 30, bags: 3 });
    expect(rows.find(row => row.code === 'B1')).toMatchObject({ shortage: 0, bags: 0 });
  });
  it('uses integer basis points so a mathematically exact reserve does not gain an extra bead', () => {
    const result = { ...pattern(), cells: new Array(64).fill(1) };
    const row = beadUsage(result, { ...DEFAULT_BEAD_PROCUREMENT, copies: 25, lossPercent: 7 })[0];
    expect(row.required).toBe(1600); expect(row.reserve).toBe(112);
  });
  it('keeps counts correct after paint, erase, global replacement and restoring an undo snapshot', () => {
    const before = pattern(), painted = editBeadCells(before, [{ index: 0, value: 3 }, { index: 1, value: 0 }]);
    expect(beadTotals(painted)).toMatchObject({ beads: 63, emptyCells: 1, colorsUsed: 3 });
    const replaced = replaceBeadColor(painted, 2, 1); expect(beadUsage(replaced, DEFAULT_BEAD_PROCUREMENT).some(row => row.code === 'B1')).toBe(false);
    const restored = JSON.parse(JSON.stringify(before)); expect(beadTotals(restored)).toEqual(beadTotals(before)); expect(before.cells[0]).toBe(1);
    expect(() => editBeadCells(before, [{ index: -1, value: 1 }])).toThrow(); expect(() => editBeadCells(before, [{ index: 0, value: 99 }])).toThrow();
    expect(() => replaceBeadColor(before, 0, -1)).toThrow();
  });
  it('validates palette codes, actual colour values and manual-only materials', () => {
    const value = palette(); expect(beadPaletteIssue(value)).toBeUndefined();
    const duplicate = palette(); duplicate.colors[1].code = 'R1'; expect(beadPaletteIssue(duplicate)).toBeTruthy();
    const mismatch = palette(); mismatch.colors[0].rgb[0] = 0; expect(beadPaletteIssue(mismatch)).toContain('RGB');
    const transparent = palette(); transparent.colors[5].automatic = true; expect(beadPaletteIssue(transparent)).toContain('材质');
    const noSolid = palette(); noSolid.colors = [noSolid.colors[5]]; expect(beadPaletteIssue(noSolid)).toContain('至少');
  });
  it('rejects fabricated cell totals, invalid procurement and inconsistent document dimensions', () => {
    const value = pattern(); expect(beadPatternIssue({ ...value, cells: value.cells.slice(1) })).toBeTruthy();
    expect(beadProcurementIssue({ ...DEFAULT_BEAD_PROCUREMENT, copies: 0 })).toBeTruthy();
    expect(beadProcurementIssue({ ...DEFAULT_BEAD_PROCUREMENT, packSizes: { R1: 0 } })).toBeTruthy();
    expect(beadProcurementIssue({ ...DEFAULT_BEAD_PROCUREMENT, lossPercent: 5.555 })).toBeTruthy();
    expect(beadSettingsIssue({ ...settings(), boardColumns: 0 })).toBeTruthy();
    const document: BeadDocument = { type: 'xuzuo-bead-document', version: 1, id: 'doc', projectId: 'project', revision: 1, title: '测试图纸', settings: settings(), pattern: value, procurement: structuredClone(DEFAULT_BEAD_PROCUREMENT), updatedAt: '2026-11-07T01:00:00Z' };
    expect(beadDocumentIssue(document)).toBeUndefined(); expect(beadDocumentIssue({ ...document, settings: { ...document.settings, columns: 9 } })).toContain('不一致');
  });
});
