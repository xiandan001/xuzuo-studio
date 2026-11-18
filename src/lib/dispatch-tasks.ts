import type { AutomationDecision, AutomationJob, AutomationSnapshot } from '../automation-types';
import type { WorkflowRun } from '../configuration-types';
import type { Project } from '../types';
import type { TaskGroup } from './task-center';
import type { TaskScope } from './task-visibility';

export interface DispatchTask {
  id: string;
  job: AutomationJob;
  decision?: AutomationDecision;
  lastDecision?: AutomationDecision;
  projectName: string;
  title: string;
  summary: string;
  statusLabel: string;
  group: TaskGroup;
  updatedAt: string;
  linkedRunId?: string;
  canStop: boolean;
  canContinue: boolean;
}

const timestamp = (value: string) => Date.parse(value) || 0;
const status = {
  queued: { group: 'running', label: '排队中', summary: '等待执行名额或项目就绪。' },
  dispatching: { group: 'running', label: '正在启动', summary: '等待后台返回运行记录。' },
  running: { group: 'running', label: '已派工', summary: '后台已接收，正在同步运行记录。' },
  decision: { group: 'attention', label: '需要处理', summary: '请刷新任务状态或查看处理选项。' },
  complete: { group: 'finished', label: '已完成', summary: '后台已记录此任务完成。' },
  cancelled: { group: 'finished', label: '已取消', summary: '后台已确认结束此任务。' },
} satisfies Record<AutomationJob['status'], { group: TaskGroup; label: string; summary: string }>;

function decisionsForJob(job: AutomationJob, decisions: readonly AutomationDecision[]) {
  return decisions.filter(item => item.jobId === job.id && item.workspaceId === job.workspaceId && item.projectId === job.projectId &&
    (!job.runId || !item.runId || item.runId === job.runId)).sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
}

export function resolveDispatchRun(job: AutomationJob, runs: readonly WorkflowRun[], decisions: readonly AutomationDecision[] = []): WorkflowRun | undefined {
  const owned = runs.filter(run => run.mode !== 'simulation' && run.projectId === job.projectId && run.workspaceId === job.workspaceId);
  const runId = job.runId || decisionsForJob(job, decisions).find(item => !item.resolvedAt)?.runId;
  return (runId ? owned.find(run => run.id === runId) : undefined) ||
    (job.dispatchKey ? owned.find(run => run.dispatchKey === job.dispatchKey) : undefined);
}

export function buildDispatchTasks(snapshot: AutomationSnapshot, runs: readonly WorkflowRun[], projects: readonly Pick<Project, 'id' | 'name'>[], workspaceId: string): DispatchTask[] {
  const ownedRuns = runs.filter(run => run.workspaceId === workspaceId && run.mode !== 'simulation');
  const runIds = new Set(ownedRuns.map(run => `${run.projectId}:${run.id}`));
  const dispatches = new Set(ownedRuns.filter(run => run.dispatchKey).map(run => `${run.projectId}:${run.dispatchKey}`));
  const rules = new Map(snapshot.rules.filter(rule => rule.workspaceId === workspaceId).map(rule => [rule.id, rule]));
  const names = new Map(projects.map(project => [project.id, project.name]));
  const decisions = new Map<string, AutomationDecision[]>();
  for (const decision of snapshot.decisions) {
    if (decision.workspaceId !== workspaceId) continue;
    const own = decisions.get(decision.jobId) || [];
    own.push(decision);
    decisions.set(decision.jobId, own);
  }
  const seen = new Set<string>();
  const tasks: DispatchTask[] = [];
  for (const job of snapshot.jobs) {
    if (job.workspaceId !== workspaceId || seen.has(job.id)) continue;
    seen.add(job.id);
    const jobDecisions = decisionsForJob(job, decisions.get(job.id) || []);
    const active = jobDecisions.find(item => !item.resolvedAt);
    const linkedRunId = job.runId || active?.runId;
    if (linkedRunId && runIds.has(`${job.projectId}:${linkedRunId}`) || job.dispatchKey && dispatches.has(`${job.projectId}:${job.dispatchKey}`)) continue;
    const base = status[job.status];
    const cancellationPending = 'cancellationPending' in job && job.cancellationPending === true;
    const stopRequested = cancellationPending || ('cancelRequestedAt' in job && Boolean(job.cancelRequestedAt));
    const decision = base.group !== 'finished' || cancellationPending ? active : undefined;
    const group = decision || cancellationPending ? 'attention' : base.group;
    const statusLabel = cancellationPending ? '正在核对取消' : decision?.kind === 'uncertain' ? '状态待核对' : decision?.kind === 'failure' ? '需要处理' : decision?.kind === 'review' ? '待查看运行' : base.label;
    const summary = decision?.detail || job.error || (linkedRunId ? '关联的运行记录暂不可见。' : base.summary);
    const rule = rules.get(job.ruleId);
    tasks.push({
      id: job.id, job, decision, lastDecision: jobDecisions.find(item => Boolean(item.resolvedAt && item.note?.trim())),
      projectName: names.get(job.projectId) || '原项目', title: rule?.projectId === job.projectId ? rule.name : decision?.title || '自动化任务',
      summary, statusLabel, group, updatedAt: job.updatedAt || job.createdAt, linkedRunId,
      canStop: base.group !== 'finished' || cancellationPending,
      canContinue: Boolean(job.status === 'decision' && decision && decision.kind !== 'review' && !linkedRunId && !stopRequested),
    });
  }
  return tasks;
}

export function filterDispatchTasks(tasks: readonly DispatchTask[], filter: { scope: TaskScope; group: TaskGroup | 'all'; projectId: string; query: string }): DispatchTask[] {
  if (filter.scope !== 'visible') return [];
  const query = filter.query.trim().toLocaleLowerCase();
  const order: Record<TaskGroup, number> = { attention: 0, running: 1, finished: 2 };
  return tasks.filter(task => (filter.group === 'all' || task.group === filter.group) && (filter.projectId === 'all' || task.job.projectId === filter.projectId) &&
    `${task.projectName} ${task.title} ${task.statusLabel} ${task.summary} ${task.decision?.title || ''} ${task.job.error || ''}`.toLocaleLowerCase().includes(query))
    .sort((left, right) => order[left.group] - order[right.group] || timestamp(right.updatedAt) - timestamp(left.updatedAt));
}
