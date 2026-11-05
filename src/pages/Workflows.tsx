import { RememberedDetails } from '../components/RememberedDetails';
import { BatchProductionPanel } from '../components/BatchProductionPanel';
import { workflowConfigurationSummary } from '../lib/workflow-library';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Copy, FileText, GitBranch, Layers3, Pencil, Play, Plus, Search, ShieldCheck, Sparkles, WandSparkles, AlertCircle } from 'lucide-react';
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
  const [visibleWorkflowCount, setVisibleWorkflowCount] = useState(20);
  const [editor, setEditor] = useState<{ draft: WorkflowDraft; id?: string; resume?: RunContext } | null>(null);
  const [toRun, setToRun] = useState<{ workflow: WorkflowDefinition; context?: RunContext } | null>(null);
  const [pendingRun, setPendingRun] = useState<{ workflowId: string; context: RunContext } | null>(null);
  const previousWorkspace = useRef(props.workspaceId);
  const { workflows, categories } = props.configuration;
  const choices = categoryOptions(categories);
  const filtered = useMemo(() => workflows.filter(workflow => `${workflow.name} ${workflow.description}`.toLowerCase().includes(query.trim().toLowerCase()) && (outputKind === 'all' || workflow.outputKind === outputKind) && (category === 'all' || (category === 'none' ? !workflow.businessCategoryId : workflow.businessCategoryId === category || categories.some(item => item.id === workflow.businessCategoryId && item.parentId === category)))), [workflows, categories, query, category, outputKind]);
  useEffect(() => { setVisibleWorkflowCount(20); }, [props.workspaceId, query, category, outputKind]);
  useEffect(() => { if (previousWorkspace.current === props.workspaceId) return; previousWorkspace.current = props.workspaceId; setTab('library'); setQuery(''); setCategory('all'); setOutputKind('all'); setEditor(null); setToRun(null); setPendingRun(null); }, [props.workspaceId]);
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
  return <div className="wf-page wf-library-page"><div className="page-heading"><div><p className="resource-eyebrow">MAKE GOOD WORK REPEATABLE</p><h1 className="page-title">我的工作流</h1><p className="page-description">保存常用步骤。下次只需选择项目、填写本次需求，再开始制作。</p></div><button className="btn btn-primary" onClick={() => setEditor({ draft: blankWorkflow(props) })}><Plus size={16} />新建工作流</button></div>
    <div className="wf-tabs-row"><div className="tabs wf-tabs"><button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><Layers3 size={15} />我的流程<span>{workflows.length}</span></button><button className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}>批量制作</button></div><span className="wf-workspace-note"><ShieldCheck size={13} />{props.workspace.name}</span></div>
    {tab === 'batch' ? <BatchProductionPanel workspaceId={props.workspaceId} workflows={workflows} projects={props.projects} configuration={props.configuration} ledger={props.ledger} notify={props.notify} onProjectsCreated={props.onBatchProjectsCreated} onOpenProject={project => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} /> : <><RememberedDetails rememberKey={`workspace:${props.workspaceId}:workflow-starters`} className="wf-starter-disclosure" defaultOpen={!workflows.length}><summary><Sparkles size={16} />从示例开始<span>先保存，再运行；不会立即产生费用</span></summary><div className="wf-starters"><button onClick={() => setEditor({ draft: blankWorkflow(props) })}><span><Plus size={21} /></span><div><strong>从空白开始</strong><small>自由组合你的工作步骤</small></div><ArrowRight size={15} /></button><button onClick={() => setEditor({ draft: exampleWorkflow('document', props) })}><span className="wf-starter-blue"><FileText size={21} /></span><div><strong>图文演示示例</strong><small>配图 → 正文 → PPT成品 → 检查</small></div><ArrowRight size={15} /></button><button onClick={() => setEditor({ draft: exampleWorkflow('product', props) })}><span className="wf-starter-peach"><WandSparkles size={21} /></span><div><strong>商品宣传示例</strong><small>卖点 → 视觉 → 检查 → 交付</small></div><ArrowRight size={15} /></button></div></RememberedDetails><div className="wf-library-toolbar"><label className="wf-search"><Search size={16} /><input aria-label="搜索工作流" placeholder="搜索工作流名称或说明…" value={query} onChange={event => setQuery(event.target.value)} /></label><Select className="field" aria-label="筛选工作流分类" value={category} onValueChange={setCategory} options={[{ value: 'all', label: '全部业务分类' }, { value: 'none', label: '未分类' }, ...choices.map(item => ({ value: item.id, label: item.label }))]} /><Select className="field" aria-label="筛选工作流作品类型" value={outputKind} onValueChange={setOutputKind} options={[{ value: 'all', label: '全部作品类型' }, ...(['ppt', 'word', 'excel', 'image'] as const).map(kind => ({ value: kind, label: KIND_LABEL[kind] }))]} /><span>{filtered.length} 个流程</span></div>
      {filtered.length ? <div className="wf-library-list">{filtered.slice(0, visibleWorkflowCount).map(workflow => {
        const summary = workflowConfigurationSummary(workflow, props.configuration);
        const matches = props.projects.filter(project => project.kind === workflow.outputKind);
        return <article className="panel wf-flow-row" key={workflow.id}>
          <header><span className="wf-flow-icon"><StepIcon kind={workflow.outputKind === 'image' ? 'image-generation' : 'text'} size={22} /></span><div><h2>{workflow.name}</h2><p>{workflow.description || '按自己的习惯安排创作步骤。'}</p></div><span className="wf-output-kind">{KIND_LABEL[workflow.outputKind]}</span></header>
          <ol className="wf-readable-sequence" aria-label={`${workflow.name}的步骤`}>{summary.enabled.slice(0, 5).map((step, index) => <li key={step.id}><span>{index + 1}</span>{step.name}</li>)}{summary.enabled.length > 5 && <li>另 {summary.enabled.length - 5} 步</li>}</ol>
          <div className="wf-flow-readiness"><span className={summary.ready ? 'ready' : 'needs-setup'}>{summary.ready ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{summary.ready ? '本地配置已就绪' : summary.issues[0].message}</span><small>{summary.ready ? '运行时自动预检接口与输入' : summary.issues.length > 1 ? `另有 ${summary.issues.length - 1} 项待设置` : '运行前可以直接补全'}</small></div>
          <footer><span>{choices.find(item => item.id === workflow.businessCategoryId)?.label || '未分类'} · {summary.enabled.length} 步</span><button className="btn-icon" aria-label={`复制工作流 ${workflow.name}`} title="保存一份副本" onClick={() => props.configuration.duplicateWorkflow(workflow.id)}><Copy size={15} /></button>{props.onAutomateWorkflow && <button className="btn btn-ghost" disabled={!matches.length} onClick={() => props.onAutomateWorkflow?.(workflow.id)}><GitBranch size={14} />自动触发</button>}<button className="btn btn-secondary" onClick={() => setEditor({ draft: structuredClone(workflow), id: workflow.id })}><Pencil size={14} />编辑流程</button><button className="btn btn-primary" onClick={() => { if (!matches.length) { const workspaceId = props.workspaceId; props.onCreateProject(workflow.outputKind, { onCreated: () => { if (previousWorkspace.current === workspaceId) setToRun({ workflow: summary.workflow }); } }); return; } setToRun({ workflow: summary.workflow }); }}><Play size={14} />{matches.length ? '使用此流程' : '先创建项目'}</button></footer>
        </article>;
      })}{filtered.length > visibleWorkflowCount && <div className="wf-library-load-more"><span>已显示 {Math.min(visibleWorkflowCount, filtered.length)} / {filtered.length} 个流程</span><button className="btn btn-secondary" onClick={() => setVisibleWorkflowCount(value => value + 20)}>再显示 {Math.min(20, filtered.length - visibleWorkflowCount)} 个流程</button></div>}</div> : <div className="panel wf-empty"><GitBranch size={35} /><h3>{query || category !== 'all' || outputKind !== 'all' ? '没有找到匹配的工作流' : '把你的第一个流程搭起来'}</h3><p>{query || category !== 'all' || outputKind !== 'all' ? '试试其他关键词或业务分类。' : '选择上方示例调整，或从空白开始。保存后可反复使用，模型和 Key 会优先带入可用配置。'}</p><button className="btn btn-secondary" onClick={() => { if (query || category !== 'all' || outputKind !== 'all') { setQuery(''); setCategory('all'); setOutputKind('all'); } else setEditor({ draft: blankWorkflow(props) }); }}>{query || category !== 'all' || outputKind !== 'all' ? '清除筛选' : '新建我的工作流'}</button></div>}</>}
    <div className="wf-page-note"><ShieldCheck size={14} /><span>保存流程与填写参数不调用模型。真实运行前会核对接口能力与凭证；当前未适配的协议会阻止执行，不代表所有供应商和模态已经联通。</span></div>{editor && <WorkflowEditor props={props} initial={editor.draft} workflowId={editor.id} initialStepId={editor.resume?.focusStepId} initialField={editor.resume?.focusField} onClose={() => { if (editor.id && editor.resume) setPendingRun({ workflowId: editor.id, context: editor.resume }); setEditor(null); }} onSaved={editor.id && editor.resume ? () => setPendingRun({ workflowId: editor.id!, context: editor.resume! }) : !editor.id ? () => { setTab('library'); setQuery(''); setCategory('all'); setOutputKind('all'); setVisibleWorkflowCount(20); } : undefined} />}{toRun && <RunWorkflowDialog props={props} workflow={toRun.workflow} initial={toRun.context} onClose={() => setToRun(null)} onStarted={() => { setToRun(null); props.navigate('activity'); }} onEdit={context => { setEditor({ draft: structuredClone(toRun.workflow), id: toRun.workflow.id, resume: context }); setToRun(null); }} />}
  </div>;
}
