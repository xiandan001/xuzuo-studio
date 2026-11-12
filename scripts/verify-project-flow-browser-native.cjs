const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

const started = performance.now(), root = path.resolve(__dirname, '..');
const report = { passed: false, phase: 'prepare', commit: process.env.GITHUB_SHA, providerCalls: 0, fixtureOnly: true, normalApplicationStarted: false, userProfileAccessed: false, windows: { created: 0, shown: 0, destroyed: 0, remaining: 0 }, rendererProcessIds: [], processIds: [process.pid], screenshots: [], layouts: [], steps: [], errors: [], blockedRequests: [] };
let owner, directory, window, finished = false;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (first, second) => path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function ordinary(file, isDirectory = false) { const info = fs.lstatSync(file); assert(!info.isSymbolicLink()); assert(isDirectory ? info.isDirectory() : info.isFile()); assert(same(fs.realpathSync(file), file)); return info; }
function prepare() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i); assert(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE);
  assert(same(fs.realpathSync(process.env.GITHUB_WORKSPACE), fs.realpathSync(root)));
  assert(process.argv[2] && path.isAbsolute(process.argv[2])); directory = path.resolve(process.argv[2]); ordinary(directory, true);
  assert(same(path.dirname(directory), fs.realpathSync(process.env.RUNNER_TEMP))); assert.match(path.basename(directory), /^xuzuo-project-flow-browser-[a-z0-9-]+$/i);
  const ownerPath = path.join(directory, 'owner.json'); assert(ordinary(ownerPath).size < 100000); owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  assert.equal(owner.kind, 'xuzuo-project-flow-browser'); assert.equal(owner.commit, process.env.GITHUB_SHA); assert.match(owner.nonce, /^[a-f0-9-]{36}$/i);
  assert(same(owner.dist, path.join(root, 'work/project-flow-browser-dist'))); assert(same(owner.output, path.join(root, 'work/project-flow-browser-output'))); ordinary(owner.dist, true); ordinary(owner.output, true);
  assert(Object.keys(owner.files).length > 1 && Object.keys(owner.files).length <= 100);
  for (const [relative, digest] of Object.entries(owner.files)) {
    assert(/^[a-z0-9_./-]+$/i.test(relative) && !relative.split('/').includes('..')); assert.match(digest, /^[a-f0-9]{64}$/);
    const file = path.join(owner.dist, relative); assert(ordinary(file).size < 16 * 1024 * 1024); assert.equal(hash(fs.readFileSync(file)), digest);
  }
  for (const [relative, digest] of Object.entries(owner.sources)) { assert(relative.startsWith('src/') || relative.startsWith('scripts/')); assert(!relative.split('/').includes('..')); const file = path.join(root, relative); ordinary(file); assert.equal(hash(fs.readFileSync(file)), digest, `Source changed after fixture build: ${relative}`); }
  const profile = path.join(directory, 'profile'); ordinary(profile, true); app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration();
  assert(!fs.existsSync(path.join(directory, 'native-report.json'))); report.nonce = owner.nonce;
}
function finish(error) {
  if (finished) return; finished = true; clearTimeout(deadline);
  if (error) report.errors.push(String(error.stack || error));
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)])];
  for (const current of BrowserWindow.getAllWindows()) current.destroy();
  report.windows.remaining = BrowserWindow.getAllWindows().length;
  if (report.windows.remaining || report.windows.created !== 1 || report.windows.shown || report.rendererProcessIds.length !== 1) report.errors.push('Expected exactly one hidden renderer and no residual windows');
  if (report.screenshots.length !== 6) report.errors.push('Expected six actual Chromium screenshots');
  report.elapsedMs = Math.round(performance.now() - started); report.passed = !report.errors.length;
  if (directory && owner) fs.writeFileSync(path.join(directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: report.passed, phase: report.phase, errors: report.errors }) + '\n'); app.exit(report.passed ? 0 : 1);
}
const deadline = setTimeout(() => finish(Error('PROJECT_FLOW_BROWSER_45_SECOND_DEADLINE')), 45000);
app.on('window-all-closed', () => {});
process.on('uncaughtException', finish); process.on('unhandledRejection', finish);
async function evaluate(source) {
  let timer;
  try { return await Promise.race([window.webContents.executeJavaScript(source, true), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('PROJECT_FLOW_DOM_EVALUATION_TIMEOUT')), 3000); })]); }
  finally { clearTimeout(timer); }
}
async function until(label, expression, timeout = 5000) {
  const end = performance.now() + timeout;
  do { const value = await evaluate(expression); if (value) return value; await delay(40); } while (performance.now() < end && !finished);
  throw Error(`DOM condition not reached: ${label}`);
}
function domAction(input) {
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
  const candidates = [...document.querySelectorAll(input.selector)], text = value => (value || '').replace(/\s+/g, ' ').trim();
  const element = candidates.find(item => visible(item) && (!input.text || text(item.textContent) === input.text || text(item.querySelector('strong')?.textContent) === input.text));
  if (input.type === 'exists') return !!element && !element.matches(':disabled');
  if (!element || element.matches(':disabled')) throw Error(`Missing or disabled UI: ${input.selector} / ${input.text || ''}`);
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  if (input.type === 'click') element.click();
  else if (input.type === 'fill') { element.focus(); Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, input.value); element.dispatchEvent(new Event('input', { bubbles: true })); }
  else if (input.type === 'check') { if (!element.checked) element.click(); return element.checked; }
  return true;
}
const action = input => evaluate(`(${domAction.toString()})(${JSON.stringify(input)})`);
async function click(selector, text) { await until(`click ${text || selector}`, `(${domAction.toString()})(${JSON.stringify({ type: 'exists', selector, text })})`); await action({ type: 'click', selector, text }); }
async function fill(label, value) { await action({ type: 'fill', selector: `[aria-label=${JSON.stringify(label)}]`, value }); }
async function step(name, operation) { const began = performance.now(); report.phase = name; await operation(); report.steps.push({ name, durationMs: Math.round(performance.now() - began) }); }
async function layout(label) {
  const value = await evaluate(`({label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,bg:getComputedStyle(document.body).backgroundColor,fg:getComputedStyle(document.body).color})`);
  value.passed = value.documentWidth <= value.width + 1 && value.bodyWidth <= value.width + 1 && value.bg !== value.fg;
  const expected = /-(960|1440)-/.exec(label); if (expected && value.width !== Number(expected[1])) value.passed = false;
  report.layouts.push(value); if (!value.passed) report.errors.push(`Project flow layout overflow or unreadable paint: ${JSON.stringify(value)}`);
}
async function capture(name, selector) {
  await evaluate(`(async()=>{${selector ? `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start',behavior:'instant'});` : 'scrollTo(0,0);'}await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));})()`);
  await delay(60);
  const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); assert(!image.isEmpty(), 'Empty Chromium capture');
  const bytes = image.toPNG(), filename = `${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`; assert(bytes.length > 5000, 'Capture is unexpectedly blank');
  fs.writeFileSync(path.join(owner.output, filename), bytes, { flag: 'wx' }); report.screenshots.push({ filename, bytes: bytes.length, ...image.getSize(), sha256: hash(bytes) });
  report.rendererProcessIds = [...new Set([...report.rendererProcessIds, window.webContents.getOSProcessId()])];
}
async function scenario() {
  let returnPosition;
  report.performance = { budgetsMs: { firstProjectHub: 8000, returnToList: 8000, restoreListMemory: 8000, returnToListAndRestore: 8000, minimumIdleObservation: 550, wholeNativeProcess: 45000 }, interpretation: 'Bounded Windows CI DOM timing only; not a claim about customer-machine CPU, frame rate, provider latency, or real native Office throughput', measurements: [] };
  const sample = (name, began) => { const durationMs = Math.round(performance.now() - began), budgetMs = report.performance.budgetsMs[name]; report.performance.measurements.push({ name, durationMs, budgetMs, passed: durationMs <= budgetMs }); assert(durationMs <= budgetMs, name + ' exceeded the bounded CI interaction budget'); };
  await step('home-todos-no-provider-or-metadata-polling', async () => {
    await click('button', '查看首页待办');
    await until('actual saved feedback todo', "document.querySelector('[aria-label=\"业务待办\"]')!==null");
    const before = await evaluate('window.projectFlowBrowserFixture.snapshot().calls');
    const began = performance.now(); await delay(550);
    const after = await evaluate('window.projectFlowBrowserFixture.snapshot().calls');
    assert.equal(after.snapshots, before.snapshots); assert.equal(after.inventories.length, 0); assert.equal(after.artifactPreviews, 0); assert.equal(after.provider, 0);
    report.performance.measurements.push({ name: 'homeTodoIdle', durationMs: Math.round(performance.now() - began), snapshotsBefore: before.snapshots, snapshotsAfter: after.snapshots, artifactPreviewCalls: after.artifactPreviews, passed: true });
    await layout('home-todos-1440-light'); await click('button', '返回项目列表');
  });
  await step('project-list-view-and-overview', async () => {
    await click('[aria-label="列表视图"]');
    await until('list view selected', "document.querySelector('[aria-label=\"列表视图\"]')?.getAttribute('aria-pressed')==='true'");
    await layout('projects-1440-light'); await capture('projects-list-light-1440');
    const hubBegan = performance.now(), beforeInventory = await evaluate('window.projectFlowBrowserFixture.snapshot().calls.inventories.length');
    await click('.op-project-name', '合作说明返修验收');
    await until('actual project hub', 'document.querySelector(".project-hub h1")?.textContent==="合作说明返修验收"');
    returnPosition = await evaluate('JSON.parse(window.projectFlowBrowserFixture.browserState()).scrollTop');
    assert(returnPosition > 100, 'Expected a genuine scrolled project-list position');
    await until('adopted original file', 'document.querySelector(".project-hub-files")?.textContent.includes("合作说明-原版.docx")');
    sample('firstProjectHub', hubBegan);
    const before = await evaluate('window.projectFlowBrowserFixture.snapshot().calls'), idleBegan = performance.now(); await delay(550); const after = await evaluate('window.projectFlowBrowserFixture.snapshot().calls');
    assert.equal(after.inventories.length - beforeInventory, 1, 'Hub must request only the selected project metadata once'); assert.equal(after.snapshots, before.snapshots); assert.equal(after.artifactPreviews, 0);
    report.performance.measurements.push({ name: 'hubIdle', durationMs: Math.round(performance.now() - idleBegan), inventoryReads: after.inventories.length - beforeInventory, snapshotReadsDuringIdle: after.snapshots - before.snapshots, artifactPreviewCalls: after.artifactPreviews, passed: true });
    await layout('project-hub-1440-light'); await capture('project-hub-current-original');
    window.setContentSize(960, 1000); await delay(80); await layout('project-hub-960-light'); window.setContentSize(1440, 1000); await delay(80);
  });
  await step('feedback-exact-source-entry', async () => {
    await click('button', '处理客户反馈');
    await until('feedback approved', 'document.querySelector(".bs-feedback-item")?.textContent.includes("打开对应位置")||document.querySelector(".bs-feedback-item")?.textContent.includes("编辑并完成本轮")');
    await capture('feedback-source-light-1440', '.bs-feedback-item');
    await click('button', '编辑并完成本轮');
    await until('revision context', 'document.querySelector(".revision-context")!==null');
    await click('button', '载入返修原版');
    await until('exact selected paragraph', "document.querySelector('[aria-label=\"段落 1 内容\"]')?.value.includes('129元')");
    assert.equal(await evaluate('document.querySelector(".revision-context .btn-primary").disabled'), true);
  });
  await step('edit-export-and-atomic-adoption', async () => {
    await fill('段落 1 内容', '已确认价格为139元，其他产品参数保持不变。');
    await until('actual editor changed', "document.querySelector('[aria-label=\"段落 1 内容\"]')?.value.includes('139元')");
    await capture('editor-revision-draft-light-1440', '.revision-context');
    await click('[aria-label="导出Word"]');
    await until('formal UI export response and adoption ready', 'window.projectFlowBrowserFixture.snapshot().calls.exports===1&&!document.querySelector(".revision-context .btn-primary").disabled');
    await click('button', '已核对，采用并完成本轮');
    await until('returned original feedback confirmed', 'document.querySelector(".bs-feedback-item summary")?.textContent.includes("已核对完成")');
    const result = await evaluate('window.projectFlowBrowserFixture.snapshot()');
    assert.equal(result.calls.exports, 1); assert.equal(result.calls.adoptRevision.length, 1); assert.equal(result.record.document.blocks[0].text.includes('139元'), true);
    assert.equal(result.state.orders[0].outputIds[0], 'export-3'); assert(result.files.some(file => file.id === 'original-office')); assert.equal(result.calls.provider, 0);
  });
  await step('adopted-result-and-dark-narrow-layout', async () => {
    await click('button', '返回项目概览');
    await until('new adopted formal file', 'document.querySelector(".project-hub-files")?.textContent.includes("合作说明-修订-v3.docx")');
    await click('button', '切到黑夜'); await layout('project-hub-1440-dark'); window.setContentSize(960, 1000); await delay(100);
    await layout('project-hub-960-dark'); await capture('project-hub-adopted-dark-960');
  });
  await step('return-project-list-remembers-view-and-scroll', async () => {
    const returnBegan = performance.now();
    await click('.project-hub > .text-button', '全部项目');
    await until('project list restored', "document.querySelector('[aria-label=\"列表视图\"]')?.getAttribute('aria-pressed')==='true'");
    sample('returnToList', returnBegan); const memoryBegan = performance.now();
    await until('scroll position restored', `Math.abs(document.querySelector('.app-content').scrollTop-${returnPosition})<3`);
    sample('restoreListMemory', memoryBegan); sample('returnToListAndRestore', returnBegan);
    await layout('projects-960-dark'); await capture('projects-return-memory-dark-960');
  });
  report.simulation = await evaluate('window.projectFlowBrowserFixture.snapshot()');
  assert.equal(report.simulation.calls.provider, 0);
}
async function run() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let permit = details.url.startsWith('data:image/');
    try { if (details.url.startsWith('file:')) { const file = fileURLToPath(details.url), relative = path.relative(owner.dist, file).replaceAll('\\', '/'); permit = !!owner.files[relative] && same(path.join(owner.dist, relative), file); } } catch { permit = false; }
    if (!permit) report.blockedRequests.push(details.url.split('?')[0].slice(0, 180)); callback({ cancel: !permit });
  });
  session.defaultSession.on('will-download', event => event.preventDefault());
  window = new BrowserWindow({ width: 1440, height: 1000, useContentSize: true, show: false, frame: false, backgroundColor: '#ffffff', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } }); report.windows.created++;
  window.on('show', () => { report.windows.shown++; finish(Error('Fixture window must remain hidden')); }); window.on('closed', () => { report.windows.destroyed++; });
  const contents = window.webContents; contents.setWindowOpenHandler(() => ({ action: 'deny' })); contents.on('will-navigate', event => event.preventDefault()); contents.on('will-redirect', event => event.preventDefault()); contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('render-process-gone', () => finish(Error('PROJECT_FLOW_RENDER_PROCESS_GONE')));
  contents.on('console-message', (_event, level, message) => { if (typeof level === 'object' ? level.level === 'error' : level >= 3) report.errors.push(String(typeof level === 'object' ? level.message : message).slice(0, 1200)); });
  await contents.loadFile(path.join(owner.dist, 'project-flow-browser-fixture.html'));
  report.rendererProcessIds.push(contents.getOSProcessId());
  await until('actual React fixture rendered', `window.projectFlowBrowserFixture?.kind==='isolated-project-flow-example'&&document.querySelector('.op-page .page-title')?.textContent.includes('我的作品')`);
  window.setContentSize(1440, 1000); await delay(160);
  assert.equal(BrowserWindow.getAllWindows().length, 1); await scenario();
  assert.equal(Object.keys(require.cache).some(file => same(file, path.join(root, 'electron/main.cjs'))), false);
  if (report.blockedRequests.length) report.errors.push('The renderer attempted requests outside its verified fixture bundle'); report.phase = 'complete'; finish();
}
try { prepare(); run().catch(finish); } catch (error) { finish(error); }
