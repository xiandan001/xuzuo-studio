const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, nativeTheme, nativeImage } = require('electron');
const { Worker } = require('node:worker_threads');
const root = path.resolve(__dirname, '..'), sha = value => createHash('sha256').update(value).digest('hex'), began = Date.now();
const workspaceId = 'chat-ui-workspace', channels = [], calls = [], held = new Set();
const queueTransport = { conversationId: '', text: '', loseAck: false, blockReads: false };
const report = { passed: false, commit: process.env.GITHUB_SHA, syntheticProvider: true, actualProviderUsed: false, actualAccountCharges: 0, realRuntimeAndRenderer: true, normalApplicationStarted: false, userProfileAccessed: false, externalRequests: 0, errors: [], steps: [], screenshots: [], layouts: [], homeBounds: [], processIds: [process.pid], windows: { created: 0, shown: 0, remaining: 0 }, attachmentChecks: {} };
let owner, temporary, window, service, cpuTasks, inputFiles, production, finishing = false, slowCount = 0, importCount = 0;
const workerTasks = [];
let extendStream;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { void finish(Error('Chat studio native acceptance exceeded 120 seconds')); }, 120000);
app.on('window-all-closed', () => {});
function ordinary(file, directory = false) { const stat = fs.lstatSync(file); assert(!stat.isSymbolicLink()); assert(directory ? stat.isDirectory() : stat.isFile()); assert.equal(fs.realpathSync(file).toLowerCase(), path.resolve(file).toLowerCase()); return stat; }
function prepare() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(report.commit || '', /^[a-f0-9]{40}$/); assert(path.isAbsolute(process.argv[2] || ''));
  temporary = fs.realpathSync(process.argv[2]); assert.equal(path.dirname(temporary).toLowerCase(), fs.realpathSync(process.env.RUNNER_TEMP).toLowerCase()); assert.match(path.basename(temporary), /^xuzuo-chat-studio-[A-Za-z0-9-]+$/);
  owner = JSON.parse(fs.readFileSync(path.join(temporary, 'owner.json'), 'utf8')); assert.equal(owner.kind, 'xuzuo-chat-studio'); assert.equal(owner.commit, report.commit); assert.match(owner.nonce, /^[a-f0-9-]{36}$/); report.nonce = owner.nonce;
  assert.equal(typeof owner.localRuntime, 'boolean');
  const dependencyRoot = owner.localRuntime && fs.existsSync(path.join(root, 'work/ui-build/node_modules/vite/package.json')) ? path.join(root, 'work/ui-build/node_modules') : path.join(root, 'node_modules');
  assert.equal(owner.dependencyRoot, dependencyRoot); ordinary(dependencyRoot, true);
  process.env.NODE_PATH = dependencyRoot; require('node:module').Module._initPaths();
  report.dependencyMode = dependencyRoot === path.join(root, 'node_modules') ? 'locked-root' : 'owned-local-build-runtime';
  assert.equal(owner.dist, path.join(root, 'work/chat-studio-dist')); assert.equal(owner.output, path.join(root, 'work/chat-studio-output')); ordinary(owner.output, true); ordinary(owner.dist, true);
  for (const [name, hash] of Object.entries(owner.files)) { assert(!name.split('/').includes('..')); assert.equal(sha(fs.readFileSync(path.join(owner.dist, name))), hash); }
  for (const [name, hash] of Object.entries(owner.sources)) { assert((name === 'vite.config.ts' || name === 'assets/library/catalog.json' || /^(?:src|electron|scripts)\//.test(name)) && !name.split('/').includes('..')); assert.equal(sha(fs.readFileSync(path.join(root, name))), hash); }
  app.setName('序作聊天独立离线验收'); app.setPath('userData', path.join(temporary, 'profile')); app.setPath('sessionData', path.join(temporary, 'profile')); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-background-networking'); nativeTheme.themeSource = 'light';
}
async function finish(error) {
  if (finishing) return; finishing = true; clearTimeout(deadline); if (error) { report.errors.push(String(error.stack || error)); process.stderr.write(String(error.stack || error) + '\n'); }
  if (error && window && !window.isDestroyed()) {
    try { report.rendererDiagnostic = await evaluate(`(()=>({alerts:[...document.querySelectorAll('[role="alert"]')].slice(0,12).map(e=>e.textContent.slice(0,4096)),attachmentChips:[...document.querySelectorAll('.workspace-chat-composer .chat-attachment strong')].map(e=>e.textContent),addButton:document.querySelector('[aria-label="添加聊天附件"]')?{disabled:document.querySelector('[aria-label="添加聊天附件"]').disabled,label:document.querySelector('[aria-label="添加聊天附件"]').textContent}:null,inputLength:document.querySelector('[aria-label="聊天内容"]')?.value.length,turnCount:document.querySelectorAll('.workspace-chat-turn').length,pending:[...document.querySelectorAll('[role="status"]')].slice(0,8).map(e=>e.textContent.slice(0,500))}))()`); }
    catch (cause) { report.rendererDiagnosticError = String(cause.message || cause); }
  }
  for (const release of [...held]) release();
  try { await service?.shutdown(); } catch (cause) { report.errors.push(String(cause)); }
  try { await production?.engine.shutdown(); } catch (cause) { report.errors.push(String(cause)); }
  try { await cpuTasks?.drain(); await until(() => workerTasks.every(task => task.exited), 'attachment worker exit', 2500); } catch (cause) { report.errors.push(String(cause)); }
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)].filter(Number.isInteger))];
  for (const current of BrowserWindow.getAllWindows()) current.destroy(); for (const channel of channels) ipcMain.removeHandler(channel);
  report.windows.remaining = BrowserWindow.getAllWindows().length;
  if (report.windows.created > 1 || report.windows.shown !== 0 || report.windows.remaining || !report.errors.length && report.windows.created !== 1) report.errors.push('Expected one hidden isolated window and no residual windows');
  report.syntheticCalls = calls; report.attachmentWorkers = workerTasks; report.elapsedMs = Date.now() - began; report.passed = !report.errors.length;
  if (owner) fs.writeFileSync(path.join(temporary, 'native-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); process.stdout.write(JSON.stringify({ passed: report.passed, phase: report.phase, errors: report.errors }) + '\n'); app.exit(report.passed ? 0 : 1);
}
async function evaluate(value) { let timer; try { return await Promise.race([window.webContents.executeJavaScript(value, true), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Chat DOM call timed out')), 4000); })]); } finally { clearTimeout(timer); } }
async function until(check, label, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await delay(30); } throw Error('Chat studio timeout: ' + label); }
async function dom(value, label) { await until(() => evaluate(`Boolean(${value})`), label); }
async function click(selector, text) {
  const match = `(()=>[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&${text ? `e.textContent.trim().includes(${JSON.stringify(text)})` : 'true'}&&!e.disabled))()`;
  await dom(match, text || selector); await evaluate(`(()=>{const e=${match};e.scrollIntoView({block:'center'});e.click()})()`);
}
async function fill(value) { await dom(`document.querySelector('[aria-label="聊天内容"]')`, 'chat input'); await evaluate(`(()=>{const e=document.querySelector('[aria-label="聊天内容"]');e.scrollIntoView({block:'center'});e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); }
async function select(label, value) { await click(`[aria-label="${label}"]`); await click('[role="option"]', value); }
async function chooseScenario(name) { await click('[aria-label="选择使用场景"]'); await click(`[aria-label="使用场景 ${name}"]`); }
async function localAttachments() { await click('[aria-label="添加聊天附件"]'); await click('[aria-label="附件来源"] button', '本机文件'); }
async function step(name, action) { report.phase = name; process.stdout.write('Chat studio step: ' + name + '\n'); const start = Date.now(); await action(); report.steps.push({ name, ms: Date.now() - start }); }
async function currentConversation() {
  let conversationId; const key = 'xuzuo-disclosure-v1:workspace:' + workspaceId + ':chat-conversation';
  await until(async () => { conversationId = await evaluate('JSON.parse(localStorage.getItem(' + JSON.stringify(key) + ') || null)?.value'); return typeof conversationId === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(conversationId); }, 'actual selected conversation persisted');
  return service.read({ workspaceId, conversationId });
}
async function settled(count, status = 'complete') { await until(async () => { const value = await currentConversation(); return value.turns.length === count && value.turns.at(-1).status === status; }, `turn ${count} ${status}`); await dom(`document.querySelectorAll('.workspace-chat-turn').length===${count}&&!document.querySelector('[aria-label="停止回复"]')`, 'renderer adopted final turn'); }
function syntheticStream(body, signal) {
  const contentText = value => typeof value === 'string' ? value : (value || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n');
  const last = contentText(body.messages.at(-1).content), plan = contentText(body.messages[0].content).includes('自动化方案规划员');
  const imagePlan = plan && last.includes('附件验收');
  const isSlow = last.startsWith('队列验收首条流式') || last.startsWith('慢慢说明') && ++slowCount === 1;
  const full = plan ? JSON.stringify({ version: 1, name: imagePlan ? '橘猫参考图宣传方案' : '橘猫产品合作说明书', objective: imagePlan ? '依据本轮已提供的参考图规划完整宣传图片。' : '根据沟通制作两页完整Word说明，包含目标、工作范围和可操作安排。', outputKind: imagePlan ? 'image' : 'word', trigger: { type: 'manual' }, steps: [{ kind: imagePlan ? 'image-generation' : 'text', name: imagePlan ? '按原图制作宣传图' : '撰写完整说明正文', instruction: imagePlan ? '以本轮原图为依据，保留产品主体和可见细节，不添加未经确认的价格。' : '以橘猫角色产品为主题，整理目标、工作范围、安排和结论。' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['内容完整', '结构清楚'], constraints: ['不编造客户数据'], maxRepairs: 0, questions: [], unsupported: [] }) : last.startsWith('记住') ? '好的，这次讨论的主角是橘猫。你可以继续补充用途。' : last.startsWith('它是谁') ? '你刚才确定的主角是橘猫。' : last.startsWith('长内容') ? require('./fixtures/chat-markdown-sample.cjs').text : calls.length > 6 ? '已收到本轮实际附图或资料，附件内容已进入这次请求。' : '第一部分已经返回，第二部分也已完成。这是一份完整答复。';
  let controller, stopped = false, timer, release; const encoder = new TextEncoder();
  const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (release) held.delete(release); if (isSlow) extendStream = undefined; };
  const push = value => { if (!stopped) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); };
  const abort = () => { if (stopped) return; stopped = true; clean(); controller.error(Error('Synthetic response stopped by the real cancellation signal')); };
  const usage = { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 } };
  const done = () => { if (stopped) return; push({ choices: [{ delta: {}, finish_reason: 'stop' }] }); push({ choices: [], usage }); controller.enqueue(encoder.encode('data: [DONE]\n\n')); stopped = true; clean(); controller.close(); };
  const stream = new ReadableStream({ start(value) {
    controller = value; signal?.addEventListener('abort', abort, { once: true });
    const split = plan ? Math.floor(full.length / 2) : isSlow ? 10 : Math.max(1, Math.floor(full.length / 2));
    push({ choices: [{ delta: { content: isSlow ? '第一部分已经返回，仍在生成第二部分……' : full.slice(0, split) }, finish_reason: null }] });
    if (isSlow) { extendStream = text => push({ choices: [{ delta: { content: text }, finish_reason: null }] }); push({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } }); release = done; held.add(release); }
    else {
      const rest = () => { push({ choices: [{ delta: { content: full.slice(split) }, finish_reason: null }] }); done(); };
      if (plan) { release = rest; held.add(release); } else timer = setTimeout(rest, 140);
    }
  }, cancel() { if (!stopped) { stopped = true; clean(); } } });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': `synthetic-chat-${calls.length}` } });
}
async function initialize() {
  const inputDirectory = path.join(temporary, 'input-files'); await fsp.mkdir(inputDirectory);
  const png = nativeImage.createFromBitmap(Buffer.alloc(80 * 64 * 4, 190), { width: 80, height: 64 }).toPNG(); assert(png.length > 50);
  const text = 'TXT事实：产品名称为橘猫咖啡，售价以客户确认信息为准。\n';
  const { Document, Paragraph, Packer } = require('docx');
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('DOCX事实：本次上新主题是秋日手作；出图需保留品牌留白。')] }] }));
  inputFiles = { png: path.join(inputDirectory, 'reference-cat.png'), text: path.join(inputDirectory, 'product-facts.txt'), docx: path.join(inputDirectory, 'product-brief.docx'), pngSha256: sha(png) };
  await fsp.writeFile(inputFiles.png, png, { flag: 'wx' }); await fsp.writeFile(inputFiles.text, text, { flag: 'wx' }); await fsp.writeFile(inputFiles.docx, docx, { flag: 'wx' });
  cpuTasks = require('../electron/cpu-tasks.cjs').createCpuTasks({ createWorker: (file, options) => {
    assert.equal(file, path.join(root, 'electron/cpu-worker.cjs'));
    const worker = new Worker(path.join(root, 'scripts/fixtures/chat-cpu-worker.cjs'), { ...options, workerData: { ...options.workerData, testOwnerFile: path.join(temporary, 'owner.json'), testOwnerNonce: owner.nonce } }), task = { task: options.workerData.task, threadId: worker.threadId, exited: false, dependencyBootstrapVerified: false };
    workerTasks.push(task); worker.once('message', message => { task.dependencyBootstrapVerified = message.fixtureDependencyBootstrapVerified === true; }); worker.once('exit', code => { task.exited = true; task.exitCode = code; }); return worker;
  } });
  const connection = { id: 'chat-connection', name: '离线合成服务', providerId: 'openai', protocol: 'openai-chat', baseUrl: 'https://chat-offline.invalid/v1', enabled: true, status: 'configured' };
  const model = { id: 'chat-model', name: 'GPT-6.1 Terra · 离线夹具', modelId: 'gpt-6.1-terra', connectionId: connection.id, enabled: true, capabilities: ['text', 'vision'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '1000' } };
  const credential = { id: 'chat-metadata-key', connectionId: connection.id, name: '独立测试账户', lastFour: 'test', enabled: true, updatedAt: '2026-11-17T00:00:00.000Z' };
  production = await require('./fixtures/chat-studio-production.cjs').createFixtureProduction({ directory: path.join(temporary, 'production-data'), workspaceId, png, nativeImage, credential });
  service = require('../electron/chat-service.cjs').createChatService({ directory: path.join(temporary, 'data'), getQueuedBindings: async () => ({ connections: structuredClone([connection, production.connection]), models: structuredClone([model, production.model]), credentials: structuredClone([credential, production.credential]) }), ...require('../electron/chat-project-attachments.cjs').createChatProjectAttachments(production.artifactStore), readArtifact: production.readArtifact, readRun: id => production.engine.runDetail(id), readAsset: async input => { assert.equal(input.workspaceId, workspaceId); assert.equal(input.assetId, 'fixture-local-asset'); assert.equal(input.builtin, false); return { name: '验收本地纹理.png', mimeType: 'image/png', buffer: await fsp.readFile(inputFiles.png) }; }, extractText: file => cpuTasks.run('reference-text', { name: file.name, mimeType: file.mimeType, buffer: file.buffer }), credentialStore: { withSecret: async (id, connectionId, action) => { assert.equal(id, credential.id); assert.equal(connectionId, connection.id); return action('offline-fixture-value-not-an-api-key'); } }, fetchImpl: async (url, options) => { assert.equal(url, connection.baseUrl + '/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.stream, true); calls.push({ url, body }); return syntheticStream(body, options.signal); }, onChanged: event => { if (window && !window.isDestroyed()) window.webContents.send('chat:changed', event); } });
  const fixtureUrl = pathToFileURL(path.join(owner.dist, 'chat-studio.html')).href;
  const handle = (name, action) => { const channel = 'runtime:' + name; channels.push(channel); ipcMain.handle(channel, (event, input) => { assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame); assert.equal(event.senderFrame.url, fixtureUrl); return action(input); }); };
  for (const method of ['list', 'start', 'cancel', 'flush', 'ledger', 'search', 'manage', 'selectTarget', 'inspectTarget', 'importBytes', 'importAsset', 'importProjectArtifact', 'linkProduction', 'linkExport']) handle('chat-' + method, input => service[method](input));
  handle('chat-read', input => { if (queueTransport.blockReads && input.conversationId === queueTransport.conversationId) throw Error('独立合成故障：排队读取暂不可用'); return service.read(input); });
  handle('chat-enqueue', async input => { const value = await service.enqueue(input); if (queueTransport.loseAck && input.conversationId === queueTransport.conversationId && input.text === queueTransport.text) { queueTransport.loseAck = false; throw Error('独立合成故障：排队确认回包丢失'); } return value; });
  handle('chat-manage-queue', input => service.manageQueue(input));
  handle('chat-cancel-search', input => service.cancelSearch(input));
  handle('chat-import-attachments', input => { assert.equal(input.workspaceId, workspaceId); importCount++; return service.importAttachments({ ...input, paths: importCount === 1 ? [inputFiles.png, inputFiles.text, inputFiles.docx] : [inputFiles.text, inputFiles.docx] }); });
  handle('chat-preview-attachment', input => service.previewAttachment(input));
  handle('chat-attach-to-project', input => { assert.equal(input.projectId, production.project.id); return service.attachToProject(input); });
  handle('status', () => ({ workspaceId, project: production.project, documentProjects: production.documentProjects, artifact: production.source, configuration: { models: [model, production.model], connections: [connection, production.connection], credentials: [credential, production.credential], vaultStatus: { available: true } } }));
  handle('asset-list', () => [{ id: 'fixture-local-asset', workspaceId, name: '验收本地纹理', kind: 'image', mimeType: 'image/png', bytes: png.length }]);
  handle('list-project-artifacts', projectId => { assert([production.project, ...production.documentProjects].some(project => project.id === projectId)); return production.artifactStore.listProject(projectId); });
  handle('preview-artifact', id => production.previewArtifact(id));
  handle('run-detail', id => production.engine.runDetail(id));
  for (const [prefix, store] of [['editor', production.editorStore], ['spreadsheet', production.spreadsheetStore]]) for (const method of ['load', 'save', 'history', 'loadVersion', 'restore', 'export']) handle(`${prefix}-${method}`, input => { assert(production.documentProjects.some(project => project.id === input.projectId)); return store[method](input); });
  for (const [channel, method] of [['delivery-inspect', 'inspect'], ['delivery-history', 'history'], ['delivery-review', 'saveReview'], ['delivery-confirm', 'confirm']]) handle(channel, input => production.delivery[method](input));
  handle('preflight', input => production.engine.preflight(input));
  handle('start-checked', input => production.start(input)); handle('lookup-start', input => production.lookup(input)); handle('snapshot', () => production.engine.snapshot());
  handle('automation-planning-list', () => []);
}
async function layout(width, theme, index) {
  window.setContentSize(width, 1000); nativeTheme.themeSource = theme;
  if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天');
  await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(theme)}`, 'appearance paint'); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const value = await evaluate(`(()=>{const root=document.querySelector('.workspace-chat'),composer=document.querySelector('.workspace-chat-composer'),thread=document.querySelector('.workspace-chat-scroll'),content=document.querySelector('.app-content');thread.scrollTop=thread.scrollHeight;const r=n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {width:innerWidth,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,root:r(root),composer:r(composer),content:r(content),thread:r(thread),threadScroll:thread.scrollTop,threadMaximum:thread.scrollHeight-thread.clientHeight,threadOverflow:getComputedStyle(thread).overflowY,foreground:getComputedStyle(composer).color,background:getComputedStyle(composer).backgroundColor,userBackground:getComputedStyle(document.querySelector('.workspace-chat-message.is-user .workspace-chat-bubble')).backgroundColor,assistantBackground:getComputedStyle(document.querySelector('.workspace-chat-message.is-assistant .workspace-chat-bubble')).backgroundColor,fields:[...composer.querySelectorAll('[role="combobox"],textarea')].map(e=>({name:e.getAttribute('aria-label'),...r(e)}))}})()`);
  const detail = JSON.stringify(value); assert.equal(value.width, width, detail); assert.equal(value.theme, theme, detail); assert(value.documentWidth <= width + 1 && value.bodyWidth <= width + 1, 'Page horizontal overflow: ' + detail); assert(value.root.left >= value.content.left - 1 && value.root.right <= value.content.right + 1, detail);
  assert(value.fields.every(field => field.width > 30 && field.left >= value.composer.left - 1 && field.right <= value.composer.right + 1), 'Composer field overflow: ' + detail); assert.notEqual(value.userBackground, value.assistantBackground, 'Sender bubbles must be visually distinct'); assert(['auto', 'scroll'].includes(value.threadOverflow)); assert(value.threadMaximum > 20 && value.threadScroll >= value.threadMaximum - 1, 'Long conversation must remain scrollable');
  const luminance = css => { const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(number => number / 255).map(number => number <= .04045 ? number / 12.92 : ((number + .055) / 1.055) ** 2.4); return rgb.reduce((sum, number, position) => sum + number * [.2126, .7152, .0722][position], 0); };
  const fg = luminance(value.foreground), bg = luminance(value.background); value.contrast = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); assert(value.contrast >= 4.5, detail);
  await evaluate(`document.querySelector('[aria-label="发送聊天消息"]').scrollIntoView({block:'nearest'})`);
  const button = await evaluate(`(()=>{const e=document.querySelector('[aria-label="发送聊天消息"]'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===e||e.contains(hit)),footer:document.querySelector('.statusbar').getBoundingClientRect().top}})()`); assert(button.reachable && button.top >= 0 && button.bottom <= button.footer + 1, JSON.stringify(button)); value.sendButton = button;
  value.passed = true; report.layouts.push(value); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); window.webContents.invalidate(); await delay(100); const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), bytes = image.toPNG(); assert(bytes.length > 5000); const filename = `${index}-chat-${theme}-${width}.png`; await fsp.writeFile(path.join(owner.output, filename), bytes, { flag: 'wx' }); report.screenshots.push({ filename, bytes: bytes.length, ...image.getSize(), sha256: sha(bytes) });
}
async function composerPosition(label, baseline) {
  const value = await evaluate(`(()=>{const composer=document.querySelector('.workspace-chat-composer'),scroller=document.querySelector('.workspace-chat-scroll'),content=document.querySelector('.app-content');
    const bounds=e=>{const {left,top,right,bottom}=e.getBoundingClientRect();return {left,top,right,bottom}};
    return {viewport:[innerWidth,innerHeight],composer:bounds(composer),scroller:bounds(scroller),content:bounds(content),outerScroll:content.scrollTop,
      outerMaximum:content.scrollHeight-content.clientHeight,scrollTop:scroller.scrollTop,scrollMaximum:scroller.scrollHeight-scroller.clientHeight};})()`);
  const detail = label + ' ' + JSON.stringify(value);
  (report.composerPositions ||= []).push({ label, ...value });
  assert(value.composer.bottom <= value.content.bottom + 1 && value.composer.bottom >= value.content.bottom - 40, 'Composer must dock at the workspace bottom: ' + detail);
  assert(value.scroller.bottom <= value.composer.top + 1 && value.scroller.top >= value.content.top - 1, 'Messages must scroll above the composer: ' + detail);
  assert(value.outerScroll <= 1 && value.outerMaximum <= 1, 'The workspace must not scroll during a conversation: ' + detail);
  if (baseline) for (const edge of ['left','right','bottom']) assert(Math.abs(value.composer[edge] - baseline.composer[edge]) <= 1, 'Composer moved at ' + edge + ': ' + detail);
  return value;
}
async function sendFromDock() {
  await dom(`document.querySelector('[aria-label="发送聊天消息"]:not(:disabled)')`, 'conversation is ready to send');
  const point = await evaluate(`(()=>{
    const button = document.querySelector('[aria-label="发送聊天消息"]'), r = button.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return { x, y, reachable: !button.disabled && button.contains(document.elementFromPoint(x, y)) };
  })()`);
  assert(point.reachable, 'Send must already be reachable without scrolling the composer');
  for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
async function checkStreamingScroll(anchor) {
  const append = async (text, marker) => {
    await delay(150); // Allow the production 100 ms stream notification interval to elapse.
    extendStream(text);
    await dom(`document.querySelector('.workspace-chat-thread').textContent.includes(${JSON.stringify(marker)})`, marker);
  };
  const scroll = "document.querySelector('.workspace-chat-scroll')";
  await append('\n\n' + '自然增长的回复段落。\n\n'.repeat(36) + '滚动样本甲', '滚动样本甲');
  await until(async () => {
    report.tailFollow = await evaluate(`(()=>{const e=${scroll};return {top:e.scrollTop,max:e.scrollHeight-e.clientHeight,visibility:document.visibilityState}})()`);
    return report.tailFollow.max > 200 && Math.abs(report.tailFollow.max - report.tailFollow.top) <= 2;
  }, 'stream follows the new bottom');
  const following = await composerPosition('long-stream-following', anchor);
  assert(Math.abs(following.composer.top - anchor.composer.top) <= 1, 'Streaming text must not change composer height');
  // Scrolling is native compositor input. The DOM can already report the new
  // scroll range while a hidden CI window still has the previous hit-test map.
  window.webContents.focus();
  window.webContents.invalidate();
  const frame = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  assert(!frame.isEmpty(), 'A committed compositor frame is required for the wheel gesture');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const point = await evaluate(`(()=>{const e=${scroll},r=e.getBoundingClientRect();
    window.chatHistoryWheels=[];
    e.addEventListener('wheel',event=>window.chatHistoryWheels.push({trusted:event.isTrusted,deltaY:event.deltaY,target:event.target.tagName}),{capture:true,passive:true,signal:(window.chatWheelListener=new AbortController()).signal});
    const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
    return {x,y,reachable:e.contains(document.elementFromPoint(x,y))};})()`);
  assert(point.reachable, 'Message area must receive a real wheel gesture');
  const wheelSample = () => evaluate(`(()=>{const e=${scroll};return {events:window.chatHistoryWheels,pageUp:window.chatHistoryPageUp===true,top:e.scrollTop,max:e.scrollHeight-e.clientHeight}})()`);
  report.historyWheel = { point, before: following.scrollTop, samples: [] };
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  for (let i = 0; i < 3; i++) {
    window.webContents.sendInputEvent({ type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: 450, canScroll: true });
    await delay(100);
    const sample = await wheelSample(); report.historyWheel.samples.push(sample);
    if (sample.events.some(event => event.trusted && event.deltaY < 0) && sample.top < following.scrollTop - 9) break;
  }
  const keyboardAfter = Date.now() + 1200;
  await until(async () => {
    const sample = await wheelSample(); report.historyWheel.last = sample;
    const wheeled = sample.events.some(event => event.trusted && event.deltaY < 0);
    if ((wheeled || sample.pageUp) && sample.top < following.scrollTop - 9) {
      report.historyWheel.readGesture = sample.pageUp ? 'page-up' : 'wheel';
      return true;
    }
    // Some headless window servers do not deliver wheel events at all. In that
    // case verify the user's other native reading path through the focusable region.
    if (!sample.events.length && !report.historyWheel.requestedPageUp && Date.now() >= keyboardAfter) {
      const focused = await evaluate(`(()=>{const e=${scroll};e.addEventListener('keydown',event=>{
        window.chatHistoryPageUp=event.isTrusted&&event.key==='PageUp'&&event.target===e
      },{once:true});e.focus({preventScroll:true});return document.activeElement===e})()`);
      assert(focused, 'The actual message scroll region must be keyboard-focusable');
      report.historyWheel.requestedPageUp = true;
      for (const type of ['keyDown','keyUp']) window.webContents.sendInputEvent({ type, keyCode: 'PageUp' });
    }
    return false;
  }, 'trusted reader input scrolls back from the latest response');
  await evaluate('window.chatWheelListener.abort()');
  // End the Chromium wheel animation at a known reading position; its duration
  // differs between hidden and visible windows. Wait for the actual scroll event.
  await evaluate(`(()=>{const e=${scroll};window.chatReadingPosition=e.scrollTop<=1;const onScroll=()=>{if(e.scrollTop<=1){window.chatReadingPosition=true;e.removeEventListener('scroll',onScroll)}};e.addEventListener('scroll',onScroll);e.scrollTo({top:0,behavior:'instant'});})()`);
  await dom('window.chatReadingPosition', 'actual scroller settled on the older messages');
  const reading = await composerPosition('reading-history', anchor);
  await append('\n\n' + '继续返回的新段落。\n\n'.repeat(15) + '滚动样本乙', '滚动样本乙');
  await dom(`${scroll}.scrollHeight-${scroll}.clientHeight>${reading.scrollMaximum}`, 'renderer committed more content above the pinned composer');
  const after = await composerPosition('stream-while-reading', anchor);
  assert(after.scrollMaximum > reading.scrollMaximum && Math.abs(after.scrollTop - reading.scrollTop) <= 1, 'New chunks must retain the manual history scroll position');
  assert(Math.abs(after.composer.top - anchor.composer.top) <= 1, 'Reading older messages must not move the composer');
}
async function settleOverviewBounds(width, theme) {
  let previous;
  await until(async () => {
    const current = await evaluate(`(()=>{if(innerWidth!==${width}||document.documentElement.dataset.appTheme!==${JSON.stringify(theme)})return null;const nodes=['.workspace-chat','.workspace-chat-composer','.conversation-recent','.conversation-home','.app-content'].map(selector=>document.querySelector(selector));if(nodes.some(node=>!node))return null;return JSON.stringify(nodes.map(node=>{const r=node.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom,r.width,r.height]}))})()`);
    const stable = current !== null && current === previous; previous = current; return stable;
  }, 'stable actual Overview geometry', 4000);
}
async function homeBounds(width, height, theme, state) {
  window.setContentSize(width, height); nativeTheme.themeSource = theme;
  if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天');
  await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(theme)}&&document.querySelectorAll('.conversation-recent-work').length===3`, 'real Overview with recent works');
  await settleOverviewBounds(width, theme);
  const value = await evaluate(`(()=>{const chat=document.querySelector('.workspace-chat'),composer=document.querySelector('.workspace-chat-composer'),recent=document.querySelector('.conversation-recent'),overview=document.querySelector('.conversation-home'),content=document.querySelector('.app-content');content.scrollTop=0;const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.appTheme,chat:r(chat),composer:r(composer),recent:r(recent),overview:r(overview),content:r(content),gap:parseFloat(getComputedStyle(overview).rowGap),documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}})()`);
  value.state = state; const detail = JSON.stringify(value);
  const anchor = await composerPosition('matrix-' + state + '-' + width + '-' + height + '-' + theme);
  assert(value.documentWidth <= width + 1 && value.bodyWidth <= width + 1, 'Overview horizontal overflow: ' + detail);
  assert(value.composer.left >= value.chat.left - 1 && value.composer.right <= value.chat.right + 1, 'Composer exceeds chat width: ' + detail);
  assert(value.composer.bottom <= value.chat.bottom + 1, 'Composer spills below its chat section: ' + detail);
  assert(await evaluate("document.querySelector('.workspace-chat-scroll').contains(document.querySelector('.conversation-recent'))"), 'Recent works must share the independent conversation scroll area');
  value.recentHits = [];
  for (let index = 0; index < 3; index++) {
    await evaluate(`document.querySelectorAll('.conversation-recent-work')[${index}].scrollIntoView({block:'center'})`);
    const hit = await evaluate(`(()=>{const e=document.querySelectorAll('.conversation-recent-work')[${index}],r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),scroll=document.querySelector('.workspace-chat-scroll').getBoundingClientRect();return {reachable:!!hit&&(hit===e||e.contains(hit)),top:r.top,bottom:r.bottom,contentTop:scroll.top,contentBottom:scroll.bottom}})()`);
    assert(hit.reachable && hit.top >= hit.contentTop - 1 && hit.bottom <= hit.contentBottom + 1, 'Recent work is covered or unreachable: ' + JSON.stringify(hit)); value.recentHits.push(hit);
  }
  await click('.conversation-recent-work');
  assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.lastNavigation`), 'project:fixture-recent-1', 'Recent card must invoke the real Overview navigation');
  await evaluate(`document.querySelector('[aria-label="发送聊天消息"]').scrollIntoView({block:'nearest'})`);
  await composerPosition('after-recent-navigation', anchor);
  value.sendReachable = await evaluate(`(()=>{const e=document.querySelector('[aria-label="发送聊天消息"]'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===e||e.contains(hit))&&r.top>=document.querySelector('.app-content').getBoundingClientRect().top-1&&r.bottom<=document.querySelector('.statusbar').getBoundingClientRect().top+1})()`);
  assert(value.sendReachable, 'Send action must remain reachable'); value.passed = true; report.homeBounds.push(value);
}
async function overviewBoundaries(state) {
  const count = calls.length, [originalWidth, originalHeight] = window.getContentSize();
  const originalViewport = await evaluate('({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.appTheme})'), originalTheme = originalViewport.theme;
  await click('[aria-label="切换最近作品测试数据"]'); await chooseScenario('宣传图');
  await evaluate(`document.querySelector('[aria-label="聊天内容"]').style.height='220px'`);
  for (const [width, height] of [[1440, 900], [1120, 760], [1280, 720], [960, 640]]) for (const theme of ['light', 'dark']) await homeBounds(width, height, theme, state);
  await evaluate(`document.querySelector('[aria-label="聊天内容"]').style.height=''`);
  await click('[aria-label="切换最近作品测试数据"]'); await dom(`!document.querySelector('.conversation-recent')`, 'return to no-project fixture');
  await chooseScenario('自由聊天'); assert.equal(calls.length, count, 'Layout checks must not send model requests');
  nativeTheme.themeSource = originalTheme;
  if (await evaluate('document.documentElement.dataset.appTheme') !== originalTheme) await click('button', originalTheme === 'dark' ? '切到黑夜' : '切到白天');
  await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(originalTheme)}`, 'restore appearance after Overview boundaries');
  const restoration = { before: originalViewport, nativeOriginal: { width: originalWidth, height: originalHeight }, attempts: [] };
  (report.homeBoundsRestorations ||= []).push(restoration);
  let nativeWidth = originalWidth, nativeHeight = originalHeight;
  for (let attempt = 0; attempt < 4; attempt++) {
    window.setContentSize(nativeWidth, nativeHeight);
    let actual;
    await until(async () => {
      actual = await evaluate('({width:innerWidth,height:innerHeight})');
      // Ignore the previous window size while Chromium handles the native resize.
      return Math.abs(actual.width - nativeWidth) <= 2 && Math.abs(actual.height - nativeHeight) <= 2;
    }, 'renderer adopted requested native size', 4000);
    restoration.attempts.push({ requested: { width: nativeWidth, height: nativeHeight }, actual });
    if (actual.width === originalViewport.width && actual.height === originalViewport.height) { restoration.passed = true; break; }
    nativeWidth += originalViewport.width - actual.width; nativeHeight += originalViewport.height - actual.height;
  }
  assert.equal(restoration.passed, true, 'Restore the exact original renderer viewport: ' + JSON.stringify(restoration));
}
async function scenario() {
  await dom(`document.querySelector('[aria-label="聊天内容"]')&&!document.querySelector('.workspace-chat-working')`, 'empty usable chat');
  await step('real-overview-empty-state-bounds-with-recent-works', () => overviewBoundaries('empty'));
  await step('no-project-normal-chat-and-reasoning-selection', async () => {
    assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0'); assert.equal(await evaluate(`!!document.querySelector('[aria-label="对话Key"]')`), false);
    const bindingBefore = await evaluate(`localStorage.getItem('xuzuo-chat-model-v1:${workspaceId}')`);
    assert.equal(await evaluate(`!!document.querySelector('.conversation-model-dialog')`), false);
    await click('[aria-label="模型与账户详情"]'); await dom(`document.querySelector('.conversation-model-dialog .conversation-account-summary')`, 'optional account details opened before sending');
    assert.equal(await evaluate(`document.querySelector('.conversation-account-summary>span')?.firstChild?.textContent.trim()`), '独立测试账户');
    assert.equal(await evaluate(`document.querySelector('.conversation-account-summary small')?.textContent.trim()`), '••••test');
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="对话Key"]')`), false, 'A single known account needs no redundant Key chooser');
    await click('[aria-label="关闭模型与账户详情"]'); await dom(`!document.querySelector('.conversation-model-dialog')`, 'account details closed before normal chat');
    assert.equal(await evaluate(`localStorage.getItem('xuzuo-chat-model-v1:${workspaceId}')`), bindingBefore); assert.equal(calls.length, 0); report.accountDetailsBeforeSendVerified = true;
    const textareaSize = () => evaluate(`(()=>{const e=document.querySelector('[aria-label="聊天内容"]'),s=getComputedStyle(e);return {height:e.getBoundingClientRect().height,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,overflow:s.overflowY,fontSize:s.fontSize,valueLength:e.value.length,inlineHeight:e.style.height,minHeight:s.minHeight,boxSizing:s.boxSizing,padding:s.padding,lineHeight:s.lineHeight}})()`);
    const emptySize = await textareaSize(), emptyAnchor = await composerPosition('empty-input'); await fill('仅验证输入框自然增长，不发送消息。\n'.repeat(40));
    await dom(`(()=>{const e=document.querySelector('[aria-label="聊天内容"]');return e.getBoundingClientRect().height>${emptySize.height + 20}&&e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==='auto'})()`, 'long draft grows to a bounded scrollable input');
    const longSize = await textareaSize(); await composerPosition('multiline-draft', emptyAnchor); assert(longSize.height <= 201 && longSize.height > emptySize.height + 20); assert.equal(longSize.fontSize, emptySize.fontSize); assert.equal(window.webContents.getZoomFactor(), 1);
    report.composerClearMeasurement = { empty: emptySize, long: longSize };
    await fill(''); await until(async () => {
      const sample = await textareaSize(); report.composerClearMeasurement.afterClear = sample;
      return sample.valueLength === 0 && sample.height <= emptySize.height + 1 && sample.scrollTop === 0 && sample.overflow === 'hidden';
    }, 'clearing the draft restores the compact input');
    assert.equal(calls.length, 0); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0');
    await composerPosition('cleared-draft', emptyAnchor);
    report.composerSizing = { boundedNaturalGrowth: true, clearsToCompact: true, noCallsOrProjects: true, pageZoomFactor: window.webContents.getZoomFactor(), empty: emptySize, long: longSize, cleared: await textareaSize() };
    await select('推理强度', '轻度'); await fill('记住：这次讨论的主角是橘猫。'); const firstAnchor = await composerPosition('before-first-send'); await sendFromDock(); await settled(1); await composerPosition('first-completed', firstAnchor); assert.equal(calls.length, 1); assert.equal(calls[0].body.reasoning_effort, 'low'); assert.equal(calls[0].body.messages[0].role, 'system'); assert(calls[0].body.messages[0].content.includes('不把每条消息强行变成自动化方案'));
    await select('推理强度', '深入'); await fill('它是谁？请用一句话回答。'); await click('[aria-label="发送聊天消息"]'); await settled(2); assert.equal(calls[1].body.reasoning_effort, 'high'); assert(calls[1].body.messages.some(message => message.role === 'assistant' && message.content.includes('橘猫'))); assert.equal(calls[1].body.messages.filter(message => message.role === 'user').length, 2);
    const value = await currentConversation(); assert.equal(value.turns[1].reasoningEffort, 'high'); assert(value.turns.every(turn => turn.costState === 'calculated' && turn.costCents > 0)); assert(value.turns.every(turn => turn.modelConfigId === 'chat-model' && turn.credentialId === 'chat-metadata-key')); assert(calls.every(call => call.body.model === 'gpt-6.1-terra')); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0'); report.noProjectChat = report.reasoningBodyVerified = report.multiTurnContextVerified = true;
  });
  await step('visible-partial-stream-stop-and-new-billed-retry', async () => {
    const before = await service.ledger(workspaceId); await fill('慢慢说明可爱微信红包封面的三个风格，先给我第一部分。'); await click('[aria-label="发送聊天消息"]'); await dom(`document.querySelector('.workspace-chat-thread>div:last-child .chat-reply-text')?.textContent.includes('第一部分已经返回')&&document.querySelector('[aria-label="停止回复"]')`, 'partial text rendered while stream remains active');
    assert.equal((await currentConversation()).turns.at(-1).status, 'running'); report.partialStreamDisplayed = true; const anchor = await composerPosition('short-stream'); await checkStreamingScroll(anchor); await click('[aria-label="停止回复"]'); await settled(3, 'cancelled'); await composerPosition('cancelled', anchor); const cancelled = await currentConversation(), priorId = cancelled.turns.at(-1).id;
    for (const row of before) assert.deepEqual((await service.ledger(workspaceId)).find(item => item.id === row.id), row); const cancelledLedger = await service.ledger(workspaceId); assert.equal(cancelledLedger.length, 3);
    await click('.workspace-chat-message-actions button', '重新回答'); await settled(4); const retried = await currentConversation(); assert.equal(retried.turns.at(-1).sourceTurnId, priorId); assert.equal(calls.length, 4); for (const row of cancelledLedger) assert.deepEqual((await service.ledger(workspaceId)).find(item => item.id === row.id), row); assert.equal((await service.ledger(workspaceId)).length, 4); report.stopAndRetryPreserveCosts = true;
  });
  await step('chat-to-validated-plan-before-folder-selection', async () => {
    const before = calls.length, quoted = (await currentConversation()).turns.at(-1), draft = '转制作前已经写下的独立要求'; await fill(draft); await click('.workspace-chat-thread>div:last-child .workspace-chat-message-actions button', '转为制作方案');
    await dom(`document.querySelector('[aria-label="选择使用场景"]')?.textContent.includes('微信红包封面')`, 'free chat selects the red packet cover scenario');
    const combined = await evaluate(`document.querySelector('[aria-label="聊天内容"]').value`);
    assert(combined.includes(quoted.userText)); assert(combined.includes(quoted.text)); assert(combined.endsWith(draft));
    assert.equal(calls.length, before); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0');
    await chooseScenario('Word 文档'); await fill('把刚才的想法整理为两页Word说明，包含目标与步骤。'); await click('[aria-label="发送聊天消息"]'); await until(() => held.size > 0 && calls.length === before + 1, 'held partial plan response'); await dom(`document.querySelector('.workspace-chat-working')?.textContent.includes('完整校验')`, 'plan partial hidden behind validation state'); assert.equal(await evaluate(`document.querySelectorAll('.home-plan-primary button').length`), 0); assert.equal((await currentConversation()).turns.at(-1).plan, undefined);
    const planContent = calls.at(-1).body.messages.at(-1).content, planText = typeof planContent === 'string' ? planContent : planContent.filter(item => item.type === 'text').map(item => item.text).join('\n'); assert(!JSON.stringify(calls.at(-1).body.messages).includes(quoted.text)); assert(planText.includes('把刚才的想法整理为两页Word说明')); report.planReferencePreservesDraft = true;
    for (const release of [...held]) release(); await settled(5); await dom(`document.querySelector('.home-plan h3')?.textContent==='橘猫产品合作说明书'`, 'complete plan visible without a project'); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0'); assert.equal((await currentConversation()).turns.at(-1).plan.outputKind, 'word'); report.planValidatedBeforeDisplay = true;
    await click('.home-plan-primary .btn-primary'); await dom(`document.querySelector('.chat-fixture').dataset.folderRequests==='1'`, 'only explicit production asks for a folder'); assert.equal(calls.length, before + 1); report.deferredProjectSelection = true;
  });
  await step('long-content-theme-width-scroll-and-sender-distinction', async () => {
    await chooseScenario('自由聊天'); await fill('长内容：请提供一份包含表格与代码的完整说明。'); await click('[aria-label="发送聊天消息"]'); await settled(6); await dom(`document.querySelector('.workspace-chat-thread>div:last-child pre code')`, 'actual long code rendering');
    let index = 0; for (const width of [1440, 960]) for (const theme of ['light', 'dark']) await layout(width, theme, ++index); report.renderMetrics = app.getAppMetrics().map(item => ({ type: item.type, cpu: item.cpu, memory: item.memory }));
  });
  await step('real-overview-history-bounds-with-recent-works', () => overviewBoundaries('history'));
  report.originalSyntheticPostCount = calls.length; assert.equal(report.originalSyntheticPostCount, 6);
  await step('scenario-choice-does-not-send-or-create-projects', async () => {
    const posts = calls.length, folders = await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`);
    await click('[aria-label="选择使用场景"]'); await dom(`document.querySelector('[aria-label="搜索使用场景"]')`, 'custom scenario search');
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="搜索使用场景"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'看图');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await dom(`document.querySelectorAll('[aria-label="可用场景"] .chat-scenario-choice').length===1`, 'scenario search filters choices');
    await click('[aria-label="使用场景 看图问答"]'); await dom(`!document.querySelector('[aria-label="搜索使用场景"]')&&document.querySelector('[aria-label="选择使用场景"]')?.textContent.includes('看图问答')`, 'selected scenario visible');
    assert.equal(calls.length, posts); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), folders); report.attachmentChecks.scenarioChoiceIsLocal = true;
  });
  await step('import-real-files-preview-remove-and-send-image-only', async () => {
    const posts = calls.length; await fill(''); await localAttachments();
    await dom(`document.querySelector('[aria-label="本轮附件"]')?.children.length===3`, 'three genuine files imported'); assert.equal(importCount, 1); assert.equal(calls.length, posts);
    for (const [filename, expected] of [['reference-cat.png', 'image'], ['product-facts.txt', 'TXT事实'], ['product-brief.docx', '秋日手作']]) {
      await click(`.workspace-chat-composer [title="预览 ${filename}"]`);
      await dom(`document.querySelector('[aria-label=${JSON.stringify('附件预览 ' + filename)}]')`, 'attachment preview dialog');
      if (expected === 'image') await dom(`document.querySelector('.chat-attachment-preview img')?.naturalWidth===80`, 'actual PNG preview decoded');
      else await dom(`document.querySelector('.chat-attachment-preview pre')?.textContent.includes(${JSON.stringify(expected)})`, 'actual attachment text preview');
      await click('[aria-label="关闭附件预览"]');
    }
    assert.equal(calls.length, posts); await click('[aria-label="移除附件 product-facts.txt"]'); await click('[aria-label="移除附件 product-brief.docx"]');
    await dom(`document.querySelector('[aria-label="本轮附件"]')?.children.length===1`, 'non-image attachments removed'); assert.equal(calls.length, posts);
    assert.equal(await evaluate(`document.querySelector('[aria-label="聊天内容"]').value`), '');
    await click('[aria-label="发送聊天消息"]'); await settled(7); assert.equal(calls.length, posts + 1);
    const current = await currentConversation(), image = current.turns.at(-1).attachments?.[0]; assert.equal(current.turns.at(-1).attachments.length, 1); assert.equal(image.name, 'reference-cat.png'); assert.equal(image.sha256, inputFiles.pngSha256);
    const parts = calls.at(-1).body.messages.at(-1).content; assert(Array.isArray(parts)); const payload = parts.find(part => part.type === 'image_url')?.image_url?.url;
    assert(payload?.startsWith('data:image/png;base64,')); assert.equal(sha(Buffer.from(payload.split(',')[1], 'base64')), inputFiles.pngSha256);
    assert.equal(await evaluate(`document.querySelectorAll('.workspace-chat-composer .chat-attachment').length`), 0);
    assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '1');
    assert(workerTasks.some(task => task.task === 'reference-text' && task.dependencyBootstrapVerified)); Object.assign(report.attachmentChecks, { localImportUsesRealFiles: true, previewReadsRealBytes: true, removeDoesNotSend: true, attachmentOnlySend: true, imageBytesReachProvider: true, officeReadUsesWorker: true });
    report.imageAttachment = { id: image.id, name: image.name, sha256: image.sha256, bytes: image.bytes };
  });
  await step('image-chat-to-plan-retains-actual-reference', async () => {
    const posts = calls.length; await click('.workspace-chat-thread>div:last-child .workspace-chat-message-actions button', '转为制作方案'); await chooseScenario('宣传图');
    await fill('附件验收：请按刚才的参考图规划一张产品宣传图，保留原图产品细节。'); await click('[aria-label="发送聊天消息"]'); await until(() => held.size > 0 && calls.length === posts + 1, 'held image plan response');
    const content = calls.at(-1).body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []), imageParts = content.filter(part => part.type === 'image_url');
    assert(imageParts.some(part => sha(Buffer.from(part.image_url.url.split(',')[1], 'base64')) === inputFiles.pngSha256));
    for (const release of [...held]) release(); await settled(8); const current = await currentConversation(); assert.equal(current.turns.at(-1).plan.outputKind, 'image'); assert(current.turns.at(-1).contextAttachments.some(file => file.id === report.imageAttachment.id));
    await dom(`document.querySelector('.home-plan h3')?.textContent==='橘猫参考图宣传方案'`, 'image plan visible with retained reference');
    assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '1'); report.attachmentChecks.chatToPlanKeepsImage = true;
  });
  await step('office-and-text-attachments-reach-provider-as-real-body-text', async () => {
    await click('[aria-label="选择使用场景"]'); await click('[aria-label="使用场景 资料解读"]'); await fill(''); await localAttachments();
    await dom(`document.querySelector('[aria-label="本轮附件"]')?.children.length===2`, 'text and office references selected'); assert.equal(importCount, 2);
    const before = calls.length; await click('[aria-label="发送聊天消息"]'); await settled(9); assert.equal(calls.length, before + 1);
    const parts = calls.at(-1).body.messages.at(-1).content, text = typeof parts === 'string' ? parts : parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert(text.includes('TXT事实：产品名称为橘猫咖啡')); assert(text.includes('DOCX事实：本次上新主题是秋日手作')); assert(text.includes('product-facts.txt') && text.includes('product-brief.docx'));
    const current = await currentConversation(); assert.deepEqual(current.turns.at(-1).attachments.map(file => file.name).sort(), ['product-brief.docx', 'product-facts.txt']); report.attachmentChecks.officeAndTextReachProvider = true;
  });
  await step('reload-real-preload-and-history-without-resend', async () => {
    const before = await service.ledger(workspaceId), count = calls.length, value = await currentConversation(); await window.reload(); await dom(`document.querySelectorAll('.workspace-chat-turn').length===9&&!document.querySelector('[aria-label="停止回复"]')`, 'history restored through actual preload'); assert.equal(calls.length, count); assert.deepEqual(await service.ledger(workspaceId), before); const restored = await currentConversation(); assert.equal(restored.id, value.id); assert.deepEqual(restored.turns[6].attachments, value.turns[6].attachments); assert.deepEqual(restored.turns[7].contextAttachments, value.turns[7].contextAttachments); assert.deepEqual(restored.turns[8].attachments, value.turns[8].attachments);
    assert.equal(await evaluate(`document.querySelector('[aria-label="推理强度"]')?.textContent.includes('深入')`), true); assert.equal(await evaluate(`document.querySelector('[aria-label="选择使用场景"]')?.textContent.includes('资料解读')`), true);
    await click('.workspace-chat-thread>div:last-child [title="预览 product-brief.docx"]'); await dom(`document.querySelector('.chat-attachment-preview pre')?.textContent.includes('秋日手作')`, 'sent office reference still readable after reload'); await click('[aria-label="关闭附件预览"]');
    assert.equal(calls.length, count); report.historyReloadKeepsLedger = true; report.attachmentChecks.historyReloadKeepsReferences = true;
  });
  assert.equal(Object.keys(require.cache).some(file => file === path.join(root, 'electron/main.cjs')), false); report.fakePostCount = calls.length; report.attachmentSyntheticPostCount = calls.length - report.originalSyntheticPostCount; assert.equal(report.fakePostCount, 9); assert.equal(report.attachmentSyntheticPostCount, 3);
  report.dataDirectories = await fsp.readdir(path.join(temporary, 'data')); assert.deepEqual(report.dataDirectories, ['chat-v1']);
  await require('./fixtures/chat-studio-new-features.cjs').verifyNewChatFeatures({ service, workspaceId, production, inputFiles, calls, report, evaluate, dom, click, fill, select, chooseScenario, until, step, reload: async () => { window.reload(); }, viewport: async (width, theme) => { window.setContentSize(width, 1000); nativeTheme.themeSource = theme; if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天'); await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(theme)}`, 'favorite scene appearance paint'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); } });
  assert.equal(calls.length, 9); report.refinementSyntheticPostCount = production.calls.length;
  await require('./fixtures/chat-markdown-acceptance.cjs').verifyMarkdownReply({ service, workspaceId, calls, report, evaluate, click, dom, step });
  assert.equal(calls.length, 9);
  await require('./fixtures/chat-studio-queue.cjs').verifyChatQueue({ service, workspaceId, calls, held, report, evaluate, dom, click, fill, select, chooseScenario, until, step, currentConversation, inputFiles, outputDirectory: owner.output,
    composerPosition, sendFromDock,
    armLostQueueAck({ conversationId, text }) { Object.assign(queueTransport, { conversationId, text, loseAck: true, blockReads: true }); },
    restoreQueueReads() { queueTransport.blockReads = false; },
    reload: async () => { window.reload(); },
    viewport: async (width, theme) => { window.setContentSize(width, 1000); nativeTheme.themeSource = theme; if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天'); await dom('document.documentElement.dataset.appTheme===' + JSON.stringify(theme), 'queue appearance paint'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); },
    capture: async () => { window.webContents.invalidate(); await delay(100); const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); return { buffer: image.toPNG(), ...image.getSize() }; },
  });
  assert.equal(report.baselineSyntheticPostCount, 9); assert.equal(report.queueSyntheticPostCount, 2); assert.equal(calls.length, 11); assert.equal(report.fakePostCount, 11);
}
async function run() {
  prepare(); await app.whenReady(); await initialize();
  window = new BrowserWindow({ show: false, frame: false, skipTaskbar: true, width: 1024, height: 720, useContentSize: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); report.windows.created++;
  window.on('show', () => { report.windows.shown++; void finish(Error('Offline chat acceptance must remain hidden')); }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-redirect', event => event.preventDefault()); window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith(pathToFileURL(owner.dist + path.sep).href) || details.url.startsWith('data:image/'); if (!allowed) report.externalRequests++; callback({ cancel: !allowed }); });
  await window.loadFile(path.join(owner.dist, 'chat-studio.html')); report.processIds.push(window.webContents.getOSProcessId()); await scenario(); await finish();
}
process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); }); run().catch(error => { void finish(error); });
