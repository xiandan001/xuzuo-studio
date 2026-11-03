import type { LivePreflight, LivePreflightIssue } from '../live-types';

export function workflowIssues(result: LivePreflight): LivePreflightIssue[] {
  if (result.issues?.length) return result.issues;
  return result.errors.map(message => {
    const matches = result.steps.filter(step => message.includes(`“${step.name}”`));
    return { message, ...(matches.length === 1 ? { stepId: matches[0].id } : {}) };
  });
}
export function currentPreflightAccepted(result: LivePreflight | null, inspected: string, current: string, acknowledged: boolean): boolean {
  return Boolean(result?.ok && inspected === current && acknowledged);
}
export function workflowIssueCanLocate(issue: LivePreflightIssue): boolean {
  return Boolean(issue.stepId || issue.field && ['input', 'project', 'variables', 'attachments'].includes(issue.field));
}
