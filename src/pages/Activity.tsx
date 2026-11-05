import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { BatchProductionPanel } from '../components/BatchProductionPanel';
import { TaskRunList } from '../components/TaskRunList';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Clock3, FolderOpen, ListTodo, LoaderCircle, Plus, Search, Workflow } from 'lucide-react';
import { TaskScopeFilter } from '../components/TaskScopeFilter';
import { Select } from '../components/Select';
import { scopedTaskRuns } from '../lib/task-visibility';
import type { TaskScope } from '../lib/task-visibility';
import { filterTaskRuns, taskGroup, taskNextAction, taskStatusLabel } from '../lib/task-center';
import type { TaskGroup } from '../lib/task-center';
import { CostTotal } from '../components/CostAmount';
import { runCostRecords, summarizeCosts } from '../lib/cost-display';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps } from '../types';
import { WorkflowRunCard } from '../components/WorkflowRunCard';
import './resource-runtime-workspaces.css';
import { BulkOrganizeDialog } from '../components/BulkOrganizeDialog';
import { organizeTaskBatch, taskCanOrganizeAs } from '../lib/bulk-task-management';
import type { TaskOrganizeAction } from '../lib/bulk-task-management';
import { canOrganizeRun } from '../lib/task-visibility';
import { registerEditorSession } from '../lib/editor-session-guard';
import './operations.css';
import './activity.css';
import '../components/studio-run.css';

