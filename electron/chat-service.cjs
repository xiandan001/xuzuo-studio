const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { calculateCost } = require('./live-cost.cjs');
const { resolveOfficialBillingRule } = require('./official-billing.cjs');
const { completeBillingUsage } = require('./billing-request-shape.cjs');
const { executeChat, prepareChat } = require('./provider-chat.cjs');
const { parseNaturalAutomationPlan } = require('./natural-automation-plan.runtime.cjs');
const { createChatAttachments, attachmentMetadata, attachmentFiles, validateAttachmentPayloads } = require('./chat-attachments.cjs');

const idValid = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = input => `${input.workspaceId}/${input.conversationId}`;
const isActive = turn => turn.status === 'running';
const dateValid = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const COST_STATES = new Set(['calculated', 'manual', 'unknown', 'not-incurred']);
const STORE_LIMIT = 32 * 1024 * 1024;
const missingFile = error => error.code === 'ENOENT' || /目录已不可用/.test(error.message);
function missingConversation() { const error = Error('这段聊天的原记录文件已丢失，原费用仍保留；请新建对话，不会覆盖原费用记录。'); error.code = 'CHAT_RECORD_MISSING'; return error; }
const importOriginValid = value => value && Object.keys(value).length === 4 && ['backupId', 'sourceWorkspaceId', 'sourceConversationId'].every(key => idValid(value[key])) && /^[a-f0-9]{64}$/.test(value.sourceHash || '');
function indexValid(value, workspaceId) {
  if (!value || value.version !== 1 || value.workspaceId !== workspaceId || value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0) || !Array.isArray(value.items) || value.items.length > 200) return false;
  const ids = new Set();
  return value.items.every(item => {
    if (!item || !idValid(item.id) || ids.has(item.id) || item.workspaceId !== workspaceId || typeof item.title !== 'string' || item.title.length > 100 || !dateValid(item.createdAt) || !dateValid(item.updatedAt) || !Number.isSafeInteger(item.turnCount) || item.turnCount < 0 || item.turnCount > 300 || item.activeTurnId !== undefined && !idValid(item.activeTurnId) || !Array.isArray(item.ledger)) return false;
    ids.add(item.id);
    return item.ledger.every(entry => entry && typeof entry.id === 'string' && entry.scope === 'chat' && entry.workspaceId === workspaceId && entry.conversationId === item.id && Number.isSafeInteger(entry.costCents) && entry.costCents >= 0 && COST_STATES.has(entry.costState) && dateValid(entry.time));
  });
}
function recordValid(value, input) {
  if (value?.version !== 1 || !idValid(value.id) || !idValid(value.workspaceId) || value.id !== input.conversationId || value.workspaceId !== input.workspaceId || typeof value.title !== 'string' || value.title.length > 100 || !dateValid(value.createdAt) || !dateValid(value.updatedAt) || !Array.isArray(value.turns) || value.turns.length > 300 || value._importOrigin !== undefined && !importOriginValid(value._importOrigin)) return false;
  const ids = new Set();
  return value.turns.every(turn => {
    if (!turn || !idValid(turn.id) || ids.has(turn.id) || typeof turn.userText !== 'string' || turn.userText.length > 10000 || typeof turn.text !== 'string' || turn.text.length > 2 * 1024 * 1024 || !['running', 'complete', 'cancelled', 'failed', 'interrupted'].includes(turn.status) || !dateValid(turn.createdAt) || !dateValid(turn.updatedAt) || !Number.isSafeInteger(turn.costCents) || turn.costCents < 0 || !COST_STATES.has(turn.costState) || typeof turn.modelName !== 'string' || typeof turn.modelId !== 'string' || !turn._billing || turn._billing.modelId !== turn.modelId || !turn._billing.connection || !/^[a-f0-9]{64}$/.test(turn._fingerprint || '')) return false;
    if (turn._attachments !== undefined || turn.attachments !== undefined) {
      try {
        validateAttachmentPayloads(turn._attachments);
        if (!Array.isArray(turn.attachments) || turn.attachments.length !== turn._attachments.length || turn.attachments.some((file, index) => !file || Object.keys(file).length !== 5 || Object.entries(attachmentMetadata(turn._attachments[index])).some(([key, value]) => file[key] !== value))) return false;
      } catch { return false; }
    }
    if (turn.plan !== undefined) { try { if (turn.mode !== 'plan' || turn.status !== 'complete') return false; parseNaturalAutomationPlan(JSON.stringify(turn.plan)); } catch { return false; } }
    ids.add(turn.id); return true;
  });
}
function validateWorkspaceSnapshot(value) {
  if (!value || value.version !== undefined && value.version !== 1 || !idValid(value.workspaceId) || !Array.isArray(value.conversations) || value.conversations.length > 200) throw Error('聊天备份格式无效，尚未恢复任何聊天。');
  const ids = new Set();
  function containsSecretFields(object) {
    if (!object || typeof object !== 'object') return false;
    return Object.entries(object).some(([key, child]) => /^(?:secret|apiKey|api_key|authorization|headers|ciphertext)$/i.test(key) || containsSecretFields(child));
  }
  for (const record of value.conversations) {
    if (ids.has(record?.id) || !recordValid(record, { workspaceId: value.workspaceId, conversationId: record?.id }) || containsSecretFields(record)) throw Error('聊天备份包含无效、重复或非本工作区的记录，尚未恢复任何聊天。');
    ids.add(record.id);
    if (Buffer.byteLength(JSON.stringify(record)) > STORE_LIMIT) throw Error('备份中的单段聊天超过32MB，尚未恢复任何聊天。');
  }
  return clone({ version: 1, workspaceId: value.workspaceId, conversations: value.conversations });
}

