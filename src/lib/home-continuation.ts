import type { AutomationContinuation } from '../automation-types';
import type { WorkflowRun } from '../configuration-types';
import type { HomeAutomationMessage } from './home-automation-chat';

export function homeConversationContinuation(workspaceId: string, projectId: string, currentRuleId: string | undefined, messages: HomeAutomationMessage[], runs: WorkflowRun[]): AutomationContinuation | undefined {
  let previous: HomeAutomationMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'system' && message.kind === 'created' && message.ruleId && message.ruleId !== currentRuleId) { previous = message; break; }
  }
  if (!previous?.ruleId || !previous.workflowId) return;
  const candidates = runs.filter(run => run.mode === 'live' && run.purpose !== 'automation-plan' && run.workspaceId === workspaceId && run.projectId === projectId && run.workflowId === previous.workflowId);
  const date = (run: WorkflowRun) => Date.parse(run.createdAt) || Date.parse(run.updatedAt) || 0;
  const latest = candidates.reduce<WorkflowRun | undefined>((current, run) => !current || date(run) > date(current) ? run : current, undefined);
  if (!latest || latest.status !== 'waiting-review' || previous.productionRunIds?.length && !previous.productionRunIds.includes(latest.id)) return;
  return { previousRuleId: previous.ruleId, previousRunId: latest.id };
}
