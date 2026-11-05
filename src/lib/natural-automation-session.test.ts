import { describe, expect, it } from 'vitest';
import type { AutomationPlanningRecord, NaturalAutomationPlan } from '../natural-automation-types';
import type { Project } from '../types';
import type { NaturalAutomationDraft } from '../hooks/useNaturalAutomationDraft';
import { freshNaturalAutomationDraft, initialNaturalAutomationDraft, naturalAutomationDraftStorageKey, readNaturalAutomationDraft } from '../hooks/useNaturalAutomationDraft';
import { naturalPlanningAcceptedDraft, naturalPlanningStartDraft } from '../hooks/useNaturalAutomationPlanning';
import { replaceNaturalProductionBinding } from './natural-model-bindings';

const plan: NaturalAutomationPlan = { version: 1, name: '已接受图片方案', objective: '按已确认目标制作产品图', outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '生成图片', instruction: '保留真实产品要求' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['主体清晰'], constraints: [], maxRepairs: 0, questions: ['品牌名称'], unsupported: [] };
const target: Project = { id: 'target', workspaceId: 'workspace', kind: 'image', name: '制作目标', description: '', status: 'draft', costCents: 0, version: 0, accent: 'purple', updatedAt: '' };
const draft = (): NaturalAutomationDraft => ({ version: 1, workspaceId: 'workspace', projectId: target.id, planningProjectId: 'billing-owner', input: '原始完整目标', planner: { modelConfigId: 'planner', credentialId: 'metadata-key' }, bindings: { 'image-generation': { modelConfigId: 'image' } }, requestId: 'accepted-one', acceptedRequestId: 'accepted-one', acceptedInput: '原始完整目标', acceptedPlanningProjectId: 'billing-owner', plan: structuredClone(plan), preparationAnswers: { 品牌名称: '用户已填写品牌' }, calendarResolved: true, workflowId: 'saved-workflow', creationKey: 'saved-creation', workflowSaved: true, ruleId: 'saved-rule', needsSetup: true });
const record = (changes: Partial<AutomationPlanningRecord> = {}): AutomationPlanningRecord => ({ id: 'new-request', workspaceId: 'workspace', projectId: 'billing-owner', input: '换成国风', status: 'complete', resultText: JSON.stringify({ ...plan, name: '国风新版本' }), createdAt: '', updatedAt: '', ...changes });
const start = (previous: NaturalAutomationDraft, input = '换成国风') => naturalPlanningStartDraft(previous, 'new-request', input, 'billing-owner', { modelConfigId: 'planner-two', credentialId: 'metadata-two' }, { input, priorPlanId: 'accepted-one', currentPlan: previous.plan, calendarResolved: true, billingProjectId: 'billing-owner' });

