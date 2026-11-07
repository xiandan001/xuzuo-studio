const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const errorsOf = error => String(error?.stack || error);
const requiredFiles = ['bead-source.cjs', 'bead-pattern.runtime.cjs', 'bead-document.cjs', 'bead-exports.cjs', 'bead-export-helpers.cjs', 'bead-pdf-layout.cjs', 'bead-pdf-printer.cjs', 'cpu-tasks.cjs', 'cpu-worker.cjs', 'image-reference-normalization.cjs', 'image-output-formats.cjs', 'artifact-store.cjs'];

function argumentsFor(args) {
  const options = { sourceRoot: root, report: path.join(root, 'work/bead-native-acceptance.json'), output: path.join(root, 'work/bead-native-output') };
  for (const arg of args) {
    const match = /^--(source-root|report|output)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown argument: ${arg}`);
    options[{ 'source-root': 'sourceRoot', report: 'report', output: 'output' }[match[1]]] = path.resolve(match[2]);
  }
  return options;
}

function lowerPriority() {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* A restricted CI runner can retain its inherited scheduling priority. */ }
  if (process.platform === 'win32') {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity=[IntPtr]3`], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
  }
}

function ownsDirectory(directory, nonce) {
  const absolute = path.resolve(directory), owner = readJson(path.join(absolute, 'owner.json'));
  assert.equal(typeof owner.temporaryRoot, 'string');
  const temporary = fs.realpathSync(owner.temporaryRoot);
  assert.equal(path.dirname(absolute), temporary, 'The probe may clean up only its own temporary directory');
  assert.match(path.basename(absolute), /^xuzuo-bead-native-/);
  assert.equal(fs.lstatSync(absolute).isSymbolicLink(), false);
  assert.equal(owner.nonce, nonce);
  return absolute;
}

function currentCommit() {
  if (/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA || '')) return process.env.GITHUB_SHA;
  try {
    let gitDirectory = path.join(root, '.git');
    if (fs.statSync(gitDirectory).isFile()) gitDirectory = path.resolve(root, fs.readFileSync(gitDirectory, 'utf8').trim().replace(/^gitdir:\s*/, ''));
    const head = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head;
    const ref = /^ref: (refs\/[A-Za-z0-9/_.-]+)$/.exec(head)?.[1];
    if (!ref || ref.includes('..')) return null;
    const common = fs.existsSync(path.join(gitDirectory, 'commondir')) ? path.resolve(gitDirectory, fs.readFileSync(path.join(gitDirectory, 'commondir'), 'utf8').trim()) : gitDirectory;
    for (const location of [gitDirectory, common]) {
      const file = path.join(location, ref);
      if (fs.existsSync(file)) { const value = fs.readFileSync(file, 'utf8').trim(); if (/^[a-f0-9]{40}$/i.test(value)) return value; }
    }
    return fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n').map(line => line.split(' ')).find(parts => parts[1] === ref)?.[0] || null;
  } catch { return null; }
}

function dependencyRuntime() {
  for (const directory of [root, path.join(root, 'work/ui-build')]) {
    try {
      const load = createRequire(path.join(directory, 'package.json'));
      for (const id of ['electron', 'pngjs', 'image-size', 'pdfjs-dist/package.json']) load.resolve(id);
      const executable = load('electron');
      if (typeof executable === 'string' && fs.existsSync(executable)) return { directory, load, executable };
    } catch { /* Do not use an incomplete runtime when a verified local dependency mirror is available. */ }
  }
  throw Error('Install the locked development dependencies with npm ci before native verification');
}

