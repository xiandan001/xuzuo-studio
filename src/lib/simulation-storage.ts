import type { StorageIssue, WorkflowRun } from '../configuration-types';
import { recoverWorkflowRuns } from './workflows';

export const SIMULATION_RUNS_KEY = 'xuzuo-workflow-runs-v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type Source = Store | (() => Store);
export interface SimulationRead { runs: WorkflowRun[]; raw?: string | null; issue?: StorageIssue; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown, fields: string[]) => object(value) && fields.every(field => typeof value[field] === 'string');
const stepKinds = ['text', 'vision', 'image-generation', 'image-editing', 'transcription', 'speech', 'video-understanding', 'video-generation', 'manual-review', 'export'];
function validRun(value: unknown): value is WorkflowRun {
  if (!object(value) || !strings(value, ['id', 'workspaceId', 'projectId', 'workflowId', 'workflowName', 'input', 'createdAt', 'updatedAt']) || !['running', 'paused', 'waiting-review', 'complete', 'cancelled', 'interrupted', 'failed'].includes(String(value.status)) || value.mode !== undefined && value.mode !== 'simulation' || !object(value.variables) || !Object.values(value.variables).every(item => typeof item === 'string')) return false;
  const flow = value.snapshot;
  if (!object(flow) || !strings(flow, ['id', 'workspaceId', 'name', 'outputKind']) || !Array.isArray(flow.steps) || !flow.steps.every(step => object(step) && strings(step, ['id', 'name', 'kind', 'prompt']) && stepKinds.includes(String(step.kind)) && ['project', 'previous'].includes(String(step.inputSource)) && typeof step.enabled === 'boolean' && (step.count === undefined || Number.isInteger(step.count) && Number(step.count) >= 1 && Number(step.count) <= 4)) || !Number.isSafeInteger(value.stepIndex) || Number(value.stepIndex) < 0 || Number(value.stepIndex) > flow.steps.length) return false;
  return Array.isArray(value.attempts) && value.attempts.every(attempt => object(attempt) && strings(attempt, ['id', 'stepId', 'stepName', 'modelLabel', 'summary', 'input', 'prompt', 'action']) && ['running', 'waiting-review', 'complete', 'cancelled', 'failed'].includes(String(attempt.status)) && Number.isSafeInteger(attempt.costCents) && Number(attempt.costCents) >= 0 && (attempt.artifacts === undefined || Array.isArray(attempt.artifacts) && attempt.artifacts.every(file => strings(file, ['id', 'name', 'mimeType', 'kind', 'path']))));
}
export function loadSimulationRuns(source: Source): SimulationRead {
  let raw: string | null;
  try { raw = (typeof source === 'function' ? source() : source).getItem(SIMULATION_RUNS_KEY); }
  catch { return { runs: [], issue: { kind: 'read', message: '模拟任务历史暂时无法读取，已停止模拟推进，未用空记录覆盖它。请恢复存储访问后重新读取。', canExportOriginal: false } }; }
  if (raw === null) return { runs: [], raw };
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(validRun)) throw new Error('Invalid simulation history');
    const runs = recoverWorkflowRuns(value.map(run => ({ ...run, snapshot: { ...run.snapshot, steps: run.snapshot.steps.map(step => ({ ...step, budgetCents: step.budgetCents ?? undefined })) } })));
    return { runs, raw };
  } catch { return { runs: [], raw, issue: { kind: 'read', message: '模拟任务历史内容或结构异常，原始记录未被覆盖。请先导出原始数据，再重新读取或备份后重置。', canExportOriginal: true } }; }
}
export function writeSimulationRuns(source: Source, runs: WorkflowRun[]): { raw?: string; issue?: StorageIssue } {
  try { const raw = JSON.stringify(runs); (typeof source === 'function' ? source() : source).setItem(SIMULATION_RUNS_KEY, raw); return { raw }; }
  catch { return { issue: { kind: 'write', message: '模拟任务历史未能保存，已停止本次模拟推进及新增演示费用。原记录和金额保留，请检查存储后重新读取。', canExportOriginal: false } }; }
}
export function resetSimulationRuns(source: Source, backupKey: string, expectedRaw?: string | null): SimulationRead {
  let storage: Store, raw: string | null;
  try { storage = typeof source === 'function' ? source() : source; raw = storage.getItem(SIMULATION_RUNS_KEY); }
  catch { return { runs: [], issue: { kind: 'read', message: '尚不能读取模拟历史，未重置。请恢复存储访问并重新读取。', canExportOriginal: false } }; }
  if (expectedRaw !== undefined && raw !== expectedRaw) return { runs: [], raw: expectedRaw, issue: { kind: 'read', message: '模拟历史已被其他窗口更新，请先重新读取；尚未重置记录。', canExportOriginal: expectedRaw !== null } };
  try {
    if (raw !== null) storage.setItem(backupKey, raw);
    if (storage.getItem(SIMULATION_RUNS_KEY) !== raw) return { runs: [], raw, issue: { kind: 'read', message: '备份期间模拟历史已更新，未覆盖新记录。请先重新读取。', canExportOriginal: raw !== null } };
    storage.setItem(SIMULATION_RUNS_KEY, '[]'); return { runs: [], raw: '[]' };
  } catch { return { runs: [], raw, issue: { kind: 'read', message: '模拟历史备份或重置未完成，原记录未被清空。请先导出并检查存储空间。', canExportOriginal: raw !== null } }; }
}
