// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationContext, AutomationJob, AutomationRule, AutomationRuleDraft } from '../automation-types';
import type { WorkflowDefinition, WorkflowDraft, WorkflowRun } from '../configuration-types';
import type { LiveStartResult } from '../live-types';
import type { ChatTurn } from '../chat-types';
import type { LedgerEntry, PageProps, Project } from '../types';
import type { NaturalAutomationDraft } from '../hooks/useNaturalAutomationDraft';
import { naturalAutomationDraftStorageKey } from '../hooks/useNaturalAutomationDraft';
import { ChatPlanProduction } from './ChatPlanProduction';

let root: Root | undefined, host: HTMLDivElement;
const timestamp = '2026-11-09T00:00:00.000Z';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); host = document.createElement('div'); document.body.append(host);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Production interaction tests must not contact a provider'); }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim().includes(text));
  expect(button, text).toBeTruthy(); expect(button!.disabled, text).toBe(false); await act(async () => button!.click());
}
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 2500;
  while (Date.now() < end) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 10))); }
  throw Error(`Production integration did not settle: ${label}; UI: ${host.textContent}`);
}
const plan = { version: 1 as const, name: '产品合作说明书', objective: '制作一份包含目标、工作范围、安排和结论的完整Word说明书。', outputKind: 'word' as const, trigger: { type: 'manual' as const }, steps: [{ kind: 'text' as const, name: '撰写完整说明', instruction: '依据已确认目标输出完整正文。' }], illustrations: { mode: 'none' as const, count: 0 }, acceptance: ['正文完整', '层级清楚'], constraints: ['不编造客户数据'], maxRepairs: 0, questions: [], unsupported: [] };
const turn: ChatTurn = { id: 'plan-turn', userText: '制作完整合作说明书', text: JSON.stringify(plan), mode: 'plan', plan, status: 'complete', modelName: '已选择的文字模型', modelId: 'gpt-6.1-terra', modelConfigId: 'text-model', credentialId: 'account-metadata', reasoningEffort: 'high', costCents: 3, costState: 'calculated', createdAt: timestamp, updatedAt: timestamp };
const makeProject = (id = 'new-project'): Project => ({ id, workspaceId: 'workspace', name: plan.name, kind: 'word', description: plan.objective, costCents: 0, status: 'draft', version: 0, accent: 'blue', updatedAt: timestamp });

