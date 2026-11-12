const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { calculateCost } = require('./live-cost.cjs');
const { resolveOfficialBillingRule } = require('./official-billing.cjs');
const { completeBillingUsage } = require('./billing-request-shape.cjs');
const { executeChat, prepareChat, prepareChatMessages, compactChatRequest } = require('./provider-chat.cjs');
const { createChatAttachments, validPublicMetadata, backupBytes, MAX_COUNT, MAX_TOTAL } = require('./chat-attachments.cjs');
const { parseNaturalAutomationPlan } = require('./natural-automation-plan.runtime.cjs');
const { imageType } = require('./image-output-formats.cjs');
const { LIMIT: HISTORY_LIMIT, historyFieldsValid, historyFields, checkedHistory, historyCandidates, checkedManage, applyHistory, normalize: normalizeHistory, targetValid, productionsValid } = require('./chat-history.cjs');

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
const feeEntriesValid = (entries, workspaceId, conversationId) => Array.isArray(entries) && entries.length <= 300 && new Set(entries.map(entry => entry?.id)).size === entries.length && entries.every(entry => entry && typeof entry.id === 'string' && entry.scope === 'chat' && entry.workspaceId === workspaceId && entry.conversationId === conversationId && Number.isSafeInteger(entry.costCents) && entry.costCents >= 0 && COST_STATES.has(entry.costState) && dateValid(entry.time));
function missingConversation() { const error = Error('这段聊天的原记录文件已丢失，原费用仍保留；请新建对话，不会覆盖原费用记录。'); error.code = 'CHAT_RECORD_MISSING'; return error; }
const importOriginValid = value => value && Object.keys(value).length === 4 && ['backupId', 'sourceWorkspaceId', 'sourceConversationId'].every(key => idValid(value[key])) && /^[a-f0-9]{64}$/.test(value.sourceHash || '');
function indexValid(value, workspaceId) {
  if (!value || ![1, 2].includes(value.version) || value.workspaceId !== workspaceId || value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0) || !Array.isArray(value.items) || value.items.length > HISTORY_LIMIT) return false;
  const ids = new Set();
  return value.items.every(item => {
    if (!item || !idValid(item.id) || ids.has(item.id) || item.workspaceId !== workspaceId || typeof item.title !== 'string' || item.title.length > 100 || !dateValid(item.createdAt) || !dateValid(item.updatedAt) || !Number.isSafeInteger(item.turnCount) || item.turnCount < 0 || item.turnCount > 300 || item.activeTurnId !== undefined && !idValid(item.activeTurnId) || !historyFieldsValid(item) || item.recordHash !== undefined && !/^[a-f0-9]{64}$/.test(item.recordHash) || !(feeEntriesValid(item.ledger, workspaceId, item.id) || item.ledger === undefined && /^[a-f0-9]{64}$/.test(item.ledgerKey || ''))) return false;
    ids.add(item.id);
    return true;
  });
}
function recordValid(value, input) {
  if (value?.version !== 1 || !idValid(value.id) || !idValid(value.workspaceId) || value.id !== input.conversationId || value.workspaceId !== input.workspaceId || typeof value.title !== 'string' || value.title.length > 100 || !dateValid(value.createdAt) || !dateValid(value.updatedAt) || !Array.isArray(value.turns) || value.turns.length > 300 || value._importOrigin !== undefined && !importOriginValid(value._importOrigin) || !historyFieldsValid(value) || !productionsValid(value.productions)) return false;
  const ids = new Set();
  return value.turns.every(turn => {
    if (!turn || !idValid(turn.id) || ids.has(turn.id) || typeof turn.userText !== 'string' || turn.userText.length > 10000 || typeof turn.text !== 'string' || turn.text.length > 2 * 1024 * 1024 || !['running', 'complete', 'cancelled', 'failed', 'interrupted'].includes(turn.status) || !dateValid(turn.createdAt) || !dateValid(turn.updatedAt) || !Number.isSafeInteger(turn.costCents) || turn.costCents < 0 || !COST_STATES.has(turn.costState) || typeof turn.modelName !== 'string' || typeof turn.modelId !== 'string' || !turn._billing || turn._billing.modelId !== turn.modelId || !turn._billing.connection || !/^[a-f0-9]{64}$/.test(turn._fingerprint || '')) return false;
    if (turn.target !== undefined && !targetValid(turn.target) || turn._streamSequence !== undefined && (!Number.isSafeInteger(turn._streamSequence) || turn._streamSequence < 0)) return false;
    if (turn.requestText !== undefined && (typeof turn.requestText !== 'string' || !turn.requestText.trim() || turn.requestText.length > 20000)) return false;
    if (turn.plan !== undefined) { try { if (turn.mode !== 'plan' || turn.status !== 'complete') return false; parseNaturalAutomationPlan(JSON.stringify(turn.plan)); } catch { return false; } }
    if ([turn.attachments, turn.contextAttachments].some(items => items !== undefined && (!Array.isArray(items) || items.length > MAX_COUNT || items.some(item => !validPublicMetadata(item)) || new Set(items.map(item => item.id)).size !== items.length || items.reduce((sum, item) => sum + item.bytes, 0) > MAX_TOTAL))) return false;
    ids.add(turn.id); return true;
  });
}
function validateWorkspaceSnapshot(value) {
  if (!value || value.version !== undefined && value.version !== 1 || !idValid(value.workspaceId) || !Array.isArray(value.conversations) || value.conversations.length > HISTORY_LIMIT) throw Error('聊天备份格式无效，尚未恢复任何聊天。');
  const ids = new Set();
  function containsSecretFields(object) {
    if (!object || typeof object !== 'object') return false;
    return Object.entries(object).some(([key, child]) => /^(?:secret|apiKey|api_key|authorization|headers|ciphertext)$/i.test(key) || containsSecretFields(child));
  }
  for (const record of value.conversations) {
    if (ids.has(record?.id) || !recordValid(record, { workspaceId: value.workspaceId, conversationId: record?.id }) || containsSecretFields(record)) throw Error('聊天备份包含无效、重复或非本工作区的记录，尚未恢复任何聊天。');
    ids.add(record.id);
    if (Buffer.byteLength(JSON.stringify(record, null, 2) + '\n') > STORE_LIMIT) throw Error('备份中的单段聊天超过32MB，尚未恢复任何聊天。');
  }
  const files = value.attachmentFiles || []; if (!Array.isArray(files) || files.length > 2400) throw Error('聊天附件备份数量无效。');
  const known = new Map(); let total = 0;
  for (const file of files) {
    const key = `${file.conversationId}/${file.attachment?.id}`;
    if (!ids.has(file.conversationId) || !validPublicMetadata(file.attachment) || known.has(key) || Object.keys(file).some(key => !['conversationId', 'attachment', 'buffer', 'data'].includes(key))) throw Error('聊天附件备份格式或归属无效。');
    const bytes = backupBytes(file); if ((total += bytes.length) > 512 * 1024 * 1024) throw Error('聊天附件备份合计超过512MB。'); known.set(key, file.attachment);
  }
  for (const record of value.conversations) for (const turn of record.turns) for (const item of [...(turn.attachments || []), ...(turn.contextAttachments || [])]) { const actual = known.get(`${record.id}/${item.id}`); if (!actual || (['id', 'name', 'mimeType', 'bytes', 'kind', 'sha256', 'createdAt'].some(key => actual[key] !== item[key]) || JSON.stringify(actual.provenance || null) !== JSON.stringify(item.provenance || null))) throw Error('聊天备份缺少实际附件或引用信息不一致，尚未恢复。'); }
  return { ...clone({ version: 1, workspaceId: value.workspaceId, conversations: value.conversations }), ...(files.length ? { attachmentFiles: files.map(file => ({ conversationId: file.conversationId, attachment: clone(file.attachment), buffer: backupBytes(file) })) } : {}) };
}

