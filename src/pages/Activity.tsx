import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, CirclePause, FolderOpen, ListTodo, Plus, Search, SlidersHorizontal, Workflow, X } from 'lucide-react';
import { BatchProductionPanel } from '../components/BatchProductionPanel';
import { BulkOrganizeDialog } from '../components/BulkOrganizeDialog';
import { DispatchTaskDetail, DispatchTaskRow } from '../components/DispatchTaskRow';
import { ModalPortal } from '../components/ModalPortal';
import { Select } from '../components/Select';
import { TaskRunList } from '../components/TaskRunList';
import { TaskScopeFilter } from '../components/TaskScopeFilter';
import { WorkflowRunCard } from '../components/WorkflowRunCard';
import { useAutomationCenter } from '../hooks/useAutomationCenter';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { organizeTaskBatch, taskCanOrganizeAs, type TaskOrganizeAction } from '../lib/bulk-task-management';
import { costSummaryPrimary, costSummarySecondary, runCostRecords, summarizeCosts } from '../lib/cost-display';
import { buildDispatchTasks, filterDispatchTasks, resolveDispatchRun, type DispatchTask } from '../lib/dispatch-tasks';
import { registerEditorSession } from '../lib/editor-session-guard';
import { filterTaskRuns, taskGroup, taskNextAction, taskStatusLabel, type TaskGroup } from '../lib/task-center';
import { canOrganizeRun, scopedTaskRuns, type TaskScope } from '../lib/task-visibility';
import { isLocalExportRun } from '../lib/workflow-purpose';
import { workflowReviewState } from '../lib/workflow-review';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps } from '../types';
import './resource-runtime-workspaces.css';
import './operations.css';
import './activity.css';
import '../components/studio-run.css';

type TaskSelection = { kind: 'run' | 'dispatch'; id: string; following?: boolean };
type ActivityItem = { kind: 'run'; id: string; run: WorkflowRun; group: TaskGroup; updatedAt: string }
  | { kind: 'dispatch'; id: string; task: DispatchTask; group: TaskGroup; updatedAt: string };
type GroupFilter = TaskGroup | 'all';
const groupOrder: Record<TaskGroup, number> = { attention: 0, running: 1, finished: 2 };
const groups = [{ value: 'running', label: '执行中' }, { value: 'attention', label: '需要处理' }, { value: 'finished', label: '已结束' }, { value: 'all', label: '全部任务' }] as const;

function RunOverview({ run, props, showIssue = false }: { run: WorkflowRun; props: PageProps; showIssue?: boolean }) {
  const project = props.projects.find(item => item.id === run.projectId);
  const review = workflowReviewState(run);
  const steps = run.snapshot.steps.filter(step => step.enabled);
  const complete = steps.filter(step => run.attempts.filter(attempt => attempt.stepId === step.id).at(-1)?.status === 'complete').length;
  const step = run.snapshot.steps[run.stepIndex];
  const currentStep = step?.enabled && taskGroup(run) !== 'finished' ? step.name : undefined;
  const planning = run.purpose === 'automation-plan';
  const status = review === 'quality-failed' ? '独立检查未通过' : review === 'blocked' ? '检查需要处理'
    : review === 'manual' ? '等待人工检查' : planning && run.status === 'complete' ? '方案已准备好' : taskStatusLabel(run);
  const problem = run.error || (run.referenceIssue ? '参考资料需要处理' : '');
  const cost = summarizeCosts(runCostRecords(run, props.ledger));
  return <>
    <div className="activity-task-name">
      <div className="activity-task-title">
        <strong>{run.workflowName}</strong>
        <span className={`activity-status ${review === 'quality-failed' ? 'failed' : run.status}`}>{status}</span>
      </div>
      <small>{project?.name || '项目已移出当前列表'}</small>
      {(steps.length > 0 || currentStep || run.pauseRequested) && <div className="activity-task-progress">
        {steps.length > 0 && <><progress aria-label="任务步骤进度" value={complete} max={steps.length} /><span>{complete} / {steps.length} 步已完成</span></>}
        {run.pauseRequested ? <span>当前请求结束后暂停</span> : currentStep && <span>{currentStep}</span>}
      </div>}
      {showIssue && problem && <p className="activity-task-problem" title={problem}>{problem}</p>}
    </div>
    <div className="activity-task-cost">
      <span>{planning ? 'AI 规划' : isLocalExportRun(run) ? '本地导出' : run.mode === 'live' ? '实际花费' : '模拟费用'}</span>
      <strong title={costSummarySecondary(cost)}>{costSummaryPrimary(cost)}</strong>
    </div>
  </>;
}

