import type { AutomationBridge, AutomationContinuation, AutomationJob } from '../automation-types';

export interface AutomationActionResult { status: 'started' | 'existing' | 'saved' | 'needs-input' | 'failed' | 'unknown'; job?: AutomationJob; error?: string; }
interface DispatchReceipt { version: 1; workspaceId: string; ruleId: string; beforeJobIds: string[]; jobId?: string; }
async function bounded<T>(task: Promise<T>): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([task, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(Error('任务服务暂未返回，请读取已有任务状态，不要重复提交。')), 8000); })]); } finally { clearTimeout(timer); } }
export const automationDispatchKey = (workspaceId: string, ruleId: string) => `xuzuo-automation-dispatch-v1:${workspaceId}:${ruleId}`;
export const readAutomationSnapshot = (bridge: AutomationBridge, workspaceId: string) => bounded(bridge.snapshot(workspaceId));
export function latestAutomationJob(jobs: AutomationJob[], ruleId: string): AutomationJob | undefined {
  return jobs.filter(job => job.ruleId === ruleId).sort((left, right) => Number(['queued', 'dispatching', 'running', 'decision'].includes(right.status)) - Number(['queued', 'dispatching', 'running', 'decision'].includes(left.status)) || Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}
export function readAutomationDispatch(storage: Pick<Storage, 'getItem'>, workspaceId: string, ruleId: string, jobs: AutomationJob[]): { job?: AutomationJob; unknown: boolean } {
  const raw = storage.getItem(automationDispatchKey(workspaceId, ruleId));
  let receipt: DispatchReceipt | undefined;
  if (raw) {
    receipt = JSON.parse(raw);
    if (receipt?.version !== 1 || receipt.workspaceId !== workspaceId || receipt.ruleId !== ruleId || !Array.isArray(receipt.beforeJobIds) || receipt.beforeJobIds.some(id => typeof id !== 'string') || receipt.jobId !== undefined && typeof receipt.jobId !== 'string') throw Error('任务提交记录无法可靠读取。请保留本窗口，并在任务中心核对，尚未重新提交。');
  }
  const owned = jobs.filter(job => job.workspaceId === workspaceId && job.ruleId === ruleId);
  const recovered = receipt && (receipt.jobId ? owned.find(job => job.id === receipt.jobId) : owned.filter(job => !receipt.beforeJobIds.includes(job.id)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]);
  return { job: latestAutomationJob(owned, ruleId) || recovered, unknown: !!receipt && !recovered };
}
export async function dispatchAutomationOnce(bridge: AutomationBridge, storage: Pick<Storage, 'getItem' | 'setItem'>, workspaceId: string, ruleId: string, options: { reuseCompleted?: boolean; isCurrent?: () => boolean; continuation?: AutomationContinuation } = {}): Promise<AutomationActionResult> {
  const current = options.isCurrent || (() => true), key = automationDispatchKey(workspaceId, ruleId);
  const snapshot = await readAutomationSnapshot(bridge, workspaceId), state = readAutomationDispatch(storage, workspaceId, ruleId, snapshot.jobs);
  if (!current()) return { status: 'failed' };
  if (state.unknown) return { status: 'unknown', error: '上次提交是否受理尚未确认。请读取任务状态，不会自动重发或再次收费。' };
  if (state.job && (options.reuseCompleted || ['queued', 'dispatching', 'running', 'decision'].includes(state.job.status))) return { status: 'existing', job: state.job };
  const receipt: DispatchReceipt = { version: 1, workspaceId, ruleId, beforeJobIds: snapshot.jobs.filter(job => job.ruleId === ruleId).map(job => job.id) };
  storage.setItem(key, JSON.stringify(receipt));
  if (!current()) return { status: 'failed' };
  try {
    const job = await bounded(bridge.trigger({ ruleId, ...(options.continuation ? { continuation: options.continuation } : {}) }));
    try { storage.setItem(key, JSON.stringify({ ...receipt, jobId: job.id })); } catch { /* The pending receipt and native job still prevent an automatic retry. */ }
    return { status: 'started', job };
  } catch (cause) {
    try {
      const found = readAutomationDispatch(storage, workspaceId, ruleId, (await readAutomationSnapshot(bridge, workspaceId)).jobs);
      if (!found.unknown && found.job) { try { storage.setItem(key, JSON.stringify({ ...receipt, jobId: found.job.id })); } catch { /* Native history remains authoritative. */ } return { status: 'existing', job: found.job }; }
      if (!found.job && cause instanceof Error && cause.message.includes('接续制作未提交：')) { storage.setItem(key, ''); return { status: 'failed', error: cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') }; }
    } catch { /* Unknown acceptance is read-only until native history can be checked. */ }
    return { status: 'unknown', error: '任务提交结果暂未确认，已有费用和记录保留。请读取任务状态；本次不会自动重发。' };
  }
}