function summary(record) {
  return { id: record.id, workspaceId: record.workspaceId, title: record.title, ...historyFields(record), createdAt: record.createdAt, updatedAt: record.updatedAt, turnCount: record.turns.length, ...(record.turns.some(isActive) ? { activeTurnId: record.turns.find(isActive).id } : {}) };
}
const publicTurn = turn => ({ ...Object.fromEntries(Object.entries(turn).filter(([key]) => !key.startsWith('_'))), streamSequence: turn._streamSequence || 0 });
function publicConversation(record) { return { version: 1, ...summary(record), turns: record.turns.map(publicTurn), ...(record.productions?.length ? { productions: clone(record.productions) } : {}) }; }
function blank(input) { const time = now(); return { version: 1, id: input.conversationId, workspaceId: input.workspaceId, title: '新对话', createdAt: time, updatedAt: time, turns: [] }; }
function checkedScope(input) {
  if (!input || !idValid(input.workspaceId) || !idValid(input.conversationId)) throw Error('对话或工作区编号无效。');
  return input;
}
function checkedStart(input) {
  checkedScope(input);
  if (!idValid(input.id) || !idValid(input.credentialId) || typeof input.text !== 'string' || !input.text.trim() && !input.attachmentIds?.length || input.text.length > 10000 || input.sourceTurnId !== undefined && !idValid(input.sourceTurnId)) throw Error('请输入不超过10000字的消息或添加附件，并选择可用账户。');
  if (input.attachmentIds !== undefined && (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > MAX_COUNT || input.attachmentIds.some(id => !idValid(id)) || new Set(input.attachmentIds).size !== input.attachmentIds.length)) throw Error('一次最多发送8份有效且不重复的本对话附件。');
  if (input.requestText !== undefined && (typeof input.requestText !== 'string' || !input.requestText.trim() || input.requestText.length > 20000)) throw Error('场景要求需为不超过20000字的有效文字。');
  if (input.mode !== undefined && !['chat', 'plan'].includes(input.mode) || input.outputKind !== undefined && !['image', 'word', 'ppt', 'excel'].includes(input.outputKind)) throw Error('对话模式或制作类型无效。');
  if (input.target !== undefined && !targetValid(input.target)) throw Error('修改目标或版本信息无效，请重新选择成品。');
  const { connection, model } = input;
  if (!connection || !model || connection.demo || model.demo || connection.enabled !== true || model.enabled !== true || model.connectionId !== connection.id || !idValid(connection.id) || !idValid(model.id) || !['openai-chat', 'openai-responses', 'anthropic', 'gemini'].includes(connection.protocol) || !Array.isArray(model.capabilities) || !model.capabilities.includes('text')) throw Error('请选择已启用的文字模型与对应服务。');
  if (typeof model.modelId !== 'string' || !model.modelId.trim() || model.modelId.length > 240 || typeof model.name !== 'string' || model.name.length > 240) throw Error('模型名称或真实模型ID无效。');
  const safeConnection = Object.fromEntries(['id', 'name', 'providerId', 'protocol', 'baseUrl', 'enabled', 'status'].filter(key => connection[key] !== undefined).map(key => [key, connection[key]]));
  const safeModel = { id: model.id, name: model.name, modelId: model.modelId, connectionId: model.connectionId, capabilities: [...model.capabilities], enabled: true, ...(model.pricing ? { pricing: clone(model.pricing) } : {}) };
  const result = { id: input.id, workspaceId: input.workspaceId, conversationId: input.conversationId, text: input.text.trim() || '请查看附件并说明其中的内容。', connection: safeConnection, model: safeModel, credentialId: input.credentialId, reasoningEffort: input.reasoningEffort || 'auto', mode: input.mode || 'chat', ...(input.outputKind ? { outputKind: input.outputKind } : {}), ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), ...(input.attachmentIds?.length ? { attachmentIds: [...input.attachmentIds] } : {}) };
  if (input.requestText !== undefined) result.requestText = input.requestText;
  if (input.target) result.target = clone(input.target);
  prepareChat(result, [{ role: 'user', content: result.requestText || result.text }]);
  return result;
}
function contextMessages(record, input) {
  const retryIndex = input.sourceTurnId ? record.turns.findIndex(turn => turn.id === input.sourceTurnId) : -1;
  const history = retryIndex >= 0 ? record.turns.slice(0, retryIndex) : record.turns;
  const turns = history.filter(turn => turn.status === 'complete' && (input.mode === 'plan' || (turn.mode || 'chat') === 'chat'));
  const productionFacts = (record.productions || []).slice(-8).map(link => `- ${link.sourceOnly ? '备份历史关联（仅供查看来源摘要）' : '已提交制作（完成状态请查看任务卡）'}：${JSON.stringify({ instruction: link.instruction.slice(0, 600), target: link.target, runId: link.sourceRunId || link.runId })}`).join('\n').slice(0, 6000);
  const currentText = (productionFacts ? `[应用制作记录，仅为提交事实，不能据此推断完成或重新执行；instruction 是用户原始要求]\n${productionFacts}\n\n本轮用户消息：\n` : '') + (input.requestText || input.text);
  const kept = []; let size = currentText.length;
  for (const turn of turns.slice(-24).reverse()) {
    const addition = (turn.requestText || turn.userText).length + turn.text.length;
    if (size + addition > 80000) break;
    const attachments = turn.contextAttachments?.length ? turn.contextAttachments : turn.attachments;
    kept.unshift({ role: 'user', content: turn.requestText || turn.userText, ...(attachments?.length ? { attachments } : {}) }, { role: 'assistant', content: turn.text }); size += addition;
  }
  return { messages: [...kept, { role: 'user', content: currentText }], truncated: kept.length < turns.length * 2 };
}
function entriesFor(record) {
  return record.turns.map(turn => ({ id: `chat-${signature([record.workspaceId, record.id, turn.id]).slice(0, 40)}`, workspaceId: record.workspaceId, scope: 'chat', conversationId: record.id,
    projectId: `chat-${record.id}`, projectName: `聊天 · ${record.title}`, action: turn.sourceTurnId ? '重新生成' : '初次生成', model: turn.modelName,
    costCents: turn.costCents, costState: turn.costState, ...(turn.calculation ? { calculation: clone(turn.calculation) } : {}), ...(turn.costReason ? { costReason: turn.costReason } : {}),
    ...(turn.usage ? { usage: clone(turn.usage) } : {}), ...(turn._billing?.billingRequestSnapshot ? { billingRequestSnapshot: clone(turn._billing.billingRequestSnapshot) } : {}),
    time: turn.createdAt, status: turn.status === 'running' ? 'processing' : turn.status === 'complete' ? 'complete' : turn.status === 'cancelled' ? 'cancelled' : 'failed', billingMode: 'live', quantity: 1 }));
}

