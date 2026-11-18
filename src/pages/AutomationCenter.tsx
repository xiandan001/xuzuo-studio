import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, Clock3, GitBranch, Play, Plus, RefreshCw, ShieldCheck, Square, WandSparkles } from 'lucide-react';
import type { PageProps } from '../types';
import type { AutomationRule } from '../automation-types';
import { useAutomationCenter } from '../hooks/useAutomationCenter';
import { useRememberedString } from '../hooks/useRememberedString';
import { RememberedDetails } from '../components/RememberedDetails';
import { AutomationRuleEditor } from '../components/AutomationRuleEditor';
import { AutomationRecipeEditor } from '../components/AutomationRecipeEditor';
import { AutomationRunViewer } from '../components/AutomationRunViewer';
import { NaturalAutomationComposer } from '../components/NaturalAutomationComposer';
import { AutomationReadinessDialog } from '../components/AutomationReadinessDialog';
import { naturalModelSelection } from '../components/NaturalAutomationModels';
import { naturalQuestionAnswer } from '../lib/natural-automation-composer-state';
import { CostTotal } from '../components/CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { workflowReviewState } from '../lib/workflow-review';
import './automation.css';
import './resource-runtime-workspaces.css';

const triggerLabel = { manual: '按需手动运行', schedule: '定时触发', 'reference-imported': '参考资料导入后', 'run-completed': '指定流程完成后' };
const jobLabel = { queued: '排队中', dispatching: '正在派工', running: '执行中', decision: '需要你处理', complete: '已完成', cancelled: '已取消' };
const tabLabel: Record<string, string> = { rules: '自动化规则', decisions: '需要我处理', history: '执行记录', memory: '已确认记忆' };
export function AutomationCenter(props: PageProps) {
  const { bridge, snapshot, refresh, loading } = useAutomationCenter(props.workspaceId);
  const [preferredTab, setTab] = useRememberedString(`workspace:${props.workspaceId}:automation-tab`, '');
  const [editor, setEditor] = useState<{ value?: Partial<AutomationRule> }>(), [recipe, setRecipe] = useState(false), [pending, setPending] = useState(''), [error, setError] = useState(''), [limit, setLimit] = useState(20);
  const [notes, setNotes] = useState<Record<string, string>>({}), [remember, setRemember] = useState<Record<string, boolean>>({});
  const [selectedRun, setSelectedRun] = useState('');
  const [natural, setNatural] = useState(false);
  const [recipeProjectId, setRecipeProjectId] = useState('');
  const [readinessRuleId, setReadinessRuleId] = useState('');
  const [expanded, setExpanded] = useState('');
  const [recentJob, setRecentJob] = useState('');
  const actionPending = useRef(false), scope = useRef(props.workspaceId); scope.current = props.workspaceId;
  const awaitingRecipe = useRef<{ projectId: string; name: string; input: string } | undefined>(undefined);
  useEffect(() => { setEditor(undefined); setRecipe(false); setRecipeProjectId(''); setNatural(false); setReadinessRuleId(''); setSelectedRun(''); setNotes({}); setRemember({}); setError(''); setLimit(20); awaitingRecipe.current = undefined; }, [props.workspaceId]);
  const decisions = snapshot.decisions.filter(decision => !decision.resolvedAt);
  const tab = Object.hasOwn(tabLabel, preferredTab) ? preferredTab : decisions.length ? 'decisions' : 'rules';
  useEffect(() => { setLimit(20); setExpanded(''); }, [tab, props.workspaceId]);
  useEffect(() => { setRecentJob(''); }, [props.workspaceId]);
  useEffect(() => {
    const intent = props.automationIntent; if (!intent || intent.workspaceId !== props.workspaceId) return;
    if ('tab' in intent) setTab(intent.tab);
    else {
      const workflow = props.configuration.workflows.find(workflow => workflow.id === intent.workflowId);
      if (workflow) { setTab('rules'); setEditor({ value: { projectId: intent.projectId, workflowId: workflow.id, input: intent.input, name: `${workflow.name} · 自动化` } }); }
    }
    props.onAutomationIntentConsumed?.(intent.token);
  }, [props.automationIntent?.token, props.workspaceId]);
  useEffect(() => {
    const current = awaitingRecipe.current; if (!current) return;
    const workflow = props.configuration.workflows.find(workflow => workflow.name === current.name);
    if (workflow) { awaitingRecipe.current = undefined; setEditor({ value: { projectId: current.projectId, workflowId: workflow.id, name: `${workflow.name} · 自动化`, input: current.input } }); }
  }, [props.configuration.workflows]);
  async function act(key: string, action: () => Promise<unknown>, success?: string) {
    if (actionPending.current) return; const workspaceId = props.workspaceId; actionPending.current = true; setPending(key); setError('');
    try { await action(); if (scope.current === workspaceId) { await refresh(); if (success) props.notify(success); } }
    catch (cause) { if (scope.current === workspaceId) setError(cause instanceof Error ? cause.message : '操作未完成，既有记录与费用保留。'); }
    finally { actionPending.current = false; if (scope.current === workspaceId) setPending(''); }
  }
  const projectName = (id: string) => props.projects.find(project => project.id === id)?.name || '原项目';
  const workflowName = (id: string) => props.configuration.workflows.find(workflow => workflow.id === id)?.name || '原流程';
  const activeJobs = new Map(snapshot.jobs.filter(job => ['queued', 'dispatching', 'running', 'decision'].includes(job.status)).map(job => [job.ruleId, job]));
  function openTask(runId: string, projectId: string) {
    if (props.onOpenTask && props.workflowRunner.runs.some(run => run.id === runId && run.projectId === projectId && run.workspaceId === props.workspaceId && !run.hiddenAt && !run.trashedAt)) props.onOpenTask(runId, projectId);
    else setSelectedRun(runId);
  }
  function followJob(id: string) {
    setRecentJob(id);
    setTab('history');
  }
  function runRule(rule: AutomationRule) {
    const currentJob = activeJobs.get(rule.id);
    if (currentJob) {
      if (currentJob.runId) openTask(currentJob.runId, currentJob.projectId);
      else followJob(currentJob.id);
      return;
    }
    if (needsSetup(rule)) { setReadinessRuleId(rule.id); return; }
    if (!bridge) return;
    void act(rule.id, async () => {
      const job = await bridge.trigger({ ruleId: rule.id });
      if (scope.current === rule.workspaceId) followJob(job.id);
    }, '任务已接收，状态会在执行记录更新。');
  }
  function createFirstProject() {
    const workspaceId = props.workspaceId;
    props.onCreateProject(undefined, { onCreated: project => { if (scope.current === workspaceId && project.workspaceId === workspaceId) { setRecipeProjectId(project.id); setRecipe(true); } } });
  }
  function needsSetup(rule: AutomationRule) {
    if (rule.preparation?.questions.some(question => !naturalQuestionAnswer(rule.preparation!.answers, question).trim())) return true;
    const workflow = props.configuration.workflows.find(workflow => workflow.id === rule.workflowId);
    if (!workflow) return true;
    return workflow.steps.some(step => {
      if (!step.enabled || !['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind)) return false;
      if (!step.modelConfigId || !step.credentialId) return true;
      const selected = naturalModelSelection(props.configuration, step.kind as 'text', { modelConfigId: step.modelConfigId, credentialId: step.credentialId });
      return !selected.model || !selected.credentialId;
    });
  }
  const readinessRule = snapshot.rules.find(rule => rule.id === readinessRuleId);
  const activeCount = tab === 'rules' ? snapshot.rules.length : tab === 'decisions' ? decisions.length : tab === 'history' ? snapshot.jobs.length : tab === 'memory' ? snapshot.memories.length : 0;
  return <div className="auto-page">
    <header className="auto-heading">
      <h1>自动化中心</h1>
      <div>
        <button className="btn btn-secondary" onClick={() => props.navigate('overview')}><WandSparkles size={16} />与 AI 搭建</button>
        <button className="btn btn-primary" disabled={!bridge || !snapshot.available} onClick={() => setEditor({})}><Plus size={16} />新建自动化</button>
      </div>
    </header>
    {(!bridge || snapshot.issue) && <div className="auto-status-note" role="alert">
      <ShieldCheck size={18} />
      <span>{snapshot.issue || '在桌面应用中运行自动化。'}</span>
      {bridge && <button className="btn btn-secondary" disabled={!!pending} onClick={() => { void act('reload', () => bridge.reload()); }}>重新读取</button>}
    </div>}
    <div className="auto-tabs" role="tablist" aria-label="自动化页面">
      {[
        ['rules', snapshot.rules.length],
        ['decisions', decisions.length],
        ['history', snapshot.jobs.length],
        ['memory', snapshot.memories.length],
      ].map(([value, count]) => <button type="button" role="tab" key={value}
        aria-selected={tab === value} aria-controls="auto-current-panel" className={tab === value ? 'active' : ''}
        onClick={() => setTab(String(value))}
      >{tabLabel[value]}<span className={value === 'decisions' && Number(count) > 0 ? 'auto-alert-count' : ''}>{count}</span></button>)}
      <button className="btn-icon" aria-label="刷新自动化记录" title="刷新记录" disabled={loading} onClick={() => { void refresh(); }}><RefreshCw size={16} /></button>
    </div>
    {error && <p className="auto-error" role="alert">{error}</p>}
    <div role="tabpanel" id="auto-current-panel" aria-label={tabLabel[tab]}>
      {tab === 'rules' && (snapshot.rules.length ? <div className="auto-rule-grid">{snapshot.rules.slice(0, limit).map(rule => {
        const setup = needsSetup(rule), job = activeJobs.get(rule.id), opened = expanded === rule.id;
        return <article className="auto-rule-card auto-row" key={rule.id}>
          <div className="auto-row-icon"><GitBranch size={17} /></div>
          <div className="auto-row-main">
            <div className="auto-row-title"><h2>{rule.name}</h2>
              {setup ? <span className="auto-state needs-attention">待补充</span>
                : rule.trigger !== 'manual' && <span className={'auto-state' + (rule.enabled ? ' enabled' : '')}>{rule.enabled ? '已启用' : '未启用'}</span>}
            </div>
            <p>{projectName(rule.projectId)} <span aria-hidden="true">·</span> {triggerLabel[rule.trigger]}{rule.trigger === 'schedule' && ' · 每 ' + rule.intervalMinutes + ' 分钟'}</p>
          </div>
          <div className="auto-row-actions">
            <button className="btn btn-secondary auto-manage" aria-expanded={opened} onClick={() => setExpanded(opened ? '' : rule.id)}>管理<ChevronDown size={14} /></button>
            <button className="btn btn-primary" disabled={!bridge || !!pending} onClick={() => runRule(rule)}>
              {job ? <ArrowRight size={15} /> : <Play size={15} />}{pending === rule.id ? '正在提交…' : job ? '查看运行' : setup ? '补齐设置' : '运行一次'}
            </button>
          </div>
          {opened && <div className="auto-row-detail">
            <div className="auto-detail-copy">
              <strong>{workflowName(rule.workflowId)}</strong>
              {rule.input.trim() && <p>{rule.input}</p>}
            </div>
            <div className="auto-detail-actions">
              <button className="btn btn-secondary" disabled={!!pending} onClick={() => setReadinessRuleId(rule.id)}>运行设置</button>
              <button className="btn btn-secondary" disabled={!!pending} onClick={() => setEditor({ value: rule })}>编辑规则</button>
              {rule.trigger !== 'manual' && <button className="btn btn-secondary" disabled={!bridge || !!pending} onClick={() => {
                if (!rule.enabled && setup) { setReadinessRuleId(rule.id); return; }
                if (bridge) void act(rule.id, () => bridge.setEnabled({ id: rule.id, enabled: !rule.enabled }), rule.enabled ? '已停用规则，未派工的队列已取消。' : '规则已启用。');
              }}>{rule.enabled ? '停用规则' : '启用规则'}</button>}
            </div>
          </div>}
        </article>;
      })}</div> : <div className="auto-empty panel">
        <GitBranch size={28} /><h2>还没有自动化规则</h2>
        <p>选择项目、流程与触发条件，保存后即可手动运行。</p>
        <button className="btn btn-primary" onClick={props.projects.length ? () => setRecipe(true) : createFirstProject}>{props.projects.length ? '从目标开始' : '新建项目'}</button>
      </div>)}
      {tab === 'decisions' && (decisions.length ? <div className="auto-decision-list">{decisions.slice(0, limit).map(decision => {
        const job = snapshot.jobs.find(item => item.id === decision.jobId);
        const entries = decision.runId ? props.ledger.filter(entry => entry.workflowRunId === decision.runId) : [];
        const run = decision.runId ? props.workflowRunner.runs.find(item => item.id === decision.runId) : undefined;
        const manualReview = run && workflowReviewState(run) === 'manual';
        const opened = expanded === decision.id;
        const status = decision.kind === 'uncertain' ? '需核对' : decision.kind === 'failure' ? '执行中断' : '待检查';
        const resolve = (action: 'refresh' | 'reject' | 'continue' | 'approve') => {
          if (bridge) void act(decision.id, () => bridge.resolve({ id: decision.id, action, note: notes[decision.id], remember: remember[decision.id] }));
        };
        return <article className="auto-decision-card auto-row" key={decision.id}>
          <div className="auto-row-icon needs-attention"><ShieldCheck size={17} /></div>
          <div className="auto-row-main">
            <div className="auto-row-title"><h2>{decision.title}</h2><span className="auto-state needs-attention">{status}</span></div>
            <p>{projectName(decision.projectId)} · {new Date(decision.createdAt).toLocaleString('zh-CN')}</p>
            <p className={'auto-row-error' + (opened ? ' expanded' : '')}>{decision.detail}</p>
            {entries.length > 0 && <div className="auto-cost">调用费用 <CostTotal summary={summarizeCosts(entries)} /></div>}
          </div>
          <div className="auto-row-actions">
            <button className={'btn ' + (decision.runId ? 'btn-secondary' : 'btn-primary')} aria-expanded={opened} onClick={() => setExpanded(opened ? '' : decision.id)}>{opened ? '收起' : '处理选项'}<ChevronDown size={14} /></button>
            {decision.runId && <button className="btn btn-primary" onClick={() => openTask(decision.runId!, decision.projectId)}>查看任务<ArrowRight size={15} /></button>}
          </div>
          {opened && <div className="auto-row-detail auto-decision-detail">
            <details className="auto-optional-note">
              <summary>填写处理备注</summary>
              <textarea aria-label={'待办备注 ' + decision.id} rows={2} maxLength={3000} value={notes[decision.id] || ''} onChange={event => setNotes(value => ({ ...value, [decision.id]: event.target.value }))} placeholder="记录处理原因或本项目偏好" />
              <label className="auto-enable"><input type="checkbox" checked={!!remember[decision.id]} onChange={event => setRemember(value => ({ ...value, [decision.id]: event.target.checked }))} />保存为项目记忆</label>
            </details>
            <div className="auto-detail-actions">
              <button className="btn btn-secondary" disabled={!bridge || !!pending || !job} onClick={() => resolve('refresh')}>刷新状态</button>
              <button className="btn btn-secondary" disabled={!bridge || !!pending || !job} onClick={() => resolve('reject')}>停止任务</button>
              {decision.kind === 'review' && manualReview && <button className="btn btn-primary" disabled={!bridge || !!pending || !job} onClick={() => resolve('approve')}>已检查，继续</button>}
              {decision.kind !== 'review' && (!decision.runId || decision.kind === 'uncertain') && <button className="btn btn-primary" disabled={!bridge || !!pending || !job} onClick={() => resolve('continue')}>明确继续 · 可能新增调用费</button>}
            </div>
          </div>}
        </article>;
      })}</div> : <div className="auto-empty panel"><CheckCircle2 size={28} /><h2>当前没有待处理任务</h2></div>)}
      {tab === 'history' && (snapshot.jobs.length ? <div className="auto-history-list">{snapshot.jobs.slice(0, limit).map(job => {
        const rule = snapshot.rules.find(item => item.id === job.ruleId);
        const run = job.runId ? props.workflowRunner.runs.find(item => item.id === job.runId) : undefined;
        const step = run?.snapshot.steps[run.stepIndex];
        const opened = expanded === job.id;
        const cancellable = ['queued', 'dispatching', 'running', 'decision'].includes(job.status);
        return <article className={'auto-history-row auto-row' + (job.id === recentJob ? ' auto-recent-job' : '')} key={job.id}>
          <div className="auto-row-icon"><Clock3 size={17} /></div>
          <div className="auto-row-main">
            <div className="auto-row-title"><h2>{rule?.name || '原自动化规则'}</h2>
              <span className={'auto-state' + (job.status === 'complete' ? ' enabled' : job.status === 'decision' ? ' needs-attention' : '')}>{jobLabel[job.status]}</span>
            </div>
            <p>{projectName(job.projectId)} · {new Date(job.createdAt).toLocaleString('zh-CN')}</p>
            {job.status === 'running' && step && <p>{step.name}</p>}
            {job.error && <p className={'auto-row-error' + (opened ? ' expanded' : '')}>{job.error}</p>}
          </div>
          <div className="auto-row-actions">
            {cancellable && <button className="btn btn-secondary auto-manage" aria-expanded={opened} onClick={() => setExpanded(opened ? '' : job.id)}>管理<ChevronDown size={14} /></button>}
            {job.runId ? <button className="btn btn-primary" onClick={() => openTask(job.runId!, job.projectId)}>{job.status === 'complete' ? '查看结果' : '查看任务'}<ArrowRight size={15} /></button>
              : job.status === 'decision' ? <button className="btn btn-primary" onClick={() => setTab('decisions')}>前往处理<ArrowRight size={15} /></button> : null}
          </div>
          {opened && <div className="auto-row-detail">
            <div className="auto-detail-actions">
              {!job.runId && <button className="btn btn-secondary" onClick={() => props.navigate('workflows', job.projectId)}>查看流程</button>}
              <button className="btn btn-secondary" disabled={!bridge || !!pending} onClick={() => { if (bridge) void act(job.id, () => bridge.cancelJob(job.id)); }}><Square size={14} />取消此项</button>
            </div>
          </div>}
        </article>;
      })}</div> : <div className="auto-empty panel"><Clock3 size={28} /><h2>还没有执行记录</h2><p>规则第一次触发后，进度和结果会显示在这里。</p></div>)}
      {tab === 'memory' && <div className="auto-memory-list">{snapshot.memories.length ? snapshot.memories.slice(0, limit).map(memory => <article className="panel" key={memory.id}>
        <header><strong>{projectName(memory.projectId)}</strong><small>{new Date(memory.createdAt).toLocaleString('zh-CN')}</small></header>
        <p>{memory.note}</p><small>{memory.action === 'reject' ? '停止任务时保存' : '处理任务时保存'}</small>
      </article>) : <div className="auto-empty panel"><h2>还没有已确认记忆</h2><p>处理待办时，可以选择保存项目偏好。</p></div>}</div>}
      {activeCount > limit && <button className="btn btn-secondary auto-more" onClick={() => setLimit(value => value + 20)}>再显示20项</button>}
    </div>
    <RememberedDetails rememberKey={'workspace:' + props.workspaceId + ':automation-advanced-form'} className="auto-reference">
      <summary>流程管理与运行说明</summary>
      <div className="auto-detail-actions">
        <button className="btn btn-secondary" onClick={() => props.navigate('workflows')}>编辑流程模板</button>
        <button className="btn btn-secondary" onClick={() => setRecipe(true)}>从目标建立流程</button>
        <button className="btn btn-secondary" onClick={() => setNatural(true)}>高级表单搭建</button>
      </div>
      <p>定时和资料事件在桌面应用运行时触发。停用规则会取消未派工的队列，已开始的任务可单独取消。</p>
      <p>流程参考数字生命卡兹克公开的事件驱动、SOP、独立验收与决策记忆方法。</p>
    </RememberedDetails>
    {editor && <AutomationRuleEditor props={props} initial={editor.value} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); void refresh(); }} />}
    {natural && <NaturalAutomationComposer key={props.workspaceId} props={props} onClose={() => setNatural(false)} onSaved={() => { setTab('rules'); void refresh(); }} />}
    {readinessRule && <AutomationReadinessDialog key={`${props.workspaceId}:${readinessRule.id}`} props={props} rule={readinessRule} onClose={() => setReadinessRuleId('')} onSaved={() => { void refresh(); }} />}
    {selectedRun && <AutomationRunViewer key={`${props.workspaceId}/${selectedRun}`} props={props} runId={selectedRun} onClose={() => setSelectedRun('')} />}
    {recipe && <AutomationRecipeEditor props={props} initialProjectId={recipeProjectId} onClose={() => { setRecipe(false); setRecipeProjectId(''); }} onCreated={(projectId, name, input) => { awaitingRecipe.current = { projectId, name, input }; setRecipe(false); setRecipeProjectId(''); }} />}
  </div>;
}