function executionSource(sourceRoot, runtime, temporary) {
  if (/\.asar$/i.test(sourceRoot)) {
    assert.equal(fs.statSync(sourceRoot).isFile(), true, 'The supplied app.asar must exist');
    return { directory: sourceRoot, mode: 'packaged-asar', expectedHashes: null };
  }
  assert.equal(fs.statSync(path.join(sourceRoot, 'package.json')).isFile(), true);
  for (const file of requiredFiles) assert.equal(fs.statSync(path.join(sourceRoot, 'electron', file)).isFile(), true, file);
  const expectedHashes = Object.fromEntries(requiredFiles.map(file => [file, sha256(fs.readFileSync(path.join(sourceRoot, 'electron', file)))]));
  if (runtime.directory === root && sourceRoot === root) return { directory: sourceRoot, mode: 'repository', expectedHashes };
  // Keep the real production CJS bytes; only dependency resolution comes from the healthy mirror.
  const stage = path.join(temporary, 'verified-source'); fs.mkdirSync(path.join(stage, 'electron'), { recursive: true });
  for (const entry of fs.readdirSync(path.join(sourceRoot, 'electron'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.cjs')) continue;
    const source = fs.readFileSync(path.join(sourceRoot, 'electron', entry.name)), target = path.join(stage, 'electron', entry.name);
    fs.writeFileSync(target, source, { flag: 'wx' }); assert.equal(sha256(fs.readFileSync(target)), sha256(source), `Stale native source: ${entry.name}`);
  }
  fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(stage, 'package.json'));
  fs.mkdirSync(path.join(stage, 'assets/licenses'), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'assets/licenses/pindou-color-data-MIT.txt'), path.join(stage, 'assets/licenses/pindou-color-data-MIT.txt'));
  fs.symlinkSync(path.join(runtime.directory, 'node_modules'), path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { directory: stage, mode: 'sha256-verified-cjs-with-local-dependencies', expectedHashes };
}

function isolatedEnvironment(directory, runtime) {
  const env = {};
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY']) if (process.env[name]) env[name] = process.env[name];
  const profile = path.join(directory, 'profile');
  Object.assign(env, { TEMP: directory, TMP: directory, HOME: profile, USERPROFILE: profile, APPDATA: path.join(profile, 'Roaming'), LOCALAPPDATA: path.join(profile, 'Local'), XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: path.join(profile, 'cache'), NODE_PATH: path.join(runtime.directory, 'node_modules'), UV_THREADPOOL_SIZE: '2' });
  return env;
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

function stopOwnedChild(pid) {
  if (!processExists(pid)) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* It can exit during cancellation. */ } } }
}

async function launchNative(directory, source, runtime, nonce) {
  return new Promise(resolve => {
    const child = spawn(runtime.executable, [__filename, '--native-child', directory, source.directory, nonce], { env: isolatedEnvironment(directory, runtime), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', settled = false;
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-12000); });
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve({ pid: child.pid, stderr, ...value }); };
    const timer = setTimeout(() => { stopOwnedChild(child.pid); finish({ exitCode: null, error: 'Native bead verification exceeded 120 seconds' }); }, 120000);
    child.once('error', error => finish({ exitCode: null, error: errorsOf(error) }));
    child.once('exit', (code, signal) => finish({ exitCode: code, signal }));
  });
}

function jpegOrientation6(jpeg) {
  assert.equal(jpeg.readUInt16BE(0), 0xffd8);
  const payload = Buffer.alloc(32); payload.write('Exif\0\0', 0, 'binary'); payload.write('II', 6, 'ascii');
  payload.writeUInt16LE(42, 8); payload.writeUInt32LE(8, 10); payload.writeUInt16LE(1, 14);
  payload.writeUInt16LE(0x0112, 16); payload.writeUInt16LE(3, 18); payload.writeUInt32LE(1, 20); payload.writeUInt16LE(6, 24);
  const segment = Buffer.alloc(4); segment.writeUInt16BE(0xffe1, 0); segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), segment, payload, jpeg.subarray(2)]);
}

