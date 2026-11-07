import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../../scripts/verify-bead-native.cjs', import.meta.url), 'utf8');
const dispatch = source.slice(source.lastIndexOf('\nif (process.versions.electron'), source.lastIndexOf('\nmodule.exports'));

function execute({ electron = false, main = false, args = ['--native-child', 'fixture-directory', 'fixture-source', 'fixture-nonce'] } = {}) {
  const module = {}, calls = { native: [], parent: [], output: [] };
  const process = { versions: electron ? { electron: '45.1.0' } : {}, argv: ['runtime', 'verify-bead-native.cjs', ...args], stdout: { write: value => calls.output.push(value) }, stderr: { write: value => calls.output.push(value) } };
  new vm.Script(dispatch).runInNewContext({ module, require: { main: main === true ? module : main === 'foreign' ? {} : undefined }, path, process, errorsOf: String, nativeFixture: (...input) => calls.native.push(input), runProbe: (...input) => { calls.parent.push(input); return Promise.resolve(); } });
  return calls;
}

describe('native bead CLI dispatch', () => {
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
