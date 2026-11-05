import { useRef, useState } from 'react';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { NaturalBinding } from '../components/NaturalAutomationModels';
import type { NaturalAutomationBindings } from '../lib/natural-automation-plan';
import { useRecoveryDraft } from './useRecoveryDraft';
import { writeRecoveryDraft } from '../lib/recovery-draft';
import { downloadFile } from '../lib/files';
import { normalizeNaturalBindings } from '../lib/natural-model-bindings';

export interface NaturalAutomationDraft {
  version: 1; workspaceId: string; projectId: string; input: string; planner: NaturalBinding;
  requestId?: string; plan?: NaturalAutomationPlan; bindings: NaturalAutomationBindings;
  workflowId?: string; creationKey?: string; workflowSaved?: boolean; ruleId?: string;
  planningProjectId?: string; preparationAnswers?: Record<string, string>; calendarResolved?: boolean; needsSetup?: boolean;
  acceptedRequestId?: string; acceptedInput?: string; acceptedPlanningProjectId?: string; requestedCalendarResolved?: boolean; cancelledRequestId?: string;
}
export interface NaturalAutomationDraftOptions { keyPrefix?: string; keepCreatedDraft?: boolean; initialProjectId?: string; initialPlanner?: NaturalBinding; initialBindings?: NaturalAutomationBindings; }
export const naturalAutomationDraftStorageKey = (workspaceId: string, options: NaturalAutomationDraftOptions = {}) => `${options.keyPrefix || 'xuzuo-natural-automation-v1'}:${workspaceId}`;
export function freshNaturalAutomationDraft(previous: NaturalAutomationDraft, projectId: string): NaturalAutomationDraft {
  return { version: 1, workspaceId: previous.workspaceId, projectId: previous.projectId || projectId, input: '', planner: previous.planner, bindings: previous.bindings, preparationAnswers: {} };
}
export function initialNaturalAutomationDraft(previous: NaturalAutomationDraft, projectId: string, options: NaturalAutomationDraftOptions = {}): NaturalAutomationDraft {
  if (previous.ruleId && !previous.needsSetup && !options.keepCreatedDraft) return freshNaturalAutomationDraft(previous, projectId);
  return { ...previous, planningProjectId: previous.planningProjectId || (previous.requestId ? previous.projectId : undefined), acceptedRequestId: previous.acceptedRequestId || (previous.plan ? previous.requestId : undefined), acceptedInput: previous.acceptedInput || (previous.plan ? previous.input : undefined), acceptedPlanningProjectId: previous.acceptedPlanningProjectId || (previous.plan ? previous.planningProjectId || previous.projectId : undefined) };
}
export function normalizedNaturalDraftPlan(plan: NaturalAutomationPlan): NaturalAutomationPlan {
  const lines = (values: string[]) => values.map(value => value.trim()).filter(Boolean);
  return { ...plan, acceptance: lines(plan.acceptance), constraints: lines(plan.constraints) };
}
function editablePlan(value: NaturalAutomationPlan): boolean {
  return value?.version === 1 && ['word', 'ppt', 'excel', 'image'].includes(value.outputKind) && typeof value.name === 'string' && typeof value.objective === 'string' &&
    [value.acceptance, value.constraints, value.questions, value.unsupported].every(values => Array.isArray(values) && values.length <= 100 && values.every(item => typeof item === 'string' && item.length <= 10000)) &&
    Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 12 && value.steps.every(step => ['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind) && typeof step.name === 'string' && typeof step.instruction === 'string') &&
    !!value.trigger && ['manual', 'schedule', 'reference-imported', 'run-completed'].includes(value.trigger.type) && !!value.illustrations && ['none', 'references', 'generate'].includes(value.illustrations.mode) && Number.isSafeInteger(value.maxRepairs);
}
export function readNaturalAutomationDraft(key: string, fallback: NaturalAutomationDraft, options: NaturalAutomationDraftOptions = {}, storage?: Pick<Storage, 'getItem'>): { draft: NaturalAutomationDraft; issue: string } {
  try {
    const raw = (storage || localStorage).getItem(key);
    if (raw === null) return { draft: { ...fallback, projectId: options.initialProjectId || fallback.projectId, planner: options.initialPlanner ? { ...options.initialPlanner } : fallback.planner, bindings: options.initialBindings ? normalizeNaturalBindings(options.initialBindings) : fallback.bindings }, issue: '' };
    if (!raw) return { draft: fallback, issue: '' };
    const value = JSON.parse(raw);
    if (value?.version !== 1 || value.workspaceId !== fallback.workspaceId || typeof value.input !== 'string' || value.input.length > 10000 || typeof value.projectId !== 'string' || !value.planner || !value.bindings) throw Error('format');
    if (value.plan && !editablePlan(value.plan)) throw Error('plan format');
    return { draft: value, issue: '' };
  } catch { return { draft: fallback, issue: '这份自动化草稿暂时无法可靠读取，原记录未覆盖。请先导出或恢复原草稿。' }; }
}
export function useNaturalAutomationDraft(workspaceId: string, projectId: string, options: NaturalAutomationDraftOptions = {}) {
  const key = naturalAutomationDraftStorageKey(workspaceId, options);
  const fallback: NaturalAutomationDraft = { version: 1, workspaceId, projectId, input: '', planner: {}, bindings: {}, preparationAnswers: {} };
  const [loaded, setLoaded] = useState(() => readNaturalAutomationDraft(key, fallback, options));
  const fresh = (previous: NaturalAutomationDraft) => freshNaturalAutomationDraft(previous, projectId);
  const [previousCreated] = useState(loaded.draft.ruleId && !loaded.draft.needsSetup ? loaded.draft : undefined);
  const [draft, setDraft] = useState(() => initialNaturalAutomationDraft(loaded.draft, projectId, options)), current = useRef(draft); current.current = draft;
  const recovery = useRecoveryDraft(key, draft, !loaded.issue, '序作-一句话自动化草稿.json');
  function persist(next: NaturalAutomationDraft) {
    if (loaded.issue) throw Error(loaded.issue);
    const error = writeRecoveryDraft(localStorage, key, JSON.stringify(next));
    if (error) throw Error(error);
    current.current = next; setDraft(next);
  }
  function startNew() { persist(fresh(current.current)); }
  async function recoverOriginal() {
    const raw = localStorage.getItem(key); if (!raw || !await downloadFile('序作-自动化原草稿.json', raw)) return false;
    const next = fresh(current.current), error = writeRecoveryDraft(localStorage, key, JSON.stringify(next));
    if (error) throw Error(error);
    setLoaded({ draft: next, issue: '' }); current.current = next; setDraft(next); return true;
  }
  return { draft, setDraft, current, persist, startNew, recoverOriginal, previousCreated, recovery, issue: loaded.issue };
}
