const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, session, ipcMain, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..'), began = performance.now(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const report = { passed: false, phase: 'prepare', commit: process.env.GITHUB_SHA, scope: 'Actual production ImageStudio and Settings DOM with real managed PNG/Commerce and real isolated localStorage. Workflow metadata and 4K adaptation/save dialog are explicit counted UI stand-ins; this does not validate 4K encoding or any provider.', providerCalls: 0, normalApplicationStarted: false, userProfileAccessed: false, windows: { created: 0, shown: 0, destroyed: 0, remaining: 0 }, processIds: [process.pid], rendererProcessIds: [], screenshots: [], layouts: [], steps: [], errors: [], rendererConsole: [], blockedRequests: [] };
let owner, directory, window, data, finished = false;
app.on('browser-window-created', (_event, created) => { report.windows.created++; created.on('show', () => report.windows.shown++); created.on('closed', () => report.windows.destroyed++); });
function ordinary(file, isDirectory = false) { const info = fs.lstatSync(file); assert(!info.isSymbolicLink()); assert(isDirectory ? info.isDirectory() : info.isFile()); assert(same(fs.realpathSync(file), file)); return info; }
function prepare() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
  assert(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE); assert(same(root, fs.realpathSync(process.env.GITHUB_WORKSPACE)));
  assert(path.isAbsolute(process.argv[2])); directory = path.resolve(process.argv[2]); ordinary(directory, true);
  assert(same(path.dirname(directory), fs.realpathSync(process.env.RUNNER_TEMP))); assert.match(path.basename(directory), /^xuzuo-image-settings-browser-[a-z0-9-]+$/i);
  const ownerFile = path.join(directory, 'owner.json'); assert(ordinary(ownerFile).size < 100000); owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  assert.equal(owner.kind, 'xuzuo-image-settings-browser'); assert.equal(owner.commit, process.env.GITHUB_SHA); assert.match(owner.nonce, /^[a-f0-9-]{36}$/i);
  assert(same(owner.dist, path.join(root, 'work/image-settings-browser-dist')) && same(owner.output, path.join(root, 'work/image-settings-browser-output')));
  ordinary(owner.dist, true); ordinary(owner.output, true); assert(Object.keys(owner.files).length > 1 && Object.keys(owner.files).length <= 512);
  for (const [name, digest] of Object.entries(owner.files)) { assert(/^[a-z0-9_./-]+$/i.test(name) && !name.split('/').includes('..')); assert.match(digest, /^[a-f0-9]{64}$/); const file = path.join(owner.dist, name); assert(ordinary(file).size < 16 * 1024 * 1024); assert.equal(hash(fs.readFileSync(file)), digest); }
  for (const [name, digest] of Object.entries(owner.sources)) { assert(/^(?:src|scripts|electron)\//.test(name) && !name.split('/').includes('..')); const file = path.join(root, name); ordinary(file); assert.equal(hash(fs.readFileSync(file)), digest, 'Source changed after bundle: ' + name); }
  assert.equal(typeof owner.localRuntime, 'boolean');
  const dependencyRoot = path.join(root, ...(owner.localRuntime ? ['work', 'ui-build'] : []), 'node_modules'); assert(same(owner.dependencyRoot, dependencyRoot)); ordinary(dependencyRoot, true);
  const Module = require('node:module'); process.env.NODE_PATH = dependencyRoot; Module._initPaths();
  const dependencyRequire = Module.createRequire(path.join(path.dirname(dependencyRoot), 'package.json'));
  const dependencies = Object.fromEntries(['image-size', 'pngjs'].map(name => [name, dependencyRequire.resolve(name)]));
  for (const filename of Object.values(dependencies)) assert(filename.toLowerCase().startsWith(dependencyRoot.toLowerCase() + path.sep));
  const resolve = Module._resolveFilename; Module._resolveFilename = function (name, parent, ...rest) { return Object.hasOwn(dependencies, name) ? dependencies[name] : resolve.call(this, name, parent, ...rest); };
  report.dependencyMode = owner.localRuntime ? 'owned-local-build-runtime' : 'locked-ci-root';
  const profile = path.join(directory, 'profile'); ordinary(profile, true); app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration(); report.nonce = owner.nonce;
  assert(!fs.existsSync(path.join(directory, 'native-report.json')));
}
async function evaluate(source) {
  let timer;
  try { return await Promise.race([window.webContents.executeJavaScript(source, true), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('IMAGE_SETTINGS_DOM_TIMEOUT')), 4000); })]); }
  catch (error) { report.failedEvaluation = { source: source.slice(0, 3000), console: report.rendererConsole.slice(-5) }; throw Error(`${error.message}\nEvaluation: ${source.slice(0, 1500)}\nRenderer: ${report.rendererConsole.slice(-3).map(row => row.message).join('\n')}`); }
  finally { clearTimeout(timer); }
}
const query = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function until(label, source, timeout = 7000) { const end = performance.now() + timeout; do { if (await evaluate(source)) return; await delay(40); } while (performance.now() < end && !finished); throw Error('DOM condition not reached: ' + label); }
function domAction(input) {
  const readable = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  const text = value => (value || '').replace(/\s+/g, ' ').trim();
  const element = [...document.querySelectorAll(input.selector)].find(node => readable(node) && (!input.text || text(node.textContent) === input.text || text(node.querySelector('b')?.textContent) === input.text || text(node.querySelector('strong')?.textContent) === input.text));
  if (input.type === 'exists') return !!element && !element.matches(':disabled');
  if (!element || element.matches(':disabled')) throw Error('Missing active control: ' + input.selector + ' / ' + (input.text || ''));
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  if (input.type === 'click') element.click();
  if (input.type === 'fill') { element.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, input.value); element.dispatchEvent(new Event('input', { bubbles: true })); }
  return true;
}
const action = value => evaluate(`(${domAction.toString()})(${JSON.stringify(value)})`);
async function click(selector, text) { await until('click ' + (text || selector), `(${domAction.toString()})(${JSON.stringify({ type: 'exists', selector, text })})`); await action({ type: 'scroll', selector, text }); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await action({ type: 'click', selector, text }); }
async function fill(label, value) { await action({ type: 'fill', selector: `[aria-label=${JSON.stringify(label)}]`, value }); }
async function step(name, operation) { const start = performance.now(); report.phase = name; await operation(); report.steps.push({ name, durationMs: Math.round(performance.now() - start) }); }
async function viewport(width, mode) { window.setContentSize(width, 1000); await click('.isf-header button', mode === 'dark' ? '黑夜' : '白天'); await until('appearance resolved', `document.documentElement.dataset.appTheme===${JSON.stringify(mode)}`); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); }
async function layout(name, selector) {
  const value = await evaluate(`(()=>{const host=document.querySelector(${JSON.stringify(selector)});if(!host)throw Error('Missing layout surface');const box=host.getBoundingClientRect(), elements=[...host.querySelectorAll('button:not(.cle-resize-handle),h3,p')], controls=elements.filter(node=>node.tagName==='BUTTON').map(node=>({label:node.textContent.trim(),width:node.getBoundingClientRect().width,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}));return {name:${JSON.stringify(name)},width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,host:{left:box.left,right:box.right,width:box.width},controls,background:getComputedStyle(host).backgroundColor,foreground:getComputedStyle(host).color,overflow:elements.some(node=>{const r=node.getBoundingClientRect();return r.width>0&&(r.left<box.left-2||r.right>box.right+2)})}})()`);
  value.passed = value.documentWidth <= value.width + 2 && value.bodyWidth <= value.width + 2 && !value.overflow && value.foreground !== value.background && value.controls.every(button => button.width > 20);
  report.layouts.push(value); assert(value.passed, 'Image/settings layout overflow or unreadable paint: ' + JSON.stringify(value));
}
async function canvasShell() {
  return evaluate(`(()=>{
    const selectors=['.cle-heading','.cle-layers','.cle-properties','.cle-view-toolbar','[aria-label="图片编辑视口"]'];
    return selectors.map(selector=>{
      const node=document.querySelector(selector);if(!node)throw Error('Missing fixed editor surface: '+selector);
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      const controls=[...node.querySelectorAll(selector==='.cle-heading'?'h2':selector==='.cle-view-toolbar'?'button':'label,h3')].map(control=>{const rect=control.getBoundingClientRect(),paint=getComputedStyle(control);return {text:control.textContent.trim(),x:rect.x,y:rect.y,width:rect.width,height:rect.height,fontSize:paint.fontSize,fontFamily:paint.fontFamily}});
      return {selector,x:box.x,y:box.y,width:box.width,height:box.height,fontSize:style.fontSize,fontFamily:style.fontFamily,controls};
    });
  })()`);
}
function nativeKey(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
async function beginPointerDiagnostic() {
  await evaluate(`(()=>{
    window.imageSettingsPointerEvents=[];
    if(window.imageSettingsPointerListening)return;window.imageSettingsPointerListening=true;
    for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,event=>{
      if(window.imageSettingsPointerEvents.length>=40)return;
      window.imageSettingsPointerEvents.push({type:event.type,isTrusted:event.isTrusted,buttons:event.buttons,button:event.button,pointerType:event.pointerType,x:event.clientX,y:event.clientY,target:event.target.getAttribute?.('aria-label')||event.target.getAttribute?.('class')||event.target.tagName});
    },true);
  })()`);
}
async function recordPointerDiagnostic(name) {
  await delay(50);
  const events = await evaluate('window.imageSettingsPointerEvents');
  (report.pointerDiagnostics ||= {})[name] = events;
  assert(events.some(event => event.type === 'pointerdown' && event.isTrusted && event.buttons === 1), name + ' must begin with a trusted held left button');
  assert(events.some(event => event.type === 'pointermove' && event.isTrusted && event.buttons === 1), name + ' must move while the left button is held');
  assert(events.some(event => event.type === 'pointerup' && event.isTrusted && event.buttons === 0), name + ' must release the left button');
}
async function editCanvasText() {
  const point = await evaluate(`(()=>{const text=document.querySelector('.cle-layer.selected .cle-text');if(!text)throw Error('Missing selected canvas text');const r=text.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  for (const clickCount of [1, 2]) { window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount }); window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount }); }
  await until('trusted double click opens canvas text editor', `${query('[aria-label="直接编辑文字"]')}===document.activeElement`);
}
async function capture(name, selector) {
  await evaluate(`(async()=>{const node=document.querySelector(${JSON.stringify(selector)});if(node)node.scrollIntoView({block:'center',behavior:'instant'});await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));})()`);
  window.webContents.invalidate(); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await delay(80);
  const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); assert(!image.isEmpty()); const bytes = image.toPNG(); assert(bytes.length > 5000);
  const filename = `${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`; fs.writeFileSync(path.join(owner.output, filename), bytes, { flag: 'wx' }); report.screenshots.push({ filename, bytes: bytes.length, ...image.getSize(), sha256: hash(bytes) });
}
async function scenario() {
  await step('image-local-tools-compact-light-dark-and-narrow-canvas', async () => {
    await until('two actual local tools', 'document.querySelectorAll(".image-local-tool-card").length===2');
    await viewport(1440, 'light'); await layout('image-tools-1440-light', '.image-local-tools'); await capture('image-tools-light-1440', '.image-local-tools');
    await viewport(1440, 'dark'); await layout('image-tools-1440-dark', '.image-local-tools'); await capture('image-tools-dark-1440', '.image-local-tools');
    await viewport(1080, 'dark'); await layout('image-tools-1080-dark', '.image-local-tools');
    const size = await evaluate('({width:document.querySelector(".image-local-tools").getBoundingClientRect().width,height:document.querySelector(".image-local-tools").getBoundingClientRect().height})'); assert(size.height < 340, 'Local tools must remain a compact group');
    report.imageTools = { lightDark: true, narrowCanvas: true, readableActions: true, compactGroup: true };
  });
  await step('local-four-k-counted-branch-and-real-commerce-dialog-without-provider', async () => {
    const before = await evaluate('window.imageSettingsBrowserFixture.snapshot()');
    await click('.image-local-tools button', '另存4K'); await until('local 4K UI branch counted once', 'window.imageSettingsBrowserFixture.snapshot().calls.savedArtifacts.length===1');
    const after = await evaluate('window.imageSettingsBrowserFixture.snapshot()'); assert.equal(after.calls.fourK - before.calls.fourK, 1); assert.equal(after.calls.savedArtifacts.length - before.calls.savedArtifacts.length, 1); assert.equal(after.calls.provider, 0);
    const reads = data.calls.commerceReads;
    await click('.image-local-tools button', '排版／保护区'); await until('actual Commerce editor loaded from managed original', `${query('[aria-label="图片排版与精确保护"] .commerce-layer-editor .cle-stage')}!==null`);
    assert.equal(data.calls.commerceReads - reads, 1); await click('[aria-label="关闭图片排版"]'); await until('dialog closes without a model or dirty draft', `!${query('[aria-label="图片排版与精确保护"]')}`);
    report.imageTools.fourKClickOnce = true; report.imageTools.fourKUsesCountedStandIn = true; report.imageTools.realCommerceDialog = true; report.imageTools.noProviderCalls = true;
  });
  await step('real-clear-crop-trusted-wheel-and-pan-preserve-document-and-source', async () => {
    await click('.isf-header button', '高清编辑样例'); await until('actual 4K source canvas', `${query('[aria-label="图片编辑视口"] .cle-stage')}!==null`);
    const before = await data.commerce.read({ projectId: data.project.id, sourceArtifactId: data.clearSource.id }), saves = data.calls.commerceSaves;
    const layers = () => evaluate('JSON.stringify([...document.querySelectorAll(".cle-layer")].map(node=>({label:node.getAttribute("aria-label"),left:node.style.left,top:node.style.top,width:node.style.width,height:node.style.height,opacity:node.style.opacity,text:node.querySelector(".cle-text")?.textContent})))');
    const originalLayers = await layers(); await click('.cle-view-toolbar button', '100%');
    await until('one actual CSS pixel per source pixel at 100%', `${query('[aria-label="画布缩放比例"]')}?.textContent==="100%"&&${query('.cle-stage')}?.style.width==="3840px"`);
    await until('real viewport clear crop decoded', `(()=>{const tile=${query('.cle-clear-preview[data-source-size="3840x2160"]')};return tile?.naturalWidth>0&&JSON.parse(tile.dataset.previewCrop).width<1})()`);
    const tile = await evaluate(`(()=>{const image=${query('.cle-clear-preview[data-source-size="3840x2160"]')};return {artifactId:image.dataset.previewArtifact,sha256:image.dataset.previewSha256,crop:JSON.parse(image.dataset.previewCrop),size:image.dataset.previewSize,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}})()`);
    const source = await data.artifactStore.read(data.clearSource.id); assert.equal(tile.artifactId, data.clearSource.id); assert.equal(tile.sha256, hash(source.buffer)); assert(tile.crop.width > 0 && tile.crop.width < 1 && tile.crop.height > 0 && tile.crop.height <= 1); assert.equal(tile.size, `${tile.naturalWidth}x${tile.naturalHeight}`);
    assert(data.clearPreviews.some(item => item.artifactId === tile.artifactId && item.sha256 === tile.sha256 && item.width === tile.naturalWidth && item.height === tile.naturalHeight), 'Displayed tile must match an actual native preview result');
    const point = async () => evaluate(`(()=>{const v=${query('[aria-label="图片编辑视口"]')};v.scrollIntoView({block:"center"});v.focus({preventScroll:true});const r=v.getBoundingClientRect(),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(70,r.top),bottom=Math.min(innerHeight-20,r.bottom),x=Math.round((left+right)/2),y=Math.round((top+bottom)/2),hit=document.elementFromPoint(x,y);return {x,y,scrollLeft:v.scrollLeft,scrollTop:v.scrollTop,width:right-left,height:bottom-top,hit:{tag:hit?.tagName,classes:hit?.getAttribute('class'),insideViewport:v.contains(hit)}}})()`);
    await point(); window.webContents.invalidate(); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const wheelPoint = await point(); assert(wheelPoint.width > 80 && wheelPoint.height > 80 && wheelPoint.hit.insideViewport); window.webContents.focus();
    await evaluate(`(()=>{const v=${query('[aria-label="图片编辑视口"]')};window.imageSettingsWheelEvents=[];v.addEventListener('wheel',event=>{setTimeout(()=>window.imageSettingsWheelEvents.push({isTrusted:event.isTrusted,deltaY:event.deltaY,ctrlKey:event.ctrlKey,defaultPrevented:event.defaultPrevented,targetInViewport:v.contains(event.target)}),0)},{capture:true,passive:true})})()`);
    const fixedShell = await canvasShell();
    report.wheelDiagnostic = { point: wheelPoint, nativeDeltaY: 100, beforePercent: await evaluate(`${query('[aria-label="画布缩放比例"]')}.textContent`), beforePageZoomFactor: window.webContents.getZoomFactor() };
    window.webContents.sendInputEvent({ type: 'mouseMove', x: wheelPoint.x, y: wheelPoint.y }); window.webContents.sendInputEvent({ type: 'mouseWheel', x: wheelPoint.x, y: wheelPoint.y, deltaX: 0, deltaY: 100, canScroll: true });
    await until('ordinary trusted wheel delivered to viewport', 'window.imageSettingsWheelEvents?.length>0');
    const ordinaryWheel = (await evaluate('window.imageSettingsWheelEvents')).at(-1);
    assert(ordinaryWheel.isTrusted && !ordinaryWheel.ctrlKey && ordinaryWheel.defaultPrevented && ordinaryWheel.targetInViewport && ordinaryWheel.deltaY < 0, 'Ordinary wheel must zoom only the image viewport');
    await until('ordinary wheel enlarges the canvas', `parseInt(${query('[aria-label="画布缩放比例"]')}.textContent)>100`);
    const ordinaryPercent = await evaluate(`parseInt(${query('[aria-label="画布缩放比例"]')}.textContent)`);
    window.webContents.sendInputEvent({ type: 'mouseWheel', x: wheelPoint.x, y: wheelPoint.y, deltaX: 0, deltaY: 100, modifiers: ['control'], canScroll: true });
    await until('trusted Ctrl+wheel delivered to viewport', 'window.imageSettingsWheelEvents?.some(event=>event.ctrlKey)');
    report.wheelDiagnostic.events = await evaluate('window.imageSettingsWheelEvents'); report.wheelDiagnostic.afterPercent = await evaluate(`${query('[aria-label="画布缩放比例"]')}.textContent`); report.wheelDiagnostic.afterPageZoomFactor = window.webContents.getZoomFactor();
    const wheelEvent = report.wheelDiagnostic.events.at(-1); assert(wheelEvent.isTrusted && wheelEvent.ctrlKey && wheelEvent.defaultPrevented && wheelEvent.targetInViewport && wheelEvent.deltaY < 0, 'Trusted wheel must reach and be handled by the canvas: ' + JSON.stringify(report.wheelDiagnostic));
    await until('trusted Ctrl+wheel zooms in the canvas', `parseInt(${query('[aria-label="画布缩放比例"]')}.textContent)>${ordinaryPercent}`); assert.equal(window.webContents.getZoomFactor(), 1, 'Canvas zoom must not magnify the entire application');
    const enlargedPercent = await evaluate(`parseInt(${query('[aria-label="画布缩放比例"]')}.textContent)`);
    window.webContents.sendInputEvent({ type: 'mouseWheel', x: wheelPoint.x, y: wheelPoint.y, deltaX: 0, deltaY: -100, canScroll: true });
    await until('ordinary wheel shrinks the canvas', `parseInt(${query('[aria-label="画布缩放比例"]')}.textContent)<${enlargedPercent}`);
    assert.deepEqual(await canvasShell(), fixedShell, 'Zoom must leave viewport bounds, header, side panels and toolbar fonts/control bounds fixed');
    const outsidePercent = await evaluate(`${query('[aria-label="画布缩放比例"]')}.textContent`);
    const outside = await evaluate(`(()=>{const panel=${query('.cle-properties')};window.imageSettingsOutsideWheels=[];panel.addEventListener('wheel',event=>setTimeout(()=>window.imageSettingsOutsideWheels.push({isTrusted:event.isTrusted,defaultPrevented:event.defaultPrevented}),0),{capture:true,passive:true});const rect=panel.getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+40)}})()`);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: outside.x, y: outside.y }); window.webContents.sendInputEvent({ type: 'mouseWheel', x: outside.x, y: outside.y, deltaX: 0, deltaY: 40, canScroll: true });
    await until('trusted outside wheel remains outside canvas controls', 'window.imageSettingsOutsideWheels?.length>0');
    const outsideWheel = (await evaluate('window.imageSettingsOutsideWheels')).at(-1); assert(outsideWheel.isTrusted && !outsideWheel.defaultPrevented); assert.equal(await evaluate(`${query('[aria-label="画布缩放比例"]')}.textContent`), outsidePercent); assert.equal(window.webContents.getZoomFactor(), 1);
    assert.equal(await evaluate(`${query('[aria-label="拖动画布"]')}.getAttribute('aria-pressed')`), 'true', 'The initial canvas interaction must pan the view rather than move a layer');
    const panPoint = await point(); await beginPointerDiagnostic();
    window.webContents.sendInputEvent({ type: 'mouseMove', x: panPoint.x, y: panPoint.y }); window.webContents.sendInputEvent({ type: 'mouseDown', x: panPoint.x, y: panPoint.y, button: 'left', clickCount: 1, modifiers: ['leftbuttondown'] }); await delay(30);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: panPoint.x - 100, y: panPoint.y - 50, button: 'left', modifiers: ['leftbuttondown'] }); await delay(50); window.webContents.sendInputEvent({ type: 'mouseUp', x: panPoint.x - 100, y: panPoint.y - 50, button: 'left', clickCount: 1 });
    await recordPointerDiagnostic('default-view-pan');
    await until('trusted pan moves the view, not a layer', `document.querySelector('[aria-label="图片编辑视口"]').scrollLeft>${panPoint.scrollLeft + 30}`);
    const after = await data.commerce.read({ projectId: data.project.id, sourceArtifactId: data.clearSource.id }); assert.deepEqual(after.document, before.document); assert.equal(await layers(), originalLayers); assert.equal(data.calls.commerceSaves, saves); assert.equal(window.webContents.getZoomFactor(), 1);
    await layout('clear-canvas-1080-dark', '.commerce-layer-editor'); await capture('clear-preview-zoom-dark-1080', '[aria-label="图片编辑视口"]');
    report.clearZoom = { actualManaged4KSource: true, actualViewportCrop: true, tileMatchesNativeResponse: true, sourceSha256: tile.sha256, crop: tile.crop, tileWidth: tile.naturalWidth, tileHeight: tile.naturalHeight, trustedPlainWheel: true, trustedCtrlWheel: true, zoomInAndOut: true, fixedEditorShell: true, fixedShell, outsideWheelUntouched: true, defaultPan: true, pageZoomFactor: window.webContents.getZoomFactor(), trustedPan: true, layerPositionsUnchanged: true, documentUnchanged: true, noSaveForViewChanges: true, providerCalls: 0 };
    await verifyDirectCanvasEditing();
  });
  await step('settings-clean-state-and-immediate-appearance-stay-separate', async () => {
    await viewport(1440, 'light'); await click('.isf-header button', '设置'); await until('actual Settings clean state', 'document.querySelector(".op-settings-saved-note")!==null&&!document.querySelector(".op-settings-save-bar")');
    await layout('settings-clean-1440-light', '.op-settings-content'); await capture('settings-clean-light-1440', '.op-settings-saved-note');
    const before = await evaluate('window.imageSettingsBrowserFixture.snapshot()'); await click('.isf-header button', '黑夜');
    const after = await evaluate('window.imageSettingsBrowserFixture.snapshot()'); assert.notEqual(before.appearance, after.appearance); assert.equal(after.stored, before.stored); assert.equal(after.dirtyPreferences.length, 0); assert.equal(after.calls.preferenceAttempts, 0);
    report.settings = { cleanLightweight: true, globalAppearanceSeparate: true };
  });
  await step('dirty-preferences-cross-section-write-fault-preserves-input-and-guard', async () => {
    await viewport(1440, 'light'); await fill('工作区名称', '新的验收工作区'); await click('.op-settings-nav button', '成本与报价'); await fill('每小时人工成本', '123'); await click('.op-settings-nav button', '常规设置');
    await until('two clear pending changes', 'document.querySelector(".op-settings-save-heading")?.textContent.includes("2 项修改待保存")');
    await layout('settings-dirty-1440-light', '.op-settings-save-bar'); await capture('settings-dirty-light-1440', '.op-settings-save-bar');
    const before = await evaluate('window.imageSettingsBrowserFixture.snapshot()'); await evaluate('window.imageSettingsBrowserFixture.failNextSave()'); await click('.op-settings-save-actions button', '保存设置');
    await until('write failure remains visible', 'document.querySelector(".op-settings-save-error[role=alert]")!==null'); const failed = await evaluate('window.imageSettingsBrowserFixture.snapshot()');
    assert.equal(failed.stored, before.stored); assert.equal(failed.calls.preferencesSaved, 0); assert.equal(failed.calls.preferenceFailures, 1); assert.equal(failed.dirtyPreferences.length, 1); assert(failed.dirtyPreferences[0].dirty); assert(failed.dirtyPreferences[0].persistenceError);
    assert.equal(await evaluate(`${query('[aria-label="工作区名称"]')}.value`), '新的验收工作区');
    await viewport(1080, 'dark'); await layout('settings-error-1080-dark', '.op-settings-save-bar'); await capture('settings-error-dark-1080', '.op-settings-save-bar');
    report.settings.writeFaultRetainsDraft = report.settings.crossSectionDraft = report.settings.dirtyAndErrorLayouts = true;
  });
  await step('retry-persists-real-localStorage-and-discard-does-not-touch-appearance', async () => {
    await click('.op-settings-save-actions button', '重试保存'); await until('actual saved settings and clean guard', '!document.querySelector(".op-settings-save-bar")&&window.imageSettingsBrowserFixture.snapshot().dirtyPreferences.length===0');
    const saved = await evaluate('window.imageSettingsBrowserFixture.snapshot()'), stored = JSON.parse(saved.stored);
    assert.equal(saved.calls.preferenceAttempts, 2); assert.equal(saved.calls.preferencesSaved, 1); assert.equal(stored.workspaces[0].name, '新的验收工作区'); assert.equal(stored.preferencesByWorkspace[stored.activeWorkspaceId].hourlyRate, 123);
    await fill('工作区名称', '应被放弃的草稿'); await click('.op-settings-save-actions button', '放弃修改'); await until('discard restores last confirmed settings', `${query('[aria-label="工作区名称"]')}.value==="新的验收工作区"`);
    const discarded = await evaluate('window.imageSettingsBrowserFixture.snapshot()'); assert.equal(discarded.stored, saved.stored); assert.equal(discarded.appearance, saved.appearance); assert.equal(discarded.calls.preferenceAttempts, 2); assert.equal(discarded.dirtyPreferences.length, 0); assert.equal(discarded.calls.provider, 0);
    report.settings.retryActuallyStored = report.settings.discardUsesLastSaved = report.settings.noExtraWritesOrProvider = true;
  });
  // Root may add clear-tile/zoom/export acceptance through the existing header route.
  report.rendererSnapshot = await evaluate('window.imageSettingsBrowserFixture.snapshot()');
}
async function verifyDirectCanvasEditing() {
  await click('.cle-view-toolbar button', '适应窗口');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const fitGeometry = await evaluate(`(async()=>{
    let previous='',stable=0;
    for(let frame=0;frame<16;frame++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const stage=${query('.cle-stage')},view=${query('[aria-label="图片编辑视口"]')},rect=stage.getBoundingClientRect();
      const value={styleWidth:stage.style.width,styleHeight:stage.style.height,x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:view.clientWidth,viewportHeight:view.clientHeight,scrollLeft:view.scrollLeft,scrollTop:view.scrollTop,percent:${query('[aria-label="画布缩放比例"]')}.textContent};
      const serialized=JSON.stringify(value);stable=serialized===previous?stable+1:0;previous=serialized;
      if(stable>=3)return value;
    }
    throw Error('Fit canvas geometry did not settle after scrollbar/ResizeObserver updates');
  })()`);
  const original = await evaluate(`(()=>{const layer=${query('.cle-layer.selected')},stage=${query('.cle-stage')},handle=${query('.cle-selection .cle-resize-handle[data-handle="se"]')};if(!handle)throw Error('Selected original needs a resize handle');const r=handle.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);return {x,y,scale:stage.getBoundingClientRect().width/3840,styleScale:parseFloat(stage.style.width)/3840,layerLabel:layer.getAttribute('aria-label'),handleRect:r.toJSON(),hitHandle:hit?.closest('.cle-resize-handle')?.dataset.handle,hitLabel:hit?.getAttribute('aria-label')}})()`);
  report.resizeDiagnostic = { fitGeometry, original };
  assert.equal(original.hitHandle, 'se', 'The measured resize point must hit the visible source SE handle');
  const dx = -48, dy = -27;
  await beginPointerDiagnostic();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: original.x, y: original.y }); window.webContents.sendInputEvent({ type: 'mouseDown', x: original.x, y: original.y, button: 'left', clickCount: 1, modifiers: ['leftbuttondown'] });
  window.webContents.sendInputEvent({ type: 'mouseMove', x: original.x + dx, y: original.y + dy, button: 'left', modifiers: ['leftbuttondown'] }); await delay(50); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); window.webContents.sendInputEvent({ type: 'mouseUp', x: original.x + dx, y: original.y + dy, button: 'left', clickCount: 1 });
  await recordPointerDiagnostic('source-se-resize');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await until('trusted image handle drag changes source-space layer width', `Number(${query('[aria-label="图层宽度"]')}.value)<3840`);
  const resizedWidth = await evaluate(`Number(${query('[aria-label="图层宽度"]')}.value)`);
  Object.assign(report.resizeDiagnostic, { dx, dy, resizedWidth, expectedWidth: 3840 + dx / original.scale, ...await evaluate(`(()=>{const stage=${query('.cle-stage')},view=${query('[aria-label="图片编辑视口"]')};return {currentStageStyle:stage.getAttribute('style'),currentStageRect:stage.getBoundingClientRect().toJSON(),output:${query('[aria-label="画布缩放比例"]')}.textContent,currentWidth:${query('[aria-label="图层宽度"]')}.value,currentHeight:${query('[aria-label="图层高度"]')}.value,viewport:{width:view.clientWidth,height:view.clientHeight,scrollLeft:view.scrollLeft,scrollTop:view.scrollTop}}})()`) });
  assert(Math.abs(resizedWidth - (3840 + dx / original.scale)) < 1, 'Resize delta must be converted from visible pixels to original image coordinates');
  await click('.cle-heading button', '保存'); await until('resized layer actually saved', `${query('.cle-heading [role="status"]')}.textContent.includes('已保存')`);
  const resized = (await data.commerce.read({ projectId: data.project.id, sourceArtifactId: data.clearSource.id })).document;
  const imageLayer = resized.layers.find(layer => layer.type === 'image'); assert(imageLayer && imageLayer.width < 3840); assert.equal(imageLayer.x, 0); assert.equal(imageLayer.y, 0); assert(Math.abs(imageLayer.width / imageLayer.height - 3840 / 2160) < .0001);
  await click('[aria-label="撤销图层修改"]'); await until('resize undo restores original bounds', `${query('[aria-label="图层宽度"]')}.value==='3840'`);
  await click('[aria-label="重做图层修改"]'); await until('resize redo restores edited bounds', `Math.abs(Number(${query('[aria-label="图层宽度"]')}.value)-${resizedWidth})<.01`);
  await click('.cle-add-actions button', '加文字'); await until('new text is selected on the canvas', `${query('.cle-layer.selected .cle-text')}!==null`);
  const initialText = await evaluate(`${query('.cle-layer.selected .cle-text')}.textContent`);
  await click('.cle-heading button', '保存'); await until('new text base saved', `${query('.cle-heading [role="status"]')}.textContent.includes('已保存')`);
  const saves = data.calls.commerceSaves;
  await editCanvasText(); nativeKey('A', ['control']); await window.webContents.insertText('应取消的画布文字'); nativeKey('Escape');
  await until('Escape closes the inline draft without changing text', `!${query('[aria-label="直接编辑文字"]')}&&${query('.cle-layer.selected .cle-text')}.textContent===${JSON.stringify(initialText)}`);
  assert.equal(data.calls.commerceSaves, saves, 'Cancelled inline text must not change or save the document');
  const finalText = '原图不变 · 画布直接改字';
  await editCanvasText(); nativeKey('A', ['control']); await window.webContents.insertText(finalText); nativeKey('Enter', ['control']);
  await until('Ctrl+Enter commits the native inline text input', `!${query('[aria-label="直接编辑文字"]')}&&${query('.cle-layer.selected .cle-text')}.textContent===${JSON.stringify(finalText)}`);
  await click('[aria-label="撤销图层修改"]'); await until('inline text undo preserves other layer edits', `${query('.cle-layer.selected .cle-text')}.textContent===${JSON.stringify(initialText)}`);
  await click('[aria-label="重做图层修改"]'); await until('inline text redo restores the committed text', `${query('.cle-layer.selected .cle-text')}.textContent===${JSON.stringify(finalText)}`);
  await click('.cle-heading button', '保存'); await until('inline text actually saved', `${query('.cle-heading [role="status"]')}.textContent.includes('已保存')`);
  const saved = (await data.commerce.read({ projectId: data.project.id, sourceArtifactId: data.clearSource.id })).document;
  assert.equal(saved.layers.find(layer => layer.type === 'text').text, finalText); assert.deepEqual(saved.layers.find(layer => layer.type === 'image'), imageLayer);
  assert.equal(window.webContents.getZoomFactor(), 1); assert.equal((await data.snapshot()).providerCalls, 0); assert.equal((await data.snapshot()).sourceUnchanged, true);
  report.directCanvasEditing = { trustedResizeHandle: true, originalCoordinateDelta: true, imageRatioPreserved: true, resizeUndoRedo: true, trustedTextDoubleClick: true, actualNativeTextInput: true, escapeCancelsWithoutSave: true, ctrlEnterCommits: true, textUndoRedo: true, otherLayerEditsPreserved: true, actualDocumentSaved: true, sourceUnchanged: true, providerCalls: 0 };
}
async function finish(error) {
  if (finished) return; finished = true; clearTimeout(deadline); if (error) report.errors.push(String(error.stack || error));
  if (window && !window.isDestroyed()) { try { report.rendererDiagnostic = await window.webContents.executeJavaScript('({view:window.imageSettingsBrowserFixture?.snapshot().view,alerts:[...document.querySelectorAll("[role=alert]")].map(node=>node.textContent).slice(0,5)})'); } catch {} }
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)])];
  for (const current of BrowserWindow.getAllWindows()) current.destroy(); report.windows.remaining = BrowserWindow.getAllWindows().length;
  if (data) { let timeout; try { await Promise.race([data.close(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Isolated UI service teardown exceeded 5 seconds')), 5000); })]); } catch (cause) { report.errors.push(String(cause.stack || cause)); } finally { clearTimeout(timeout); } }
  if (data) { try { report.nativeData = await data.snapshot(); assert(report.nativeData.sourceUnchanged); assert.equal(report.nativeData.providerCalls, 0); } catch (cause) { report.errors.push(String(cause.stack || cause)); } }
  if (report.windows.created !== 1 || report.windows.shown || report.windows.remaining || report.rendererProcessIds.length !== 1) report.errors.push('Expected one hidden renderer and no residual windows');
  if (report.screenshots.length !== 6) report.errors.push('Expected six actual Chromium screenshots');
  if (report.blockedRequests.length) report.errors.push('The fixture attempted requests outside its verified local bundle');
  report.elapsedMs = Math.round(performance.now() - began); report.passed = !report.errors.length;
  if (owner && directory) fs.writeFileSync(path.join(directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: report.passed, phase: report.phase, errors: report.errors }) + '\n'); app.exit(report.passed ? 0 : 1);
}
const deadline = setTimeout(() => { void finish(Error('IMAGE_SETTINGS_BROWSER_90_SECOND_DEADLINE')); }, 90000);
app.on('window-all-closed', () => {}); process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); });
async function run() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { let permit = details.url.startsWith('data:image/'); try { if (details.url.startsWith('file:')) { const file = fileURLToPath(details.url), relative = path.relative(owner.dist, file).replaceAll('\\', '/'); permit = Object.hasOwn(owner.files, relative) && same(path.join(owner.dist, relative), file); } } catch {} if (!permit) report.blockedRequests.push(details.url.split('?')[0]); callback({ cancel: !permit }); });
  window = new BrowserWindow({ show: false, frame: false, skipTaskbar: true, width: 1440, height: 1000, useContentSize: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', details => { const message = { level: details.level, message: String(details.message || ''), lineNumber: details.lineNumber, sourceId: details.sourceId }; report.rendererConsole.push(message); if (report.rendererConsole.length > 25) report.rendererConsole.shift(); if (details.level === 'error' || details.level === 3) report.errors.push('Renderer: ' + message.message); });
  const fixtureUrl = pathToFileURL(path.join(owner.dist, 'image-settings-browser-fixture.html')).href;
  const handle = (name, operation) => ipcMain.handle('runtime:' + name, (event, input) => { assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame); assert.equal(event.senderFrame.url, fixtureUrl); return operation(input); });
  data = await require('./fixtures/image-settings-browser-data.cjs').createImageSettingsFixture({ directory, nativeImage, BrowserWindow, ownerFile: path.join(directory, 'owner.json'), ownerNonce: owner.nonce });
  handle('status', () => data.context); handle('preview-artifact', id => data.preview(id)); handle('thumbnail-artifact', id => data.preview(id)); handle('list-project-artifacts', id => { assert.equal(id, data.project.id); return data.artifactStore.listProject(id); });
  for (const method of ['read', 'save', 'render', 'applyAlpha', 'protect', 'mask', 'cancel', 'history', 'restore', 'exportRecovery', 'preview', 'cancelPreview']) handle('commerce-' + method, async input => { if (method === 'read') data.calls.commerceReads++; if (method === 'save') data.calls.commerceSaves++; if (method === 'preview') data.calls.commercePreviews++; const result = await data.commerce[method](input); if (method === 'preview') data.clearPreviews.push({ artifactId: result.artifactId, width: result.width, height: result.height, sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight, sha256: result.sha256, crop: result.crop }); return result; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('render-process-gone', (_event, details) => { if (!finished) void finish(Error('Renderer ended: ' + details.reason)); });
  await window.loadFile(path.join(owner.dist, 'image-settings-browser-fixture.html')); report.rendererProcessIds.push(window.webContents.getOSProcessId());
  await until('actual fixture ready', 'window.imageSettingsBrowserFixture?.kind==="isolated-image-settings-browser"&&document.querySelector(".image-studio-page")!==null'); await scenario();
  assert(!Object.keys(require.cache).some(file => same(file, path.join(root, 'electron/main.cjs'))), 'Normal application main was unexpectedly loaded');
  await finish();
}
try { prepare(); void run().catch(error => { void finish(error); }); } catch (error) { void finish(error); }