function fixturePalette(sourceRoot) {
  return { id: 'native-bead-fixture', name: 'Synthetic native acceptance palette', brand: 'Synthetic fixture', version: 'native-smoke-pinned-v1', sourceUrl: '', sourceNote: 'Synthetic acceptance data, not a physical standard palette. Full upstream MIT notice is retained below for the export preservation check.', license: fs.readFileSync(path.join(sourceRoot, 'assets/licenses/pindou-color-data-MIT.txt'), 'utf8'),
    colors: [['R1', '#FF0000', 'solid'], ['W1', '#FFFFFF', 'solid'], ['T1', '#FFFFFF', 'transparent'], ['LONGCODE1234', '#FF00FF', 'solid']].map(([code, hex, kind]) => ({ code, name: code, hex, rgb: [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)), kind, automatic: kind === 'solid' })) };
}

function documentFor(pattern, reference, settings) {
  return { type: 'xuzuo-bead-document', version: 1, id: `native-${settings.columns}-${settings.rows}`, projectId: 'native-bead-project', revision: 7, title: `Native printable bead chart ${settings.columns}x${settings.rows}`, referenceId: reference.id, sourceSha256: reference.sha256, settings, pattern,
    procurement: { copies: 2, lossPercent: 5, defaultPackSize: 3, stock: { R1: 1 }, packSizes: {} }, updatedAt: '2026-11-07T00:00:00Z' };
}

