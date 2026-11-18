const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const sourceRoot = path.resolve(__dirname, '..'), ownerPath = process.argv[2], started = Date.now();
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const report = { passed: false, localDiagnostic: true, fullProductionApplicationStarted: true, userProfileAccessed: false, providerCalls: 0, modelCommands: 0, modelNetworkAttempts: 0, windows: { created: 0, shown: 0, remaining: 0 }, steps: [], screenshots: [], ipc: [], blockedRequests: [], errors: [], processIds: [process.pid] };
let owner, mainWindow, finishing = false, timer;
const ordinary = (file, directory = false) => { const stat = fs.lstatSync(file); assert(!stat.isSymbolicLink()); assert(directory ? stat.isDirectory() : stat.isFile()); assert(same(fs.realpathSync(file), file)); return stat; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function prepare() {
  assert.equal(process.platform, 'win32'); assert(path.isAbsolute(ownerPath || '')); assert(ordinary(ownerPath).size < 16 * 1024 * 1024); owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); assert.equal(owner.kind, 'xuzuo-new-project-app'); assert.match(owner.nonce, /^[a-f0-9-]{36}$/); assert.equal(path.dirname(ownerPath), owner.directory); assert.match(path.basename(owner.directory), /^xuzuo-new-project-app-/); assert(same(path.dirname(owner.profile), owner.directory)); assert(same(path.dirname(owner.workspace), owner.directory)); assert(same(path.dirname(owner.mirror), path.join(sourceRoot, 'work'))); assert.match(path.basename(owner.mirror), /^new-project-app-runtime-/);
  for (const directory of [owner.directory, owner.profile, owner.workspace, owner.mirror, owner.output]) ordinary(directory, true);
  assert(same(fs.realpathSync(path.join(owner.mirror, 'node_modules')), owner.dependencyRoot));
  for (const [name, digest] of Object.entries(owner.sources)) { assert(!name.split('/').includes('..')); assert.match(digest, /^[a-f0-9]{64}$/); const source = name.startsWith('scripts/') ? path.join(sourceRoot, name) : path.join(owner.mirror, name); ordinary(source); assert.equal(hash(fs.readFileSync(source)), digest); }
  for (const [name, digest] of Object.entries(owner.distFiles)) { const file = path.join(owner.mirror, 'dist', name); ordinary(file); assert.equal(hash(fs.readFileSync(file)), digest); }
  assert(same(process.env.XUZUO_QA_PROFILE, owner.profile)); assert.equal(process.env.XUZUO_QA_VISIBLE, '0');
  const { readValidationOwner } = require(path.join(owner.mirror, 'electron/validation-lifecycle.cjs')); assert.equal(readValidationOwner(owner.profile).ownerPid, owner.ownerPid);
  app.setPath('sessionData', owner.profile); app.disableHardwareAcceleration(); report.nonce = owner.nonce;
}
async function evaluate(source) { let timeout; try { return await Promise.race([mainWindow.webContents.executeJavaScript(source, true), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Full App DOM call timed out')), 4000); })]); } finally { clearTimeout(timeout); } }
async function until(label, action, timeoutMs = 7000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (await action()) return; await delay(35); } throw Error('Full App condition not reached: ' + label); }
const dom = (label, expression) => until(label, () => evaluate('Boolean(' + expression + ')'));
async function click(selector, text) {
  const query = '(()=>[...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(e=>e.getClientRects().length&&!e.disabled&&' + (text ? 'e.textContent.trim().includes(' + JSON.stringify(text) + ')' : 'true') + '))()';
  await dom('click ' + (text || selector), query); await evaluate('(()=>{const e=' + query + ';e.scrollIntoView({block:"nearest",behavior:"instant"});e.click()})()');
}
async function fill(selector, text) {
  const token = owner.nonce + ':' + Date.now();
  await dom('input available', 'document.querySelector(' + JSON.stringify(selector) + ')&&!document.querySelector(' + JSON.stringify(selector) + ').disabled');
  await evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');e.dataset.newProjectSmokeInput=' + JSON.stringify(token) + ';e.focus({preventScroll:true});e.setSelectionRange(0,e.value.length)})()');
  await dom('actual focused selection', '(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');return e?.dataset.newProjectSmokeInput===' + JSON.stringify(token) + '&&document.activeElement===e&&e.selectionStart===0&&e.selectionEnd===e.value.length})()');
  await mainWindow.webContents.insertText(text);
  await dom('actual Electron text inserted', '(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');return e?.dataset.newProjectSmokeInput===' + JSON.stringify(token) + '&&e.value===' + JSON.stringify(text) + '})()');
}
function tree(directory, current = directory, result = {}) { for (const name of fs.readdirSync(current)) { const file = path.join(current, name), stat = fs.lstatSync(file); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) tree(directory, file, result); else { assert(stat.isFile() && stat.size < 32 * 1024 * 1024); result[path.relative(directory, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file)); } } return result; }
const locations = () => JSON.parse(fs.readFileSync(path.join(owner.profile, 'workspace-directories-v1.json'), 'utf8'));
async function screenshot(name, expectedSelector) {
  if (expectedSelector) await dom('capture target ' + name, 'document.querySelector(' + JSON.stringify(expectedSelector) + ')');
  await evaluate('document.fonts.ready'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); mainWindow.webContents.invalidate(); await delay(120);
  await mainWindow.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); mainWindow.webContents.invalidate(); await delay(60);
  const image = await mainWindow.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), bytes = image.toPNG(); assert(bytes.length > 5000);
  const filename = String(report.screenshots.length + 1).padStart(2, '0') + '-' + name + '.png'; fs.writeFileSync(path.join(owner.output, filename), bytes, { flag: 'wx' });
  const inspect = () => { const r = document.querySelector('.new-project-modal')?.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, documentWidth: document.documentElement.scrollWidth, modal: r ? { left:r.left,right:r.right,top:r.top,bottom:r.bottom } : null, modalTitle:document.querySelector('#new-project-heading')?.textContent, creationName:document.querySelector('.new-project-name input')?.value, routeTitle:document.querySelector('.breadcrumb strong')?.textContent, imageEditor:!!document.querySelector('.image-studio-page'), wordEditor:!!document.querySelector('.ed-word-editor') }; };
  const layout = await evaluate('(' + inspect.toString() + ')()'); assert(layout.documentWidth <= layout.width + 1); if (layout.modal) assert(layout.modal.left >= 0 && layout.modal.right <= layout.width + 1 && layout.modal.top >= 0 && layout.modal.bottom <= layout.height + 1);
  report.screenshots.push({ filename, bytes:bytes.length, ...image.getSize(), sha256:hash(bytes), layout, paintBarrierFrames:4 });
}
async function step(name, action) { report.phase = name; process.stdout.write('Full production App step: ' + name + '\n'); const before = Date.now(); await action(); report.steps.push({ name, ms: Date.now() - before }); }
async function breadcrumbReturn(kind, project, expectedCount) {
  const inspect = () => { const nav = document.querySelector('nav[aria-label="面包屑"]'); return { labels: [...nav.querySelectorAll('button,strong')].map(e => e.textContent.trim()), current: nav.querySelector('[aria-current="page"]')?.textContent, projectLinks: nav.querySelectorAll('.breadcrumb-projects').length, middleVisible: !!nav.querySelector('.breadcrumb-projects')?.getClientRects().length, width: innerWidth }; };
  const wide = await evaluate('(' + inspect.toString() + ')()'); assert.deepEqual(wide.labels, [owner.seed.workspaces[0].name, '项目', project.name]); assert.equal(wide.current, project.name); assert.equal(wide.projectLinks, 1); assert.equal(wide.middleVisible, true);
  mainWindow.setContentSize(1120, 900); await dom('actual supported narrow viewport', 'innerWidth>=1120&&innerWidth<1200'); const actualNarrowWidth = await evaluate('innerWidth'); await screenshot(kind + '-breadcrumb-narrow', 'nav.breadcrumb');
  const narrow = await evaluate('(' + inspect.toString() + ')()'); narrow.requestedWidth = 1120; narrow.nativeContentWidth = mainWindow.getContentSize()[0]; assert.equal(narrow.width, actualNarrowWidth); assert.deepEqual(narrow.labels, wide.labels); assert.equal(narrow.projectLinks, 1); assert.equal(narrow.middleVisible, true); mainWindow.setContentSize(1280, 900);
  const beforeCreate = report.ipc.filter(name => /workspace-create/.test(name)).length;
  await click('.breadcrumb-projects'); await dom('breadcrumb returns actual project list', 'document.querySelector(".content-projects .op-project-grid,.content-projects .op-project-table")');
  await dom('same workspace persisted list', 'JSON.parse(localStorage.getItem("xuzuo-ui-prototype-v2")).projects.length===' + expectedCount);
  const returned = await evaluate('(()=>{const s=JSON.parse(localStorage.getItem("xuzuo-ui-prototype-v2"));return {workspaceId:s.activeWorkspaceId,ids:s.projects.map(p=>p.id),workspaceName:document.querySelector(".breadcrumb-workspace").textContent,labels:[...document.querySelectorAll("nav.breadcrumb button,nav.breadcrumb strong")].map(e=>e.textContent.trim()),middleLinks:document.querySelectorAll(".breadcrumb-projects").length,listCount:document.querySelectorAll(".op-project-grid>.op-project-card,.op-project-table tbody>tr").length}})()');
  assert.equal(returned.workspaceId, owner.workspaceId); assert.equal(returned.workspaceName, owner.seed.workspaces[0].name); assert.equal(returned.ids.length, expectedCount); assert.equal(new Set(returned.ids).size, expectedCount); assert.equal(returned.listCount, expectedCount); assert.equal(returned.middleLinks, 0); assert.equal(returned.labels.length, 2); assert.equal(report.ipc.filter(name => /workspace-create/.test(name)).length, beforeCreate); assert.equal(report.modelCommands, 0);
  report.breadcrumbChecks ||= []; report.breadcrumbChecks.push({ kind, wide, narrow, returned, returnedSameWorkspace: true });
}
async function scenario() {
  await until('production main window exists', async () => !!mainWindow); await dom('actual production renderer', 'window.desktop?.validationProfile===true&&document.querySelector(".app-header")');
  assert(same(app.getPath('userData'), owner.profile)); assert(same(app.getPath('sessionData'), owner.profile)); const preferences = mainWindow.webContents.getLastWebPreferences(); report.webPreferences = { keys: Object.keys(preferences), contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox, preload: preferences.preload || null }; assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true); if (preferences.preload) assert(same(preferences.preload, path.join(owner.mirror, 'electron/preload.cjs'))); await dom('real production preload bridge', 'typeof window.desktop.workspaceFiles.createDefaultProject==="function"&&typeof window.desktop.runtime.snapshot==="function"');
  await evaluate('(()=>{if(window.desktop?.validationProfile!==true)throw Error("Not isolated validation");localStorage.clear();localStorage.setItem("xuzuo-ui-prototype-v2",' + JSON.stringify(JSON.stringify(owner.seed)) + ');localStorage.setItem("xuzuo-configuration-v1",JSON.stringify({categories:[],workflows:[],connections:[],models:[],studioActions:[],useTemplates:[]}));localStorage.setItem("xuzuo-appearance-v1",JSON.stringify({version:1,mode:"light",palette:"blue",layout:"simple"}));})()');
  mainWindow.webContents.reload(); await dom('registered test workspace loaded', 'document.querySelector(".breadcrumb-workspace")?.textContent===' + JSON.stringify(owner.seed.workspaces[0].name)); mainWindow.setContentSize(1280, 900);
  assert.equal((await evaluate('window.desktop.credentials.list()')).length, 0); assert.equal(locations().projects.length, 0); const before = tree(owner.workspace), title = '同名作品真实验收';
  await step('top-header-opens-title-and-type-without-picker-or-disk-write', async () => {
    await click('.app-header .header-new-project'); await dom('new project UI opened', 'document.querySelector(".new-project-modal form")'); await fill('[aria-label="项目名称"]', '取消后不应落盘的作品'); await click('.new-kind-grid button', '图像创作');
    assert.equal(report.windows.created, 1); assert.equal(report.ipc.filter(name => /workspace-choose|workspace-create/.test(name)).length, 0); assert.deepEqual(tree(owner.workspace), before); await screenshot('new-project-before-cancel', '.new-project-modal');
    await click('.new-project-modal .modal-actions .btn-secondary'); await dom('cancelled creation UI closed', '!document.querySelector(".new-project-modal")'); assert.equal(locations().projects.length, 0); assert.deepEqual(tree(owner.workspace), before);
  });
  await step('create-image-from-real-App-default-workspace', async () => {
    await click('.app-header .header-new-project'); await dom('new project UI reopened', 'document.querySelector(".new-project-modal form")'); await fill('[aria-label="项目名称"]', title); await click('.new-kind-grid button', '图像创作');
    assert.equal(await evaluate('document.querySelector("[aria-label=项目名称]").value'), title); await click('.new-project-modal button[type="submit"]'); await dom('actual image workbench entered', '!document.querySelector(".new-project-modal")&&document.querySelector(".content-images .image-studio-page")');
    await until('actual project persisted', async () => locations().projects.length === 1); const first = locations().projects[0]; assert.equal(first.name, title); assert(same(path.dirname(first.directory), owner.workspace)); const marker = JSON.parse(fs.readFileSync(path.join(first.directory, '.xuzuo/project-v1.json'), 'utf8')); assert.equal(marker.projectId, first.projectId);
    const savedFile = path.join(first.directory, 'files/kept-before-second.txt'); fs.writeFileSync(savedFile, 'OWNED_PROJECT_SENTINEL_9752', { flag: 'wx' }); report.firstProject = { ...first, savedFile, savedSha256: hash(fs.readFileSync(savedFile)) }; await screenshot('created-image-workbench', '.content-images .image-studio-page'); await breadcrumbReturn('image', first, 1);
  });
  await step('same-title-second-Word-is-distinct-and-keeps-existing-files', async () => {
    await click('.app-header .header-new-project'); await dom('second new project UI', 'document.querySelector(".new-project-modal form")'); await fill('[aria-label="项目名称"]', title); await click('.new-kind-grid button', 'Word 文档'); await screenshot('same-title-Word-before-create', '.new-project-modal'); await click('.new-project-modal button[type="submit"]');
    const wordReady = () => !document.querySelector('.new-project-modal') && !!document.querySelector('.content-documents [aria-label="Word 内容编辑器"] [aria-label="文档标题"]');
    await dom('actual Word editor entered', '(' + wordReady.toString() + ')()'); await until('two actual projects', async () => locations().projects.length === 2);
    const entries = locations().projects, second = entries.find(item => item.projectId !== report.firstProject.projectId); assert(second); assert.equal(second.name, title); assert.notEqual(second.directory, report.firstProject.directory); assert.notEqual(second.projectId, report.firstProject.projectId); assert(same(path.dirname(second.directory), owner.workspace)); assert.equal(hash(fs.readFileSync(report.firstProject.savedFile)), report.firstProject.savedSha256); assert.equal(hash(fs.readFileSync(owner.sentinel)), owner.sentinelSha256); report.secondProject = second;
    await screenshot('created-Word-workbench', '.content-documents .ed-word-editor'); await breadcrumbReturn('word', second, 2);
  });
  await step('cancel-after-existing-projects-keeps-disk-and-account-empty', async () => {
    const stored = tree(owner.workspace); await click('.app-header .header-new-project'); await dom('final cancellation draft', 'document.querySelector(".new-project-modal form")'); await fill('[aria-label="项目名称"]', '再取消一次'); await click('.new-project-modal .modal-actions .btn-secondary'); await dom('final cancellation closed', '!document.querySelector(".new-project-modal")'); assert.deepEqual(tree(owner.workspace), stored); assert.equal(locations().projects.length, 2);
    await dom('renderer project metadata saved', 'JSON.parse(localStorage.getItem("xuzuo-ui-prototype-v2")).projects.length===2'); const state = await evaluate('JSON.parse(localStorage.getItem("xuzuo-ui-prototype-v2"))'); assert.equal(state.projects.filter(item => item.kind === 'word').length, 1); assert.equal(state.projects.filter(item => item.kind === 'image').length, 1); assert(state.projects.every(item => item.workspaceId === owner.workspaceId)); assert.equal(state.ledger.length, 0); assert.equal((await evaluate('window.desktop.credentials.list()')).length, 0);
    const snapshot = await evaluate('window.desktop.runtime.snapshot()'); assert.equal(snapshot.runs.length, 0); assert.equal(snapshot.ledger.length, 0); assert.equal(report.ipc.filter(name => name === 'runtime:workspace-create-default-project').length, 2); assert.equal(report.ipc.filter(name => /workspace-choose/.test(name)).length, 0); assert.equal(report.modelCommands, 0); assert.equal(report.modelNetworkAttempts, 0); report.rendererProjects = state.projects;
  });
}
async function finalize(error) {
  if (finishing) return; finishing = true; clearTimeout(timer); if (error) report.errors.push(String(error.stack || error));
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)])]; report.passed = !report.errors.length; report.elapsedMs = Date.now() - started;
  if (error && mainWindow && !mainWindow.isDestroyed()) {
    try { const snapshot = () => ({ url: location.href, title: document.title, heading: document.querySelector('.breadcrumb strong')?.textContent, content: document.querySelector('.app-content')?.textContent.slice(0,2400), wordEditor: !!document.querySelector('[aria-label="Word 内容编辑器"]'), alerts: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent) }); report.failureDOM = await evaluate('(' + snapshot.toString() + ')()'); await screenshot('failure-state'); } catch (diagnosticError) { report.diagnosticError = String(diagnosticError.message || diagnosticError); }
  }
  if (error) { fs.writeFileSync(path.join(owner.directory, 'native-report.json'), JSON.stringify({ ...report, windows: { ...report.windows, remaining: BrowserWindow.getAllWindows().length } }, null, 2) + '\n'); app.exit(1); return; }
  const force = setTimeout(() => { report.errors.push('Production close did not finish within 8 seconds'); report.passed = false; fs.writeFileSync(path.join(owner.directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n'); app.exit(1); }, 8000); force.unref();
  app.once('quit', () => { clearTimeout(force); report.windows.remaining = BrowserWindow.getAllWindows().length; fs.writeFileSync(path.join(owner.directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n'); });
  mainWindow.close();
}
try {
  prepare(); timer = setTimeout(() => finalize(Error('Full App smoke exceeded 90 seconds')), 90000); process.on('uncaughtException', finalize); process.on('unhandledRejection', finalize);
  const originalHandle = ipcMain.handle.bind(ipcMain); ipcMain.handle = (name, action) => originalHandle(name, (...args) => { if (report.ipc.length < 2000) report.ipc.push(name); if (/^runtime:(?:chat-start|chat-enqueue|start-checked|automation-planning-start|probe)$/.test(name)) report.modelCommands++; return action(...args); });
  app.on('browser-window-created', (_event, window) => { report.windows.created++; if (!mainWindow) mainWindow = window; window.on('show', () => { report.windows.shown++; }); window.webContents.on('render-process-gone', (_event, detail) => { if (!finishing) finalize(Error('Renderer exited: ' + detail.reason)); }); });
  app.whenReady().then(() => { session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const blocked = /^https?:/i.test(details.url); if (blocked) { report.blockedRequests.push(details.url.split('?')[0]); if (/\/v1\/(?:responses|chat\/completions|images\/)/.test(details.url)) report.modelNetworkAttempts++; } callback({ cancel: blocked }); }); });
  require(path.join(owner.mirror, 'electron/main.cjs')); report.productionMainLoaded = true;
  app.whenReady().then(scenario).then(() => finalize()).catch(finalize);
} catch (error) { if (owner) finalize(error); else { process.stderr.write(String(error.stack || error)); app.exit(1); } }
