import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, LiveRuntimeStatus, LiveSnapshot, LiveStartRequest } from '../live-types';
import type { LedgerEntry, Project } from '../types';
import type { WorkflowRunnerOptions } from './useWorkflowRunner';
import { activeRun } from '../lib/workflows';
import { withCreationFoundation } from '../lib/creation-quality';
import { mergeRunSummaries, runDetailKey } from '../lib/run-details';
import { explicitTimestamp } from '../lib/studio-time';
import { createArtifactPreviewCache } from '../lib/artifact-preview-cache';
import { createProjectFileCache } from '../lib/project-file-cache';
import { mergeNativeSnapshot } from '../lib/native-snapshot';
import { liveProjectStateSignature, liveProjectStatus, selectProjectStatusRun } from '../lib/project-status';
import { isProductionRun } from '../lib/workflow-purpose';
import { createLiveStartCoordinator } from '../lib/live-start';
import { prepareLiveStartSource } from '../lib/live-start-source';

type SimulationRunner = Pick<WorkflowRunner, 'runs' | 'start' | 'pause' | 'resume' | 'cancel' | 'retry' | 'manageRun' | 'simulationStorage'>;
const unavailable = { available: false, reason: '真实执行仅在新版桌面应用中可用；浏览器可编辑配置或主动选择模拟。' };
export function overlayArtifactMetadata(runs: WorkflowRun[], trash: ArtifactMetadata[] | undefined, updated: Record<string, ArtifactMetadata>): WorkflowRun[] {
  const recycled = new Map(trash?.map(artifact => [artifact.id, artifact]));
  return runs.map(run => ({ ...run, attempts: run.attempts.map(attempt => ({ ...attempt, artifacts: attempt.artifacts?.map(artifact => {
    const metadata = recycled.get(artifact.id) || updated[artifact.id] || artifact;
    return { ...artifact, ...metadata, trashedAt: trash === undefined ? metadata.trashedAt : recycled.get(artifact.id)?.trashedAt };
  }) })) }));
}
export function mergeLiveLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[] {
  const known = new Map(existing.map(entry => [entry.id, entry]));
  let changed = false;
  const merged = incoming.map(entry => { const old = known.get(entry.id); if (old === entry || old && JSON.stringify(old) === JSON.stringify(entry)) return old; changed = true; return entry; });
  const ids = new Set(incoming.map(entry => entry.id));
  return changed || incoming.some((entry, index) => existing[index]?.id !== entry.id) ? [...merged, ...existing.filter(entry => !ids.has(entry.id))] : existing;
}
export function applyLiveProjectState(project: Project, latest: WorkflowRun | undefined, delta: number, liveTotal?: number): Project {
  if (project.purgedAt) return project;
  if (latest && !isProductionRun(latest)) latest = undefined;
  const tracksBaseline = project.liveLedgerBaselineCents !== undefined && liveTotal !== undefined;
  if (tracksBaseline) delta = liveTotal! - project.liveLedgerBaselineCents!;
  const completion = latest?.status === 'complete' ? `${latest.id}:${latest.attempts.length}` : undefined;
  const changedCompletion = Boolean(completion && project.lastLiveCompletionId !== completion);
  const stateSignature = latest ? liveProjectStateSignature(latest) : project.lastLiveStateSignature;
  const changedState = stateSignature !== project.lastLiveStateSignature;
  const confirmedState = latest && ['complete', 'waiting-review'].includes(latest.status) && project.confirmedDelivery?.runStateSignature === stateSignature;
  const invalidatedConfirmation = Boolean(latest && project.confirmedDelivery && !confirmedState);
  const statusMismatch = Boolean(latest && (activeRun(latest) || confirmedState) && project.status !== liveProjectStatus(project, latest));
  if (!delta && !changedCompletion && !changedState && !statusMismatch && !invalidatedConfirmation) return project;
  const timestamp = latest && (changedState || changedCompletion) ? explicitTimestamp(latest.updatedAt) : undefined;
  const previousTime = explicitTimestamp(project.updatedAt);
  const updatedAt = timestamp === undefined || previousTime !== undefined && previousTime >= timestamp ? project.updatedAt : new Date(timestamp).toISOString();
  return { ...project, ...(invalidatedConfirmation ? { confirmedDelivery: undefined } : {}), ...(tracksBaseline ? { liveLedgerBaselineCents: liveTotal } : {}), updatedAt, costCents: project.costCents + delta, status: latest && (changedState || statusMismatch) ? liveProjectStatus(project, latest) : project.status, version: project.version + (changedCompletion ? 1 : 0), lastLiveCompletionId: changedCompletion ? completion : project.lastLiveCompletionId, lastLiveStateSignature: stateSignature };
}
export function useLiveWorkflowRunner(options: WorkflowRunnerOptions, simulation: SimulationRunner): WorkflowRunner {
  const [liveRuns, setLiveRuns] = useState<WorkflowRun[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<LiveRuntimeStatus>(unavailable);
  const [trashedArtifacts, setTrashedArtifacts] = useState<ArtifactMetadata[]>();
  const [updatedArtifacts, setUpdatedArtifacts] = useState<Record<string, ArtifactMetadata>>({});
  const trashReadRevision = useRef(0);
  const [previewCache] = useState(createArtifactPreviewCache);
  const [thumbnailCache] = useState(() => createArtifactPreviewCache({ completed: true, maxEntries: 32, maxBytes: 4 * 1024 * 1024, ttlMs: 5000 }));
  const [inventoryCache] = useState(createProjectFileCache);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const artifactSignatures = useRef(new Map<string, string>());
  const optionsRef = useRef(options); optionsRef.current = options;
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const purgedProjectSignature = options.projects.filter(project => project.purgedAt).map(project => project.id).sort().join('|');
  useEffect(() => {
    if (!purgedProjectSignature) return;
    previewCache.clear(); thumbnailCache.clear();
    for (const projectId of purgedProjectSignature.split('|')) inventoryCache.invalidate(projectId);
  }, [purgedProjectSignature, previewCache, thumbnailCache, inventoryCache]);
  const signature = useRef('');
  const revision = useRef(-1);
  const importedCosts = useRef(new Map(options.ledger.map(entry => [entry.id, entry.costCents])));
  const liveRunsRef = useRef(liveRuns); liveRunsRef.current = liveRuns;
  const nativeSnapshot = useRef<LiveSnapshot>({ runs: [], ledger: [] });
  const merge = (snapshot: LiveSnapshot) => {
    if (snapshot.revision !== undefined && snapshot.revision < revision.current) return;
    revision.current = snapshot.revision ?? revision.current;
    const fingerprint = snapshot.revision === undefined ? JSON.stringify(snapshot) : String(snapshot.revision);
    if (signature.current === fingerprint) return;
    signature.current = fingerprint;
    const merged = mergeNativeSnapshot(nativeSnapshot.current, snapshot); nativeSnapshot.current = merged;
    const artifactIds = new Map<string, string[]>();
    for (const run of merged.runs) for (const attempt of run.attempts) for (const file of attempt.artifacts || []) {
      const ids = artifactIds.get(run.projectId) || []; ids.push(JSON.stringify([file.id, file.path, file.bytes, file.trashedAt, file.unavailable])); artifactIds.set(run.projectId, ids);
    }
    for (const [projectId, ids] of artifactIds) { const next = ids.join('|'); if (artifactSignatures.current.get(projectId) !== next) { inventoryCache.invalidate(projectId); artifactSignatures.current.set(projectId, next); } }
    setLiveRuns(previous => { const next = mergeRunSummaries(merged.runs, previous); return next.length === previous.length && next.every((run, index) => run === previous[index]) ? previous : next; });
    const current = optionsRef.current;
    const delta = new Map<string, number>(), liveTotals = new Map<string, number>();
    const currentCosts = new Map(current.ledger.map(entry => [entry.id, entry.costCents]));
    merged.ledger.forEach(entry => { liveTotals.set(entry.projectId, (liveTotals.get(entry.projectId) || 0) + entry.costCents); });
    snapshot.ledger.forEach(entry => { delta.set(entry.projectId, (delta.get(entry.projectId) || 0) + entry.costCents - (importedCosts.current.get(entry.id) ?? currentCosts.get(entry.id) ?? 0)); importedCosts.current.set(entry.id, entry.costCents); });
    const latestByProject = new Map<string, WorkflowRun>(), activeByProject = new Map<string, WorkflowRun>();
    for (const run of merged.runs.filter(isProductionRun)) { if (!latestByProject.has(run.projectId)) latestByProject.set(run.projectId, run); if (activeRun(run) && !activeByProject.has(run.projectId)) activeByProject.set(run.projectId, run); }
    current.setLedger(entries => mergeLiveLedger(entries, merged.ledger));
    current.setProjects(projects => { const next = projects.map(project => {
      const latest = selectProjectStatusRun(project, latestByProject.get(project.id), activeByProject.get(project.id));
      if (!latest && !delta.has(project.id)) return project;
      return applyLiveProjectState(project, latest, delta.get(project.id) || 0, liveTotals.get(project.id) || 0);
    }); return next.some((project, index) => project !== projects[index]) ? next : projects; });
  };
  const mergeRef = useRef(merge); mergeRef.current = merge;
  const [starts] = useState(() => createLiveStartCoordinator({ storage: () => localStorage, bridge: () => window.desktop?.runtime, onRun: run => {
    if (!alive.current) return;
    if (!nativeSnapshot.current.runs.some(item => item.id === run.id)) mergeRef.current({ delta: true, runs: [run], ledger: [] });
    const bridge = window.desktop?.runtime;
    if (bridge) void (async () => { try { const snapshot = await (bridge.pollSnapshot ? bridge.pollSnapshot(-1) : bridge.snapshot()); if (alive.current && snapshot) mergeRef.current(snapshot); } catch { /* Acceptance is independent of a subsequent poll; regular polling will recover. */ } })();
  } }));
  useEffect(() => window.desktop?.runtime?.onProjectFilesChanged?.(projectId => { inventoryCache.invalidate(projectId); thumbnailCache.clear(); setInventoryRevision(value => value + 1); }), [inventoryCache, thumbnailCache]);
  const listProjectArtifacts = useCallback(async (projectId: string, input?: { refresh?: boolean }) => {
    const current = optionsRef.current;
    if (!current.projects.some(project => project.id === projectId && project.workspaceId === current.workspaceId && !project.trashedAt && !project.purgedAt)) throw new Error('项目不属于当前工作区。');
    const load = window.desktop?.runtime?.listProjectArtifacts; if (!load) throw new Error('请使用支持项目文件清单的桌面应用。');
    return inventoryCache.read(projectId, async () => {
      const scoped = (await load(projectId)).filter(file => file.projectId === projectId);
      setUpdatedArtifacts(previous => {
        let next = previous;
        for (const file of scoped) if (JSON.stringify(previous[file.id]) !== JSON.stringify(file)) { if (next === previous) next = { ...previous }; next[file.id] = file; }
        return next;
      }); return scoped;
    }, input?.refresh);
  }, [inventoryCache]);
  const detailRequests = useRef(new Map<string, Promise<WorkflowRun>>());
  const loadRunDetail = useCallback(async (id: string) => {
    const bridge = window.desktop?.runtime, existing = liveRunsRef.current.find(run => run.id === id);
    if (!existing) throw new Error('运行记录不存在。');
    if (!existing.contentTruncated) return existing;
    if (!bridge?.runDetail) throw new Error('请使用支持按需详情的新版桌面应用。');
    const key = runDetailKey(existing), pending = detailRequests.current.get(key); if (pending) return pending;
    const task = bridge.runDetail(id).then(detail => {
      setLiveRuns(runs => runs.map(run => run.id === id && runDetailKey(run) === runDetailKey(detail) ? detail : run));
      return detail;
    }).finally(() => detailRequests.current.delete(key));
    detailRequests.current.set(key, task); return task;
  }, []);
  useEffect(() => {
    if (!options.runDetailProjectId) return;
    const recent = liveRuns.filter(run => run.projectId === options.runDetailProjectId).slice(0, 5).filter(run => run.contentTruncated);
    for (const run of recent) void loadRunDetail(run.id).catch(() => undefined);
  }, [liveRuns, options.runDetailProjectId, loadRunDetail]);
  const refreshTrashedArtifacts = async () => {
    const bridge = window.desktop?.runtime;
    if (!bridge?.listTrashedArtifacts) throw new Error('请使用支持回收站的新版桌面应用。');
    const requestedRevision = ++trashReadRevision.current;
    const metadata = await bridge.listTrashedArtifacts();
    if (requestedRevision === trashReadRevision.current) setTrashedArtifacts(metadata);
    return metadata;
  };
  useEffect(() => { void refreshTrashedArtifacts().catch(() => undefined); }, []);
  useEffect(() => {
    const bridge = window.desktop?.runtime;
    if (!bridge) return;
    let stopped = false, pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try { const snapshot = await (bridge.pollSnapshot ? bridge.pollSnapshot(revision.current) : bridge.snapshot()); if (!stopped) { setRuntimeStatus(value => value.available ? value : { available: true }); if (snapshot) mergeRef.current(snapshot); } }
      catch { if (!stopped) setRuntimeStatus({ available: false, reason: '真实执行后台暂不可用，请保留现有数据并检查桌面版本。' }); }
      finally { pending = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 900);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  const request = (workflow: WorkflowDefinition, projectId: string, input: string, variables: Record<string, string>, attachmentIds: string[], acknowledgeUnknownCost = false, replaceWaitingReviewRunId?: string): LiveStartRequest => {
    const current = optionsRef.current;
    const project = current.projects.find(item => item.id === projectId && item.workspaceId === current.workspaceId && !item.trashedAt && !item.purgedAt);
    if (!project || workflow.workspaceId !== current.workspaceId) throw new Error('请选择当前工作区的项目和流程。');
    return { workflow: withCreationFoundation(workflow), project, connections: current.configuration.connections, models: current.configuration.models, input, variables, attachmentIds: [...new Set([...attachmentIds, ...(project.referenceFiles || []).filter(file => ['text', 'office'].includes(file.kind)).map(file => file.id)])], acknowledgePaidCalls: true, acknowledgeUnknownCost, ...(replaceWaitingReviewRunId ? { replaceWaitingReviewRunId } : {}) };
  };
  async function prepareStart(input: LiveStartRequest): Promise<LiveStartRequest> {
    const bridge = window.desktop?.runtime;
    return prepareLiveStartSource(input, async id => { const old = bridge?.runDetail ? await bridge.runDetail(id) : liveRunsRef.current.find(run => run.id === id); if (!old) throw new Error('上一轮任务暂不能可靠读取，原记录与费用保留。'); return old; }, listProjectArtifacts);
  }
  const liveControl = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'continue', stepId?: string, stepBudgetCents?: number | null) => {
    const bridge = window.desktop?.runtime;
    const current = optionsRef.current;
    const run = liveRunsRef.current.find(item => item.id === id && current.projects.some(project => project.id === item.projectId && project.workspaceId === current.workspaceId && !project.trashedAt && !project.purgedAt));
    if (!bridge || !run) return;
    if (['resume', 'retry', 'continue'].includes(action) && current.isOtherTaskRunning(run.projectId)) { current.notify('项目正在处理其他任务，请等待操作完成。', 'info'); return; }
    const project = current.projects.find(item => item.id === run.projectId);
    try { await bridge.control({ id, action, stepId, stepBudgetCents, project, connections: current.configuration.connections, models: current.configuration.models }); const snapshot = await (bridge.pollSnapshot ? bridge.pollSnapshot(-1) : bridge.snapshot()); if (snapshot) mergeRef.current(snapshot); }
    catch (error) {
      try { const snapshot = await (bridge.pollSnapshot ? bridge.pollSnapshot(-1) : bridge.snapshot()); if (snapshot && alive.current) mergeRef.current(snapshot); } catch { /* The original action error remains available even when refresh is unavailable. */ }
      current.notify(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，请检查运行记录。', 'error');
    }
  };
  const workspaceProjectIds = new Set(options.projects.filter(project => project.workspaceId === options.workspaceId && !project.purgedAt).map(project => project.id));
  const visibleRuns = useMemo(() => {
    const ids = new Set(options.projects.filter(project => project.workspaceId === options.workspaceId && !project.trashedAt && !project.purgedAt).map(project => project.id));
    return overlayArtifactMetadata([...liveRuns, ...simulation.runs].filter(run => ids.has(run.projectId)), trashedArtifacts, updatedArtifacts);
  }, [liveRuns, simulation.runs, options.projects, options.workspaceId, trashedArtifacts, updatedArtifacts]);
  return {
    ...simulation,
    runtimeStatus,
    inventoryRevision,
    loadRunDetail,
    trashedArtifacts: trashedArtifacts?.filter(artifact => Boolean(artifact.projectId && workspaceProjectIds.has(artifact.projectId))),
    runs: visibleRuns,
    start(workflow, projectId, input, variables) {
      if (liveRunsRef.current.some(run => run.projectId === projectId && activeRun(run))) { options.notify('项目已有真实运行任务，请先完成或取消。', 'info'); return false; }
      return simulation.start(workflow, projectId, input, variables);
    },
    async preflight(workflow, projectId, input, variables, attachmentIds) {
      const bridge = window.desktop?.runtime;
      if (!bridge) return { ok: false, errors: [unavailable.reason], warnings: [], steps: [], unknownCost: true };
      return bridge.preflight(request(workflow, projectId, input, variables, attachmentIds));
    },
    async startLive(workflow, projectId, input, variables, attachmentIds, acknowledgeUnknownCost, replaceWaitingReviewRunId) {
      const current = optionsRef.current, scope = current.workspaceId;
      if (!window.desktop?.runtime || !runtimeStatus.available) return { status: 'rejected', code: 'RUNTIME_UNAVAILABLE', error: unavailable.reason };
      if (current.isOtherTaskRunning(projectId) || simulation.runs.some(run => run.projectId === projectId && activeRun(run))) return { status: 'rejected', code: 'PROJECT_BUSY', error: '项目已有运行任务，请先完成或取消。' };
      try {
        const result = await starts.start(request(workflow, projectId, input, variables, attachmentIds, acknowledgeUnknownCost, replaceWaitingReviewRunId), prepareStart, () => alive.current && optionsRef.current.workspaceId === scope && optionsRef.current.projects.some(project => project.id === projectId && !project.trashedAt && !project.purgedAt));
        if (result.status === 'started' && alive.current && optionsRef.current.workspaceId === scope) current.notify(result.recovered ? '已读取原任务，没有重复生成；结果与费用保留。' : '已开始真实工作流，可以切换页面，结果和用量会保存。');
        return result;
      } catch (error) { return { status: 'rejected', code: 'START_INPUT', error: error instanceof Error ? error.message : '真实流程未能开始。' }; }
    },
    readStartResult: projectId => starts.read(projectId),
    pause(id) { if (liveRunsRef.current.some(run => run.id === id)) void liveControl(id, 'pause'); else simulation.pause(id); },
    resume(id, stepBudgetCents) { const run = liveRunsRef.current.find(item => item.id === id); if (run) void liveControl(id, ['failed', 'interrupted'].includes(run.status) ? 'continue' : 'resume', undefined, stepBudgetCents); else simulation.resume(id, stepBudgetCents); },
    cancel(id) { if (liveRunsRef.current.some(run => run.id === id)) void liveControl(id, 'cancel'); else simulation.cancel(id); },
    retry(id, stepId) { if (liveRunsRef.current.some(run => run.id === id)) void liveControl(id, 'retry', stepId); else simulation.retry(id, stepId); },
    async importFiles(projectId) { return window.desktop?.runtime ? window.desktop.runtime.importFiles(projectId) : []; },
    listProjectArtifacts: window.desktop?.runtime?.listProjectArtifacts ? listProjectArtifacts : undefined,
    async manageRun(id, action) {
      const run = liveRunsRef.current.find(item => item.id === id);
      if (!run) { if (!simulation.manageRun) throw new Error('当前版本不支持任务整理。'); return simulation.manageRun(id, action); }
      if (!optionsRef.current.projects.some(project => project.id === run.projectId && project.workspaceId === optionsRef.current.workspaceId && !project.trashedAt && !project.purgedAt)) throw new Error('任务不属于当前工作区。');
      const bridge = window.desktop?.runtime;
      if (!bridge?.manageRun) throw new Error('请使用支持任务整理的新版桌面应用。');
      await bridge.manageRun({ id, action }); const snapshot = await (bridge.pollSnapshot ? bridge.pollSnapshot(-1) : bridge.snapshot()); if (snapshot) mergeRef.current(snapshot);
    },
    async previewArtifact(id) {
      const bridge = window.desktop?.runtime;
      if (!bridge) throw new Error('请在桌面版预览真实产物。');
      const metadata = updatedArtifacts[id] || trashedArtifacts?.find(item => item.id === id);
      if (metadata?.projectId && optionsRef.current.projects.some(project => project.id === metadata.projectId && project.purgedAt)) throw new Error('项目已永久移除，不能再预览其产物。');
      return previewCache.preview(optionsRef.current.workspaceId, id, () => bridge.previewArtifact(id), metadata);
    },
    ...(typeof window !== 'undefined' && typeof window.desktop?.runtime?.inspectImageArtifact === 'function' ? {
      async inspectImageArtifact(id: string) {
        const bridge = window.desktop?.runtime;
        if (!bridge?.inspectImageArtifact) throw new Error('当前桌面后台不支持参考图片检查。');
        const metadata = updatedArtifacts[id] || trashedArtifacts?.find(item => item.id === id);
        if (metadata?.projectId && optionsRef.current.projects.some(project => project.id === metadata.projectId && project.purgedAt)) throw new Error('项目已永久移除，不能再预览其产物。');
        return bridge.inspectImageArtifact(id);
      },
    } : {}),
    ...(typeof window !== 'undefined' && typeof window.desktop?.runtime?.prepareGeneratedAnimationReference === 'function' ? {
      async prepareGeneratedAnimationReference(input: import('../live-types').GeneratedAnimationReferenceInput) {
        const bridge = window.desktop?.runtime;
        if (!bridge?.prepareGeneratedAnimationReference) throw new Error('当前桌面后台不支持继续修改动画。');
        if (optionsRef.current.projects.some(project => project.id === input.projectId && project.purgedAt)) throw new Error('项目已永久移除，不能再修改其动画。');
        const result = await bridge.prepareGeneratedAnimationReference(input);
        if (result.reference) inventoryCache.invalidate(input.projectId);
        return result;
      },
    } : {}),
    ...(typeof window !== 'undefined' && typeof window.desktop?.runtime?.prepareSvgReference === 'function' ? {
      async prepareSvgReference(input: import('../live-types').SvgReferenceInput) {
        const bridge = window.desktop?.runtime;
        if (!bridge?.prepareSvgReference) throw new Error('当前桌面后台不支持 SVG 参考转换。');
        if (optionsRef.current.projects.some(project => project.id === input.projectId && project.purgedAt)) throw new Error('项目已永久移除，不能再准备其 SVG 参考。');
        const result = await bridge.prepareSvgReference(input);
        if (result.reference) inventoryCache.invalidate(input.projectId);
        return result;
      },
    } : {}),
    ...(typeof window !== 'undefined' && typeof window.desktop?.runtime?.exportWallpaper4K === 'function' ? {
      async exportWallpaper4K(input: import('../live-types').Wallpaper4KExportInput) {
        const bridge = window.desktop?.runtime;
        if (!bridge?.exportWallpaper4K) throw Error('当前桌面后台不支持本地4K导出。');
        if (optionsRef.current.projects.some(project => project.id === input.projectId && project.purgedAt)) throw Error('项目已永久移除，不能导出其壁纸。');
        const result = await bridge.exportWallpaper4K(input); inventoryCache.invalidate(input.projectId); return result;
      },
    } : {}),
    async thumbnailArtifact(id) {
      const bridge = window.desktop?.runtime; if (!bridge) throw new Error('请在桌面版预览真实产物。');
      const metadata = updatedArtifacts[id] || trashedArtifacts?.find(item => item.id === id);
      if (metadata?.projectId && optionsRef.current.projects.some(project => project.id === metadata.projectId && project.purgedAt)) throw new Error('项目已永久移除，不能再预览其产物。');
      if (!bridge.thumbnailArtifact) return previewCache.preview(optionsRef.current.workspaceId, id, () => bridge.previewArtifact(id), metadata);
      return thumbnailCache.preview(optionsRef.current.workspaceId, id, () => bridge.thumbnailArtifact!(id), metadata);
    },
    async openArtifact(id) { if (!window.desktop?.runtime) throw new Error('请在桌面版打开真实文件。'); await window.desktop.runtime.openArtifact(id); },
    async saveArtifact(id) { if (!window.desktop?.runtime) return { saved: false }; return window.desktop.runtime.saveArtifact(id); },
    async trashArtifact(id) {
      const bridge = window.desktop?.runtime;
      if (!bridge?.trashArtifact) throw new Error('请在新版桌面应用中移入产物回收站。');
      previewCache.invalidate(id);
      thumbnailCache.invalidate(id);
      trashReadRevision.current++;
      const metadata = await bridge.trashArtifact(id);
      if (metadata.projectId) inventoryCache.invalidate(metadata.projectId);
      previewCache.invalidate(id);
      thumbnailCache.invalidate(id);
      setUpdatedArtifacts(current => ({ ...current, [id]: metadata }));
      setTrashedArtifacts(current => [metadata, ...(current || []).filter(artifact => artifact.id !== id)]);
      await refreshTrashedArtifacts();
    },
    async restoreArtifact(id) {
      const bridge = window.desktop?.runtime;
      if (!bridge?.restoreArtifact) throw new Error('请在新版桌面应用中恢复产物。');
      previewCache.invalidate(id);
      trashReadRevision.current++;
      const metadata = await bridge.restoreArtifact(id);
      thumbnailCache.invalidate(id); if (metadata.projectId) inventoryCache.invalidate(metadata.projectId);
      previewCache.invalidate(id);
      setUpdatedArtifacts(current => ({ ...current, [id]: { ...metadata, trashedAt: undefined } }));
      setTrashedArtifacts(current => current?.filter(artifact => artifact.id !== id));
      await refreshTrashedArtifacts();
    },
    listTrashedArtifacts: refreshTrashedArtifacts,
    async reconcileCost(entryId, costCents) { if (!window.desktop?.runtime) return; await window.desktop.runtime.reconcile({ entryId, costCents }); const bridge = window.desktop.runtime; const snapshot = await (bridge.pollSnapshot ? bridge.pollSnapshot(-1) : bridge.snapshot()); if (snapshot) mergeRef.current(snapshot); },
  };
}
