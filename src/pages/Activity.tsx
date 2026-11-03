import { BatchProductionPanel } from '../components/BatchProductionPanel';
import { TaskRunList } from '../components/TaskRunList';
import { useEffect, useMemo, useState } from 'react';
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
import { WorkflowRunCard } from './Workflows';
import './operations.css';
import './activity.css';
import '../components/studio-run.css';

function TaskRow({ run, props }: { run: WorkflowRun; props: PageProps }) {
  const [expanded, setExpanded] = useState(false);
  const project = props.projects.find(item => item.id === run.projectId);
  const archived = Boolean(run.hiddenAt || run.trashedAt);
  const action = taskNextAction(run);
  const steps = run.snapshot.steps.filter(step => step.enabled);
  const completeCount = steps.filter(step => run.attempts.filter(attempt => attempt.stepId === step.id).at(-1)?.status === 'complete').length;
  const Icon = run.status === 'running' ? LoaderCircle : run.status === 'complete' ? CheckCircle2 : taskGroup(run) === 'attention' ? CircleAlert : Clock3;
  const detailId = `task-detail-${run.id}`;
  return <article className={`panel activity-task ${taskGroup(run)}`}>
    <div className="activity-task-summary">
      <span className={`activity-task-icon ${run.status}`}><Icon size={21} className={run.status === 'running' ? 'spin' : undefined} /></span>
      <div className="activity-task-name"><div><strong>{project?.name || '项目已移出当前列表'}</strong><span className={`activity-status ${run.status}`}>{taskStatusLabel(run)}</span><span className="activity-mode">{run.mode === 'live' ? '真实调用' : '模拟'}</span></div><p>{run.workflowName}</p><small>{run.status === 'running' ? run.pauseRequested ? '当前请求结束后暂停' : `正在处理：${run.snapshot.steps[run.stepIndex]?.name || '整理结果'}` : run.error ? '此任务需要处理，展开可查看原因和继续方式' : `${completeCount} / ${steps.length} 步已完成`}</small></div>
      <div className="activity-task-cost"><span>{run.mode === 'live' ? '调用花费' : '模拟费用'}</span><CostTotal summary={summarizeCosts(runCostRecords(run, props.ledger))} /><small>{Number.isNaN(Date.parse(run.updatedAt)) ? run.updatedAt : new Date(run.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</small></div>
      <div className="activity-task-controls">{!archived && project && action === 'project' ? <button className="btn btn-primary" onClick={() => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)}>{run.status === 'waiting-review' ? '检查并交付' : '查看成品'}<ArrowRight size={15} /></button> : <button className="btn btn-secondary" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>{archived ? '查看与恢复' : run.status === 'running' ? '查看进度' : taskGroup(run) === 'attention' ? '处理任务' : '查看记录'}<ChevronDown size={15} /></button>}
        <button className="activity-detail-toggle" aria-label={`${expanded ? '收起' : '展开'}任务详情 ${run.id}`} aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>{expanded ? '收起详情' : '步骤与更多操作'}<ChevronDown size={13} className={expanded ? 'is-open' : ''} /></button>
      </div>
    </div>
    {expanded && <div id={detailId} className="activity-task-detail"><WorkflowRunCard props={props} run={run} /></div>}
  </article>;
}

export function Activity(props: PageProps) {
  const { projects, activeProject, workflowRunner, navigate, onCreateProject } = props;
  const [showBatch, setShowBatch] = useState(false);
  const [taskScope, setTaskScope] = useState<TaskScope>('visible');
  const [projectId, setProjectId] = useState('all');
  const [group, setGroup] = useState<TaskGroup | 'all'>('all');
  const [query, setQuery] = useState('');
  const [emptyProjectId, setEmptyProjectId] = useState(activeProject.id);
  useEffect(() => { setEmptyProjectId(activeProject.id); }, [activeProject.id]);
  useEffect(() => { setProjectId('all'); setGroup('all'); setQuery(''); setTaskScope('visible'); setShowBatch(false); }, [props.workspaceId]);
  const selected = projects.find(project => project.id === emptyProjectId) || projects[0];
  const scoped = scopedTaskRuns(workflowRunner.runs, taskScope);
  const filtered = useMemo(() => filterTaskRuns(workflowRunner.runs, projects, { scope: taskScope, group, projectId, query }), [workflowRunner.runs, projects, taskScope, group, projectId, query]);
  const groups = [{ value: 'all', label: '全部任务', Icon: ListTodo }, { value: 'attention', label: '需要处理', Icon: CircleAlert }, { value: 'running', label: '执行中', Icon: LoaderCircle }, { value: 'finished', label: '已结束', Icon: CheckCircle2 }] as const;
  return <div className="op-page activity-page">
    <div className="page-heading"><div><h1 className="page-title">任务中心</h1><p className="page-description">先看需要处理的任务，再查看进度和成品。</p></div><div className="activity-heading-actions"><button className="btn btn-secondary" aria-expanded={showBatch} onClick={() => setShowBatch(value => !value)}>批量生产<ChevronDown size={14} /></button><button className="btn btn-secondary" onClick={() => navigate('workflows')}>管理工作流<ChevronRight size={14} /></button></div></div>
    {showBatch && <BatchProductionPanel workspaceId={props.workspaceId} workflows={props.configuration.workflows} projects={props.projects} configuration={props.configuration} ledger={props.ledger} notify={props.notify} onProjectsCreated={props.onBatchProjectsCreated} onOpenProject={project => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} />}
    {workflowRunner.runs.length > 0 ? <>
      <div className="activity-status-grid" role="group" aria-label="按任务状态筛选">{groups.map(({ value, label, Icon }) => <button key={value} className={group === value ? 'active' : ''} aria-pressed={group === value} onClick={() => setGroup(value)}><span><Icon size={18} />{label}</span><strong>{scoped.filter(run => value === 'all' || taskGroup(run) === value).length}</strong></button>)}</div>
      <section className="activity-list-section"><TaskScopeFilter runs={workflowRunner.runs} value={taskScope} onChange={setTaskScope} />
        <div className="activity-toolbar"><label className="activity-search"><Search size={17} /><input aria-label="搜索任务" placeholder="搜索项目、工作流或异常原因" value={query} onChange={event => setQuery(event.target.value)} /></label><Select aria-label="筛选任务项目" value={projectId} onValueChange={setProjectId} options={[{ value: 'all', label: '所有项目' }, ...projects.map(project => ({ value: project.id, label: project.name }))]} /><span>{filtered.length} 个任务</span></div>
        {filtered.length ? <TaskRunList key={`${props.workspaceId}-${taskScope}-${group}-${projectId}-${query}`} runs={filtered} renderRun={run => <TaskRow props={props} run={run} />} /> : <div className="panel activity-filter-empty"><Search size={28} /><h3>{query || group !== 'all' || projectId !== 'all' ? '没有符合筛选条件的任务' : taskScope === 'hidden' ? '没有已隐藏任务' : taskScope === 'trash' ? '任务回收站为空' : '当前没有显示的任务'}</h3><p>隐藏和回收仅整理任务记录，费用和生成文件仍保留。</p><button className="btn btn-secondary" onClick={() => { setQuery(''); setGroup('all'); setProjectId('all'); setTaskScope('visible'); }}>查看全部当前任务</button></div>}
      </section><p className="activity-footnote">继续中断任务或重试会重新请求模型；已经发生的费用始终保留。任务中的步骤、日志和恢复操作可按需展开。</p>
    </> : <section className="panel activity-empty" aria-label="任务记录为空">
      <span className="activity-empty-icon"><ListTodo size={30} /></span><h2>还没有执行记录</h2><p>在项目工作台生成或精修后，执行进度、结果与费用记录会显示在这里。</p><p>下面的操作只创建或打开项目、查看流程，不会开始模型调用。</p>
      {selected && <label className="activity-empty-project"><span>选择要打开的项目</span><Select aria-label="任务空态关联项目" value={selected.id} onValueChange={setEmptyProjectId} options={projects.map(project => ({ value: project.id, label: project.name }))} /></label>}
      <div className="activity-empty-actions"><button className="btn btn-primary" onClick={() => onCreateProject()}><Plus size={16} />新建项目</button>{selected && <button className="btn btn-secondary" onClick={() => navigate(selected.kind === 'image' ? 'images' : 'documents', selected.id)}><FolderOpen size={16} />打开所选项目</button>}<button className="btn btn-secondary" onClick={() => navigate('workflows')}><Workflow size={16} />查看工作流</button></div>
    </section>}
  </div>;
}
