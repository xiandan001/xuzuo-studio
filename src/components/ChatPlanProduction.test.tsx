// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationContext, AutomationJob, AutomationRule, AutomationRuleDraft } from '../automation-types';
import type { WorkflowDefinition, WorkflowDraft } from '../configuration-types';
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

async function fixture({ withProject = false, missing = '', staleRule = false }: { withProject?: boolean; missing?: 'key' | 'model' | ''; staleRule?: boolean } = {}) {
  const conversationId = 'conversation', workspaceId = 'workspace';
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
  const desktop = { automation: { snapshot, syncContext, saveRule, trigger, onChanged(listener: () => void) { changed.add(listener); return () => changed.delete(listener); } }, automationPlanning: { list: vi.fn(async () => []), start: planningStart } };
  Object.defineProperty(window, 'desktop', { configurable: true, value: desktop });
  const directoryRequests = vi.fn<PageProps['onCreateProject']>(), preflight = vi.fn(async () => ({ ok: true, errors: [], warnings: [], steps: [], unknownCost: false }));
  const ledger = Object.freeze([{ id: 'prior-cost', projectId: 'trashed-project', projectName: '旧项目', action: '初次生成', model: '已调用的模型', costCents: 27, costState: 'calculated', billingMode: 'live', time: timestamp, status: 'complete' }]) as unknown as LedgerEntry[];
  const savedLedger = JSON.stringify(ledger), key = naturalAutomationDraftStorageKey(workspaceId, { keyPrefix: `xuzuo-chat-production-v1:${conversationId}:${turn.id}` });
  if (staleRule) {
    const saved: NaturalAutomationDraft = { version: 1, workspaceId, projectId: oldRule.projectId, input: turn.userText, acceptedInput: turn.userText, planner, bindings: { text: planner }, plan, ruleId: oldRule.id, workflowId: oldWorkflow.id, workflowSaved: true, creationKey: 'original-creation', preparationAnswers: {} };
    localStorage.setItem(key, JSON.stringify(saved));
  }
  let updateProjects!: (projects: Project[]) => void, savedWorkflows: WorkflowDefinition[] = staleRule ? [structuredClone(oldWorkflow)] : [];
  const saveWorkflow = vi.fn((draft: WorkflowDraft, id?: string) => {
    const value = { ...structuredClone(draft), id: id!, workspaceId, updatedAt: new Date().toISOString() };
    updateWorkflows(current => [...current.filter(flow => flow.id !== id), value]); return true;
  });
  let updateWorkflows!: (updater: (current: WorkflowDefinition[]) => WorkflowDefinition[]) => void;
  function Harness() {
    const [projects, setProjects] = useState<Project[]>(withProject ? [makeProject()] : []), [workflows, setWorkflows] = useState<WorkflowDefinition[]>(savedWorkflows);
    updateProjects = setProjects; updateWorkflows = setWorkflows; savedWorkflows = workflows;
    const props = { workspaceId, workspace: { id: workspaceId, name: '独立测试工作区' }, workspaces: [{ id: workspaceId, name: '独立测试工作区' }], projects, trashedProjects: [], purgedProjects: [], activeProject: projects[0] || { id: '' }, ledger, configuration: { connections: [connection], models: missing === 'model' ? [] : [model], credentials: missing === 'key' ? [] : [{ id: 'account-metadata', name: '账户元数据', connectionId: connection.id, enabled: true }], workflows, saveWorkflow }, workflowRunner: { runs: [], preflight }, preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: directoryRequests } as unknown as PageProps;
    return <ChatPlanProduction props={props} turn={turn} conversationId={conversationId} planner={planner} />;
  }
  await act(async () => { root = createRoot(host); root.render(<Harness />); });
  async function created(project = makeProject()) {
    const options = directoryRequests.mock.calls.at(-1)?.[1]; expect(options?.onCreated).toBeTypeOf('function');
    await act(async () => { updateProjects([project]); options!.onCreated!(project); });
  }
  return { key, directoryRequests, preflight, saveWorkflow, saveRule, trigger, planningStart, syncContext, created, snapshot, oldRule, oldWorkflow, readRules: () => rules, readJobs: () => jobs, readWorkflows: () => savedWorkflows, verifyLedger: () => expect(JSON.stringify(ledger)).toBe(savedLedger) };
}

