const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { crc32 } = require('node:zlib');
const { createAnimationTool } = require('../electron/animation-tool.cjs');
const { validateGif, validateLocalGif } = require('../electron/image-output-formats.cjs');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'work/animation-native-output');
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { passed: false, commit: process.env.GITHUB_SHA || null, syntheticSources: true, realLocalRuntime: true, scope: 'Actual local animation tool, file decoding, timing and process lifecycle; no model, user profile, GUI, or aesthetic acceptance', modelCalls: 0, externalRequests: 0, normalApplicationStarted: false, userProfileAccessed: false, cases: [], metrics: [], processIds: [], errors: [] };
const children = [], tools = [];
let temporary, options, phase = 'prepare', timedOut = false;
function argumentsFor(values) {
  const result = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === '--tool-exe' || value === '--python') { assert(values[index + 1] && !values[index + 1].startsWith('--')); result[value.slice(2)] = values[++index]; }
    else if (value.startsWith('--tool-exe=') || value.startsWith('--python=')) { const split = value.indexOf('='); result[value.slice(2, split)] = value.slice(split + 1); }
    else throw Error('Unknown animation acceptance argument');
  }
  assert(!(result['tool-exe'] && result.python), 'Choose the packaged helper or development Python, not both');
  if (!result.python) result['tool-exe'] = path.resolve(root, result['tool-exe'] || 'work/animation-runtime/xuzuo-animation/' + (process.platform === 'win32' ? 'xuzuo-animation.exe' : 'xuzuo-animation'));
  return result;
}
function dependencies() {
  for (const directory of [root, path.join(root, 'work/ui-build')]) {
    try { const load = createRequire(path.join(directory, 'package.json')); return { PNG: load('pngjs').PNG, unzipper: load('unzipper') }; } catch { /* Only existing project dependencies are used. */ }
  }
  throw Error('Existing PNG and ZIP verification libraries are required');
}
function lowPriority() {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Inherit an already restricted process. */ }
  if (process.platform === 'win32') spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity=[IntPtr]3`], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
}
async function present(filename) { try { await fs.lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function alive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
function makePng(PNG, columns = 3, rows = 2, altered = false) {
  const cell = 320, image = new PNG({ width: cell * columns, height: cell * rows });
  const paint = (x, y, color) => { const at = (y * image.width + x) * 4; image.data[at] = color[0]; image.data[at + 1] = color[1]; image.data[at + 2] = color[2]; image.data[at + 3] = color[3] ?? 255; };
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column, ox = column * cell, oy = row * cell, colors = [[57, 137, 170], [214, 99, 125], [129, 114, 184], [93, 158, 121], [218, 146, 67], [86, 131, 195]], color = colors[index % colors.length];
    for (let y = 48; y < 272; y++) for (let x = 42; x < 278; x++) {
      const head = ((x - 160) / 66) ** 2 + ((y - 113) / 61) ** 2 <= 1;
      const body = x >= 111 && x <= 209 && y >= 151 && y <= 266;
      const armX = altered || index % 2 ? 221 : 78, armY = index % 2 ? 127 : 196;
      const arm = ((x - armX) / 18) ** 2 + ((y - armY) / 44) ** 2 <= 1;
      if (head || body || arm) paint(ox + x, oy + y, color);
      if ((((x - 139) / 7) ** 2 + ((y - 106) / 10) ** 2 <= 1 || ((x - 181) / 7) ** 2 + ((y - 106) / 10) ** 2 <= 1) && head) paint(ox + x, oy + y, [20, 29, 43]);
    }
  }
  return PNG.sync.write(image);
}
function gifTiming(buffer) {
  assert(['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)));
  let at = 13 + (buffer[10] & 128 ? 3 * 2 ** ((buffer[10] & 7) + 1) : 0), pending, loop;
  const durations = [];
  function blocks() { const parts = []; while (at < buffer.length) { const size = buffer[at++]; if (!size) return parts; assert(at + size <= buffer.length); parts.push(buffer.subarray(at, at + size)); at += size; } throw Error('Incomplete GIF blocks'); }
  while (at < buffer.length) {
    const kind = buffer[at++];
    if (kind === 0x3b) { assert.equal(at, buffer.length); break; }
    if (kind === 0x21) {
      const label = buffer[at++], parts = blocks();
      if (label === 0xf9) { assert.equal(parts.length, 1); assert.equal(parts[0].length, 4); pending = parts[0].readUInt16LE(1) * 10; }
      if (label === 0xff && parts[0]?.toString('ascii') === 'NETSCAPE2.0') { assert.equal(parts[1]?.length, 3); assert.equal(parts[1][0], 1); loop = parts[1].readUInt16LE(1); }
      continue;
    }
    assert.equal(kind, 0x2c); assert(at + 9 <= buffer.length); const packed = buffer[at + 8]; at += 9;
    if (packed & 128) at += 3 * 2 ** ((packed & 7) + 1);
    assert(at < buffer.length); at++; blocks(); assert(Number.isInteger(pending) && pending > 0); durations.push(pending); pending = undefined;
  }
  return { frames: durations.length, loopMs: durations.reduce((sum, value) => sum + value, 0), loop, durationsMs: durations };
}
function toolFactory() {
  const tool = createAnimationTool({ directory: temporary, ...(options.python ? { developmentPython: options.python, packaged: false } : { executablePath: options['tool-exe'], packaged: true }), spawnProcess: (file, args, settings) => {
    assert(!Object.keys(settings.env).some(key => /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY|NODE_OPTIONS|PYTHONPATH/.test(key)));
    const child = spawn(file, args, settings); children.push(child); if (child.pid) report.processIds.push(child.pid); let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-16384); });
    child.once('close', () => { for (const line of stderr.split('\n')) try { const value = JSON.parse(line); if (value.stage === 'complete') report.metrics.push({ ...value, actualChildPid: child.pid }); } catch { /* Only the helper's structured metric is retained. */ } });
    return child;
  } }); tools.push(tool); return tool;
}
async function runCase(tool, manifest, name) {
  phase = name; const directory = path.join(temporary, name); await fs.mkdir(directory); const began = Date.now();
  const result = await tool.run(manifest, directory);
  report.cases.push({ name, elapsedMs: Date.now() - began, mode: manifest.mode, style: manifest.style, outputs: result.outputs.map(item => ({ entryId: item.entryId, report: item.report })) });
  return { ...result, directory };
}
async function verifyGif(PNG, item) {
  const bytes = await fs.readFile(item.gifPath), admitted = validateLocalGif(bytes), timing = gifTiming(bytes);
  assert.equal(admitted.frames, item.report.frames); assert.equal(admitted.width, item.report.width); assert.equal(admitted.height, item.report.height);
  assert.equal(timing.frames, item.report.frames); assert.equal(timing.loopMs, item.report.loopMs); assert.equal(timing.loop, 0); assert.deepEqual(timing.durationsMs, item.report.durationsMs);
  assert.equal(item.framePaths.length, timing.frames); let transparent = false;
  for (const filename of item.framePaths) { const png = PNG.sync.read(await fs.readFile(filename)); assert.equal(png.width, admitted.width); assert.equal(png.height, admitted.height); for (let at = 3; at < png.data.length; at += 4) if (png.data[at] === 0) { transparent = true; break; } }
  assert.equal(transparent, item.report.transparent);
  assert((await fs.readFile(item.coverPath)).equals(await fs.readFile(item.framePaths[0])));
  return { ...timing, bytes: bytes.length, sha256: sha(bytes), width: admitted.width, height: admitted.height };
}
async function main() {
  lowPriority(); options = argumentsFor(process.argv.slice(2));
  if (process.env.CI === 'true') { assert.match(report.commit || '', /^[a-f0-9]{40}$/); assert(options['tool-exe'] && !options.python, 'CI must test the standalone bundled runtime'); }
  assert(!await present(output), 'Previous native animation evidence is preserved; use a clean output directory'); await fs.mkdir(output, { recursive: true });
  const base = await fs.realpath(process.env.RUNNER_TEMP || os.tmpdir()); temporary = await fs.mkdtemp(path.join(base, 'xuzuo-animation-native-')); report.temporary = temporary;
  const nonce = randomUUID(); report.nonce = nonce;
  await fs.writeFile(path.join(temporary, 'owner.json'), JSON.stringify({ kind: 'xuzuo-animation-native', directory: temporary, temporaryRoot: base, nonce, commit: report.commit, userProfileAccessed: false, modelCalls: 0 }) + '\n', { flag: 'wx' });
  const { PNG, unzipper } = dependencies(), source = path.join(temporary, 'original-source.png'), repaired = path.join(temporary, 'local-repair.png');
  const sourceBytes = makePng(PNG); await fs.writeFile(source, sourceBytes); const sourceSha = sha(sourceBytes); await fs.writeFile(repaired, makePng(PNG, 3, 2, true));
  await fs.copyFile(source, path.join(output, 'synthetic-source.png'));
  report.runtime = { kind: options.python ? 'development-python' : 'packaged-standalone', path: options.python || options['tool-exe'], executableSha256: options['tool-exe'] ? sha(await fs.readFile(options['tool-exe'])) : undefined };
  const tool = toolFactory(); assert.equal((await tool.status()).available, true);
  const baseManifest = { version: 1, mode: 'gif', style: 'pixel-light', title: '原创几何吉祥物技术验收', width: 128, height: 128, fps: 10, loopMs: 800, background: 'transparent', atlases: [{ id: 'source', path: source }], entries: [{ id: 'entry-1', caption: '你好', motion: 'sway', frames: [{ atlasId: 'source', cell: [0, 0], grid: [3, 2], durationMs: 800 }] }] };
  const full = new Set(['pixel-actions', 'illustrated-actions', 'clay-mascot']), states = new Set(['lenticular', 'type-linked', 'comic-fusion']);
  for (const style of ['pixel-light', 'pixel-actions', 'illustrated-actions', 'photo-people', 'photo-pets', 'clay-mascot', 'lenticular', 'type-linked', 'comic-fusion']) {
    const manifest = structuredClone(baseManifest); manifest.style = style;
    if (full.has(style) || states.has(style)) manifest.entries[0].frames = [0, 1].map((column, index) => ({ atlasId: 'source', cell: [column, 0], grid: [3, 2], durationMs: index ? 120 : 80 }));
    if (states.has(style)) manifest.background = 'opaque';
    const result = await runCase(tool, manifest, 'route-' + style), decoded = await verifyGif(PNG, result.outputs[0]);
    report.cases.at(-1).decoded = decoded; assert.equal(decoded.loopMs, full.has(style) ? 200 : 800);
    await fs.copyFile(result.outputs[0].gifPath, path.join(output, style + '.gif')); await fs.copyFile(result.outputs[0].coverPath, path.join(output, style + '-cover.png'));
  }
  const atlasManifest = structuredClone(baseManifest); atlasManifest.mode = 'atlas'; atlasManifest.entries[0].frames[0].crop = [18, 12, 218, 212];
  const atlas = await runCase(tool, atlasManifest, 'source-resolution-atlas'); assert(!atlas.outputs[0].gifPath); const crop = PNG.sync.read(await fs.readFile(atlas.outputs[0].framePaths[0])); assert.equal(crop.width, 200); assert.equal(crop.height, 200);
  const defaultManifest = { ...structuredClone(baseManifest), style: 'photo-people', width: 512, height: 512, fps: 12.5, loopMs: 1920, exportFrames: true };
  const sample = await runCase(tool, defaultManifest, 'default-sample-and-frame-zip'); const sampleDecoded = await verifyGif(PNG, sample.outputs[0]); assert(sampleDecoded.frames > 16); assert.throws(() => validateGif(fsSync.readFileSync(sample.outputs[0].gifPath))); report.localVsProviderFrameLimitsVerified = true;
  await fs.copyFile(sample.outputs[0].gifPath, path.join(output, 'default-sample.gif')); await fs.copyFile(sample.outputs[0].coverPath, path.join(output, 'default-sample-cover.png'));
  const zip = await unzipper.Open.file(sample.archivePath); assert.equal(zip.files.length, sample.outputs[0].framePaths.length); let expanded = 0;
  for (const entry of zip.files) { assert.equal(entry.type, 'File'); assert(!entry.path.includes('\\') && !entry.path.split('/').some(part => part === '..')); expanded += entry.uncompressedSize; let bytes = 0, crc = 0; const hash = createHash('sha256'); for await (const chunk of entry.stream()) { bytes += chunk.length; assert(bytes <= 64 * 1024 * 1024); crc = crc32(chunk, crc); hash.update(chunk); } assert.equal(bytes, entry.uncompressedSize); assert.equal(crc >>> 0, entry.crc32 >>> 0); assert.equal(hash.digest('hex'), sha(await fs.readFile(path.join(sample.directory, entry.path)))); }
  assert(expanded <= 200 * 1024 * 1024); const archiveBytes = (await fs.stat(sample.archivePath)).size; assert(archiveBytes <= 100 * 1024 * 1024); report.frameZip = { entries: zip.files.length, expandedBytes: expanded, archiveBytes, actualFramesOnly: true };
  const beforeEdit = structuredClone(baseManifest); beforeEdit.style = 'illustrated-actions'; beforeEdit.loopMs = 200; beforeEdit.entries = ['first', 'untouched'].map((id, index) => ({ id, caption: '', motion: 'sway', frames: [0, 1].map((column, frame) => ({ atlasId: 'source', cell: [column + index, 0], grid: [3, 2], durationMs: frame ? 120 : 80 })) }));
  const original = await runCase(tool, beforeEdit, 'before-local-frame-edit'), changed = structuredClone(beforeEdit); changed.atlases.push({ id: 'repair', path: repaired }); changed.entries[0].frames[0].atlasId = 'repair';
  const edited = await runCase(tool, changed, 'after-one-frame-edit'); assert.notEqual(sha(await fs.readFile(original.outputs[0].gifPath)), sha(await fs.readFile(edited.outputs[0].gifPath))); assert.equal(sha(await fs.readFile(original.outputs[1].gifPath)), sha(await fs.readFile(edited.outputs[1].gifPath))); assert.deepEqual(changed.entries[0].frames[1], beforeEdit.entries[0].frames[1]); report.localPartialFrameEdit = { changedTarget: true, otherEntryByteIdentical: true, otherFrameMappingPreserved: true, providerCalls: 0 };
  const faster = structuredClone(changed); faster.loopMs = 400; faster.entries.forEach(entry => entry.frames.forEach(frame => { frame.durationMs *= 2; })); const timed = await runCase(tool, faster, 'local-retime'); for (const item of timed.outputs) { assert.equal((await verifyGif(PNG, item)).loopMs, 400); } report.localRetimePassed = true;
  const batchManifest = structuredClone(defaultManifest); batchManifest.width = 320; batchManifest.height = 320; batchManifest.exportFrames = false; batchManifest.entries = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(baseManifest.entries[0]), id: 'batch-' + index, caption: String(index + 1) })); const batch = await runCase(tool, batchManifest, '12-entry-sequential-batch'); assert.equal(batch.outputs.length, 12); for (const item of batch.outputs) await verifyGif(PNG, item);
  const controller = new AbortController(), cancelTool = createAnimationTool({ directory: temporary, ...(options.python ? { developmentPython: options.python, packaged: false } : { executablePath: options['tool-exe'], packaged: true }), spawnProcess: (file, args, settings) => { const child = spawn(file, args, settings); children.push(child); if (child.pid) report.processIds.push(child.pid); if (args.includes('render')) child.stderr.on('data', bytes => { if (bytes.toString().includes('composing')) controller.abort(); }); return child; } }); tools.push(cancelTool);
  const cancelledOutput = path.join(temporary, 'cancelled-task'); await fs.mkdir(cancelledOutput); await assert.rejects(cancelTool.run({ ...defaultManifest, fps: 20, loopMs: 6000, exportFrames: false }, cancelledOutput, { signal: controller.signal }), error => error.name === 'AbortError'); await cancelTool.drain(); await cancelTool.shutdown(); report.actualCancellationPassed = true;
  await tool.prepareClose(); const resumed = await runCase(tool, atlasManifest, 'after-cancelled-application-exit'); assert(!resumed.outputs[0].gifPath); report.reusableAfterPrepareClose = true;
  assert.equal(sha(await fs.readFile(source)), sourceSha); report.sourceUnchanged = true; report.sourceSha256 = sourceSha;
  assert(report.metrics.length >= 10 && report.metrics.every(item => item.processPeakMemoryBytes > 0 && item.processPeakMemoryBytes < 512 * 1024 * 1024));
}
const watchdog = setTimeout(() => { timedOut = true; for (const tool of tools) void tool.shutdown(); }, 150000);
main().catch(error => { report.errors.push(String(error.stack || error)); }).finally(async () => {
  clearTimeout(watchdog);
  for (const tool of tools) try { await tool.shutdown(); } catch (error) { report.errors.push(String(error)); }
  for (let attempt = 0; attempt < 30 && children.some(child => alive(child.pid)); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  report.remainingPids = children.filter(child => alive(child.pid)).map(child => child.pid); if (report.remainingPids.length) report.errors.push('Owned animation helper processes remain after shutdown'); if (timedOut) report.errors.push('Native animation acceptance exceeded 150 seconds');
  report.failedPhase = report.errors.length ? phase : undefined; report.passed = report.errors.length === 0; report.version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  if (await present(output) && !await present(path.join(output, 'report.json'))) await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), scope: report.scope, cases: report.cases.length, remainingPids: report.remainingPids, errors: report.errors }) + '\n'); if (!report.passed) process.exitCode = 1;
});