function summary(record) {
  return { id: record.id, workspaceId: record.workspaceId, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, turnCount: record.turns.length, ...(record.turns.some(isActive) ? { activeTurnId: record.turns.find(isActive).id } : {}) };
}
const publicTurn = turn => Object.fromEntries(Object.entries(turn).filter(([key]) => !key.startsWith('_')));
function publicConversation(record) { return { version: 1, ...summary(record), turns: record.turns.map(publicTurn) }; }
function blank(input) { const time = now(); return { version: 1, id: input.conversationId, workspaceId: input.workspaceId, title: '新对话', createdAt: time, updatedAt: time, turns: [] }; }
function checkedScope(input) {
  if (!input || !idValid(input.workspaceId) || !idValid(input.conversationId)) throw Error('对话或工作区编号无效。');
  return input;
}
function checkedStart(input) {
  checkedScope(input);
  if (!idValid(input.id) || !idValid(input.credentialId) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 10000 || input.sourceTurnId !== undefined && !idValid(input.sourceTurnId)) throw Error('请输入不超过10000字的消息，并选择可用账户。');
  if (input.mode !== undefined && !['chat', 'plan'].includes(input.mode) || input.outputKind !== undefined && !['image', 'word', 'ppt', 'excel'].includes(input.outputKind)) throw Error('对话模式或制作类型无效。');
  if (input.attachmentIds !== undefined && (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 5 || input.attachmentIds.some(id => !idValid(id)) || new Set(input.attachmentIds).size !== input.attachmentIds.length)) throw Error('聊天附件选择无效，每条消息最多添加5份不同附件。');
  const { connection, model } = input;
  if (!connection || !model || connection.demo || model.demo || connection.enabled !== true || model.enabled !== true || model.connectionId !== connection.id || !idValid(connection.id) || !idValid(model.id) || !['openai-chat', 'openai-responses', 'anthropic', 'gemini'].includes(connection.protocol) || !Array.isArray(model.capabilities) || !model.capabilities.includes('text')) throw Error('请选择已启用的文字模型与对应服务。');
  if (typeof model.modelId !== 'string' || !model.modelId.trim() || model.modelId.length > 240 || typeof model.name !== 'string' || model.name.length > 240) throw Error('模型名称或真实模型ID无效。');
  const safeConnection = Object.fromEntries(['id', 'name', 'providerId', 'protocol', 'baseUrl', 'enabled', 'status'].filter(key => connection[key] !== undefined).map(key => [key, connection[key]]));
  const safeModel = { id: model.id, name: model.name, modelId: model.modelId, connectionId: model.connectionId, capabilities: [...model.capabilities], enabled: true, ...(model.pricing ? { pricing: clone(model.pricing) } : {}) };
  const result = { id: input.id, workspaceId: input.workspaceId, conversationId: input.conversationId, text: input.text.trim(), connection: safeConnection, model: safeModel, credentialId: input.credentialId, reasoningEffort: input.reasoningEffort || 'auto', mode: input.mode || 'chat', ...(input.outputKind ? { outputKind: input.outputKind } : {}), ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), ...(input.attachmentIds?.length ? { attachmentIds: [...input.attachmentIds] } : {}) };
  prepareChat(result, [{ role: 'user', content: result.text }]);
  return result;
}
function contextMessages(record, input) {
  const retryIndex = input.sourceTurnId ? record.turns.findIndex(turn => turn.id === input.sourceTurnId) : -1;
  const history = retryIndex >= 0 ? record.turns.slice(0, retryIndex) : record.turns;
  const turns = history.filter(turn => turn.status === 'complete' && (input.mode === 'plan' || (turn.mode || 'chat') === 'chat'));
  const message = (text, files) => ({ role: 'user', content: text, ...(files?.length ? { attachments: files } : {}) });
  const kept = []; let size = input.text.length + (input._attachments || []).reduce((sum, file) => sum + (file.text?.length || 0), 0), bytes = (input._attachments || []).reduce((sum, file) => sum + file.bytes, 0), fileCount = input._attachments?.length || 0;
  for (const turn of turns.slice(-24).reverse()) {
    const files = turn._attachments || [];
    const addition = turn.userText.length + turn.text.length + files.reduce((sum, file) => sum + (file.text?.length || 0), 0), extraBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    if (size + addition > 80000 || bytes + extraBytes > 10 * 1024 * 1024 || fileCount + files.length > 20) break;
    kept.unshift(message(turn.userText, files), { role: 'assistant', content: turn.text }); size += addition; bytes += extraBytes; fileCount += files.length;
  }
  return { messages: [...kept, message(input.text, input._attachments)], truncated: kept.length < turns.length * 2 };
}
function entriesFor(record) {
  return record.turns.map(turn => ({ id: `chat-${signature([record.workspaceId, record.id, turn.id]).slice(0, 40)}`, workspaceId: record.workspaceId, scope: 'chat', conversationId: record.id,
    projectId: `chat-${record.id}`, projectName: `聊天 · ${record.title}`, action: turn.sourceTurnId ? '重新生成' : '初次生成', model: turn.modelName,
    costCents: turn.costCents, costState: turn.costState, ...(turn.calculation ? { calculation: clone(turn.calculation) } : {}), ...(turn.costReason ? { costReason: turn.costReason } : {}),
    ...(turn.usage ? { usage: clone(turn.usage) } : {}), ...(turn._billing?.billingRequestSnapshot ? { billingRequestSnapshot: clone(turn._billing.billingRequestSnapshot) } : {}),
    time: turn.createdAt, status: turn.status === 'running' ? 'processing' : turn.status === 'complete' ? 'complete' : turn.status === 'cancelled' ? 'cancelled' : 'failed', billingMode: 'live', quantity: 1 }));
}

