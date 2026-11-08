import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { deflateSync, crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { createAnimationTool, cleanEnvironment } = require('../../electron/animation-tool.cjs');
const owned = [];
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
const until = async predicate => { for (let index = 0; index < 200 && !predicate(); index++) await delay(); expect(predicate()).toBe(true); };
function png(width = 64, height = 64) {
  const chunk = (type, body) => { const name = Buffer.from(type), output = Buffer.alloc(body.length + 12); output.writeUInt32BE(body.length); name.copy(output, 4); body.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, body])), body.length + 8); return output; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-animation-node-')), executable = path.join(directory, 'owned-helper.exe'), source = path.join(directory, 'source.png');
  await fs.writeFile(executable, 'MZ synthetic helper; never executed'); await fs.writeFile(source, png());
  const f = { directory, executable, source, calls: [], children: [], stops: [], rendered: [], hold: false, releases: [], active: 0, maximum: 0 };
  const manifest = { version: 1, mode: 'gif', style: 'pixel-light', title: 'Synthetic adapter protocol', width: 64, height: 64, fps: 10, loopMs: 200, background: 'transparent', atlases: [{ id: 'source', path: source }], entries: [{ id: 'first', caption: '', motion: 'sway', frames: [{ atlasId: 'source', cell: [0, 0], grid: [1, 1], durationMs: 200 }] }] };
  async function output(value, target) {
    const frames = ['frame-1.png', 'frame-2.png']; for (const name of ['cover.png', ...frames]) await fs.writeFile(path.join(target, name), png());
    const gif = Buffer.alloc(24); gif.write('GIF89a'); gif.writeUInt16LE(64, 6); gif.writeUInt16LE(64, 8); await fs.writeFile(path.join(target, 'animation.gif'), gif);
    const result = { outputs: [{ entryId: value.entries[0].id, coverPath: 'cover.png', framePaths: frames, gifPath: 'animation.gif', report: { width: 64, height: 64, frames: 2, loopMs: 200, loop: 0, transparent: true, warnings: [], durationsMs: [80, 120] } }] };
    if (value.mode === 'atlas') { delete result.outputs[0].gifPath; result.outputs[0].report.loopMs = 0; delete result.outputs[0].report.durationsMs; }
    if (value.exportFrames) { await fs.writeFile(path.join(target, 'frames.zip'), Buffer.from([80, 75, 3, 4, 0, 0, 0, 0])); result.archivePath = 'frames.zip'; }
    return result;
  }
  const spawnProcess = vi.fn((file, args, settings) => {
    const child = new EventEmitter(); child.pid = 0; child.exitCode = null; child.stdout = new PassThrough(); child.stderr = new PassThrough(); let body = '';
    child.stdin = new Writable({ write(chunk, _encoding, done) { body += chunk.toString('utf8'); done(); } });
    child.kill = vi.fn(() => { if (child.exitCode !== null) return; child.exitCode = 1; child.stdout.end(); child.stderr.end(); child.emit('close', 1); });
    const call = { file, args, settings, child, input: undefined }; f.calls.push(call); f.children.push(child);
    child.stdin.on('finish', () => { void (async () => {
      if (args.includes('status')) { if (f.badStatus) child.stdout.end('{"available":true,"protocol":2,"offline":true}'); else child.stdout.end('{"available":true,"protocol":1,"offline":true}'); child.exitCode = 0; child.emit('close', 0); return; }
      call.input = JSON.parse(body); f.rendered.push(call); f.active++; f.maximum = Math.max(f.maximum, f.active); child.once('close', () => { f.active--; });
      if (f.hold) await new Promise(resolve => f.releases.push(resolve));
      if (child.exitCode !== null) return;
      const target = args[args.indexOf('--output') + 1], result = await output(call.input, target);
      if (f.mutate) await f.mutate(result, target);
      if (f.raw) child.stdout.end(f.raw); else child.stdout.end(JSON.stringify(result));
      child.exitCode = 0; child.emit('close', 0);
    })().catch(error => { child.stdout.end(JSON.stringify({ error: error.message })); child.exitCode = 1; child.emit('close', 1); }); });
    return child;
  });
  const changes = typeof options === 'function' ? await options(f) : options;
  f.tool = createAnimationTool({ executablePath: executable, directory, spawnProcess, terminateProcess: async child => { f.stops.push(child); child.kill(); }, ...changes });
  f.output = async name => { const target = path.join(directory, name); await fs.mkdir(target); return target; };
  f.manifest = manifest; owned.push(f); return f;
}
afterEach(async () => { for (const f of owned.splice(0)) { f.hold = false; f.releases.splice(0).forEach(resolve => resolve()); await f.tool.shutdown(); const directory = await fs.realpath(f.directory); expect(path.dirname(directory)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-animation-node-/); await fs.rm(directory, { recursive: true, force: true }); } vi.restoreAllMocks(); });

