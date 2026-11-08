import type { WorkflowRun } from '../configuration-types';
import type { LedgerEntry } from '../types';
import type { HomeAutomationMessage } from './home-automation-chat';
import type { AutomationRule } from '../automation-types';
export interface HomeLinkedJobRun { workspaceId: string; ruleId: string; runId?: string; }

export function homeConversationCosts(workspaceId: string, messages: HomeAutomationMessage[], runs: WorkflowRun[], ledger: LedgerEntry[], planningRunId?: string, linkedJobs: HomeLinkedJobRun[] = [], checkedRules: string[] = []) {
  const runIds = new Set(messages.map(message => message.runId).filter((id): id is string => !!id));
  if (planningRunId) runIds.add(planningRunId);
  for (const message of messages) if (message.kind === 'created') for (const id of message.productionRunIds || []) runIds.add(id);
  const workflows = new Set(messages.filter(message => message.kind === 'created' && message.workflowId).map(message => message.workflowId));
  const rules = new Set(messages.filter(message => message.kind === 'created' && message.ruleId).map(message => message.ruleId));
  const jobs = linkedJobs.filter(job => job.workspaceId === workspaceId && rules.has(job.ruleId) && job.runId);
  for (const job of jobs) runIds.add(job.runId!);
  for (const run of runs) if (run.workspaceId === workspaceId && run.mode === 'live' && !['automation-plan', 'business-assist'].includes(run.purpose || '') && workflows.has(run.workflowId)) runIds.add(run.id);
  const pendingRuleIds = [...new Set(messages.filter(message => message.kind === 'created' && message.ruleId && !message.productionRunIds?.length && !jobs.some(job => job.ruleId === message.ruleId) && (!message.workflowId || !checkedRules.includes(message.ruleId) && !runs.some(run => run.workspaceId === workspaceId && run.mode === 'live' && run.workflowId === message.workflowId))).map(message => message.ruleId!))];
  const seen = new Set<string>();
  const entries = ledger.filter(entry => { if (entry.billingMode !== 'live' || !entry.workflowRunId || !runIds.has(entry.workflowRunId) || seen.has(entry.id)) return false; seen.add(entry.id); return true; });
  return { entries, pendingRuleIds };
}

export function linkHomeConversationWorkflows(workspaceId: string, messages: HomeAutomationMessage[], rules: AutomationRule[], jobs: HomeLinkedJobRun[] = [], runs: WorkflowRun[] = []): HomeAutomationMessage[] {
  const workflows = new Map(rules.filter(rule => rule.workspaceId === workspaceId).map(rule => [rule.id, rule.workflowId]));
  return messages.map(message => {
    if (message.kind !== 'created') return message;
    const workflowId = message.workflowId || message.ruleId && workflows.get(message.ruleId) || undefined;
    const productionRunIds = [...new Set([...(message.productionRunIds || []), ...jobs.filter(job => job.workspaceId === workspaceId && job.ruleId === message.ruleId && job.runId).map(job => job.runId!), ...runs.filter(run => run.workspaceId === workspaceId && run.mode === 'live' && !['automation-plan', 'business-assist'].includes(run.purpose || '') && workflowId && run.workflowId === workflowId).map(run => run.id)])];
    return workflowId !== message.workflowId || productionRunIds.length !== (message.productionRunIds?.length || 0) ? { ...message, ...(workflowId ? { workflowId } : {}), ...(productionRunIds.length ? { productionRunIds } : {}) } : message;
  });
}