function TaskRow({ run, props, bulkMode, selected, locked, onSelect, onOpen, followed }: {
  run: WorkflowRun; props: PageProps; bulkMode: boolean; selected: boolean; locked: boolean;
  onSelect: (selected: boolean) => void; onOpen: () => void; followed: boolean;
}) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!followed) return;
    const frame = requestAnimationFrame(() => row.current?.scrollIntoView?.({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [followed]);
  const project = props.projects.find(item => item.id === run.projectId);
  const review = workflowReviewState(run);
  const archived = Boolean(run.hiddenAt || run.trashedAt);
  const canOpenProject = !archived && project && !run.referenceIssue && (run.status === 'complete' || review === 'manual') && taskNextAction(run) === 'project';
  const detailLabel = archived ? '查看与恢复' : review === 'quality-failed' ? '查看质检原因' : run.status === 'running' || canOpenProject ? '详情'
    : review === 'manual' ? '查看检查步骤' : taskGroup(run) === 'attention' ? '查看与处理' : '查看结果与步骤';
  return <article ref={row} data-task-id={run.id} className={`panel activity-task${selected ? ' bulk-selected-task' : ''}`}>
    {bulkMode && <label className="bulk-selection-label bulk-task-check">
      <input type="checkbox" aria-label={`选择任务 ${run.id}`} checked={selected} disabled={locked || !canOrganizeRun(run)} onChange={event => onSelect(event.target.checked)} />
      {canOrganizeRun(run) ? '选择任务' : '当前任务暂不能整理'}
    </label>}
    <div className="activity-task-summary">
      <RunOverview run={run} props={props} showIssue />
      <div className="activity-task-controls">
        {!archived && run.status === 'running' && <button type="button" className="btn btn-ghost" disabled={run.pauseRequested} onClick={() => props.workflowRunner.pause(run.id)}>
          <CirclePause size={15} />{run.pauseRequested ? '正在暂停…' : '暂停'}
        </button>}
        {canOpenProject && <button type="button" className="btn btn-primary" onClick={() => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)}>
          {review === 'manual' ? '检查并交付' : '查看成品'}<ArrowRight size={14} />
        </button>}
        <button type="button" className="btn btn-secondary" aria-haspopup="dialog" aria-label={`查看任务详情 ${run.id}`} onClick={onOpen}>{detailLabel}</button>
      </div>
    </div>
  </article>;
}

