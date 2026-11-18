import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, GitBranch, Play, Plus, RefreshCw, Search, ShieldCheck, WandSparkles, X } from 'lucide-react';
import type { PageProps } from '../types';
import type { AutomationJob, AutomationRule } from '../automation-types';
import { useAutomationCenter } from '../hooks/useAutomationCenter';
import { RememberedDetails } from '../components/RememberedDetails';
import { AutomationRuleEditor } from '../components/AutomationRuleEditor';
import { AutomationRecipeEditor } from '../components/AutomationRecipeEditor';
import { NaturalAutomationComposer } from '../components/NaturalAutomationComposer';
import { AutomationReadinessDialog } from '../components/AutomationReadinessDialog';
import { ModalPortal } from '../components/ModalPortal';
import { naturalModelSelection } from '../components/NaturalAutomationModels';
import { naturalQuestionAnswer } from '../lib/natural-automation-composer-state';
import './automation.css';
import './resource-runtime-workspaces.css';

const triggerLabel = { manual: '按需手动运行', schedule: '定时触发', 'reference-imported': '参考资料导入后', 'run-completed': '指定流程完成后' };
const activeJobLabel: Partial<Record<AutomationJob['status'], string>> = { queued: '排队中', dispatching: '正在派工', running: '执行中', decision: '需要处理' };

