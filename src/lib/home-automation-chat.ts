import type { NaturalAutomationBindings } from './natural-automation-plan';
import { normalizeNaturalBinding, normalizeNaturalBindings } from './natural-model-bindings';

export interface HomeAutomationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind: 'request' | 'plan' | 'answer' | 'created' | 'status' | 'error';
  text: string;
  createdAt: string;
  requestId?: string;
  runId?: string;
  ruleId?: string;
  workflowId?: string;
  productionRunIds?: string[];
  modelName?: string;
  steps?: string[];
  question?: string;
  requestText?: string;
}
export interface HomeAutomationInitialContext { projectId?: string; planner: { modelConfigId?: string; credentialId?: string }; bindings?: NaturalAutomationBindings; }
export interface HomeAutomationConversation { version: 1; id: string; workspaceId: string; title: string; createdAt: string; updatedAt: string; billingProjectId?: string; initialContext?: HomeAutomationInitialContext; messages: HomeAutomationMessage[]; }
export interface HomeAutomationChatIndex { version: 1; workspaceId: string; activeId: string; items: { id: string; title: string; createdAt: string; updatedAt: string }[]; }
export const homeChatKey = (workspaceId: string, conversationId: string) => `xuzuo-home-chat-v1:${workspaceId}:${conversationId}`;
export const homeChatIndexKey = (workspaceId: string) => `xuzuo-home-chat-index-v1:${workspaceId}`;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
export function normalizeHomeInitialContext(value: HomeAutomationInitialContext): HomeAutomationInitialContext {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['projectId', 'planner', 'bindings'].includes(key)) || value.projectId !== undefined && value.projectId !== '' && !validId(value.projectId)) throw Error('这段对话的初始配置无法可靠读取，原记录未覆盖。');
  return { ...(value.projectId ? { projectId: value.projectId } : {}), planner: normalizeNaturalBinding(value.planner), ...(value.bindings !== undefined ? { bindings: normalizeNaturalBindings(value.bindings) } : {}) };
}
export function newHomeConversation(workspaceId: string, id: string = crypto.randomUUID()): HomeAutomationConversation {
  const now = new Date().toISOString();
  return { version: 1, workspaceId, id, title: '新对话', createdAt: now, updatedAt: now, messages: [] };
}
export function readHomeChatIndex(storage: Pick<Storage, 'getItem'>, workspaceId: string): HomeAutomationChatIndex | undefined {
  const raw = storage.getItem(homeChatIndexKey(workspaceId)); if (!raw) return undefined;
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.workspaceId !== workspaceId || !validId(value.activeId) || !Array.isArray(value.items) || value.items.length > 200 || value.items.some((item: unknown) => !item || typeof item !== 'object' || !validId((item as { id?: unknown }).id) || typeof (item as { title?: unknown }).title !== 'string') || !value.items.some((item: { id: string }) => item.id === value.activeId)) throw Error('首页对话目录暂时无法读取，原记录未覆盖。');
  return value;
}
export function readHomeConversation(storage: Pick<Storage, 'getItem'>, workspaceId: string, id: string): HomeAutomationConversation {
  if (!validId(id)) throw Error('对话编号无效。');
  const raw = storage.getItem(homeChatKey(workspaceId, id));
  if (!raw || raw.length > 1600000) throw Error('这段对话暂时无法可靠读取，原记录未覆盖。');
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.workspaceId !== workspaceId || value.id !== id || !Array.isArray(value.messages) || value.messages.length > 300 || typeof value.title !== 'string' || value.messages.some((message: HomeAutomationMessage) => !message || !validId(message.id) || !['user', 'assistant', 'system'].includes(message.role) || !['request', 'plan', 'answer', 'created', 'status', 'error'].includes(message.kind) || typeof message.text !== 'string' || message.text.length > 20000 || !Number.isFinite(Date.parse(message.createdAt)))) throw Error('这段对话的结构无法可靠读取，原记录未覆盖。');
  if (value.billingProjectId !== undefined && !validId(value.billingProjectId) || value.messages.some((message: HomeAutomationMessage) => [message.requestId, message.runId, message.ruleId, message.workflowId].some(id => id !== undefined && !validId(id)) || message.productionRunIds !== undefined && (!Array.isArray(message.productionRunIds) || message.productionRunIds.length > 10000 || message.productionRunIds.some(id => !validId(id))) || message.requestText !== undefined && (typeof message.requestText !== 'string' || message.requestText.length > 10000) || message.steps !== undefined && (!Array.isArray(message.steps) || message.steps.length > 40 || message.steps.some(step => typeof step !== 'string' || step.length > 2000)))) throw Error('这段对话的方案引用无法可靠读取，原记录未覆盖。');
  const initial = value.initialContext;
  if (initial !== undefined) {
    try { value.initialContext = normalizeHomeInitialContext(initial); }
    catch { throw Error('这段对话的初始配置无法可靠读取，原记录未覆盖。'); }
  }
  return value;
}
export function writeHomeConversation(storage: Pick<Storage, 'setItem'>, conversation: HomeAutomationConversation): void {
  const raw = JSON.stringify(conversation);
  if (conversation.messages.length > 300 || raw.length > 1500000) throw Error('这段对话已较长，请新开对话；原消息、方案和费用会保留。');
  try { storage.setItem(homeChatKey(conversation.workspaceId, conversation.id), raw); }
  catch { throw Error('对话记录未能保存，尚未发送新的 AI 请求。请先导出对话或恢复存储后重试。'); }
}
export function writeHomeChatIndex(storage: Pick<Storage, 'setItem'>, index: HomeAutomationChatIndex): void {
  if (index.items.length > 200) throw Error('本工作区对话已达到200段，原记录保留；可换工作区继续。');
  try { storage.setItem(homeChatIndexKey(index.workspaceId), JSON.stringify(index)); }
  catch { throw Error('对话目录未能保存，原消息仍保留，请重试。'); }
}
export function homeChatSendIssue(conversation: HomeAutomationConversation): string | undefined {
  if (conversation.messages.length > 296 || JSON.stringify(conversation).length > 1400000) return '这段对话已较长，请新开对话再发送；本次没有调用 AI，原方案和费用仍保留。';
  return undefined;
}
export function upsertHomeMessage(conversation: HomeAutomationConversation, message: HomeAutomationMessage): HomeAutomationConversation {
  const index = conversation.messages.findIndex(item => item.id === message.id);
  const messages = index < 0 ? [...conversation.messages, message] : conversation.messages.map((item, position) => position === index ? { ...item, ...message } : item);
  return { ...conversation, messages, title: conversation.title === '新对话' && message.role === 'user' && message.kind === 'request' ? message.text.slice(0, 24) : conversation.title, updatedAt: new Date().toISOString() };
}
export function homeChatCommand(text: string): 'create' | 'run' | undefined {
  const value = text.trim().replace(/[。！!！]+$/g, '');
  if (/^(?:创建|创建吧|确认创建|就按这个创建|按这个方案创建|创建这个自动化|保存这套自动化)$/.test(value)) return 'create';
  if (/^(?:运行一次|开始运行|按方案运行一次|运行这个自动化)$/.test(value)) return 'run';
  return undefined;
}
export function homeRefinementCommand(text: string): number | undefined {
  const value = text.trim().replace(/[。！!]+$/g, '');
  if (/^(?:取消|不要|去掉|不需要)(?:再)?精修$/.test(value)) return 0;
  const match = /^(?:(?:改成|改为|调整为|设为|换成)\s*)?(?:精修\s*([0123零一二三])\s*轮|([0123零一二三])\s*轮精修)$/.exec(value);
  const token = match?.[1] || match?.[2]; if (!token) return undefined;
  return '零一二三'.includes(token) ? '零一二三'.indexOf(token) : Number(token);
}
export function homeFirstRetryInput(text: string, messages: HomeAutomationMessage[]): string {
  const previous = [...messages].reverse().find(message => message.role === 'user' && message.kind === 'request');
  if (!previous) return text;
  const original = previous.requestText || previous.text, plain = text.trim().replace(/[。！!]+$/g, '');
  if (/^(?:再来一次|再来一版|重试|再试一下|再试一次|再试试|请重新规划|重新生成(?:方案)?|再生成一版)$/.test(plain)) return original;
  if (/^(?:请)?(?:再|改|换|调整|补充|把|不要|不用)/.test(plain)) return `${original}\n\n用户本轮补充要求（优先于此前要求）：${text}`;
  return text;
}
export function homeFollowupInput(text: string, messages: HomeAutomationMessage[], hasAcceptedPlan: boolean): string {
  if (!hasAcceptedPlan) return homeFirstRetryInput(text, messages);
  const plain = text.trim().replace(/[。！!]+$/g, '');
  if (!/^(?:再来一次|再来一版|重试|再试一下|再试一次|再试试|请重新规划|重新生成(?:方案)?|再生成一版)$/.test(plain)) return text;
  const last = [...messages].reverse().find(message => message.role === 'user' && message.kind === 'request');
  const completed = last?.requestId && messages.some(message => message.kind === 'plan' && message.requestId === last.requestId);
  return last && !completed ? last.requestText || last.text : text;
}
export function homeSuggestedProjectKind(text: string): 'word' | 'ppt' | 'excel' | 'image' | undefined {
  const office = [/(?:\bPPTX?\b|演示文稿|幻灯片)/i.test(text) ? 'ppt' : '', /(?:\b(?:EXCEL|XLSX)\b|工作簿|表格)/i.test(text) ? 'excel' : '', /(?:\b(?:WORD|DOCX)\b|文档|报告|说明书)/i.test(text) ? 'word' : ''].filter(Boolean);
  if (office.length === 1) return office[0] as 'word' | 'ppt' | 'excel';
  if (office.length > 1) return undefined;
  return /宣传图|海报|图片|头像|表情包|生图|试衣/.test(text) ? 'image' : undefined;
}