async function nativeFixture(directory, sourceRoot, nonce) {
  const { app, nativeImage, BrowserWindow } = require('electron');
  const started = performance.now(), report = { status: 'failed', electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform, modelCalls: 0, outboundRequests: 0, windows: { created: 0, destroyed: 0, shown: 0 }, workerTasks: [], pdfs: [], processIds: [process.pid], failures: [] };
  let printer, tasks, store, source; const activeWorkers = new Set(), workerExits = [];
  const persist = () => writeJson(path.join(directory, 'report.json'), { ...report, nativeElapsedMs: performance.now() - started });
  const fail = error => { report.failures.push(errorsOf(error)); persist(); };
  const fatal = error => {
    if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(metric => metric.pid)])];
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    fail(error); app.exit(1);
  };
  process.once('uncaughtException', fatal); process.once('unhandledRejection', fatal);
  const watchdog = setTimeout(() => fatal(Error('Hidden native fixture exceeded 110 seconds')), 110000);
  try {
    ownsDirectory(directory, nonce); lowerPriority();
    fs.mkdirSync(path.join(directory, 'profile/session'), { recursive: true });
    app.setPath('userData', path.join(directory, 'profile')); app.setPath('sessionData', path.join(directory, 'profile/session')); app.disableHardwareAcceleration();
    global.fetch = () => { report.outboundRequests++; throw Error('The native fixture has no API/network access'); };
    for (const id of ['node:http', 'node:https']) for (const method of ['request', 'get']) require(id)[method] = () => { report.outboundRequests++; throw Error('The native fixture has no HTTP/API access'); };
    app.on('browser-window-created', (_event, window) => {
      report.windows.created++; assert.equal(window.isVisible(), false);
      window.once('show', () => { report.windows.shown++; }); window.once('closed', () => { report.windows.destroyed++; });
      window.webContents.once('did-finish-load', () => { const pid = window.webContents.getOSProcessId(); if (pid) report.processIds.push(pid); });
    });
    await app.whenReady();
    const load = createRequire(path.join(sourceRoot, 'package.json')), { PNG } = load('pngjs'), { Worker } = require('node:worker_threads');
    const core = load('./electron/bead-pattern.runtime.cjs');
    report.sourceVersion = readJson(path.join(sourceRoot, 'package.json')).version;
    report.sourceHashes = Object.fromEntries(requiredFiles.map(file => [file, sha256(fs.readFileSync(path.join(sourceRoot, 'electron', file)))]));
    tasks = load('./electron/cpu-tasks.cjs').createCpuTasks({ timeoutMs: 30000, createWorker(file, options) {
      assert.equal(file, path.join(sourceRoot, 'electron/cpu-worker.cjs'));
      const worker = new Worker(file, options), row = { task: options.workerData.task, threadId: worker.threadId, exited: false }; report.workerTasks.push(row); activeWorkers.add(worker);
      workerExits.push(new Promise(resolve => worker.once('exit', code => { row.exited = true; row.exitCode = code; activeWorkers.delete(worker); resolve(); })));
      return worker;
    } });
    printer = load('./electron/bead-pdf-printer.cjs').createBeadPdfPrinter({ timeoutMs: 30000, BrowserWindow: function ObservedBrowserWindow(options) {
      assert.equal(options.show, false); assert.equal(options.webPreferences.javascript, false); assert.equal(options.webPreferences.sandbox, true); assert.equal(options.webPreferences.contextIsolation, true); assert.equal(options.webPreferences.nodeIntegration, false);
      const window = new BrowserWindow(options);
      window.webContents.once('did-finish-load', () => {
        const url = window.webContents.getURL(); assert.ok(url.startsWith('data:text/html;charset=utf-8,'));
        const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
        for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src data:"]) assert.ok(html.includes(directive));
        report.pdfPrinterSecurity = { hidden: true, sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false, restrictiveCspLoaded: true };
      });
      return window;
    } });
    store = load('./electron/artifact-store.cjs').createArtifactStore({ directory: path.join(directory, 'artifacts') });
    source = load('./electron/bead-source.cjs').createBeadSource({ artifactStore: store, nativeImage });
    const png = new PNG({ width: 8, height: 8 });
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) png.data.set(y === 0 ? [0, 0, 0, 0] : x === 0 && y === 1 ? [255, 255, 255, 255] : [255, 0, 0, 128], (y * 8 + x) * 4);
    const original = PNG.sync.write(png), artifact = await store.write({ buffer: original, mimeType: 'image/png', name: 'synthetic-alpha.png', projectId: 'native-bead-project' });
    const decoded = await source.read({ projectId: artifact.projectId, referenceId: artifact.id }), pixel = [...decoded.raster.pixels.subarray(36, 40)];
    assert.equal(decoded.raster.format, 'bgra'); assert.equal(decoded.raster.premultiplied, true);
    assert.equal(decoded.raster.width, 8); assert.equal(decoded.raster.height, 8); assert.deepEqual(pixel, [0, 0, 128, 128]);
    assert.equal(decoded.preview.sourceSha256, sha256(original)); assert.equal(sha256((await store.read(artifact.id)).buffer), sha256(original));
    report.sourceBGRA = { status: 'passed', width: 8, height: 8, pixel, premultiplied: true, sourceSha256: sha256(original), originalUnchanged: true, previewDecoded: !nativeImage.createFromDataURL(decoded.preview.dataUrl).isEmpty() };
    assert.equal(report.sourceBGRA.previewDecoded, true);
    try {
      const photo = new PNG({ width: 160, height: 80 });
      for (let y = 0; y < 80; y++) for (let x = 0; x < 160; x++) photo.data.set(x < 80 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 160 + x) * 4);
      const jpeg = jpegOrientation6(nativeImage.createFromBuffer(PNG.sync.write(photo)).toJPEG(95));
      const image = nativeImage.createFromBuffer(jpeg), actual = image.getSize(); report.sourceExif = { status: 'failed', orientation: 6, encoded: { width: 160, height: 80 }, native: actual };
      const reference = await store.write({ buffer: jpeg, mimeType: 'image/jpeg', name: 'synthetic-exif-6.jpg', projectId: artifact.projectId }), oriented = await source.read({ projectId: reference.projectId, referenceId: reference.id });
      assert.deepEqual(actual, { width: 80, height: 160 });
      assert.equal(oriented.preview.originalWidth, 80); assert.equal(oriented.preview.originalHeight, 160); assert.equal(oriented.raster.width, 80); assert.equal(oriented.raster.height, 160);
      const preview = nativeImage.createFromDataURL(oriented.preview.dataUrl); assert.deepEqual(preview.getSize(), actual);
      const at = (x, y) => [...oriented.raster.pixels.subarray((y * 80 + x) * 4, (y * 80 + x) * 4 + 4)];
      const top = at(40, 40), bottom = at(40, 120); assert.ok(top[2] > 230 && top[0] < 25); assert.ok(bottom[0] > 230 && bottom[2] < 25);
      assert.equal(sha256((await store.read(reference.id)).buffer), sha256(jpeg));
      report.sourceExif = { ...report.sourceExif, status: 'passed', preview: preview.getSize(), raster: { width: oriented.raster.width, height: oriented.raster.height }, topBGRA: top, bottomBGRA: bottom, originalUnchanged: true };
    } catch (error) { report.sourceExif = { ...report.sourceExif, status: 'failed', error: errorsOf(error) }; fail(error); }
    const palette = fixturePalette(sourceRoot); report.expectedText = { version: palette.version, license: palette.license, longCode: 'LONGCODE1234' };
    for (const [columns, rows, name] of [[8, 8, 'small8x8'], [61, 81, 'grid61x81']]) {
      const settings = { columns, rows, fit: 'contain', maxColors: 0, alphaThreshold: 128, boardColumns: 4, boardRows: 4 };
      let pattern = await tasks.run('bead', { raster: decoded.raster, settings, palette });
      if (columns === 8) { assert.deepEqual(core.beadTotals(pattern), { totalCells: 64, beads: 56, emptyCells: 8, colorsUsed: 2 }); assert.equal(pattern.cells.filter(value => value === 1).length, 55); }
      pattern = core.editBeadCells(pattern, [{ index: 0, value: 3 }, { index: pattern.cells.length - 1, value: 4 }]);
      const document = documentFor(pattern, { id: artifact.id, sha256: sha256(original) }, settings), before = JSON.stringify(document), totals = core.beadTotals(pattern), usage = core.beadUsage(pattern, document.procurement);
      assert.equal(usage.find(row => row.code === 'T1').cells, 1); assert.equal(usage.reduce((sum, row) => sum + row.cells, 0), totals.beads);
      if (columns === 8) { assert.equal(totals.beads, 57); assert.equal(totals.emptyCells, 7); assert.deepEqual(usage.find(row => row.code === 'R1'), { code: 'R1', name: 'R1', hex: '#FF0000', kind: 'solid', cells: 54, required: 108, reserve: 6, stock: 1, shortage: 113, packSize: 3, bags: 38 }); }
      const prepared = await tasks.run('bead-export', { document, format: 'pdf' }), chartPages = (prepared.html.match(/class="sheet chart-sheet"/g) || []).length;
      assert.equal(chartPages, columns === 8 ? 1 : 9); assert.ok(prepared.pages <= 100); assert.ok(!/<script|<iframe|<link|\b(?:src|href)=|url\(/i.test(prepared.html));
      const startedPdf = performance.now(), buffer = await printer.print(prepared), actualPages = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      assert.equal(actualPages, prepared.pages); fs.writeFileSync(path.join(directory, `${name}.pdf`), buffer);
      const pngResult = await tasks.run('bead-export', { document, format: 'png' }), preview = nativeImage.createFromBuffer(Buffer.from(pngResult.buffer));
      assert.equal(preview.isEmpty(), false); assert.ok(preview.getSize().width <= 4096 && preview.getSize().height <= 4096); assert.equal(JSON.stringify(document), before);
      report.pdfs.push({ name, file: `${name}.pdf`, plannedPages: prepared.pages, actualPages, chartPages, bytes: buffer.length, sha256: sha256(buffer), printMs: performance.now() - startedPdf, columns, rows, revision: document.revision, totals, usage, nativePngDecoded: true });
    }
    await tasks.drain(); await printer.shutdown(); await store.drain(); source.clear();
    await Promise.race([Promise.all(workerExits), delay(5000).then(() => { throw Error('Production CPU workers did not exit'); })]);
    assert.equal(activeWorkers.size, 0); assert.equal(BrowserWindow.getAllWindows().length, 0); assert.equal(report.windows.created, 2); assert.equal(report.windows.destroyed, 2); assert.equal(report.windows.shown, 0);
    assert.equal(report.outboundRequests, 0); assert.equal(report.pdfPrinterSecurity?.restrictiveCspLoaded, true); assert.equal(Object.keys(require.cache).some(file => file === path.join(sourceRoot, 'electron/main.cjs')), false);
    report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(metric => metric.pid)])];
    report.workerDispatch = 'production createCpuTasks -> cpu-worker.cjs'; report.windows.remaining = 0; report.status = report.failures.length ? 'failed' : 'passed';
  } catch (error) { fail(error); }
  finally {
    clearTimeout(watchdog);
    try { await printer?.shutdown(); for (const worker of activeWorkers) await worker.terminate(); await store?.drain(); source?.clear(); } catch (error) { fail(error); }
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    report.processIds = [...new Set([...report.processIds, ...(app.isReady() ? app.getAppMetrics().map(metric => metric.pid) : [])])]; persist(); app.exit(report.status === 'passed' && !report.failures.length ? 0 : 1);
  }
}