function createChatService({ directory, credentialStore, fetchImpl = fetch, fxRates, onChanged = () => undefined, fileSystem = fs, execute = executeChat, cacheBudgetBytes = STORE_LIMIT } = {}) {
  if (typeof credentialStore?.withSecret !== 'function' || typeof directory !== 'string' || !path.isAbsolute(directory)) throw TypeError('普通聊天缺少本地存储目录或凭证库。');
  const root = path.join(directory, 'chat-v1'), workspaces = new Map(), records = new Map(), workspaceLoads = new Map(), queues = new Map(), active = new Map(), dirty = new Map(), weights = new Map();
  const attachments = createChatAttachments({ directory, fileSystem });
  let closing = false;
  const recordWeight = record => 1024 + record.turns.reduce((sum, turn) => sum + 4096 + 2 * (turn.userText.length + turn.text.length + (turn._attachments || []).reduce((size, file) => size + file.data.length + (file.text?.length || 0), 0)), 0);
  const cachedBytes = () => [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const emit = (record, ledgerChanged = false, changedTurn = record.turns.at(-1)) => { const key = `${record.workspaceId}/${record.id}`; if (records.has(key)) weights.set(key, recordWeight(record)); try { onChanged({ workspaceId: record.workspaceId, conversationId: record.id, ledgerChanged, ...(changedTurn ? { turn: clone(publicTurn(changedTurn)) } : {}), title: record.title, updatedAt: record.updatedAt }); } catch { /* A renderer cannot interrupt persistence. */ } };
  const filename = input => path.join(root, input.workspaceId, `${input.conversationId}.conversation.json`);
  const indexFile = workspaceId => path.join(root, workspaceId, 'index.json');
  const pendingFile = workspaceId => path.join(root, workspaceId, 'pending.json');
  const indexValue = (state, items = state.items, revision = state.revision) => ({ version: 1, workspaceId: state.workspaceId, revision, items: [...items.values()] });
  function checkSize(value, label) { if (Buffer.byteLength(JSON.stringify(value)) > STORE_LIMIT) throw Error(`${label}已达到32MB保存上限，原记录与费用保留；请导出记录并使用新的工作区继续。`); }
  function serial(workspaceId, operation) {
    const next = (queues.get(workspaceId) || Promise.resolve()).catch(() => undefined).then(operation); queues.set(workspaceId, next);
    return next.finally(() => { if (queues.get(workspaceId) === next) queues.delete(workspaceId); });
  }
  async function readJson(file, limit = 32 * 1024 * 1024) {
    const stat = await checkedFile(fileSystem, file); if (stat.size > limit) throw Error('聊天记录过大，原文件已保留，请导出后再整理。');
    return JSON.parse(await fileSystem.readFile(file, 'utf8'));
  }
  async function recoverPending(state) {
    let pending;
    try { pending = await readJson(pendingFile(state.workspaceId), 2048); } catch (error) { if (missingFile(error)) return; throw Error('聊天保存事务无法读取，原记录与费用没有被覆盖。'); }
    if (pending?.version !== 1 || pending.workspaceId !== state.workspaceId || !idValid(pending.conversationId) || !Number.isSafeInteger(pending.revision) || pending.revision < 1 || !/^[a-f0-9]{64}$/.test(pending.recordHash || '')) throw Error('聊天保存事务格式无效，原记录与费用没有被覆盖。');
    if (pending.revision > state.revision) {
      if (pending.revision !== state.revision + 1) throw Error('聊天记录版本不连续，原记录与费用没有被覆盖。');
      let record;
      try { record = await readJson(filename(pending)); } catch (error) { if (!missingFile(error)) throw error; }
      if (record && signature(record) === pending.recordHash && recordValid(record, pending)) {
        const items = new Map(state.items); items.set(record.id, { ...summary(record), ledger: entriesFor(record) });
        const value = indexValue(state, items, pending.revision); checkSize(value, '当前工作区的聊天索引');
        await atomicJson(fileSystem, indexFile(state.workspaceId), value); state.items = items; state.revision = pending.revision;
      }
    }
    try { await fileSystem.unlink(pendingFile(state.workspaceId)); } catch (error) { if (error.code !== 'ENOENT') { /* A committed journal may be replaced on the next serialized save. */ } }
  }
  async function loadWorkspace(workspaceId) {
    if (!idValid(workspaceId)) throw Error('工作区编号无效。');
    if (workspaces.has(workspaceId)) return workspaces.get(workspaceId);
    if (workspaceLoads.has(workspaceId)) return workspaceLoads.get(workspaceId);
    const task = (async () => {
      let value;
      try { value = await readJson(indexFile(workspaceId)); } catch (error) { if (error.code !== 'ENOENT' && !/目录已不可用/.test(error.message)) throw Error('聊天索引无法读取，原文件没有被覆盖。'); }
      if (value && !indexValid(value, workspaceId)) throw Error('聊天索引格式无效，原文件没有被覆盖。');
      const state = { workspaceId, items: new Map((value?.items || []).map(item => [item.id, item])), revision: value?.revision || 0, recovered: false };
      await recoverPending(state); workspaces.set(workspaceId, state); return state;
    })();
    workspaceLoads.set(workspaceId, task); try { return await task; } finally { workspaceLoads.delete(workspaceId); }
  }
  function cache(record) {
    const key = `${record.workspaceId}/${record.id}`; records.delete(key); records.set(key, record); weights.set(key, recordWeight(record)); trimCache();
  }
  function trimCache() {
    let bytes = cachedBytes();
    for (const [key] of records) {
      if (records.size <= 12 && bytes <= cacheBudgetBytes) break;
      if (!active.has(key) && !dirty.has(key)) { bytes -= weights.get(key) || 0; records.delete(key); weights.delete(key); }
    }
  }
  async function loadRecord(input) {
    checkedScope(input); const key = keyOf(input); if (records.has(key)) { const record = records.get(key); records.delete(key); records.set(key, record); return record; }
    let value;
    try { value = await readJson(filename(input)); } catch (error) { if (missingFile(error)) { if ((await loadWorkspace(input.workspaceId)).items.has(input.conversationId)) throw missingConversation(); return blank(input); } throw Error('这段聊天无法读取，原文件没有被覆盖。'); }
    if (!recordValid(value, input)) throw Error('这段聊天结构无效，原文件没有被覆盖。');
    cache(value); return value;
  }
  async function persist(record, { preserveCache = false } = {}) {
    const state = await loadWorkspace(record.workspaceId); await recoverPending(state);
    for (const turn of record.turns) delete turn.saveIssue;
    const info = { ...summary(record), ledger: entriesFor(record) };
    const items = new Map(state.items); items.set(record.id, info);
    if (items.size > 200) throw Error('本工作区已保存200段聊天，请使用另一工作区继续；原记录与费用保留。');
    const nextRevision = state.revision + 1, nextIndex = indexValue(state, items, nextRevision);
    if (!Number.isSafeInteger(nextRevision)) throw Error('聊天存储版本已达到上限，原记录与费用保留。');
    checkSize(record, '这段聊天'); checkSize(nextIndex, '当前工作区的聊天索引');
    let recordWritten = false;
    try {
      await atomicJson(fileSystem, pendingFile(record.workspaceId), { version: 1, workspaceId: record.workspaceId, conversationId: record.id, revision: nextRevision, recordHash: signature(record) });
      await atomicJson(fileSystem, filename({ workspaceId: record.workspaceId, conversationId: record.id }), record); recordWritten = true;
      await atomicJson(fileSystem, indexFile(record.workspaceId), nextIndex);
    } catch (error) { if (recordWritten) error.chatRecordWritten = true; throw error; }
    state.items = items; state.revision = nextRevision; if (!preserveCache) cache(record); dirty.delete(`${record.workspaceId}/${record.id}`);
    try { await fileSystem.unlink(pendingFile(record.workspaceId)); } catch { /* The revision makes replay of a committed journal harmless. */ }
  }
  async function recover(workspaceId) {
    const state = await loadWorkspace(workspaceId); if (state.recovered) return; state.recovered = true;
    try {
      for (const info of state.items.values()) {
        const key = `${workspaceId}/${info.id}`; if (!info.activeTurnId || active.has(key)) continue;
        let record;
        try { record = clone(await loadRecord({ workspaceId, conversationId: info.id })); }
        catch (error) {
          if (error.code !== 'CHAT_RECORD_MISSING') throw error;
          const items = new Map(state.items), unavailable = { ...info, ledger: info.ledger.map(entry => entry.status === 'processing' ? { ...entry, status: 'failed', costState: 'unknown', costReason: '聊天原文件丢失，尚未返回完整用量；已发生的其他费用保留。' } : entry) }; delete unavailable.activeTurnId;
          items.set(info.id, unavailable); const value = indexValue(state, items, state.revision + 1); checkSize(value, '当前工作区的聊天索引'); await atomicJson(fileSystem, indexFile(workspaceId), value); state.items = items; state.revision++; continue;
        }
        for (const turn of record.turns.filter(isActive)) { turn.status = 'interrupted'; turn.updatedAt = now(); turn.error = '上次回答因应用退出而中断，片段与已有费用保留；不会自动重发。'; if (turn._requestStarted !== false) { turn.costState = 'unknown'; turn.costReason = '连接中断，供应商尚未返回完整用量，不能把这次调用视为免费。'; } else turn.costState = 'not-incurred'; }
        record.updatedAt = now(); await persist(record); emit(record, true);
      }
    } catch (error) { state.recovered = false; throw error; }
  }
  async function applyCost(turn, received, requestStarted) {
    const context = turn._billing, usage = completeBillingUsage(received || {}, context.billingRequestSnapshot, context, context.ruleSnapshot);
    if (Object.keys(usage).length) turn.usage = usage;
    if (requestStarted === false) { turn.costCents = 0; turn.costState = 'not-incurred'; turn.costReason = '本次没有向模型服务发送请求。'; return; }
    const cost = calculateCost(context.pricing, usage, context);
    turn.costCents = cost.costCents; turn.costState = cost.costState;
    if (cost.calculation) turn.calculation = cost.calculation; else delete turn.calculation;
    turn.costReason = cost.reason || (cost.costState === 'unknown' ? '供应商未返回完整计费用量，未把本次调用算作免费。' : undefined);
  }
  async function pump(input, operation, messages) {
    const key = keyOf(input); let terminal;
    try {
      const result = await execute(input, messages, { credentialStore, fetchImpl, signal: operation.controller.signal, onText: text => {
        const record = records.get(key), turn = record?.turns.find(item => item.id === input.id); if (!turn || !isActive(turn)) return;
        turn.text = text; turn.updatedAt = now(); record.updatedAt = turn.updatedAt;
        if (Date.now() - operation.emittedAt >= 100) { operation.emittedAt = Date.now(); emit(record); }
        if (Date.now() - operation.checkpointAt >= 2000 && !operation.checkpoint) {
          operation.checkpointAt = Date.now();
          operation.checkpoint = serial(input.workspaceId, async () => {
            const current = records.get(key); if (active.get(key) !== operation || !current?.turns.some(isActive)) return;
            await persist(clone(current), { preserveCache: true });
            if (current.turns.some(item => item.saveIssue)) { for (const item of current.turns) delete item.saveIssue; emit(current); }
          }).catch(() => {
            const current = records.get(key), currentTurn = current?.turns.find(item => item.id === input.id);
            if (currentTurn && isActive(currentTurn)) { currentTurn.saveIssue = '自动保存暂未完成，请保留当前窗口；回答结束后可免费重试保存。'; dirty.set(key, current); emit(current); }
          }).finally(() => { operation.checkpoint = undefined; });
        }
      } });
      terminal = { result };
    } catch (error) { terminal = { error }; }
    await serial(input.workspaceId, async () => {
      const record = clone(await loadRecord(input)), turn = record.turns.find(item => item.id === input.id); if (!turn) return;
      const value = terminal.result || terminal.error;
      if (typeof value?.text === 'string' || typeof value?.partialText === 'string') turn.text = value.text ?? value.partialText;
      turn._requestStarted = value?.requestStarted !== false;
      if (value?.billingRequestSnapshot) turn._billing.billingRequestSnapshot = value.billingRequestSnapshot;
      await applyCost(turn, value?.usage, turn._requestStarted);
      turn.status = terminal.result ? 'complete' : operation.controller.signal.aborted || value?.code === 'CANCELLED' ? 'cancelled' : 'failed';
      if (terminal.error) turn.error = terminal.error.name === 'ModelRuntimeError' ? terminal.error.message : '对话未能完成，请检查本地凭证或网络；原记录与费用保留。';
      if (turn.status === 'complete' && input.mode === 'plan') {
        try { turn.plan = parseNaturalAutomationPlan(turn.text); } catch { turn.status = 'failed'; turn.error = '模型返回的制作方案不完整或格式不正确，尚未执行制作；已保留回答与费用，可调整需求后重试。'; }
      }
      turn.updatedAt = now(); record.updatedAt = turn.updatedAt;
      try { await persist(record); } catch { turn.saveIssue = '回答已返回，但本地记录保存失败。请保留当前窗口并复制回答，不要重新发送以免重复收费。'; cache(record); dirty.set(key, record); }
      if (active.get(key) === operation) active.delete(key);
      trimCache();
      emit(record, true);
    });
  }
  async function start(raw) {
    if (closing) throw Error('应用正在退出，没有发送新的请求。');
    const input = checkedStart(raw); await recover(input.workspaceId);
    return serial(input.workspaceId, async () => {
      if (closing) throw Error('应用正在退出，没有发送新的请求。');
      const unsaved = dirty.get(keyOf(input)); if (unsaved && !active.has(keyOf(input))) { const saved = clone(unsaved); await persist(saved); emit(saved, true); }
      if ((await loadWorkspace(input.workspaceId)).items.has(input.conversationId)) { try { await checkedFile(fileSystem, filename(input)); } catch (error) { if (missingFile(error)) throw missingConversation(); throw error; } }
      const record = clone(await loadRecord(input)), existing = record.turns.find(turn => turn.id === input.id), fingerprint = signature(input);
      if (existing) { if (existing._fingerprint !== fingerprint) throw Error('这条消息编号已用于不同内容，没有重复调用模型。'); return publicConversation(record); }
      if (record.turns.length >= 300) throw Error('这段聊天已经很长，请新建对话，原记录与费用保留。');
      const key = keyOf(input);
      if (active.has(key) || record.turns.some(isActive)) throw Error('这段对话正在回答，可以停止后再发送；输入已保留。');
      if (active.size >= 2) throw Error('已有两段对话正在回答，请稍候或先停止其中一段；输入已保留。');
      if (input.sourceTurnId && !record.turns.some(turn => turn.id === input.sourceTurnId && !isActive(turn))) throw Error('找不到要重试的原消息，请重新编辑后发送。');
      const source = input.sourceTurnId ? record.turns.find(turn => turn.id === input.sourceTurnId) : undefined;
      const ids = input.attachmentIds || source?._attachments?.map(file => file.id) || [];
      input._attachments = await attachments.resolve(input, ids, record.turns.flatMap(turn => turn._attachments || []));
      const context = contextMessages(record, input);
      // Validate attachment/model compatibility before credentials or a paid request.
      prepareChat(input, context.messages);
      const createdAt = now(), fx = await fxRates?.get(createdAt);
      const billing = { modelId: input.model.modelId, connection: input.connection, operation: 'text', startedAt: createdAt, pricing: input.model.pricing, fx };
      billing.ruleSnapshot = resolveOfficialBillingRule(billing, billing.pricing);
      const turn = { id: input.id, userText: input.text, text: '', status: 'running', createdAt, updatedAt: createdAt, modelName: input.model.name, modelId: input.model.modelId, modelConfigId: input.model.id, credentialId: input.credentialId, reasoningEffort: input.reasoningEffort, mode: input.mode, ...(input.outputKind ? { outputKind: input.outputKind } : {}), ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), ...(context.truncated ? { contextTruncated: true } : {}), costCents: 0, costState: 'unknown', _fingerprint: fingerprint, _requestStarted: true, _billing: billing };
      if (input._attachments.length) { turn._attachments = clone(input._attachments); turn.attachments = input._attachments.map(attachmentMetadata); }
      if (!record.turns.length) record.title = input.text.replace(/\s+/g, ' ').slice(0, 36);
      record.turns.push(turn); record.updatedAt = createdAt;
      if (closing || active.size >= 2) throw Error('对话服务正在忙，请稍候再发送；输入已保留。');
      const operation = { turnId: input.id, controller: new AbortController(), emittedAt: 0, checkpointAt: Date.now(), checkpoint: undefined, task: undefined }; active.set(key, operation);
      try { await persist(record); }
      catch (error) {
        if (error.chatRecordWritten) {
          turn.status = 'cancelled'; turn.costState = 'not-incurred'; turn.costCents = 0; turn._requestStarted = false; turn.updatedAt = now(); record.updatedAt = turn.updatedAt;
          turn.error = '这条消息尚未发送到模型，没有产生调用费用。'; turn.saveIssue = '本地聊天记录未保存，请免费重试保存后继续。';
          dirty.set(key, record); cache(record); active.delete(key); trimCache(); emit(record, true);
          throw Error('本地聊天记录未保存，本轮没有调用模型。请点击“重试保存”后继续。');
        }
        active.delete(key); throw error;
      }
      if (closing || operation.controller.signal.aborted) {
        turn.status = 'cancelled'; turn.costState = 'not-incurred'; turn._requestStarted = false; turn.error = closing ? '应用正在退出，本轮没有发送到模型。' : '已停止，本轮没有发送到模型。'; turn.updatedAt = now(); record.updatedAt = turn.updatedAt;
        try { await persist(record); } finally { active.delete(key); emit(record, true); }
        return publicConversation(record);
      }
      emit(record, true);
      operation.task = pump(input, operation, context.messages).catch(() => { const saved = records.get(key); if (saved) emit(saved, true); }).finally(() => { if (active.get(key) === operation) active.delete(key); });
      return publicConversation(record);
    });
  }
  async function ledger(workspaceId) {
    let ids;
    if (workspaceId !== undefined) { await recover(workspaceId); ids = [workspaceId]; }
    else {
      await checkedDirectory(fileSystem, root, true);
      ids = (await fileSystem.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && idValid(entry.name)).map(entry => entry.name);
      for (const id of ids) await recover(id);
    }
    const result = new Map();
    for (const id of ids) for (const item of (await loadWorkspace(id)).items.values()) for (const entry of item.ledger) result.set(entry.id, clone(entry));
    for (const record of records.values()) if (ids.includes(record.workspaceId)) for (const entry of entriesFor(record)) result.set(entry.id, entry);
    for (const record of dirty.values()) if (ids.includes(record.workspaceId)) for (const entry of entriesFor(record)) result.set(entry.id, entry);
    return [...result.values()].sort((first, second) => second.time.localeCompare(first.time));
  }
  async function recalculateCosts() {
    const entries = await ledger(), targets = [...new Set(entries.filter(entry => entry.status !== 'processing' && entry.costState !== 'manual' && entry.costState !== 'not-incurred' && (entry.costState === 'unknown' && entry.usage || entry.calculation?.nativeCurrency === 'USD' && entry.calculation.cnyAmount === undefined)).map(entry => `${entry.workspaceId}/${entry.conversationId}`))]; let updated = 0;
    for (const key of targets) {
      const [workspaceId, conversationId] = key.split('/');
      await serial(workspaceId, async () => {
        if (active.has(key)) return;
        const record = clone(await loadRecord({ workspaceId, conversationId })), changedTurns = [];
        for (const turn of record.turns) if (!isActive(turn) && turn._billing && !['manual', 'not-incurred'].includes(turn.costState)) {
          const before = signature([turn.costCents, turn.costState, turn.calculation, turn.costReason]);
          turn._billing.fx ||= await fxRates?.get(turn.createdAt); await applyCost(turn, turn.usage, turn._requestStarted);
          if (before !== signature([turn.costCents, turn.costState, turn.calculation, turn.costReason])) { turn.updatedAt = now(); changedTurns.push(turn); updated++; }
        }
        if (changedTurns.length) { await persist(record); changedTurns.forEach((turn, index) => emit(record, index === changedTurns.length - 1, turn)); }
      });
    }
    return { updated };
  }
  async function reconcile({ entryId, costCents } = {}) {
    if (typeof entryId !== 'string' || !Number.isSafeInteger(costCents) || costCents < 0 || costCents > 100000000) throw Error('费用需要为有效的人民币分金额。');
    const entry = (await ledger()).find(item => item.id === entryId); if (!entry) throw Error('找不到这条聊天费用记录。');
    if (entry.status === 'processing') throw Error('回答尚未结束，请等待完成后再校正费用。');
    return serial(entry.workspaceId, async () => {
      if (active.has(`${entry.workspaceId}/${entry.conversationId}`)) throw Error('这段对话仍在回答，请结束后再校正费用。');
      const record = clone(await loadRecord({ workspaceId: entry.workspaceId, conversationId: entry.conversationId })), turn = record.turns.find(item => entriesFor({ ...record, turns: [item] })[0].id === entryId);
      if (!turn || isActive(turn)) throw Error('这条聊天费用状态已经改变，请刷新后重试。');
      turn._costRevisions = [...(turn._costRevisions || []), { before: turn.costCents, beforeState: turn.costState, beforeCalculation: turn.calculation, amount: costCents, at: now() }];
      turn.costCents = costCents; turn.costState = 'manual'; delete turn.calculation; turn.costReason = '按用户录入的官方账单人民币费用校正，原记录保留。'; turn.updatedAt = now();
      await persist(record); emit(record, true, turn);
    });
  }
  async function validateRestore(value) {
    const snapshot = validateWorkspaceSnapshot(value); await recover(snapshot.workspaceId);
    if ([...active.keys()].some(key => key.startsWith(`${snapshot.workspaceId}/`)) || [...dirty.keys()].some(key => key.startsWith(`${snapshot.workspaceId}/`))) throw Error('请先结束本工作区的回答并保存记录，再恢复聊天备份。');
    const state = await loadWorkspace(snapshot.workspaceId), items = new Map(state.items);
    for (const record of snapshot.conversations) {
      if (state.items.has(record.id)) { const existing = await loadRecord({ workspaceId: snapshot.workspaceId, conversationId: record.id }), sameOrigin = record._importOrigin && existing._importOrigin && signature(record._importOrigin) === signature(existing._importOrigin); if (!sameOrigin && signature(existing) !== signature(record)) throw Error('当前工作区已有不同内容的同名聊天编号，尚未恢复任何聊天；原记录和费用不会被覆盖。'); }
      items.set(record.id, { ...summary(record), ledger: entriesFor(record) });
    }
    if (items.size > 200) throw Error('恢复后聊天数量超过200段，尚未恢复任何聊天。'); checkSize(indexValue(state, items), '恢复后的聊天索引');
    return snapshot;
  }
  return {
    start,
    async importAttachments(scope, trustedPaths) {
      checkedScope(scope);
      return serial(scope.workspaceId, async () => { if (closing) throw Error('应用正在退出，未添加新的聊天附件。'); return attachments.importAttachments(scope, trustedPaths); });
    },
    async attachmentFiles(scope, turnId, attachmentIds) {
      checkedScope(scope);
      if (turnId === undefined) {
        if (!Array.isArray(attachmentIds) || !attachmentIds.length) throw Error('请选择当前对话中的附件。');
        return attachmentFiles(await attachments.resolve(scope, attachmentIds));
      }
      if (!idValid(turnId) || attachmentIds !== undefined) throw Error('附件来源消息编号或选择方式无效。');
      await recover(scope.workspaceId); const record = await loadRecord(scope), turn = record.turns.find(item => item.id === turnId);
      if (!turn) throw Error('找不到附件来源消息。');
      return attachmentFiles(clone(turn._attachments || []));
    },
    async list(workspaceId) { await recover(workspaceId); return [...(await loadWorkspace(workspaceId)).items.values()].map(({ ledger: _ledger, ...info }) => clone(info)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async read(input) { checkedScope(input); await recover(input.workspaceId); return publicConversation(await loadRecord(input)); },
    async cancel(input) {
      checkedScope(input); if (!idValid(input.turnId)) throw Error('消息编号无效。');
      const operation = active.get(keyOf(input));
      if (operation?.turnId === input.turnId) { operation.controller.abort(); await (operation.task || queues.get(input.workspaceId)); }
      return publicConversation(await loadRecord(input));
    },
    async flush(input) {
      checkedScope(input);
      return serial(input.workspaceId, async () => {
        if (active.has(keyOf(input))) throw Error('这轮仍在回答，请稍候或先停止，再免费重试保存。');
        const unsaved = dirty.get(keyOf(input)); if (unsaved) { const saved = clone(unsaved); await persist(saved); emit(saved, true); }
        return publicConversation(await loadRecord(input));
      });
    },
    ledger, recalculateCosts, reconcile,
    validateWorkspaceSnapshot: validateRestore,
    async exportWorkspace(workspaceId) {
      await recover(workspaceId);
      return serial(workspaceId, async () => {
        if ([...active.keys()].some(key => key.startsWith(`${workspaceId}/`)) || [...dirty.keys()].some(key => key.startsWith(`${workspaceId}/`))) throw Error('请先结束本工作区的回答并保存记录，再导出聊天备份。');
        const conversations = []; for (const info of (await loadWorkspace(workspaceId)).items.values()) conversations.push(clone(await loadRecord({ workspaceId, conversationId: info.id })));
        return { version: 1, workspaceId, conversations };
      });
    },
    async restoreWorkspace(value) {
      const snapshot = await validateRestore(value);
      return serial(snapshot.workspaceId, async () => {
        await validateRestore(snapshot); const state = await loadWorkspace(snapshot.workspaceId); let restored = 0, skipped = 0;
        for (const record of snapshot.conversations) { if (state.items.has(record.id)) { skipped++; continue; } for (const turn of record.turns.filter(isActive)) { turn.status = 'interrupted'; turn.error = '从备份恢复了未结束的回答，不会自动继续或重发。'; turn.costState = 'unknown'; } await persist(record); restored++; emit(record, true); }
        return { restored, skipped };
      });
    },
    status: () => ({ running: active.size, unsaved: dirty.size, cachedCount: records.size, cachedBytes: cachedBytes() }),
    resume() { closing = false; },
    async shutdown() {
      closing = true;
      for (const operation of active.values()) operation.controller.abort();
      await Promise.allSettled([...queues.values()]);
      for (const operation of active.values()) operation.controller.abort();
      await Promise.allSettled([...active.values()].map(operation => operation.task).filter(Boolean));
      await Promise.allSettled([...queues.values()]);
      try {
        for (const [key, record] of [...dirty]) await serial(record.workspaceId, async () => { const saved = clone(record); await persist(saved); if (!dirty.has(key)) emit(saved, true); });
      } catch { closing = false; throw Error('仍有聊天回答与费用未能保存，已保留当前窗口。请复制回答或恢复磁盘后重试退出。'); }
    },
  };
}

module.exports = { createChatService, checkedStart, contextMessages, entriesFor, validateWorkspaceSnapshot };