export function AutomationCenter(props: PageProps) {
  const { bridge, snapshot, refresh, loading } = useAutomationCenter(props.workspaceId);
  const [editor, setEditor] = useState<{ value?: Partial<AutomationRule> }>();
  const [recipe, setRecipe] = useState(false), [recipeProjectId, setRecipeProjectId] = useState('');
  const [natural, setNatural] = useState(false), [readinessRuleId, setReadinessRuleId] = useState('');
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [limit, setLimit] = useState(20), [expanded, setExpanded] = useState('');
  const [showMemory, setShowMemory] = useState(false), [memoryLimit, setMemoryLimit] = useState(20);
  const actionPending = useRef(false);
  const mounted = useRef(false);
  const scope = useRef(props.workspaceId); scope.current = props.workspaceId;
  const awaitingRecipe = useRef<{ projectId: string; name: string; input: string } | undefined>(undefined);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setEditor(undefined); setRecipe(false); setRecipeProjectId(''); setNatural(false); setReadinessRuleId('');
    setError(''); setPending(''); setSearch(''); setLimit(20); setExpanded(''); setShowMemory(false); setMemoryLimit(20);
    awaitingRecipe.current = undefined;
  }, [props.workspaceId]);
  useEffect(() => {
    const intent = props.automationIntent;
    if (!intent || intent.workspaceId !== props.workspaceId) return;
    const workflow = props.configuration.workflows.find(workflow => workflow.id === intent.workflowId);
    if (workflow) setEditor({ value: { projectId: intent.projectId, workflowId: workflow.id, input: intent.input, name: `${workflow.name} · 自动化` } });
    props.onAutomationIntentConsumed?.(intent.token);
  }, [props.automationIntent?.token, props.workspaceId]);
  useEffect(() => {
    const current = awaitingRecipe.current;
    if (!current) return;
    const workflow = props.configuration.workflows.find(workflow => workflow.name === current.name);
    if (workflow) {
      awaitingRecipe.current = undefined;
      setEditor({ value: { projectId: current.projectId, workflowId: workflow.id, name: `${workflow.name} · 自动化`, input: current.input } });
    }
  }, [props.configuration.workflows]);

  async function act<T>(key: string, action: () => Promise<T>, success?: string, onRefreshed?: (result: T) => void) {
    const workspaceId = props.workspaceId;
    if (actionPending.current) return;
    actionPending.current = true;
    setPending(key);
    setError('');
    try {
      const result = await action();
      await refresh(Boolean(onRefreshed));
      if (mounted.current && scope.current === workspaceId) {
        if (success) props.notify(success);
        onRefreshed?.(result);
      }
    } catch (cause) {
      if (mounted.current && scope.current === workspaceId) setError(cause instanceof Error ? cause.message : '操作未完成，既有记录与费用保留。');
    } finally {
      actionPending.current = false;
      if (mounted.current && scope.current === workspaceId) setPending('');
    }
  }

  const projectName = (id: string) => props.projects.find(project => project.id === id)?.name || '原项目';
  const workflowName = (id: string) => props.configuration.workflows.find(workflow => workflow.id === id)?.name || '原流程';
  const activeJobs = new Map(snapshot.jobs.filter(job => Object.hasOwn(activeJobLabel, job.status)).map(job => [job.ruleId, job]));
  const needle = search.trim().toLocaleLowerCase();
  const rules = needle ? snapshot.rules.filter(rule =>
    [rule.name, projectName(rule.projectId), workflowName(rule.workflowId), triggerLabel[rule.trigger]]
      .some(value => value.toLocaleLowerCase().includes(needle)),
  ) : snapshot.rules;

  function followJob(job: AutomationJob) {
    if (!mounted.current || job.workspaceId !== scope.current) return;
    if (props.onOpenDispatchTask) props.onOpenDispatchTask(job.id, job.projectId);
    else props.navigate('activity', job.projectId);
  }

  function runRule(rule: AutomationRule) {
    const currentJob = activeJobs.get(rule.id);
    if (currentJob) {
      const run = currentJob.runId && props.workflowRunner.runs.find(run => run.id === currentJob.runId
        && run.projectId === currentJob.projectId && run.workspaceId === props.workspaceId && !run.hiddenAt && !run.trashedAt);
      if (run && props.onOpenTask) props.onOpenTask(run.id, run.projectId);
      else followJob(currentJob);
      return;
    }
    if (needsSetup(rule)) { setReadinessRuleId(rule.id); return; }
    if (!bridge) return;
    void act(rule.id, () => bridge.trigger({ ruleId: rule.id }), '任务已接收。', followJob);
  }

  function createFirstProject() {
    const workspaceId = props.workspaceId;
    props.onCreateProject(undefined, { onCreated: project => {
      if (scope.current !== workspaceId || project.workspaceId !== workspaceId) return;
      setRecipeProjectId(project.id);
      setRecipe(true);
    } });
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
  const closeMemory = () => { setShowMemory(false); setMemoryLimit(20); };

  return <div className="auto-page">
    <header className="auto-heading">
      <h1>自动化规则</h1>
      <div>
        <button className="btn btn-secondary" onClick={() => props.navigate('activity')}>任务中心<ArrowRight size={15} /></button>
        <button className="btn btn-secondary" onClick={() => props.navigate('overview')}><WandSparkles size={16} />与 AI 搭建</button>
        <button className="btn btn-primary" disabled={!bridge || !snapshot.available} onClick={() => setEditor({})}><Plus size={16} />新建自动化</button>
      </div>
    </header>
    {(!bridge || snapshot.issue) && <div className="auto-status-note" role="alert">
      <ShieldCheck size={18} />
      <span>{snapshot.issue || '在桌面应用中运行自动化。'}</span>
      {bridge && <button className="btn btn-secondary" disabled={!!pending} onClick={() => { void act('reload', () => bridge.reload()); }}>重新读取</button>}
    </div>}
    <div className="auto-toolbar">
      <label className="auto-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label="搜索自动化规则" placeholder="搜索规则、项目或工作流" value={search} onChange={event => {
          setSearch(event.target.value);
          setLimit(20);
          setExpanded('');
        }} />
      </label>
      <button type="button" className="btn btn-secondary" onClick={() => setShowMemory(true)}>已确认记忆</button>
      <button className="btn-icon" aria-label="刷新自动化规则" title="刷新规则" disabled={loading || !bridge} onClick={() => { void refresh(); }}><RefreshCw size={16} /></button>
    </div>
    {error && <p className="auto-error" role="alert">{error}</p>}
    {rules.length ? <div className="auto-rule-grid">{rules.slice(0, limit).map(rule => {
      const setup = needsSetup(rule), job = activeJobs.get(rule.id), opened = expanded === rule.id;
      const jobStatus = job && activeJobLabel[job.status];
      return <article className="auto-rule-card auto-row" key={rule.id}>
        <div className="auto-row-icon"><GitBranch size={17} /></div>
        <div className="auto-row-main">
          <div className="auto-row-title">
            <h2>{rule.name}</h2>
            {rule.trigger !== 'manual' && <span className={'auto-state' + (rule.enabled ? ' enabled' : '')}>{rule.enabled ? '已启用' : '未启用'}</span>}
            {jobStatus ? <span className={'auto-state' + (job?.status === 'decision' ? ' needs-attention' : '')}>{jobStatus}</span>
              : setup && <span className="auto-state needs-attention">待补充</span>}
          </div>
          <p>{projectName(rule.projectId)} <span aria-hidden="true">·</span> {workflowName(rule.workflowId)} <span aria-hidden="true">·</span> {triggerLabel[rule.trigger]}
            {rule.trigger === 'schedule' && rule.intervalMinutes != null && ` · 每 ${rule.intervalMinutes} 分钟`}</p>
        </div>
        <div className="auto-row-actions">
          <button className="btn btn-secondary auto-manage" aria-expanded={opened} onClick={() => setExpanded(opened ? '' : rule.id)}>管理<ChevronDown size={14} /></button>
          <button className="btn btn-primary" disabled={!bridge || !!pending} onClick={() => runRule(rule)}>
            {job ? <ArrowRight size={15} /> : <Play size={15} />}{pending === rule.id ? '正在提交…' : job ? '查看运行' : setup ? '补齐设置' : '运行一次'}
          </button>
        </div>
        {opened && <div className="auto-row-detail">
          {rule.input.trim() && <div className="auto-detail-copy"><p>{rule.input}</p></div>}
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
    })}</div> : needle ? <div className="auto-empty panel" role="status"><Search size={26} /><h2>没有匹配的自动化规则</h2></div>
      : loading ? <p role="status">正在读取自动化规则…</p>
        : <div className="auto-empty panel">
          <GitBranch size={28} /><h2>还没有自动化规则</h2>
          <p>选择项目、流程与触发条件，保存后即可手动运行。</p>
          <button className="btn btn-primary" onClick={props.projects.length ? () => setRecipe(true) : createFirstProject}>{props.projects.length ? '从目标开始' : '新建项目'}</button>
        </div>}
    {rules.length > limit && <button className="btn btn-secondary auto-more" onClick={() => setLimit(value => value + 20)}>再显示20项</button>}
    <RememberedDetails rememberKey={'workspace:' + props.workspaceId + ':automation-advanced-form'} className="auto-reference">
      <summary>流程管理与运行说明</summary>
      <div className="auto-detail-actions">
        <button className="btn btn-secondary" onClick={() => props.navigate('workflows')}>编辑流程模板</button>
        <button className="btn btn-secondary" onClick={() => setRecipe(true)}>从目标建立流程</button>
        <button className="btn btn-secondary" onClick={() => setNatural(true)}>高级表单搭建</button>
      </div>
      <p>定时和资料事件在桌面应用运行时触发。停用规则会取消未派工的队列，已开始的任务可单独取消。</p>
    </RememberedDetails>
    {showMemory && <ModalPortal onClose={closeMemory}><div className="auto-modal-backdrop">
      <section className="auto-modal" role="dialog" aria-modal="true" aria-labelledby="auto-memory-title">
        <header><h2 id="auto-memory-title">已确认记忆</h2><button className="btn-icon" aria-label="关闭已确认记忆" onClick={closeMemory}><X size={18} /></button></header>
        <div className="auto-memory-list">
          {snapshot.memories.length ? snapshot.memories.slice(0, memoryLimit).map(memory => <article className="panel" key={memory.id}>
            <header><strong>{projectName(memory.projectId)}</strong><small>{new Date(memory.createdAt).toLocaleString('zh-CN')}</small></header>
            <p>{memory.note}</p><small>{memory.action === 'reject' ? '停止任务时保存' : '处理任务时保存'}</small>
          </article>) : <p role="status">还没有已确认记忆。可以在任务中心处理待办时保存项目偏好。</p>}
          {snapshot.memories.length > memoryLimit && <button className="btn btn-secondary auto-more" onClick={() => setMemoryLimit(value => value + 20)}>再显示20条记忆</button>}
        </div>
      </section>
    </div></ModalPortal>}
    {editor && <AutomationRuleEditor props={props} initial={editor.value} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); void refresh(); }} />}
    {natural && <NaturalAutomationComposer key={props.workspaceId} props={props} onClose={() => setNatural(false)} onSaved={() => { void refresh(); }} />}
    {readinessRule && <AutomationReadinessDialog key={`${props.workspaceId}:${readinessRule.id}`} props={props} rule={readinessRule}
      onClose={() => setReadinessRuleId('')} onSaved={() => { void refresh(); }} onRun={job => {
        setReadinessRuleId('');
        void refresh(true).then(() => followJob(job));
      }} />}
    {recipe && <AutomationRecipeEditor props={props} initialProjectId={recipeProjectId} onClose={() => { setRecipe(false); setRecipeProjectId(''); }}
      onCreated={(projectId, name, input) => { awaitingRecipe.current = { projectId, name, input }; setRecipe(false); setRecipeProjectId(''); }} />}
  </div>;
}
