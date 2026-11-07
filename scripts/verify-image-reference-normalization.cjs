const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function nativeFixture(directory, sourceRoot) {
  const { app, nativeImage, BrowserWindow } = require('electron');
  process.on('uncaughtException', error => { fs.writeFileSync(path.join(directory, 'failure.txt'), String(error.stack || error)); app.exit(1); });
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
    app.setPath('userData', path.join(directory, 'profile'));
    app.disableHardwareAcceleration();
    const { createImageReferenceNormalizer } = require(path.join(sourceRoot, 'electron/image-reference-normalization.cjs'));
    const { imageType } = require(path.join(sourceRoot, 'electron/image-output-formats.cjs'));
    let decodeCalls = 0;
    const normalize = createImageReferenceNormalizer({ nativeImage: { createFromBuffer(bytes) { decodeCalls++; return nativeImage.createFromBuffer(bytes); } } });
    const tiny = nativeImage.createFromBitmap(Buffer.from([25, 80, 220, 255]), { width: 1, height: 1 });
    const jpeg = tiny.resize({ width: 1724, height: 1280 }).toJPEG(85);
    const bytes = Buffer.concat([jpeg, Buffer.alloc(24, 65)]), sourceSha256 = hash(bytes);
    const input = { buffer: bytes, mimeType: 'image/png' };
    let strictRejected = false; try { imageType(bytes); } catch { strictRejected = true; }
    const result = await normalize(input), decoded = nativeImage.createFromBuffer(result.buffer), pixel = [...decoded.toBitmap().subarray(0, 4)];
    const sourceUnchanged = sourceSha256 === hash(bytes) && input.mimeType === 'image/png';
    if (!strictRejected || !sourceUnchanged || result.mimeType !== 'image/png' || result.width !== 1724 || result.height !== 1280 || decoded.isEmpty() || imageType(result.buffer).mimeType !== 'image/png') throw Error('Real JPEG normalization failed');
    if (Math.abs(pixel[0] - 25) > 10 || Math.abs(pixel[1] - 80) > 10 || Math.abs(pixel[2] - 220) > 10 || pixel[3] !== 255) throw Error('Decoded PNG pixels do not match the native JPEG fixture');
    const normalizedPng = await normalize({ buffer: tiny.toPNG(), mimeType: 'image/jpeg' });
    if (normalizedPng.width !== 1 || normalizedPng.height !== 1 || nativeImage.createFromBuffer(normalizedPng.buffer).isEmpty()) throw Error('Real PNG normalization failed');
    const beforeRejected = decodeCalls;
    for (const buffer of [Buffer.from('GIF89a'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('unknown')]) {
      let rejected = false; try { await normalize({ buffer, mimeType: 'image/png' }); } catch { rejected = true; }
      if (!rejected) throw Error('Unsupported source reached PNG normalization');
    }
    if (decodeCalls !== beforeRejected || BrowserWindow.getAllWindows().length) throw Error('Rejected inputs decoded or a fixture window was created');
    const report = { electron: process.versions.electron, chromium: process.versions.chrome, source: { mimeType: input.mimeType, actualMimeType: 'image/jpeg', width: 1724, height: 1280, jpegBytes: jpeg.length, trailingBytes: bytes.length - jpeg.length, sha256: sourceSha256 }, strictRejected, sourceUnchanged, result: { mimeType: result.mimeType, width: result.width, height: result.height, bytes: result.buffer.length, pixel }, realDecodedFormats: ['PNG', 'JPEG with 24B trailer'], rejectedBeforeDecode: ['GIF', 'SVG', 'unknown'], browserWindowCount: 0, modelCalls: 0 };
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    app.exit(0);
  } catch (error) { fs.writeFileSync(path.join(directory, 'failure.txt'), String(error.stack || error)); app.exit(1); }
}

function runFixture() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const mirror = path.join(root, 'work', 'ui-build');
  const runtime = fs.existsSync(path.join(root, 'node_modules', 'image-size', 'package.json')) ? root : mirror;
  if (runtime !== root) for (const file of ['electron/image-reference-normalization.cjs', 'electron/image-output-formats.cjs']) {
    if (!fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(runtime, file)))) throw Error(`Native fixture mirror is stale: ${file}`);
  }
  const electron = createRequire(path.join(runtime, 'package.json'))('electron');
  if (typeof electron !== 'string' || !fs.existsSync(electron)) throw Error('Healthy Electron runtime is required for native image verification');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzuo-image-normalization-'));
  const env = { ...process.env, NODE_PATH: path.join(runtime, 'node_modules'), UV_THREADPOOL_SIZE: '2' };
  delete env.ELECTRON_RUN_AS_NODE;
  let result;
  try {
    result = spawnSync(electron, [__filename, '--native-child', directory, runtime], { env, windowsHide: true, timeout: 10000, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(fs.existsSync(path.join(directory, 'failure.txt')) ? fs.readFileSync(path.join(directory, 'failure.txt'), 'utf8') : `Native fixture exited ${result.status}: ${result.stderr || ''}`);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
    let residual = false;
    try { process.kill(result.pid, 0); residual = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (residual) throw Error('Native fixture process did not exit');
    const output = { ...report, exitCode: result.status, residualProcess: residual, elapsedMs: Date.now() - started };
    const reportPath = path.join(root, 'work', 'image-reference-normalization-native.json'); fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(output, null, 2) + '\n');
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('xuzuo-image-normalization-')) throw Error('Unexpected native fixture cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

const started = Date.now();
if (process.argv[2] === '--native-child') nativeFixture(path.resolve(process.argv[3]), path.resolve(process.argv[4]));
else { try { runFixture(); } catch (error) { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; } }
