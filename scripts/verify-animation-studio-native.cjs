const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, nativeImage, nativeTheme } = require('electron');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '..'), sha = bytes => createHash('sha256').update(bytes).digest('hex'), began = Date.now();
const report = { passed: false, commit: process.env.GITHUB_SHA, syntheticProvider: true, actualProviderUsed: false, realRuntimeAndRenderer: true, normalApplicationStarted: false, userProfileAccessed: false, externalRequests: 0, actualAccountCharges: 0, syntheticLedger: true, errors: [], steps: [], screenshots: [], layouts: [], shellLayouts: [], previewLayouts: [], processIds: [process.pid], windows: { created: 0, shown: 0, showOpacities: [], remaining: 0 } };
let owner, temporary, window, service, store, engine, artifacts, workspaceStorage, tool, server, context, referencePath, lastProjectZip, nextImportZip = false, finishing = false, holdNext = false, releaseResponse, visibilityRound = false;
const channels = [], children = [], calls = [], exportedFiles = [], projectId = 'animation-ui-project', workspaceId = 'animation-ui-workspace';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { void finish(Error('Animation studio native acceptance exceeded 120 seconds')); }, 120000);
app.on('window-all-closed', () => {});
function ordinary(filename, directory = false) { const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink()); assert(directory ? stat.isDirectory() : stat.isFile()); assert.equal(fs.realpathSync(filename).toLowerCase(), path.resolve(filename).toLowerCase()); return stat; }
function prepare() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(report.commit || '', /^[a-f0-9]{40}$/); assert(path.isAbsolute(process.argv[2] || ''));
  temporary = fs.realpathSync(process.argv[2]); assert.equal(path.dirname(temporary).toLowerCase(), fs.realpathSync(process.env.RUNNER_TEMP).toLowerCase()); assert.match(path.basename(temporary), /^xuzuo-animation-studio-[A-Za-z0-9-]+$/);
  owner = JSON.parse(fs.readFileSync(path.join(temporary, 'owner.json'), 'utf8')); assert.equal(owner.kind, 'xuzuo-animation-studio'); assert.equal(owner.commit, report.commit); assert.match(owner.nonce, /^[a-f0-9-]{36}$/); report.nonce = owner.nonce;
  assert.equal(owner.dist, path.join(root, 'work/animation-studio-dist')); assert.equal(owner.output, path.join(root, 'work/animation-studio-output')); ordinary(owner.output, true); ordinary(owner.dist, true);
  for (const [name, hash] of Object.entries(owner.files)) { assert(!name.split('/').includes('..')); assert.equal(sha(fs.readFileSync(path.join(owner.dist, name))), hash); }
  for (const [name, hash] of Object.entries(owner.sources)) { assert(/^(?:src|electron|scripts)\//.test(name) && !name.split('/').includes('..')); assert.equal(sha(fs.readFileSync(path.join(root, name))), hash); }
  ordinary(owner.tool); assert.equal(sha(fs.readFileSync(owner.tool)), owner.toolSha256); app.setPath('userData', path.join(temporary, 'profile')); app.setPath('sessionData', path.join(temporary, 'profile')); app.disableHardwareAcceleration(); nativeTheme.themeSource = 'light';
}
async function finish(error) {
  if (finishing) return; finishing = true; clearTimeout(deadline); if (error) { report.errors.push(String(error.stack || error)); process.stderr.write(String(error.stack || error) + '\n'); }
  releaseResponse?.();
  try { await service?.shutdown(); await tool?.shutdown(); await engine?.shutdown(); await Promise.all([store?.drain(), artifacts?.drain()]); } catch (cause) { report.errors.push(String(cause)); }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid), ...children.map(child => child.pid)].filter(Number.isInteger))];
  for (const current of BrowserWindow.getAllWindows()) current.destroy(); for (const channel of channels) ipcMain.removeHandler(channel);
  report.windows.remaining = BrowserWindow.getAllWindows().length; if (report.windows.created !== 1 || report.windows.shown !== 1 || JSON.stringify(report.windows.showOpacities) !== '[0]' || report.windows.remaining) report.errors.push('Expected one isolated window with one zero-opacity visibility transition and no residual windows');
  report.syntheticHttpCalls = calls; report.exportedFiles = exportedFiles; report.elapsedMs = Date.now() - began; report.passed = !report.errors.length;
  if (owner) fs.writeFileSync(path.join(temporary, 'native-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); process.stdout.write(JSON.stringify({ passed: report.passed, errors: report.errors, phase: report.phase }) + '\n'); app.exit(report.passed ? 0 : 1);
}
async function evaluate(value) { let timer; try { return await Promise.race([window.webContents.executeJavaScript(value, true), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Animation DOM call timed out')), 4000); })]); } finally { clearTimeout(timer); } }
async function until(check, label, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await delay(30); } throw Error('Animation studio timeout: ' + label); }
async function dom(value, label) { await until(() => evaluate(`Boolean(${value})`), label); }
async function click(selector, text) { const match = `(()=>[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&${text ? `e.textContent.trim().includes(${JSON.stringify(text)})` : 'true'}&&!e.disabled))()`; await dom(match, text || selector); await evaluate(`(()=>{const e=${match};e.scrollIntoView({block:'center'});e.click()})()`); }
async function fill(label, value) { await dom(`document.querySelector('[aria-label=${JSON.stringify(label)}]')`, label); await evaluate(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.scrollIntoView({block:'center'});e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await evaluate(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.blur();e.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:null}))})()`); }
async function select(label, value) { await click(`[aria-label="${label}"]`); await click('[role="option"]', value); }
async function openSection(text) { const match = `(()=>[...document.querySelectorAll('summary')].find(e=>e.textContent.includes(${JSON.stringify(text)})))()`; await dom(match, text); await evaluate(`(()=>{const e=${match};e.scrollIntoView({block:'center'});if(!e.parentElement.open)e.click()})()`); await dom(`${match}?.parentElement.open`, text + ' expanded'); }
async function idle(expected = 'complete') {
  try {
    await delay(50); await dom(`document.querySelector('.animation-save-status')?.textContent==='已保存到项目'`, 'renderer request accepted');
    await until(async () => { const value = await service.read({ projectId }); return !!value.job && value.job.status !== 'running' && !service.isProjectBusy(projectId); }, 'native job settled', 18000);
    const value = await service.read({ projectId }); assert.equal(value.job.status, expected, value.job.error);
    await dom(`document.querySelector('.animation-save-status')?.textContent==='已保存到项目'`, 'renderer idle'); await delay(300);
  } catch (error) {
    const [ui, snapshot] = await Promise.allSettled([
      evaluate(`({saveStatus:document.querySelector('.animation-save-status')?.textContent,alerts:[...document.querySelectorAll('[role="alert"],.animation-notice')].map(node=>node.textContent.trim().slice(0,400)).slice(0,3),caption:document.querySelector('[aria-label="当前条目文案"]')?.value,quantity:document.querySelector('[aria-label="角色作品数量"]')?.value,hidden:document.hidden})`),
      service.read({ projectId })
    ]);
    const value = snapshot.status === 'fulfilled' ? snapshot.value : undefined, diagnostic = { phase: report.phase, expected, ui: ui.status === 'fulfilled' ? ui.value : String(ui.reason), revision: value?.document.revision, job: value?.job && { status: value.job.status, stage: value.job.stage, error: value.job.error } };
    (report.idleFailures ||= []).push(diagnostic);
    throw new Error(error.message + ' | animation idle state: ' + JSON.stringify(diagnostic), { cause: error });
  }
}
async function step(name, action) { report.phase = name; process.stdout.write('Animation studio step: ' + name + '\n'); const started = Date.now(); await action(); report.steps.push({ name, ms: Date.now() - started }); }
async function capture(filename, selector) { if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`); await evaluate(`Promise.all([...document.images].filter(e=>e.getClientRects().length).map(e=>e.decode().catch(()=>{}))).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`); window.webContents.invalidate(); await delay(160); const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), bytes = image.toPNG(); assert(bytes.length > 5000); await fsp.writeFile(path.join(owner.output, filename), bytes, { flag: 'wx' }); report.screenshots.push({ filename, bytes: bytes.length, ...image.getSize(), sha256: sha(bytes) }); }
async function layout(width, mode) {
  const started = Date.now(); window.setContentSize(width, 1000); nativeTheme.themeSource = mode; window.webContents.invalidate();
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); let value;
  const luminance = rgb => rgb.map(number => number / 255).map(number => number <= .04045 ? number / 12.92 : ((number + .055) / 1.055) ** 2.4).reduce((sum, number, index) => sum + number * [.2126,.7152,.0722][index], 0);
  try { await until(async () => {
    value = await evaluate(`(()=>{const e=document.querySelector('.animation-panel'),s=getComputedStyle(e);return {width:innerWidth,theme:document.documentElement.dataset.appTheme,background:s.backgroundColor,foreground:s.color,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,rootInline:document.documentElement.style.cssText,tokens:[document.documentElement,document.body,document.querySelector('.animation-fixture'),e].map(node=>({name:node.tagName,classes:node.className,surface:getComputedStyle(node).getPropertyValue('--ui-surface').trim(),fg:getComputedStyle(node).getPropertyValue('--ui-fg').trim(),scheme:getComputedStyle(node).colorScheme}))}})()`);
    const color = value.background.match(/\d+/g)?.slice(0,3).map(Number), foreground = value.foreground.match(/\d+/g)?.slice(0,3).map(Number);
    value.contrast = color && foreground ? (Math.max(luminance(color), luminance(foreground)) + .05) / (Math.min(luminance(color), luminance(foreground)) + .05) : 0;
    value.passed = value.width === width && value.theme === mode && value.scroll <= width + 1 && value.body <= width + 1 && color && value.contrast >= 4.5 && (mode === 'dark' ? Math.max(...color) < 60 : Math.min(...color) > 180); return value.passed;
  }, 'actual theme paint and layout', 3000); } catch (error) { if (value) report.layouts.push(value); throw Error(error.message + ': ' + JSON.stringify(value)); }
  value.paintMs = Date.now() - started; report.layouts.push(value); assert(value.passed);
}
async function shellLayout(width, height, mode, expanded) {
  window.setContentSize(width, height);
  await evaluate(`(()=>{const button=document.querySelector('.studio-run-status-heading button[aria-controls]');if(button.getAttribute('aria-expanded')!==${JSON.stringify(String(expanded))})button.click()})()`);
  await dom(`document.querySelector('.studio-run-status-heading button[aria-controls]')?.getAttribute('aria-expanded')===${JSON.stringify(String(expanded))}`, 'actual task status expansion');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const value = await evaluate(`(()=>{
    const studio=document.querySelector('.animation-studio'),content=document.querySelector('.content-images'),workspace=content.querySelector('.workspace-panel'),status=document.querySelector('.studio-run-status');
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    studio.scrollTop=0;
    return {width:innerWidth,height:innerHeight,mode:document.querySelector('.animation-mode-tabs [aria-selected=true]')?.textContent.trim(),expanded:!!document.querySelector('.studio-run-status-details'),studio:rect(studio),content:rect(content),workspace:rect(workspace),status:rect(status),sidebar:rect(document.querySelector('.sidebar')),header:rect(document.querySelector('.app-header')),footer:rect(document.querySelector('.statusbar')),overflow:getComputedStyle(studio).overflowY,contentOverflow:getComputedStyle(content).overflowY,clientWidth:studio.clientWidth,scrollWidth:studio.scrollWidth,clientHeight:studio.clientHeight,scrollHeight:studio.scrollHeight,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,backButton:!![...studio.querySelectorAll('.animation-page-heading button')].find(button=>button.textContent.includes('返回图片工作台'))};
  })()`);
  report.shellLayouts.push(value);
  const detail = JSON.stringify(value);
  const sidebarWidth = width <= 1100 ? 174 : width <= 1250 ? 190 : 216, headerHeight = width <= 1250 ? 64 : 70;
  assert.equal(value.width, width, detail); assert.equal(value.height, height, detail);
  assert.equal(value.mode, mode === 'atlas' ? '角色图集' : 'GIF 动画工坊', detail); assert.equal(value.expanded, expanded, detail);
  assert.equal(value.sidebar.width, sidebarWidth, detail); assert.equal(value.header.height, headerHeight, detail); assert.equal(value.footer.height, 24, detail);
  assert(value.backButton && value.contentOverflow === 'hidden', detail);
  assert(Math.abs(value.studio.width - value.content.width) <= 1, 'Animation studio must consume the available workspace width: ' + detail);
  assert(Math.abs(value.studio.left - value.content.left) <= 1 && Math.abs(value.studio.right - value.content.right) <= 1, detail);
  assert(Math.abs(value.studio.top - value.status.bottom) <= 1 && Math.abs(value.studio.bottom - value.content.bottom) <= 1, 'Animation studio must fit below task status and above the footer: ' + detail);
  assert(value.content.top >= value.header.bottom - 1 && value.content.bottom <= value.footer.top + 1 && value.footer.bottom <= height + 1, detail);
  assert(value.studio.height >= value.content.height * .5, detail);
  assert(['auto', 'scroll'].includes(value.overflow) && value.scrollHeight > value.clientHeight + 20, 'Animation studio must own its vertical overflow: ' + detail);
  assert(value.scrollWidth <= value.clientWidth + 1 && value.documentWidth <= width + 1 && value.bodyWidth <= width + 1, 'Workspace must not overflow horizontally: ' + detail);
  value.bottom = await evaluate(`(()=>{
    const studio=document.querySelector('.animation-studio'),content=document.querySelector('.content-images'),workspace=content.querySelector('.workspace-panel');
    studio.scrollTop=studio.scrollHeight;
    const bounds=studio.getBoundingClientRect(),footer=document.querySelector('.statusbar').getBoundingClientRect();
    const buttons=[...document.querySelectorAll('.animation-export>.animation-button-row button')].map(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {label:button.textContent.trim(),top:r.top,bottom:r.bottom,left:r.left,right:r.right,visible:r.width>0&&r.height>0&&r.top>=bounds.top&&r.bottom<=Math.min(bounds.bottom,footer.top)&&r.left>=bounds.left&&r.right<=bounds.right,hit:!!hit&&(button===hit||button.contains(hit))}});
    return {scrollTop:studio.scrollTop,maximum:studio.scrollHeight-studio.clientHeight,documentScrollTop:document.scrollingElement.scrollTop,contentScrollTop:content.scrollTop,workspaceScrollTop:workspace.scrollTop,buttons};
  })()`);
  assert(value.bottom.scrollTop > 0 && Math.abs(value.bottom.scrollTop - value.bottom.maximum) <= 1, JSON.stringify(value));
  assert.equal(value.bottom.documentScrollTop, 0, JSON.stringify(value)); assert.equal(value.bottom.contentScrollTop, 0, JSON.stringify(value)); assert.equal(value.bottom.workspaceScrollTop, 0, JSON.stringify(value));
  assert.deepEqual(value.bottom.buttons.map(button => button.label), ['拆分图片 ZIP', '导出整套 ZIP', '可编辑工程 ZIP', '保存当前样片流程']);
  assert(value.bottom.buttons.every(button => button.visible && button.hit), 'Every actual bottom export control must be reachable through studio scrolling: ' + JSON.stringify(value));
  value.passed = true;
  await evaluate("document.querySelector('.animation-studio').scrollTop=0");
}
async function shellLayoutMatrix() {
  const before = calls.length;
  const count = report.shellLayouts.length;
  let legacyFailure;
  await evaluate(`(()=>{const style=document.createElement('style');style.id='legacy-animation-root-layout';style.textContent='.animation-studio{width:auto!important;flex:0 1 auto!important;min-height:auto!important;overflow:visible!important}';document.head.append(style)})()`);
  try { await shellLayout(1440, 1000, 'atlas', false); }
  catch (error) { legacyFailure = error; report.legacyShellLayout = { rejected: true, error: error.message, layout: report.shellLayouts.at(-1) }; }
  finally { await evaluate("document.getElementById('legacy-animation-root-layout')?.remove()"); report.shellLayouts.splice(count); }
  assert(legacyFailure instanceof assert.AssertionError && legacyFailure.message.startsWith('Animation studio must consume the available workspace width:'), 'The production-shell layout oracle must reject the original shrinking root CSS');
  assert.equal(calls.length, before);
  for (const mode of ['atlas', 'gif']) {
    await click('[role="tab"]', mode === 'atlas' ? '角色图集' : 'GIF 动画工坊');
    for (const [width, height] of [[1440, 1000], [960, 1000], [1440, 720], [960, 720]]) for (const expanded of [false, true]) await shellLayout(width, height, mode, expanded);
  }
  assert.equal(report.shellLayouts.length, 16); assert.equal(calls.length, before);
  await click('[role="tab"]', '角色图集'); await shellLayout(1440, 1000, 'atlas', false);
  report.shellLayoutChecksWithoutHttp = true;
}
async function previewLayout(width, theme, mode, caption, description, playing) {
  window.setContentSize(width, 1000); nativeTheme.themeSource = theme;
  if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天');
  await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(theme)}`, 'preview matrix actual appearance');
  if (mode === 'gif') {
    const label = await evaluate("document.querySelector('.animation-preview-actions button')?.textContent.trim()");
    if ((label === '暂停预览') !== playing) await click('.animation-preview-actions button', playing ? '播放 GIF' : '暂停预览');
  }
  await evaluate("document.querySelector('.animation-preview-heading').scrollIntoView({block:'center'})");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const value = await evaluate(`(()=>{
    const studio=document.querySelector('.animation-studio'),preview=document.querySelector('.animation-preview'),heading=preview.querySelector('.animation-preview-heading'),copy=heading.querySelector('.animation-preview-copy'),actions=heading.querySelector('.animation-preview-actions'),title=copy.querySelector('.animation-preview-title'),caption=copy.querySelector('.animation-preview-caption'),requirements=preview.querySelector('.animation-preview-requirements');
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const buttons=[...actions.querySelectorAll('button')].map(button=>{
      const bounds=rect(button),style=getComputedStyle(button),texts=[],walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
      while(walker.nextNode())if(walker.currentNode.textContent.trim()){const range=document.createRange();range.selectNodeContents(walker.currentNode);texts.push(...[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height})))}
      const lines=[];for(const text of texts){const line=lines.find(item=>Math.min(item.bottom,text.bottom)-Math.max(item.top,text.top)>1);if(line){line.top=Math.min(line.top,text.top);line.bottom=Math.max(line.bottom,text.bottom)}else lines.push({top:text.top,bottom:text.bottom})}
      const textWidth=texts.length?Math.max(...texts.map(r=>r.right))-Math.min(...texts.map(r=>r.left)):0,icons=[...button.querySelectorAll('svg')].map(rect).filter(r=>r.width>0),padding=['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0),gap=parseFloat(style.columnGap)||0,hit=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2);
      return {label:button.textContent.trim(),...bounds,fontSize:parseFloat(style.fontSize),lineCount:lines.length,texts,intrinsicWidth:textWidth+icons.reduce((sum,r)=>sum+r.width,0)+gap*icons.length+padding,disabled:button.disabled,hit:!!hit&&(button===hit||button.contains(hit))};
    });
    const captionStyle=caption&&getComputedStyle(caption);
    return {width:innerWidth,theme:document.documentElement.dataset.appTheme,mode:document.querySelector('.animation-mode-tabs [aria-selected=true]')?.textContent.trim(),studio:rect(studio),preview:rect(preview),heading:rect(heading),copy:rect(copy),actions:rect(actions),title:{...rect(title),text:title.textContent},caption:caption&&{...rect(caption),text:caption.textContent,lineHeight:parseFloat(captionStyle.lineHeight)||parseFloat(captionStyle.fontSize)*1.65},requirements:{independent:!!requirements&&!heading.contains(requirements),open:!!requirements?.open,text:requirements?.querySelector('p')?.textContent},buttons,playing:preview.querySelector('.animation-preview-canvas')?.dataset.playing==='true',clientWidth:studio.clientWidth,scrollWidth:studio.scrollWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth};
  })()`);
  value.captionKind = /[\u3400-\u9fff]/.test(caption) ? 'chinese' : 'unbroken';
  report.previewLayouts.push(value);
  const detail = JSON.stringify(value), inside = (inner, outer) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  assert.equal(value.width, width, detail); assert.equal(value.theme, theme, detail); assert.equal(value.mode, mode === 'gif' ? 'GIF 动画工坊' : '角色图集', detail);
  assert.equal(value.title.text, mode === 'gif' ? '第 1 份 · 动画预览' : '第 1 份 · 角色预览', detail);
  assert(value.caption && value.caption.text === caption && value.caption.height <= value.caption.lineHeight * 2 + 1, 'Long captions must stay bounded independently of actions: ' + detail);
  assert(value.requirements.independent && !value.requirements.open && value.requirements.text === description, 'The full picture description must use its own collapsed disclosure: ' + detail);
  assert(inside(value.heading, value.preview) && inside(value.copy, value.heading) && inside(value.actions, value.heading) && inside(value.title, value.copy) && inside(value.caption, value.copy) && !overlap(value.copy, value.actions), detail);
  assert(value.heading.top >= value.studio.top - 1 && value.heading.bottom <= value.studio.bottom + 1 && value.preview.left >= value.studio.left - 1 && value.preview.right <= value.studio.right + 1, detail);
  assert.deepEqual(value.buttons.map(button => button.label), mode === 'gif' ? [playing ? '暂停预览' : '播放 GIF', '更新预览'] : ['更新预览']);
  assert.equal(value.playing, playing, detail);
  for (const button of value.buttons) {
    assert(!button.disabled && button.hit && button.fontSize >= 13 && button.height >= 36 && button.lineCount === 1 && button.width + 1 >= button.intrinsicWidth && inside(button, value.actions) && button.texts.every(text => inside(text, button)), 'Preview action labels must remain single-line, uncompressed and clickable: ' + detail);
  }
  for (let index = 0; index < value.buttons.length; index++) for (const other of value.buttons.slice(index + 1)) assert(!overlap(value.buttons[index], other), detail);
  assert(value.scrollWidth <= value.clientWidth + 1 && value.documentWidth <= width + 1 && value.bodyWidth <= width + 1, 'Long preview copy must not create horizontal overflow: ' + detail);
  value.passed = true;
}
async function previewLayoutMatrix() {
  const before = calls.length, ledger = structuredClone((await engine.snapshot()).ledger);
  const description = '画面要求：保持同一个原创几何吉祥物的轮廓、色彩和表情，动作由左到右逐步举手，长说明应独立展开查看，不占用播放与更新预览按钮的空间。'.repeat(12);
  const captions = ['这一份原创小角色带着灿烂笑容向大家挥手并展示丰富细节，长中文文案也应留下清晰可点的预览操作。'.repeat(3).slice(0, 96), 'LongUnbrokenAnimationCaptionABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(2).slice(0, 98)];
  await openSection('修改当前作品');
  for (const caption of captions) {
    await fill('当前条目文案', caption); await fill('当前条目画面要求', description);
    for (const mode of ['gif', 'atlas']) {
      await click('[role="tab"]', mode === 'gif' ? 'GIF 动画工坊' : '角色图集');
      await click('.animation-preview-actions button', '更新预览'); await idle();
      for (const theme of ['light', 'dark']) for (const width of [960, 1440]) await previewLayout(width, theme, mode, caption, description, mode === 'gif' && theme === 'dark');
      if (mode === 'gif') await click('.animation-preview-actions button', '暂停预览');
    }
  }
  assert.equal(report.previewLayouts.length, 16); assert.equal(calls.length, before); assert.deepEqual((await engine.snapshot()).ledger, ledger);
  report.previewLayoutChecksWithoutHttp = true;
}
function image(columns = 1, rows = 1, marker = 0, opaque = false) { const size = 256, png = new PNG({ width: columns * size, height: rows * size }); if (opaque) for (let at = 0; at < png.data.length; at += 4) { png.data[at] = 240; png.data[at + 1] = 244; png.data[at + 2] = 247; png.data[at + 3] = 255; } for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) for (let y = 32; y < 220; y++) for (let x = 32; x < 224; x++) { const head = ((x - 128) / 57) ** 2 + ((y - 91) / 50) ** 2 < 1, body = x > 86 && x < 170 && y > 125 && y < 216, arm = ((x - (column % 2 ? 196 : 60)) / 15) ** 2 + ((y - (column % 2 ? 100 : 165)) / 35) ** 2 < 1; if (head || body || arm) { const at = ((row * size + y) * png.width + column * size + x) * 4; png.data[at] = 50 + (marker * 17 + column * 30 + row * 40) % 160; png.data[at + 1] = 130; png.data[at + 2] = 180; png.data[at + 3] = 255; } } return PNG.sync.write(png); }
async function initialize() {
  const directory = path.join(temporary, 'native'); await fsp.mkdir(directory);
  workspaceStorage = require('../electron/workspace-storage.cjs').createWorkspaceStorage({ directory });
  artifacts = require('../electron/artifact-store.cjs').createArtifactStore({ directory: path.join(temporary, 'artifacts'), workspaceStorage }); workspaceStorage.setArtifactMigrator((id, destination, options) => artifacts.migrateProject(id, destination, options));
  const workspace = path.join(temporary, 'workspace'); await fsp.mkdir(workspace); await workspaceStorage.bindRoot({ workspaceId, name: '独立原创图集验收', directory: workspace, projects: [] }); await workspaceStorage.ensureProject({ projectId, workspaceId, name: '原创吉祥物动画' });
  referencePath = path.join(temporary, '原创参考.png'); await fsp.writeFile(referencePath, image()); report.originalReferenceSha256 = sha(await fsp.readFile(referencePath));
  server = http.createServer(async (request, response) => { try { const parts = []; let total = 0; for await (const part of request) { total += part.length; assert(total < 4 * 1024 * 1024); parts.push(part); } assert.equal(request.headers.authorization, 'Bearer qa-synthetic-local-only'); const text = Buffer.concat(parts).toString('utf8'); let prompt; try { prompt = JSON.parse(text).prompt; } catch { prompt = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1]; } assert(typeof prompt === 'string'); const grid = /图集按 (\d+) 列 × (\d+) 行/.exec(prompt), columns = grid ? Number(grid[1]) : 1, rows = grid ? Number(grid[2]) : 1; calls.push({ path: request.url, promptSha256: sha(Buffer.from(prompt)), columns, rows }); assert(calls.length <= 16); if (holdNext) { holdNext = false; await new Promise(resolve => { releaseResponse = resolve; response.once('close', resolve); }); } if (response.destroyed) return; response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'synthetic-animation-' + calls.length }); response.end(JSON.stringify({ data: [{ b64_json: image(columns, rows, calls.length).toString('base64') }], usage: { input_tokens: 10, output_tokens: 10 } })); } catch (error) { response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: error.message } })); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const credential = { id: 'synthetic-key', connectionId: 'synthetic-connection', name: '虚构测试 Key', enabled: true }, connection = { id: 'synthetic-connection', providerId: 'custom', name: 'localhost 合成模型', protocol: 'image', baseUrl, enabled: true }, model = { id: 'synthetic-model', connectionId: connection.id, name: '合成 PNG 模型', modelId: 'qa-static-png', capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '0.02' }, enabled: true };
  const project = { id: projectId, workspaceId, name: '原创吉祥物动画', kind: 'image', costCents: 0, status: 'draft', description: '', version: 0, updatedAt: new Date().toISOString(), accent: 'blue' };
  context = { project, models: [model], connections: [connection], credentials: [credential] };
  const runtime = require('../electron/model-runtime.cjs').createModelRuntime({ directory, artifactStore: artifacts, credentialStore: { withSecret: async (_id, _connection, callback) => callback('qa-synthetic-local-only') }, fetchImpl: (url, options) => { const parsed = new URL(url); if (parsed.origin !== new URL(baseUrl).origin) { report.externalRequests++; throw Error('Only the explicit synthetic localhost endpoint is permitted'); } return fetch(url, options); } });
  engine = require('../electron/live-workflow-engine.cjs').createLiveWorkflowEngine({ directory, artifactStore: artifacts, modelRuntime: runtime, credentials: { list: async () => [credential] }, readAnimationDocument: pid => store.read({ projectId: pid }), localAnimationStatus: () => tool.status(), localAnimationStep: input => service.executeWorkflowStep(input) });
  store = require('../electron/animation-store.cjs').createAnimationStore({ workspaceStorage }); const core = require('../electron/animation-document.runtime.cjs'); const document = core.newAnimationDocument(projectId); await store.save({ projectId, expectedRevision: 0, document: { ...document, mode: 'atlas', style: 'pixel-light', width: 128, height: 128, fps: 10, loopMs: 800, columns: 1, rows: 1 } });
  tool = require('../electron/animation-tool.cjs').createAnimationTool({ executablePath: owner.tool, directory, packaged: true, spawnProcess: (...args) => { const child = spawn(...args); children.push(child); return child; } });
  report.helper = await tool.status(); assert.equal(report.helper.available, true, report.helper.reason);
  service = require('../electron/animation-service.cjs').createAnimationService({ directory, workspaceStorage, artifactStore: artifacts, liveEngine: engine, getContext: async () => structuredClone(context), store, tool, onChanged: value => { if (window && !window.isDestroyed()) window.webContents.send('animation:changed', value); }, onExport: input => engine.recordLocalExport({ ...input, workspaceId, name: input.document.title, kind: 'image' }) });
  const fixtureUrl = pathToFileURL(path.join(owner.dist, 'animation-studio.html')).href;
  const handle = (name, action) => { const channel = 'runtime:' + name; channels.push(channel); ipcMain.handle(channel, (event, input) => { assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame); assert.equal(event.senderFrame.url, fixtureUrl); return action(input); }); };
  for (const method of ['read','save','restore','generate','refine','control','compose','importProject']) handle('animation-' + method, input => { assert.equal(input.projectId, projectId); return service[method](input); });
  handle('animation-export', async input => { const result = await service.export(input); if (input.format === 'project') lastProjectZip = result.artifact.id; return result; });
  handle('status', () => ({ project, configuration: { models: [model], connections: [connection], credentials: [credential], vaultStatus: { available: true } } })); handle('snapshot', () => engine.snapshot()); handle('list-project-artifacts', id => { assert.equal(id, projectId); return artifacts.listProject(id); });
  handle('import-files', async id => { assert.equal(id, projectId); let selected = referencePath; if (nextImportZip) { assert(lastProjectZip); const file = await artifacts.read(lastProjectZip); selected = path.join(temporary, '可编辑动画工程.zip'); await fsp.writeFile(selected, file.buffer); nextImportZip = false; } return artifacts.importPaths([selected], { projectId }); });
  const previewArtifact = async id => { const preview = await artifacts.preview(id); return { mimeType: preview.artifact?.mimeType || preview.mimeType, ...preview }; };
  handle('preview-artifact', previewArtifact); handle('thumbnail-artifact', async id => { const file = await artifacts.read(id); if (file.mimeType === 'image/gif') { const image = nativeImage.createFromBuffer(file.buffer); assert(!image.isEmpty()); return { mimeType: 'image/png', artifact: file, supported: true, dataUrl: image.toDataURL() }; } return previewArtifact(id); });
  handle('save-artifact', async id => { const file = await artifacts.read(id); assert.equal(file.projectId, projectId); const extension = file.mimeType === 'image/gif' ? '.gif' : file.mimeType === 'application/zip' ? '.zip' : '.png', filename = path.join(owner.output, `export-${exportedFiles.length + 1}${extension}`); await fsp.writeFile(filename, file.buffer, { flag: 'wx' }); exportedFiles.push({ id, name: file.name, mimeType: file.mimeType, bytes: file.buffer.length, sha256: sha(file.buffer), filename: path.basename(filename) }); return { saved: true, path: filename }; });
}
async function scenario() {
  await dom(`document.querySelector('[aria-label="动画制图模型"]')`, 'production animation controls');
  await step('atlas-reference-model-key-sample', async () => {
    await shellLayoutMatrix(); await layout(1440, 'light'); await openSection('制图模型与 Key'); await select('动画制图模型', '合成 PNG 模型'); await select('动画制图Key', '虚构测试 Key'); await fill('角色作品数量', '3'); await click('button', '上传参考图');
    await dom(`(()=>{const cards=document.querySelectorAll('.animation-reference-list article');return cards.length===1&&cards[0].getClientRects().length>0&&[...document.querySelectorAll('.animation-references button')].some(button=>button.textContent.trim()==='上传参考图'&&!button.disabled)})()`, 'uploaded reference visible and picker settled');
    await fill('动画创作需求', '原创几何吉祥物，角色一致，先做一份样片。'); await click('.animation-creation button', '制作第一份'); await idle(); const value = await service.read({ projectId }); assert.equal(value.document.entries[0].status, 'ready'); assert.equal(value.document.referenceArtifactIds.length, 1); assert.equal(calls.length, 1); await capture('01-atlas-light-1440.png', '.animation-preview');
  });
  await step('sample-approval-and-two-item-expansion', async () => { await click('button', '认可样片'); await dom(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('按样片扩展')&&!e.disabled)`, 'sample accepted'); await click('button', '按样片扩展'); await idle(); const value = await service.read({ projectId }); assert.equal(value.document.entries.filter(entry => entry.status === 'ready').length, 3); assert.equal(calls.length, 2); });
  await step('existing-atlas-to-local-gif-and-playback', async () => { const before = calls.length; await click('[role="tab"]', 'GIF 动画工坊'); await click('.animation-preview-actions button', '更新预览'); await idle(); assert.equal(calls.length, before); await click('button', '播放 GIF'); await dom(`document.querySelectorAll('img[src^="data:image/gif"]').length===1`, 'only selected GIF playing'); await capture('02-gif-light-1440.png', '.animation-preview'); await click('button', '暂停预览'); await dom(`document.querySelectorAll('img[src^="data:image/gif"]').length===0`, 'static covers after pause'); report.singlePlaybackVerified = true; });
  await step('free-caption-speed-undo-redo', async () => { const before = calls.length, ledger = structuredClone((await engine.snapshot()).ledger); await openSection('修改当前作品'); await fill('当前条目文案', '继续加油'); await click('[aria-label="撤销动画编辑"]'); await click('[aria-label="重做动画编辑"]'); await click('summary', '画布、速度与图集设置'); await fill('播放帧率', '20'); await fill('循环时长（毫秒）', '400'); await click('.animation-preview-actions button', '更新预览'); await idle(); const value = await service.read({ projectId }); assert.equal(value.document.loopMs, 400); assert.equal(value.document.entries[0].inspection.loopMs, 400); assert.equal(calls.length, before); assert.deepEqual((await engine.snapshot()).ledger, ledger); report.localCaptionAndSpeedWithoutHttp = true; });
  await step('keyframe-generation-crop-and-single-frame-ai-repair', async () => { await select('动画视觉风格', '像素完整动作'); await click('.animation-creation button', 'AI 重新制作'); await idle(); await click('button', '认可样片'); await click('button', '按样片扩展'); await idle(); await openSection('修改当前作品'); await openSection('关键帧与裁切'); await click('[aria-label="选择关键帧 2"]'); await dom(`document.querySelector('[aria-label="选中图集第 2 格"]')`, 'actual source-cell highlight'); await fill('原图集左边界', '280'); await fill('原图集上边界', '20'); await fill('原图集右边界', '460'); await fill('原图集下边界', '220'); await click('button', '应用裁切'); await dom(`document.querySelector('[aria-label="选中原图集绝对裁切区域"]')`, 'actual absolute crop highlight'); await click('button', '保存编辑'); await delay(50); await dom(`document.querySelector('.animation-save-status')?.textContent==='已保存到项目'`, 'crop persisted'); const before = await service.read({ projectId }), frames = structuredClone(before.document.entries[0].frames), count = calls.length; assert.deepEqual(frames[1].crop, [280,20,460,220]); await click('summary', 'AI 局部修复'); await fill('动画局部修改要求', '仅修复所选帧举手动作，保留其它姿态。'); await click('button', '只修选中帧'); await idle(); const after = await service.read({ projectId }); assert.equal(calls.length, count + 1); assert.notEqual(after.document.entries[0].frames[1].atlasArtifactId, frames[1].atlasArtifactId); assert.equal(after.document.entries[0].frames[1].crop, undefined); assert.deepEqual(after.document.entries[0].frames.filter((_, index) => index !== 1), frames.filter((_, index) => index !== 1)); report.partialAiRepairOnlyOneRequest = true; await click('button', '切到黑夜'); await layout(960, 'dark'); await capture('03-editor-dark-960.png', '.animation-entry-editor'); });
  await step('saved-version-and-local-history-do-not-refund-ledger', async () => {
    const ledger = structuredClone((await engine.snapshot()).ledger); await click('[aria-label="撤销动画编辑"]'); await click('[aria-label="重做动画编辑"]'); await click('button', '保存编辑'); await delay(50); await dom(`document.querySelector('.animation-save-status')?.textContent==='已保存到项目'`, 'history baseline saved'); await openSection('保存版本与导入');
    const checkpoint = await service.read({ projectId }), history = checkpoint.history.sort((a,b)=>b.revision-a.revision); assert(history.length > 1); const target = history[1];
    const area = path.join(await workspaceStorage.projectDirectory(projectId), '.xuzuo/animation-revisions-v1'), index = JSON.parse(await fsp.readFile(path.join(area, 'index-v1.json'), 'utf8')), reference = index.entries.find(value => value.revision === target.revision); assert(reference);
    const saved = JSON.parse(await fsp.readFile(path.join(area, reference.fileName), 'utf8')); assert.equal(sha(Buffer.from(JSON.stringify(saved.record))), reference.hash);
    await select('动画保存版本', 'v' + target.revision + ' ·'); await click('button', '恢复为新版本'); await until(async () => (await service.read({ projectId })).document.revision > checkpoint.document.revision, 'new restored revision'); await dom(`document.querySelector('.animation-save-status')?.textContent==='已保存到项目'`, 'restore adopted');
    const restored = (await service.read({ projectId })).document, contents = value => { const { revision, updatedAt, ...content } = value; return content; }; assert.deepEqual(contents(restored), contents(saved.record.document)); assert.deepEqual((await engine.snapshot()).ledger, ledger); report.historyKeepsCharges = true;
  });
  await step('real-gif-zip-project-export-and-import', async () => {
    const count = calls.length;
    await click('button', '导出此 GIF'); await idle(); await click('button', '拆分图片 ZIP'); await idle(); await click('button', '导出整套 ZIP'); await idle(); await click('button', '可编辑工程 ZIP'); await idle(); assert(lastProjectZip);
    const ledger = structuredClone((await engine.snapshot()).ledger); nextImportZip = true; await click('[aria-label="导入可编辑动画工程"]'); await idle();
    const imported = await service.read({ projectId }), first = imported.document.entries[0], output = imported.artifacts.find(file => file.id === first.outputArtifactId);
    assert.equal(first.status, 'ready'); assert.equal(output?.mimeType, 'image/gif'); assert.equal(imported.document.entries.length, 3); assert(imported.document.entries.slice(1).every(entry => entry.status === 'stale'));
    await dom(`document.querySelector('.animation-preview-actions button')?.textContent.trim()==='播放 GIF'`, 'imported first entry ready to play without regeneration');
    assert.equal(calls.length, count); assert.deepEqual((await engine.snapshot()).ledger, ledger); report.importAutoPreviewWithoutHttp = true;
    assert(exportedFiles.some(file => file.mimeType === 'image/gif') && exportedFiles.filter(file => file.mimeType === 'application/zip').length >= 3); await click('button', '切到白天'); await layout(960, 'light'); await capture('04-project-import-light-960.png', '.animation-export');
  });
  await step('cancel-real-localhost-model-request', async () => { const count = calls.length, ledger = structuredClone((await engine.snapshot()).ledger); holdNext = true; await click('.animation-creation button', 'AI 重新制作'); await until(() => calls.length === count + 1, 'held synthetic model request'); await click('button', '取消当前任务'); releaseResponse?.(); await idle('cancelled'); assert.equal((await service.read({ projectId })).job.status, 'cancelled'); const after = (await engine.snapshot()).ledger; for (const row of ledger) assert.deepEqual(after.find(item => item.id === row.id), row); report.cancelKeepsPriorCharges = true; });
  await step('workflow-engine-to-real-local-animation-runtime', async () => {
    const before = calls.length, ledger = structuredClone((await engine.snapshot()).ledger), files = await artifacts.listProject(projectId), source = files.find(file => file.mimeType === 'image/png' && !file.trashedAt && !file.unavailable); assert(source);
    const sourceFile = await artifacts.read(source.id), sourceSha256 = sha(sourceFile.buffer), resized = nativeImage.createFromBuffer(sourceFile.buffer).resize({ width: 1024, height: 1024, quality: 'best' });
    assert(!resized.isEmpty()); assert.deepEqual(resized.getSize(), { width: 1024, height: 1024 });
    const buffer = resized.toPNG(), previewSource = await artifacts.write({ name: '长文案预览验收-1024.png', mimeType: 'image/png', buffer, projectId });
    report.previewFixture = { sourceArtifactId: source.id, sourceSha256, artifactId: previewSource.id, width: 1024, height: 1024, sha256: sha(buffer) };
    const step = { id: 'local-animation', name: '已有PNG合成动画', kind: 'animation-compose', inputSource: 'project', referenceArtifactIds: [previewSource.id], enabled: true, prompt: '', animation: { mode: 'gif', style: 'pixel-light', columns: 1, rows: 1, width: 1024, height: 1024, fps: 10, loopMs: 400, background: 'transparent', entries: [{ caption: '本地流程', description: '', motion: 'sway' }] } };
    const workflow = { id: 'native-local-animation-workflow', workspaceId, name: '真实本地动画流程验收', description: 'Existing synthetic PNG, actual engine and bundled runtime; no provider request', outputKind: 'image', steps: [step], updatedAt: new Date().toISOString() };
    const run = await engine.start({ project: context.project, workflow, connections: context.connections, models: context.models, input: '使用已有PNG在本地合成', variables: {}, attachmentIds: [], acknowledgePaidCalls: false, acknowledgeUnknownCost: false });
    await until(async () => ['complete','failed','cancelled'].includes((await engine.runDetail(run.id)).status), 'actual local workflow finished', 18000);
    const final = await engine.runDetail(run.id); assert.equal(final.status, 'complete', final.error); const attempt = final.attempts.find(item => item.stepId === step.id); assert.equal(attempt.costCents, 0); assert(attempt.artifacts.some(file => file.mimeType === 'image/gif')); for (const item of attempt.artifacts) { const file = await artifacts.read(item.id); assert.equal(file.runId, run.id); assert.equal(file.projectId, projectId); }
    await click('[aria-label="刷新动画工程"]');
    await dom(`document.querySelector('[aria-label="当前条目文案"]')?.value==='本地流程'&&document.querySelector('[aria-label="角色作品数量"]')?.value==='1'&&document.querySelector('.animation-save-status')?.textContent==='已保存到项目'&&![...document.querySelectorAll('.animation-notice button')].some(button=>button.textContent.includes('保留草稿并载入新结果'))`, 'renderer adopted the external one-entry workflow document');
    assert.equal(sha((await artifacts.read(source.id)).buffer), sourceSha256); assert.equal(calls.length, before); assert.deepEqual((await engine.snapshot()).ledger, ledger); report.workflowCompositionNoHttpOrLedgerEntry = true;
  });
  await step('native-hidden-window-pauses-playback', async () => {
    assert.equal(report.singlePlaybackVerified, true); await previewLayoutMatrix();
    const before = calls.length, ledger = structuredClone((await engine.snapshot()).ledger);
    await click('[role="tab"]', 'GIF 动画工坊'); await click('.animation-preview-actions button', '更新预览'); await idle();
    assert.equal(calls.length, before); assert.deepEqual((await engine.snapshot()).ledger, ledger);
    await click('.animation-preview-actions button', '播放 GIF'); await dom(`document.querySelectorAll('img[src^="data:image/gif"]').length===1`, 'workflow GIF playing before hide');
    visibilityRound = true; window.setOpacity(0); window.webContents.setBackgroundThrottling(true); window.showInactive(); await dom(`document.hidden===false`, 'native visibility round active'); window.hide(); await dom(`document.hidden===true`, 'actual hidden document'); await delay(150); window.webContents.setBackgroundThrottling(false); window.setOpacity(1); visibilityRound = false;
    await dom(`document.querySelectorAll('img[src^="data:image/gif"]').length===0`, 'hidden preview paused'); report.singlePlaybackAndHiddenPause = true;
  });
  assert.equal(sha(await fsp.readFile(referencePath)), report.originalReferenceSha256); report.originalReferenceUnchanged = true; assert.equal(Object.keys(require.cache).some(filename => filename === path.join(root, 'electron/main.cjs')), false);
}
async function run() {
  prepare(); await app.whenReady(); await initialize();
  window = new BrowserWindow({ show: false, frame: false, skipTaskbar: true, width: 1440, height: 1000, useContentSize: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); report.windows.created++;
  window.on('show', () => { report.windows.shown++; const opacity = window.getOpacity(); report.windows.showOpacities.push(opacity); if (!visibilityRound || opacity !== 0) void finish(Error('Only a zero-opacity native visibility transition is permitted')); }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-redirect', event => event.preventDefault()); window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith(pathToFileURL(owner.dist + path.sep).href) || details.url.startsWith('data:image/'); if (!allowed) report.externalRequests++; callback({ cancel: !allowed }); });
  await window.loadFile(path.join(owner.dist, 'animation-studio.html')); report.processIds.push(window.webContents.getOSProcessId()); await scenario(); await finish();
}
process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); }); run().catch(error => { void finish(error); });