export function Activity(props: PageProps) {
  const { projects, activeProject, workflowRunner, workspaceId, navigate, onCreateProject } = props;
  const automation = useAutomationCenter(workspaceId);
  const [showBatch, setShowBatch] = useRememberedBoolean(`workspace:${workspaceId}:activity-batch`, false);
  const [advanced, setAdvanced] = useState(false);
  const [taskScope, setTaskScope] = useState<TaskScope>('visible');
  const [projectId, setProjectId] = useState('all');
  const [group, setGroup] = useState<GroupFilter>();
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<TaskSelection>();
  const [dispatchDetailsFor, setDispatchDetailsFor] = useState('');
  const consumedDispatch = useRef('');
  const [emptyProjectId, setEmptyProjectId] = useState(activeProject.id);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkJob, setBulkJob] = useState<{ action: TaskOrganizeAction; items: { id: string; name: string }[] }>();
  const bulkPending = useRef(false), scope = useRef(workspaceId), runner = useRef(workflowRunner);
  scope.current = workspaceId; runner.current = workflowRunner;

  const runs = useMemo(() => workflowRunner.runs.filter(run => run.workspaceId === workspaceId), [workflowRunner.runs, workspaceId]);
  const activeProjects = useMemo(() => projects.filter(project => project.workspaceId === workspaceId && !project.trashedAt && !project.purgedAt), [projects, workspaceId]);
  const dispatchTasks = useMemo(() => buildDispatchTasks(automation.snapshot, runs, activeProjects, workspaceId), [automation.snapshot, runs, activeProjects, workspaceId]);
  const scopedRuns = scopedTaskRuns(runs, taskScope);
  const scopedDispatchTasks = taskScope === 'visible' ? dispatchTasks : [];
  const counts = { all: scopedRuns.length + scopedDispatchTasks.length, running: 0, attention: 0, finished: 0 };
  for (const run of scopedRuns) counts[taskGroup(run)]++;
  for (const task of scopedDispatchTasks) counts[task.group]++;

  const openedJob = opened?.kind === 'dispatch' ? automation.snapshot.jobs.find(job => job.id === opened.id && job.workspaceId === workspaceId) : undefined;
  const drawerRun = opened?.kind === 'run' ? runs.find(run => run.id === opened.id)
    : openedJob ? resolveDispatchRun(openedJob, runs, automation.snapshot.decisions) : undefined;
  const drawerTask = !drawerRun && opened?.kind === 'dispatch' ? dispatchTasks.find(task => task.id === opened.id) : undefined;
  const linkedJob = drawerRun && (openedJob || automation.snapshot.jobs.find(job => resolveDispatchRun(job, [drawerRun], automation.snapshot.decisions) === drawerRun));
  const linkedTask = drawerRun && linkedJob && dispatchDetailsFor === drawerRun.id
    ? buildDispatchTasks({ ...automation.snapshot, jobs: [{ ...linkedJob, runId: drawerRun.id }] }, [], activeProjects, workspaceId)[0] : undefined;
  const canFollowRun = drawerRun && !drawerRun.hiddenAt && !drawerRun.trashedAt && activeProjects.some(project => project.id === drawerRun.projectId);
  const followedRun = opened?.following && canFollowRun ? drawerRun : undefined;
  const followedTask = opened?.following ? drawerTask : undefined;
  const followId = followedRun ? `run:${followedRun.id}` : followedTask ? `dispatch:${followedTask.id}` : undefined;
  const automaticGroup = counts.running ? 'running' : counts.attention ? 'attention' : 'all';
  const activeGroup = followedRun ? taskGroup(followedRun) : followedTask?.group ?? group ?? automaticGroup;
  function stopFollowing() {
    setGroup(activeGroup);
    if (opened?.following) setOpened({ ...opened, following: false });
  }
  function closeDrawer() { stopFollowing(); setOpened(undefined); setDispatchDetailsFor(''); }

  useEffect(() => registerEditorSession({ id: `task-bulk-${workspaceId}`, projectId: '', label: '正在批量整理任务记录', getState: () => ({ dirty: false, pending: bulkPending.current }), save: async () => false, exportRecovery: () => false }), [workspaceId]);
  useEffect(() => {
    setAdvanced(false); setTaskScope('visible'); setProjectId('all'); setGroup(undefined); setQuery(''); setOpened(undefined); setDispatchDetailsFor('');
    setBulkMode(false); setSelectedIds(new Set()); setBulkJob(undefined); setBulkMessage(''); bulkPending.current = false; setBulkBusy(false);
  }, [workspaceId]);
  useEffect(() => { setSelectedIds(new Set()); setBulkJob(undefined); setBulkMessage(''); }, [taskScope, projectId, activeGroup, query]);
  useEffect(() => { scope.current = workspaceId; return () => { scope.current = ''; }; }, [workspaceId]);
  useEffect(() => { setEmptyProjectId(activeProject.id); }, [activeProject.id]);
  useEffect(() => {
    const target = props.taskIntent;
    if (!target) return;
    const run = runs.find(item => item.id === target.runId && item.projectId === target.projectId && !item.hiddenAt && !item.trashedAt);
    if (target.workspaceId === workspaceId && run && activeProjects.some(project => project.id === target.projectId)) {
      setProjectId(target.projectId); setGroup(taskGroup(run)); setTaskScope('visible'); setQuery('');
      setOpened({ kind: 'run', id: run.id, following: true }); setDispatchDetailsFor('');
    } else if (target.workspaceId === workspaceId) props.notify('此任务已移出当前列表，请检查项目或任务回收站。', 'info');
    props.onTaskIntentConsumed?.(target.token);
  }, [props.taskIntent?.token, workspaceId]);
  useEffect(() => {
    const target = props.dispatchTaskIntent;
    if (!target || target.token === consumedDispatch.current) return;
    if (target.workspaceId === workspaceId) {
      if (target.jobId && automation.bridge && (automation.loading || automation.snapshot.revision < 0 && !automation.snapshot.issue)) return;
      const job = automation.snapshot.jobs.find(item => item.id === target.jobId && item.workspaceId === workspaceId &&
        (!target.projectId || item.projectId === target.projectId) && activeProjects.some(project => project.id === item.projectId));
      const linkedRun = job ? resolveDispatchRun(job, runs, automation.snapshot.decisions) : undefined;
      const pendingTask = job ? dispatchTasks.find(item => item.id === job.id) : undefined;
      if (job && (pendingTask || linkedRun && !linkedRun.hiddenAt && !linkedRun.trashedAt)) {
        setProjectId(job.projectId); setGroup(linkedRun ? taskGroup(linkedRun) : pendingTask?.group); setTaskScope('visible'); setQuery('');
        setOpened({ kind: 'dispatch', id: job.id, following: true }); setDispatchDetailsFor('');
      } else if (!target.jobId && target.group) {
        setGroup(target.group); setTaskScope('visible'); setProjectId('all'); setQuery(''); setOpened(undefined);
      } else if (target.jobId) props.notify('当前工作区没有这条可显示的调度任务。', 'info');
    }
    consumedDispatch.current = target.token;
    props.onDispatchTaskIntentConsumed?.(target.token);
  }, [props.dispatchTaskIntent?.token, workspaceId, automation.loading, automation.snapshot, dispatchTasks, runs, activeProjects]);

  const selectedProject = activeProjects.find(project => project.id === emptyProjectId) || activeProjects[0];
  const filter = { scope: taskScope, group: activeGroup, projectId, query };
  const nativeItems = filterTaskRuns(runs, activeProjects, filter);
  const filtered: ActivityItem[] = [
    ...nativeItems.map(run => ({ kind: 'run' as const, id: `run:${run.id}`, run, group: taskGroup(run), updatedAt: run.updatedAt })),
    ...filterDispatchTasks(dispatchTasks, filter).map(task => ({ kind: 'dispatch' as const, id: `dispatch:${task.id}`, task, group: task.group, updatedAt: task.updatedAt })),
  ];
  filtered.sort((left, right) => groupOrder[left.group] - groupOrder[right.group] || (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0));
  const selectedRuns = nativeItems.filter(run => selectedIds.has(run.id));
  const selectable = nativeItems.filter(canOrganizeRun).slice(0, 100);
  function selectRun(id: string, checked: boolean) {
    setSelectedIds(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  }
  function requestBulk(action: TaskOrganizeAction) {
    const selected = selectedRuns.filter(run => taskCanOrganizeAs(run, action));
    if (selected.length) setBulkJob({ action, items: selected.map(run => ({ id: run.id, name: run.workflowName })) });
  }
  async function confirmBulk() {
    if (!bulkJob || !runner.current.manageRun || bulkPending.current) return;
    const job = bulkJob;
    bulkPending.current = true; setBulkBusy(true); setBulkMessage('');
    try {
      const result = await organizeTaskBatch({ ids: job.items.map(item => item.id), action: job.action, workspaceId, getRuns: () => runner.current.runs, projectIds: new Set(activeProjects.map(project => project.id)), manage: (id, action) => runner.current.manageRun!(id, action), stillCurrent: () => scope.current === workspaceId });
      if (scope.current !== workspaceId) return;
      const message = `已${job.action === 'hide' ? '隐藏' : job.action === 'trash' ? '移入回收站' : '恢复'} ${result.done} 个任务${result.skipped ? `，跳过或未完成 ${result.skipped} 个` : ''}。`;
      setSelectedIds(new Set(result.failedIds)); setBulkJob(undefined); setBulkMessage(message); props.notify(message, result.skipped ? 'info' : 'success');
    } catch (cause) {
      if (scope.current === workspaceId) { setBulkJob(undefined); setBulkMessage(cause instanceof Error ? cause.message : '批量整理尚未全部确认，已完成记录保留。请核对后重试。'); }
    } finally {
      if (scope.current === workspaceId) { bulkPending.current = false; setBulkBusy(false); }
    }
  }
  function changeScope(value: TaskScope) {
    stopFollowing(); setTaskScope(value);
    if (value !== 'visible') setGroup('all');
  }
  const advancedSelection = [projectId !== 'all' && activeProjects.find(project => project.id === projectId)?.name, taskScope === 'hidden' ? '已隐藏' : taskScope === 'trash' ? '回收站' : ''].filter(Boolean).join(' · ');
  return <div className="op-page activity-page">
    <div className="page-heading"><h1 className="page-title">任务中心</h1></div>
    {automation.snapshot.issue && <div className="activity-dispatch-issue" role="status">
      <span>{automation.snapshot.issue}</span><button type="button" className="btn btn-secondary" disabled={automation.loading} onClick={() => { void automation.refresh(); }}>刷新调度记录</button>
    </div>}
    <div className="activity-status-grid" role="group" aria-label="按任务状态筛选">
      {groups.map(({ value, label }) => <button type="button" key={value} className={activeGroup === value ? 'active' : ''} aria-pressed={activeGroup === value} onClick={() => { stopFollowing(); setGroup(value); }}>
        <span>{label}</span><strong>{counts[value]}</strong>
      </button>)}
    </div>
    <section className="activity-list-section">
      <div className="activity-toolbar">
        <label className="activity-search"><Search size={16} /><input aria-label="搜索任务" placeholder="搜索任务、项目或原因" value={query} onChange={event => { stopFollowing(); setQuery(event.target.value); }} /></label>
        <button type="button" className="btn btn-secondary" aria-expanded={advanced} aria-controls="activity-advanced" onClick={() => setAdvanced(value => !value)}>
          <SlidersHorizontal size={15} />筛选与管理{advancedSelection && <small>{advancedSelection}</small>}<ChevronDown size={13} />
        </button>
      </div>
      {advanced && <div className="activity-advanced panel" id="activity-advanced">
        <Select aria-label="筛选任务项目" value={projectId} onValueChange={value => { stopFollowing(); setProjectId(value); }} options={[{ value: 'all', label: '所有项目' }, ...activeProjects.map(project => ({ value: project.id, label: project.name }))]} />
        <TaskScopeFilter runs={runs} value={taskScope} onChange={changeScope} />
        <div className="activity-heading-actions">
          <button type="button" className="btn btn-ghost" aria-pressed={bulkMode} disabled={bulkBusy} onClick={() => {
            setBulkMode(value => !value); setSelectedIds(new Set());
            if (!bulkMode && taskScope === 'visible' && activeGroup !== 'all' && activeGroup !== 'finished') { stopFollowing(); setGroup('finished'); }
          }}>{bulkMode ? '退出批量整理' : '批量整理任务'}</button>
          <button type="button" className="btn btn-ghost" aria-expanded={showBatch} onClick={() => setShowBatch(value => !value)}>批量生产<ChevronDown size={14} /></button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('workflows')}>管理工作流</button>
        </div>
      </div>}
      {showBatch && advanced && <BatchProductionPanel workspaceId={workspaceId} workflows={props.configuration.workflows} projects={activeProjects} configuration={props.configuration} ledger={props.ledger} notify={props.notify} onProjectsCreated={props.onBatchProjectsCreated} onOpenProject={project => navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} />}
      {bulkMode && <div className="bulk-organize-toolbar">
        <strong>已选 {selectedRuns.length} 个任务</strong>
        <button type="button" className="btn btn-ghost" disabled={bulkBusy || !selectable.length} onClick={() => setSelectedIds(new Set(selectable.map(run => run.id)))}>{selectable.length === 100 ? '选择前100个可整理任务' : '选择全部可整理任务'}</button>
        <button type="button" className="btn btn-ghost" disabled={bulkBusy || !selectedRuns.length} onClick={() => setSelectedIds(new Set())}>清除任务选择</button>
        {taskScope === 'visible' ? <button type="button" className="btn btn-secondary" disabled={bulkBusy || !workflowRunner.manageRun || !selectedRuns.some(run => taskCanOrganizeAs(run, 'hide'))} onClick={() => requestBulk('hide')}>批量隐藏任务</button>
          : <button type="button" className="btn btn-secondary" disabled={bulkBusy || !workflowRunner.manageRun || !selectedRuns.some(run => taskCanOrganizeAs(run, 'restore'))} onClick={() => requestBulk('restore')}>批量恢复任务</button>}
        {taskScope !== 'trash' && <button type="button" className="btn btn-secondary" disabled={bulkBusy || !workflowRunner.manageRun || !selectedRuns.some(run => taskCanOrganizeAs(run, 'trash'))} onClick={() => requestBulk('trash')}>批量移入任务回收站</button>}
      </div>}
      {bulkMessage && <p className="bulk-organize-result" role="status">{bulkMessage}</p>}
      {filtered.length > 0 ? <TaskRunList key={`${workspaceId}-${taskScope}-${activeGroup}-${projectId}-${query}`} runs={filtered} initialRunId={followId} followRunId={followId} onPageChange={stopFollowing}
        renderRun={item => item.kind === 'run'
          ? <TaskRow props={props} run={item.run} followed={followId === item.id} onOpen={() => setOpened({ kind: 'run', id: item.run.id })} bulkMode={bulkMode} selected={selectedIds.has(item.run.id)} locked={bulkBusy} onSelect={checked => selectRun(item.run.id, checked)} />
          : <DispatchTaskRow task={item.task} disabled={bulkMode} onOpen={() => setOpened({ kind: 'dispatch', id: item.task.id })} />} />
        : runs.length === 0 && dispatchTasks.length === 0 && activeGroup === 'all' && !query && taskScope === 'visible'
          ? <section className="panel activity-empty" aria-label="任务记录为空">
            <span className="activity-empty-icon"><ListTodo size={25} /></span><h2>还没有执行记录</h2>
            <p>打开项目或工作流准备制作。以下入口不会开始模型调用。</p>
            {selectedProject && <Select aria-label="任务空态关联项目" value={selectedProject.id} onValueChange={setEmptyProjectId} options={activeProjects.map(project => ({ value: project.id, label: project.name }))} />}
            <div className="activity-empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => onCreateProject()}><Plus size={16} />新建项目</button>
              {selectedProject && <button type="button" className="btn btn-secondary" onClick={() => navigate(selectedProject.kind === 'image' ? 'images' : 'documents', selectedProject.id)}><FolderOpen size={16} />打开所选项目</button>}
              <button type="button" className="btn btn-secondary" onClick={() => navigate('workflows')}><Workflow size={16} />查看工作流</button>
            </div>
          </section> : <div className="panel activity-filter-empty">
            <h3>{query || projectId !== 'all' ? '没有匹配的任务' : taskScope === 'hidden' ? '没有已隐藏任务' : taskScope === 'trash' ? '任务回收站为空'
              : activeGroup === 'running' ? '当前没有执行中的任务' : activeGroup === 'attention' ? '没有需要处理的任务' : '当前没有显示的任务'}</h3>
            <button type="button" className="btn btn-secondary" onClick={() => { stopFollowing(); setQuery(''); setGroup('all'); setProjectId('all'); setTaskScope('visible'); }}>查看全部当前任务</button>
          </div>}
    </section>
    {(drawerRun || drawerTask) && <ModalPortal onClose={closeDrawer} variant="drawer">
      <div className="activity-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDrawer(); }}>
        <section className="activity-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
          <header><h2>{drawerTask?.title || '任务详情'}</h2><button type="button" className="btn-icon" aria-label="关闭任务详情" data-dialog-initial-focus onClick={closeDrawer}><X size={20} /></button></header>
          <div className="activity-drawer-body">
            {drawerRun ? <><div className="activity-drawer-overview" aria-live="polite"><RunOverview run={drawerRun} props={props} /></div>
              <WorkflowRunCard key={drawerRun.id} props={props} run={drawerRun} embedded />
              {linkedJob && <section className="activity-drawer-dispatch">
                <button type="button" className="btn btn-ghost" aria-expanded={dispatchDetailsFor === drawerRun.id} onClick={() => setDispatchDetailsFor(current => current === drawerRun.id ? '' : drawerRun.id)}>调度记录<ChevronDown size={14} /></button>
                {linkedTask && <DispatchTaskDetail task={linkedTask} bridge={automation.bridge} refresh={automation.refresh} disabled={!automation.snapshot.available} />}
              </section>}
            </>
              : drawerTask && <DispatchTaskDetail task={drawerTask} bridge={automation.bridge} refresh={automation.refresh}
                disabled={!automation.snapshot.available || !activeProjects.some(project => project.id === drawerTask.job.projectId)} />}
          </div>
        </section>
      </div>
    </ModalPortal>}
    {bulkJob && <BulkOrganizeDialog title={bulkJob.action === 'hide' ? '批量隐藏任务' : bulkJob.action === 'trash' ? '批量移入任务回收站' : '批量恢复任务'} noun="任务" items={bulkJob.items} busy={bulkBusy} onClose={() => { if (!bulkPending.current) setBulkJob(undefined); }} onConfirm={() => { void confirmBulk(); }} />}
  </div>;
}