async function inspectPdfs(directory, output, report, runtime) {
  for (const entry of report.pdfs) { entry.output = path.join(output, entry.file); fs.copyFileSync(path.join(directory, entry.file), entry.output); }
  const packageFile = runtime.load.resolve('pdfjs-dist/package.json'), pdfRoot = path.dirname(packageFile);
  let pdfjs;
  try { pdfjs = await import(pathToFileURL(path.join(pdfRoot, 'legacy/build/pdf.mjs')).href); }
  catch (error) { report.rendering = { status: 'unavailable', reason: `PDF.js dependency could not load; actual PDFs retained: ${errorsOf(error)}` }; throw Error(report.rendering.reason); }
  let canvas;
  try { canvas = createRequire(packageFile)('@napi-rs/canvas'); }
  catch (error) { report.rendering = { status: 'unavailable', reason: `PDF rendering dependency could not load; actual PDFs retained: ${errorsOf(error)}` }; throw Error(report.rendering.reason); }
  for (const entry of report.pdfs) {
    const bytes = fs.readFileSync(path.join(directory, entry.file));
    const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, cMapUrl: path.join(pdfRoot, 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(pdfRoot, 'standard_fonts') + path.sep });
    const pdf = await loading.promise;
    try {
      assert.equal(pdf.numPages, entry.plannedPages); const pageTexts = [];
      for (let number = 1; number <= pdf.numPages; number++) { const page = await pdf.getPage(number), content = await page.getTextContent(); pageTexts.push(content.items.filter(item => typeof item.str === 'string').map(item => item.str).join(' ')); page.cleanup(); }
      const compact = text => text.replace(/\s/g, ''), all = compact(pageTexts.join('\n'));
      for (const value of [report.expectedText.version, report.expectedText.license, report.expectedText.longCode]) assert.ok(all.includes(compact(value)), `${entry.name} PDF lost full version, licence or long colour code`);
      if (entry.chartPages === 9) assert.ok(compact(pageTexts[8]).includes('列61–61·行81–81'), 'The last chart tile lost global row/column coordinates');
      entry.textVerified = true; entry.pdfjsPages = pdf.numPages; entry.output = path.join(output, entry.file); entry.renderedPages = [];
      if (entry.chartPages === 9) for (const number of [1, 9, 10]) {
        const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1.4 }), surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: surface, canvasContext: surface.getContext('2d'), viewport }).promise;
        const file = path.join(output, `${entry.name}-page${number}.png`); fs.writeFileSync(file, surface.toBuffer('image/png')); entry.renderedPages.push(file); page.cleanup();
      }
    } finally { await loading.destroy(); }
  }
  const pages = report.pdfs.flatMap(entry => entry.renderedPages);
  assert.equal(pages.length, 3, 'The native PDF acceptance requires rendered pages 1, 9 and 10');
  report.rendering = { status: 'passed', engine: 'PDF.js with @napi-rs/canvas', pages };
}

