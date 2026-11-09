const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const root = path.resolve(__dirname, '..'), sha = value => createHash('sha256').update(value).digest('hex'), began = Date.now();
const workspaceId = 'chat-ui-workspace', channels = [], calls = [], held = new Set();
const report = { passed: false, commit: process.env.GITHUB_SHA, syntheticProvider: true, actualProviderUsed: false, actualAccountCharges: 0, realRuntimeAndRenderer: true, normalApplicationStarted: false, userProfileAccessed: false, externalRequests: 0, errors: [], steps: [], screenshots: [], layouts: [], homeBounds: [], processIds: [process.pid], windows: { created: 0, shown: 0, remaining: 0 } };
let owner, temporary, window, service, finishing = false, slowCount = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { void finish(Error('Chat studio native acceptance exceeded 120 seconds')); }, 120000);
app.on('window-all-closed', () => {});
function ordinary(file, directory = false) { const stat = fs.lstatSync(file); assert(!stat.isSymbolicLink()); assert(directory ? stat.isDirectory() : stat.isFile()); assert.equal(fs.realpathSync(file).toLowerCase(), path.resolve(file).toLowerCase()); return stat; }
function prepare() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(report.commit || '', /^[a-f0-9]{40}$/); assert(path.isAbsolute(process.argv[2] || ''));
  temporary = fs.realpathSync(process.argv[2]); assert.equal(path.dirname(temporary).toLowerCase(), fs.realpathSync(process.env.RUNNER_TEMP).toLowerCase()); assert.match(path.basename(temporary), /^xuzuo-chat-studio-[A-Za-z0-9-]+$/);
  owner = JSON.parse(fs.readFileSync(path.join(temporary, 'owner.json'), 'utf8')); assert.equal(owner.kind, 'xuzuo-chat-studio'); assert.equal(owner.commit, report.commit); assert.match(owner.nonce, /^[a-f0-9-]{36}$/); report.nonce = owner.nonce;
  assert.equal(owner.dist, path.join(root, 'work/chat-studio-dist')); assert.equal(owner.output, path.join(root, 'work/chat-studio-output')); ordinary(owner.output, true); ordinary(owner.dist, true);
  for (const [name, hash] of Object.entries(owner.files)) { assert(!name.split('/').includes('..')); assert.equal(sha(fs.readFileSync(path.join(owner.dist, name))), hash); }
  for (const [name, hash] of Object.entries(owner.sources)) { assert(/^(?:src|electron|scripts)\//.test(name) && !name.split('/').includes('..')); assert.equal(sha(fs.readFileSync(path.join(root, name))), hash); }
  app.setName('序作聊天独立离线验收'); app.setPath('userData', path.join(temporary, 'profile')); app.setPath('sessionData', path.join(temporary, 'profile')); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-background-networking'); nativeTheme.themeSource = 'light';
}
async function finish(error) {
  if (finishing) return; finishing = true; clearTimeout(deadline); if (error) { report.errors.push(String(error.stack || error)); process.stderr.write(String(error.stack || error) + '\n'); }
  for (const release of [...held]) release();
  try { await service?.shutdown(); } catch (cause) { report.errors.push(String(cause)); }
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)].filter(Number.isInteger))];
  for (const current of BrowserWindow.getAllWindows()) current.destroy(); for (const channel of channels) ipcMain.removeHandler(channel);
  report.windows.remaining = BrowserWindow.getAllWindows().length; if (report.windows.created !== 1 || report.windows.shown !== 0 || report.windows.remaining) report.errors.push('Expected one hidden isolated window and no residual windows');
  report.syntheticCalls = calls; report.elapsedMs = Date.now() - began; report.passed = !report.errors.length;
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
async function step(name, action) { report.phase = name; process.stdout.write('Chat studio step: ' + name + '\n'); const start = Date.now(); await action(); report.steps.push({ name, ms: Date.now() - start }); }
async function currentConversation() { let items; await until(async () => { items = await service.list(workspaceId); return items.length > 0; }, 'conversation index created'); return service.read({ workspaceId, conversationId: items[0].id }); }
async function settled(count, status = 'complete') { await until(async () => { const value = await currentConversation(); return value.turns.length === count && value.turns.at(-1).status === status; }, `turn ${count} ${status}`); await dom(`document.querySelectorAll('.workspace-chat-turn').length===${count}&&!document.querySelector('[aria-label="停止回复"]')`, 'renderer adopted final turn'); }
function syntheticStream(body, signal) {
  const last = body.messages.at(-1).content, plan = body.messages[0].content.includes('自动化方案规划员');
  const isSlow = last.startsWith('慢慢说明') && ++slowCount === 1;
  const full = plan ? JSON.stringify({ version: 1, name: '橘猫产品合作说明书', objective: '根据沟通制作两页完整Word说明，包含目标、工作范围和可操作安排。', outputKind: 'word', trigger: { type: 'manual' }, steps: [{ kind: 'text', name: '撰写完整说明正文', instruction: '以橘猫角色产品为主题，整理目标、工作范围、安排和结论。' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['正文完整', '结构清楚'], constraints: ['不编造客户数据'], maxRepairs: 0, questions: [], unsupported: [] }) : last.startsWith('记住') ? '好的，这次讨论的主角是橘猫。你可以继续补充用途。' : last.startsWith('它是谁') ? '你刚才确定的主角是橘猫。' : last.startsWith('长内容') ? `# 完整说明\n\n这是用于布局验收的长内容。\n\n${'橘猫创作需要清楚目标、动作、受众和交付尺寸。'.repeat(70)}\n\n| 类别 | 内容 |\n| --- | --- |\n| 角色 | 橘猫 |\n\n\`\`\`text\n${'LONG_UNBROKEN_TOKEN_'.repeat(40)}\n\`\`\`` : '第一部分已经返回，第二部分也已完成。这是一份完整答复。';
  let controller, stopped = false, timer, release; const encoder = new TextEncoder();
  const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (release) held.delete(release); };
  const push = value => { if (!stopped) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); };
  const abort = () => { if (stopped) return; stopped = true; clean(); controller.error(Error('Synthetic response stopped by the real cancellation signal')); };
  const usage = { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 } };
  const done = () => { if (stopped) return; push({ choices: [{ delta: {}, finish_reason: 'stop' }] }); push({ choices: [], usage }); controller.enqueue(encoder.encode('data: [DONE]\n\n')); stopped = true; clean(); controller.close(); };
  const stream = new ReadableStream({ start(value) {
    controller = value; signal?.addEventListener('abort', abort, { once: true });
    const split = plan ? Math.floor(full.length / 2) : isSlow ? 10 : Math.max(1, Math.floor(full.length / 2));
    push({ choices: [{ delta: { content: isSlow ? '第一部分已经返回，仍在生成第二部分……' : full.slice(0, split) }, finish_reason: null }] });
    if (isSlow) { push({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } }); release = done; held.add(release); }
    else {
      const rest = () => { push({ choices: [{ delta: { content: full.slice(split) }, finish_reason: null }] }); done(); };
      if (plan) { release = rest; held.add(release); } else timer = setTimeout(rest, 140);
    }
  }, cancel() { if (!stopped) { stopped = true; clean(); } } });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': `synthetic-chat-${calls.length}` } });
}
async function initialize() {
  const connection = { id: 'chat-connection', name: '离线合成服务', providerId: 'openai', protocol: 'openai-chat', baseUrl: 'https://chat-offline.invalid/v1', enabled: true, status: 'configured' };
  const model = { id: 'chat-model', name: 'GPT-6.1 Terra · 离线夹具', modelId: 'gpt-6.1-terra', connectionId: connection.id, enabled: true, capabilities: ['text', 'vision'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '1000' } };
  const credential = { id: 'chat-metadata-key', connectionId: connection.id, name: '独立测试账户', lastFour: 'test', enabled: true, updatedAt: '' };
  service = require('../electron/chat-service.cjs').createChatService({ directory: path.join(temporary, 'data'), credentialStore: { withSecret: async (id, connectionId, action) => { assert.equal(id, credential.id); assert.equal(connectionId, connection.id); return action('offline-fixture-value-not-an-api-key'); } }, fetchImpl: async (url, options) => { assert.equal(url, connection.baseUrl + '/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.stream, true); calls.push({ url, body }); return syntheticStream(body, options.signal); }, onChanged: event => { if (window && !window.isDestroyed()) window.webContents.send('chat:changed', event); } });
  const fixtureUrl = pathToFileURL(path.join(owner.dist, 'chat-studio.html')).href;
  const handle = (name, action) => { const channel = 'runtime:' + name; channels.push(channel); ipcMain.handle(channel, (event, input) => { assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame); assert.equal(event.senderFrame.url, fixtureUrl); return action(input); }); };
  for (const method of ['list', 'read', 'start', 'cancel', 'ledger']) handle('chat-' + method, input => service[method](input));
  handle('status', () => ({ workspaceId, configuration: { models: [model], connections: [connection], credentials: [credential], vaultStatus: { available: true } } }));
  handle('automation-planning-list', () => []);
}
async function layout(width, theme, index) {
  window.setContentSize(width, 1000); nativeTheme.themeSource = theme;
  if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天');
  await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(theme)}`, 'appearance paint'); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const value = await evaluate(`(()=>{const root=document.querySelector('.workspace-chat'),composer=document.querySelector('.workspace-chat-composer'),thread=document.querySelector('.workspace-chat-thread'),content=document.querySelector('.app-content');content.scrollTop=content.scrollHeight;thread.scrollTop=thread.scrollHeight;const r=n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {width:innerWidth,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,root:r(root),composer:r(composer),content:r(content),thread:r(thread),threadScroll:thread.scrollTop,threadMaximum:thread.scrollHeight-thread.clientHeight,threadOverflow:getComputedStyle(thread).overflowY,foreground:getComputedStyle(composer).color,background:getComputedStyle(composer).backgroundColor,userBackground:getComputedStyle(document.querySelector('.workspace-chat-message.is-user .workspace-chat-bubble')).backgroundColor,assistantBackground:getComputedStyle(document.querySelector('.workspace-chat-message.is-assistant .workspace-chat-bubble')).backgroundColor,fields:[...composer.querySelectorAll('[role="combobox"],textarea')].map(e=>({name:e.getAttribute('aria-label'),...r(e)}))}})()`);
  const detail = JSON.stringify(value); assert.equal(value.width, width, detail); assert.equal(value.theme, theme, detail); assert(value.documentWidth <= width + 1 && value.bodyWidth <= width + 1, 'Page horizontal overflow: ' + detail); assert(value.root.left >= value.content.left - 1 && value.root.right <= value.content.right + 1, detail);
  assert(value.fields.every(field => field.width > 30 && field.left >= value.composer.left - 1 && field.right <= value.composer.right + 1), 'Composer field overflow: ' + detail); assert.notEqual(value.userBackground, value.assistantBackground, 'Sender bubbles must be visually distinct'); assert(['auto', 'scroll'].includes(value.threadOverflow)); assert(value.threadMaximum > 20 && value.threadScroll >= value.threadMaximum - 1, 'Long conversation must remain scrollable');
  const luminance = css => { const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(number => number / 255).map(number => number <= .04045 ? number / 12.92 : ((number + .055) / 1.055) ** 2.4); return rgb.reduce((sum, number, position) => sum + number * [.2126, .7152, .0722][position], 0); };
  const fg = luminance(value.foreground), bg = luminance(value.background); value.contrast = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); assert(value.contrast >= 4.5, detail);
  await evaluate(`document.querySelector('[aria-label="发送聊天消息"]').scrollIntoView({block:'nearest'})`);
  const button = await evaluate(`(()=>{const e=document.querySelector('[aria-label="发送聊天消息"]'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===e||e.contains(hit)),footer:document.querySelector('.statusbar').getBoundingClientRect().top}})()`); assert(button.reachable && button.top >= 0 && button.bottom <= button.footer + 1, JSON.stringify(button)); value.sendButton = button;
  value.passed = true; report.layouts.push(value); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); window.webContents.invalidate(); await delay(100); const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), bytes = image.toPNG(); assert(bytes.length > 5000); const filename = `${index}-chat-${theme}-${width}.png`; await fsp.writeFile(path.join(owner.output, filename), bytes, { flag: 'wx' }); report.screenshots.push({ filename, bytes: bytes.length, ...image.getSize(), sha256: sha(bytes) });
}
async function homeBounds(width, height, theme, state) {
  window.setContentSize(width, height); nativeTheme.themeSource = theme;
  if (await evaluate('document.documentElement.dataset.appTheme') !== theme) await click('button', theme === 'dark' ? '切到黑夜' : '切到白天');
  await dom(`document.documentElement.dataset.appTheme===${JSON.stringify(theme)}&&document.querySelectorAll('.conversation-recent-work').length===3`, 'real Overview with recent works');
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const value = await evaluate(`(()=>{const chat=document.querySelector('.workspace-chat'),composer=document.querySelector('.workspace-chat-composer'),recent=document.querySelector('.conversation-recent'),overview=document.querySelector('.conversation-home'),content=document.querySelector('.app-content');content.scrollTop=0;const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.appTheme,chat:r(chat),composer:r(composer),recent:r(recent),overview:r(overview),content:r(content),gap:parseFloat(getComputedStyle(overview).rowGap),documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}})()`);
  value.state = state; const detail = JSON.stringify(value);
  assert(value.documentWidth <= width + 1 && value.bodyWidth <= width + 1, 'Overview horizontal overflow: ' + detail);
  assert(value.composer.left >= value.chat.left - 1 && value.composer.right <= value.chat.right + 1, 'Composer exceeds chat width: ' + detail);
  assert(value.composer.bottom <= value.chat.bottom + 1, 'Composer spills below its chat section: ' + detail);
  assert(value.recent.top >= value.chat.bottom + value.gap - 1, 'Composer/chat overlaps the recent works: ' + detail);
  assert(value.recent.bottom <= value.overview.bottom + 1, 'Recent works spill below Overview: ' + detail);
  value.recentHits = [];
  for (let index = 0; index < 3; index++) {
    await evaluate(`document.querySelectorAll('.conversation-recent-work')[${index}].scrollIntoView({block:'center'})`);
    const hit = await evaluate(`(()=>{const e=document.querySelectorAll('.conversation-recent-work')[${index}],r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),content=document.querySelector('.app-content').getBoundingClientRect();return {reachable:!!hit&&(hit===e||e.contains(hit)),top:r.top,bottom:r.bottom,contentTop:content.top,contentBottom:content.bottom}})()`);
    assert(hit.reachable && hit.top >= hit.contentTop - 1 && hit.bottom <= hit.contentBottom + 1, 'Recent work is covered or unreachable: ' + JSON.stringify(hit)); value.recentHits.push(hit);
  }
  await click('.conversation-recent-work');
  assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.lastNavigation`), 'images:fixture-recent-1', 'Recent card must invoke the real Overview navigation');
  await evaluate(`document.querySelector('[aria-label="发送聊天消息"]').scrollIntoView({block:'nearest'})`);
  value.sendReachable = await evaluate(`(()=>{const e=document.querySelector('[aria-label="发送聊天消息"]'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===e||e.contains(hit))&&r.top>=document.querySelector('.app-content').getBoundingClientRect().top-1&&r.bottom<=document.querySelector('.statusbar').getBoundingClientRect().top+1})()`);
  assert(value.sendReachable, 'Send action must remain reachable'); value.passed = true; report.homeBounds.push(value);
}
async function overviewBoundaries(state) {
  const count = calls.length;
  await click('[aria-label="切换最近作品测试数据"]'); await click('.workspace-chat-modes button', '制作');
  await evaluate(`document.querySelector('[aria-label="聊天内容"]').style.height='220px'`);
  for (const [width, height] of [[1440, 900], [1120, 760], [1280, 720], [960, 640]]) for (const theme of ['light', 'dark']) await homeBounds(width, height, theme, state);
  await evaluate(`document.querySelector('[aria-label="聊天内容"]').style.height=''`);
  await click('[aria-label="切换最近作品测试数据"]'); await dom(`!document.querySelector('.conversation-recent')`, 'return to no-project fixture');
  await click('.workspace-chat-modes button', '聊天'); assert.equal(calls.length, count, 'Layout checks must not send model requests');
}
async function scenario() {
  await dom(`document.querySelector('[aria-label="聊天内容"]')&&!document.querySelector('.workspace-chat-working')`, 'empty usable chat');
  await step('real-overview-empty-state-bounds-with-recent-works', () => overviewBoundaries('empty'));
  await step('no-project-normal-chat-and-reasoning-selection', async () => {
    assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0'); assert.equal(await evaluate(`!!document.querySelector('[aria-label="对话Key"]')`), false); assert.equal(await evaluate(`document.querySelector('.conversation-account-summary')?.textContent.trim()`), '独立测试账户');
    await select('推理强度', '轻度'); await fill('记住：这次讨论的主角是橘猫。'); await click('[aria-label="发送聊天消息"]'); await settled(1); assert.equal(calls.length, 1); assert.equal(calls[0].body.reasoning_effort, 'low'); assert.equal(calls[0].body.messages[0].role, 'system'); assert(calls[0].body.messages[0].content.includes('不把每条消息强行变成自动化方案'));
    await select('推理强度', '深入'); await fill('它是谁？请用一句话回答。'); await click('[aria-label="发送聊天消息"]'); await settled(2); assert.equal(calls[1].body.reasoning_effort, 'high'); assert(calls[1].body.messages.some(message => message.role === 'assistant' && message.content.includes('橘猫'))); assert.equal(calls[1].body.messages.filter(message => message.role === 'user').length, 2);
    const value = await currentConversation(); assert.equal(value.turns[1].reasoningEffort, 'high'); assert(value.turns.every(turn => turn.costState === 'calculated' && turn.costCents > 0)); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0'); report.noProjectChat = report.reasoningBodyVerified = report.multiTurnContextVerified = true;
  });
  await step('visible-partial-stream-stop-and-new-billed-retry', async () => {
    const before = await service.ledger(workspaceId); await fill('慢慢说明三个风格，先给我第一部分。'); await click('[aria-label="发送聊天消息"]'); await dom(`document.querySelector('.workspace-chat-thread>div:last-child .chat-reply-text')?.textContent.includes('第一部分已经返回')&&document.querySelector('[aria-label="停止回复"]')`, 'partial text rendered while stream remains active');
    assert.equal((await currentConversation()).turns.at(-1).status, 'running'); report.partialStreamDisplayed = true; await click('[aria-label="停止回复"]'); await settled(3, 'cancelled'); const cancelled = await currentConversation(), priorId = cancelled.turns.at(-1).id;
    for (const row of before) assert.deepEqual((await service.ledger(workspaceId)).find(item => item.id === row.id), row); const cancelledLedger = await service.ledger(workspaceId); assert.equal(cancelledLedger.length, 3);
    await click('.workspace-chat-message-actions button', '重新回答'); await settled(4); const retried = await currentConversation(); assert.equal(retried.turns.at(-1).sourceTurnId, priorId); assert.equal(calls.length, 4); for (const row of cancelledLedger) assert.deepEqual((await service.ledger(workspaceId)).find(item => item.id === row.id), row); assert.equal((await service.ledger(workspaceId)).length, 4); report.stopAndRetryPreserveCosts = true;
  });
  await step('chat-to-validated-plan-before-folder-selection', async () => {
    const before = calls.length; await click('.workspace-chat-thread>div:last-child .workspace-chat-message-actions button', '转为制作方案'); await dom(`document.querySelector('.workspace-chat-modes button[aria-pressed="true"]')?.textContent.includes('制作')`, 'chat converted to plan input'); assert.equal(calls.length, before); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0');
    await click('.workspace-chat-formats button', 'Word'); await fill('把刚才的想法整理为两页Word说明，包含目标与步骤。'); await click('[aria-label="发送聊天消息"]'); await until(() => held.size > 0 && calls.length === before + 1, 'held partial plan response'); await dom(`document.querySelector('.workspace-chat-working')?.textContent.includes('完整校验')`, 'plan partial hidden behind validation state'); assert.equal(await evaluate(`document.querySelectorAll('.home-plan-primary button').length`), 0); assert.equal((await currentConversation()).turns.at(-1).plan, undefined);
    for (const release of [...held]) release(); await settled(5); await dom(`document.querySelector('.home-plan h3')?.textContent==='橘猫产品合作说明书'`, 'complete plan visible without a project'); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), '0'); assert.equal((await currentConversation()).turns.at(-1).plan.outputKind, 'word'); report.planValidatedBeforeDisplay = true;
    await click('.home-plan-primary .btn-primary'); await dom(`document.querySelector('.chat-fixture').dataset.folderRequests==='1'`, 'only explicit production asks for a folder'); assert.equal(calls.length, before + 1); report.deferredProjectSelection = true;
  });
  await step('long-content-theme-width-scroll-and-sender-distinction', async () => {
    await click('.workspace-chat-modes button', '聊天'); await fill('长内容：请提供一份包含表格与代码的完整说明。'); await click('[aria-label="发送聊天消息"]'); await settled(6); await dom(`document.querySelector('.workspace-chat-thread>div:last-child pre code')`, 'actual long code rendering');
    let index = 0; for (const width of [1440, 960]) for (const theme of ['light', 'dark']) await layout(width, theme, ++index); report.renderMetrics = app.getAppMetrics().map(item => ({ type: item.type, cpu: item.cpu, memory: item.memory }));
  });
  await step('real-overview-history-bounds-with-recent-works', () => overviewBoundaries('history'));
  await step('reload-real-preload-and-history-without-resend', async () => {
    const before = await service.ledger(workspaceId), count = calls.length, value = await currentConversation(); await window.reload(); await dom(`document.querySelectorAll('.workspace-chat-turn').length===6&&!document.querySelector('[aria-label="停止回复"]')`, 'history restored through actual preload'); assert.equal(calls.length, count); assert.deepEqual(await service.ledger(workspaceId), before); assert.equal((await currentConversation()).id, value.id); assert.equal(await evaluate(`document.querySelector('[aria-label="推理强度"]')?.textContent.includes('深入')`), true); report.historyReloadKeepsLedger = true;
  });
  assert.equal(Object.keys(require.cache).some(file => file === path.join(root, 'electron/main.cjs')), false); report.fakePostCount = calls.length;
  report.dataDirectories = await fsp.readdir(path.join(temporary, 'data')); assert.deepEqual(report.dataDirectories, ['chat-v1']);
}
async function run() {
  prepare(); await app.whenReady(); await initialize();
  window = new BrowserWindow({ show: false, frame: false, skipTaskbar: true, width: 1440, height: 1000, useContentSize: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); report.windows.created++;
  window.on('show', () => { report.windows.shown++; void finish(Error('Offline chat acceptance must remain hidden')); }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-redirect', event => event.preventDefault()); window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith(pathToFileURL(owner.dist + path.sep).href) || details.url.startsWith('data:image/'); if (!allowed) report.externalRequests++; callback({ cancel: !allowed }); });
  await window.loadFile(path.join(owner.dist, 'chat-studio.html')); report.processIds.push(window.webContents.getOSProcessId()); await scenario(); await finish();
}
process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); }); run().catch(error => { void finish(error); });