async function fixture({ withProject = false, missing = '', staleRule = false, attachments = false, delayReferences = false, copyFails = false, cover = false, imageChoices = false, conversationId = 'conversation', workspaceId = 'workspace', unavailableAccount = '', requiredImages = 0, question = '' }: { imageChoices?: boolean; conversationId?: string; workspaceId?: string; unavailableAccount?: string; withProject?: boolean; missing?: 'key' | 'model' | ''; staleRule?: boolean; attachments?: boolean; delayReferences?: boolean; copyFails?: boolean; cover?: boolean; requiredImages?: number; question?: string } = {}) {
  const planner = { modelConfigId: turn.modelConfigId, credentialId: turn.credentialId, reasoningEffort: 'high' as const };
  const connection = { id: 'connection', name: 'OpenAI', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
  const model = { id: 'text-model', name: '已选择的文字模型', modelId: turn.modelId, connectionId: connection.id, capabilities: ['text', 'vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'USD', input: '1', output: '5' } };
  const oldWorkflow = { id: 'old-workflow', workspaceId, name: '旧项目流程', outputKind: 'word', description: '', updatedAt: timestamp, steps: [{ id: 'old-step', name: '旧正文', kind: 'text', enabled: true, inputSource: 'project', prompt: '保留旧资料', modelConfigId: 'text-model', credentialId: 'account-metadata', reasoningEffort: 'low' }] } as WorkflowDefinition;
  const oldRule: AutomationRule = { id: 'old-rule', workspaceId, projectId: 'trashed-project', workflowId: oldWorkflow.id, name: '旧项目规则', trigger: 'manual', enabled: false, input: '旧制作要求', variables: {}, updatedAt: timestamp };
  let rules: AutomationRule[] = staleRule ? [structuredClone(oldRule)] : [], jobs: AutomationJob[] = [];
  const changed = new Set<() => void>();
  const snapshot = vi.fn(async () => ({ revision: 1, available: true, rules: structuredClone(rules), jobs: structuredClone(jobs), events: [], decisions: [], memories: [] }));
  const syncContext = vi.fn(async (_context: AutomationContext) => {});
  const saveRule = vi.fn(async (draft: AutomationRuleDraft & { id?: string }) => {
    const value = { ...draft, id: draft.id || `rule-${rules.length + 1}`, updatedAt: new Date().toISOString() };
    rules = rules.some(rule => rule.id === value.id) ? rules.map(rule => rule.id === value.id ? value : rule) : [...rules, value]; return structuredClone(value);
  });
  const trigger = vi.fn(async ({ ruleId }: { ruleId: string }) => {
    const rule = rules.find(rule => rule.id === ruleId)!; expect(rule).toBeTruthy();
    const value: AutomationJob = { id: `job-${jobs.length + 1}`, workspaceId, ruleId, projectId: rule.projectId, eventId: 'manual-event', dispatchKey: 'a'.repeat(64), status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attachmentIds: [], input: rule.input };
    jobs = [...jobs, value]; return structuredClone(value);
  });
  const planningStart = vi.fn(async () => { throw Error('A saved chat plan must not be planned or billed again'); });
  const source = { id: 'prior-chat-image', name: '上轮参考图.png', mimeType: 'image/png', kind: 'image' as const, bytes: 123, sha256: 'a'.repeat(64), createdAt: timestamp };
  const activeTurn: ChatTurn = { ...turn, ...(attachments ? { attachments: [], contextAttachments: [source] } : {}), plan: { ...plan, ...(requiredImages ? { illustrations: { mode: 'references', count: requiredImages } } : {}), questions: question ? [question] : [] } };
  if (cover) {
    model.capabilities.push('image-generation');
    activeTurn.imagePreset = '微信红包封面';
    activeTurn.plan = { ...plan, objective: '制作小猫红包封面', outputKind: 'image', steps: [{ kind: 'image-generation', name: '制作封面', instruction: '画橘猫' }] };
  }
  if (imageChoices) activeTurn.plan = { ...plan, outputKind: 'image', steps: [{ kind: 'image-generation', name: '生成图', instruction: '生成初稿' }, { kind: 'image-editing', name: '精修图', instruction: '精修初稿' }] };
  const imageModels = imageChoices ? ['甲', '乙'].map((name, i) => ({ ...model, id: 'image-model-' + i, name: '图片模型' + name, capabilities: ['image-generation', 'image-editing'] })) : [];
  const accounts = [{ id: 'account-metadata', name: '账户元数据', connectionId: connection.id, enabled: true }, ...(imageChoices ? [{ id: 'image-account', name: '图片账户', connectionId: connection.id, enabled: true }] : [])].filter(item => item.id !== unavailableAccount);
  const copiedFile = { id: 'copied-reference', name: source.name, mimeType: source.mimeType, bytes: source.bytes, kind: source.kind, createdAt: timestamp, path: '', projectId: 'new-project' };
  let failCopy = copyFails;
  const attachToProject = vi.fn(async (input: { projectId: string; attachmentIds: string[] }) => { if (failCopy) { failCopy = false; throw Error('参考材料复制失败，原文件保留'); } return [{ ...copiedFile, projectId: input.projectId }]; });
  let runs: WorkflowRun[] = [];
  let setRuns!: (runs: WorkflowRun[]) => void;
  function addRun(workflow: WorkflowDefinition, projectId: string) {
    const run = { id: 'direct-run', workflowId: workflow.id, workflowName: workflow.name, projectId, workspaceId, input: plan.objective, variables: {}, mode: 'live', status: 'running', snapshot: workflow, attempts: [], stepIndex: 0, createdAt: timestamp, updatedAt: timestamp } as WorkflowRun;
    runs = [...runs, run]; setRuns(runs); return run;
  }
  const startLive = vi.fn(async (workflow: WorkflowDefinition, projectId: string): Promise<LiveStartResult> => ({ status: 'started', runId: addRun(workflow, projectId).id }));
  const readStartResult = vi.fn(async (): Promise<LiveStartResult> => ({ status: 'rejected', code: 'NO_PENDING_START', error: '没有待确认的启动' }));
  const importAttachments = vi.fn(async () => [{ ...source, id: 'inline-source' }]);
  const desktop = { chat: { attachToProject, importAttachments }, runtime: { snapshot: async () => ({ runs }) }, automation: { snapshot, syncContext, saveRule, trigger, onChanged(listener: () => void) { changed.add(listener); return () => changed.delete(listener); } }, automationPlanning: { list: vi.fn(async () => []), start: planningStart } };
  Object.defineProperty(window, 'desktop', { configurable: true, value: desktop });
  const directoryRequests = vi.fn<PageProps['onCreateProject']>(), preflight = vi.fn<PageProps['workflowRunner']['preflight']>(async () => ({ ok: true, errors: [], warnings: [], steps: [], unknownCost: false }));
  const ledger = Object.freeze([{ id: 'prior-cost', projectId: 'trashed-project', projectName: '旧项目', action: '初次生成', model: '已调用的模型', costCents: 27, costState: 'calculated', billingMode: 'live', time: timestamp, status: 'complete' }]) as unknown as LedgerEntry[];
  const savedLedger = JSON.stringify(ledger), key = naturalAutomationDraftStorageKey(workspaceId, { keyPrefix: `xuzuo-chat-production-v1:${conversationId}:${turn.id}` });
  if (staleRule) {
    const saved: NaturalAutomationDraft = { version: 1, workspaceId, projectId: oldRule.projectId, input: turn.userText, acceptedInput: turn.userText, planner, bindings: { text: planner }, plan, ruleId: oldRule.id, workflowId: oldWorkflow.id, workflowSaved: true, creationKey: 'original-creation', preparationAnswers: {} };
    localStorage.setItem(key, JSON.stringify(saved));
  }
  let updateProjects!: (projects: Project[]) => void, applyProjectChanges!: (id: string, changes: Partial<Project>) => void, pendingReferences: { id: string; changes: Partial<Project> } | undefined, savedWorkflows: WorkflowDefinition[] = staleRule ? [structuredClone(oldWorkflow)] : [];
  const updateProject = vi.fn((id: string, changes: Partial<Project>) => { if (delayReferences) pendingReferences = { id, changes }; else applyProjectChanges(id, changes); });
  const saveWorkflow = vi.fn((draft: WorkflowDraft, id?: string) => {
    const value = { ...structuredClone(draft), id: id!, workspaceId, updatedAt: new Date().toISOString() };
    updateWorkflows(current => [...current.filter(flow => flow.id !== id), value]); return true;
  });
  let updateWorkflows!: (updater: (current: WorkflowDefinition[]) => WorkflowDefinition[]) => void;
  function Harness() {
    const [projects, setProjects] = useState<Project[]>(withProject ? [makeProject()] : []), [workflows, setWorkflows] = useState<WorkflowDefinition[]>(savedWorkflows);
    const [visibleRuns, updateRuns] = useState(runs); setRuns = updateRuns;
    updateProjects = setProjects; updateWorkflows = setWorkflows; savedWorkflows = workflows;
    applyProjectChanges = (id, changes) => setProjects(current => current.map(project => project.id === id ? { ...project, ...changes } : project));
    const props = { workspaceId, workspace: { id: workspaceId, name: '独立测试工作区' }, workspaces: [{ id: workspaceId, name: '独立测试工作区' }], projects, trashedProjects: [], purgedProjects: [], activeProject: projects[0] || { id: '' }, ledger, configuration: { connections: [connection], models: missing === 'model' ? [] : [model, ...imageModels], credentials: missing === 'key' ? [] : accounts, workflows, saveWorkflow }, workflowRunner: { runs: [], preflight }, preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: directoryRequests } as unknown as PageProps;
    props.onUpdateProject = updateProject;
    Object.assign(props.workflowRunner, { runs: visibleRuns, startLive, readStartResult });
    return <ChatPlanProduction props={props} turn={activeTurn} conversationId={conversationId} planner={planner} />;
  }
  await act(async () => { root = createRoot(host); root.render(<Harness />); });
  async function created(project = makeProject()) {
    const options = directoryRequests.mock.calls.at(-1)?.[1]; expect(options?.onCreated).toBeTypeOf('function');
    await act(async () => { updateProjects([project]); options!.onCreated!(project); });
  }
  async function releaseReferences() { expect(pendingReferences).toBeTruthy(); const value = pendingReferences!; pendingReferences = undefined; await act(async () => applyProjectChanges(value.id, value.changes)); }
  return { key, directoryRequests, preflight, startLive, readStartResult, addRun, saveWorkflow, saveRule, trigger, planningStart, syncContext, created, snapshot, oldRule, oldWorkflow, attachToProject, importAttachments, updateProject, releaseReferences, readRules: () => rules, readWorkflows: () => savedWorkflows, verifyLedger: () => expect(JSON.stringify(ledger)).toBe(savedLedger) };
}

describe('聊天方案通过真实session创建和运行生产流程', () => {
  it('新方案和重启分别记住生成及精修选择；旧方案、失效账户和其它工作区各自独立', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 30, 260, 40));
    const field = (name: string) => host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="' + name + '"]')!;
    async function select(name: string, choice: string) {
      await act(async () => field(name).click());
      const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(node => node.textContent?.includes(choice));
      expect(option, name + ' ' + choice).toBeTruthy();
      await act(async () => option!.click());
    }
    async function reopen(conversationId: string, workspaceId = 'workspace', unavailableAccount = '') {
      if (root) { await act(async () => root!.unmount()); root = undefined; }
      const f = await fixture({ imageChoices: true, conversationId, workspaceId, unavailableAccount });
      const panel = host.querySelector<HTMLDetailsElement>('details.chat-plan-models')!;
      if (!panel.open) await act(async () => panel.querySelector('summary')!.click());
      return f;
    }
    const first = await reopen('first-chat');
    await select('生成图片模型', '图片模型甲'); await select('生成图片Key', '图片账户');
    await select('精修图片模型', '图片模型乙'); await select('精修图片Key', '账户元数据');
    const firstSnapshot = localStorage.getItem(first.key);
    const next = await reopen('next-chat');
    expect(field('生成图片模型').textContent).toContain('图片模型甲'); expect(field('生成图片Key').textContent).toContain('图片账户');
    expect(field('精修图片模型').textContent).toContain('图片模型乙'); expect(field('精修图片Key').textContent).toContain('账户元数据');
    await select('生成图片模型', '图片模型乙'); await select('生成图片Key', '图片账户');
    expect(localStorage.getItem(first.key)).toBe(firstSnapshot);
    await reopen('first-chat'); expect(field('生成图片模型').textContent).toContain('图片模型甲');
    await reopen('new-after-restart', 'workspace', 'image-account');
    expect(field('生成图片模型').textContent).toContain('图片模型乙'); expect(field('生成图片Key').textContent).toContain('请选择使用的 Key');
    expect(field('精修图片模型').textContent).toContain('图片模型乙'); expect(field('精修图片Key').textContent).toContain('账户元数据');
    await reopen('first-chat', 'other-workspace');
    expect(field('生成图片模型').textContent).toContain('请选择一个模型'); expect(field('精修图片模型').textContent).toContain('请选择一个模型');
    expect(next.startLive).not.toHaveBeenCalled(); expect(first.planningStart).not.toHaveBeenCalled(); first.verifyLedger();
  });
  it('红包方案在明确执行前不派发，创建项目后用红包参数生产并保存场景', async () => {
    const f = await fixture({ cover: true });
    expect(JSON.parse(localStorage.getItem(f.key)!).imagePreset).toBe('微信红包封面');
    const consent = host.querySelector<HTMLInputElement>('.image-quality-repair-option input')!;
    expect(consent.checked).toBe(true); expect(consent.parentElement?.parentElement?.textContent).toContain('每轮另计一次原图精修和一次复检');
    expect(f.startLive).not.toHaveBeenCalled();
    await click('开始制作'); await f.created({ ...makeProject(), kind: 'image' });
    await until(() => f.startLive.mock.calls.length === 1, 'red packet cover dispatch');
    const workflow = f.startLive.mock.calls[0][0];
    expect(workflow.imagePreset).toBe('微信红包封面');
    expect(workflow.steps.find(step => step.qualityGate)?.qualityGate).toMatchObject({ maxRepairs: 1 });
    expect(workflow.steps.find(step => step.kind === 'image-generation')).toMatchObject({ imageOutputFormat: 'png', count: 1, imageBackground: 'opaque', prompt: expect.stringContaining('微信红包封面构图') });
    f.verifyLedger();
  });
  it('执行前关闭失败自动处理不派发调用，保存快照和正常制作工作流都保留0次', async () => {
    const f = await fixture({ cover: true });
    await act(async () => host.querySelector<HTMLInputElement>('.image-quality-repair-option input')!.click());
    expect(JSON.parse(localStorage.getItem(f.key)!).repairAfterFailedReview).toBe(false);
    expect(f.startLive).not.toHaveBeenCalled(); expect(f.planningStart).not.toHaveBeenCalled();
    await click('开始制作'); await f.created({ ...makeProject(), kind: 'image' });
    await until(() => f.startLive.mock.calls.length === 1, 'direct dispatch with opt-out');
    expect(f.startLive.mock.calls[0][0].steps.find(step => step.qualityGate)?.qualityGate?.maxRepairs).toBe(0); f.verifyLedger();
  });
  it('上轮聊天材料先复制成真实项目引用，等props回显后才预检派发', async () => {
    const f = await fixture({ attachments: true, delayReferences: true }); await click('开始制作'); expect(f.attachToProject).not.toHaveBeenCalled(); await f.created();
    await until(() => f.updateProject.mock.calls.length === 1, 'copied references waiting for parent echo');
    expect(f.attachToProject).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'conversation', projectId: 'new-project', attachmentIds: ['prior-chat-image'] });
    expect(f.preflight).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled();
    await f.releaseReferences(); await until(() => f.startLive.mock.calls.length === 1, 'dispatch after material adoption');
    expect(f.preflight.mock.calls[0][4]).toContain('copied-reference'); expect(f.attachToProject).toHaveBeenCalledOnce(); f.verifyLedger();
    expect(f.startLive).toHaveBeenCalledOnce(); expect(f.saveRule).not.toHaveBeenCalled();
  });
  it('材料复制失败不触发付费流程，重试成功后只派发一次且旧费用保留', async () => {
    const f = await fixture({ withProject: true, attachments: true, copyFails: true }); await click('开始制作');
    await until(() => host.textContent!.includes('参考材料复制失败'), 'copy failure shown'); expect(f.preflight).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled(); f.verifyLedger();
    await click('开始制作'); await until(() => f.startLive.mock.calls.length === 1, 'retry material preparation'); expect(f.attachToProject).toHaveBeenCalledTimes(2); expect(f.preflight).toHaveBeenCalledOnce(); f.verifyLedger();
    expect(f.startLive).toHaveBeenCalledOnce(); expect(f.saveRule).not.toHaveBeenCalled();
  });
  it('仅保存带附件的方案不复制、不付费，实际开始时再带入材料', async () => {
    const f = await fixture({ withProject: true, attachments: true }); await click('仅保存为自动化'); await until(() => f.readRules().length === 1, 'saved material plan');
    expect(f.attachToProject).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled();
    await click('开始制作'); await until(() => f.trigger.mock.calls.length === 1, 'run saved material plan'); expect(f.attachToProject).toHaveBeenCalledOnce(); expect(f.preflight.mock.calls[0][4]).toContain('copied-reference'); f.verifyLedger();
  });
  it('无项目先保留完整方案，明确制作并完成项目回调后才预检和派发一次', async () => {
    const f = await fixture(); expect(host.textContent).toContain(plan.name); expect(host.textContent).toContain('开始制作时创建项目'); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled();
    expect(host.querySelector('.home-plan-primary')!.textContent).not.toContain('还需补充');
    expect(host.querySelector('.home-plan-primary')!.textContent).not.toContain('仅保存为自动化');
    const start = host.querySelector<HTMLButtonElement>('.home-plan-primary .btn-primary')!;
    await act(async () => { start.click(); start.click(); });
    expect(f.directoryRequests).toHaveBeenCalledOnce(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled();
    await f.created(); await until(() => f.startLive.mock.calls.length === 1, 'new project production dispatch');
    expect(f.saveWorkflow).not.toHaveBeenCalled(); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled(); expect(f.preflight).toHaveBeenCalledOnce();
    const [workflow, target] = f.startLive.mock.calls[0]; expect(target).toBe('new-project');
    expect(workflow.steps.filter(step => step.kind === 'text').every(step => step.reasoningEffort === 'high')).toBe(true); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
    expect(JSON.parse(localStorage.getItem(f.key)!).chatExecution).toEqual({ workflowId: workflow.id, runId: 'direct-run' });
  });
  it.each(['key', 'model'] as const)('缺少%s时不会保存或派发任何生产调用', async missing => {
    const f = await fixture({ missing }); await click('补充制作设置');
    expect(f.directoryRequests).not.toHaveBeenCalled(); expect(f.saveWorkflow).not.toHaveBeenCalled(); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled(); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
    expect(host.querySelector<HTMLDetailsElement>('.chat-plan-models')!.open).toBe(true);
  });
  it('必需参考图在卡片内补齐，确认开始后才建项目并向模型传已复制的真实文件', async () => {
    const f = await fixture({ requiredImages: 1 });
    expect(host.querySelector('.home-plan-primary')!.textContent).toContain('补参考图');
    await click('补参考图');
    expect(f.importAttachments).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'conversation' });
    expect(f.directoryRequests).not.toHaveBeenCalled(); expect(f.startLive).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(f.key)!).chatProductionReferences).toMatchObject([{ id: 'inline-source', kind: 'image' }]);
    await act(async () => root!.unmount()); root = undefined;
    const reopened = await fixture({ requiredImages: 1 });
    expect(reopened.importAttachments).not.toHaveBeenCalled(); expect(reopened.startLive).not.toHaveBeenCalled();
    await click('开始制作'); await reopened.created();
    await until(() => reopened.startLive.mock.calls.length === 1, 'start after source is copied');
    expect(reopened.attachToProject).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['inline-source'] }));
    expect(reopened.preflight.mock.calls[0][4]).toEqual(['copied-reference']);
  });
  it('旧方案要求的真实资料仍在同一张卡填写，未填不创建项目或调用模型', async () => {
    const f = await fixture({ question: '真实商品价格是多少？' });
    await click('补充必要资料');
    expect(host.querySelector('[aria-label="制作资料回答 1"]')).not.toBeNull();
    expect(f.directoryRequests).not.toHaveBeenCalled(); expect(f.startLive).not.toHaveBeenCalled();
  });
  it('项目选择取消后保留方案，重新点击仍只打开项目选择且不提前付费', async () => {
    const f = await fixture(); await click('开始制作'); await act(async () => f.directoryRequests.mock.calls[0][1]!.onCancelled!());
    expect(host.textContent).toContain(plan.name); await click('开始制作'); expect(f.directoryRequests).toHaveBeenCalledTimes(2); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled(); f.verifyLedger();
  });
  it('只保存流程使用真实保存链，但不会预检、运行或重新调用规划AI', async () => {
    const f = await fixture({ withProject: true }); await click('仅保存为自动化'); await until(() => f.readRules().length === 1, 'saved workflow rule');
    expect(f.saveWorkflow).toHaveBeenCalledOnce(); expect(f.readRules()[0].enabled).toBe(false); expect(f.trigger).not.toHaveBeenCalled(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
    expect(f.readWorkflows()[0].automaticRecovery).toBe(true);
  });
  it('预检明确失败时在原对话显示原因，不保存自动化也不派发', async () => {
    const f = await fixture({ withProject: true });
    f.preflight.mockResolvedValueOnce({ ok: false, errors: ['保存目录不可用'], warnings: [], steps: [], unknownCost: false });
    await click('开始制作');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('保存目录不可用');
    expect(f.startLive).not.toHaveBeenCalled(); expect(f.saveRule).not.toHaveBeenCalled();
    await click('开始制作'); expect(f.startLive).toHaveBeenCalledOnce();
  });
  it('启动回执丢失时只能读取原任务，读取成功后在方案下显示进度', async () => {
    const f = await fixture({ withProject: true });
    f.startLive.mockResolvedValueOnce({ status: 'unknown', dispatchKey: 'd'.repeat(64), error: '启动结果尚未确认' });
    await click('开始制作');
    const [workflow, projectId] = f.startLive.mock.calls[0];
    expect(JSON.parse(localStorage.getItem(f.key)!).chatExecution).toEqual({ workflowId: workflow.id });
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '开始制作')).toBe(false);
    f.readStartResult.mockImplementationOnce(async () => { const run = f.addRun(workflow, projectId); return { status: 'started', runId: run.id, run, recovered: true }; });
    await click('读取任务状态');
    expect(JSON.parse(localStorage.getItem(f.key)!).chatExecution.runId).toBe('direct-run');
    expect(host.querySelector('[aria-label="当前方案制作结果"]')).not.toBeNull();
    expect(f.startLive).toHaveBeenCalledOnce(); expect(f.saveRule).not.toHaveBeenCalled();
  });
  it('旧规则目标失效后直接执行到新项目，保留旧流程、规则和费用', async () => {
    const f = await fixture({ staleRule: true }), oldRule = JSON.stringify(f.oldRule), oldWorkflow = JSON.stringify(f.oldWorkflow);
    await click('开始制作'); expect(f.trigger).not.toHaveBeenCalled(); await f.created(makeProject('replacement-project')); await until(() => f.startLive.mock.calls.length === 1, 'replacement project production dispatch');
    expect(f.startLive.mock.calls[0][1]).toBe('replacement-project'); expect(f.saveRule).not.toHaveBeenCalled();
    expect(JSON.stringify(f.readRules().find(rule => rule.id === 'old-rule'))).toBe(oldRule); expect(JSON.stringify(f.readWorkflows().find(workflow => workflow.id === 'old-workflow'))).toBe(oldWorkflow); expect(f.readWorkflows()).toHaveLength(1); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
    const draft = JSON.parse(localStorage.getItem(f.key)!); expect(draft.projectId).toBe('replacement-project'); expect(draft.ruleId).toBeUndefined(); expect(draft.chatExecution.runId).toBe('direct-run'); expect(draft.creationKey).not.toBe('original-creation');
  });
});
