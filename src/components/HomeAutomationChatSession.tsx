import { ChatReplyText } from './ChatReplyText';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FolderOpen, History, Info, LoaderCircle, Plus, ShieldCheck, Sparkles, Square, UserRound } from 'lucide-react';
import type { LedgerEntry, PageProps, ProjectKind } from '../types';
import type { HomeAutomationMessage } from '../lib/home-automation-chat';
import { homeChatCommand, homeChatSendIssue, homeFollowupInput, homeRefinementCommand } from '../lib/home-automation-chat';
import { homeFolderSendMatches, type HomeFolderSendIntent } from '../lib/home-folder-send';
import { homeConversationContinuation } from '../lib/home-continuation';
import { homeConversationCosts, linkHomeConversationWorkflows, type HomeLinkedJobRun } from '../lib/home-conversation-costs';
import { adjustNaturalImageRefinements, parseNaturalAutomationPlan } from '../lib/natural-automation-plan';
import { useNaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import { normalizedNaturalDraftPlan } from '../hooks/useNaturalAutomationDraft';
import type { useHomeAutomationChat } from '../hooks/useHomeAutomationChat';
import { naturalQuestionAnswer } from '../lib/natural-automation-composer-state';
import { naturalModelSelection } from './NaturalAutomationModels';
import { HomeAutomationComposer } from './HomeAutomationComposer';
import { AutomationProjectField } from './AutomationProjectField';
import { HomePlanCard } from './HomePlanCard';
import { CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { Select } from './Select';
import { automationProjectAvailability } from '../lib/automation-project-availability';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { useRememberedString } from '../hooks/useRememberedString';
import { HOME_CREATION_KINDS, homeCreationPlanningInput } from '../lib/home-creation';
import { BEAD_WORKSPACE_NOTICE, isBeadPatternRequest } from '../lib/bead-intent';
import { HomeBeadEntry } from './HomeBeadEntry';
import { BusinessLaunchCards } from './BusinessLaunchCards';
import './creation-journey.css';

function HomeChatTurnCost({ ledger, runId }: { ledger: LedgerEntry[]; runId: string }) {
  const entries = ledger.filter(entry => entry.workflowRunId === runId);
  return <div className="home-chat-turn-cost">本轮对话已花费 {entries.length ? <CostTotal summary={summarizeCosts(entries)} /> : <span>正在同步实际费用记录</span>}</div>;
}
export function HomeAutomationChatSession({ props, chat }: { props: PageProps; chat: ReturnType<typeof useHomeAutomationChat> }) {
  const conversationId = chat.conversation.id;
  const [settings, setSettings] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [visible, setVisible] = useState(20), [localError, setLocalError] = useState('');
  const [productionOpen, setProductionOpen] = useRememberedBoolean(`workspace:${props.workspaceId}:home-production-models`, false);
  const inputKey = `xuzuo-home-chat-input-v1:${props.workspaceId}:${conversationId}`;
  const [input, setInput] = useState(() => { try { return localStorage.getItem(inputKey) || ''; } catch { return ''; } });
  const [folderPending, setFolderPending] = useState(false), [folderVersion, setFolderVersion] = useState(0);
  const [beadRequest, setBeadRequest] = useState(() => [...chat.conversation.messages].reverse().find(message => message.role === 'user' && isBeadPatternRequest(message.text))?.text || '');
  const [referenceBusy, setReferenceBusy] = useState(false), importingReferences = useRef(false);
  const [costSyncVersion, setCostSyncVersion] = useState(0), [linkedJobRuns, setLinkedJobRuns] = useState<HomeLinkedJobRun[]>([]);
  const [checkedCostRules, setCheckedCostRules] = useState<string[]>([]), [costSyncIssue, setCostSyncIssue] = useState(false);
  const inputVersion = useRef(0), folderRequest = useRef<HomeFolderSendIntent | undefined>(undefined);
  const inputRef = useRef(input), textarea = useRef<HTMLTextAreaElement>(null), messages = useRef<HTMLDivElement>(null), pinned = useRef(true), sending = useRef(false), mounted = useRef(true);
  const settingsPanel = useRef<HTMLDivElement>(null), creation = useRef<HTMLElement>(null);
  const sendGeneration = useRef(0), readGeneration = useRef(0);
  inputRef.current = input;
  const session = useNaturalAutomationSession(props, { draftOptions: { keyPrefix: `xuzuo-home-automation-v1:${conversationId}`, keepCreatedDraft: true, initialProjectId: chat.conversation.initialContext?.projectId, initialPlanner: chat.conversation.initialContext?.planner, initialBindings: chat.conversation.initialContext?.bindings } });
  const { draft, planning } = session;
  const [format, setFormat] = useRememberedString(`workspace:${props.workspaceId}:creation-format`, session.project?.kind || 'image');
  const kind = (HOME_CREATION_KINDS.some(item => item.kind === format) ? format : 'image') as ProjectKind;
  useEffect(() => { if (draft.plan) setFormat(draft.plan.outputKind); }, [draft.plan?.outputKind]);
  const { targetPurged, billingOwnerPurged } = useMemo(() => automationProjectAvailability(props.workspaceId, props.projects, props.purgedProjects, draft.projectId, chat.conversation.billingProjectId || session.ownerId), [props.workspaceId, props.projects, props.purgedProjects, draft.projectId, chat.conversation.billingProjectId, session.ownerId]);
  const canReadPlans = !targetPurged;
  const activeRequestId = draft.acceptedRequestId || (draft.plan ? draft.requestId : undefined);
  const continuation = useMemo(() => homeConversationContinuation(props.workspaceId, draft.projectId, draft.ruleId, chat.conversation.messages, props.workflowRunner.runs), [props.workspaceId, draft.projectId, draft.ruleId, chat.conversation.messages, props.workflowRunner.runs]);
  const billingProjectId = chat.conversation.billingProjectId || session.project?.id;
  const productionBusy = useMemo(() => props.workflowRunner.runs.find(run => run.mode === 'live' && !['automation-plan', 'business-assist'].includes(run.purpose || '') && run.projectId === billingProjectId && ['running', 'paused'].includes(run.status)), [props.workflowRunner.runs, billingProjectId]);
  const answers = draft.ruleId ? session.readiness.answers : draft.preparationAnswers || {};
  const latest = useRef({ props, chat, session }); latest.current = { props, chat, session };
  const blocked = session.locked || planning.active || folderPending || referenceBusy;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setLocalError(''); }, [draft.planner.modelConfigId, draft.planner.credentialId]);
  useEffect(() => { try { localStorage.setItem(inputKey, input); } catch { setLocalError('输入草稿未能保留，请先导出对话或恢复本地存储。'); } }, [input, inputKey]);
  function write(message: HomeAutomationMessage) { try { latest.current.chat.append(message); return true; } catch (cause) { setLocalError(cause instanceof Error ? cause.message : '消息未保存，尚未发送新的请求。'); return false; } }
  function append(role: HomeAutomationMessage['role'], kind: HomeAutomationMessage['kind'], text: string, extra: Partial<HomeAutomationMessage> = {}) {
    return write({ id: crypto.randomUUID(), role, kind, text, createdAt: new Date().toISOString(), ...extra });
  }
  useEffect(() => {
    const record = planning.record, current = chat.current.current.conversation;
    if (!record || current.messages.some(message => message.role === 'user' && message.requestId === record.id)) return;
    const message = [...current.messages].reverse().find(message => message.role === 'user' && message.kind === 'request' && !message.requestId && (message.requestText || message.text) === record.input && Date.parse(message.createdAt) <= Date.parse(record.createdAt));
    if (message) write({ ...message, requestId: record.id, runId: record.runId });
  }, [planning.record?.id]);
  useEffect(() => {
    const current = chat.current.current.conversation;
    const runIds = new Map(planning.history.filter(record => record.runId).map(record => [record.id, record.runId]));
    for (const run of props.workflowRunner.runs) if (['automation-plan', 'business-assist'].includes(run.purpose || '') && run.workflowId.startsWith('plan-')) runIds.set(run.workflowId.slice(5), run.id);
    let changed = false;
    const plannerMessages = current.messages.map(message => { const runId = message.requestId && runIds.get(message.requestId); if (!message.runId && runId) { changed = true; return { ...message, runId }; } return message; });
    const messages = linkHomeConversationWorkflows(props.workspaceId, plannerMessages, [], [], props.workflowRunner.runs);
    if (messages.some((message, index) => message !== plannerMessages[index])) changed = true;
    if (changed) { try { chat.save({ ...current, messages }); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : '费用关联未能保存，原账本仍完整保留。'); } }
  }, [props.workflowRunner.runs, planning.history]);
  useEffect(() => {
    const record = planning.record;
    if (!record || record.id !== activeRequestId || record.status !== 'complete' || !draft.plan) return;
    const existing = chat.current.current.conversation.messages.find(message => message.kind === 'plan' && message.requestId === record.id);
    if (existing) { if (!existing.runId && record.runId) write({ ...existing, runId: record.runId }); return; }
    append('assistant', 'plan', `我把它整理成了“${draft.plan.name}”。${draft.plan.objective}`, { requestId: record.id, runId: record.runId, modelName: props.configuration.models.find(model => model.id === record.modelConfigId)?.name || '已选模型', steps: session.result.compiled?.stepsSummary.slice(0, 8) || draft.plan.steps.map(step => step.name) });
  }, [activeRequestId, planning.record?.id, planning.record?.status, draft.plan]);
  useEffect(() => {
    if (!draft.ruleId || session.runBusy || session.readiness.dispatchLoading || session.readiness.loadedRuleId !== draft.ruleId) return;
    const current = chat.current.current.conversation.messages.find(message => message.kind === 'created' && message.ruleId === draft.ruleId);
    const text = session.readiness.dispatchUnknown ? '流程已保存，制作提交结果尚未确认。请读取任务状态，不会自动重发。' : session.readiness.lastJob ? `“${draft.plan?.name || '自动化'}”已保存，制作任务已接收。可在方案卡查看进度和作品。` : `“${draft.plan?.name || '自动化'}”已保存，还未开始制作。准备好后点击继续制作。`;
    if (current) { if (current.workflowId !== draft.workflowId || current.text !== text) write({ ...current, workflowId: draft.workflowId, text }); }
    else append('system', 'created', text, { requestId: activeRequestId, ruleId: draft.ruleId, workflowId: draft.workflowId });
  }, [draft.ruleId, draft.workflowId, session.runBusy, session.readiness.loadedRuleId, session.readiness.dispatchLoading, session.readiness.dispatchUnknown, session.readiness.lastJob?.id]);
  useEffect(() => {
    const failedFollowup = draft.requestId !== activeRequestId && planning.record?.id === draft.requestId && planning.record?.status === 'failed';
    if (!session.error || draft.plan && !failedFollowup) return;
    const tail = chat.current.current.conversation.messages.at(-1);
    if (!tail || !['error', 'status'].includes(tail.kind) || tail.text !== session.error) append('system', 'error', session.error, { requestId: draft.requestId });
  }, [session.error, draft.requestId, activeRequestId, planning.record?.status]);
  const last = chat.conversation.messages.at(-1);
  useEffect(() => { if (pinned.current || last?.role === 'user') requestAnimationFrame(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }); }, [last?.id]);
  const costs = useMemo(() => homeConversationCosts(props.workspaceId, chat.conversation.messages, props.workflowRunner.runs, props.ledger, planning.record?.runId, linkedJobRuns, checkedCostRules), [props.workspaceId, chat.conversation.messages, props.workflowRunner.runs, props.ledger, planning.record?.runId, linkedJobRuns, checkedCostRules]);
  const costLinkSignature = [...new Set(chat.conversation.messages.filter(message => message.kind === 'created' && message.ruleId).map(message => message.ruleId))].sort().join('|');
  useEffect(() => {
    const bridge = window.desktop?.automation; if (!costLinkSignature || !bridge) return;
    let disposed = false; const workspaceId = props.workspaceId, id = conversationId;
    void bridge.snapshot(workspaceId).then(snapshot => {
      if (disposed || latest.current.props.workspaceId !== workspaceId || latest.current.chat.current.current.conversation.id !== id) return;
      if (snapshot.available === false || snapshot.issue) { setCostSyncIssue(true); return; }
      setCostSyncIssue(false); setCheckedCostRules(snapshot.rules.filter(rule => rule.workspaceId === workspaceId).map(rule => rule.id));
      setLinkedJobRuns(snapshot.jobs.map(job => ({ workspaceId: job.workspaceId, ruleId: job.ruleId, runId: job.runId })));
      const current = latest.current.chat.current.current.conversation, messages = linkHomeConversationWorkflows(workspaceId, current.messages, snapshot.rules, snapshot.jobs);
      if (messages.some((message, index) => message !== current.messages[index])) latest.current.chat.save({ ...current, messages });
    }).catch(() => { if (!disposed) setCostSyncIssue(true); });
    return () => { disposed = true; };
  }, [costLinkSignature, costSyncVersion, props.workspaceId, conversationId]);
  function setText(value: string) { inputVersion.current++; inputRef.current = value; setInput(value); }
  function cancelFolder() { folderRequest.current = undefined; if (mounted.current) setFolderPending(false); }
  useEffect(() => {
    const request = folderRequest.current;
    if (!request || request.dispatched) return;
    const model = naturalModelSelection(props.configuration, 'text', session.draft.planner);
    if (!homeFolderSendMatches(request, { workspaceId: props.workspaceId, conversationId, inputVersion: inputVersion.current, text: inputRef.current, modelConfigId: model.model?.id, credentialId: model.credentialId })) { request.cancelled = true; if (request.projectId) cancelFolder(); return; }
    if (!request.projectId) return;
    if (!props.projects.some(project => project.id === request.projectId && project.workspaceId === request.workspaceId)) return;
    if (session.draft.projectId !== request.projectId) { session.changeProject(request.projectId); return; }
    request.dispatched = true; void send(request.token);
  }, [folderVersion, props.projects, session.draft.projectId, session.draft.planner, props.configuration.models, props.configuration.credentials, input]);
  async function send(resumeFolderToken?: string) {
    if (targetPurged) { setLocalError('保存项目已永久删除，历史费用保留；请新建对话制作新作品。'); return; }
    const resumed = !!resumeFolderToken && folderRequest.current?.token === resumeFolderToken;
    const text = inputRef.current.trim(); if (!text || sending.current || (blocked || folderRequest.current) && !resumed) return;
    if (resumed) {
      const request = folderRequest.current!;
      const model = naturalModelSelection(props.configuration, 'text', draft.planner);
      if (!mounted.current || !homeFolderSendMatches(request, { workspaceId: props.workspaceId, conversationId, inputVersion: inputVersion.current, text, modelConfigId: model.model?.id, credentialId: model.credentialId }) || session.locked || planning.active) { cancelFolder(); return; }
      cancelFolder();
    }
    readGeneration.current++;
    if (isBeadPatternRequest(text)) {
      if (!append('user', 'status', text)) return;
      setBeadRequest(text); setText(''); setLocalError('');
      append('system', 'status', BEAD_WORKSPACE_NOTICE);
      return;
    }
    const command = homeChatCommand(text);
    if (command) {
      if (!append('user', 'status', text)) return; setText('');
      if (command === 'create') { if (draft.ruleId) append('system', 'status', '这套自动化已经创建，原流程和费用保留。可以继续补资料或运行，不会重复创建。', { requestId: activeRequestId, ruleId: draft.ruleId }); else await session.save(); } else { const outcome = await session.createAndRun({ continuation }); if (outcome.status === 'needs-input') append('system', 'status', '在方案卡里补齐必要信息，再点击继续制作；不需要重新规划。'); }
      return;
    }
    const rounds = draft.plan?.outputKind === 'image' ? homeRefinementCommand(text) : undefined;
    if (rounds !== undefined) {
      if (!append('user', 'status', text, { requestId: activeRequestId })) return;
      const saved = !!(draft.workflowSaved || draft.ruleId || session.existingFlow);
      try {
        session.store.persist({ ...session.store.current.current, plan: adjustNaturalImageRefinements(draft.plan!, rounds), ...(saved ? { workflowId: undefined, creationKey: undefined, workflowSaved: false, ruleId: undefined, preparationAnswers: answers } : {}) });
        session.setSavedRule(undefined); setText(''); append('system', 'status', `已把计划内精修调整为 ${rounds} 轮，没有调用 AI；此前费用仍保留。${saved ? '原自动化保持原样，调整后的草稿可以再创建一套。' : ''}`);
      }
      catch (cause) { setLocalError(cause instanceof Error ? cause.message : '次数未能调整，原方案仍保留。'); }
      return;
    }
    const capacityIssue = homeChatSendIssue(chat.current.current.conversation);
    if (capacityIssue) { setLocalError(capacityIssue); return; }
    const model = naturalModelSelection(props.configuration, 'text', draft.planner);
    const billingProjectId = chat.current.current.conversation.billingProjectId || session.project?.id;
    if (billingOwnerPurged) { setLocalError('原规划记账项目已永久删除，不能再向这段对话发送 AI 需求。当前有效项目仍可制作和查看作品；新需求请新建对话。'); return; }
    if (!billingProjectId && !chat.current.current.conversation.billingProjectId && planning.bridge && model.model && model.credentialId) {
      if (folderRequest.current) return;
      const request = { token: crypto.randomUUID(), workspaceId: props.workspaceId, conversationId, inputVersion: inputVersion.current, text, modelConfigId: model.model.id, credentialId: model.credentialId, projectId: undefined as string | undefined, dispatched: false };
      folderRequest.current = request; setFolderPending(true); setLocalError('');
      props.onCreateProject(kind, { quick: true, initial: { description: text }, onCreated: project => {
        if (!mounted.current || folderRequest.current !== request) return;
        const latestModel = naturalModelSelection(latest.current.props.configuration, 'text', latest.current.session.store.current.current.planner);
        if (project.workspaceId !== request.workspaceId || !homeFolderSendMatches(request, { workspaceId: latest.current.props.workspaceId, conversationId: latest.current.chat.current.current.conversation.id, inputVersion: inputVersion.current, text: inputRef.current, modelConfigId: latestModel.model?.id, credentialId: latestModel.credentialId })) {
          if (project.workspaceId === latest.current.props.workspaceId && latest.current.chat.current.current.conversation.id === request.conversationId && !latest.current.chat.current.current.conversation.billingProjectId && !latest.current.session.store.current.current.projectId) latest.current.session.changeProject(project.id);
          cancelFolder(); setLocalError('需求或模型已经改变，本次没有发送 AI。保存位置已保留，确认后可再次发送。'); return;
        }
        request.projectId = project.id; setFolderVersion(value => value + 1);
      }, onCancelled: message => { if (mounted.current && folderRequest.current === request) { cancelFolder(); if (message) setLocalError(message); } } });
      return;
    }
    if (!planning.bridge || !billingProjectId || !props.projects.some(project => project.id === billingProjectId) || !model.model || !model.credentialId) {
      if (!billingProjectId || !props.projects.some(project => project.id === billingProjectId)) { setSettings(true); requestAnimationFrame(() => settingsPanel.current?.scrollIntoView({ block: 'nearest' })); }
      else requestAnimationFrame(() => { const picker = textarea.current?.closest('form')?.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${!model.model ? '对话模型' : '对话Key'}"]`); picker?.scrollIntoView({ block: 'nearest' }); picker?.focus(); });
      setLocalError(!planning.bridge ? '请使用新版 Windows 桌面应用进行 AI 对话。' : !billingProjectId ? '先选择或新建保存项目，让方案和费用有明确归属。' : !props.projects.some(project => project.id === billingProjectId) ? '原记账项目暂不可用，可以新开对话；原方案和费用仍保留。' : '在输入区上方选择对话模型和对应 Key，再发送即可。'); return;
    }
    const priorPlanId = activeRequestId;
    if (productionBusy) { setLocalError(productionBusy.status === 'paused' ? '上一轮制作已暂停，请先在任务进度里继续或取消，再发送这条需求。输入已保留。' : '上一轮还在制作，请稍候再发送，或先查看任务进度。输入已保留。'); return; }
    const requestText = homeCreationPlanningInput(homeFollowupInput(text, chat.current.current.conversation.messages, !!priorPlanId), kind, !!priorPlanId);
    if (requestText.length > 10000) { setLocalError('这次补充和原始需求合起来较长，请缩短后重试；没有发送新的 AI 请求。'); return; }
    const notes = draft.plan?.questions.flatMap(question => { const answer = naturalQuestionAnswer(answers, question).trim(); return answer ? [`${question}\n用户已补充：${answer}`] : []; }).join('\n\n') || '';
    if (notes.length > 10000) { setLocalError('已补充的资料较长，请先保存当前流程，或新开对话；没有发送新的 AI 请求。'); return; }
    const message: HomeAutomationMessage = { id: crypto.randomUUID(), role: 'user', kind: 'request', text, ...(requestText !== text ? { requestText } : {}), modelName: model.model.name, createdAt: new Date().toISOString() };
    try { chat.save({ ...chat.current.current.conversation, billingProjectId }); if (!write(message)) return; } catch (cause) { setLocalError(cause instanceof Error ? cause.message : '对话未能保存，没有发送请求。'); return; }
    const generation = ++sendGeneration.current;
    sending.current = true; setLocalError(''); session.setError(''); setText(''); pinned.current = true;
    try {
      const before = session.store.current.current.requestId;
      const task = planning.start({ input: requestText, billingProjectId, ...(priorPlanId && draft.plan ? { priorPlanId, currentPlan: normalizedNaturalDraftPlan(draft.plan), ...(notes ? { contextNotes: notes } : {}), calendarResolved: draft.calendarResolved } : {}) });
      const assigned = session.store.current.current.requestId;
      if (assigned && assigned !== before) write({ ...message, requestId: assigned });
      const result = await task;
      if (mounted.current && result) write({ ...message, requestId: result.id, runId: result.runId });
    } catch (cause) { if (mounted.current) setLocalError(cause instanceof Error ? cause.message : '本轮提交未确认，可以重新读取，已有费用保留。'); }
    finally { if (sendGeneration.current === generation) sending.current = false; }
  }
  async function stopPlanning() { sendGeneration.current++; sending.current = false; await planning.cancel(); }
  async function readOld(requestId: string) {
    if (blocked || !planning.bridge || !canReadPlans) return;
    const generation = ++readGeneration.current, snapshot = session.store.current.current;
    try {
      const record = await planning.bridge.read({ id: requestId, workspaceId: props.workspaceId });
      if (!mounted.current || generation !== readGeneration.current) return;
      if (snapshot !== session.store.current.current || latest.current.session.locked || latest.current.session.planning.active) { append('system', 'status', '旧方案已经读取；你刚才已调整当前方案，因此没有替换它，也没有新增调用。'); return; }
      if (record.status !== 'complete' || !record.resultText) { setLocalError(record.status === 'failed' ? `这轮未能完成：${record.error || '暂未返回可用方案。'} 可点“重新编辑这条需求”再次发送；查看状态不调用 AI，已有费用保留。` : record.error || '这轮还没有可用方案；可重新编辑这条需求。查看状态没有调用 AI，已有结果和费用保留。'); return; }
      if (!planning.restore(record, parseNaturalAutomationPlan(record.resultText))) return;
      setLocalError(''); session.setError('');
      session.setSavedRule(undefined); append('system', 'status', '已免费读取这份 AI 原方案。原自动化不会被覆盖，后续可以基于它再创建一套。');
    } catch (cause) { if (mounted.current && generation === readGeneration.current) setLocalError(cause instanceof Error ? cause.message : '原方案暂时无法读取。'); }
  }
  function editRequest(message: HomeAutomationMessage) {
    if (blocked) return;
    setText(message.text); setLocalError(''); session.setError(''); pinned.current = true;
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.scrollIntoView({ block: 'nearest' }); });
  }
  function openModels(capability?: string) {
    setProductionOpen(true);
    requestAnimationFrame(() => { const panel = creation.current?.querySelector<HTMLElement>('[aria-label="提前选择制作模型设置"]'); if (capability) panel?.querySelector<HTMLButtonElement>(`[data-capability="${capability}"]`)?.click(); requestAnimationFrame(() => { panel?.scrollIntoView({ block: 'nearest' }); panel?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true }); }); });
  }
  async function addReferences() {
    if (importingReferences.current || session.locked || planning.active || targetPurged) return;
    if (!session.project) { setSettings(true); requestAnimationFrame(() => settingsPanel.current?.scrollIntoView({ block: 'nearest' })); setLocalError('先选择或新建本地保存项目，再添加参考资料。添加与填写资料不会调用 AI。'); return; }
    importingReferences.current = true; setReferenceBusy(true);
    const scope = `${props.workspaceId}/${session.project.id}`;
    try { if (draft.ruleId) { await session.readiness.addReferences(); return; } const files = await props.workflowRunner.importFiles(session.project.id); if (mounted.current && `${latest.current.props.workspaceId}/${latest.current.session.store.current.current.projectId}` === scope && files.length) props.onUpdateProject(session.project.id, { referenceFiles: [...(session.project.referenceFiles || []), ...files.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind }))] }); }
    catch (cause) { if (mounted.current) setLocalError(cause instanceof Error ? cause.message : '参考资料未能添加，原文件保留。'); }
    finally { importingReferences.current = false; if (mounted.current) setReferenceBusy(false); }
  }
  function newConversation() {
    const projectId = props.projects.find(project => project.id === draft.projectId && !project.trashedAt && !project.purgedAt)?.id || props.projects.find(project => !project.trashedAt && !project.purgedAt)?.id;
    chat.newConversation({ projectId, planner: { ...draft.planner, modelConfigId: session.selected.model?.id || draft.planner.modelConfigId, credentialId: session.selected.credentialId || draft.planner.credentialId }, bindings: draft.ruleId && session.savedRule?.id === draft.ruleId ? { ...draft.bindings, ...session.readiness.bindings } : draft.bindings });
  }
  const currentMessages = chat.conversation.messages.slice(-visible);
  if (draft.plan && activeRequestId && !currentMessages.some(message => message.kind === 'plan' && message.requestId === activeRequestId)) {
    const record = planning.record?.id === activeRequestId ? planning.record : planning.history.find(item => item.id === activeRequestId);
    currentMessages.push({ id: `current-${activeRequestId}`, role: 'assistant', kind: 'plan', text: '当前采用的方案。已有方案和费用仍保留，可以继续创建或调整。', createdAt: chat.conversation.updatedAt, requestId: activeRequestId, runId: record?.runId, modelName: props.configuration.models.find(model => model.id === record?.modelConfigId)?.name });
  }
  const idle = !chat.conversation.messages.length && !draft.plan && !planning.active;
  const destination = <button type="button" className="creation-destination" aria-label="首页对话设置" aria-expanded={settings} disabled={blocked || !!targetPurged} title={session.project?.directory || '选择或新建一个本地项目文件夹'} onClick={() => setSettings(value => !value)}><FolderOpen size={15} /><span>{targetPurged ? '保存项目已移除' : session.project?.name || '选择保存位置'}</span><ChevronDown size={12} /></button>;
  return <section ref={creation} className={`home-automation-chat creation-journey ${idle ? 'creation-is-idle' : 'creation-has-conversation'}`} role="region" aria-label="首页AI对话">
    {idle ? <header className="creation-hero"><p><i />你的想法，值得认真完成</p><h2>从一个想法，<br />到一份好作品<span>。</span></h2><div>先聊清楚，再按你确认的方案制作。</div></header> : <header className="creation-conversation-header"><div><small>创作对话</small><h2>{draft.plan?.name || chat.conversation.title || '说说你的想法'}</h2></div><nav><button type="button" className="btn-icon" aria-label="首页历史对话" aria-expanded={historyOpen} disabled={blocked} onClick={() => setHistoryOpen(value => !value)}><History size={18} /></button><button type="button" className="btn btn-ghost" disabled={blocked} onClick={newConversation}><Plus size={15} />新对话</button></nav></header>}
    {idle && <div className="creation-idle-history"><button type="button" className="text-button" aria-label="首页历史对话" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><History size={14} />历史对话</button></div>}
    {historyOpen && <div className="home-chat-history"><Select aria-label="选择首页历史对话" value={conversationId} options={chat.index.items.map(item => ({ value: item.id, label: item.title, description: new Date(item.updatedAt).toLocaleString('zh-CN') }))} onValueChange={id => chat.select(id)} /><button type="button" className="btn btn-secondary" onClick={() => { void chat.exportConversation(); }}><Download size={15} />导出对话</button></div>}
    {!idle && <div className="home-chat-thread" role="region" aria-label="对话记录"><div className="home-chat-messages" role="log" aria-label="首页自动化对话消息" aria-live="polite" ref={messages} onScroll={() => { const element = messages.current; if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      {chat.conversation.messages.length > visible && <button type="button" className="text-button home-chat-earlier" onClick={() => setVisible(value => value + 20)}>查看更早的消息</button>}
      {currentMessages.map(message => <article className={`home-chat-message home-chat-${message.role}`} key={message.id} data-message-kind={message.kind} aria-label={message.role === 'user' ? '你发送的消息' : message.role === 'assistant' ? '序作AI回复' : '系统提示'}><div className="home-chat-speaker"><span className="home-chat-avatar" aria-hidden="true">{message.role === 'user' ? <UserRound size={16} /> : message.role === 'assistant' ? <Sparkles size={16} /> : <Info size={14} />}</span><span className="home-chat-author">{message.role === 'user' ? '你' : message.role === 'assistant' ? '序作 AI' : '系统提示'}</span>{message.role === 'assistant' && message.modelName && <small>{message.modelName}</small>}</div><div className={`home-chat-bubble ${message.kind === 'error' ? 'is-error' : ''} ${message.kind === 'plan' && message.requestId === activeRequestId && draft.plan ? 'is-plan-card' : ''}`}>
        {message.kind === 'plan' && message.requestId === activeRequestId && draft.plan ? <HomePlanCard props={props} session={session} onOpenModels={openModels} continuation={continuation} /> : message.role === 'assistant' ? <ChatReplyText text={message.text} /> : <p>{message.text}</p>}
        {canReadPlans && message.kind === 'error' && message.requestId && <button type="button" className="text-button" disabled={blocked} onClick={() => { void readOld(message.requestId!); }}>查看关联请求状态</button>}
        {canReadPlans && message.role === 'user' && message.requestId && !chat.conversation.messages.some(item => item.kind === 'plan' && item.requestId === message.requestId) && !planning.active && <div className="home-chat-request-recovery"><button type="button" className="text-button" disabled={blocked} onClick={() => { void readOld(message.requestId!); }}>查看本轮状态</button><button type="button" className="text-button" disabled={blocked} onClick={() => editRequest(message)}>重新编辑这条需求</button></div>}
        {message.kind === 'plan' && message.requestId && message.requestId !== activeRequestId && <><ol className="home-chat-old-steps">{message.steps?.slice(0, 4).map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, '')}</li>)}</ol>{canReadPlans && <button type="button" className="text-button" disabled={blocked} onClick={() => { void readOld(message.requestId!); }}>免费读取这版 AI 原方案</button>}</>}
        {message.runId && message.role === 'assistant' && <HomeChatTurnCost ledger={props.ledger} runId={message.runId} />}
      </div></article>)}
      {planning.active && <div className="home-chat-pending" role="status"><LoaderCircle size={17} className="spin" />正在整理目标和制作步骤…<button type="button" className="text-button" onClick={() => { void stopPlanning(); }}><Square size={13} />停止</button></div>}
    </div></div>}
    {(localError || chat.issue || session.store.issue || session.store.recovery.error) && <div className="home-chat-alert" role="alert">{localError || chat.issue || session.store.issue || session.store.recovery.error}{productionBusy && localError && <button type="button" className="text-button" onClick={() => props.navigate('activity', productionBusy.projectId)}>查看上一轮任务</button>}{chat.issue && <button type="button" className="text-button" onClick={() => { void chat.recoverAndStart().catch(cause => setLocalError(cause instanceof Error ? cause.message : '对话未能恢复。')); }}>导出原记录并新建对话</button>}</div>}
    {beadRequest && <HomeBeadEntry props={props} projectId={session.project?.id} request={beadRequest} />}
    {folderPending && <p className="home-chat-pending" role="status">先选择这段对话的本地保存文件夹。需求会保留，取消不会调用 AI。</p>}
    {billingOwnerPurged && !targetPurged && <p className="creation-owner-note">原规划项目已永久删除；当前作品可继续制作，新的 AI 需求请新建对话。</p>}
    <HomeAutomationComposer props={props} session={session} blocked={blocked || !!targetPurged} input={input} onText={setText} textareaRef={textarea} onSend={send} kind={kind} onKind={value => { inputVersion.current++; setFormat(value); }} onReferences={() => { void addReferences(); }} referenceCount={session.project?.referenceFiles?.length} productionOpen={productionOpen} onProductionOpen={setProductionOpen} destination={destination} needsFolder={!session.project} cost={costs.entries.length ? summarizeCosts(costs.entries) : undefined} costPending={!!costs.pendingRuleIds.length || !!session.readiness.dispatchUnknown || costSyncIssue} onSyncCosts={() => { setCostSyncVersion(value => value + 1); void session.readiness.readDispatch(); }}>
      {settings && !targetPurged && <div ref={settingsPanel} className="home-chat-settings"><AutomationProjectField props={props} label="作品保存项目" ariaLabel="首页对话项目" value={draft.projectId} disabled={blocked || session.frozen} newProjectKind={draft.plan?.outputKind || kind} projectKind={draft.plan?.outputKind} quickCreate initialDescription={input || draft.input} onSelect={project => { session.changeProject(project.id); if (!draft.plan) setFormat(project.kind); }} /><small title={session.project?.directory}>{session.project?.directory || '先选择或新建当前工作区里的项目文件夹。'}{chat.conversation.billingProjectId && chat.conversation.billingProjectId !== draft.projectId && ` 本对话规划费用仍记入：${props.projects.find(project => project.id === chat.conversation.billingProjectId)?.name || '原记账项目'}。`}</small></div>}
    </HomeAutomationComposer>
    {idle && <><BusinessLaunchCards props={props} /><p className="creation-local-note"><ShieldCheck size={14} />文件保存本地 · 费用自动记录 · 每一步由你决定</p></>}
  </section>;
}
