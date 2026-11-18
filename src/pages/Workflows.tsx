import { RememberedDetails } from '../components/RememberedDetails';
import { BatchProductionPanel } from '../components/BatchProductionPanel';
import { workflowConfigurationSummary } from '../lib/workflow-library';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, Copy, FileText, GitBranch, Layers3, Pencil, Play, Plus, Search, Sparkles, WandSparkles, AlertCircle } from 'lucide-react';
import type { WorkflowDefinition, WorkflowDraft } from '../configuration-types';
import { Select } from '../components/Select';
import type { PageProps } from '../types';
import { KIND_LABEL } from '../data';
import './workflows.css';
import './resource-runtime-workspaces.css';
import { StepIcon, categoryOptions, type RunContext } from '../components/workflow-shared';
import { WorkflowEditor, blankWorkflow, exampleWorkflow } from '../components/WorkflowEditor';
import { RunWorkflowDialog } from '../components/RunWorkflowDialog';
export { WorkflowEditor, blankWorkflow, exampleWorkflow, switchNewWorkflowOutput } from '../components/WorkflowEditor';
export { RunWorkflowDialog } from '../components/RunWorkflowDialog';
export { WorkflowRunCard } from '../components/WorkflowRunCard';
export type { RunContext } from '../components/workflow-shared';

