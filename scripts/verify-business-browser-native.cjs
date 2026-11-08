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
  assert(same(path.dirname(directory), fs.realpathSync(process.env.RUNNER_TEMP))); assert.match(path.basename(directory), /^xuzuo-business-browser-[a-z0-9-]+$/i);
  const ownerPath = path.join(directory, 'owner.json'); assert(ordinary(ownerPath).size < 100000); owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  assert.equal(owner.kind, 'xuzuo-business-browser'); assert.equal(owner.commit, process.env.GITHUB_SHA); assert.match(owner.nonce, /^[a-f0-9-]{36}$/i);
  assert(same(owner.dist, path.join(root, 'work/business-browser-dist'))); assert(same(owner.output, path.join(root, 'work/business-browser-output'))); ordinary(owner.dist, true); ordinary(owner.output, true);
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
const deadline = setTimeout(() => finish(Error('BUSINESS_BROWSER_45_SECOND_DEADLINE')), 45000);
app.on('window-all-closed', () => {});
process.on('uncaughtException', finish); process.on('unhandledRejection', finish);
async function evaluate(source) {
  let timer;
  try { return await Promise.race([window.webContents.executeJavaScript(source, true), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('BUSINESS_DOM_EVALUATION_TIMEOUT')), 3000); })]); }
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
  const value = await evaluate(`(() => { const root=document.documentElement, body=document.body, panel=document.querySelector('.business-studio');return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,theme:root.dataset.appTheme,documentWidth:root.scrollWidth,bodyWidth:body.scrollWidth,panelWidth:panel?.scrollWidth,panelClient:panel?.clientWidth,bg:getComputedStyle(body).backgroundColor,fg:getComputedStyle(body).color,overflow:[...document.querySelectorAll('.business-studio button,.business-studio input,.business-studio textarea,.bs-panel,.bs-orders')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,text:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,70),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(b=>b.left < -1 || b.right > innerWidth+1).slice(0,12)};})()`);
  value.passed = value.documentWidth <= value.width + 1 && value.bodyWidth <= value.width + 1 && value.panelWidth <= value.panelClient + 1 && !value.overflow.length;
  report.layouts.push(value); if (!value.passed) report.errors.push(`Horizontal overflow at ${label}: ${JSON.stringify(value)}`);
  const expected = /-(960|1440)-/.exec(label); if (expected && value.width !== Number(expected[1])) report.errors.push(`Viewport at ${label} is ${value.width}, expected ${expected[1]}`);
  if (value.bg === value.fg) report.errors.push(`Unreadable identical foreground/background at ${label}`);
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
  await step('three-entries-and-merchant-selection', async () => {
    await until('three business entry cards', `document.querySelector('[aria-label="选择业务制作套餐"]')?.querySelectorAll('button').length===3`);
    await layout('entries-1440-light'); await capture('entries-light-1440');
    await click('[aria-label="选择业务制作套餐"] button', '商家商品套餐'); await until('merchant creation entry', `document.querySelector('.bs-new-order h2')?.textContent==='商家商品套餐'`);
    await click('.bs-orders button', '青禾茶饮 · 上新商品套餐');
    await until('model selected before sample', `document.querySelector('[aria-label="图片背景模型"]')?.textContent.includes('示例已配置图片模型') && document.querySelector('[aria-label="文字与资料账户"]')?.textContent.includes('无真实Key')`);
  });
  await step('sample-once-and-continue', async () => {
    await click('button', '先制作样稿'); await until('sample review', `document.querySelector('.bs-production h2')?.textContent==='先检查这一款样稿'`); await capture('merchant-sample-light-1440', '.bs-production');
    await click('button', '样稿满意，继续其余'); await until('remaining work finished', `window.businessBrowserFixture.snapshot().orders.find(o=>o.id==='merchant').status==='review'`); await click('button', '查看已有成品');
    await until('actual sample output card', `document.querySelector('.bs-final-grid')?.textContent.includes('本地示例正式版.png')`);
    assert.equal(await evaluate(`document.querySelector('.bs-delivery-checks .btn-primary').disabled`), true);
  });
  await step('formal-file-delivery', async () => {
    for (const text of ['内容与商品事实已核对', '图片、字体及素材的使用权已确认', '实际文件可打开，尺寸与排版已检查']) {
      const selector = await evaluate(`(() => { const label=[...document.querySelectorAll('.bs-delivery-checks label')].find(e=>e.textContent.trim()===${JSON.stringify(text)});const index=[...document.querySelectorAll('.bs-delivery-checks label')].indexOf(label);return index<0?null:'.bs-delivery-checks label:nth-of-type('+(index+1)+') input';})()`);
      assert(selector, 'Delivery checkbox label missing'); await action({ type: 'check', selector });
    }
    await click('button', '确认当前版本交付'); await until('confirmed delivery', `window.businessBrowserFixture.snapshot().orders.find(o=>o.id==='merchant').status==='complete'`);
    await layout('merchant-delivery-1440-light'); await capture('merchant-delivery-light-1440', '.bs-delivery-checks');
  });
  await step('actual-receipt-input', async () => {
    await click('.bs-delivery-tabs button', '收支与工时'); await until('finance panel', `document.querySelector('.bs-money-summary')!==null`);
    await fill('实际交易金额', '120.50'); await fill('实际售出件数', '3'); await click('button', '记录收款');
    await until('receipt recorded', `window.businessBrowserFixture.snapshot().transactions.some(t=>t.kind==='receipt'&&t.amountCents===12050&&t.quantity===3)`); await capture('receipt-light-1440', '.bs-money-summary');
  });
  await step('digital-entry-and-960-layout', async () => {
    await click('button', '新制作单'); await click('[aria-label="选择业务制作套餐"] button', '数字商品上架包'); await until('digital creation entry', `document.querySelector('.bs-new-order h2')?.textContent==='数字商品上架包'`);
    await click('.bs-orders button', '原创壁纸 · 数字上架包'); await click('button', '选择作品，整理上架包'); await click('.bs-delivery-tabs button', '上架与交付包');
    await until('digital listing fields', `document.querySelector('[aria-label="上架商品标题"]')?.value==='原创壁纸 · 数字上架包'`);
    window.setContentSize(960, 1000); await delay(80); await layout('digital-960-light'); await capture('digital-light-960', '.bs-order-heading');
  });
  await step('documents-entry-dark-and-responsiveness', async () => {
    await click('button', '新制作单'); await click('[aria-label="选择业务制作套餐"] button', '客户资料套件'); await until('documents creation entry', `document.querySelector('.bs-new-order h2')?.textContent==='客户资料套件'`);
    await click('.bs-orders button', '山野合作 · 客户资料套件'); await until('PPT Word Excel options', `['PPT提案','Word方案','Excel表格'].every(text=>document.querySelector('[aria-label="选择配套文件"]')?.textContent.includes(text))`);
    await click('button', '切到黑夜'); await until('actual dark mode', `document.documentElement.dataset.appTheme==='dark' && getComputedStyle(document.body).backgroundColor==='rgb(0, 0, 0)'`);
    await layout('documents-960-dark'); await capture('documents-dark-960', '.bs-stage-tabs'); window.setContentSize(1440, 1000); await delay(80); await layout('documents-1440-dark');
  });
  report.simulation = await evaluate(`({calls:window.businessBrowserFixture.calls(),state:window.businessBrowserFixture.snapshot()})`);
  assert.equal(report.simulation.calls.start.length, 1); assert.equal(report.simulation.calls.start[0].sampleOnly, true); assert.equal(report.simulation.calls.control.length, 1); assert.equal(report.simulation.calls.control[0].action, 'continue'); assert.equal(report.simulation.calls.deliver.length, 1); assert.equal(report.simulation.calls.assist, 0); assert.equal(report.simulation.calls.listing, 0);
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
  contents.on('render-process-gone', () => finish(Error('BUSINESS_RENDER_PROCESS_GONE')));
  contents.on('console-message', (_event, level, message) => { if (typeof level === 'object' ? level.level === 'error' : level >= 3) report.errors.push(String(typeof level === 'object' ? level.message : message).slice(0, 1200)); });
  await contents.loadFile(path.join(owner.dist, 'business-browser-fixture.html'));
  report.rendererProcessIds.push(contents.getOSProcessId());
  await until('actual React fixture rendered', `window.businessBrowserFixture?.kind==='isolated-business-example'&&document.querySelector('.business-studio h1')?.textContent==='业务制作'`);
  window.setContentSize(1440, 1000); await delay(160);
  assert.equal(BrowserWindow.getAllWindows().length, 1); await scenario();
  assert.equal(Object.keys(require.cache).some(file => same(file, path.join(root, 'electron/main.cjs'))), false);
  if (report.blockedRequests.length) report.errors.push('The renderer attempted requests outside its verified fixture bundle'); report.phase = 'complete'; finish();
}
try { prepare(); run().catch(finish); } catch (error) { finish(error); }
