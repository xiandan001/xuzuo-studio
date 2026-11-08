const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { app, BrowserWindow } = require('electron');

// Run with Electron, never the ordinary application entry point. This fixture has no Key or API access.
const root = path.resolve(__dirname, '..'), options = { sourceRoot: root, dependenciesRoot: root, output: path.join(root, 'work', `commerce-native-${Date.now()}-${randomUUID()}`) };
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|dependencies-root|output)=(.+)$/.exec(argument);
  if (!match) throw Error(`Unknown argument: ${argument}`);
  options[{ 'source-root': 'sourceRoot', 'dependencies-root': 'dependenciesRoot', output: 'output' }[match[1]]] = path.resolve(match[2]);
}
assert(process.versions.electron, 'Run this probe with the locked Electron executable');
assert(!fs.existsSync(options.output), 'Use a new output directory; previous evidence is not overwritten');
fs.mkdirSync(options.output, { recursive: true });
const profile = path.join(options.output, 'empty-profile'); fs.mkdirSync(profile);
app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration();
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Inherit restricted CI scheduling. */ }
const load = createRequire(path.join(options.dependenciesRoot, 'package.json')), { PNG } = load('pngjs');
const rendererPath = path.join(options.sourceRoot, 'electron', 'commerce-text-renderer.cjs');
const { createCommerceTextRenderer } = require(rendererPath);
const report = { passed: false, commit: process.env.GITHUB_SHA || null, electron: process.versions.electron, chromium: process.versions.chrome, sourceSha256: createHash('sha256').update(fs.readFileSync(rendererPath)).digest('hex'), checks: [], errors: [] };
let renderer, finishing = false;
const deadline = setTimeout(() => finish(Error('Native commerce probe exceeded its 45-second deadline')), 45000);
app.on('window-all-closed', () => {});
function record(name, bytes, width, height) {
  const image = PNG.sync.read(bytes); assert.equal(image.width, width); assert.equal(image.height, height);
  let opaque = 0, clear = 0; for (let index = 3; index < image.data.length; index += 4) { if (image.data[index] > 0) opaque++; else clear++; }
  assert(opaque > 0, `${name}: actual visible pixels required`);
  fs.writeFileSync(path.join(options.output, `${name}.png`), bytes, { flag: 'wx' });
  report.checks.push({ name, width, height, visiblePixels: opaque, transparentPixels: clear }); return { opaque, clear };
}
async function finish(error) {
  if (finishing) return; finishing = true; clearTimeout(deadline);
  if (error) report.errors.push(String(error.stack || error));
  try { await renderer?.shutdown(); } catch (cause) { report.errors.push(String(cause)); }
  report.residualWindows = BrowserWindow.getAllWindows().length;
  if (report.residualWindows) report.errors.push('Hidden render windows remain after shutdown');
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  report.passed = report.errors.length === 0;
  fs.writeFileSync(path.join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: report.passed, report: path.join(options.output, 'report.json') }) + '\n');
  app.exit(report.passed ? 0 : 1);
}
async function run() {
  await app.whenReady();
  renderer = createCommerceTextRenderer({ BrowserWindow, timeoutMs: 12000 });
  const text = { name: '准确标题售价', text: '商品主图 · 原价129元\nProduct · ¥99.00', width: 600, height: 130, fontSize: 32, fontFamily: 'Microsoft YaHei', fontWeight: 'bold', align: 'left', color: '#182230' };
  for (const fontFamily of ['Microsoft YaHei', 'Arial', 'SimSun']) {
    const rendered = await renderer.render({ ...text, fontFamily }), pixels = record(`font-${fontFamily.replaceAll(' ', '-')}`, rendered, 600, 130);
    assert(pixels.clear > 0, 'Text output must retain a genuinely transparent background');
  }
  await assert.rejects(renderer.render({ ...text, text: '这段内容必须检测超出文本框'.repeat(12), width: 40, height: 20 }), /超出文本框/);
  report.checks.push({ name: 'actual-dom-text-overflow-rejected', passed: true });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect x="4" y="4" width="16" height="8" fill="#26a269"/></svg>');
  const vector = await renderer.renderImage({ width: 240, height: 160, imageDataUrl: `data:image/svg+xml;base64,${svg.toString('base64')}` });
  assert(record('static-svg', vector, 240, 160).clear > 0, 'SVG alpha must remain transparent');
  const gif = 'R0lGODlhAQABAIAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
  record('static-gif-frame', await renderer.renderImage({ width: 96, height: 96, imageDataUrl: `data:image/gif;base64,${gif}` }), 96, 96);
  const controller = new AbortController(), first = renderer.render(text), queued = renderer.render(text, { signal: controller.signal });
  const rejected = assert.rejects(queued, { name: 'AbortError' }); controller.abort(); await first; await rejected; await renderer.drain();
  assert.equal(BrowserWindow.getAllWindows().length, 0); report.checks.push({ name: 'queued-cancel-drain-no-residual-windows', passed: true });
  await finish();
}
run().catch(finish);