export function Workflows(props: PageProps) {
  const [tab, setTab] = useState<'library' | 'batch'>('library');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [outputKind, setOutputKind] = useState('all');
  const [expandedWorkflowId, setExpandedWorkflowId] = useState('');
  const [visibleWorkflowCount, setVisibleWorkflowCount] = useState(20);
  const [editor, setEditor] = useState<{ draft: WorkflowDraft; id?: string; resume?: RunContext } | null>(null);
  const [toRun, setToRun] = useState<{ workflow: WorkflowDefinition; context?: RunContext } | null>(null);
  const [pendingRun, setPendingRun] = useState<{ workflowId: string; context: RunContext } | null>(null);
  const previousWorkspace = useRef(props.workspaceId);
  const { workflows, categories } = props.configuration;
  const choices = categoryOptions(categories);
  const filtered = useMemo(() => workflows.filter(workflow => `${workflow.name} ${workflow.description}`.toLowerCase().includes(query.trim().toLowerCase()) && (outputKind === 'all' || workflow.outputKind === outputKind) && (category === 'all' || (category === 'none' ? !workflow.businessCategoryId : workflow.businessCategoryId === category || categories.some(item => item.id === workflow.businessCategoryId && item.parentId === category)))), [workflows, categories, query, category, outputKind]);
  useEffect(() => { setVisibleWorkflowCount(20); }, [props.workspaceId, query, category, outputKind]);
  useEffect(() => { if (previousWorkspace.current === props.workspaceId) return; previousWorkspace.current = props.workspaceId; setTab('library'); setQuery(''); setCategory('all'); setOutputKind('all'); setExpandedWorkflowId(''); setEditor(null); setToRun(null); setPendingRun(null); }, [props.workspaceId]);
  useEffect(() => {
    const target = props.searchTarget; if (!target || target.kind !== 'workflow') return;
    if (target.workspaceId && target.workspaceId !== props.workspaceId) { props.onSearchTargetConsumed?.(target.token); return; }
    const workflow = workflows.find(item => item.id === target.id && item.workspaceId === props.workspaceId);
    setTab('library'); setQuery(target.name); setCategory('all'); setOutputKind('all'); setVisibleWorkflowCount(20);
    if (workflow) setEditor({ draft: structuredClone(workflow), id: workflow.id });
    else props.notify('此流程已移除或不属于当前工作区，请重新搜索。', 'info');
    props.onSearchTargetConsumed?.(target.token);
  }, [props.searchTarget?.token, props.workspaceId]);
  useEffect(() => {
    if (!pendingRun) return;
    const workflow = workflows.find(item => item.id === pendingRun.workflowId);
    if (!workflow) return;
    setToRun({ workflow, context: pendingRun.context }); setPendingRun(null);
  }, [pendingRun, workflows]);
  return <div className="wf-page wf-library-page"><div className="page-heading"><h1 className="page-title">我的工作流</h1><button className="btn btn-primary" onClick={() => setEditor({ draft: blankWorkflow(props) })}><Plus size={16} />新建工作流</button></div>
    <div className="wf-tabs-row"><div className="tabs wf-tabs" role="group" aria-label="流程模板视图"><button aria-pressed={tab === 'library'} className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><Layers3 size={15} />我的流程<span>{workflows.length}</span></button><button aria-pressed={tab === 'batch'} className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}>批量制作</button></div></div>
    {tab === 'batch' ? <BatchProductionPanel workspaceId={props.workspaceId} workflows={workflows} projects={props.projects} configuration={props.configuration} ledger={props.ledger} notify={props.notify} onProjectsCreated={props.onBatchProjectsCreated} onOpenProject={project => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} /> : <><RememberedDetails rememberKey={`workspace:${props.workspaceId}:workflow-starters`} className="wf-starter-disclosure" defaultOpen={!workflows.length}><summary><Sparkles size={16} />从示例开始</summary><div className="wf-starters"><button onClick={() => setEditor({ draft: blankWorkflow(props) })}><span><Plus size={21} /></span><div><strong>从空白开始</strong><small>自由组合你的工作步骤</small></div><ArrowRight size={15} /></button><button onClick={() => setEditor({ draft: exampleWorkflow('document', props) })}><span className="wf-starter-blue"><FileText size={21} /></span><div><strong>图文演示示例</strong><small>配图 → 正文 → PPT成品 → 检查</small></div><ArrowRight size={15} /></button><button onClick={() => setEditor({ draft: exampleWorkflow('product', props) })}><span className="wf-starter-peach"><WandSparkles size={21} /></span><div><strong>商品宣传示例</strong><small>卖点 → 视觉 → 检查 → 交付</small></div><ArrowRight size={15} /></button></div></RememberedDetails><div className="wf-library-toolbar"><label className="wf-search"><Search size={16} /><input aria-label="搜索工作流" placeholder="搜索工作流名称或说明…" value={query} onChange={event => setQuery(event.target.value)} /></label><Select className="field" aria-label="筛选工作流分类" value={category} onValueChange={setCategory} options={[{ value: 'all', label: '全部业务分类' }, { value: 'none', label: '未分类' }, ...choices.map(item => ({ value: item.id, label: item.label }))]} /><Select className="field" aria-label="筛选工作流作品类型" value={outputKind} onValueChange={setOutputKind} options={[{ value: 'all', label: '全部作品类型' }, ...(['ppt', 'word', 'excel', 'image'] as const).map(kind => ({ value: kind, label: KIND_LABEL[kind] }))]} /><span>{filtered.length} 个流程</span></div>
      {filtered.length ? <div className="wf-library-list">{filtered.slice(0, visibleWorkflowCount).map(workflow => {
        const summary = workflowConfigurationSummary(workflow, props.configuration);
        const hasProject = props.projects.some(project => project.kind === workflow.outputKind);
        const expanded = expandedWorkflowId === workflow.id;
        const detailsId = `workflow-details-${workflow.id}`;
        const categoryLabel = choices.find(item => item.id === workflow.businessCategoryId)?.label || '未分类';
        function openRun() {
          if (hasProject) { setToRun({ workflow: summary.workflow }); return; }
          const workspaceId = props.workspaceId;
          props.onCreateProject(workflow.outputKind, { quick: true, initial: { name: workflow.name }, onCreated: project => {
            if (previousWorkspace.current === workspaceId && project.workspaceId === workspaceId) {
              setToRun({ workflow: summary.workflow, context: { projectId: project.id, input: project.description } });
            }
          } });
        }
        return <article className="panel wf-flow-row" key={workflow.id}>
          <div className="wf-template-main">
            <span className="wf-flow-icon"><StepIcon kind={workflow.outputKind === 'image' ? 'image-generation' : 'text'} size={19} /></span>
            <div className="wf-template-title">
              <h2>{workflow.name}</h2>
              <div className="wf-template-meta"><span>{KIND_LABEL[workflow.outputKind]}</span><span>{categoryLabel}</span><span>{summary.enabled.length} 步</span><span className={summary.ready ? 'ready' : 'needs-setup'}>{summary.ready ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{summary.ready ? '配置就绪' : '待设置'}</span></div>
            </div>
            <div className="wf-template-actions">
              <button type="button" className="btn btn-ghost" aria-label={`${expanded ? '收起' : '查看'}流程详情 ${workflow.name}`} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpandedWorkflowId(expanded ? '' : workflow.id)}>
                {expanded ? '收起' : '详情'}<ChevronDown size={14} />
              </button>
              <button type="button" className="btn btn-primary" onClick={openRun}><Play size={14} />{hasProject ? '使用此流程' : '先创建项目'}</button>
            </div>
          </div>
          {expanded && <div id={detailsId} className="wf-template-detail">
            {workflow.description && <p>{workflow.description}</p>}
            {summary.enabled.length > 0 && <ol className="wf-readable-sequence" aria-label={`${workflow.name}的步骤`}>{summary.enabled.map((step, index) => <li key={step.id}><span>{index + 1}</span>{step.name}</li>)}</ol>}
            {!summary.ready && <ul className="wf-template-issues">{summary.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
            <div className="wf-template-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditor({ draft: structuredClone(workflow), id: workflow.id })}><Pencil size={14} />编辑流程</button>
              {props.onAutomateWorkflow && <button type="button" className="btn btn-ghost" disabled={!hasProject} onClick={() => props.onAutomateWorkflow?.(workflow.id)}><GitBranch size={14} />自动触发</button>}
              <button type="button" className="btn btn-ghost" aria-label={`复制工作流 ${workflow.name}`} onClick={() => props.configuration.duplicateWorkflow(workflow.id)}><Copy size={15} />复制</button>
            </div>
          </div>}
        </article>;
      })}{filtered.length > visibleWorkflowCount && <div className="wf-library-load-more"><span>已显示 {Math.min(visibleWorkflowCount, filtered.length)} / {filtered.length} 个流程</span><button className="btn btn-secondary" onClick={() => setVisibleWorkflowCount(value => value + 20)}>再显示 {Math.min(20, filtered.length - visibleWorkflowCount)} 个流程</button></div>}</div> : <div className="panel wf-empty"><GitBranch size={35} /><h3>{query || category !== 'all' || outputKind !== 'all' ? '没有找到匹配的工作流' : '把你的第一个流程搭起来'}</h3><p>{query || category !== 'all' || outputKind !== 'all' ? '试试其他关键词或业务分类。' : '选择上方示例调整，或从空白开始。保存后可反复使用，模型和 Key 会优先带入可用配置。'}</p><button className="btn btn-secondary" onClick={() => { if (query || category !== 'all' || outputKind !== 'all') { setQuery(''); setCategory('all'); setOutputKind('all'); } else setEditor({ draft: blankWorkflow(props) }); }}>{query || category !== 'all' || outputKind !== 'all' ? '清除筛选' : '新建我的工作流'}</button></div>}</>}
    {editor && <WorkflowEditor props={props} initial={editor.draft} workflowId={editor.id} initialStepId={editor.resume?.focusStepId} initialField={editor.resume?.focusField} onClose={() => { if (editor.id && editor.resume) setPendingRun({ workflowId: editor.id, context: editor.resume }); setEditor(null); }} onSaved={editor.id && editor.resume ? () => setPendingRun({ workflowId: editor.id!, context: editor.resume! }) : !editor.id ? () => { setTab('library'); setQuery(''); setCategory('all'); setOutputKind('all'); setVisibleWorkflowCount(20); } : undefined} />}{toRun && <RunWorkflowDialog props={props} workflow={toRun.workflow} initial={toRun.context} onClose={() => setToRun(null)} onStarted={() => { setToRun(null); props.navigate('activity'); }} onEdit={context => { setEditor({ draft: structuredClone(toRun.workflow), id: toRun.workflow.id, resume: context }); setToRun(null); }} />}
  </div>;
}
