const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, session, ipcMain, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..'), began = performance.now(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const report = { passed: false, phase: 'prepare', commit: process.env.GITHUB_SHA, scope: 'Actual production UI plus real managed files, nativeImage, CPU workers and BrowserWindow font capture; PageProps project creation/navigation and unit-callback capture are seams; synthetic prior-cost ledger is not a paid receipt; no OS picker or supplier validation', providerCalls: 0, normalApplicationStarted: false, userProfileAccessed: false, windows: { created: 0, shown: 0, destroyed: 0, remaining: 0 }, processIds: [process.pid], rendererProcessIds: [], screenshots: [], layouts: [], hitTests: [], scrollTests: [], steps: [], contracts: {}, errors: [], rendererConsole: [], blockedRequests: [], fontWindows: [] };
let owner, directory, window, data, dataDependencies, finished = false;
app.on('browser-window-created', (_event, created) => { report.windows.created++; created.on('show', () => report.windows.shown++); created.on('closed', () => report.windows.destroyed++); created.webContents.on('did-finish-load', () => { if (created !== window && created.webContents.getURL().startsWith('data:text/html')) report.fontWindows.push({ id: created.id, size: created.getContentSize(), actualBrowserWindowFontCapture: true }); }); });
function ordinary(file, isDirectory = false) { const info = fs.lstatSync(file); assert(!info.isSymbolicLink()); assert(isDirectory ? info.isDirectory() : info.isFile()); assert(same(fs.realpathSync(file), file)); return info; }
function prepare() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
  assert(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE); assert(same(root, fs.realpathSync(process.env.GITHUB_WORKSPACE)));
  assert(path.isAbsolute(process.argv[2])); directory = path.resolve(process.argv[2]); ordinary(directory, true);
  assert(same(path.dirname(directory), fs.realpathSync(process.env.RUNNER_TEMP))); assert.match(path.basename(directory), /^xuzuo-production-usability-[a-z0-9-]+$/i);
  const ownerFile = path.join(directory, 'owner.json'); assert(ordinary(ownerFile).size < 100000); owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  assert.equal(owner.kind, 'xuzuo-production-usability'); assert.equal(owner.commit, process.env.GITHUB_SHA); assert.match(owner.nonce, /^[a-f0-9-]{36}$/i);
  assert(same(owner.dist, path.join(root, 'work/production-usability-dist')) && same(owner.output, path.join(root, 'work/production-usability-output')));
  ordinary(owner.dist, true); ordinary(owner.output, true); assert(Object.keys(owner.files).length > 1 && Object.keys(owner.files).length <= 512);
  for (const [name, digest] of Object.entries(owner.files)) { assert(/^[a-z0-9_./-]+$/i.test(name) && !name.split('/').includes('..')); assert.match(digest, /^[a-f0-9]{64}$/); const file = path.join(owner.dist, name); assert(ordinary(file).size < 16 * 1024 * 1024); assert.equal(hash(fs.readFileSync(file)), digest); }
  for (const [name, digest] of Object.entries(owner.sources)) { assert(/^(?:src|scripts|electron)\//.test(name) && !name.split('/').includes('..')); const file = path.join(root, name); ordinary(file); assert.equal(hash(fs.readFileSync(file)), digest, 'Source changed after bundle: ' + name); }
  assert.equal(typeof owner.localRuntime, 'boolean');
  const dependencyRoot = path.join(root, ...(owner.localRuntime ? ['work', 'ui-build'] : []), 'node_modules'); assert(same(owner.dependencyRoot, dependencyRoot)); ordinary(dependencyRoot, true);
  const Module = require('node:module'); process.env.NODE_PATH = dependencyRoot; Module._initPaths();
  const dependencyRequire = Module.createRequire(path.join(path.dirname(dependencyRoot), 'package.json'));
  const dependencies = Object.fromEntries(['image-size', 'pngjs', 'jszip'].map(name => [name, dependencyRequire.resolve(name)]));
  for (const filename of Object.values(dependencies)) assert(filename.toLowerCase().startsWith(dependencyRoot.toLowerCase() + path.sep));
  const resolve = Module._resolveFilename; Module._resolveFilename = function (name, parent, ...rest) { return Object.hasOwn(dependencies, name) ? dependencies[name] : resolve.call(this, name, parent, ...rest); };
  dataDependencies = dependencyRequire;
  report.dependencyMode = owner.localRuntime ? 'owned-local-build-runtime' : 'locked-ci-root';
  const profile = path.join(directory, 'profile'); ordinary(profile, true); app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration(); report.nonce = owner.nonce;
  assert(!fs.existsSync(path.join(directory, 'native-report.json')));
}
async function evaluate(source) {
  let timer;
  try { return await Promise.race([window.webContents.executeJavaScript(source, true), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('PRODUCTION_USABILITY_DOM_TIMEOUT')), 4000); })]); }
  catch (error) { report.failedEvaluation = source.slice(0, 2000); throw error; }
  finally { clearTimeout(timer); }
}
async function until(label, source, timeout = 9000) { const end = performance.now() + timeout; do { if (await evaluate(source)) return; await delay(40); } while (performance.now() < end && !finished); throw Error('DOM condition not reached: ' + label); }
function domControl(input) {
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const node = [...document.querySelectorAll(input.selector)].find(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && (!input.text || text(element) === input.text));
  if (input.exists) return !!node && !node.matches(':disabled');
  if (!node || node.matches(':disabled')) throw Error('Missing active control: ' + input.selector + ' / ' + (input.text || ''));
  node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const rect = node.getBoundingClientRect(), x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2), hit = document.elementFromPoint(x, y);
  const reachable = !!hit && (node === hit || node.contains(hit));
  if (!reachable || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) throw Error('Control is obscured or outside viewport: ' + input.selector);
  if (input.focus) node.focus({ preventScroll: true });
  return { label: text(node), x, y, width: rect.width, height: rect.height, reachable };
}
async function point(selector, text, focus = false) {
  const input = { selector, text, focus };
  await until('control ' + (text || selector), `(${domControl.toString()})(${JSON.stringify({ ...input, exists: true })})`);
  const probe = '(' + domControl.toString() + ')(' + JSON.stringify(input) + ')';
  let previous = await evaluate(probe);
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    await delay(20);
    const result = await evaluate(probe);
    if (result.x === previous.x && result.y === previous.y && result.width === previous.width && result.height === previous.height) {
      report.hitTests.push({ selector, ...result });
      return result;
    }
    previous = result;
  }
  throw Error('Control did not settle: ' + selector);
}
async function click(selector, text) {
  const hit = await point(selector, text); window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: hit.x, y: hit.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  await delay(35);
}
async function fill(selector, value) {
  await click(selector); await point(selector, undefined, true);
  const token = `${owner.nonce}:input:${(report.textInputs?.length || 0) + 1}`;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.productionUsabilityInput=${JSON.stringify(token)}`);
  const read = `(()=>{const input=document.querySelector(${JSON.stringify(selector)});return input?{value:input.value,sameElement:input.dataset.productionUsabilityInput===${JSON.stringify(token)},focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd,disabled:input.disabled,readOnly:input.readOnly,inert:!!input.closest('[inert]')}:null})()`;
  const measurement = { selector, token, expected: value, selection: 'DOM full range; actual text is inserted by Electron, not a value setter', before: await evaluate(read), verified: false };
  try {
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(input?.dataset.productionUsabilityInput!==${JSON.stringify(token)})throw Error('Native input element changed');input.focus({preventScroll:true});input.setSelectionRange(0,input.value.length)})()`);
    await until('focused full selection before native text input', `(()=>{const input=document.querySelector(${JSON.stringify(selector)});return input?.dataset.productionUsabilityInput===${JSON.stringify(token)}&&document.activeElement===input&&input.selectionStart===0&&input.selectionEnd===input.value.length&&!input.disabled&&!input.readOnly&&!input.closest('[inert]')})()`, 4000);
    measurement.selected = await evaluate(read);
    await window.webContents.insertText(value); await until('native text input', `(()=>{const input=document.querySelector(${JSON.stringify(selector)});return input?.dataset.productionUsabilityInput===${JSON.stringify(token)}&&input.value===${JSON.stringify(value)}})()`);
    measurement.verified = true;
  } finally { measurement.after = await evaluate(read); (report.textInputs ||= []).push(measurement); }
}
async function viewport(width, mode) { window.setContentSize(width, 940); await click('.puf-header button', mode === 'dark' ? '黑夜' : '白天'); await until('theme resolved', `document.documentElement.dataset.appTheme===${JSON.stringify(mode)}`); }
async function layout(name, selector) {
  const value = await evaluate(`(()=>{const host=document.querySelector(${JSON.stringify(selector)});if(!host)throw Error('Missing layout');const r=host.getBoundingClientRect(),paint=getComputedStyle(host);return {name:${JSON.stringify(name)},width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,left:r.left,right:r.right,hostWidth:r.width,color:paint.color,background:paint.backgroundColor}})()`);
  value.passed = value.documentWidth <= value.width + 2 && value.bodyWidth <= value.width + 2 && value.left >= -2 && value.right <= value.width + 2 && value.hostWidth > 200;
  report.layouts.push(value); assert(value.passed, 'Layout overflow: ' + JSON.stringify(value));
}
async function capture(name) {
  await evaluate('(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})))})()');
  window.webContents.invalidate(); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await delay(80);
  const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), bytes = image.toPNG(); assert(!image.isEmpty() && bytes.length > 5000);
  const filename = `${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`; fs.writeFileSync(path.join(owner.output, filename), bytes, { flag: 'wx' }); report.screenshots.push({ filename, bytes: bytes.length, ...image.getSize(), sha256: hash(bytes) });
}
async function step(name, operation) { report.phase = name; const start = performance.now(); await operation(); report.steps.push({ name, durationMs: Math.round(performance.now() - start) }); }
async function managedImage(kind, expectedUnit) {
  const selector = '.dap-document-image img'; await until(kind + ' original image decoded', `document.querySelector(${JSON.stringify(selector)})?.naturalWidth===360&&!document.querySelector('.dap-image-placeholder')`);
  const displayed = await evaluate(`(()=>{const image=document.querySelector(${JSON.stringify(selector)});return {src:image.src,width:image.naturalWidth,height:image.naturalHeight,id:image.closest('[data-artifact-id]').dataset.artifactId}})()`);
  assert.equal(displayed.id, data.context.imageIds[kind]);
  const source = await data.artifactStore.read(displayed.id); assert.equal(source.projectId, `usability-${kind}`);
  assert.deepEqual(nativeImage.createFromDataURL(displayed.src).toBitmap(), nativeImage.createFromBuffer(source.buffer).toBitmap(), 'Displayed image must decode to the real managed PNG pixels');
  await click('.dap-image-open'); await until(kind + ' actual component emits unit id', `window.productionUsabilityFixture.snapshot().unit===${JSON.stringify(expectedUnit)}`);
  const scroll = await evaluate(`(()=>{const box=document.querySelector('.puf-main');box.scrollTop=0;return {height:box.clientHeight,total:box.scrollHeight}})()`); assert(scroll.total > scroll.height + 5);
  const position = await evaluate('(()=>{const box=document.querySelector(".puf-main"),r=box.getBoundingClientRect();return {x:Math.round(r.right-25),y:Math.round(r.top+r.height/2)}})()');
  // Allow Chromium to commit the scroll reset before dispatching a wheel gesture.
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
  for (let count = 0; count < 3; count++) {
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...position, deltaX: 0, deltaY: -400, canScroll: true });
    await delay(100);
    if (await evaluate('document.querySelector(".puf-main").scrollTop>0')) break;
  }
  await until(kind + ' content scrolls', 'document.querySelector(".puf-main").scrollTop>0'); report.scrollTests.push({ kind, nativeWheel: true, ...scroll });
  await point('.dap-image-open');
  report[kind + 'Preview'] = { managedArtifactId: source.id, sourceSha256: hash(source.buffer), originalPixelsMatch: true, width: displayed.width, height: displayed.height, clickedUnit: expectedUnit, callbackCaptureSeam: true };
  report.contracts[kind + 'ManagedImage'] = true;
}
async function performanceSwitchGeometry() {
  const geometry = await evaluate(`(()=>{
    const button=document.querySelector('[aria-label="低占用模式"]'),thumb=button.querySelector(':scope > span'),row=button.closest('.op-setting-switch-row'),copy=row.querySelector(':scope > div');
    const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,centerY:r.top+r.height/2}};
    const paint=node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,opacity:s.opacity,visibility:s.visibility,display:s.display,borderRadius:s.borderRadius,transform:s.transform}};
    const rect=box(button),hit=document.elementFromPoint(rect.left+rect.width/2,rect.centerY);
    return {checked:button.getAttribute('aria-checked'),button:rect,thumb:box(thumb),row:box(row),copy:box(copy),buttonPaint:paint(button),thumbPaint:paint(thumb),rowPaint:paint(row),hitReachable:!!hit&&(hit===button||button.contains(hit))};
  })()`);
  (report.performanceSwitchSamples ||= []).push(geometry);
  const painted = value => value.background !== 'transparent' && !/^rgba\([^)]*,\s*0\s*\)$/.test(value.background) && value.visibility === 'visible' && value.display !== 'none' && Number(value.opacity) > 0;
  assert(geometry.button.width >= 44 && geometry.button.height >= 26, 'Performance switch must retain the full 44 by 26 pixel target');
  assert(painted(geometry.buttonPaint) && painted(geometry.thumbPaint), 'Performance switch and thumb need independently visible painted backgrounds');
  assert(geometry.thumb.width >= 18 && geometry.thumb.height >= 18 && geometry.buttonPaint.background !== geometry.thumbPaint.background, 'Performance switch thumb must visibly contrast with its pill');
  assert(['flex', 'inline-flex'].includes(geometry.rowPaint.display) && geometry.button.left >= geometry.copy.right + 10 && Math.abs(geometry.row.right - geometry.button.right) <= 2, 'Performance switch must align to the right of its explanation on the same flex row');
  assert(Math.abs(geometry.button.centerY - geometry.copy.centerY) <= 2 && geometry.button.top < geometry.copy.bottom && geometry.button.bottom > geometry.copy.top, 'Performance switch must be vertically centred beside the explanation, not below it');
  assert(geometry.hitReachable, 'Performance switch must be reachable at its painted centre');
  return geometry;
}
async function scenario() {
  const priorLedger = await evaluate('JSON.stringify(window.productionUsabilityFixture.snapshot().ledger)');
  await step('performance-real-service-persistence-and-on-demand-sampling', async () => {
    await viewport(1440, 'light'); await until('performance switch ready', 'document.querySelector("[aria-label=低占用模式]")?.disabled===false');
    const unchecked = await performanceSwitchGeometry(); assert.equal(unchecked.checked, 'false');
    await click('[aria-label="低占用模式"]'); await until('low resource saved', 'document.querySelector("[aria-label=低占用模式]")?.getAttribute("aria-checked")==="true"');
    await until('checked switch background finishes painting', `(()=>{const button=document.querySelector('[aria-label="低占用模式"]');return button?.getAttribute('aria-checked')==='true'&&button.getAnimations().every(animation=>animation.playState==='finished')&&getComputedStyle(button).backgroundColor!==${JSON.stringify(unchecked.buttonPaint.background)}})()`, 3000);
    const checked = await performanceSwitchGeometry(), uncheckedOffset = unchecked.thumb.left - unchecked.button.left, checkedOffset = checked.thumb.left - checked.button.left;
    assert.equal(checked.checked, 'true'); assert(checkedOffset - uncheckedOffset >= 16 && checked.thumb.right <= checked.button.right && checked.thumb.top >= checked.button.top && checked.thumb.bottom <= checked.button.bottom, 'Checked performance thumb must move to the right within its fixed pill');
    assert.equal(checked.button.width, unchecked.button.width); assert.equal(checked.button.height, unchecked.button.height); assert.notEqual(checked.buttonPaint.background, unchecked.buttonPaint.background, 'Checked performance pill must change its painted background');
    await click('.performance-settings summary'); await click('.performance-summary button', '刷新采样');
    await until('actual IPC refresh', 'document.querySelector(".performance-metrics")?.textContent.includes("CPU")');
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'performance-v1.json'), 'utf8')); assert.equal(persisted.lowResource, true);
    const reread = require('../electron/performance-control.cjs').createPerformanceControl({ directory, cpuTasks: data.cpuTasks, metrics: () => app.getAppMetrics() }); assert.equal((await reread.read()).lowResource, true); await reread.flush();
    const sample = await data.performanceControl.read(); assert(sample.memoryMb > 0); assert.equal(data.calls.performanceSaves, 1); assert(data.calls.performanceReads >= 2);
    report.performance = { persisted, sample, realCpuScheduler: true, diskReread: true, onDemandOnly: true, switchGeometry: { unchecked, checked, actualThumbTravel: checkedOffset - uncheckedOffset, fixedPill: true, sameRowAndCentred: true, paintedHitTarget: true } }; report.contracts.performancePersisted = true;
    await layout('performance-1440-light', '.performance-settings'); await capture('performance-1440-light');
  });
  await step('word-real-managed-picture-click-and-native-scroll', async () => { await viewport(960, 'light'); await click('.puf-header button', 'Word 预览'); await managedImage('word', 'word-picture'); await layout('word-960-light', '.dap-preview'); await capture('word-960-light');
    await click('button', '编辑所选插图');
    await click('summary', '用 AI 精修这张图片');
    await click('[aria-label="文档插图精修凭证"]');
    await click('[role="option"]', '测试账户乙');
    if (await evaluate('document.querySelector(".document-image-model-settings").open')) await click('.document-image-model-settings summary');
    await click('.puf-header button', 'Word 预览');
    await click('button', '编辑所选插图');
    await until('project image account restores after remount', `document.querySelector('.document-image-model-settings summary')?.textContent.includes('测试账户乙') && !document.querySelector('.document-image-model-settings').open`);
    report.documentImageBindingRestored = true;
  });
  await step('ppt-real-managed-picture-click-and-native-scroll', async () => { await viewport(1440, 'dark'); await click('.puf-header button', 'PPT 预览'); await managedImage('ppt', 'ppt-picture'); await layout('ppt-1440-dark', '.dap-preview'); await capture('ppt-1440-dark'); });
  await step('reflow-per-target-approval-and-real-independent-engineering-files', async () => {
    await viewport(960, 'dark'); await click('.puf-header button', '多比例排版');
    const before = await data.artifactStore.listProject(data.projects[0].id);
    await click('.commerce-reflow-dialog footer button', '生成 3 版预览');
    await until('three actual rendered previews', 'document.querySelectorAll(".commerce-reflow-previews article img").length===3&&[...document.querySelectorAll(".commerce-reflow-previews img")].every(image=>image.naturalWidth>0)', 20000);
    assert.deepEqual(await data.artifactStore.listProject(data.projects[0].id), before, 'Preview must not write project outputs');
    assert.equal(await evaluate('document.querySelector(".commerce-reflow-dialog footer .btn-primary").disabled'), true);
    const approvals = await evaluate('[...document.querySelectorAll(".commerce-reflow-previews input")].map(input=>input.getAttribute("aria-label"))');
    for (const [index, label] of approvals.entries()) { await click(`[aria-label=${JSON.stringify(label)}]`); assert.equal(await evaluate('document.querySelector(".commerce-reflow-dialog footer .btn-primary").disabled'), index < 2); }
    await layout('reflow-960-dark', '.commerce-reflow-dialog'); await capture('reflow-960-dark');
    data.failThirdEncodingOnce();
    await click('.commerce-reflow-dialog footer button', '确认并导出 3 版');
    await until('two actual exports remain resumable after injected third encoder failure', 'document.querySelector(".commerce-reflow-recovery")?.dataset.completed==="2"&&!document.querySelector(".commerce-reflow-recovery button")?.disabled', 25000);
    const job = (await data.commerce.reflowJobs({ ...data.scope, expectedRevision: data.document.revision })).jobs[0]; assert.equal(job.completed, 2); assert.equal(job.total, 3);
    const completedHashes = new Map(); for (const id of job.targets.flatMap(target => target.artifactIds)) completedHashes.set(id, hash((await data.artifactStore.read(id)).buffer));
    await click('.commerce-reflow-dialog footer button', '取消'); await data.restartCommerce();
    const previewsBeforeResume = data.calls.reflowPreviews, encodingsBeforeResume = data.calls.finalComposes;
    await click('.puf-header button', '多比例排版'); await until('disk recovery survives actual service recreation', 'document.querySelector(".commerce-reflow-recovery")?.dataset.completed==="2"');
    await click('.commerce-reflow-recovery button', '继续剩余 1 版');
    await until('three saved independent variants', 'window.productionUsabilityFixture.snapshot().result?.variants.length===3&&!document.querySelector(".commerce-reflow-dialog")', 25000);
    assert.equal(data.calls.reflowPreviews, previewsBeforeResume); assert.equal(data.calls.finalComposes - encodingsBeforeResume, 1); assert.equal(data.calls.encodingFaults, 1); assert.equal(data.calls.serviceRestarts, 1);
    for (const [id, sha256] of completedHashes) assert.equal(hash((await data.artifactStore.read(id)).buffer), sha256);
    report.reflowRecovery = { jobId: job.id, completedBefore: 2, total: 3, injectedLocalEncoderFailure: true, backendServiceRecreated: true, applicationProcessRestarted: false, persistentApprovals: true, oneClickRemainingOnly: true, successfulFilesUnchanged: true, noAdditionalPreview: true, finalEncodings: data.calls.finalComposes - encodingsBeforeResume, savedArtifactIds: [...completedHashes.keys()] };
    const snapshot = await data.snapshot(), result = snapshot.lastReflow; assert.equal(result.variants.length, 3);
    const outputs = [];
    for (const variant of result.variants) {
      const png = result.artifacts.find(file => variant.artifactIds.includes(file.id) && file.mimeType === 'image/png'); assert(png);
      const raw = await data.artifactStore.read(png.id), image = nativeImage.createFromBuffer(raw.buffer); assert.deepEqual(image.getSize(), { width: variant.width, height: variant.height });
      const projectId = data.projects[0].id, link = await require('../electron/commerce-image-store.cjs').createCommerceImageStore({ workspaceStorage: data.workspaceStorage }).linked(projectId, png.id);
      assert(link && variant.artifactIds.includes(link.snapshotId)); const sourceRecord = await data.artifactStore.read(link.snapshotId), exportedDocument = JSON.parse(sourceRecord.buffer.toString('utf8'));
      assert.equal(sourceRecord.projectId, projectId); assert.equal(sourceRecord.runId, raw.runId); assert.equal(exportedDocument.id, variant.documentId);
      const savedVariant = await data.commerce.templateSource({ projectId, sourceArtifactId: data.source.id, documentId: variant.documentId }); assert.deepEqual(exportedDocument, savedVariant);
      const reopened = await data.commerce.read({ projectId, sourceArtifactId: png.id }); assert.equal(reopened.document.id, link.workingDocumentId); assert.notEqual(reopened.document.id, variant.documentId); assert.notEqual(reopened.document.id, data.document.id);
      const layoutDocument = value => ({ ...value, id: '', revision: 0, updatedAt: '' }); assert.deepEqual(layoutDocument(reopened.document), layoutDocument(savedVariant)); assert.equal(reopened.document.layers.length, 2);
      const pixels = image.toBitmap(); let darkHeaderPixels = 0; for (let y = 0; y < image.getSize().height * .24; y++) for (let x = 0; x < image.getSize().width; x++) { const at = (y * image.getSize().width + x) * 4; if (pixels[at] < 90 && pixels[at + 1] < 90 && pixels[at + 2] < 90 && pixels[at + 3] > 200) darkHeaderPixels++; }
      assert(darkHeaderPixels > 20, 'Actual exported text must paint real glyph pixels'); outputs.push({ artifactId: png.id, documentId: variant.documentId, snapshotArtifactId: link.snapshotId, reopenedWorkingDocumentId: reopened.document.id, exactLayoutPreserved: true, width: variant.width, height: variant.height, sha256: hash(raw.buffer), darkHeaderPixels });
    }
    assert(report.fontWindows.length >= 6, 'Real BrowserWindow font renderer must run for preview and final outputs');
    report.reflow = { outputs, previewCreatesNoOutputs: true, allThreeApprovalsRequired: true, actualFontCapture: true }; report.contracts.perTargetApproval = report.contracts.independentEditableOutputs = report.contracts.realTextRaster = true;
  });
  await step('editable-template-saved-and-instantiated-through-production-ui', async () => {
    await viewport(1440, 'light'); await click('.puf-header button', '项目模板'); await click('.puf-template-host button', '存为模板');
    await until('actual creative template detected', 'document.querySelector("[aria-label=可编辑模板来源]")?.textContent.includes("图层")');
    await fill('[aria-label="模板或新作品名称"]', '独立可编辑海报模板'); await click('.template-options input[type="checkbox"]'); await click('.project-template-dialog footer button', '保存模板');
    await until('template UI closes after real save', '!document.querySelector(".project-template-dialog")'); assert.equal(data.calls.templateSaves, 1);
    const portable = await data.templates.exportWorkspace(data.context.workspaceId), template = portable.items[0]; assert.equal(template.creative.kind, 'commerce');
    assert(!JSON.stringify(template).includes('客户甲')); for (const forbidden of ['credentialId', 'fee', 'ledger', 'costCents']) assert(!JSON.stringify(template).includes('"' + forbidden + '"'));
    await click('.puf-template-host button', '使用已保存模板'); await until('real saved template selected', 'document.querySelector("[aria-label=选择项目模板]")?.textContent.includes("独立可编辑海报模板")');
    await fill('[aria-label="模板或新作品名称"]', '独立新海报'); await click('.project-template-dialog footer button', '创建并继续');
    await until('instantiated real project opens editable layers', 'document.querySelector(".cle-text-content")!==null', 15000);
    assert.equal(data.calls.templateInstantiations, 1); assert.equal(data.calls.createdProjects, 1);
    await fill('[aria-label="准确文字内容"]', '新商品售价 88 元'); await click('.cle-heading button', '保存');
    await until('changed new template saved', 'document.querySelector(".cle-heading [role=status]")?.textContent.includes("已保存")');
    const snapshot = await data.snapshot(), target = snapshot.lastInstance, scope = { projectId: 'usability-copy', sourceArtifactId: target.creative.sourceArtifactId, documentId: target.creative.documentId };
    const saved = await data.commerce.templateSource(scope); assert(saved.layers.some(layer => layer.type === 'text' && layer.text === '新商品售价 88 元')); assert(saved.layers.every(layer => !data.document.layers.some(before => before.id === layer.id)));
    await click('.cle-heading button', '导出成品'); await until('new template final result saved', 'document.querySelector(".cle-outputs")!==null||document.querySelector(".cle-heading [role=status]")?.textContent.includes("已保存")');
    const end = Date.now() + 12000; let copiedOutput; do { copiedOutput = data.exports.find(result => result.artifacts.some(file => file.projectId === 'usability-copy')); if (!copiedOutput) await delay(40); } while (!copiedOutput && Date.now() < end); assert(copiedOutput);
    const png = copiedOutput.artifacts.find(file => file.mimeType === 'image/png'), reopened = await data.commerce.read({ projectId: 'usability-copy', sourceArtifactId: png.id }); assert(reopened.document.layers.some(layer => layer.type === 'text' && layer.text === '新商品售价 88 元'));
    report.template = { templateId: template.id, projectCreationSeam: true, osPickerTested: false, instantiatedProjectId: 'usability-copy', editedDocumentId: saved.id, finalArtifactId: png.id, reopenedEditable: true, clearedCustomerText: true, independentLayerIds: true }; report.contracts.templateUiReopened = true;
  });
  assert.equal(await evaluate('JSON.stringify(window.productionUsabilityFixture.snapshot().ledger)'), priorLedger); report.contracts.feesUnchanged = true;
  const snapshot = await data.snapshot(); assert(snapshot.sourceUnchanged && snapshot.originalDocumentsUnchanged); report.contracts.originalsUnchanged = true;
  assert(snapshot.workers.length > 0 && snapshot.workers.every(worker => worker.dependencyBootstrapVerified));
}
async function finish(error) {
  if (finished) return; finished = true; clearTimeout(deadline); if (error) report.errors.push(String(error.stack || error));
  if (window && !window.isDestroyed()) { try { report.rendererDiagnostic = await window.webContents.executeJavaScript('({state:window.productionUsabilityFixture?.snapshot(),alerts:[...document.querySelectorAll("[role=alert]")].map(node=>node.textContent).slice(0,5)})'); } catch {} }
  if (data) { try { report.nativeData = await data.snapshot(); } catch (cause) { report.errors.push(String(cause.stack || cause)); } }
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)])];
  if (data) { let timer; try { await Promise.race([data.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned usability service teardown exceeded 5 seconds')), 5000); })]); } catch (cause) { report.errors.push(String(cause.stack || cause)); } finally { clearTimeout(timer); } }
  for (const current of BrowserWindow.getAllWindows()) current.destroy(); report.windows.remaining = BrowserWindow.getAllWindows().length;
  if (report.windows.shown || report.windows.remaining || report.rendererProcessIds.length !== 1) report.errors.push('Expected one hidden interaction renderer, hidden native font helpers and no remaining windows');
  if (report.screenshots.length !== 4 || report.layouts.length !== 4) report.errors.push('Expected four actual Chromium screenshots and layouts');
  if (report.blockedRequests.length) report.errors.push('Fixture attempted requests outside its verified local bundle');
  if (report.nativeData?.workers.some(worker => !worker.exited)) report.errors.push('Owned CPU worker remains');
  report.elapsedMs = Math.round(performance.now() - began); report.passed = !report.errors.length;
  if (owner && directory) fs.writeFileSync(path.join(directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: report.passed, phase: report.phase, errors: report.errors }) + '\n'); app.exit(report.passed ? 0 : 1);
}
const deadline = setTimeout(() => { void finish(Error('PRODUCTION_USABILITY_110_SECOND_DEADLINE')); }, 110000);
app.on('window-all-closed', () => {}); process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); });
async function run() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { let permit = details.url.startsWith('data:image/'); try { if (details.url.startsWith('file:')) { const file = fileURLToPath(details.url), relative = path.relative(owner.dist, file).replaceAll('\\', '/'); permit = Object.hasOwn(owner.files, relative) && same(path.join(owner.dist, relative), file); } } catch {} if (!permit) report.blockedRequests.push(details.url.split('?')[0]); callback({ cancel: !permit }); });
  window = new BrowserWindow({ show: false, frame: false, skipTaskbar: true, width: 1440, height: 940, useContentSize: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', details => { const message = String(details.message || ''); report.rendererConsole.push(message); if (report.rendererConsole.length > 25) report.rendererConsole.shift(); if (details.level === 'error' || details.level === 3) report.errors.push('Renderer: ' + message); });
  const fixtureUrl = pathToFileURL(path.join(owner.dist, 'production-usability.html')).href;
  const handle = (name, operation) => ipcMain.handle('runtime:' + name, (event, input) => { assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame); assert.equal(event.senderFrame.url, fixtureUrl); return operation(input); });
  data = await require('./fixtures/production-usability-data.cjs').createProductionUsabilityData({ directory, nativeImage, BrowserWindow, metrics: () => app.getAppMetrics(), ownerFile: path.join(directory, 'owner.json'), ownerNonce: owner.nonce, loadModule: dataDependencies });
  handle('status', () => data.context); handle('preview-artifact', id => data.preview(id)); handle('thumbnail-artifact', id => data.preview(id)); handle('list-project-artifacts', id => data.artifactStore.listProject(id));
  handle('workspace-ensure-project', input => data.createProject(input));
  handle('performance-read', () => { data.calls.performanceReads++; return data.performanceControl.read(); }); handle('performance-save', input => { data.calls.performanceSaves++; return data.performanceControl.save(input); });
  ipcMain.on('runtime:performance-activity', event => { if (!finished && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === fixtureUrl) data.cpuTasks.noteInteraction(); });
  for (const method of ['read', 'save', 'render', 'history', 'preview', 'cancelPreview', 'cancel', 'reflowPreview', 'reflowJobs', 'reflowExport']) handle('commerce-' + method, async input => { if (method === 'reflowPreview') data.calls.reflowPreviews++; if (method === 'reflowExport') data.calls.reflowExports++; const value = await data.commerce[method](input); if (method === 'reflowExport') data.setReflow(value); return value; });
  for (const method of ['list', 'sources', 'save', 'instantiate', 'remove']) handle('project-templates-' + method, async input => { const value = await data.templates[method](input); if (method === 'save') { data.calls.templateSaves++; data.setTemplate(value); } if (method === 'instantiate') { data.calls.templateInstantiations++; data.setInstance(value); } return value; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('render-process-gone', (_event, details) => { if (!finished) void finish(Error('Renderer ended: ' + details.reason)); });
  await window.loadFile(path.join(owner.dist, 'production-usability.html')); report.rendererProcessIds.push(window.webContents.getOSProcessId());
  await until('actual production fixture ready', 'window.productionUsabilityFixture?.kind==="isolated-production-usability"&&document.querySelector(".performance-settings")!==null'); await scenario();
  assert(!Object.keys(require.cache).some(file => same(file, path.join(root, 'electron/main.cjs')))); await finish();
}
try { prepare(); void run().catch(error => { void finish(error); }); } catch (error) { void finish(error); }
