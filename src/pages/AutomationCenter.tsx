import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, GitBranch, Play, Plus, RefreshCw, ShieldCheck, Square, WandSparkles } from 'lucide-react';
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
import './automation.css';
import './resource-runtime-workspaces.css';

const triggerLabel = { manual: '按需手动运行', schedule: '定时触发', 'reference-imported': '参考资料导入后', 'run-completed': '指定流程完成后' };
const jobLabel = { queued: '排队中', dispatching: '正在派工', running: '执行中', decision: '需要你处理', complete: '已完成', cancelled: '已取消' };
export function AutomationCenter(props: PageProps) {
  const { bridge, snapshot, refresh, loading } = useAutomationCenter(props.workspaceId);
  const [tab, setTab] = useRememberedString(`workspace:${props.workspaceId}:automation-tab`, 'rules');
  const [editor, setEditor] = useState<{ value?: Partial<AutomationRule> }>(), [recipe, setRecipe] = useState(false), [pending, setPending] = useState(''), [error, setError] = useState(''), [limit, setLimit] = useState(20);
  const [notes, setNotes] = useState<Record<string, string>>({}), [remember, setRemember] = useState<Record<string, boolean>>({});
  const [selectedRun, setSelectedRun] = useState('');
  const [natural, setNatural] = useState(false);
  const [readinessRuleId, setReadinessRuleId] = useState('');
  const actionPending = useRef(false), scope = useRef(props.workspaceId); scope.current = props.workspaceId;
  const awaitingRecipe = useRef<{ projectId: string; name: string; input: string } | undefined>(undefined);
  useEffect(() => { setEditor(undefined); setRecipe(false); setNatural(false); setReadinessRuleId(''); setSelectedRun(''); setNotes({}); setRemember({}); setError(''); setLimit(20); awaitingRecipe.current = undefined; }, [props.workspaceId]);
  useEffect(() => { setLimit(20); }, [tab]);
  useEffect(() => {
    const intent = props.automationIntent; if (!intent || intent.workspaceId !== props.workspaceId) return;
    const workflow = props.configuration.workflows.find(workflow => workflow.id === intent.workflowId);
    if (workflow) { setTab('rules'); setEditor({ value: { projectId: intent.projectId, workflowId: workflow.id, input: intent.input, name: `${workflow.name} · 自动化` } }); }
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
  const decisions = snapshot.decisions.filter(decision => !decision.resolvedAt), projectName = (id: string) => props.projects.find(project => project.id === id)?.name || '原项目', workflowName = (id: string) => props.configuration.workflows.find(workflow => workflow.id === id)?.name || '原流程';
  function createFirstProject() {
    const workspaceId = props.workspaceId;
    props.onCreateProject('word', { onCreated: () => { if (scope.current === workspaceId) setRecipe(true); } });
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
  return <div className="auto-page"><header className="auto-heading"><div><p className="auto-eyebrow">AUTOMATIC, WHEN YOU NEED IT</p><h1>自动化中心</h1><p>由你决定何时运行。每次执行都有记录，需要判断时在这里处理。</p></div><div><button className="btn btn-secondary" onClick={() => props.navigate('overview')}><WandSparkles size={16} />与 AI 搭建流程</button><button className="btn btn-primary" disabled={!bridge || !snapshot.available} onClick={() => setEditor({})}><Plus size={16} />新建自动运行</button></div></header>
    {!props.projects.length && <div className="auto-status-note"><span>先创建一个项目，用独立文件夹保存自动化产物与版本，也可以在配置流程时直接新建。</span><button className="btn btn-primary" onClick={createFirstProject}>新建项目</button></div>}
    {(!bridge || snapshot.issue) && <div className="auto-status-note" role="alert"><ShieldCheck size={18} /><span>{snapshot.issue || '浏览器可以查看配置；真实自动化需要 Windows 桌面后台。'}</span>{bridge && <button className="btn btn-secondary" disabled={!!pending} onClick={() => { void act('reload', () => bridge.reload()); }}>重新读取</button>}</div>}
    <div className="auto-tabs" role="tablist" aria-label="自动化页面">{[['rules', '自动化规则', snapshot.rules.length], ['decisions', '需要我处理', decisions.length], ['history', '执行记录', snapshot.jobs.length], ['memory', '已确认记忆', snapshot.memories.length]].map(([value, label, count]) => <button role="tab" key={String(value)} aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(String(value))}>{label}<span>{count}</span></button>)}<button className="btn-icon" aria-label="刷新自动化记录" disabled={loading} onClick={() => { void refresh(); }}><RefreshCw size={16} /></button></div>
    {error && <p className="auto-error" role="alert">{error}</p>}
    {tab === 'rules' && <><div className="auto-list-heading"><span>手动流程点击“运行一次”即可；定时或资料触发的流程需要先启用。</span><button className="text-button" onClick={() => props.navigate('workflows')}>编辑工作流步骤</button></div>{snapshot.rules.length ? <div className="auto-rule-grid">{snapshot.rules.slice(0, limit).map(rule => <article className="panel auto-rule-card" key={rule.id}><header><span className={rule.trigger === 'manual' ? 'auto-state' : rule.enabled ? 'auto-state enabled' : 'auto-state'}>{rule.trigger === 'manual' ? '手动运行' : rule.enabled ? '已启用' : '未启用'}</span><div><button className="btn btn-ghost" disabled={!!pending} onClick={() => setReadinessRuleId(rule.id)}>运行设置</button><button className="btn btn-ghost" disabled={!!pending} onClick={() => setEditor({ value: rule })}>编辑规则</button></div></header><h2>{rule.name}</h2>{needsSetup(rule) && <span className="auto-state">已创建 · 运行前待补充</span>}<p>{projectName(rule.projectId)} · {workflowName(rule.workflowId)}</p><div className="auto-rule-trigger"><Clock3 size={15} />{triggerLabel[rule.trigger]}{rule.trigger === 'schedule' && ` · 每 ${rule.intervalMinutes} 分钟`}</div><p className="auto-rule-goal">{rule.input}</p><footer>{rule.trigger !== 'manual' && <button className="btn btn-secondary" disabled={!bridge || !!pending} onClick={() => { if (!rule.enabled && needsSetup(rule)) { setReadinessRuleId(rule.id); return; } if (bridge) void act(rule.id, () => bridge.setEnabled({ id: rule.id, enabled: !rule.enabled }), rule.enabled ? '规则已停用，未派工的队列已取消。' : '规则已启用。'); }}>{rule.enabled ? '停用新触发' : '启用规则'}</button>}<button className="btn btn-primary" disabled={!bridge || !!pending} onClick={() => { if (needsSetup(rule)) { setReadinessRuleId(rule.id); return; } if (bridge) void act(rule.id, () => bridge.trigger({ ruleId: rule.id }), '任务已接收，可在执行记录查看。'); }}><Play size={15} />{pending === rule.id ? '正在处理…' : needsSetup(rule) ? '补齐并运行' : rule.trigger === 'manual' ? '运行一次' : '立即运行'}</button></footer></article>)}</div> : <div className="auto-empty panel"><GitBranch size={34} /><h2>先把常用制作方式变成完整流程</h2><p>写清目标和验收要求，再选触发条件。首次可先手动试运行，确认后启用定时或资料事件。</p><button className="btn btn-primary" onClick={() => setRecipe(true)}>从目标开始</button></div>}</>}
    {tab === 'decisions' && (decisions.length ? <div className="auto-decision-list">{decisions.slice(0, limit).map(decision => { const job = snapshot.jobs.find(job => job.id === decision.jobId), entries = props.ledger.filter(entry => entry.workflowRunId === decision.runId); return <article className="panel auto-decision-card" key={decision.id}><header><ShieldCheck size={20} /><div><h2>{decision.title}</h2><small>{projectName(decision.projectId)} · {new Date(decision.createdAt).toLocaleString('zh-CN')}</small></div></header><p>{decision.detail}</p>{entries.length > 0 && <div className="auto-cost">已记录调用费用 <CostTotal summary={summarizeCosts(entries)} /></div>}<label>本次决定或需要保留的偏好<textarea aria-label={`待办备注 ${decision.id}`} rows={2} maxLength={3000} value={notes[decision.id] || ''} onChange={event => setNotes(value => ({ ...value, [decision.id]: event.target.value }))} placeholder="例如：沿用已经确认的产品名称；不填写 Key。" /></label><label className="auto-enable"><input type="checkbox" checked={remember[decision.id] || false} onChange={event => setRemember(value => ({ ...value, [decision.id]: event.target.checked }))} />将此备注保存为本项目已确认记忆</label><footer><button className="btn btn-secondary" onClick={() => decision.runId ? setSelectedRun(decision.runId) : props.navigate('workflows', decision.projectId)}>查看任务和结果</button><button className="btn btn-ghost" disabled={!bridge || !!pending} onClick={() => { if (bridge) void act(decision.id, () => bridge.resolve({ id: decision.id, action: 'refresh' })); }}>仅读取最新状态</button><button className="btn btn-ghost" disabled={!bridge || !!pending} onClick={() => { if (bridge) void act(decision.id, () => bridge.resolve({ id: decision.id, action: 'reject', note: notes[decision.id], remember: remember[decision.id] })); }}>拒绝并停止</button><button className="btn btn-primary" disabled={!bridge || !!pending || !job} onClick={() => { if (bridge) void act(decision.id, () => bridge.resolve({ id: decision.id, action: decision.kind === 'review' ? 'approve' : 'continue', note: notes[decision.id], remember: remember[decision.id] })); }}>{decision.kind === 'review' ? '检查后继续流程' : '明确继续 · 可能新增调用费'}</button></footer></article>; })}</div> : <div className="auto-empty panel"><CheckCircle2 size={34} /><h2>当前没有需要你处理的事项</h2><p>普通执行无需一直盯着；缺资料、失败或人工验收会集中显示在这里。</p></div>)}
    {tab === 'history' && (snapshot.jobs.length ? <div className="auto-history-list">{snapshot.jobs.slice(0, limit).map(job => { const rule = snapshot.rules.find(rule => rule.id === job.ruleId); return <article className="panel auto-history-row" key={job.id}><div><strong>{rule?.name || '原自动化规则'}</strong><p>{projectName(job.projectId)} · {new Date(job.createdAt).toLocaleString('zh-CN')}</p>{job.error && <small>{job.error}</small>}</div><span className={`auto-state ${job.status === 'complete' ? 'enabled' : ''}`}>{jobLabel[job.status]}</span><div><button className="btn btn-ghost" onClick={() => job.runId ? setSelectedRun(job.runId) : props.navigate('workflows', job.projectId)}>查看{job.runId ? '实际任务' : '流程'}</button>{['queued', 'dispatching', 'running', 'decision'].includes(job.status) && <button className="btn btn-secondary" disabled={!bridge || !!pending} onClick={() => { if (bridge) void act(job.id, () => bridge.cancelJob(job.id)); }}><Square size={14} />取消此项</button>}</div></article>; })}</div> : <div className="auto-empty panel"><Clock3 size={34} /><h2>规则第一次触发后，会留下执行记录</h2><p>事件、派工和实际模型任务相互关联，重复事件不会重新收费执行。</p></div>)}
    {tab === 'memory' && <div className="auto-memory-list">{snapshot.memories.length ? snapshot.memories.slice(0, limit).map(memory => <article className="panel" key={memory.id}><header><strong>{projectName(memory.projectId)}</strong><small>{new Date(memory.createdAt).toLocaleString('zh-CN')}</small></header><p>{memory.note}</p><small>来自你明确保存的待办决定 · {memory.action === 'reject' ? '拒绝' : '确认/继续'}</small></article>) : <div className="auto-empty panel"><h2>记忆只记录你明确保存的决定</h2><p>它不会把模型推测、未知事实或整份资料自动当作长期偏好。</p></div>}</div>}
    {Math.max(snapshot.rules.length, decisions.length, snapshot.jobs.length, snapshot.memories.length) > limit && <button className="btn btn-secondary auto-more" onClick={() => setLimit(value => value + 20)}>再显示20项</button>}
    <RememberedDetails rememberKey={`workspace:${props.workspaceId}:automation-advanced-form`} className="auto-reference"><summary>高级：表单搭建与已保存方案</summary><p>常规创建可以在首页直接和 AI 对话。需要逐项填写或读取旧版方案时，仍可使用高级表单。</p><button className="btn btn-secondary" onClick={() => setNatural(true)}>打开高级表单搭建</button></RememberedDetails>
    <RememberedDetails rememberKey="automation:source-and-operation" className="auto-reference"><summary>运行范围与方法来源</summary><p>定时和资料事件在本桌面后台运行时执行。启用规则代表允许该规则按条件调用所选模型；停用取消尚未派工队列，已开始的任务可单独取消。重启后的不确定请求先核对记录，不自动盲目重发。</p><p>参考数字生命卡兹克公开的事件驱动、SOP、独立验收与决策记忆方法，由序作适配实现。公开参考是 Skills/AIHOT；整套私人中台没有作为开源源码导入。</p><code>https://www.woshipm.com/ai/6487627.html</code><code>https://github.com/KKKKhazix/khazix-skills</code></RememberedDetails>
    {editor && <AutomationRuleEditor props={props} initial={editor.value} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); void refresh(); }} />}
    {natural && <NaturalAutomationComposer key={props.workspaceId} props={props} onClose={() => setNatural(false)} onSaved={() => { setTab('rules'); void refresh(); }} />}
    {readinessRule && <AutomationReadinessDialog key={`${props.workspaceId}:${readinessRule.id}`} props={props} rule={readinessRule} onClose={() => setReadinessRuleId('')} onSaved={() => { void refresh(); }} />}
    {selectedRun && <AutomationRunViewer key={`${props.workspaceId}/${selectedRun}`} props={props} runId={selectedRun} onClose={() => setSelectedRun('')} />}
    {recipe && <AutomationRecipeEditor props={props} onClose={() => setRecipe(false)} onCreated={(projectId, name, input) => { awaitingRecipe.current = { projectId, name, input }; setRecipe(false); }} />}
  </div>;
}
