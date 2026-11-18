const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function verifyChatQueue(ctx) {
  const { service, workspaceId, calls, held, report, evaluate, dom, click, fill, select, chooseScenario, until, step, reload, viewport, capture, outputDirectory, inputFiles, armLostQueueAck, restoreQueueReads } = ctx;
  for (const action of [evaluate, dom, click, fill, select, chooseScenario, until, step, reload, viewport, capture, armLostQueueAck, restoreQueueReads, ctx.currentConversation]) assert.equal(typeof action, 'function');
  assert(path.isAbsolute(outputDirectory)); assert.equal(held.size, 0, 'Earlier fixtures must finish their streams first');
  const baseline = calls.length; assert.equal(baseline, 9, 'Keep the original nine transport requests as a separate baseline');
  const original = await ctx.currentConversation(), originalFees = await service.ledger(workspaceId), folderCount = await evaluate("document.querySelector('.chat-fixture').dataset.folderRequests");
  assert.equal(await evaluate("document.querySelector('.workspace-chat-header h2').textContent"), original.title);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-chat-turn-id]')].map(node=>node.dataset.chatTurnId)"), original.turns.map(turn => turn.id));
  const initialText = '队列验收首条流式：请保持这段回复直到本场景明确放行。';
  const beforeEdit = '队列验收待发A：此要求需要在保存修改后再发送。';
  const editedText = '队列验收待发A：明确保存后的要求，保留本轮真实资料。';
  let identity, pendingId, attachmentSnapshots;
  report.queueLayouts = []; report.queueScreenshots = [];
  const read = () => service.read({ workspaceId, conversationId: identity });
  async function fillEdit(text) {
    await evaluate("(()=>{const e=document.querySelector('[aria-label=\"修改待发要求\"]');if(!e)throw Error('Queue edit field unavailable');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e," + JSON.stringify(text) + ");e.dispatchEvent(new Event('input',{bubbles:true}))})()");
  }
  async function screenshot(width, theme, filename) {
    await viewport(width, theme);
    const value = await evaluate("(()=>{const composer=document.querySelector('.workspace-chat-composer'),r=composer.getBoundingClientRect(),fields=[...composer.querySelectorAll('[role=\"combobox\"],textarea')].map(e=>{const b=e.getBoundingClientRect();return {name:e.getAttribute('aria-label'),left:b.left,right:b.right,width:b.width}});const sample=document.createElement('span');document.body.appendChild(sample);const token=name=>{sample.style.backgroundColor='var('+name+')';return getComputedStyle(sample).backgroundColor},tokens={accent:token('--ui-accent'),surface:token('--ui-surface'),subtle:token('--ui-surface-subtle')};sample.remove();const bg=selector=>getComputedStyle(document.querySelector(selector)).backgroundColor,edit=getComputedStyle(document.querySelector('[aria-label=\"修改待发要求\"]'));return {width:innerWidth,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,composer:{left:r.left,right:r.right},fields,paint:{tokens,primary:bg('.chat-queue-edit .btn-primary'),secondary:bg('.chat-queue-edit .btn-secondary'),scenario:bg('.chat-scenario-trigger'),attachment:bg('.workspace-chat-attachment-add'),editBackground:edit.backgroundColor,editBorder:edit.borderTopStyle,editBorderWidth:edit.borderTopWidth,editFont:edit.fontSize,dpr:devicePixelRatio,reduceMotion:document.documentElement.dataset.reduceMotion}}})()");
    assert.equal(value.width, width); assert.equal(value.theme, theme); assert(value.documentWidth <= width + 1);
    assert.equal(value.paint.reduceMotion, 'true'); assert.equal(value.paint.primary, value.paint.tokens.accent); assert.equal(value.paint.secondary, value.paint.tokens.surface); assert.equal(value.paint.scenario, value.paint.tokens.subtle); assert.equal(value.paint.attachment, value.paint.tokens.subtle);
    assert.equal(value.paint.editBackground, value.paint.tokens.surface); assert.equal(value.paint.editBorder, 'solid'); assert.equal(value.paint.editFont, '13px');
    const borderCss = Number.parseFloat(value.paint.editBorderWidth), dpr = value.paint.dpr, deviceBorder = borderCss * dpr;
    assert(Number.isFinite(borderCss) && borderCss > 0 && Number.isFinite(dpr) && dpr > 0);
    // Chromium snaps the authored 1px border to device pixels, with a one-device-pixel minimum.
    assert(deviceBorder >= 1 - 0.01 && deviceBorder >= Math.max(1, Math.floor(dpr)) - 0.01 && deviceBorder <= Math.max(1, dpr) + 0.01, 'Queue editor border must remain a visible DPR-quantized 1px rule: ' + JSON.stringify(value.paint));
    if (theme === 'dark') assert.equal(value.paint.tokens.accent, 'rgb(29, 155, 240)');
    assert(value.fields.every(field => field.width > 30 && field.left >= value.composer.left - 1 && field.right <= value.composer.right + 1), 'Queue inputs must stay inside the composer: ' + JSON.stringify(value));
    const result = await capture(), buffer = Buffer.from(result.buffer); assert(buffer.length > 5000); assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    const actualWidth = buffer.readUInt32BE(16), actualHeight = buffer.readUInt32BE(20); assert.equal(result.width, actualWidth); assert.equal(result.height, actualHeight);
    await fs.writeFile(path.join(outputDirectory, filename), buffer, { flag: 'wx' });
    report.queueLayouts.push({ ...value, passed: true }); report.queueScreenshots.push({ filename, bytes: buffer.length, width: actualWidth, height: actualHeight, sha256: sha(buffer) });
  }
  await step('queued-follow-up-unknown-ack-reload-and-free-lookup', async () => {
    await click('button', '新对话'); await chooseScenario('自由聊天'); await select('推理强度', '轻度');
    await fill(initialText); await click('[aria-label="发送聊天消息"]');
    await until(() => calls.length === baseline + 1 && held.size === 1, 'dedicated queued conversation holds one real synthetic SSE');
    identity = (await ctx.currentConversation()).id; assert.notEqual(identity, original.id);
    await dom("document.querySelector('[aria-label=\"停止回复\"]')&&document.querySelectorAll('.workspace-chat-turn').length===1", 'first queued scenario turn is visible');
    await select('推理强度', '深入'); await click('[aria-label="添加聊天附件"]'); await click('[aria-label="附件来源"] button', '本机文件');
    await dom("document.querySelector('[aria-label=\"本轮附件\"]')?.children.length===2", 'queued references are imported as actual files');
    armLostQueueAck({ conversationId: identity, text: beforeEdit });
    await fill(beforeEdit); await click('[aria-label="排队发送消息"]');
    await dom("document.querySelector('.chat-queue-pending')?.textContent.includes('上次排队结果尚未确认')", 'lost enqueue acknowledgement is visible without resend');
    const pending = await read(); assert.equal(pending.queue.length, 1); pendingId = pending.queue[0].id; attachmentSnapshots = pending.queue[0].attachments;
    assert.equal(pending.queue[0].text, beforeEdit); assert.equal(pending.queue[0].reasoningEffort, 'high'); assert.equal(pending.queue[0].modelConfigId, pending.turns[0].modelConfigId); assert.equal(pending.queue[0].credentialId, pending.turns[0].credentialId);
    assert.deepEqual(attachmentSnapshots.map(file => file.name).sort(), ['product-brief.docx', 'product-facts.txt']);
    const expected = new Map([['product-brief.docx', inputFiles.docx], ['product-facts.txt', inputFiles.text]]);
    for (const item of attachmentSnapshots) { const buffer = await fs.readFile(expected.get(item.name)); assert.equal(item.bytes, buffer.length); assert.equal(item.sha256, sha(buffer)); }
    assert.equal(calls.length, baseline + 1); assert.equal((await service.ledger(workspaceId)).length, originalFees.length + 1);
    restoreQueueReads(); await reload();
    await dom("document.querySelector('.chat-queue-pending')&&document.querySelector('[data-queue-id=" + JSON.stringify(pendingId) + "]')", 'renderer reload restores queue and unknown submission ID');
    assert.equal(calls.length, baseline + 1); await click('button', '读取排队状态');
    await dom("!document.querySelector('.chat-queue-pending')&&document.querySelector('[data-queue-id=" + JSON.stringify(pendingId) + "]')", 'free lookup resolves the existing enqueue receipt');
    assert.equal(calls.length, baseline + 1);
  });
  await step('queue-edit-withdraw-snapshots-and-two-theme-layouts', async () => {
    await click('[aria-label=' + JSON.stringify('编辑待发消息 ' + pendingId) + ']'); await dom("document.querySelector('[aria-label=\"修改待发要求\"]')", 'editing reserves this pending request before changing text');
    await fillEdit(editedText); await select('推理强度', '轻度');
    const withdrawnText = '队列验收B：这条只用于验证发送前撤回。';
    await fill(withdrawnText); await click('[aria-label="排队发送消息"]');
    let current;
    await until(async () => {
      current = await read(); const candidate = current.queue?.find(item => item.id !== pendingId && item.text === withdrawnText);
      report.queueFollowupCommit = { expectedText: withdrawnText, queue: (current.queue || []).map(item => ({ id: item.id, text: item.text, status: item.status, editing: !!item.editing })), modelCalls: calls.length };
      return current.queue?.length === 2 && !!candidate && await evaluate("!!document.querySelector('[data-queue-id=" + JSON.stringify(candidate.id) + "]')");
    }, 'second enqueue committed to its actual queue and renderer before withdrawal', 4000);
    assert.equal(current.queue.length, 2); const withdrawn = current.queue.find(item => item.id !== pendingId); assert(withdrawn);
    await click('[aria-label=' + JSON.stringify('撤回待发消息 ' + withdrawn.id) + ']');
    await until(async () => { current = await read(); return current.queue?.length === 1 && !current.queue.some(item => item.id === withdrawn.id); }, 'withdrawal committed to the actual persisted queue');
    await dom("!document.querySelector('[data-queue-id=" + JSON.stringify(withdrawn.id) + "]')", 'withdrawn entry removed from the actual renderer');
    assert.equal(current.queue.length, 1); assert.equal(calls.length, baseline + 1);
    await screenshot(1440, 'light', '5-chat-queue-light-1440.png'); await screenshot(960, 'dark', '6-chat-queue-dark-960.png');
    await reload(); await dom("document.querySelector('[aria-label=\"修改待发要求\"]')?.value===" + JSON.stringify(editedText), 'editing draft and paused queue survive a renderer reload');
    assert.equal((await read()).queue[0].reasoningEffort, 'high'); assert.equal(calls.length, baseline + 1);
    for (const release of [...held]) release();
    await until(async () => (await read()).turns[0].status === 'complete', 'first response completes while the next request is still reserved for editing');
    await dom("!document.querySelector('[aria-label=\"停止回复\"]')", 'first response completion reached actual renderer');
    assert.equal(calls.length, baseline + 1); assert.equal((await read()).queue[0].editing, true);
    await click('button', '保存修改');
    await until(async () => { const record = await read(); return calls.length === baseline + 2 && record.turns.length === 2 && record.turns[1].status === 'complete' && !record.queue?.length; }, 'only the explicitly saved queued request is dispatched once');
    const record = await read(), body = calls.at(-1).body, content = body.messages.at(-1).content;
    const text = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert(text.includes(editedText)); assert(text.includes('TXT事实：产品名称为橘猫咖啡')); assert(text.includes('DOCX事实：本次上新主题是秋日手作')); assert.equal(body.reasoning_effort, 'high');
    assert.equal(record.turns[0].reasoningEffort, 'low'); assert.equal(record.turns[1].reasoningEffort, 'high'); assert.deepEqual(record.turns[1].attachments, attachmentSnapshots);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"推理强度\"]').textContent.includes('轻度')"), true);
    const fees = await service.ledger(workspaceId); assert.equal(fees.length, originalFees.length + 2);
    for (const entry of originalFees) assert.deepEqual(fees.find(item => item.id === entry.id), entry);
    assert.equal(await evaluate("document.querySelector('.chat-fixture').dataset.folderRequests"), folderCount);
  });
  await step('saved-results-remain-under-their-real-originating-turn', async () => {
    await click('[aria-label="聊天历史"]'); await click('.chat-history-open', original.title);
    await dom("document.querySelectorAll('.workspace-chat-turn').length===" + original.turns.length, 'the actual original conversation is reopened');
    const origins = [...new Set([...(original.exports || []).map(link => link.turnId), ...(original.productions || []).map(link => link.sourceTurnId).filter(Boolean)])]; assert(origins.length > 0);
    for (const turnId of origins) await dom("(()=>{const e=[...document.querySelectorAll('[data-chat-turn-id]')].find(node=>node.dataset.chatTurnId===" + JSON.stringify(turnId) + ");return !!e?.querySelector('.chat-turn-results')})()", 'saved files/results belong to their actual source turn');
    assert.equal(calls.length, baseline + 2); assert.equal(await evaluate("document.querySelector('.chat-fixture').dataset.folderRequests"), folderCount);
  });
  report.baselineSyntheticPostCount = baseline; report.queueSyntheticPostCount = calls.length - baseline; report.totalSyntheticPostCount = calls.length; report.fakePostCount = calls.length;
  report.queueChecks = { serialDispatch: true, snapshotModelAccountReasoningAndActualReferences: true, editReservesUntilSaved: true, withdrawBeforeDispatchHasNoCall: true, lostAckResolvedByFreeRead: true, rendererReloadRetainsQueueAndEditDraft: true, priorFeesRetained: true, noForcedProjectCreation: true, resultsAttachedToSourceTurn: true };
  assert.equal(report.queueSyntheticPostCount, 2); assert.equal(report.totalSyntheticPostCount, 11); assert.equal(report.queueLayouts.length, 2); assert.equal(report.queueScreenshots.length, 2);
}
module.exports = { verifyChatQueue };
