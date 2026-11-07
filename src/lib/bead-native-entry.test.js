import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../../scripts/verify-bead-native.cjs', import.meta.url), 'utf8');
const dispatch = source.slice(source.lastIndexOf('\nif (process.versions.electron'), source.lastIndexOf('\nmodule.exports'));
const { pdfAssetDirectory, pdfBodyText, pdfTextChecks, hotpinkPixelCount } = createRequire(import.meta.url)('../../scripts/verify-bead-native.cjs');

function execute({ electron = false, main = false, args = ['--native-child', 'fixture-directory', 'fixture-source', 'fixture-nonce'] } = {}) {
  const module = {}, calls = { native: [], parent: [], output: [] };
  const process = { versions: electron ? { electron: '45.1.0' } : {}, argv: ['runtime', 'verify-bead-native.cjs', ...args], stdout: { write: value => calls.output.push(value) }, stderr: { write: value => calls.output.push(value) } };
  new vm.Script(dispatch).runInNewContext({ module, require: { main: main === true ? module : main === 'foreign' ? {} : undefined }, path, process, errorsOf: String, nativeFixture: (...input) => calls.native.push(input), runProbe: (...input) => { calls.parent.push(input); return Promise.resolve(); } });
  return calls;
}

describe('native bead CLI dispatch', () => {
  it('rejects the exact PDF.js debug fallback colour while allowing the fixture palette and grayscale hatch', () => {
    expect(hotpinkPixelCount(new Uint8Array([255, 0, 0, 255, 255, 255, 255, 255, 180, 180, 180, 255, 255, 0, 255, 255]))).toBe(0);
    expect(hotpinkPixelCount(new Uint8Array([255, 105, 180, 255, 255, 105, 180, 255]))).toBe(2);
  });

  it('extracts only ordered body text across two pages while excluding known header/footer regions', () => {
    const view = [0, 0, 595, 842], at = (str, topMm) => ({ str, transform: [1, 0, 0, 1, 30, view[3] - topMm * 72 / 25.4] });
    const pages = [[at('列61–61·行81–81', 25), at('Permission is hereby granted,', 32), at('free of charge', 37), at('Footer1', 290)], [at('Header2', 25), at('to any person.', 32), at('native-v1', 37), at('LONGCODE1234', 42), at('Footer2', 290)]];
    const body = pages.map(items => pdfBodyText(items, view)), expected = { version: 'native-v1', license: 'Permission is hereby granted, free of charge to any person.', longCode: 'LONGCODE1234' };
    expect(body).toEqual(['Permission is hereby granted, free of charge', 'to any person. native-v1 LONGCODE1234']);
    expect(pdfTextChecks(body, expected)).toEqual({ version: true, license: true, longCode: true });
    expect(pages[0].map(item => item.str).join(' ')).toContain('列61–61·行81–81');
    expect(pdfTextChecks(body.toReversed(), expected).license).toBe(false);
    expect(pdfTextChecks([body[0].replace('free of charge', ''), body[1]], expected).license).toBe(false);
  });

  it.each([
    ['D:\\a\\repo\\node_modules\\pdfjs-dist\\cmaps', 'D:/a/repo/node_modules/pdfjs-dist/cmaps/'],
    ['D:\\a\\repo\\node_modules\\pdfjs-dist\\standard_fonts\\', 'D:/a/repo/node_modules/pdfjs-dist/standard_fonts/'],
    ['/tmp/deps/pdfjs-dist/cmaps/', '/tmp/deps/pdfjs-dist/cmaps/'],
  ])('formats a local PDF.js asset directory with the required trailing forward slash: %s', (input, expected) => {
    expect(pdfAssetDirectory(input)).toBe(expected);
  });

  it.each([false, 'foreign'])('runs the Electron child when default_app imports the entry with require.main=%s', main => {
    const calls = execute({ electron: true, main });
    expect(calls.native).toEqual([[path.resolve('fixture-directory'), path.resolve('fixture-source'), 'fixture-nonce']]);
    expect(calls.parent).toEqual([]);
  });

  it('also runs the Electron child when require.main points to the entry', () => {
    expect(execute({ electron: true, main: true }).native).toHaveLength(1);
  });

  it('ignores trailing Chromium isolation switches when selecting the child arguments', () => {
    const calls = execute({ electron: true, args: ['--native-child', 'fixture-directory', 'fixture-source', 'fixture-nonce', '--user-data-dir=fixture-profile', '--disk-cache-dir=fixture-cache'] });
    expect(calls.native[0]).toEqual([path.resolve('fixture-directory'), path.resolve('fixture-source'), 'fixture-nonce']);
    expect(calls.parent).toEqual([]);
  });

  it('has no launch side effects when Node imports helper exports', () => {
    expect(execute()).toEqual({ native: [], parent: [], output: [] });
  });

  it('keeps the Node parent CLI route', () => {
    const calls = execute({ main: true, args: [] });
    expect(calls.parent).toEqual([[[]]]);
    expect(calls.native).toEqual([]);
  });

  it('keeps --help free from native launches', () => {
    const calls = execute({ main: true, args: ['--help'] });
    expect(calls.parent).toEqual([]);
    expect(calls.native).toEqual([]);
    expect(calls.output[0]).toContain('node scripts/verify-bead-native.cjs');
  });
});
