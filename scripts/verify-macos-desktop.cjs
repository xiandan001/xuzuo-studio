// Real Electron application smoke test. Uses a new isolated profile, never a real API key.
const { app, BrowserWindow, Menu, session, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
assert.equal(process.platform, 'darwin', 'Run this acceptance probe on macOS with Electron.');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'work/macos-desktop-'));
const profile = path.join(output, 'profile'); fs.mkdirSync(profile);
const destination = path.join(output, '中文 保存目录'); fs.mkdirSync(destination);
fs.writeFileSync(path.join(profile, '.xuzuo-validation-profile.json'), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', ownerPid: process.ppid, directory: profile }));
process.env.XUZUO_QA_PROFILE = profile;
process.env.XUZUO_QA_USE_DIALOG_UI = '1';
process.env.XUZUO_QA_VISIBLE = '1';
const report = { passed: false, commit: process.env.GITHUB_SHA || null, version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, localDiagnostic: process.env.GITHUB_ACTIONS !== 'true', platform: process.platform, arch: process.arch, electron: process.versions.electron, checks: [], errors: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await pause(50); }
  throw Error(`Timed out: ${label}`);
}
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) report.errors.push(String(error.stack || error));
  report.passed = report.errors.length === 0;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, phase: report.phase, errors: report.errors, report: path.join(output, 'report.json') }));
  app.exit(report.passed ? 0 : 1);
}
setTimeout(() => finish(Error('macOS desktop acceptance exceeded 90 seconds')), 90000).unref();
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
});
require('../electron/main.cjs');
async function respondToClosingDialog(popup, expression) {
  try { await popup.webContents.executeJavaScript(expression); }
  catch (error) {
    // A successful IPC response closes this popup before Electron can return
    // its evaluate ACK. Never suppress an error from the main window.
    if (!String(error).includes('Render frame was disposed before the request completed')) throw error;
  }
  await until(() => popup.isDestroyed(), 'responded popup closes');
}
async function editFocusSnapshot(window, phase) {
  const contents = window.webContents, focusedWindow = BrowserWindow.getFocusedWindow(), focusedContents = webContents.getFocusedWebContents();
  let renderer;
  try { renderer = await contents.executeJavaScript('({hasFocus:document.hasFocus(),activeId:document.activeElement?.id,activeTag:document.activeElement?.tagName,commands:window.qaEdits,events:window.qaEditEvents,value:document.getElementById("qa-edit-target")?.textContent})'); }
  catch (error) { renderer = { error: String(error) }; }
  return { phase, windowId: window.id, visible: window.isVisible(), windowFocused: window.isFocused(), contentsId: contents.id, contentsFocused: contents.isFocused(), focusedWindowId: focusedWindow?.id || null, focusedContentsId: focusedContents?.id || null, renderer };
}
async function run() {
  await app.whenReady();
  const window = await until(() => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/index.html')), 'main window');
  const contents = window.webContents;
  const consoleProbe = 'macos-console-probe-' + randomUUID(); let consoleProbeReceived = false;
  contents.on('console-message', details => {
    if (details.level !== 'error') return;
    if (details.message === consoleProbe) { consoleProbeReceived = true; return; }
    if (!/ERR_BLOCKED_BY_CLIENT|Content Security Policy/.test(details.message)) report.errors.push(`Renderer: ${details.message}`);
  });
  await until(() => contents.executeJavaScript('Boolean(window.desktop && document.querySelector(".studio-app-shell"))'), 'React application');
  await until(() => contents.executeJavaScript('Boolean(document.querySelector(".conversation-home"))'), 'home page');
  await contents.executeJavaScript(`console.error(${JSON.stringify(consoleProbe)}); void 0`);
  await until(() => consoleProbeReceived, 'actual renderer console error capture');
  report.consoleErrorCaptureVerified = true;
  assert.equal(await contents.executeJavaScript('window.desktop.platform'), 'darwin');
  assert.equal(await contents.executeJavaScript('Boolean(document.querySelector(".platform-macos"))'), true);
  assert.equal(await contents.executeJavaScript('Boolean(document.querySelector(".desktop-titlebar .window-controls"))'), false);
  report.checks.push('React boots with sandboxed macOS bridge and native title bar');
  const menu = Menu.getApplicationMenu(); assert(menu);
  const roles = menu.items.flatMap(item => item.submenu?.items.map(child => child.role) || []);
  for (const role of ['about', 'copy', 'paste', 'minimize', 'togglefullscreen']) assert(roles.includes(role), role);
  const state = await contents.executeJavaScript('Promise.all([desktop.runtime.status(), desktop.workspaceFiles.list(), desktop.updates.status(), desktop.maintenance.status(), desktop.officePreview.status(), desktop.credentials.list()])');
  assert.equal(state.at(-1).length, 0);
  assert.equal(state[2].enabled, false);
  assert.equal(state[3].available, false);
  report.checks.push('Runtime, workspaces, updates, maintenance, Office and empty credentials respond through IPC');
  const edit = menu.items.find(item => item.label === '编辑').submenu;
  report.phase = 'native-menu-activation'; report.menuFocus = [];
  app.focus({ steal: true }); window.show(); window.focus(); contents.focus();
  await contents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<button id="qa-edit-target">修改后</button>'); window.qaEdits=[]; window.qaEditEvents=[]; document.getElementById('qa-edit-target').addEventListener('keydown', event => { window.qaEditEvents.push({key:event.key,meta:event.metaKey,shift:event.shiftKey,targetId:event.target.id}); if(event.metaKey && event.key==='z') { event.preventDefault(); const command=event.shiftKey?'redo':'undo'; window.qaEdits.push(command); event.currentTarget.textContent=command==='undo'?'原始文字':'修改后'; } });`);
  try {
    for (const [index, command, value] of [[0, 'undo', '原始文字'], [1, 'redo', '修改后']]) {
      report.phase = 'native-menu-' + command;
      await contents.executeJavaScript('document.getElementById("qa-edit-target").focus(); void 0');
      await until(() => contents.executeJavaScript('document.activeElement?.id === "qa-edit-target"'), 'actual DOM editor focus');
      report.menuFocus.push(await editFocusSnapshot(window, 'before-' + command));
      // The locked native MenuItem API takes (event, BrowserWindow, WebContents).
      // Explicit context exercises the production route without inventing OS focus.
      edit.items[index].click({}, window, contents);
      await until(() => contents.executeJavaScript(`window.qaEdits.length === ${index + 1} && document.getElementById("qa-edit-target").textContent === ${JSON.stringify(value)}`), 'native menu ' + command + ' UI result');
      assert.deepEqual(await contents.executeJavaScript('window.qaEdits'), index ? ['undo', 'redo'] : ['undo']);
      report.menuFocus.push(await editFocusSnapshot(window, 'after-' + command));
    }
  } catch (error) { report.menuFocus.push(await editFocusSnapshot(window, 'failure')); throw error; }
  report.nativeMenuEditing = { invocation: 'Electron MenuItem.click with actual window and contents', undoObserved: true, redoObserved: true, uiResultsVerified: true, osWindowFocused: window.isFocused(), rendererKeys: await contents.executeJavaScript('window.qaEditEvents') };
  await contents.executeJavaScript('document.getElementById("qa-edit-target").remove()');
  report.checks.push('Native Undo and Redo dispatch cancelable Command shortcuts to editors');
  // Open the production custom save window and accept through its sandboxed renderer bridge.
  await contents.executeJavaScript('window.qaSave = desktop.fileDialogs.saveText({filename:"验收.txt",text:"macOS 中文保存 ✓"}); void 0');
  const picker = await until(() => BrowserWindow.getAllWindows().find(item => item !== window), 'custom file picker');
  await until(() => picker.webContents.executeJavaScript('Boolean(window.studioDialog && document.querySelector(".file-dialog-layout"))').catch(() => false), 'file picker React');
  const config = await picker.webContents.executeJavaScript('studioDialog.request()'); assert.equal(config.kind, 'save');
  await picker.webContents.executeJavaScript(`studioDialog.list({path:${JSON.stringify(destination)}})`);
  await respondToClosingDialog(picker, `void studioDialog.accept({directory:${JSON.stringify(destination)},filename:'验收.txt'}).catch(()=>{}); void 0`);
  const saved = await contents.executeJavaScript('window.qaSave'); assert.equal(saved.saved, true);
  const savedFile = fs.readdirSync(destination).find(name => name.endsWith('.txt')); assert(savedFile);
  assert.equal(fs.readFileSync(path.join(destination, savedFile), 'utf8'), 'macOS 中文保存 ✓');
  report.checks.push('Custom file picker saves actual UTF-8 bytes to a Chinese directory with spaces');
  // Closing with an unsaved editor must retain the app when the user chooses Return.
  report.phase = 'unsaved-close-confirmation';
  await contents.executeJavaScript('desktop.onCloseStateRequested(() => ({blocked:true})); void 0');
  window.close();
  const confirmation = await until(() => BrowserWindow.getAllWindows().find(item => item !== window), 'unsaved-close confirmation');
  await until(() => confirmation.webContents.executeJavaScript('Boolean(window.studioDialog && document.querySelector(".sd-message"))').catch(() => false), 'confirmation UI');
  const warning = await confirmation.webContents.executeJavaScript('studioDialog.request()'); assert.equal(warning.kind, 'message');
  report.phase = 'unsaved-close-response';
  await respondToClosingDialog(confirmation, 'void studioDialog.respondMessage(0).catch(()=>{}); void 0');
  await until(() => BrowserWindow.getAllWindows().length === 1, 'cancel close');
  assert.equal(window.isDestroyed(), false);
  await until(() => contents.executeJavaScript('!document.querySelector("[data-application-closing]")'), 'editor usable after cancelled close');
  report.phase = 'write-after-cancelled-close';
  await contents.executeJavaScript('window.qaAfterCancel=desktop.fileDialogs.saveText({filename:"取消退出后.txt",text:"取消退出后仍可保存 ✓"}); void 0');
  const resumedPicker = await until(() => BrowserWindow.getAllWindows().find(item => item !== window), 'file picker after cancelled close');
  await until(() => resumedPicker.webContents.executeJavaScript('Boolean(window.studioDialog && document.querySelector(".file-dialog-layout"))').catch(() => false), 'resumed picker UI');
  await respondToClosingDialog(resumedPicker, `void studioDialog.accept({directory:${JSON.stringify(destination)},filename:'取消退出后.txt'}).catch(()=>{}); void 0`);
  assert.equal((await contents.executeJavaScript('window.qaAfterCancel')).saved, true);
  const afterCancelText = fs.readFileSync(path.join(destination, '取消退出后.txt'), 'utf8');
  assert.equal(afterCancelText, '取消退出后仍可保存 ✓');
  await until(() => BrowserWindow.getAllWindows().length === 1, 'resumed picker closes');
  assert.equal(window.isDestroyed(), false);
  assert.equal(await contents.executeJavaScript('Boolean(document.querySelector("[data-application-closing]"))'), false);
  report.closeCancellation = { mainWindowRetained: true, closingStateCleared: true, subsequentSaveVerified: true, bytes: Buffer.byteLength(afterCancelText, 'utf8') };
  await contents.executeJavaScript('desktop.onCloseStateRequested(() => ({blocked:false})); void 0');
  report.checks.push('Native window close protects unsaved editing; cancel retains the window and permits another actual UTF-8 save');
  report.phase = 'capture';
  const screenshot = await contents.capturePage(); fs.writeFileSync(path.join(output, 'desktop.png'), screenshot.toPNG());
  await finish();
}
run().catch(finish);
