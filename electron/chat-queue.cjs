const { randomUUID, createHash } = require('node:crypto');
const { validPublicMetadata } = require('./chat-attachments.cjs');
const { changedQueuedBinding } = require('./chat-queue-binding.cjs');
const { isDeepStrictEqual } = require('node:util');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const statuses = new Set(['queued', 'starting', 'paused', 'unknown']);
const LIMIT = 20;
function queueEntriesValid(entries, scope, checkedStart) {
  if (entries === undefined) return true;
  if (!Array.isArray(entries) || entries.length > LIMIT || new Set(entries.map(item => item?.id)).size !== entries.length) return false;
  return entries.every(item => {
    if (!item || !validId(item.id) || !validId(item._sessionId) || !statuses.has(item.status) || !validDate(item.createdAt) || !validDate(item.updatedAt) || item.sceneName !== undefined && (typeof item.sceneName !== 'string' || item.sceneName.length > 120) || item.error !== undefined && (typeof item.error !== 'string' || item.error.length > 2000) || !Array.isArray(item.attachments) || item.attachments.length > 8 || item.attachments.some(file => !validPublicMetadata(file))) return false;
    try {
      if (item._needsAccount !== undefined && item._needsAccount !== true || item._needsAccount && !['paused', 'unknown'].includes(item.status)) return false;
      const request = checkedStart(item._needsAccount ? { ...item._request, credentialId: 'restored-account' } : item._request);
      if (item._needsAccount) delete request.credentialId;
      return request.id === item.id && request.workspaceId === scope.workspaceId && request.conversationId === scope.conversationId && isDeepStrictEqual(request, item._request) && JSON.stringify(request.attachmentIds || []) === JSON.stringify(item.attachments.map(file => file.id));
    } catch { return false; }
  });
}
function publicQueue(entries = []) {
  return entries.map(item => ({ id: item.id, text: item._request.text, ...(item._request.requestText ? { requestText: item._request.requestText } : {}), ...(item.sceneName ? { sceneName: item.sceneName } : {}), modelName: item._request.model.name, modelConfigId: item._request.model.id, ...(item._request.credentialId ? { credentialId: item._request.credentialId } : {}), ...(item._needsAccount || item._requiresRebind ? { needsAccount: true } : {}), ...(item._editing ? { editing: true } : {}), reasoningEffort: item._request.reasoningEffort, mode: item._request.mode, ...(item._request.outputKind ? { outputKind: item._request.outputKind } : {}), attachments: structuredClone(item.attachments), status: item.status, ...(item.error ? { error: item.error } : {}), createdAt: item.createdAt, updatedAt: item.updatedAt }));
}
function pauseQueue(record, reason, sessionId) {
  let changed = false;
  for (const item of record.queue || []) {
    if (item.status === 'unknown' || sessionId && item._sessionId === sessionId && item.status !== 'starting') continue;
    item.status = item.status === 'starting' ? 'unknown' : 'paused'; if (item._editing) item._beforeEditStatus = 'paused'; item.error = item.status === 'unknown' ? '上次排队提交尚未确认，不会自动重发；请先读取状态。' : (item._requiresRebind || item._needsAccount) && item.error ? item.error : reason; item.updatedAt = new Date().toISOString(); changed = true;
  }
  return changed;
}
function createChatQueue({ checkedStart, recover, serial, loadRecord, persist, publicConversation, readAttachments, active, dirty, start, closing, emit, bindingState }) {
  const sessionId = randomUUID(), driving = new Set(), tasks = new Set(), scopes = new Map(), submissions = new Map();
  let scheduled = false;
  const keyOf = scope => scope.workspaceId + '/' + scope.conversationId;
  function changed(record) { emit(record); }
  async function snapshotAttachments(input) {
    const known = new Map((await readAttachments(input)).map(file => [file.id, file]));
    return (input.attachmentIds || []).map(id => {
      const item = known.get(id); if (!item) throw Error('排队材料不属于当前对话，请重新选择；尚未调用模型。');
      return Object.fromEntries(['id', 'name', 'mimeType', 'bytes', 'kind', 'sha256', 'createdAt', 'provenance'].filter(field => item[field] !== undefined).map(field => [field, item[field]]));
    });
  }
  async function enqueueRequest(raw) {
    if (closing()) throw Error('应用正在退出，消息未加入队列。');
    const input = checkedStart(raw);
    if (raw.sceneName !== undefined && (typeof raw.sceneName !== 'string' || raw.sceneName.length > 120)) throw Error('排队场景名称无效。');
    await recover(input.workspaceId);
    const result = await serial(input.workspaceId, async () => {
      if (closing()) throw Error('应用正在退出，消息未加入队列。');
      const record = structuredClone(await loadRecord(input));
      const turn = record.turns.find(item => item.id === input.id), existing = record.queue?.find(item => item.id === input.id);
      if (turn) { if (turn._fingerprint !== createHash('sha256').update(JSON.stringify(input)).digest('hex')) throw Error('这条消息编号已用于不同内容，未重复提交。'); return publicConversation(record); }
      if (existing) { if (JSON.stringify(existing._request) !== JSON.stringify(input)) throw Error('这条排队编号已用于其他内容，未重复提交。'); return publicConversation(record); }
      if (record.trashedAt) throw Error('请先恢复聊天，再加入待发消息。');
      if ((record.queue?.length || 0) >= LIMIT || record.turns.length + (record.queue?.length || 0) >= 300) throw Error('本段对话的待发消息已满，请先处理队列或新建对话。');
      const time = new Date().toISOString(), blocked = record.queue?.some(item => item.status !== 'queued') || record.turns.at(-1)?.status === 'interrupted';
      const bindingFingerprint = bindingState ? await bindingState(input) : undefined;
      const item = { id: input.id, ...(bindingFingerprint ? { _bindingFingerprint: bindingFingerprint } : {}), _request: input, _sessionId: sessionId, status: blocked ? 'paused' : 'queued', attachments: await snapshotAttachments(input), createdAt: time, updatedAt: time, ...(raw.sceneName ? { sceneName: raw.sceneName } : {}), ...(blocked ? { error: '前面的请求需要先处理，确认后可继续待发队列。' } : {}) };
      record.queue = [...(record.queue || []), item]; record.updatedAt = time;
      if (!record.turns.length && record.title === '新对话') record.title = input.text.replace(/\s+/g, ' ').slice(0, 36);
      await persist(record); scopes.set(keyOf(input), { workspaceId: input.workspaceId, conversationId: input.conversationId }); changed(record);
      return publicConversation(record);
    });
    kick(); return result;
  }
  function enqueue(raw) {
    const input = checkedStart(raw), key = keyOf(input) + '/' + input.id, fingerprint = createHash('sha256').update(JSON.stringify([input, raw.sceneName || ''])).digest('hex');
    const existing = submissions.get(key); if (existing) { if (existing.fingerprint !== fingerprint) return Promise.reject(Error('这条排队编号已用于不同内容。')); return existing.task; }
    const task = enqueueRequest(raw); submissions.set(key, { task, fingerprint, scope: keyOf(input) });
    void task.finally(() => submissions.delete(key)).catch(() => undefined); return task;
  }
  const waitForScope = scope => Promise.allSettled([...submissions.values()].filter(item => item.scope === keyOf(scope)).map(item => item.task));
  async function manage(input) {
    if (!input || !validId(input.workspaceId) || !validId(input.conversationId) || !['edit', 'withdraw', 'resume', 'pause', 'cancel-edit'].includes(input.action) || input.action !== 'resume' && !validId(input.id)) throw Error('排队操作无效。');
    if (closing()) throw Error('应用正在退出，待发消息已保留。');
    await recover(input.workspaceId);
    const result = await serial(input.workspaceId, async () => {
      const record = structuredClone(await loadRecord(input)), items = record.queue || [];
      if (record.trashedAt) throw Error('请先恢复聊天，再处理待发队列。');
      if (input.action === 'resume') {
        if (items.some(item => item._editing)) throw Error('有待发要求仍在编辑，请先保存或取消编辑。');
        if (items.some(item => item._requiresRebind)) throw Error('连接、型号或账户已更新。请带回输入框重新选择后明确发送。');
        if (items.some(item => item._needsAccount)) throw Error('备份不包含账户。请将这条要求带回输入框，选择当前账户后再明确发送。');
        if (items.some(item => item.status === 'unknown' || item.status === 'starting')) throw Error('存在提交尚未确认的消息，请先读取状态或将其移出待发列表；不会自动重发。');
        for (const item of items) { item.status = 'queued'; item._sessionId = sessionId; item.updatedAt = new Date().toISOString(); delete item.error; }
      } else {
        const index = items.findIndex(item => item.id === input.id); if (index < 0) return publicConversation(record);
        const item = items[index];
        if (item.status === 'starting') throw Error('这条消息已开始提交，请在回复中停止；尚未提交的队列保留。');
        if (item.status === 'unknown' && input.action !== 'withdraw') throw Error('这条提交尚未确认，请先读取状态；不会重新发送。');
        if (input.action === 'pause') { if (item.status === 'unknown') throw Error('请先核对这条提交的状态。'); if (!item._editing) { item._beforeEditStatus = item.status; item._editing = true; item.status = 'paused'; item.error = '正在编辑，保存后才会继续发送。'; } }
        else if (input.action === 'cancel-edit') { item.status = item._beforeEditStatus === 'queued' && item._sessionId === sessionId && !item._needsAccount ? 'queued' : 'paused'; delete item._editing; delete item._beforeEditStatus; delete item.error; }
        else if (input.action === 'withdraw') items.splice(index, 1);
        else {
          if (item.status === 'unknown') throw Error('请先核对提交状态，再编辑这条消息；不会重新调用模型。');
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 10000) throw Error('请输入1至10000字的修改内容。');
          let requestText = input.requestText;
          if (requestText === undefined && item._request.requestText) {
            if (!item._request.requestText.endsWith(item._request.text)) throw Error('这条场景要求无法安全替换，请撤回后重新排队。');
            requestText = item._request.requestText.slice(0, -item._request.text.length) + input.text.trim();
          }
          const request = checkedStart({ ...item._request, text: input.text, ...(requestText ? { requestText } : {}), ...(input.attachmentIds ? { attachmentIds: input.attachmentIds } : {}) });
          item._request = request; item.attachments = await snapshotAttachments(request); item.updatedAt = new Date().toISOString();
          if (item._editing) { item.status = item._beforeEditStatus === 'queued' && item._sessionId === sessionId && !item._needsAccount ? 'queued' : 'paused'; delete item._editing; delete item._beforeEditStatus; }
          if (item.status === 'paused' && item._sessionId === sessionId) delete item.error;
        }
      }
      record.queue = items; record.updatedAt = new Date().toISOString(); await persist(record);
      scopes.set(keyOf(input), { workspaceId: input.workspaceId, conversationId: input.conversationId }); changed(record); return publicConversation(record);
    });
    kick(); return result;
  }
  async function drive(scope) {
    const key = keyOf(scope);
    if (driving.has(key) || closing() || active.has(key) || dirty.has(key) || active.size >= 2) return;
    driving.add(key);
    try {
      const request = await serial(scope.workspaceId, async () => {
        if (closing() || active.has(key) || dirty.has(key) || active.size >= 2) return;
        const record = structuredClone(await loadRecord(scope)), item = record.queue?.[0];
        if (!item || record.trashedAt || item.status !== 'queued' || item._sessionId !== sessionId || item._needsAccount) return;
        try { await checkBinding(item); } catch (cause) { item.status = 'paused'; item.error = String(cause.message || '当前设置暂时无法核对，请稍后继续。').slice(0, 2000); if (cause.code === 'QUEUED_BINDING_CHANGED') item._requiresRebind = true; item.updatedAt = new Date().toISOString(); await persist(record); changed(record); return; }
        item.status = 'starting'; item.updatedAt = new Date().toISOString(); delete item.error;
        await persist(record); changed(record); return item._request;
      });
      if (!request) return;
      try { await start(request); }
      catch (cause) {
        await serial(scope.workspaceId, async () => {
          const record = structuredClone(await loadRecord(scope)), item = record.queue?.find(item => item.id === request.id);
          if (item) { if (cause.code === 'QUEUED_BINDING_CHANGED') item._requiresRebind = true; item.status = /已有两段对话|对话服务正在忙/.test(cause.message || '') && !closing() ? 'queued' : 'paused'; item.error = String(cause.message || '排队提交未完成，请核对后继续。').slice(0, 2000); item.updatedAt = new Date().toISOString(); await persist(record); changed(record); }
        });
      }
    } finally { driving.delete(key); }
  }
  async function checkBinding(item) {
    if (!bindingState) return; const current = await bindingState(item._request);
    if (current !== item._bindingFingerprint) throw changedQueuedBinding();
  }
  function rebind(record, original, sourceTurnId) {
    if ((record.queue?.length || 0) >= LIMIT) return;
    const id = randomUUID(), item = structuredClone(original); item.id = id; item._request = { ...item._request, id, sourceTurnId }; item.status = 'paused'; item._requiresRebind = true; item._sessionId = sessionId; item.updatedAt = new Date().toISOString(); item.error = changedQueuedBinding().message; delete item._editing; delete item._beforeEditStatus; record.queue = [item, ...(record.queue || [])];
  }
  function kick() {
    if (scheduled || closing()) return; scheduled = true;
    queueMicrotask(() => { scheduled = false; for (const scope of scopes.values()) { const task = drive(scope); tasks.add(task); void task.catch(() => undefined).finally(() => tasks.delete(task)); } });
  }
  function recoverRecord(record) {
    const before = record.queue?.length || 0;
    if (!before) return false;
    record.queue = record.queue.filter(item => !record.turns.some(turn => turn.id === item.id));
    return pauseQueue(record, '应用已重新打开，待发消息和原设置已保留；确认后可继续。', sessionId) || record.queue.length !== before;
  }
  return { enqueue, manage, waitForScope, kick, checkBinding, rebind, recoverRecord, pause: (record, reason) => pauseQueue(record, reason), forget: scope => scopes.delete(keyOf(scope)), drain: () => Promise.allSettled([...tasks, ...[...submissions.values()].map(item => item.task)]) };
}
module.exports = { LIMIT, queueEntriesValid, publicQueue, pauseQueue, createChatQueue };