async function runProbe(args) {
  const options = argumentsFor(args), started = Date.now(), nonce = randomUUID(), temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xuzuo-bead-native-'));
  writeJson(path.join(temporary, 'owner.json'), { nonce, pid: process.pid, temporaryRoot: fs.realpathSync(os.tmpdir()) }); lowerPriority();
  const result = { status: 'failed', commit: currentCommit(), requestedSource: options.sourceRoot, modelCalls: 0, failures: [] }; let child;
  try {
    fs.mkdirSync(path.dirname(options.report), { recursive: true }); fs.mkdirSync(options.output, { recursive: true });
    const runtime = dependencyRuntime(), source = executionSource(options.sourceRoot, runtime, temporary); result.sourceMode = source.mode;
    child = await launchNative(temporary, source, runtime, nonce);
    const nativeReport = fs.existsSync(path.join(temporary, 'report.json')) ? readJson(path.join(temporary, 'report.json')) : { failures: [child.error || `Electron exited ${child.exitCode} without a report: ${child.stderr}`] };
    Object.assign(result, nativeReport, { commit: result.commit, sourceMode: source.mode, requestedSource: options.sourceRoot, exitCode: child.exitCode });
    if (source.expectedHashes) assert.deepEqual(result.sourceHashes, source.expectedHashes, 'Executed production CJS hashes differ from the requested source');
    if (result.pdfs?.length) await inspectPdfs(temporary, options.output, result, runtime);
    if (child.error) result.failures.push(child.error);
    assert.equal(child.exitCode, 0, result.failures.join('\n')); assert.equal(result.status, 'passed'); assert.equal(result.pdfs.length, 2);
  } catch (error) { result.status = 'failed'; result.failures.push(errorsOf(error)); }
  finally {
    const pids = [...new Set([child?.pid, ...(result.processIds || [])].filter(pid => Number.isSafeInteger(pid) && pid !== process.pid))];
    for (let attempt = 0; attempt < 50 && pids.some(processExists); attempt++) await delay(100);
    result.residualPids = pids.filter(processExists); result.residualProcess = result.residualPids.length > 0;
    if (result.residualProcess) { result.status = 'failed'; result.failures.push('Native probe processes remain; temporary evidence retained without further deletion'); result.retainedTemporaryDirectory = temporary; }
    else { const owned = ownsDirectory(temporary, nonce), linked = path.join(owned, 'verified-source/node_modules'); if (fs.existsSync(linked)) fs.unlinkSync(linked); fs.rmSync(owned, { recursive: true, force: true }); result.temporaryDirectoryRemoved = true; }
    result.elapsedMs = Date.now() - started; delete result.expectedText; writeJson(options.report, result); process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'passed') process.exitCode = 1;
  }
}

if (require.main === module) {
  if (process.argv[2] === '--native-child') nativeFixture(path.resolve(process.argv[3]), path.resolve(process.argv[4]), process.argv[5]);
  else if (process.argv.includes('--help')) process.stdout.write('node scripts/verify-bead-native.cjs [--source-root=<absolute repo or app.asar>] [--report=<JSON path>] [--output=<synthetic PDF/PNG directory>]\nRuns one isolated hidden Electron instance, no Key/provider/model or installation. Default report: work/bead-native-acceptance.json\n');
  else runProbe(process.argv.slice(2)).catch(error => { process.stderr.write(errorsOf(error) + '\n'); process.exitCode = 1; });
}

module.exports = { argumentsFor, jpegOrientation6, ownsDirectory, executionSource };
