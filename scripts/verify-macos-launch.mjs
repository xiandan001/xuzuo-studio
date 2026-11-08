// Launch the actual distributable, then exercise its production renderer/IPC over loopback CDP.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'darwin');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bundle = path.resolve(process.argv[2] || path.join(root, manifest.build.directories.output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', manifest.build.productName + '.app'));
const executable = path.join(bundle, 'Contents/MacOS', manifest.build.productName);
const output = fs.mkdtempSync(path.join(root, 'work/macos-package-launch-'));
const profile = path.join(output, 'profile'); fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, '.xuzuo-validation-profile.json'), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', ownerPid: process.pid, directory: profile }));
const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const child = spawn(executable, ['--isolated-validation', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env: { ...process.env, XUZUO_QA_PROFILE: profile, XUZUO_QA_VISIBLE: '1', XUZUO_QA_USE_DIALOG_UI: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { logs += bytes.toString(); });
child.on('error', error => { logs += String(error); });
let childResult;
child.once('exit', (code, signal) => { childResult = { code, signal }; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await pause(100); }
  throw Error('Timed out: ' + label);
}
const sockets = [];
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data), record = pending.get(message.id); if (record) { pending.delete(message.id); clearTimeout(record.timer); message.error ? record.reject(Error(JSON.stringify(message.error))) : record.resolve(message.result); } });
  async function call(method, params) {
    return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  }
  return { call, async evaluate(expression) { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; } };
}
const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => []);
const report = { passed: false, bundle, platform: process.platform, arch: process.arch, checks: [], errors: [] };
try {
  const target = await until(async () => (await targets()).find(item => item.type === 'page' && item.url.endsWith('/index.html')), 'packaged renderer');
  assert(target.url.includes('/app.asar/'), 'Use the actual packaged application');
  const main = await connect(target);
  await until(() => main.evaluate('Boolean(window.desktop && document.querySelector(".conversation-home"))'), 'packaged React home');
  assert.equal(await main.evaluate('desktop.platform'), 'darwin');
  report.checks.push('Actual signed application executable loads React and sandboxed preload from app.asar');
  const status = await main.evaluate('Promise.all([desktop.runtime.status(),desktop.credentials.list(),desktop.workspaceFiles.list(),desktop.updates.status()])');
  assert.equal(status[0].available, true); assert.equal(status[1].length, 0); assert.equal(status[3].enabled, false);
  report.checks.push('Packaged runtime, workspace, credentials and macOS update IPC respond');
  // Navigate lazy loaded pages in the actual release bundle.
  for (const [label, content] of [['项目', 'projects'], ['资源库', 'assets'], ['自动化', 'workflows']]) {
    await main.evaluate(`Array.from(document.querySelectorAll('.sidebar nav button,.sidebar button')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`);
    await until(() => main.evaluate(`Boolean(document.querySelector('.content-${content}') && document.querySelector('.content-${content}').innerText.trim().length>10)`), label + ' page');
    report.checks.push('Packaged lazy page: ' + label);
  }
  const destination = path.join(output, '中文 交付'); fs.mkdirSync(destination);
  await main.evaluate('window.qaSave=desktop.fileDialogs.saveText({filename:"真实安装包.txt",text:"macOS packaged save ✓"}); void 0');
  const pickerTarget = await until(async () => (await targets()).find(item => item.url.endsWith('/dialog.html')), 'packaged custom picker');
  const picker = await connect(pickerTarget);
  await until(() => picker.evaluate('Boolean(window.studioDialog && document.querySelector(".file-dialog-layout"))'), 'packaged picker UI');
  await picker.evaluate(`void studioDialog.accept({directory:${JSON.stringify(destination)},filename:'实际保存.txt'}).catch(()=>{}); void 0`);
  assert.equal((await main.evaluate('window.qaSave')).saved, true);
  assert.equal(fs.readFileSync(path.join(destination, '实际保存.txt'), 'utf8'), 'macOS packaged save ✓');
  report.checks.push('Packaged picker saves actual UTF-8 file to Chinese path with spaces');
  // Capture after pages and animations have painted.
  await pause(500);
  const screenshot = await main.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'packaged-desktop.png'), Buffer.from(screenshot.data, 'base64'));
  // Detach CDP while the renderer is alive. An attached debugging session can
  // hold Chromium shutdown open after the application has finalized its writes.
  await main.evaluate('desktop.onCloseStateRequested(()=>({blocked:false})); setTimeout(()=>desktop.close(),500); void 0');
  for (const socket of sockets) socket.close();
  await until(() => childResult, 'safe application exit');
  report.exit = childResult;
  assert.equal(childResult.code, 0, JSON.stringify(childResult));
  report.checks.push('Actual app closes through the production saving coordinator with exit code 0');
  report.passed = true;
} catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; }
finally {
  for (const socket of sockets) socket.close();
  if (child.exitCode === null && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The owned child already stopped. */ } }
  fs.writeFileSync(path.join(output, 'launch.log'), logs);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, report: path.join(output, 'report.json') }));
}