function createChatService({ directory, credentialStore, fetchImpl = fetch, fxRates, onChanged = () => undefined, fileSystem = fs, execute = executeChat, cacheBudgetBytes = STORE_LIMIT, attachFiles, extractText, verifyProjectAttachment, previewImage, readAsset, readArtifact, documentSourceForArtifact, validateTarget, readRun, indexLimitBytes = STORE_LIMIT } = {}) {
  if (typeof credentialStore?.withSecret !== 'function' || typeof directory !== 'string' || !path.isAbsolute(directory)) throw TypeError('普通聊天缺少本地存储目录或凭证库。');
  const root = path.join(directory, 'chat-v1'), workspaces = new Map(), records = new Map(), workspaceLoads = new Map(), queues = new Map(), active = new Map(), dirty = new Map(), weights = new Map();
  let closing = false;
  const attachments = createChatAttachments({ directory, fileSystem, extractText });
  const feeCache = new Map(); let feeCacheBytes = 0;
  function cacheFees(key, entries) {
    const bytes = Buffer.byteLength(JSON.stringify(entries));
    if (feeCache.has(key)) { feeCacheBytes -= feeCache.get(key).bytes; feeCache.delete(key); }
    feeCache.set(key, { entries, bytes }); feeCacheBytes += bytes;
    for (const [oldKey, value] of feeCache) { if (feeCache.size <= 256 && feeCacheBytes <= 8 * 1024 * 1024) break; feeCacheBytes -= value.bytes; feeCache.delete(oldKey); }
  }
  async function attachmentContext(input, context, currentIds) {
    const byteLimit = input.connection.protocol === 'gemini' ? 14 * 1024 * 1024 : MAX_TOTAL;
    const indexed = currentIds.length ? await attachments.list(input) : [], selected = currentIds.map(id => indexed.find(item => item.id === id));
    if (selected.some(item => !item)) throw Error('附件不属于这段对话，请重新添加。');
    if (selected.reduce((sum, file) => sum + file.bytes, 0) > byteLimit) throw Error(input.connection.protocol === 'gemini' ? '本应用当前Gemini内联附件需为完整请求预留编码空间，请将附件合计缩小到14MB内。' : '本轮附件总大小超过80MB，请减少附件。');
    const current = []; for (const id of currentIds) current.push(await attachments.read(input, id));
    const messages = context.messages.map((message, index) => index === context.messages.length - 1 ? { ...message, ...(current.length ? { attachments: current } : {}) } : { ...message });
    const textSize = file => (file.extractedText?.length || (file.kind === 'text' ? file.buffer.toString('utf8').length : 0)) + (file.kind === 'text' || file.extractedText ? 300 : 0);
    const currentText = current.reduce((sum, file) => sum + textSize(file), 0);
    let trimmed = false;
    while (messages.length > 1 && messages.reduce((sum, message) => sum + message.content.length, 0) + currentText > 199000) { messages.splice(0, 2); trimmed = true; }
    const included = new Map(), skipped = []; let bytes = 0, pdfBytes = 0, textBytes = messages.reduce((sum, message) => sum + message.content.length, 0);
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]; if (!message.attachments?.length) continue;
      const kept = [];
      for (const item of message.attachments) {
        if (included.has(item.id)) continue;
        if (index !== messages.length - 1 && (included.size >= MAX_COUNT || bytes + item.bytes > byteLimit || item.mimeType === 'application/pdf' && pdfBytes + item.bytes >= 50 * 1024 * 1024 || (item.kind === 'image' || item.mimeType === 'application/pdf') && !input.model.capabilities.includes('vision'))) { skipped.push(item.name); continue; }
        let file;
        try { file = item.buffer ? item : await attachments.read(input, item.id); if (file.sha256 !== item.sha256 || file.bytes !== item.bytes) throw Error('changed'); }
        catch (cause) { if (index === messages.length - 1) throw cause; skipped.push(item.name); continue; }
        if (index !== messages.length - 1 && textBytes + textSize(file) > 199000) { skipped.push(item.name); continue; }
        included.set(file.id, file); bytes += file.bytes; textBytes += textSize(file); if (file.mimeType === 'application/pdf') pdfBytes += file.bytes; kept.push(file);
      }
      if (kept.length) message.attachments = kept; else delete message.attachments;
    }
    const prepared = await prepareChatMessages(input, messages), preparedRequest = compactChatRequest(prepareChat(input, prepared));
    const metadata = file => Object.fromEntries(['id', 'name', 'mimeType', 'bytes', 'kind', 'sha256', 'createdAt', 'provenance'].filter(key => file[key] !== undefined).map(key => [key, file[key]]));
    return { messages: execute === executeChat ? [] : prepared, preparedRequest, current: current.map(metadata), context: [...included.values()].map(metadata), trimmed, ...(skipped.length ? { notice: `本轮未带入部分较早的附件（超出数量/大小限制、当前模型不支持或原文件不可用）：${[...new Set(skipped)].slice(0, 4).join('、')}。可重新添加并选择支持看图的模型。` } : {}) };
  }
  const recordWeight = record => 1024 + record.turns.reduce((sum, turn) => sum + 4096 + 2 * (turn.userText.length + turn.text.length), 0);
  const cachedBytes = () => [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const emit = (record, ledgerChanged = false, changedTurn = record.turns.at(-1)) => { const key = `${record.workspaceId}/${record.id}`; if (records.has(key)) weights.set(key, recordWeight(record)); try { onChanged({ workspaceId: record.workspaceId, conversationId: record.id, ledgerChanged, ...(changedTurn ? { turn: clone(publicTurn(changedTurn)) } : {}), title: record.title, updatedAt: record.updatedAt }); } catch { /* A renderer cannot interrupt persistence. */ } };
  function emitStream(record, turn, operation) {
    const previous = operation.emittedText || '';
    turn._streamSequence = (turn._streamSequence || 0) + 1;
    operation.emittedText = turn.text;
    if (!turn.text.startsWith(previous)) { emit(record); return; }
    const key = `${record.workspaceId}/${record.id}`; if (records.has(key)) weights.set(key, recordWeight(record));
    try { onChanged({ workspaceId: record.workspaceId, conversationId: record.id, ledgerChanged: false, title: record.title, updatedAt: record.updatedAt, stream: { turnId: turn.id, sequence: turn._streamSequence, textOffset: previous.length, textDelta: turn.text.slice(previous.length) } }); }
    catch { /* A free read recovers dropped or interrupted rendering events. */ }
  }
  const filename = input => path.join(root, input.workspaceId, `${input.conversationId}.conversation.json`);
  const indexFile = workspaceId => path.join(root, workspaceId, 'index.json');
  const pendingFile = workspaceId => path.join(root, workspaceId, 'pending.json');
  const indexValue = (state, items = state.items, revision = state.revision) => ({ version: 2, workspaceId: state.workspaceId, revision, items: [...items.values()] });
  function checkSize(value, label, limit = STORE_LIMIT) { if (Buffer.byteLength(JSON.stringify(value, null, 2) + '\n') > limit) throw Error(`${label}已达到保存容量上限（默认32MB），原记录与费用保留；请先导出记录并整理，不会发送新请求。`); }
  function serial(workspaceId, operation) {
    const next = (queues.get(workspaceId) || Promise.resolve()).catch(() => undefined).then(operation); queues.set(workspaceId, next);
    return next.finally(() => { if (queues.get(workspaceId) === next) queues.delete(workspaceId); });
  }
  async function readJson(file, limit = 32 * 1024 * 1024) {
    const stat = await checkedFile(fileSystem, file); if (stat.size > limit) throw Error('聊天记录过大，原文件已保留，请导出后再整理。');
    return JSON.parse(await fileSystem.readFile(file, 'utf8'));
  }
  const feeFile = (workspaceId, conversationId, key) => {
    if (!idValid(workspaceId) || !idValid(conversationId) || !/^[a-f0-9]{64}$/.test(key)) throw Error('聊天费用快照编号无效。');
    return path.join(root, workspaceId, 'fees', conversationId, key + '.json');
  };
  async function writeFees(workspaceId, conversationId, entries) {
    if (!feeEntriesValid(entries, workspaceId, conversationId)) throw Error('聊天费用快照格式无效，原费用保留。');
    const value = { version: 1, workspaceId, conversationId, entries }, key = signature(value), file = feeFile(workspaceId, conversationId, key); checkSize(value, '聊天费用快照');
    try { const existing = await readJson(file); if (signature(existing) !== key) throw Error('费用快照内容已变化，未覆盖原数据。'); }
    catch (error) { if (!missingFile(error)) throw error; await atomicJson(fileSystem, file, value); }
    cacheFees(key, entries); return key;
  }
  async function feesForInfo(workspaceId, info) {
    if (info.ledger) return clone(info.ledger);
    if (feeCache.has(info.ledgerKey)) { const value = feeCache.get(info.ledgerKey); feeCache.delete(info.ledgerKey); feeCache.set(info.ledgerKey, value); return value.entries; }
    let value;
    try { value = await readJson(feeFile(workspaceId, info.id, info.ledgerKey)); }
    catch (error) {
      const current = workspaces.get(workspaceId)?.items.get(info.id);
      if (missingFile(error) && current?.ledgerKey && current.ledgerKey !== info.ledgerKey) return feesForInfo(workspaceId, current);
      throw Error('聊天费用快照暂时无法读取，已有金额未按零处理，请恢复原文件或备份。');
    }
    if (value?.version !== 1 || value.workspaceId !== workspaceId || value.conversationId !== info.id || signature(value) !== info.ledgerKey || !feeEntriesValid(value.entries, workspaceId, info.id)) throw Error('聊天费用快照校验失败，原数据没有被覆盖。');
    cacheFees(info.ledgerKey, value.entries); return value.entries;
  }
  async function infoForRecord(record) { return { ...summary(record), recordHash: signature(record), ledgerKey: await writeFees(record.workspaceId, record.id, entriesFor(record)) }; }
  async function compactItems(workspaceId, items) {
    const result = new Map();
    for (const [id, info] of items) {
      if (!info.ledger) { result.set(id, info); continue; }
      const { ledger, ...metadata } = info; result.set(id, { ...metadata, ledgerKey: await writeFees(workspaceId, id, ledger) });
    }
    return result;
  }
  async function retireFees(workspaceId, conversationId, keep) {
    const folder = path.dirname(feeFile(workspaceId, conversationId, keep[0]));
    try {
      for (const entry of await fileSystem.readdir(folder, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name) || keep.includes(entry.name.slice(0, -5))) continue;
        const file = path.join(folder, entry.name), value = await readJson(file);
        if (signature(value) === entry.name.slice(0, -5)) await fileSystem.unlink(file);
      }
    } catch { /* Cleanup never removes a current snapshot or interrupts a committed response. */ }
  }
  async function recoverPending(state) {
    let pending;
    try { pending = await readJson(pendingFile(state.workspaceId), 8192); } catch (error) { if (missingFile(error)) return; throw Error('聊天保存事务无法读取，原记录与费用没有被覆盖。'); }
    if (![1, 2].includes(pending?.version) || pending.workspaceId !== state.workspaceId || !idValid(pending.conversationId) || !Number.isSafeInteger(pending.revision) || pending.revision < 1 || !/^[a-f0-9]{64}$/.test(pending.recordHash || '')) throw Error('聊天保存事务格式无效，原记录与费用没有被覆盖。');
    if (pending.version === 2 && (pending.info?.id !== pending.conversationId || pending.info.recordHash !== pending.recordHash || !indexValid({ version: 2, workspaceId: state.workspaceId, items: [pending.info] }, state.workspaceId))) throw Error('聊天保存事务摘要无效，原记录与费用没有被覆盖。');
    if (pending.revision > state.revision) {
      if (pending.revision !== state.revision + 1) throw Error('聊天记录版本不连续，原记录与费用没有被覆盖。');
      let record;
      try { record = await readJson(filename(pending)); } catch (error) { if (!missingFile(error) && pending.version !== 2) throw error; }
      const validRecord = record && signature(record) === pending.recordHash && recordValid(record, pending);
      if (validRecord || pending.version === 2) {
        const items = await compactItems(state.workspaceId, state.items);
        if (validRecord) items.set(record.id, await infoForRecord(record));
        else {
          const info = clone(pending.info), ledger = await feesForInfo(state.workspaceId, info);
          delete info.activeTurnId;
          info.ledgerKey = await writeFees(state.workspaceId, info.id, ledger.map(entry => entry.status === 'processing' ? { ...entry, status: 'failed', costState: 'unknown', costReason: '聊天源文件未完整保存，已有费用仍保留；不会自动重发。' } : entry));
          items.set(info.id, info);
        }
        const value = indexValue(state, items, pending.revision); checkSize(value, '当前工作区的聊天索引', indexLimitBytes);
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
    const info = (await loadWorkspace(input.workspaceId)).items.get(input.conversationId);
    if (info?.recordHash && signature(value) !== info.recordHash) { const error = Error('这段聊天原文件已在应用外变化，原费用保留；请恢复备份或新建对话。'); error.code = 'CHAT_RECORD_CHANGED'; throw error; }
    if (info) { for (const field of ['pinned', 'archivedAt', 'trashedAt']) { if (info[field] === undefined) delete value[field]; else value[field] = info[field]; } value.title = info.title; }
    cache(value); return value;
  }
  async function persist(record, { preserveCache = false } = {}) {
    const state = await loadWorkspace(record.workspaceId); await recoverPending(state);
    for (const turn of record.turns) delete turn.saveIssue;
    const previousKey = state.items.get(record.id)?.ledgerKey;
    const info = await infoForRecord(record);
    const items = await compactItems(record.workspaceId, state.items); items.set(record.id, info);
    if (items.size > HISTORY_LIMIT) throw Error('聊天索引已达到保存上限，请先导出和整理记录；已有费用保留。');
    const nextRevision = state.revision + 1, nextIndex = indexValue(state, items, nextRevision);
    if (!Number.isSafeInteger(nextRevision)) throw Error('聊天存储版本已达到上限，原记录与费用保留。');
    checkSize(record, '这段聊天'); checkSize(nextIndex, '当前工作区的聊天索引', indexLimitBytes);
    let recordWritten = false;
    try {
      await atomicJson(fileSystem, pendingFile(record.workspaceId), { version: 2, workspaceId: record.workspaceId, conversationId: record.id, revision: nextRevision, recordHash: signature(record), info });
      await atomicJson(fileSystem, filename({ workspaceId: record.workspaceId, conversationId: record.id }), record); recordWritten = true;
      await atomicJson(fileSystem, indexFile(record.workspaceId), nextIndex);
    } catch (error) { if (recordWritten) error.chatRecordWritten = true; throw error; }
    state.items = items; state.revision = nextRevision; if (!preserveCache) cache(record); dirty.delete(`${record.workspaceId}/${record.id}`);
    try { await fileSystem.unlink(pendingFile(record.workspaceId)); } catch { /* The revision makes replay of a committed journal harmless. */ }
    await retireFees(record.workspaceId, record.id, [info.ledgerKey, previousKey].filter(Boolean));
  }
  async function recover(workspaceId) {
    const state = await loadWorkspace(workspaceId); if (state.recovered) return; state.recovered = true;
    try {
      for (const info of state.items.values()) {
        const key = `${workspaceId}/${info.id}`; if (!info.activeTurnId || active.has(key)) continue;
        let record;
        try { record = clone(await loadRecord({ workspaceId, conversationId: info.id })); }
        catch (error) {
          if (!['CHAT_RECORD_MISSING', 'CHAT_RECORD_CHANGED'].includes(error.code)) throw error;
          const items = new Map(state.items), unavailable = { ...info, ledger: (await feesForInfo(workspaceId, info)).map(entry => entry.status === 'processing' ? { ...entry, status: 'failed', costState: 'unknown', costReason: '聊天原文件丢失，尚未返回完整用量；已发生的其他费用保留。' } : entry) }; delete unavailable.activeTurnId;
          items.set(info.id, unavailable); const compact = await compactItems(workspaceId, items), value = indexValue(state, compact, state.revision + 1); checkSize(value, '当前工作区的聊天索引', indexLimitBytes); await atomicJson(fileSystem, indexFile(workspaceId), value); state.items = compact; state.revision++; continue;
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
      const preparedRequest = operation.preparedRequest; delete operation.preparedRequest;
      const result = await execute(input, messages, { credentialStore, fetchImpl, preparedRequest, signal: operation.controller.signal, onText: text => {
        const record = records.get(key), turn = record?.turns.find(item => item.id === input.id); if (!turn || !isActive(turn)) return;
        turn.text = text; turn.updatedAt = now(); record.updatedAt = turn.updatedAt;
        if (Date.now() - operation.emittedAt >= 100) { operation.emittedAt = Date.now(); emitStream(record, turn, operation); }
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
      if (record.trashedAt) throw Error('这段聊天已移入回收站，请先恢复后再发送；已有费用保留。');
      if (input.target) await inspectTarget({ workspaceId: input.workspaceId, target: input.target });
      if (record.turns.length >= 300) throw Error('这段聊天已经很长，请新建对话，原记录与费用保留。');
      const key = keyOf(input);
      if (active.has(key) || record.turns.some(isActive)) throw Error('这段对话正在回答，可以停止后再发送；输入已保留。');
      if (active.size >= 2) throw Error('已有两段对话正在回答，请稍候或先停止其中一段；输入已保留。');
      if (input.sourceTurnId && !record.turns.some(turn => turn.id === input.sourceTurnId && !isActive(turn))) throw Error('找不到要重试的原消息，请重新编辑后发送。');
      const original = input.sourceTurnId && record.turns.find(turn => turn.id === input.sourceTurnId);
      const currentIds = input.attachmentIds || original?.attachments?.map(item => item.id) || [];
      const context = contextMessages(record, input), material = await attachmentContext(input, context, currentIds), createdAt = now(), fx = await fxRates?.get(createdAt);
      const billing = { modelId: input.model.modelId, connection: input.connection, operation: 'text', startedAt: createdAt, pricing: input.model.pricing, fx };
      billing.ruleSnapshot = resolveOfficialBillingRule(billing, billing.pricing);
      const turn = { id: input.id, userText: input.text, text: '', status: 'running', createdAt, updatedAt: createdAt, modelName: input.model.name, modelId: input.model.modelId, modelConfigId: input.model.id, credentialId: input.credentialId, reasoningEffort: input.reasoningEffort, mode: input.mode, ...(input.outputKind ? { outputKind: input.outputKind } : {}), ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), ...(context.truncated ? { contextTruncated: true } : {}), costCents: 0, costState: 'unknown', _fingerprint: fingerprint, _requestStarted: true, _billing: billing };
      if (input.requestText) turn.requestText = input.requestText;
      if (material.current.length) turn.attachments = material.current;
      if (material.context.length) turn.contextAttachments = material.context;
      if (material.notice) { turn.attachmentNotice = material.notice; turn.contextTruncated = true; }
      if (material.trimmed) turn.contextTruncated = true;
      if (input.target) turn.target = clone(input.target);
      delete record.archivedAt;
      if (!record.turns.length) record.title = input.text.replace(/\s+/g, ' ').slice(0, 36);
      record.turns.push(turn); record.updatedAt = createdAt;
      if (closing || active.size >= 2) throw Error('对话服务正在忙，请稍候再发送；输入已保留。');
      const operation = { turnId: input.id, controller: new AbortController(), emittedAt: 0, emittedText: '', checkpointAt: Date.now(), checkpoint: undefined, task: undefined, preparedRequest: material.preparedRequest }; active.set(key, operation);
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
      operation.task = pump(input, operation, material.messages).catch(() => { const saved = records.get(key); if (saved) emit(saved, true); }).finally(() => { if (active.get(key) === operation) active.delete(key); });
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
    for (const id of ids) for (const item of (await loadWorkspace(id)).items.values()) for (const entry of await feesForInfo(id, item)) result.set(entry.id, clone(entry));
    for (const [key, record] of records) if (ids.includes(record.workspaceId) && (active.has(key) || dirty.has(key))) for (const entry of entriesFor(record)) result.set(entry.id, entry);
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
  async function inspectTarget(input, loadedFile) {
    if (!input || !idValid(input.workspaceId) || !targetValid(input.target) || typeof readArtifact !== 'function') throw Error('请选择本工作区中可读取的成品与版本。');
    if (validateTarget && await validateTarget(input) === false) throw Error('修改目标已变化，请重新选择当前成品。');
    const target = input.target, file = loadedFile || await readArtifact({ workspaceId: input.workspaceId, projectId: target.projectId, artifactId: target.artifactId });
    if (!file || !(file.buffer instanceof Uint8Array) || file.projectId !== target.projectId || file.id !== target.artifactId || file.trashedAt || file.unavailable) throw Error('目标成品已不可用，请重新选择；尚未调用模型。');
    const digest = createHash('sha256').update(file.buffer).digest('hex');
    if (digest !== target.sha256) throw Error('目标文件已变化，请重新选择文件与版本；不会自动换成新版或收费。');
    const expected = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    if (target.kind === 'image' ? !file.mimeType?.startsWith('image/') : file.mimeType !== expected[target.kind]) throw Error('目标文件类型与所选工作台不一致。');
    const bytes = Buffer.from(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
    if (!bytes.length || bytes.length > 100 * 1024 * 1024 || (target.kind === 'image' ? imageType(bytes).mimeType !== file.mimeType : bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)) throw Error('目标文件实际格式与记录不一致，请重新选择有效成品。');
    const artifact = Object.fromEntries(['id', 'projectId', 'name', 'mimeType', 'bytes', 'kind', 'createdAt', 'path', 'provenance'].filter(key => file[key] !== undefined).map(key => [key, file[key]]));
    artifact.bytes = bytes.length;
    const source = documentSourceForArtifact ? await documentSourceForArtifact({ ...input, artifact, file }) : undefined;
    if (source?.documentSource !== undefined && (typeof source.documentSource !== 'string' || source.documentSource.length > 2 * 1024 * 1024)) throw Error('编辑源过大或无效，请在工作台中查看。');
    if (source?.sourceRevision !== undefined && (!Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 1)) throw Error('文件绑定的编辑版本无法确认。');
    if (target.editorRevision !== undefined && source?.sourceRevision !== target.editorRevision) throw Error('目标文件绑定的编辑版本已变化，请重新选择，尚未调用模型。');
    return { artifact, sha256: digest, ...(source?.documentSource !== undefined ? { documentSource: source.documentSource } : {}), ...(source?.sourceRevision !== undefined ? { sourceRevision: source.sourceRevision } : {}) };
  }
  async function selectTarget(input) {
    if (!input || !idValid(input.workspaceId) || !idValid(input.projectId) || !idValid(input.artifactId) || !['image', 'word', 'ppt', 'excel'].includes(input.kind) || typeof readArtifact !== 'function') throw Error('请选择本工作区的图片或Office成品。');
    const file = await readArtifact({ workspaceId: input.workspaceId, projectId: input.projectId, artifactId: input.artifactId });
    if (!(file?.buffer instanceof Uint8Array)) throw Error('目标成品已不可用，请重新选择；尚未调用模型。');
    const target = { projectId: input.projectId, artifactId: input.artifactId, kind: input.kind, sha256: createHash('sha256').update(file.buffer).digest('hex') };
    const inspection = await inspectTarget({ workspaceId: input.workspaceId, target }, file);
    if (inspection.sourceRevision !== undefined) target.editorRevision = inspection.sourceRevision;
    return { target, inspection };
  }
  async function importSource(input, kind) {
    checkedScope(input); if (closing) throw Error('应用正在退出，没有添加新材料。');
    if (kind === 'asset' && (typeof input.assetId !== 'string' || !input.assetId || input.assetId.length > 240 || input.builtin !== undefined && typeof input.builtin !== 'boolean' || typeof readAsset !== 'function')) throw Error('请选择可用素材。');
    if (kind === 'project' && (!idValid(input.projectId) || !idValid(input.artifactId) || typeof readArtifact !== 'function')) throw Error('请选择当前工作区的项目文件。');
    return serial(input.workspaceId, async () => {
      const file = await (kind === 'asset' ? readAsset({ workspaceId: input.workspaceId, assetId: input.assetId, builtin: input.builtin === true }) : readArtifact({ workspaceId: input.workspaceId, projectId: input.projectId, artifactId: input.artifactId }));
      if (!file || !(file.buffer instanceof Uint8Array) || file.trashedAt || file.unavailable || kind === 'project' && (file.projectId !== input.projectId || file.id !== input.artifactId)) throw Error('所选材料已不可用，尚未添加或调用模型。');
      const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json' };
      const suffix = extensions[file.mimeType]; if (!suffix) throw Error('此格式暂不能直接作为聊天材料，请先转换为图片、PDF或正文资料。');
      let name = path.basename(typeof file.name === 'string' && file.name ? file.name : '聊天材料');
      if (!name.toLowerCase().endsWith(suffix) && !(file.mimeType === 'image/jpeg' && name.toLowerCase().endsWith('.jpeg'))) name = name.slice(0, 220) + suffix;
      return attachments.importBytes(input, [{ name, mimeType: file.mimeType, bytes: file.buffer, ...(file.provenance ? { provenance: file.provenance } : {}) }]);
    });
  }
  async function searchHistory(raw) {
    const input = checkedHistory(raw); await queues.get(input.workspaceId)?.catch(() => undefined); await recover(input.workspaceId);
    const pool = historyCandidates((await loadWorkspace(input.workspaceId)).items.values(), input.scope), items = [];
    let cursor = input.cursor, scanned = 0, textBudget = 0;
    while (cursor < pool.length && scanned < 100 && items.length < input.limit && textBudget < 8 * 1024 * 1024) {
      const info = pool[cursor++]; scanned++; let matched = !input.query || normalizeHistory(info.title).includes(input.query), matchSnippet;
      if (!matched) {
        try {
          const record = await loadRecord({ workspaceId: input.workspaceId, conversationId: info.id });
          for (const turn of record.turns) {
            textBudget += turn.userText.length + turn.text.length;
            const text = turn.userText + '\n' + turn.text, normalized = normalizeHistory(text), index = normalized.indexOf(input.query);
            if (index >= 0) { matched = true; matchSnippet = text.slice(Math.max(0, index - 25), index + 130); break; }
          }
          if (!matched) for (const production of record.productions || []) { textBudget += production.instruction.length; const index = normalizeHistory(production.instruction).indexOf(input.query); if (index >= 0) { matched = true; matchSnippet = production.instruction.slice(Math.max(0, index - 25), index + 130); break; } }
        } catch (error) { if (!['CHAT_RECORD_MISSING', 'CHAT_RECORD_CHANGED'].includes(error.code)) throw error; }
      }
      if (matched) { const { ledger: _ledger, ledgerKey: _ledgerKey, recordHash: _recordHash, ...item } = info; items.push({ ...clone(item), ...(matchSnippet ? { matchSnippet } : {}) }); }
    }
    return { items, total: pool.length, scanned, ...(cursor < pool.length ? { nextCursor: cursor } : {}) };
  }
  async function manageHistory(raw) {
    const input = checkedManage(raw); await recover(input.workspaceId);
    return serial(input.workspaceId, async () => {
      const key = keyOf(input), state = await loadWorkspace(input.workspaceId), info = state.items.get(input.conversationId);
      if (!info) throw Error('这段聊天尚未保存，不能整理空白会话。');
      if (active.has(key) || info.activeTurnId) throw Error('这段对话仍在回答，请先停止后再整理；不会自动取消或重发。');
      if (dirty.has(key)) throw Error('这段对话尚未可靠保存，请先免费重试保存后再整理。');
      let record;
      try { record = clone(await loadRecord(input)); }
      catch (error) {
        if (!['CHAT_RECORD_MISSING', 'CHAT_RECORD_CHANGED'].includes(error.code)) throw error;
        const next = applyHistory(clone(info), input, now()), items = new Map(state.items);
        if (input.action === 'rename') { const ledger = (await feesForInfo(input.workspaceId, info)).map(entry => ({ ...entry, projectName: `聊天 · ${next.title}` })); delete next.ledger; next.ledgerKey = await writeFees(input.workspaceId, next.id, ledger); }
        items.set(next.id, next);
        const compact = await compactItems(input.workspaceId, items), value = indexValue(state, compact, state.revision + 1); checkSize(value, '聊天索引', indexLimitBytes); await atomicJson(fileSystem, indexFile(input.workspaceId), value); state.items = compact; state.revision++;
        const { ledger: _ledger, ledgerKey: _ledgerKey, recordHash: _recordHash, ...summary } = next; const result = { version: 1, ...summary, turns: [], unavailableReason: '原聊天文件已丢失，原费用记录仍保留。' };
        try { onChanged({ workspaceId: input.workspaceId, conversationId: input.conversationId, ledgerChanged: input.action === 'rename', historyChanged: true, title: next.title, updatedAt: next.updatedAt }); } catch { /* The index remains saved. */ }
        return result;
      }
      applyHistory(record, input, now()); await persist(record); emit(record, input.action === 'rename');
      try { onChanged({ workspaceId: input.workspaceId, conversationId: input.conversationId, ledgerChanged: false, historyChanged: true, title: record.title, updatedAt: record.updatedAt }); } catch { /* The saved history does not depend on rendering. */ }
      return publicConversation(record);
    });
  }
  async function linkProduction(input) {
    checkedScope(input);
    if (!idValid(input.runId) || !targetValid(input.target) || typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 10000 || typeof readRun !== 'function') throw Error('制作关联信息无效，请先读取已提交的任务；不会重复制作。');
    return serial(input.workspaceId, async () => {
      const record = clone(await loadRecord(input)), existing = record.productions?.find(item => item.runId === input.runId);
      if (existing) { if (signature(existing.target) !== signature(input.target) || existing.instruction !== input.instruction.trim()) throw Error('这项制作已关联不同修改目标，原费用与内容保留。'); return publicConversation(record); }
      if (record.trashedAt) throw Error('请先恢复聊天，再关联已有制作；不会自动重做。');
      const inspection = await inspectTarget(input), run = await readRun(input.runId), first = run?.snapshot?.steps?.find(step => step.enabled !== false);
      const transformed = input.target.kind === 'image' && ['image/svg+xml', 'image/gif'].includes(inspection.artifact.mimeType) && run?.snapshot?.sourceArtifactTarget?.id === input.target.artifactId && run.snapshot.sourceArtifactTarget.sha256 === input.target.sha256 && first?.referenceArtifactIds?.length;
      if (!run || run.id !== input.runId || run.mode !== 'live' || run.workspaceId !== input.workspaceId || run.projectId !== input.target.projectId || ['automation-plan', 'business-assist'].includes(run.purpose) || !first?.referenceArtifactIds?.includes(input.target.artifactId) && !transformed) throw Error('制作任务没有绑定当前成品，尚未关联；请读取正确任务。');
      if (transformed && !first.referenceArtifactIds.includes(input.target.artifactId)) {
        const reference = await readArtifact({ workspaceId: input.workspaceId, projectId: input.target.projectId, artifactId: first.referenceArtifactIds[0] });
        if (!reference || reference.projectId !== input.target.projectId || reference.mimeType !== 'image/png' || reference.trashedAt || reference.unavailable || !(reference.buffer instanceof Uint8Array)) throw Error('转换后的静态参照已不可用，制作关联尚未保存。');
      }
      if ((record.productions?.length || 0) >= 1000) throw Error('本段聊天关联制作较多，请新建对话，原记录与费用保留。');
      record.productions = [...(record.productions || []), { runId: input.runId, target: clone(input.target), instruction: input.instruction.trim(), createdAt: now() }];
      if (!record.turns.length && record.title === '新对话') record.title = input.instruction.trim().replace(/\s+/g, ' ').slice(0, 36);
      record.updatedAt = now(); await persist(record); emit(record);
      return publicConversation(record);
    });
  }
  async function validateRestore(value) {
    const snapshot = validateWorkspaceSnapshot(value); await recover(snapshot.workspaceId);
    if ([...active.keys()].some(key => key.startsWith(`${snapshot.workspaceId}/`)) || [...dirty.keys()].some(key => key.startsWith(`${snapshot.workspaceId}/`))) throw Error('请先结束本工作区的回答并保存记录，再恢复聊天备份。');
    const state = await loadWorkspace(snapshot.workspaceId), items = new Map([...state.items].map(([id, info]) => { const { ledger: _ledger, ...metadata } = info; return [id, { ...metadata, ledgerKey: metadata.ledgerKey || '0'.repeat(64) }]; }));
    for (const record of snapshot.conversations) {
      if (state.items.has(record.id)) { const existing = await loadRecord({ workspaceId: snapshot.workspaceId, conversationId: record.id }), sameOrigin = record._importOrigin && existing._importOrigin && signature(record._importOrigin) === signature(existing._importOrigin); if (!sameOrigin && signature(existing) !== signature(record)) throw Error('当前工作区已有不同内容的同名聊天编号，尚未恢复任何聊天；原记录和费用不会被覆盖。'); }
      items.set(record.id, { ...summary(record), recordHash: signature(record), ledgerKey: '0'.repeat(64) });
    }
    if (items.size > HISTORY_LIMIT) throw Error('恢复后聊天数量超过保存上限，尚未恢复任何聊天。'); checkSize(indexValue(state, items), '恢复后的聊天索引', indexLimitBytes);
    return snapshot;
  }
  return {
    start, search: searchHistory, manage: manageHistory, selectTarget, inspectTarget, linkProduction,
    importAsset: input => importSource(input, 'asset'), importProjectArtifact: input => importSource(input, 'project'),
    async importBytes(input) { checkedScope(input); if (closing) throw Error('应用正在退出，没有添加新附件。'); return serial(input.workspaceId, () => attachments.importBytes(input, input.files)); },
    async importAttachments(input) { checkedScope(input); if (closing) throw Error('应用正在退出，没有导入新附件。'); return serial(input.workspaceId, () => attachments.importPaths(input, input.paths)); },
    async previewAttachment(input) {
      checkedScope(input); const file = await attachments.read(input, input.attachmentId);
      if (file.kind === 'image') {
        if (previewImage) { const value = await previewImage(file); if (!value || !/^data:image\/(?:png|jpeg|webp);base64,/.test(value.dataUrl || '') || value.dataUrl.length > 4 * 1024 * 1024 || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 1024 || value.height > 1024) throw Error('图片缩略预览未能准备完成，原图和发送设置保留。'); return value; }
        const dimensions = require('./image-output-formats.cjs').rasterDimensions(file.buffer);
        if (file.bytes > 2 * 1024 * 1024 || dimensions.width * dimensions.height > 8000000) throw Error('这张图较大，需要桌面应用的缩略预览；原图仍可正常发送和用于制作。');
        return { mimeType: file.mimeType, dataUrl: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`, width: dimensions.width, height: dimensions.height };
      }
      if (file.kind === 'text') return { mimeType: file.mimeType, text: new TextDecoder('utf-8', { fatal: true }).decode(file.buffer).slice(0, 100000) };
      if (file.extractedText) return { mimeType: file.mimeType, text: file.extractedText };
      return { mimeType: file.mimeType };
    },
    async attachToProject(input) { checkedScope(input); if (closing) throw Error('应用正在退出，没有复制新附件。'); return serial(input.workspaceId, () => attachments.copyToProject(input, input.attachmentIds, input.projectId, attachFiles, verifyProjectAttachment)); },
    async list(workspaceId) { await recover(workspaceId); return [...(await loadWorkspace(workspaceId)).items.values()].map(({ ledger: _ledger, ledgerKey: _ledgerKey, recordHash: _recordHash, ...info }) => clone(info)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async read(input) { checkedScope(input); if (!records.has(keyOf(input))) await queues.get(input.workspaceId)?.catch(() => undefined); await recover(input.workspaceId); return publicConversation(await loadRecord(input)); },
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
        const conversations = [], attachmentFiles = [];
        for (const info of (await loadWorkspace(workspaceId)).items.values()) {
          const record = clone(await loadRecord({ workspaceId, conversationId: info.id })); conversations.push(record);
          const refs = new Set(record.turns.flatMap(turn => [...(turn.attachments || []), ...(turn.contextAttachments || [])]).map(item => item.id));
          for (const id of refs) { const file = await attachments.read({ workspaceId, conversationId: info.id }, id); attachmentFiles.push({ conversationId: info.id, attachment: Object.fromEntries(['id', 'name', 'mimeType', 'bytes', 'kind', 'sha256', 'createdAt', 'provenance'].filter(key => file[key] !== undefined).map(key => [key, file[key]])), buffer: file.buffer }); }
        }
        return { version: 1, workspaceId, conversations, ...(attachmentFiles.length ? { attachmentFiles } : {}) };
      });
    },
    async restoreWorkspace(value) {
      const snapshot = await validateRestore(value);
      return serial(snapshot.workspaceId, async () => {
        await validateRestore(snapshot); const state = await loadWorkspace(snapshot.workspaceId); let restored = 0, skipped = 0;
        for (const record of snapshot.conversations) { const files = (snapshot.attachmentFiles || []).filter(file => file.conversationId === record.id); if (files.length) await attachments.restore({ workspaceId: snapshot.workspaceId, conversationId: record.id }, files); if (state.items.has(record.id)) { skipped++; continue; } for (const turn of record.turns.filter(isActive)) { turn.status = 'interrupted'; turn.error = '从备份恢复了未结束的回答，不会自动继续或重发。'; turn.costState = 'unknown'; } await persist(record); restored++; emit(record, true); }
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
