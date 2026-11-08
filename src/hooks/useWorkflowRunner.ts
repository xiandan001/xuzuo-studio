import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StorageIssue, StudioConfiguration, WorkflowAttempt, WorkflowDefinition, WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { LedgerEntry, Project } from '../types';
import { activeRun, isModelStep, stepInput, workflowStepAction, workflowStepCost, workflowValidation } from '../lib/workflows';
import { resolvePrompt } from '../lib/prompt-variables';
import { useLiveWorkflowRunner } from './useLiveWorkflowRunner';
import { updateRunVisibility } from '../lib/task-visibility';
import { loadSimulationRuns, resetSimulationRuns, SIMULATION_RUNS_KEY, writeSimulationRuns } from '../lib/simulation-storage';
import { downloadFile } from '../lib/files';
type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;
export interface WorkflowRunnerOptions { activeProjectId?: string; runDetailProjectId?: string; workspaceId: string; projects: Project[]; ledger: LedgerEntry[]; configuration: StudioConfiguration; setProjects: Dispatch<SetStateAction<Project[]>>; setLedger: Dispatch<SetStateAction<LedgerEntry[]>>; isOtherTaskRunning: (projectId: string) => boolean; notify: Notify; }

function useSimulationWorkflowRunner(options: WorkflowRunnerOptions): Pick<WorkflowRunner, 'runs' | 'start' | 'pause' | 'resume' | 'cancel' | 'retry' | 'manageRun' | 'simulationStorage'> {
  const [loaded] = useState(() => loadSimulationRuns(() => localStorage));
  const [runs, setRuns] = useState(loaded.runs);
  const [storageIssue, setStorageIssue] = useState(loaded.issue);
  const issueRef = useRef(storageIssue), originalRaw = useRef(loaded.raw);
  const runsRef = useRef(runs);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const updateIssue = (issue?: StorageIssue) => { issueRef.current = issue; setStorageIssue(issue); };
  const canWrite = () => !issueRef.current || (optionsRef.current.notify('模拟历史仍处于数据保护状态，请先处理数据问题；没有执行模拟或新增演示费用。', 'error'), false);
  const commit = (next: WorkflowRun[]) => {
    if (issueRef.current) return false;
    const saved = writeSimulationRuns(() => localStorage, next);
    if (saved.issue) { updateIssue({ ...saved.issue, canExportOriginal: typeof originalRaw.current === 'string' }); optionsRef.current.notify(saved.issue.message, 'error'); return false; }
    originalRaw.current = saved.raw; runsRef.current = next; setRuns(next); return true;
  };
  const update = (id: string, changes: Partial<WorkflowRun>) => commit(runsRef.current.map(run => run.id === id ? { ...run, ...changes, updatedAt: new Date().toISOString() } : run));
  const projectStatus = (projectId: string, status: Project['status']) => optionsRef.current.setProjects(items => items.map(item => item.id === projectId ? { ...item, status, updatedAt: new Date().toISOString() } : item));
  const ownedRun = (id: string) => runsRef.current.find(run => run.id === id && optionsRef.current.projects.some(project => project.id === run.projectId && project.workspaceId === optionsRef.current.workspaceId && !project.trashedAt && !project.purgedAt));
  const cancelRun = (run: WorkflowRun, status: 'cancelled' | 'interrupted' = 'cancelled') => {
    const attempts = run.attempts.map(attempt => ['running', 'waiting-review'].includes(attempt.status) ? { ...attempt, status: 'cancelled' as const, summary: '本次尝试已取消，已发生的演示费用保留。' } : attempt);
    if (!update(run.id, { status, attempts })) return false;
    projectStatus(run.projectId, 'draft');
    optionsRef.current.setLedger(items => items.map(entry => entry.workflowRunId === run.id && entry.status === 'processing' ? { ...entry, status: 'cancelled' } : entry));
    return true;
  };
  const restoreRuns = (next: WorkflowRun[]) => {
    const stopped = runsRef.current.filter(run => activeRun(run) && !next.some(item => item.id === run.id && activeRun(item)));
    runsRef.current = next; setRuns(next);
    if (!stopped.length) return;
    const ids = new Set(stopped.map(run => run.id));
    optionsRef.current.setLedger(items => items.map(entry => ids.has(entry.workflowRunId || '') && entry.status === 'processing' ? { ...entry, status: 'cancelled' } : entry));
    for (const run of stopped) if (!next.some(item => item.projectId === run.projectId && activeRun(item))) projectStatus(run.projectId, 'draft');
  };
  const tick = () => {
    if (issueRef.current) return;
    const currentOptions = optionsRef.current;
    for (const run of runsRef.current.filter(item => item.status === 'running')) {
      const step = run.snapshot.steps[run.stepIndex];
      if (!step) {
        if (!update(run.id, { status: 'complete' })) return;
        projectStatus(run.projectId, 'review');
        currentOptions.setProjects(items => items.map(item => item.id === run.projectId ? { ...item, version: item.version + 1, updatedAt: new Date().toISOString() } : item));
        if (currentOptions.projects.some(item => item.id === run.projectId && item.workspaceId === currentOptions.workspaceId)) currentOptions.notify('工作流模拟完成，逐步费用已保留；未调用真实模型。');
        continue;
      }
      if (!step.enabled) { if (!update(run.id, { stepIndex: run.stepIndex + 1 })) return; continue; }
      const lastAttempt = run.attempts.filter(item => item.stepId === step.id).at(-1);
      if (lastAttempt?.status === 'running') {
        const result = `【模拟结果】${step.name}：依据${step.inputSource === 'project' ? '项目需求' : '上一步模拟结果'}完成步骤示意。${lastAttempt.input.slice(0, 80)}。真实内容与文件尚未生成。`;
        if (!update(run.id, { attempts: run.attempts.map(item => item.id === lastAttempt.id ? { ...item, status: 'complete', summary: result } : item), stepIndex: run.retryStepOnly ? run.snapshot.steps.length : run.stepIndex + 1 })) return;
        currentOptions.setLedger(items => items.map(item => item.workflowAttemptId === lastAttempt.id ? { ...item, status: 'complete' } : item));
        continue;
      }
      const project = currentOptions.projects.find(item => item.id === run.projectId);
      if (!project) { if (!cancelRun(run, 'interrupted')) return; continue; }
      const input = stepInput(run, step);
      const costCents = workflowStepCost(step);
      const invalidBudget = [project.budgetCents, step.budgetCents].some(value => value != null && (!Number.isSafeInteger(value) || value < 0));
      if (invalidBudget || project.budgetCents != null && project.costCents + costCents > project.budgetCents || step.budgetCents != null && step.budgetCents < costCents) { if (!update(run.id, { status: 'paused' })) return; projectStatus(project.id, 'paused'); if (project.workspaceId === currentOptions.workspaceId) currentOptions.notify(invalidBudget ? '金额上限无效，流程已暂停；请填写非负金额或留空。' : '当前步骤预算不足，流程已暂停；已发生费用保留。', 'error'); continue; }
      const model = currentOptions.configuration.models.find(item => item.id === step.modelConfigId);
      const modelLabel = model ? `${model.name} · ${model.modelId} · 模拟` : '人工步骤';
      const action = workflowStepAction(step, Boolean(run.retryStepOnly));
      const attempt: WorkflowAttempt = { id: crypto.randomUUID(), stepId: step.id, stepName: step.name, modelLabel, status: isModelStep(step) ? 'running' : step.kind === 'manual-review' ? 'waiting-review' : 'complete', costCents, input, prompt: resolvePrompt(step.prompt, run.variables).content, action, summary: step.kind === 'manual-review' ? '等待你检查上一步模拟结果，确认后继续。' : step.kind === 'export' ? '交付检查示意完成，可在项目中导出交互草稿；尚未生成真实 Office 文件。' : step.kind === 'animation-compose' ? '本地动画步骤模拟完成，尚未生成实际PNG/GIF；真实合成请使用桌面真实模式。' : '正在模拟处理，不调用 API。' };
      if (!isModelStep(step)) {
        if (!update(run.id, { attempts: [...run.attempts, attempt], status: step.kind === 'manual-review' ? 'waiting-review' : 'running', stepIndex: step.kind === 'manual-review' ? run.stepIndex : run.stepIndex + 1 })) return;
        if (step.kind === 'manual-review') projectStatus(project.id, 'review');
        continue;
      }
      const connection = currentOptions.configuration.connections.find(item => item.id === model?.connectionId);
      const credentialValid = !step.credentialId || currentOptions.configuration.credentials.some(item => item.id === step.credentialId && item.enabled && item.connectionId === model?.connectionId);
      if (!model?.enabled || !connection?.enabled || !model.capabilities.includes(step.kind) || !credentialValid) { if (!update(run.id, { status: 'paused' })) return; projectStatus(project.id, 'paused'); if (project.workspaceId === currentOptions.workspaceId) currentOptions.notify('模型、连接或凭证配置已变化，流程暂停；请检查后继续。', 'error'); continue; }
      if (!update(run.id, { attempts: [...run.attempts, attempt] })) return;
      const entry: LedgerEntry = { id: crypto.randomUUID(), projectId: project.id, projectName: project.name, action, model: `${run.workflowName} / ${step.name} / ${modelLabel}`, costCents, time: new Date().toLocaleString('zh-CN'), status: 'processing', quantity: 1, workflowRunId: run.id, workflowStepId: step.id, workflowAttemptId: attempt.id };
      currentOptions.setLedger(items => [entry, ...items]);
      currentOptions.setProjects(items => items.map(item => item.id === project.id ? { ...item, costCents: item.costCents + costCents, status: 'processing' } : item));
    }
  };
  const tickRef = useRef(tick); tickRef.current = tick;
  useEffect(() => { const timer = window.setInterval(() => tickRef.current(), 1000); return () => window.clearInterval(timer); }, []);
  const projectIds = new Set(options.projects.filter(item => item.workspaceId === options.workspaceId && !item.trashedAt && !item.purgedAt).map(item => item.id));
  return {
    simulationStorage: {
      issue: storageIssue,
      async exportOriginal() { if (typeof originalRaw.current !== 'string') { optionsRef.current.notify('没有可读取的原始模拟历史，请先恢复存储访问。', 'error'); return false; } try { return await downloadFile('序作-原始模拟历史.txt', originalRaw.current, 'text/plain;charset=utf-8'); } catch { optionsRef.current.notify('模拟历史导出未完成，原始记录仍保留。', 'error'); return false; } },
      reload() { const result = loadSimulationRuns(() => localStorage); if (result.raw !== undefined) originalRaw.current = result.raw; if (result.issue) { updateIssue({ ...result.issue, canExportOriginal: typeof originalRaw.current === 'string' }); return false; } restoreRuns(result.runs); updateIssue(); optionsRef.current.notify('模拟历史已重新读取，没有自动续跑或新增演示费用。'); return true; },
      reset() { if (originalRaw.current === undefined) { optionsRef.current.notify('尚不能读取原始模拟历史，未重置，请先重新读取。', 'error'); return false; } const result = resetSimulationRuns(() => localStorage, `${SIMULATION_RUNS_KEY}.recovery.${Date.now()}-${crypto.randomUUID()}`, originalRaw.current); if (result.raw !== undefined) originalRaw.current = result.raw; if (result.issue) { updateIssue({ ...result.issue, canExportOriginal: typeof originalRaw.current === 'string' }); return false; } restoreRuns(result.runs); updateIssue(); optionsRef.current.notify('模拟历史已备份并重置，原有演示费用仍保留，真实任务没有被改变。'); return true; },
    },
    runs: runs.filter(run => projectIds.has(run.projectId)),
    start(workflow: WorkflowDefinition, projectId, input, variables) {
      if (!canWrite()) return false;
      const local = options.configuration.workflows.find(item => item.id === workflow.id && item.workspaceId === options.workspaceId);
      const project = options.projects.find(item => item.id === projectId && item.workspaceId === options.workspaceId && !item.trashedAt && !item.purgedAt);
      if (!local) { options.notify('请先将工作流保存到当前工作区。', 'error'); return false; }
      const error = workflowValidation(local, project, options.configuration, input, variables);
      if (error) { options.notify(error, 'error'); return false; }
      if (options.isOtherTaskRunning(projectId) || runsRef.current.some(run => run.projectId === projectId && activeRun(run))) { options.notify('这个项目已有运行或待确认的任务，请先完成或取消。', 'info'); return false; }
      const time = new Date().toLocaleString('zh-CN');
      if (!commit([{ id: crypto.randomUUID(), workspaceId: options.workspaceId, projectId, workflowId: local.id, workflowName: local.name, snapshot: structuredClone(local), status: 'running', stepIndex: 0, attempts: [], variables: { ...variables }, input, createdAt: time, updatedAt: time }, ...runsRef.current])) return false;
      projectStatus(projectId, 'processing'); options.notify('已开始模拟工作流，费用将按实际执行到的步骤逐笔记录。'); return true;
    },
    async manageRun(id, action) { if (!canWrite()) throw new Error('请先恢复模拟历史存储。'); const run = ownedRun(id); if (!run) throw new Error('任务不属于当前工作区。'); if (!commit(runsRef.current.map(item => item.id === id ? updateRunVisibility(item, action, new Date().toISOString()) : item))) throw new Error('模拟历史未能保存，记录仍保留。'); },
    pause(id) { if (!canWrite()) return; const run = ownedRun(id); if (run?.status === 'running' && update(id, { status: 'paused' })) projectStatus(run.projectId, 'paused'); },
    resume(id, stepBudgetCents) {
      if (!canWrite()) return;
      const run = ownedRun(id);
      if (run && ['paused', 'waiting-review'].includes(run.status)) {
        if (stepBudgetCents !== undefined && stepBudgetCents !== null && (!Number.isSafeInteger(stepBudgetCents) || stepBudgetCents < 0)) { options.notify('当前步骤金额上限无效，请填写非负金额或留空。', 'error'); return; }
        if (stepBudgetCents !== undefined && !run.snapshot.steps[run.stepIndex]) { options.notify('当前没有可调整上限的步骤。', 'error'); return; }
        const snapshot = stepBudgetCents === undefined ? run.snapshot : { ...run.snapshot, steps: run.snapshot.steps.map((step, index) => index === run.stepIndex ? { ...step, budgetCents: stepBudgetCents ?? undefined } : step) };
        const attempts = run.status === 'waiting-review' ? run.attempts.map(attempt => attempt.stepId === run.snapshot.steps[run.stepIndex]?.id && ['waiting-review', 'complete'].includes(attempt.status) ? { ...attempt, status: 'complete' as const, summary: '人工检查已确认通过，继续下一步骤。' } : attempt) : run.attempts;
        if (update(id, { status: 'running', snapshot, attempts, stepIndex: run.stepIndex + (run.status === 'waiting-review' ? 1 : 0) })) projectStatus(run.projectId, 'processing');
      }
    },
    cancel(id) { if (!canWrite()) return; const run = ownedRun(id); if (run && activeRun(run) && cancelRun(run)) options.notify('流程已取消，已经执行的步骤费用保留。', 'info'); },
    retry(id, stepId) {
      if (!canWrite()) return;
      const run = ownedRun(id);
      if (!run || activeRun(run)) { options.notify('请先完成或取消当前流程，再重试单步。', 'info'); return; }
      if (options.isOtherTaskRunning(run.projectId) || runsRef.current.some(item => item.projectId === run.projectId && activeRun(item))) { options.notify('项目已有运行任务。', 'info'); return; }
      const index = run.snapshot.steps.findIndex(step => step.id === stepId && isModelStep(step));
      if (index < 0) return;
      const step = run.snapshot.steps[index];
      const model = options.configuration.models.find(item => item.id === step.modelConfigId && item.enabled);
      const project = options.projects.find(item => item.id === run.projectId && !item.trashedAt && !item.purgedAt);
      if (!model || !project || [project.budgetCents, step.budgetCents].some(value => value != null && (!Number.isSafeInteger(value) || value < 0)) || project.budgetCents != null && project.costCents + workflowStepCost(step) > project.budgetCents || step.budgetCents != null && workflowStepCost(step) > step.budgetCents) { options.notify('模型不可用或已设置的金额上限不足，不能重试。', 'error'); return; }
      if (!update(id, { status: 'running', stepIndex: index, retryStepOnly: true })) return;
      projectStatus(run.projectId, 'processing');
      options.notify('正在单步重试，将新增一条独立演示费用。', 'info');
    },
  };
}

export function useWorkflowRunner(options: WorkflowRunnerOptions): WorkflowRunner {
  const simulation = useSimulationWorkflowRunner(options);
  return useLiveWorkflowRunner(options, simulation);
}