describe('聊天方案通过真实session创建和运行生产流程', () => {
  it('无项目先保留完整方案，明确制作并完成项目回调后才预检和派发一次', async () => {
    const f = await fixture(); expect(host.textContent).toContain(plan.name); expect(host.textContent).toContain('开始制作时选择'); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled();
    await click('按这个方案制作'); expect(f.directoryRequests).toHaveBeenCalledOnce(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled();
    await f.created(); await until(() => f.trigger.mock.calls.length === 1, 'new project production dispatch');
    expect(f.saveWorkflow).toHaveBeenCalledOnce(); expect(f.preflight).toHaveBeenCalledOnce(); expect(f.readJobs()[0].projectId).toBe('new-project'); expect(f.readRules()[0].workflowId).toBe(f.readWorkflows()[0].id);
    expect(f.readWorkflows()[0].steps.filter(step => step.kind === 'text').every(step => step.reasoningEffort === 'high')).toBe(true); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
    await click('查看制作进度'); expect(f.trigger).toHaveBeenCalledOnce();
  });
  it.each(['key', 'model'] as const)('缺少%s时不会保存或派发任何生产调用', async missing => {
    const f = await fixture({ withProject: true, missing }); await click('按这个方案制作');
    expect(f.directoryRequests).not.toHaveBeenCalled(); expect(f.saveWorkflow).not.toHaveBeenCalled(); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled(); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
  });
  it('项目选择取消后保留方案，重新点击仍只打开项目选择且不提前付费', async () => {
    const f = await fixture(); await click('按这个方案制作'); await act(async () => f.directoryRequests.mock.calls[0][1]!.onCancelled!());
    expect(host.textContent).toContain(plan.name); await click('按这个方案制作'); expect(f.directoryRequests).toHaveBeenCalledTimes(2); expect(f.saveRule).not.toHaveBeenCalled(); expect(f.trigger).not.toHaveBeenCalled(); f.verifyLedger();
  });
  it('只保存流程使用真实保存链，但不会预检、运行或重新调用规划AI', async () => {
    const f = await fixture({ withProject: true }); await click('以后再做'); await until(() => f.readRules().length === 1, 'saved workflow rule');
    expect(f.saveWorkflow).toHaveBeenCalledOnce(); expect(f.readRules()[0].enabled).toBe(false); expect(f.trigger).not.toHaveBeenCalled(); expect(f.preflight).not.toHaveBeenCalled(); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
  });
  it('旧规则目标失效后为新项目fork流程，不复用旧rule、不改旧流程或旧费用', async () => {
    const f = await fixture({ staleRule: true }), oldRule = JSON.stringify(f.oldRule), oldWorkflow = JSON.stringify(f.oldWorkflow);
    await click('继续制作'); expect(f.trigger).not.toHaveBeenCalled(); await f.created(makeProject('replacement-project')); await until(() => f.trigger.mock.calls.length === 1, 'forked project production dispatch');
    const requested = f.trigger.mock.calls[0][0].ruleId; expect(requested).not.toBe('old-rule'); expect(f.readRules().find(rule => rule.id === requested)?.projectId).toBe('replacement-project');
    expect(JSON.stringify(f.readRules().find(rule => rule.id === 'old-rule'))).toBe(oldRule); expect(JSON.stringify(f.readWorkflows().find(workflow => workflow.id === 'old-workflow'))).toBe(oldWorkflow); expect(f.readWorkflows()).toHaveLength(2); expect(f.planningStart).not.toHaveBeenCalled(); f.verifyLedger();
    const draft = JSON.parse(localStorage.getItem(f.key)!); expect(draft.projectId).toBe('replacement-project'); expect(draft.ruleId).toBe(requested); expect(draft.creationKey).not.toBe('original-creation');
  });
});