describe('共享自动化会话与多轮方案归属', () => {
  it('旧modal仍用原key与已创建后fresh策略，Home独立key并保留已创建草稿', () => {
    const source = { ...draft(), needsSetup: false }, before = JSON.stringify(source);
    expect(naturalAutomationDraftStorageKey('workspace')).toBe('xuzuo-natural-automation-v1:workspace');
    expect(naturalAutomationDraftStorageKey('workspace', { keyPrefix: 'xuzuo-home-automation-v1' })).toBe('xuzuo-home-automation-v1:workspace');
    expect(naturalAutomationDraftStorageKey('other', { keyPrefix: 'xuzuo-home-automation-v1' })).not.toBe(naturalAutomationDraftStorageKey('workspace', { keyPrefix: 'xuzuo-home-automation-v1' }));
    const legacy = initialNaturalAutomationDraft(source, target.id); expect(legacy.plan).toBeUndefined(); expect(legacy.ruleId).toBeUndefined(); expect(legacy.planner).toEqual(source.planner);
    const home = initialNaturalAutomationDraft(source, target.id, { keepCreatedDraft: true }); expect(home.plan).toEqual(source.plan); expect(home.ruleId).toBe('saved-rule'); expect(home.creationKey).toBe('saved-creation'); expect(JSON.stringify(source)).toBe(before);
  });
  it('显式新草稿保留模型偏好，清当前创建指针，不改变已存业务快照', () => {
    const previous = draft(), before = JSON.stringify(previous), fresh = freshNaturalAutomationDraft(previous, target.id);
    expect(fresh.planner).toEqual(previous.planner); expect(fresh.bindings).toEqual(previous.bindings); expect(fresh.plan).toBeUndefined(); expect(fresh.workflowId).toBeUndefined(); expect(fresh.creationKey).toBeUndefined(); expect(fresh.acceptedRequestId).toBeUndefined(); expect(fresh.preparationAnswers).toEqual({}); expect(JSON.stringify(previous)).toBe(before);
  });
  it('全新key才继承新对话初始模型/Key和target，已有草稿重开不会被初始值覆盖', () => {
    const fallback = freshNaturalAutomationDraft(draft(), 'fallback-project'), initialPlanner = { modelConfigId: 'initial-planner', credentialId: 'initial-key' }, initialBindings = { text: { modelConfigId: 'production-text', credentialId: 'production-key' }, 'image-generation': { modelConfigId: 'production-image' } }, options = { initialProjectId: 'initial-target', initialPlanner, initialBindings };
    const fresh = readNaturalAutomationDraft('new-key', fallback, options, { getItem: () => null }); expect(fresh.issue).toBe(''); expect(fresh.draft.projectId).toBe('initial-target'); expect(fresh.draft.planner).toEqual(initialPlanner);
    fresh.draft.planner.modelConfigId = 'only-local-change'; expect(initialPlanner.modelConfigId).toBe('initial-planner');
    expect(fresh.draft.bindings).toEqual(initialBindings); fresh.draft.bindings.text!.modelConfigId = 'changed-local-text'; expect(initialBindings.text.modelConfigId).toBe('production-text');
    const original = draft(), raw = JSON.stringify(original), loaded = readNaturalAutomationDraft('existing-key', fallback, options, { getItem: () => raw }); expect(loaded.issue).toBe(''); expect(loaded.draft).toEqual(original); expect(loaded.draft.projectId).toBe(target.id); expect(loaded.draft.planner.modelConfigId).toBe('planner');
  });
  it('已存在的坏稿不会因传入新对话初值而被替换，仍走原恢复提示', () => {
    const fallback = freshNaturalAutomationDraft(draft(), 'fallback-project'), raw = '{bad-json', loaded = readNaturalAutomationDraft('broken-key', fallback, { initialProjectId: 'wrong-seed', initialPlanner: { modelConfigId: 'wrong-model' }, initialBindings: { text: { modelConfigId: 'wrong-production' } } }, { getItem: () => raw });
    expect(loaded.issue).toContain('原记录未覆盖'); expect(loaded.draft).toBe(fallback); expect(loaded.draft.projectId).not.toBe('wrong-seed'); expect(raw).toBe('{bad-json');
  });
  it('无options的旧start保留原重新规划语义', () => {
    const next = naturalPlanningStartDraft(draft(), 'new-request', '新目标', target.id, { modelConfigId: 'planner', credentialId: 'metadata' });
    expect(next.plan).toBeUndefined(); expect(next.ruleId).toBeUndefined(); expect(next.workflowId).toBeUndefined(); expect(next.preparationAnswers).toEqual({}); expect(next.calendarResolved).toBe(false); expect(next.acceptedInput).toBeUndefined(); expect(next.requestId).toBe('new-request'); expect(next.planningProjectId).toBe(target.id);
  });
  it('单独调整生产模型后下一轮规划/新草稿保留它，切换对话模型不覆盖生产绑定', () => {
    const previous = draft(), changed = { ...previous, bindings: replaceNaturalProductionBinding(previous.bindings, 'text', { modelConfigId: 'production-only', credentialId: 'production-key' }) };
    const pending = start(changed), accepted = naturalPlanningAcceptedDraft(pending, record(), [target]);
    expect(pending.bindings.text).toEqual(changed.bindings.text); expect(accepted.bindings.text).toEqual(changed.bindings.text);
    expect(freshNaturalAutomationDraft(accepted, target.id).bindings).toEqual(changed.bindings); expect(pending.planner).toEqual(previous.planner); expect(previous.bindings.text).toBeUndefined();
  });
  it('新turn pending时保留上一有效方案/业务指针/资料/时机，规划费用owner和制作target独立', () => {
    const previous = draft(), before = JSON.stringify(previous), next = start(previous);
    expect(next.requestId).toBe('new-request'); expect(next.input).toBe('换成国风'); expect(next.plan).toEqual(previous.plan); expect(next.workflowId).toBe(previous.workflowId); expect(next.ruleId).toBe(previous.ruleId); expect(next.creationKey).toBe(previous.creationKey); expect(next.preparationAnswers).toEqual(previous.preparationAnswers); expect(next.calendarResolved).toBe(true);
    expect(next.acceptedRequestId).toBe('accepted-one'); expect(next.acceptedInput).toBe('原始完整目标'); expect(next.planningProjectId).toBe('billing-owner'); expect(next.projectId).toBe(target.id); expect(JSON.stringify(previous)).toBe(before);
  });
  it.each(['running', 'failed', 'cancelled', 'interrupted'] as const)('新请求%s不能抹掉已接受版本，也不改旧创建指针', status => {
    const pending = start(draft()); expect(naturalPlanningAcceptedDraft(pending, record({ status }), [target])).toBe(pending); expect(pending.acceptedRequestId).toBe('accepted-one'); expect(pending.ruleId).toBe('saved-rule');
  });
  it('匹配的新成功版本才替换方案并清创建指针，已补资料保留，旧业务对象不变', () => {
    const previous = draft(), pending = start(previous), before = JSON.stringify(pending), accepted = naturalPlanningAcceptedDraft(pending, record(), [target]);
    expect(accepted.plan?.name).toBe('国风新版本'); expect(accepted.acceptedRequestId).toBe('new-request'); expect(accepted.acceptedInput).toBe('换成国风'); expect(accepted.workflowId).toBeUndefined(); expect(accepted.ruleId).toBeUndefined(); expect(accepted.creationKey).toBeUndefined(); expect(accepted.workflowSaved).toBe(false); expect(accepted.preparationAnswers).toEqual(previous.preparationAnswers); expect(accepted.calendarResolved).toBe(true); expect(JSON.stringify(pending)).toBe(before); expect(previous.ruleId).toBe('saved-rule');
  });
  it('同一成功请求免费重复read只更新安全来源字段，不覆盖用户本地修改', () => {
    const accepted = naturalPlanningAcceptedDraft(start(draft()), record(), [target]), edited = { ...accepted, plan: { ...accepted.plan!, name: '本地免费改名', objective: '本地确认的新说明' }, workflowId: 'new-flow', workflowSaved: true, ruleId: 'new-rule' };
    const read = naturalPlanningAcceptedDraft(edited, record(), [target]); expect(read.plan?.name).toBe('本地免费改名'); expect(read.plan?.objective).toBe('本地确认的新说明'); expect(read.ruleId).toBe('new-rule'); expect(read.workflowId).toBe('new-flow'); expect(read.acceptedInput).toBe('换成国风');
  });
  it('多轮停止时完成结果抢先返回也不采用新方案，重开免费read保留旧版直到明确恢复', () => {
    const pending = { ...start(draft()), cancelledRequestId: 'new-request' };
    expect(naturalPlanningAcceptedDraft(pending, record(), [target])).toBe(pending); expect(pending.ruleId).toBe('saved-rule'); expect(pending.acceptedRequestId).toBe('accepted-one');
    const reopened = initialNaturalAutomationDraft(JSON.parse(JSON.stringify(pending)), target.id, { keepCreatedDraft: true }); expect(naturalPlanningAcceptedDraft(reopened, record(), [target])).toBe(reopened);
    const explicitRestore = { ...pending, cancelledRequestId: undefined }; expect(naturalPlanningAcceptedDraft(explicitRestore, record(), [target]).plan?.name).toBe('国风新版本');
  });
  it('旧nonce、跨workspace或错billing project的迟到结果不覆盖当前方案', () => {
    const pending = start(draft()); for (const value of [record({ id: 'accepted-one' }), record({ workspaceId: 'other' }), record({ projectId: target.id })]) expect(naturalPlanningAcceptedDraft(pending, value, [target])).toBe(pending);
  });
  it('旧版本手动时机续问风格不清除，但新明确固定时间不能沿用旧豁免', () => {
    const pending = start(draft(), '还是9点执行'); expect(pending.calendarResolved).toBe(true); expect(pending.requestedCalendarResolved).toBe(false);
    const next = naturalPlanningAcceptedDraft(pending, record({ input: '还是9点执行' }), [target]); expect(next.calendarResolved).toBe(false); expect(next.plan?.unsupported.join('')).toContain('固定日历时间');
    const reread = naturalPlanningAcceptedDraft(next, record({ input: '还是9点执行' }), [target]); expect(reread.plan?.unsupported).toEqual(next.plan?.unsupported);
    expect(start(draft(), '主题还是9点见').requestedCalendarResolved).toBe(true); expect(start(draft(), '还是不要9点触发').requestedCalendarResolved).toBe(true);
  });
  it('旧格式已编辑plan首次免费读不被覆盖，缺accepted元数据会安全补齐', () => {
    const old = { ...draft(), requestId: 'new-request', acceptedRequestId: undefined, acceptedInput: undefined, plan: { ...plan, name: '旧已编辑名称' }, requestedCalendarResolved: undefined };
    const read = naturalPlanningAcceptedDraft(old, record(), [target]); expect(read.plan?.name).toBe('旧已编辑名称'); expect(read.ruleId).toBe('saved-rule'); expect(read.acceptedRequestId).toBe('new-request'); expect(read.acceptedInput).toBe('换成国风');
  });
});