function TaskRow({ run, props, bulkMode, selected, locked, onSelect }: { run: WorkflowRun; props: PageProps; bulkMode?: boolean; selected?: boolean; locked?: boolean; onSelect?: (selected: boolean) => void }) {
  const [expanded, setExpanded] = useRememberedBoolean(`task:${run.id}:activity-details`, false);
  const project = props.projects.find(item => item.id === run.projectId);
  const archived = Boolean(run.hiddenAt || run.trashedAt);
  const action = taskNextAction(run);
  const planning = run.purpose === 'automation-plan';
  const steps = run.snapshot.steps.filter(step => step.enabled);
  const completeCount = steps.filter(step => run.attempts.filter(attempt => attempt.stepId === step.id).at(-1)?.status === 'complete').length;
  const Icon = run.status === 'running' ? LoaderCircle : run.status === 'complete' ? CheckCircle2 : taskGroup(run) === 'attention' ? CircleAlert : Clock3;
  const detailId = `task-detail-${run.id}`;
  return <article className={`panel activity-task ${taskGroup(run)}${selected ? ' bulk-selected-task' : ''}`}>
    {bulkMode && <label className="bulk-selection-label bulk-task-check"><input type="checkbox" aria-label={`选择任务 ${run.id}`} checked={!!selected} disabled={locked || !canOrganizeRun(run)} onChange={event => onSelect?.(event.target.checked)} />{canOrganizeRun(run) ? '选择任务' : '运行中或等待处理，暂不能整理'}</label>}
    <div className="activity-task-summary">
      <span className={`activity-task-icon ${run.status}`}><Icon size={21} className={run.status === 'running' ? 'spin' : undefined} /></span>
      <div className="activity-task-name"><div><strong>{project?.name || '项目已移出当前列表'}</strong><span className={`activity-status ${run.status}`}>{planning && run.status === 'complete' ? '方案已准备好' : taskStatusLabel(run)}</span><span className="activity-mode">{planning ? 'AI方案规划' : run.mode === 'live' ? '真实调用' : '模拟'}</span></div><p>{run.workflowName}</p><small>{planning && run.status === 'complete' ? '这次只整理方案，尚未制作文档或图片。' : run.status === 'running' ? run.pauseRequested ? '当前请求结束后暂停' : `正在处理：${run.snapshot.steps[run.stepIndex]?.name || '整理结果'}` : run.error ? '此任务需要处理，展开可查看原因和继续方式' : `${completeCount} / ${steps.length} 步已完成`}</small></div>
      <div className="activity-task-cost"><span>{run.mode === 'live' ? '调用花费' : '模拟费用'}</span><CostTotal summary={summarizeCosts(runCostRecords(run, props.ledger))} /><small>{Number.isNaN(Date.parse(run.updatedAt)) ? run.updatedAt : new Date(run.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</small></div>
      <div className="activity-task-controls">{!archived && project && action === 'project' ? <button className="btn btn-primary" onClick={() => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)}>{run.status === 'waiting-review' ? '检查并交付' : '查看成品'}<ArrowRight size={15} /></button> : <button className="btn btn-secondary" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>{archived ? '查看与恢复' : planning ? '查看方案与记录' : run.status === 'running' ? '查看进度' : run.status === 'waiting-review' ? '查看检查步骤' : taskGroup(run) === 'attention' ? '处理任务' : '查看结果与步骤'}<ChevronDown size={15} /></button>}
        <button className="activity-detail-toggle" aria-label={`${expanded ? '收起' : '展开'}任务详情 ${run.id}`} aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>{expanded ? '收起详情' : '步骤与更多操作'}<ChevronDown size={13} className={expanded ? 'is-open' : ''} /></button>
      </div>
    </div>
    {expanded && <div id={detailId} className="activity-task-detail">{planning && <div className="activity-planning-context"><span>方案规划不会直接生成成品。可以回首页继续讨论并确认创建，再明确运行制作。</span><button className="btn btn-secondary" onClick={() => props.navigate('overview', run.projectId)}>回首页继续搭建<ArrowRight size={14} /></button></div>}<WorkflowRunCard props={props} run={run} /></div>}
  </article>;
}

export function Activity(props: PageProps) {
  const { projects, activeProject, workflowRunner, navigate, onCreateProject } = props;
  const [showBatch, setShowBatch] = useRememberedBoolean(`workspace:${props.workspaceId}:activity-batch`, false);
  const [taskScope, setTaskScope] = useState<TaskScope>('visible');
  const [projectId, setProjectId] = useState('all');
  const [group, setGroup] = useState<TaskGroup | 'all'>('all');
  const [query, setQuery] = useState('');
  const [emptyProjectId, setEmptyProjectId] = useState(activeProject.id);
  const [bulkMode, setBulkMode] = useState(false), [selectedIds, setSelectedIds] = useState(new Set<string>()), [bulkBusy, setBulkBusy] = useState(false), [bulkMessage, setBulkMessage] = useState('');
  const [bulkJob, setBulkJob] = useState<{ action: TaskOrganizeAction; items: { id: string; name: string }[] }>();
  const bulkPending = useRef(false), scope = useRef(props.workspaceId), runner = useRef(workflowRunner); scope.current = props.workspaceId; runner.current = workflowRunner;
  useEffect(() => registerEditorSession({ id: `task-bulk-${props.workspaceId}`, projectId: '', label: '正在批量整理任务记录', getState: () => ({ dirty: false, pending: bulkPending.current }), save: async () => false, exportRecovery: () => false }), [props.workspaceId]);
  useEffect(() => { setBulkMode(false); setSelectedIds(new Set()); setBulkJob(undefined); setBulkMessage(''); bulkPending.current = false; setBulkBusy(false); }, [props.workspaceId]);
  useEffect(() => { setSelectedIds(new Set()); setBulkJob(undefined); setBulkMessage(''); }, [taskScope, projectId, group, query]);
  useEffect(() => { scope.current = props.workspaceId; return () => { scope.current = ''; }; }, [props.workspaceId]);
  useEffect(() => { setEmptyProjectId(activeProject.id); }, [activeProject.id]);
  useEffect(() => { setProjectId('all'); setGroup('all'); setQuery(''); setTaskScope('visible'); }, [props.workspaceId]);
  const selected = projects.find(project => project.id === emptyProjectId) || projects[0];
  const scoped = scopedTaskRuns(workflowRunner.runs, taskScope);
  const filtered = useMemo(() => filterTaskRuns(workflowRunner.runs, projects, { scope: taskScope, group, projectId, query }), [workflowRunner.runs, projects, taskScope, group, projectId, query]);
  const selectedRuns = filtered.filter(run => selectedIds.has(run.id)), selectable = filtered.filter(canOrganizeRun).slice(0, 100);
  function selectRun(id: string, checked: boolean) { setSelectedIds(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; }); }
  function requestBulk(action: TaskOrganizeAction) { const selected = selectedRuns.filter(run => taskCanOrganizeAs(run, action)); if (!selected.length) return; setBulkJob({ action, items: selected.map(run => ({ id: run.id, name: `${projects.find(project => project.id === run.projectId)?.name || '当前项目'} · ${run.workflowName}` })) }); }
  async function confirmBulk() {
    if (!bulkJob || !runner.current.manageRun || bulkPending.current) return;
    const identity = props.workspaceId, job = bulkJob; bulkPending.current = true; setBulkBusy(true); setBulkMessage('');
    try {
      const result = await organizeTaskBatch({ ids: job.items.map(item => item.id), action: job.action, workspaceId: identity, getRuns: () => runner.current.runs, projectIds: new Set(projects.filter(project => project.workspaceId === identity).map(project => project.id)), manage: (id, action) => runner.current.manageRun!(id, action), stillCurrent: () => scope.current === identity });
      if (scope.current !== identity) return;
      const message = `已${job.action === 'hide' ? '隐藏' : job.action === 'trash' ? '移入回收站' : '恢复'} ${result.done} 个任务${result.skipped ? `，跳过或未完成 ${result.skipped} 个` : ''}。历史费用与产物保留，未取消或重新调用模型。`;
      setSelectedIds(new Set(result.failedIds)); setBulkJob(undefined); setBulkMessage(message); props.notify(message, result.skipped ? 'info' : 'success');
    } catch (cause) { if (scope.current === identity) { setBulkJob(undefined); setBulkMessage(cause instanceof Error ? cause.message : '批量整理尚未全部确认，已完成记录保留。请核对后重试。'); } }
    finally { if (scope.current === identity) { bulkPending.current = false; setBulkBusy(false); } }
  }
  const groups = [{ value: 'all', label: '全部任务', Icon: ListTodo }, { value: 'attention', label: '需要处理', Icon: CircleAlert }, { value: 'running', label: '执行中', Icon: LoaderCircle }, { value: 'finished', label: '已结束', Icon: CheckCircle2 }] as const;
  return <div className="op-page activity-page">
    <div className="page-heading"><div><h1 className="page-title">任务中心</h1><p className="page-description">先看需要处理的任务，再查看进度和成品。</p></div><div className="activity-heading-actions"><button type="button" className="btn btn-secondary" aria-pressed={bulkMode} disabled={bulkBusy} onClick={() => { setBulkMode(value => !value); setSelectedIds(new Set()); }}>{bulkMode ? '退出批量整理' : '批量整理任务'}</button><button className="btn btn-secondary" aria-expanded={showBatch} onClick={() => setShowBatch(value => !value)}>批量生产<ChevronDown size={14} /></button><button className="btn btn-secondary" onClick={() => navigate('workflows')}>管理工作流<ChevronRight size={14} /></button></div></div>
    {showBatch && <BatchProductionPanel workspaceId={props.workspaceId} workflows={props.configuration.workflows} projects={props.projects} configuration={props.configuration} ledger={props.ledger} notify={props.notify} onProjectsCreated={props.onBatchProjectsCreated} onOpenProject={project => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} />}
    {workflowRunner.runs.length > 0 ? <>
      <div className="activity-status-grid" role="group" aria-label="按任务状态筛选">{groups.map(({ value, label, Icon }) => <button key={value} className={group === value ? 'active' : ''} aria-pressed={group === value} onClick={() => setGroup(value)}><span><Icon size={18} />{label}</span><strong>{scoped.filter(run => value === 'all' || taskGroup(run) === value).length}</strong></button>)}</div>
      <section className="activity-list-section"><TaskScopeFilter runs={workflowRunner.runs} value={taskScope} onChange={setTaskScope} />
        <div className="activity-toolbar"><label className="activity-search"><Search size={17} /><input aria-label="搜索任务" placeholder="搜索项目、工作流或异常原因" value={query} onChange={event => setQuery(event.target.value)} /></label><Select aria-label="筛选任务项目" value={projectId} onValueChange={setProjectId} options={[{ value: 'all', label: '所有项目' }, ...projects.map(project => ({ value: project.id, label: project.name }))]} /><span>{filtered.length} 个任务</span></div>
        {bulkMode && <div className="bulk-organize-toolbar"><strong>已选 {selectedRuns.length} 个任务</strong><button type="button" className="btn btn-ghost" disabled={bulkBusy || !selectable.length} onClick={() => setSelectedIds(new Set(selectable.map(run => run.id)))}>{selectable.length === 100 ? '选择前100个可整理任务' : '选择全部可整理任务'}</button><button type="button" className="btn btn-ghost" disabled={bulkBusy || !selectedRuns.length} onClick={() => setSelectedIds(new Set())}>清除任务选择</button>{taskScope === 'visible' ? <button type="button" className="btn btn-secondary" disabled={bulkBusy || !workflowRunner.manageRun || !selectedRuns.some(run => taskCanOrganizeAs(run, 'hide'))} onClick={() => requestBulk('hide')}>批量隐藏任务</button> : <button type="button" className="btn btn-secondary" disabled={bulkBusy || !workflowRunner.manageRun || !selectedRuns.some(run => taskCanOrganizeAs(run, 'restore'))} onClick={() => requestBulk('restore')}>批量恢复任务</button>}{taskScope !== 'trash' && <button type="button" className="btn btn-secondary" disabled={bulkBusy || !workflowRunner.manageRun || !selectedRuns.some(run => taskCanOrganizeAs(run, 'trash'))} onClick={() => requestBulk('trash')}>批量移入任务回收站</button>}<span>只整理已结束记录；每次最多整理100项，不取消在途模型。</span></div>}{bulkMessage && <p className="bulk-organize-result" role="status">{bulkMessage}</p>}{filtered.length ? <TaskRunList key={`${props.workspaceId}-${taskScope}-${group}-${projectId}-${query}`} runs={filtered} renderRun={run => <TaskRow props={props} run={run} bulkMode={bulkMode} selected={selectedIds.has(run.id)} locked={bulkBusy} onSelect={checked => selectRun(run.id, checked)} />} /> : <div className="panel activity-filter-empty"><Search size={28} /><h3>{query || group !== 'all' || projectId !== 'all' ? '没有符合筛选条件的任务' : taskScope === 'hidden' ? '没有已隐藏任务' : taskScope === 'trash' ? '任务回收站为空' : '当前没有显示的任务'}</h3><p>隐藏和回收仅整理任务记录，费用和生成文件仍保留。</p><button className="btn btn-secondary" onClick={() => { setQuery(''); setGroup('all'); setProjectId('all'); setTaskScope('visible'); }}>查看全部当前任务</button></div>}
      </section><p className="activity-footnote">继续中断任务或重试会重新请求模型；已经发生的费用始终保留。任务中的步骤、日志和恢复操作可按需展开。</p>
    </> : <section className="panel activity-empty" aria-label="任务记录为空">
      <span className="activity-empty-icon"><ListTodo size={30} /></span><h2>还没有执行记录</h2><p>在项目工作台生成或精修后，执行进度、结果与费用记录会显示在这里。</p><p>下面的操作只创建或打开项目、查看流程，不会开始模型调用。</p>
      {selected && <label className="activity-empty-project"><span>选择要打开的项目</span><Select aria-label="任务空态关联项目" value={selected.id} onValueChange={setEmptyProjectId} options={projects.map(project => ({ value: project.id, label: project.name }))} /></label>}
      <div className="activity-empty-actions"><button className="btn btn-primary" onClick={() => onCreateProject()}><Plus size={16} />新建项目</button>{selected && <button className="btn btn-secondary" onClick={() => navigate(selected.kind === 'image' ? 'images' : 'documents', selected.id)}><FolderOpen size={16} />打开所选项目</button>}<button className="btn btn-secondary" onClick={() => navigate('workflows')}><Workflow size={16} />查看工作流</button></div>
    </section>}
    {bulkJob && <BulkOrganizeDialog title={bulkJob.action === 'hide' ? '批量隐藏任务' : bulkJob.action === 'trash' ? '批量移入任务回收站' : '批量恢复任务'} noun="任务" items={bulkJob.items} busy={bulkBusy} onClose={() => { if (!bulkPending.current) setBulkJob(undefined); }} onConfirm={() => { void confirmBulk(); }} />}
  </div>;
}
