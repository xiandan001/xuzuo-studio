import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BEAD_PALETTES, DEFAULT_BEAD_PALETTE_ID } from '../data/bead-palettes';
import { parseBeadPalette } from './bead-palettes';
import { beadPaletteIssue } from './bead-pattern';

describe('pinned bead palettes and data provenance', () => {
  it('ships two separate 221-code snapshots with the expected stable default', () => {
    expect(DEFAULT_BEAD_PALETTE_ID).toBe('mard-221-hansbug-178dafb');
    expect(BEAD_PALETTES.map(palette => palette.id)).toEqual([DEFAULT_BEAD_PALETTE_ID, 'artkal-m221-hansbug-178dafb']);
    for (const palette of BEAD_PALETTES) { expect(palette.colors).toHaveLength(221); expect(new Set(palette.colors.map(color => color.code)).size).toBe(221); expect(beadPaletteIssue(palette)).toBeUndefined(); }
  });
  it('retains exact independent source values rather than merging similarly named colours', () => {
    const mard = BEAD_PALETTES[0], artkal = BEAD_PALETTES[1];
    expect(mard.colors.find(color => color.code === 'A1')).toMatchObject({ hex: '#FAF5CD', rgb: [250, 245, 205] });
    expect(artkal.colors.find(color => color.code === 'MA1')).toMatchObject({ hex: '#FFF6D4', rgb: [255, 246, 212] });
    expect(mard.colors.some(color => color.code === 'MA1')).toBe(false); expect(artkal.colors.some(color => color.code === 'A1')).toBe(false);
  });
  it('keeps recorded opaque white distinct from explicitly transparent, manual physical beads', () => {
    const mard = BEAD_PALETTES[0], artkal = BEAD_PALETTES[1];
    expect(mard.colors.find(color => color.code === 'H1')).toMatchObject({ kind: 'solid', hex: '#FFFFFF', rgb: [255, 255, 255], automatic: true });
    expect(artkal.colors.find(color => color.code === 'MH1')).toMatchObject({ kind: 'transparent', hex: '#FFFFFF', rgb: [255, 255, 255], automatic: false });
    expect(artkal.colors.filter(color => color.automatic)).toHaveLength(220);
  });
  it('keeps valid codes and matching canonical hex/RGB for every supplied colour', () => {
    expect(BEAD_PALETTES.length).toBeGreaterThan(0);
    for (const palette of BEAD_PALETTES) for (const color of palette.colors) {
      expect(color.code).toMatch(/^[A-Z0-9][A-Z0-9_-]{0,11}$/); expect(color.name).toBeTruthy(); expect(color.name.length).toBeLessThanOrEqual(80);
      expect(color.hex).toMatch(/^#[0-9A-F]{6}$/); expect(color.rgb).toHaveLength(3);
      expect('#' + color.rgb.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()).toBe(color.hex);
      if (color.kind !== 'solid') expect(color.automatic).toBe(false);
    }
  });
  it('carries the exact source commit, truthful quality notes and full distributable Data licence', () => {
    expect(BEAD_PALETTES[0]?.sourceNote).toContain('社区参考'); expect(BEAD_PALETTES[1]?.sourceNote).toContain('220'); expect(BEAD_PALETTES[1]?.sourceNote).toContain('MH1');
    for (const palette of BEAD_PALETTES) {
      expect(palette.sourceUrl).toContain('178dafbc9e77d3de556550dbd058270200129186');
      expect(palette.license).toContain('Copyright (c) 2026 HansBug'); expect(palette.license).toContain('this data and associated documentation'); expect(palette.license).toContain('The above copyright notice');
    }
  });
  it('pins every code, index order, RGB and material flag and retains the exact upstream licence asset', () => {
    const expected = ['1898d577d616f35bad4a9e36d0acf34ee2e0b6fb1e896a35e2c5386d6bb8da7d', '7444477fc06db217eb9e57de7f7381afede5693e61be2a9b6ff5687faef87098'];
    BEAD_PALETTES.forEach((palette, index) => {
      const content = JSON.stringify(palette.colors.map(({ code, hex, rgb, kind, automatic }) => ({ code, hex, rgb, kind, automatic })));
      expect(createHash('sha256').update(content).digest('hex')).toBe(expected[index]);
    });
    const licence = readFileSync(new URL('../../assets/licenses/pindou-color-data-MIT.txt', import.meta.url));
    expect(createHash('sha256').update(licence).digest('hex')).toBe('7ce773e89d6ae09c6c6ea0d2ec202648f57f25a259634039aea3f57f9895e97e');
    expect(BEAD_PALETTES.every(palette => palette.license === licence.toString('utf8'))).toBe(true);
    const notice = readFileSync(new URL('../../assets/licenses/pindou-color-data-NOTICE.txt', import.meta.url), 'utf8');
    for (const sha of ['556a7e0098c0055bde47f78d430cc7d36cb3788c235f0238e6a610f64a46b0bf', '82a6f68b121741b2721ea0f7b1e2a5bcc03aa64c2d2e50d755d17a4a6700c17b']) expect(notice).toContain(sha);
  });
});

describe('custom bead palette JSON import', () => {
  const color = { code: 'R1', hex: '#FF0000' };
  const parse = (input: unknown) => parseBeadPalette(JSON.stringify(input));
  it('accepts a minimal hex palette and fills explicit custom provenance without a preset identity', () => {
    const input = { colors: [{ code: ' r01 ', hex: '#ff0000' }] }, result = parse(input);
    expect(result.id).toMatch(/^custom-[a-f0-9-]+$/); expect(result.brand).toBe('自定义'); expect(result.name).toBe('自定义色卡'); expect(result.version).toBeTruthy(); expect(result.sourceUrl).toBe(''); expect(result.sourceNote).toContain('用户导入'); expect(result.license).toBe('用户提供');
    expect(result.colors).toEqual([{ code: 'R01', name: 'R01', hex: '#FF0000', rgb: [255, 0, 0], kind: 'solid', automatic: true }]); expect(beadPaletteIssue(result)).toBeUndefined();
    expect(input.colors[0].code).toBe(' r01 ');
  });
  it('accepts explicit RGB, checks simultaneous hex and preserves supplied metadata and leading-zero codes', () => {
    const result = parse({ name: '我的样品', brand: '客户色卡', version: '2026-v2', sourceUrl: 'https://example.com/palette', sourceNote: '个人测色', license: '自有数据', colors: [{ code: 'a01', name: '红色', rgb: [255, 0, 0] }, { code: 'A1', hex: '#00FF00', rgb: [0, 255, 0], automatic: false }] });
    expect(result).toMatchObject({ name: '我的样品', brand: '客户色卡', version: '2026-v2', sourceUrl: 'https://example.com/palette', sourceNote: '个人测色', license: '自有数据' });
    expect(result.colors[0]).toMatchObject({ code: 'A01', name: '红色', hex: '#FF0000' }); expect(result.colors[1]).toMatchObject({ code: 'A1', automatic: false });
  });
  it('never enables transparent or special materials as ordinary nearest-colour candidates', () => {
    const result = parse({ colors: [color, { code: 'T1', hex: '#FFFFFF', kind: 'transparent', automatic: true }, { code: 'G1', hex: '#FFFF00', kind: 'special', automatic: true }] });
    expect(result.colors[1]).toMatchObject({ kind: 'transparent', automatic: false, rgb: [255, 255, 255] }); expect(result.colors[2]).toMatchObject({ kind: 'special', automatic: false }); expect(beadPaletteIssue(result)).toBeUndefined();
  });
  it('round-trips a full palette snapshot with a new custom identity and retained source/licence', () => {
    const source = BEAD_PALETTES[1], result = parse(source);
    expect(result.id).not.toBe(source.id); expect(result.id).toMatch(/^custom-/); expect(result.colors).toEqual(source.colors); expect(result.license.trim()).toBe(source.license.trim()); expect(result.sourceUrl).toBe(source.sourceUrl);
    expect(parse(source).id).not.toBe(result.id);
  });
  it.each([null, [], 'not a palette', {}, { colors: [] }, { colors: Array.from({ length: 513 }, (_, index) => ({ code: `C${index}`, hex: '#000000' })) }].map(input => ({ input })))('rejects missing, oversized or non-object palette shapes', ({ input }) => expect(() => parse(input)).toThrow());
  it.each([
    [{ code: 'a1', hex: '#000000' }, { code: ' A1 ', hex: '#FFFFFF' }],
    [{ code: '__PROTO__', hex: '#000000' }], [{ code: 'a b', hex: '#000000' }], [{ code: 'ß1', hex: '#000000' }], [{ code: 'ABCDEFGHIJKLM', hex: '#000000' }],
    [{ code: 'R1', hex: '#F00' }], [{ code: 'R1', hex: '#FF000000' }], [{ code: 'R1', hex: 'red' }],
    [{ code: 'R1', rgb: [256, 0, 0] }], [{ code: 'R1', rgb: [1.5, 0, 0] }], [{ code: 'R1', rgb: [255, 0] }], [{ code: 'R1', rgb: [255, 0, 0, 0] }],
    [{ code: 'R1', hex: '#FF0000', rgb: [0, 0, 0] }], [{ code: 'R1', hex: '#FF0000', kind: 'clear' }], [{ code: 'R1', hex: '#FF0000', automatic: 'false' }],
    [{ code: 'T1', hex: '#FFFFFF', kind: 'transparent' }], [{ code: 'R1', hex: '#FF0000', automatic: false }], [null],
  ].map(colors => ({ colors })))('rejects invalid/duplicate codes, inconsistent colours and palettes without any solid automatic choice', ({ colors }) => expect(() => parse({ colors })).toThrow());
  it('rejects two individually valid colours whose codes become identical after trimming and ASCII uppercasing', () => {
    const colors = [{ code: 'a1', hex: '#000000' }, { code: ' A1 ', hex: '#FFFFFF' }];
    for (const single of colors) expect(parse({ colors: [single] }).colors).toHaveLength(1);
    expect(() => parse({ colors })).toThrow('唯一');
  });
  it.each([{ name: 'x'.repeat(121) }, { brand: 3 }, { version: 'x'.repeat(161) }, { sourceNote: 'x'.repeat(4001) }, { license: '' }, { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'http://example.com/palette' }])('delegates metadata boundaries to the shared validator', metadata => expect(() => parse({ ...metadata, colors: [color] })).toThrow());
  it('rejects malformed JSON or a file larger than one MiB with a readable local error', () => {
    expect(() => parseBeadPalette('{broken')).toThrow('JSON'); expect(() => parseBeadPalette(' '.repeat(1024 * 1024 + 1))).toThrow('1MB');
  });
});