describe('offline animation process adapter (synthetic helper protocol, no Python/GUI/model)', () => {
  it('accepts a same-layer DOS short alias only after canonical component and file identity checks', async () => {
    let shortSource;
    const f = await fixture(async value => {
      const actual = await fs.realpath(value.directory), alias = path.join(path.dirname(actual), 'XUZUOA~1');
      const map = filename => filename === alias || filename.startsWith(alias + path.sep) ? actual + filename.slice(alias.length) : filename;
      shortSource = path.join(alias, 'source.png');
      return { executablePath: path.join(alias, 'owned-helper.exe'), fileSystem: { ...fs, lstat: filename => fs.lstat(map(filename)), realpath: filename => fs.realpath(map(filename)), stat: filename => fs.stat(map(filename)) } };
    });
    await expect(f.tool.status()).resolves.toEqual({ available: true });
    const manifest = { ...f.manifest, atlases: [{ id: 'source', path: shortSource }] };
    await expect(f.tool.run(manifest, await f.output('short-source-output'))).resolves.toBeTruthy();
    expect(f.rendered[0].input.atlases[0].path).toBe(shortSource);
    expect(await fs.readFile(f.source)).toEqual(png());
  });
  it('does not treat arbitrary canonical redirects as DOS aliases', async () => {
    const f = await fixture(async value => {
      const actual = await fs.realpath(value.directory), alias = path.join(path.dirname(actual), 'normal-redirect');
      const map = filename => filename === alias || filename.startsWith(alias + path.sep) ? actual + filename.slice(alias.length) : filename;
      return { executablePath: path.join(alias, 'owned-helper.exe'), fileSystem: { ...fs, lstat: filename => fs.lstat(map(filename)), realpath: filename => fs.realpath(map(filename)), stat: filename => fs.stat(map(filename)) } };
    });
    await expect(f.tool.status()).resolves.toMatchObject({ available: false }); expect(f.calls).toHaveLength(0);
  });
  it('rejects an alias whose file identity changes even if its spelling looks like DOS 8.3', async () => {
    const f = await fixture(async value => {
      const actual = await fs.realpath(value.directory), alias = path.join(path.dirname(actual), 'XUZUOA~1');
      const map = filename => filename === alias || filename.startsWith(alias + path.sep) ? actual + filename.slice(alias.length) : filename;
      return { executablePath: path.join(alias, 'owned-helper.exe'), fileSystem: { ...fs, lstat: filename => fs.lstat(map(filename)), realpath: filename => fs.realpath(map(filename)), stat: async filename => { const stat = await fs.stat(map(filename)); return filename.startsWith(alias + path.sep) ? Object.assign(Object.create(stat), { ino: stat.ino + 1 }) : stat; } } };
    });
    await expect(f.tool.status()).resolves.toMatchObject({ available: false }); expect(f.calls).toHaveLength(0);
  });
  it('rejects junction and symlink components even when their names look like DOS 8.3', async () => {
    const f = await fixture(async value => {
      const actual = await fs.realpath(value.directory), alias = path.join(path.dirname(actual), 'XUZUOA~1');
      const map = filename => filename === alias || filename.startsWith(alias + path.sep) ? actual + filename.slice(alias.length) : filename;
      return { executablePath: path.join(alias, 'owned-helper.exe'), fileSystem: { ...fs, lstat: filename => filename === alias ? Promise.resolve({ isSymbolicLink: () => true, isDirectory: () => true }) : fs.lstat(map(filename)), realpath: filename => fs.realpath(map(filename)), stat: filename => fs.stat(map(filename)) } };
    });
    await expect(f.tool.status()).resolves.toMatchObject({ available: false }); expect(f.calls).toHaveLength(0);
  });
  it('scrubs credentials, proxies and Python injection environment', () => {
    const clean = cleanEnvironment({ PATH: 'safe', SystemRoot: 'C:/Windows', OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', HTTPS_PROXY: 'secret', GITHUB_TOKEN: 'secret', PYTHONPATH: 'inject', NODE_OPTIONS: 'inject' });
    expect(clean.PATH).toBe('safe'); expect(clean.PYTHONNOUSERSITE).toBe('1'); expect(clean.PYTHONDONTWRITEBYTECODE).toBe('1'); expect(Object.keys(clean).some(key => /KEY|TOKEN|PROXY|PYTHONPATH|NODE_OPTIONS/.test(key))).toBe(false);
  });
  it('status is on-demand, cached, offline protocol checked and never installs dependencies', async () => {
    const f = await fixture(); expect(f.calls).toHaveLength(0); await expect(f.tool.status()).resolves.toEqual({ available: true }); await expect(f.tool.status()).resolves.toEqual({ available: true }); expect(f.calls).toHaveLength(1); expect(f.calls[0].args).toEqual(['status']); expect(f.calls[0].settings).toMatchObject({ windowsHide: true, shell: false, cwd: f.directory });
  });
  it('missing packaged runtime is unavailable rather than trying a user Python install', async () => {
    const f = await fixture(); const spawnProcess = vi.fn(); const unavailable = createAnimationTool({ executablePath: path.join(f.directory, 'missing.exe'), packaged: true, spawnProcess }); await expect(unavailable.status()).resolves.toMatchObject({ available: false, reason: expect.stringContaining('完整桌面版本') }); expect(spawnProcess).not.toHaveBeenCalled(); await unavailable.shutdown();
  });
  it('unknown protocol is rejected without accepting a fake ready state', async () => {
    const f = await fixture(); f.badStatus = true; await expect(f.tool.status()).resolves.toMatchObject({ available: false, reason: expect.stringContaining('协议') });
  });
  it('validates scoped output files and actual dimensions while preserving real durations', async () => {
    const f = await fixture(), out = await f.output('output'); const result = await f.tool.run(f.manifest, out);
    expect(result.outputs[0]).toMatchObject({ entryId: 'first', coverPath: path.join(out, 'cover.png'), gifPath: path.join(out, 'animation.gif'), report: { frames: 2, durationsMs: [80, 120], loopMs: 200 } }); expect(f.rendered[0].input).toEqual(f.manifest); expect(await fs.readFile(f.source)).toEqual(png());
  });
  it('rejects secret and arbitrary command fields before starting any helper', async () => {
    const f = await fixture(); await expect(f.tool.run({ ...f.manifest, apiKey: 'never-pipe-this', command: 'do-not-execute' }, await f.output('output'))).rejects.toThrow('白名单'); expect(f.calls).toHaveLength(0);
  });
  it('does not overwrite an existing output directory', async () => {
    const f = await fixture(), out = await f.output('output'); await fs.writeFile(path.join(out, 'keep.txt'), 'keep'); await expect(f.tool.run(f.manifest, out)).rejects.toThrow('须为空'); expect(await fs.readFile(path.join(out, 'keep.txt'), 'utf8')).toBe('keep'); expect(f.rendered).toHaveLength(0);
  });
  it('rejects a helper path escape without changing the source', async () => {
    const f = await fixture(); f.mutate = result => { result.outputs[0].coverPath = '../source.png'; }; await expect(f.tool.run(f.manifest, await f.output('output'))).rejects.toThrow('专属输出目录'); expect(await fs.readFile(f.source)).toEqual(png());
  });
  it('rejects mismatched dimensions, timing and fake GIF mode results', async () => {
    for (const [name, mutate] of [['size', result => { result.outputs[0].report.width = 65; }], ['duration', result => { result.outputs[0].report.durationsMs = [80, 130]; }], ['gif', result => { delete result.outputs[0].gifPath; }]]) {
      const f = await fixture(); f.mutate = mutate; await expect(f.tool.run(f.manifest, await f.output(name))).rejects.toThrow();
    }
  });
  it('opt-in streamed frames ZIP is returned only when requested', async () => {
    const f = await fixture(), out = await f.output('output'); const result = await f.tool.run({ ...f.manifest, exportFrames: true }, out); expect(result.archivePath).toBe(path.join(out, 'frames.zip'));
  });
  it('serializes multiple jobs without spawning simultaneous render processes', async () => {
    const f = await fixture(); f.hold = true; const first = f.tool.run(f.manifest, await f.output('first')), second = f.tool.run(f.manifest, await f.output('second')); await until(() => f.rendered.length === 1); expect(f.maximum).toBe(1); f.hold = false; f.releases.splice(0).forEach(resolve => resolve()); await Promise.all([first, second]); expect(f.maximum).toBe(1); expect(f.rendered).toHaveLength(2);
  });
  it('explicit cancel terminates only its owned child and preserves queued sources', async () => {
    const f = await fixture(); f.hold = true; const controller = new AbortController(), promise = f.tool.run(f.manifest, await f.output('output'), { signal: controller.signal }); const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' }); await until(() => f.rendered.length === 1); controller.abort(); await rejection; await f.tool.drain(); expect(f.stops).toEqual([f.rendered[0].child]); expect(await fs.readFile(f.source)).toEqual(png());
  });
  it('timeout cancels an owned hung process instead of leaving a queue stuck', async () => {
    const f = await fixture({ timeoutMs: 60 }); f.hold = true; await expect(f.tool.run(f.manifest, await f.output('output'))).rejects.toThrow('超时'); await f.tool.drain(); expect(f.stops).toHaveLength(1);
  });
  it('prepareClose temporarily quiesces and drains while shutdown permanently stops', async () => {
    const f = await fixture(); f.hold = true; const first = f.tool.run(f.manifest, await f.output('first')), second = f.tool.run(f.manifest, await f.output('second')); const failures = [expect(first).rejects.toMatchObject({ name: 'AbortError' }), expect(second).rejects.toMatchObject({ name: 'AbortError' })]; await until(() => f.rendered.length === 1); await f.tool.prepareClose(); await Promise.all(failures); f.hold = false; f.releases.splice(0).forEach(resolve => resolve()); await expect(f.tool.run(f.manifest, await f.output('after-exit-cancelled'))).resolves.toBeTruthy(); await f.tool.shutdown(); await expect(f.tool.run(f.manifest, await f.output('after-shutdown'))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
