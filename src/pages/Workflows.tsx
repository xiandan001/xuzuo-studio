import { hasManagedDialog } from '../lib/dialog-stack';
import { TaskRunList } from '../components/TaskRunList';
import { BatchProductionPanel } from '../components/BatchProductionPanel';
import { runDetailKey } from '../lib/run-details';
import { ModalPortal } from '../components/ModalPortal';
import { TaskRunActions } from '../components/TaskRunActions';
import { TaskScopeFilter } from '../components/TaskScopeFilter';
import { scopedTaskRuns } from '../lib/task-visibility';
import { workflowConfigurationSummary } from '../lib/workflow-library';
import type { TaskScope } from '../lib/task-visibility';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, AudioLines, Braces, Check, CheckCircle2, CirclePause, Copy, Download, FileText, GitBranch, Image, Layers3, ListOrdered, LoaderCircle, Pencil, Play, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Square, Trash2, Video, WandSparkles, Upload, AlertCircle, Paperclip, Globe2, X } from 'lucide-react';
import type { BusinessCategory, ModelCapability, ModelConfiguration, WorkflowDefinition, WorkflowDraft, WorkflowRun, WorkflowStep, WorkflowStepKind, WorkflowAttempt } from '../configuration-types';
import type { ArtifactMetadata, LivePreflight, LivePreflightIssue } from '../live-types';
import { ArtifactResults } from '../components/ArtifactResults';
import { Select, isSelectInteraction } from '../components/Select';
import { StudioConnectionFields } from '../components/StudioConnectionFields';
import type { PageProps, ProjectKind } from '../types';
import { KIND_LABEL, money, budgetLabel, parseOptionalBudget } from '../data';
import { extractVariables, resolvePrompt } from '../lib/prompt-variables';
import { workflowStepCost } from '../lib/workflows';
import { currentPreflightAccepted, workflowIssues, workflowIssueCanLocate } from '../lib/workflow-preflight';
import { withCreationFoundation } from '../lib/creation-quality';
import { CREATION_PROFILES } from '../lib/creation-profiles';
import { useAutomaticStudioRun } from '../hooks/useAutomaticStudioRun';
import { studioCredential, workflowStepSelection, workflowSelections, workflowPublicError, WORKFLOW_OUTPUT_MIN, WORKFLOW_OUTPUT_MAX } from '../lib/studio-run';
import { CostTotal } from '../components/CostAmount';
import { attemptCostRecord, costPrimary, runCostRecords, summarizeCosts } from '../lib/cost-display';
import './workflows.css';

const STEP_KINDS: { value: WorkflowStepKind; label: string; description: string }[] = [
  { value: 'text', label: '文本创作', description: '整理资料、撰写内容与结构化输出' },
  { value: 'vision', label: '图片理解', description: '检查参考图、内容或画面细节' },
  { value: 'image-generation', label: '图片生成', description: '根据文字需求制作图像' },
  { value: 'image-editing', label: '图片精修', description: '结合参考内容描述图片修改' },
  { value: 'transcription', label: '语音转文字', description: '设计音频转录步骤' },
  { value: 'speech', label: '语音合成', description: '设计文字转语音步骤' },
  { value: 'video-understanding', label: '视频理解', description: '设计视频内容分析步骤' },
  { value: 'video-generation', label: '视频生成', description: '设计视频制作步骤' },
  { value: 'manual-review', label: '人工检查', description: '暂停流程，由你确认再继续' },
  { value: 'export', label: '整理交付', description: '整理当前结果并生成交付文件' },
];
const RUN_LABELS: Record<WorkflowRun['status'], string> = { running: '模拟执行中', paused: '已暂停', 'waiting-review': '等待人工检查', complete: '模拟已完成', cancelled: '已取消', interrupted: '已中断', failed: '执行失败' };
const isModelStep = (kind: WorkflowStepKind): kind is ModelCapability => kind !== 'manual-review' && kind !== 'export';
const kindLabel = (kind: WorkflowStepKind) => STEP_KINDS.find(item => item.value === kind)?.label || kind;
export type RunContext = { projectId?: string; input?: string; attachmentIds?: string[]; attachments?: InputAttachment[]; variables?: Record<string, string>; mode?: 'live' | 'simulation'; focusStepId?: string; focusField?: LivePreflightIssue['field']; replaceWaitingReviewRunId?: string; };
type InputAttachment = Pick<ArtifactMetadata, 'id' | 'name'> & Partial<Pick<ArtifactMetadata, 'mimeType' | 'bytes'>>;

function StepIcon({ kind, size = 17 }: { kind: WorkflowStepKind; size?: number }) {
  const Icon = kind === 'manual-review' ? ShieldCheck : kind === 'export' ? Download : kind.startsWith('image') || kind === 'vision' ? Image : kind.startsWith('video') ? Video : kind === 'speech' || kind === 'transcription' ? AudioLines : FileText;
  return <Icon size={size} />;
}
function availableModels(props: PageProps, kind: WorkflowStepKind): ModelConfiguration[] {
  if (!isModelStep(kind)) return [];
  return props.configuration.models.filter(model => model.enabled && model.capabilities.includes(kind) && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled));
}
function categoryOptions(categories: BusinessCategory[]) {
  const active = categories.filter(category => !category.archived);
  return active.filter(category => !category.parentId).flatMap(parent => [
    { id: parent.id, label: parent.name },
    ...active.filter(category => category.parentId === parent.id).map(child => ({ id: child.id, label: `${parent.name} / ${child.name}` })),
  ]);
}
function makeStep(kind: WorkflowStepKind = 'text'): WorkflowStep {
  return { id: crypto.randomUUID(), name: kindLabel(kind), kind, prompt: '', modelConfigId: undefined, inputSource: 'previous', budgetCents: undefined, enabled: true, maxOutputTokens: kind === 'text' ? CREATION_PROFILES.word.outputTokens : 2048, imageSize: kind === 'video-generation' ? '1280x720' : '1024x1024', imageBackground: 'auto', voice: 'alloy', count: 1 };
}
function normalizeSteps(steps: WorkflowStep[]) {
  const first = steps.findIndex(step => step.enabled);
  return steps.map((step, index) => index === first ? { ...step, inputSource: 'project' as const } : step);
}
export function blankWorkflow(props: PageProps, outputKind: ProjectKind = 'ppt'): WorkflowDraft {
  const content = workflowStepSelection(makeStep(outputKind === 'image' ? 'image-generation' : 'text'), props.configuration);
  const steps = outputKind === 'image' ? [content] : [content, { ...makeStep('export'), name: '生成实际交付文件', contentSourceStepId: content.id }, { ...makeStep('manual-review'), name: '人工检查实际结果' }];
  return { name: '', description: '', outputKind, steps: normalizeSteps(steps) };
}
function sameEmptyDefaultSteps(draft: WorkflowDraft, defaults: WorkflowDraft): boolean {
  if (draft.steps.length !== defaults.steps.length || draft.steps.some(step => step.prompt.trim())) return false;
  const shape = (step: WorkflowStep, contentId: string) => JSON.stringify(Object.entries(step).filter(([key]) => !['id', 'modelConfigId', 'credentialId'].includes(key)).map(([key, value]) => [key, key === 'contentSourceStepId' && value === contentId ? '$content' : value]).sort(([left], [right]) => String(left).localeCompare(String(right))));
  return draft.steps.every((step, index) => shape(step, draft.steps[0].id) === shape(defaults.steps[index], defaults.steps[0].id));
}
export function switchNewWorkflowOutput(props: PageProps, draft: WorkflowDraft, outputKind: ProjectKind, pristine: boolean): WorkflowDraft {
  if (!pristine || !sameEmptyDefaultSteps(draft, blankWorkflow(props, draft.outputKind))) return { ...draft, outputKind };
  return { ...blankWorkflow(props, outputKind), name: draft.name, description: draft.description, businessCategoryId: draft.businessCategoryId };
}
export function exampleWorkflow(kind: 'document' | 'product', props: PageProps): WorkflowDraft {
  if (kind === 'document') {
    const visual = { ...makeStep('image-generation'), name: '制作主题配图', inputSource: 'project' as const, prompt: '依据用户本次需求生成一张适合演示文稿的主题配图。构图清晰、风格统一，不加入无关文字或虚构数据。' };
    const text = { ...makeStep(), name: '编写完整图文演示', inputSource: 'project' as const, documentImageSource: 'previous' as const, prompt: '根据用户本次需求制作一份完整演示文稿。页面有连贯叙事、清晰结论和可直接展示的正文；配图由本地排版加入，不输出图片占位符或猜测图片编号。' };
    return workflowSelections({ name: '图文演示 · 从需求到成品', description: '先生成主题配图，再撰写完整正文，自动排入PPT；打开成品后检查并交付。', outputKind: 'ppt', steps: [visual, text, { ...makeStep('export'), name: '导出可编辑图文PPT', contentSourceStepId: text.id }, { ...makeStep('manual-review'), name: '检查真实成品' }] }, props.configuration);
  }
  const text = { ...makeStep(), name: '提炼商品卖点', inputSource: 'project' as const, prompt: '根据用户本次需求整理商品卖点，保留已提供的规格、材质和数量，不虚构功效与优惠。' };
  const visual = { ...makeStep('image-generation'), name: '制作宣传视觉', prompt: '基于上一步内容和用户要求，设计主体清楚、风格一致的宣传视觉。只使用用户明确给出的文字，不新增虚构宣传数据。' };
  return workflowSelections({ name: '商品宣传 · 从卖点到视觉', description: '把商品信息变成卖点与宣传图，检查细节后交付。', outputKind: 'image', steps: [text, visual, { ...makeStep('manual-review'), name: '人工核对内容与画面' }, { ...makeStep('export'), name: '整理交付内容' }] }, props.configuration);
}

function WorkflowDialog({ title, subtitle, children, footer, onClose, className = '', busy = false }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode; onClose: () => void; className?: string; busy?: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input:not(:disabled):not([aria-hidden="true"]), textarea:not(:disabled), [role="combobox"]:not(:disabled)')?.focus());
    const handle = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if ((event.key === 'Escape' || event.key === 'Tab') && isSelectInteraction(event)) return;
      if (Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1) !== panelRef.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([aria-hidden="true"]), textarea:not(:disabled), [tabindex="0"]') || []).filter(control => control.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handle, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', handle, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <ModalPortal onClose={onClose} busy={busy}><div className="wf-overlay" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}><section ref={panelRef} className={`wf-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><span className="wf-dialog-icon"><GitBranch size={22} /></span><div><h2>{title}</h2><p>{subtitle}</p></div><button className="btn-icon" disabled={busy} aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button></header>{children}{footer && <footer>{footer}</footer>}</section></div></ModalPortal>;
}

function StepSettings({ props, step, index, firstEnabledIndex, priorContentSteps, onChange, focusField, outputKind }: { props: PageProps; outputKind?: ProjectKind; step: WorkflowStep; index: number; firstEnabledIndex: number; priorContentSteps: WorkflowStep[]; onChange: (changes: Partial<WorkflowStep>) => void; focusField?: LivePreflightIssue['field']; }) {
  const settings = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusField) return;
    const labels: Record<string, string> = { modelConfigId: '步骤模型', credentialId: '步骤 API 凭证', connection: '步骤模型', prompt: '步骤提示词', maxOutputTokens: '最大输出 Token 数', count: '工作流图片数量', imageSize: '工作流图片尺寸', inputSource: '步骤输入来源', budgetCents: '步骤金额上限' };
    const timer = window.setTimeout(() => { const control = settings.current?.querySelector<HTMLElement>(`[aria-label="${labels[focusField] || '步骤名称'}"]`); const advanced = control?.closest('details'); if (advanced) advanced.open = true; control?.scrollIntoView({ block: 'center', behavior: 'smooth' }); control?.focus({ preventScroll: true }); }, 40);
    return () => window.clearTimeout(timer);
  }, [step.id, focusField]);
  const models = availableModels(props, step.kind);
  const model = props.configuration.models.find(item => item.id === step.modelConfigId);
  const connection = props.configuration.connections.find(item => item.id === model?.connectionId);
  const credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId);
  const templates = props.prompts.filter(template => template.category === 'general' || (step.kind.startsWith('image') ? template.category === 'image' : step.kind === 'text' ? template.category !== 'image' : true));
  function changeKind(kind: WorkflowStepKind) {
    onChange(workflowStepSelection({ ...step, kind, name: step.name === kindLabel(step.kind) ? kindLabel(kind) : step.name, prompt: isModelStep(kind) ? step.prompt : '', promptTemplateId: undefined, budgetCents: step.budgetCents, contentSourceStepId: undefined, imageSize: kind === 'video-generation' ? '1280x720' : step.imageSize }, props.configuration));
  }
  return <section ref={settings} className="wf-step-settings"><div className="wf-settings-title"><StepIcon kind={step.kind} /><div><h3>第 {index + 1} 步 · {kindLabel(step.kind)}</h3><p>{STEP_KINDS.find(item => item.value === step.kind)?.description}</p></div></div>
    <label className="wf-field"><span>步骤名称</span><input className="field" aria-label="步骤名称" value={step.name} maxLength={60} onChange={event => onChange({ name: event.target.value })} /></label>
    <label className="wf-field"><span>步骤类型</span><Select className="field" aria-label="步骤类型" value={step.kind} onValueChange={value => changeKind(value as WorkflowStepKind)} options={STEP_KINDS} /></label>
    <label className="wf-field"><span>使用哪些内容</span><Select className="field" aria-label="步骤输入来源" value={step.inputSource} onValueChange={value => onChange({ inputSource: value as WorkflowStep['inputSource'] })} options={[{ value: 'project', label: '本次需求与项目资料' }, { value: 'previous', label: '上一步的有效结果', disabled: index === firstEnabledIndex }]} /><small>第一个启用步骤从本次需求开始。</small></label>
    {isModelStep(step.kind) ? <>
      <details className="wf-step-connections" open={!model || !step.credentialId && !model.demo}><summary><span>{model && (step.credentialId || model.demo) ? `已带入：${model.name}` : '选择这一步的模型和 Key'}</span><small>展开调整</small></summary>      <label className="wf-field"><span>使用模型</span><Select className="field" aria-label="步骤模型" value={step.modelConfigId || ''} onValueChange={value => { const next = models.find(item => item.id === value); onChange({ modelConfigId: next?.id, credentialId: next && !next.demo ? studioCredential(props.configuration.credentials, next.connectionId, step.credentialId) : undefined }); }} options={[{ value: '', label: '请选择匹配能力的模型' }, ...models.map(item => ({ value: item.id, label: `${item.name}${item.demo ? ' · 仅模拟' : ''}` }))]} />{!models.length && <small className="wf-warning">没有可用模型。请先到“模型与连接”配置具备{kindLabel(step.kind)}能力的模型。</small>}</label>
      <label className="wf-field"><span>API 凭证</span><Select className="field" aria-label="步骤 API 凭证" value={step.credentialId || ''} disabled={!connection || !!connection.demo} onValueChange={value => onChange({ credentialId: value || undefined })} options={[{ value: '', label: '请选择 API Key' }, ...credentials.map(item => ({ value: item.id, label: `${item.name} · ••••${item.lastFour}` }))]} /><small>{connection?.demo ? '此模型仅支持模拟运行，不需要 API Key。' : '真实模式使用所选凭证，由桌面主进程发送请求；界面不会读取完整 Key。'}</small></label>
      </details>
      <label className="wf-field"><span>从提示词模板开始 <small>可选</small></span><Select className="field" aria-label="步骤提示词模板" value={step.promptTemplateId || ''} onValueChange={value => { const template = templates.find(item => item.id === value); onChange({ promptTemplateId: template?.id, ...(template ? { prompt: template.content } : {}) }); }} options={[{ value: '', label: '自己编写提示词' }, ...templates.map(template => ({ value: template.id, label: template.name }))]} /></label>
      <label className="wf-field"><span>这一步要做什么 <b>*</b></span><textarea className="field" aria-label="步骤提示词" rows={6} value={step.prompt} maxLength={10000} onChange={event => onChange({ prompt: event.target.value, promptTemplateId: undefined })} placeholder="例如：根据资料，整理{{主题}}的内容结构；不要编造未提供的事实。" /><small><Braces size={12} /> 使用 {'{{主题}}'} 等变量，运行前统一填写。</small></label>
      {step.kind === 'text' && (outputKind === 'ppt' || outputKind === 'word') && <label className="wf-field"><span>文档配图</span><Select className="field" aria-label="文档插图来源" value={step.documentImageSource || ''} onValueChange={value => onChange({ documentImageSource: value ? value as 'references' | 'previous' : undefined })} options={[{ value: '', label: '纯文字文稿' }, { value: 'references', label: '排入本次上传的参考图片' }, { value: 'previous', label: '排入上一步生成的图片' }]} /><small>本地自动排版并嵌入实际图片，不额外调用模型。选择上一步图片时，请将生图步骤放在正文步骤之前。</small></label>}
      <details className="wf-advanced-settings"><summary>高级参数 · 输出长度、尺寸与金额上限</summary>
      {(step.kind === 'text' || step.kind === 'vision' || step.kind === 'video-understanding') && <label className="wf-field"><span>最大输出 Token 数</span><input className="field" aria-label="最大输出 Token 数" type="number" min={WORKFLOW_OUTPUT_MIN} max={WORKFLOW_OUTPUT_MAX} step="1" value={step.maxOutputTokens ?? 2048} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value)) onChange({ maxOutputTokens: value }); }} /><small>本工作流支持 16–16384 Token，具体型号可能有更低上限。</small></label>}
      {(step.kind === 'image-generation' || step.kind === 'image-editing') && <div className="wf-image-parameters"><div className="wf-two-fields"><label className="wf-field"><span>图片尺寸</span><Select className="field" aria-label="工作流图片尺寸" value={step.imageSize || '1024x1024'} onValueChange={value => onChange({ imageSize: value })} options={['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'].map(size => ({ value: size, label: size }))} /></label><label className="wf-field"><span>图片数量</span><Select className="field" aria-label="工作流图片数量" value={String(step.count || 1)} onValueChange={value => onChange({ count: Number(value) })} options={[1, 2, 4].map(count => ({ value: String(count), label: `${count} 张` }))} /></label></div><label className="wf-field"><span>背景</span><Select className="field" aria-label="工作流图片背景" value={step.imageBackground || 'auto'} onValueChange={value => onChange({ imageBackground: value as WorkflowStep['imageBackground'] })} options={[{ value: 'auto', label: '自动' }, { value: 'opaque', label: '不透明背景' }, { value: 'transparent', label: '透明背景' }]} /><small>尺寸、数量和透明输出须由该模型实际支持，调用前会预检接口能力。</small></label></div>}
      {step.kind === 'video-generation' && <label className="wf-field"><span>视频尺寸</span><Select className="field" aria-label="工作流视频尺寸" value={['1280x720', '720x1280', '960x960'].includes(step.imageSize || '') ? step.imageSize! : '1280x720'} onValueChange={value => onChange({ imageSize: value })} options={['1280x720', '720x1280', '960x960'].map(size => ({ value: size, label: size }))} /><small>具体服务商、模型及异步接口是否适配，以运行预检为准。</small></label>}
      {step.kind === 'speech' && <label className="wf-field"><span>语音名称</span><input className="field" aria-label="工作流语音名称" maxLength={80} value={step.voice || 'alloy'} onChange={event => onChange({ voice: event.target.value })} placeholder="复制服务商支持的 voice 名称" /><small>填写所选语音模型支持的声音标识。</small></label>}
      <label className="wf-field"><span>本步骤金额上限（元，选填）</span><input className="field" aria-label="步骤金额上限" type="number" min="0" step="0.01" placeholder="选填，留空不设上限" value={step.budgetCents == null ? '' : step.budgetCents / 100} onChange={event => { try { const budgetCents = parseOptionalBudget(event.target.value); event.currentTarget.setCustomValidity(''); onChange({ budgetCents }); } catch (error) { event.currentTarget.setCustomValidity(error instanceof Error ? error.message : '请填写有效金额或留空。'); } }} /><small>留空不限制本步骤，填写 0 表示零上限；实际费用仍按每次调用累计。</small></label>
      </details>
    </> : <div className="wf-human-note"><ShieldCheck size={22} /><h4>{step.kind === 'manual-review' ? '把最后的判断留给自己' : '先核对，再整理交付'}</h4><p>{step.kind === 'manual-review' ? '运行到这里会暂停，等你检查并确认后继续。此步骤不调用模型、不新增模型费用。' : '真实模式会整理当前结果并生成交付文件，是否成功以实际产物为准。此步骤不调用模型。打开成品后仍需核对版式、公式与内容。'}</p></div>}
    {step.kind === 'export' && <label className="wf-field wf-export-source"><span>交付文件的正文来源</span><Select className="field" aria-label="交付正文来源" value={step.contentSourceStepId || ''} onValueChange={value => onChange({ contentSourceStepId: value || undefined })} options={[{ value: '', label: '自动使用最近的正文步骤' }, ...priorContentSteps.map(item => ({ value: item.id, label: item.name }))]} /><small>仅列出前面启用的文本创作或语音转写步骤。自动模式会跳过图片复核等短评。</small>{step.contentSourceStepId && !priorContentSteps.some(source => source.id === step.contentSourceStepId) && <small className="wf-warning">原正文步骤已移动或停用，请重新选择。</small>}</label>}
  </section>;
}

export function WorkflowEditor({ props, initial, workflowId, onClose, onSaved, lockedOutputKind, initialStepId, initialField, saveLabel }: { props: PageProps; initial: WorkflowDraft; workflowId?: string; onClose: () => void; onSaved?: (savedWorkflowId: string) => void; lockedOutputKind?: ProjectKind; initialStepId?: string; initialField?: LivePreflightIssue['field']; saveLabel?: string; }) {
  const [draft, setDraft] = useState<WorkflowDraft>(() => workflowSelections(structuredClone(initial), props.configuration));
  const [initialDefault] = useState(() => !workflowId && sameEmptyDefaultSteps(initial, blankWorkflow(props, initial.outputKind)));
  const pristineDefaults = useRef(initialDefault);
  const [selectedId, setSelectedId] = useState(initial.steps.some(step => step.id === initialStepId) ? initialStepId! : initial.steps[0]?.id || '');
  const [focus, setFocus] = useState<{ stepId?: string; field?: LivePreflightIssue['field'] }>({ stepId: initialStepId, field: initialField });
  const newWorkflowId = useRef(crypto.randomUUID());
  const [newKind, setNewKind] = useState<WorkflowStepKind>('text');
  const [error, setError] = useState('');
  const index = draft.steps.findIndex(step => step.id === selectedId);
  const selected = draft.steps[index];
  const firstEnabledIndex = draft.steps.findIndex(step => step.enabled);
  useEffect(() => {
    setDraft(current => { const next = workflowSelections(current, props.configuration); return JSON.stringify(current.steps) === JSON.stringify(next.steps) ? current : next; });
  }, [props.configuration.models, props.configuration.connections, props.configuration.credentials]);
  function update(changes: Partial<WorkflowDraft>) { setDraft(value => ({ ...value, ...changes })); setError(''); }
  function updateSteps(steps: WorkflowStep[]) { pristineDefaults.current = false; update({ steps: normalizeSteps(steps) }); }
  function changeOutputKind(outputKind: ProjectKind) {
    const next = switchNewWorkflowOutput(props, draft, outputKind, !workflowId && pristineDefaults.current);
    update(next);
    if (next.steps !== draft.steps) { setSelectedId(next.steps[0]?.id || ''); setFocus({}); }
  }
  function changeStep(changes: Partial<WorkflowStep>) { updateSteps(draft.steps.map(step => step.id === selectedId ? { ...step, ...changes } : step)); }
  function move(id: string, direction: number) {
    const next = [...draft.steps]; const from = next.findIndex(step => step.id === id); const to = from + direction;
    if (to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]]; updateSteps(next);
  }
  function remove(id: string) {
    const next = draft.steps.filter(step => step.id !== id); updateSteps(next);
    if (selectedId === id) setSelectedId(next[0]?.id || '');
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (lockedOutputKind && draft.outputKind !== lockedOutputKind) { setError('当前作品类型与项目不一致，请保留当前项目类型。'); return; }
    if (!draft.name.trim()) { setError('先给这个工作流起一个名字。'); return; }
    const enabled = draft.steps.filter(step => step.enabled);
    if (!enabled.length) { setError('至少需要一个启用的步骤。'); return; }
    const invalid = enabled.find(step => !step.name.trim() || (isModelStep(step.kind) && (!step.prompt.trim() || !availableModels(props, step.kind).some(model => model.id === step.modelConfigId) || !Number.isInteger(step.maxOutputTokens ?? 2048) || (step.maxOutputTokens ?? 2048) < WORKFLOW_OUTPUT_MIN || (step.maxOutputTokens ?? 2048) > WORKFLOW_OUTPUT_MAX)));
    if (invalid) { const field = !invalid.prompt.trim() ? 'prompt' : !availableModels(props, invalid.kind).some(model => model.id === invalid.modelConfigId) ? 'modelConfigId' : 'maxOutputTokens'; setSelectedId(invalid.id); setFocus({ stepId: invalid.id, field }); setError(`请检查“${invalid.name || '未命名步骤'}”的名称、提示词、模型和输出范围（16–16384）。`); return; }
    const savedId = workflowId || newWorkflowId.current;
    if (props.configuration.saveWorkflow({ ...draft, name: draft.name.trim(), description: draft.description.trim() }, savedId)) { onClose(); onSaved?.(savedId); }
  }
  const categoryChoices = categoryOptions(props.configuration.categories);
  return <WorkflowDialog title={workflowId ? '编辑工作流' : '创建自己的工作流'} subtitle={`保存到“${props.workspace.name}”，按你的习惯安排每一步。`} onClose={onClose} className="wf-editor-dialog" footer={<><span className="wf-footer-hint"><ShieldCheck size={14} />保存不调用模型；运行时自动检查设置并记录实际花费</span><button type="button" className="btn btn-secondary" onClick={onClose}>取消</button><button type="submit" form="wf-editor-form" className="btn btn-primary"><Check size={15} />{saveLabel || (onSaved ? '保存并继续预检' : '保存工作流')}</button></>}>
    <form id="wf-editor-form" onSubmit={save} className="wf-editor-body"><section className="wf-flow-setup"><div className="wf-flow-meta"><label className="wf-field"><span>工作流名称 <b>*</b></span><input className="field" autoFocus aria-label="工作流名称" maxLength={60} value={draft.name} onChange={event => update({ name: event.target.value })} placeholder="例如：品牌宣传内容制作" /></label><label className="wf-field"><span>简短说明</span><textarea className="field" aria-label="工作流说明" rows={2} maxLength={300} value={draft.description} onChange={event => update({ description: event.target.value })} placeholder="这个流程适合完成什么？" /></label><div className="wf-two-fields"><label className="wf-field"><span>关联作品类型</span><Select className="field" aria-label="工作流作品类型" disabled={!!lockedOutputKind} value={draft.outputKind} onValueChange={value => changeOutputKind(value as ProjectKind)} options={(['ppt', 'word', 'excel', 'image'] as const).map(kind => ({ value: kind, label: KIND_LABEL[kind] }))} /></label><label className="wf-field"><span>业务分类</span><Select className="field" aria-label="工作流业务分类" value={draft.businessCategoryId || ''} onValueChange={value => update({ businessCategoryId: value || undefined })} options={[{ value: '', label: '未分类' }, ...categoryChoices.map(item => ({ value: item.id, label: item.label }))]} /></label></div></div>
      <div className="wf-sequence-heading"><h3><ListOrdered size={16} />流程步骤</h3><span>{draft.steps.filter(step => step.enabled).length} 步启用</span></div><div className="wf-sequence-list">{draft.steps.map((step, position) => <article key={step.id} className={`wf-step-card ${selectedId === step.id ? 'selected' : ''} ${!step.enabled ? 'disabled' : ''}`}><button type="button" className="wf-step-main" aria-label={`编辑步骤 ${position + 1} ${step.name}`} onClick={() => setSelectedId(step.id)}><span className="wf-step-number">{String(position + 1).padStart(2, '0')}</span><span className="wf-step-icon"><StepIcon kind={step.kind} /></span><span><strong>{step.name || '未命名步骤'}</strong><small>{kindLabel(step.kind)} · {step.enabled ? '已启用' : '已停用'}</small></span><ArrowRight size={14} /></button><div className="wf-step-card-actions"><label><input aria-label={`启用步骤 ${position + 1}`} type="checkbox" checked={step.enabled} onChange={event => updateSteps(draft.steps.map(item => item.id === step.id ? { ...item, enabled: event.target.checked } : item))} />启用</label><button type="button" className="btn-icon" aria-label={`上移步骤 ${position + 1}`} disabled={position === 0} onClick={() => move(step.id, -1)}><ArrowUp size={13} /></button><button type="button" className="btn-icon" aria-label={`下移步骤 ${position + 1}`} disabled={position === draft.steps.length - 1} onClick={() => move(step.id, 1)}><ArrowDown size={13} /></button><button type="button" className="btn-icon" aria-label={`删除步骤 ${position + 1}`} onClick={() => remove(step.id)}><Trash2 size={13} /></button></div></article>)}</div>
      <div className="wf-add-step"><Select className="field" aria-label="新增步骤类型" value={newKind} onValueChange={value => setNewKind(value as WorkflowStepKind)} options={STEP_KINDS} /><button type="button" className="btn btn-secondary" onClick={() => { const step = workflowStepSelection(makeStep(newKind), props.configuration); updateSteps([...draft.steps, step]); setSelectedId(step.id); }}><Plus size={14} />添加步骤</button></div>
    </section><div className="wf-editor-inspector">{selected ? <StepSettings props={props} outputKind={draft.outputKind} step={selected} index={index} firstEnabledIndex={firstEnabledIndex} priorContentSteps={draft.steps.slice(0, index).filter(step => step.enabled && (step.kind === 'text' || step.kind === 'transcription'))} onChange={changeStep} focusField={focus.stepId === selectedId ? focus.field : undefined} /> : <div className="wf-inspector-empty"><Layers3 size={32} /><h3>从一个步骤开始</h3><p>在左侧选择类型并添加，逐步搭好你的工作流。</p></div>}</div>{error && <p className="wf-editor-error" role="alert">{error}</p>}</form>
  </WorkflowDialog>;
}

export function RunWorkflowDialog({ props, workflow, initial, onClose, onStarted, onEdit, studio = false, autoStart = false, onConfigure }: { props: PageProps; workflow: WorkflowDefinition; initial?: RunContext; onClose: () => void; onStarted: () => void; onEdit: (context: RunContext) => void; studio?: boolean; autoStart?: boolean; onConfigure?: (workflow: WorkflowDefinition) => void }) {
  const executionWorkflow = withCreationFoundation(workflowSelections(workflow, props.configuration));
  const projects = props.projects.filter(project => project.kind === executionWorkflow.outputKind);
  const [mode, setMode] = useState<'live' | 'simulation'>(initial?.mode || 'live');
  const [projectId, setProjectId] = useState(projects.find(project => project.id === initial?.projectId)?.id || projects.find(project => project.id === props.activeProject.id)?.id || projects[0]?.id || '');
  const [input, setInput] = useState(initial?.input ?? projects.find(project => project.id === projectId)?.description ?? '');
  const [values, setValues] = useState<Record<string, string>>(initial?.variables || {});
  const [attachments, setAttachments] = useState<InputAttachment[]>(() => initial?.attachments ? structuredClone(initial.attachments) : (initial?.attachmentIds || []).map((id, index) => ({ id, name: `工作台参考文件 ${index + 1}` })));
  const [preflight, setPreflight] = useState<LivePreflight | null>(null);
  const [preflightSignature, setPreflightSignature] = useState('');
  const [paidAcknowledged, setPaidAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'preflight' | 'import' | 'start' | null>(null);
  const [error, setError] = useState('');
  const startPending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const confirmBeforeRun = props.preferences.confirmGeneration;
  const enabledSteps = executionWorkflow.steps.filter(step => step.enabled);
  const modelSteps = enabledSteps.filter(step => isModelStep(step.kind));
  const limitedSteps = modelSteps.filter(step => step.budgetCents != null);
  const configuredLimit = limitedSteps.reduce((sum, step) => sum + step.budgetCents!, 0);
  const promptContent = enabledSteps.map(step => step.prompt).join('\n');
  const variables = extractVariables(promptContent);
  const missingVariables = resolvePrompt(promptContent, values).missing;
  const complete = missingVariables.length === 0 && !!input.trim() && !!projectId;
  const requiredMessage = !projectId ? '请选择关联项目。' : !input.trim() ? '请填写本次创作需求。' : missingVariables.length ? `请填写本次变量：${missingVariables.join('、')}。` : '';
  const requestSignature = JSON.stringify({ mode, confirmBeforeRun, project: projects.find(project => project.id === projectId), projectId, input, values, files: attachments.map(file => file.id), workflow: executionWorkflow, models: props.configuration.models, connections: props.configuration.connections, credentials: props.configuration.credentials, replaceWaitingReviewRunId: initial?.replaceWaitingReviewRunId });
  const signatureRef = useRef(requestSignature); signatureRef.current = requestSignature;
  const inspectedSignature = useRef('');
  useEffect(() => { inspectedSignature.current = ''; setPreflight(null); setPreflightSignature(''); setPaidAcknowledged(false); setError(''); }, [requestSignature, mode]);
  const canStartLive = props.workflowRunner.runtimeStatus.available && currentPreflightAccepted(preflight, preflightSignature, requestSignature, !confirmBeforeRun || paidAcknowledged || modelSteps.length === 0);
  const runContext = (issue?: LivePreflightIssue): RunContext => ({ projectId, input, attachmentIds: attachments.map(file => file.id), attachments: attachments.map(({ id, name, mimeType, bytes }) => ({ id, name, mimeType, bytes })), variables: values, mode, focusStepId: issue?.stepId, focusField: issue?.field, replaceWaitingReviewRunId: initial?.replaceWaitingReviewRunId });
  function locateIssue(issue: LivePreflightIssue) {
    if (studio && issue.stepId && ['modelConfigId', 'credentialId', 'connection'].includes(issue.field || '')) {
      const fields = Array.from(document.querySelectorAll<HTMLElement>('.studio-connection-step')).find(element => element.dataset.stepId === issue.stepId);
      fields?.closest('details')?.setAttribute('open', '');
      const controls = fields?.querySelectorAll<HTMLElement>('[role="combobox"]');
      const control = issue.field === 'credentialId' ? controls?.[1] : controls?.[0];
      if (control && !control.hasAttribute('disabled')) { control.scrollIntoView({ block: 'center' }); control.focus(); control.click(); return; }
    }
    if (issue.stepId) { onEdit(runContext(issue)); return; }
    const dialog = document.querySelector('.wf-run-dialog');
    const label = issue.field === 'input' ? '工作流本次需求' : issue.field === 'project' ? '运行关联项目' : undefined;
    const control = label ? dialog?.querySelector<HTMLElement>(`[aria-label="${label}"]`) : issue.field === 'attachments' ? dialog?.querySelector<HTMLElement>('.wf-attachments button') : dialog?.querySelector<HTMLElement>('[aria-label^="工作流变量 "]');
    control?.closest('details')?.setAttribute('open', ''); control?.scrollIntoView({ block: 'center' }); control?.focus();
  }
  async function importFiles() {
    if (busy) return; setBusy('import'); setError('');
    try { const files = await props.workflowRunner.importFiles(projectId); setAttachments(current => [...current, ...files.filter(file => !current.some(item => item.id === file.id))]); }
    catch (cause) { setError(workflowPublicError(cause, '未能选择参考文件，请在桌面应用中重试。')); }
    finally { setBusy(null); }
  }
  async function inspect() {
    if (!complete || busy || !props.workflowRunner.runtimeStatus.available) return;
    const signature = signatureRef.current; setBusy('preflight'); setError('');
    try { const result = await props.workflowRunner.preflight(executionWorkflow, projectId, input.trim(), values, attachments.map(file => file.id)); if (mounted.current && signatureRef.current === signature) { setPreflight(result); setPreflightSignature(signature); } }
    catch (cause) { if (mounted.current && signatureRef.current === signature) setError(workflowPublicError(cause, '运行预检未完成，请检查桌面运行引擎状态后重试。')); }
    finally { if (mounted.current) setBusy(null); }
  }
  async function start(): Promise<boolean> {
    if (!complete || busy || startPending.current) return false;
    if (mode === 'simulation') { const started = props.workflowRunner.start(executionWorkflow, projectId, input.trim(), values); if (started) { onClose(); onStarted(); } return started; }
    if (!canStartLive) return false;
    startPending.current = true; setBusy('start'); setError('');
    try {
      const started = await props.workflowRunner.startLive(executionWorkflow, projectId, input.trim(), values, attachments.map(file => file.id), !confirmBeforeRun || paidAcknowledged && Boolean(preflight?.unknownCost), initial?.replaceWaitingReviewRunId);
      if (mounted.current) { if (started) { onClose(); onStarted(); } else setError('启动结果尚未确认，请查看任务记录或调用设置。本次不会自动重发。'); }
      return started;
    } catch (cause) { if (mounted.current) setError(workflowPublicError(cause, '未能开始运行，请检查运行记录后重试，避免重复提交。')); return false; }
    finally { startPending.current = false; if (mounted.current) setBusy(null); }
  }
  useEffect(() => {
    if (mode !== 'live' || !complete || busy || !props.workflowRunner.runtimeStatus.available || inspectedSignature.current === requestSignature) return;
    const timer = window.setTimeout(() => { if (signatureRef.current !== requestSignature) return; inspectedSignature.current = requestSignature; void inspect(); }, autoStart && !confirmBeforeRun ? 0 : 300);
    return () => window.clearTimeout(timer);
  // The signature includes every parameter used by this free local preflight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, complete, busy, requestSignature, props.workflowRunner.runtimeStatus.available]);
  const automatic = useAutomaticStudioRun({ enabled: studio && autoStart && !confirmBeforeRun && mode === 'live', ready: canStartLive && !busy, blocked: !complete || !props.workflowRunner.runtimeStatus.available || Boolean(preflight && !preflight.ok), error, onStart: start });
  if (automatic) return <WorkflowDialog title="正在开始创作" subtitle={projects.find(project => project.id === projectId)?.name || executionWorkflow.name} busy={busy === 'start'} onClose={onClose} className="studio-direct-dialog" footer={<button className="btn btn-secondary" disabled={busy === 'start'} onClick={onClose}>取消</button>}><div className="studio-direct-progress" role="status"><LoaderCircle size={28} className="spin" /><strong>{busy === 'start' ? '正在开始制作…' : '正在检查模型、Key 和输入…'}</strong><p>设置完整后直接执行，花费随实际调用保存。</p></div></WorkflowDialog>;
  const footer = <>
    {mode === 'live' && confirmBeforeRun && preflight && <CallConfirmation result={preflight} paidAcknowledged={paidAcknowledged} onPaid={setPaidAcknowledged} disabled={!!busy} />}
    <span className="wf-footer-hint"><ShieldCheck size={14} />{mode === 'live' ? confirmBeforeRun ? '已开启逐次确认：勾选本次调用后点击开始' : '点击开始直接调用模型，实际花费自动记录' : '模拟体验不会调用模型或扣费'}</span>
    <button className="btn btn-secondary" disabled={!!busy} onClick={() => onEdit(runContext())}>{studio ? '高级步骤' : '调整步骤与模型'}</button>
    <button className="btn btn-secondary" disabled={busy === 'start' || busy === 'import'} onClick={onClose}>{studio ? '返回工作台' : '取消'}</button>
    {mode === 'live' && (preflight && !preflight.ok || !preflight && error) && <button className="btn btn-secondary" disabled={!complete || !!busy || !props.workflowRunner.runtimeStatus.available} onClick={() => { void inspect(); }}>{busy === 'preflight' ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}重新检查</button>}
    <button className="btn btn-primary" disabled={!complete || !!busy || (mode === 'live' && !canStartLive)} onClick={() => { void start(); }}>{busy === 'start' ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}{mode === 'live' ? modelSteps.length ? confirmBeforeRun ? '确认并开始' : '开始制作' : '开始本地处理' : '开始模拟'}</button>
  </>;
  const modes = <div className="segmented wf-mode-select"><button disabled={!!busy || !props.workflowRunner.runtimeStatus.available} className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>真实运行</button><button disabled={!!busy} className={mode === 'simulation' ? 'active' : ''} onClick={() => setMode('simulation')}>模拟体验</button></div>;
  return <WorkflowDialog title={studio ? confirmBeforeRun ? '确认本次创作' : '补全调用设置' : '运行工作流'} subtitle={studio ? projects.find(project => project.id === projectId)?.name || executionWorkflow.name : executionWorkflow.name} busy={busy === 'start' || busy === 'import'} onClose={onClose} className={studio ? 'wf-run-dialog studio-run-dialog' : 'wf-run-dialog'} footer={footer}>
    <div className="wf-run-dialog-body"><section className="wf-run-inputs">{requiredMessage && <div className="wf-run-required" role="status"><span>{requiredMessage}</span><button type="button" onClick={() => locateIssue({ message: requiredMessage, field: !projectId ? 'project' : !input.trim() ? 'input' : 'variables' })}>前往填写</button></div>}
      {!studio && modes}
      <div className={`wf-simulation-notice ${mode === 'live' ? 'wf-live-notice' : ''}`}><Globe2 size={18} /><p><b>{mode === 'live' ? confirmBeforeRun ? '已开启生成前逐次确认' : '补全设置后开始制作' : '正在体验模拟流程'}</b><span>{mode === 'live' ? '自动检查不收费；点击开始会发送描述与参考文件，实际花费自动保存。' : '仅展示执行与费用记录方式，不读取 Key。'}</span></p></div>
      {mode === 'live' && !props.workflowRunner.runtimeStatus.available && <div className="wf-runtime-unavailable"><AlertCircle size={18} /><div><b>真实生成请使用桌面应用</b><p>{props.workflowRunner.runtimeStatus.reason || '浏览器可预览界面，EXE 中可使用已保存的模型与 Key。'}</p><button onClick={() => setMode('simulation')}>体验模拟流程<ArrowRight size={14} /></button></div></div>}
      {projects.length ? studio ? <>
        <div className="studio-run-project"><span>当前项目</span><strong>{projects.find(project => project.id === projectId)?.name}</strong><span>{attachments.length ? `${attachments.length} 份参考文件已带入` : '本次没有参考文件'}</span></div>
        <details className="studio-run-description"><summary>查看本次描述</summary><pre>{executionWorkflow.steps.find(step => step.enabled && isModelStep(step.kind))?.prompt || input}</pre>{!executionWorkflow.id.startsWith('quick-') && <textarea className="field" aria-label="工作流本次需求" rows={4} value={input} disabled={!!busy} onChange={event => setInput(event.target.value)} />}</details>
        {onConfigure && <StudioConnectionFields props={props} workflow={executionWorkflow} disabled={!!busy} simulation={mode === 'simulation'} onChange={onConfigure} />}
      </> : <fieldset className="wf-input-fieldset" disabled={busy === 'start' || busy === 'import'}>
        <label className="wf-field"><span>关联项目 <b>*</b></span><Select className="field" aria-label="运行关联项目" value={projectId} onValueChange={value => { setProjectId(value); setInput(projects.find(project => project.id === value)?.description || ''); }} options={projects.map(project => ({ value: project.id, label: project.name }))} /><small>仅列出当前工作区的{KIND_LABEL[executionWorkflow.outputKind]}项目。</small></label>
        <label className="wf-field"><span>本次需求 <b>*</b></span><textarea className="field" aria-label="工作流本次需求" rows={4} maxLength={10000} value={input} onChange={event => setInput(event.target.value)} placeholder="说明这次要完成什么…" /></label>
      </fieldset> : <div className="wf-no-project"><FileText size={28} /><h3>先创建一份作品</h3><button className="btn btn-secondary" onClick={() => { onClose(); props.onCreateProject(executionWorkflow.outputKind); }}>新建{KIND_LABEL[executionWorkflow.outputKind]}项目</button></div>}
      {mode === 'live' && <details className="studio-run-advanced" open={attachments.length > 0}><summary>参考文件（{attachments.length}）</summary><section className="wf-attachments"><div><h3><Paperclip size={15} />参考文件</h3><button className="btn btn-secondary" disabled={!!busy || !props.workflowRunner.runtimeStatus.available} onClick={() => { void importFiles(); }}>{busy === 'import' ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}选择文件</button></div><p>确认运行后才发送给所选服务商。</p>{attachments.map(file => <div className="wf-attachment" key={file.id}><Paperclip size={14} /><span>{file.name}</span><button disabled={!!busy} aria-label={`移除参考文件 ${file.name}`} onClick={() => setAttachments(current => current.filter(item => item.id !== file.id))}><X size={14} /></button></div>)}</section></details>}
      {variables.length > 0 && <fieldset className="wf-run-variables wf-input-fieldset" disabled={busy === 'start' || busy === 'import'}><h3><Braces size={16} />补充模板内容</h3>{variables.map(name => <label className="wf-field" key={name}><span>{name} <b>*</b></span><textarea className="field" aria-label={`工作流变量 ${name}`} rows={2} maxLength={3000} value={Object.hasOwn(values, name) ? values[name] : ''} onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))} /></label>)}</fieldset>}
      {studio && <details className="studio-run-advanced"><summary>执行方式与流程说明</summary>{modes}<ol>{enabledSteps.map(step => <li key={step.id}>{step.name}{isModelStep(step.kind) ? '' : ' · 不调用模型'}</li>)}</ol></details>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section><aside className="wf-run-plan">
      {!studio && <><h3>本次执行顺序</h3><div>{enabledSteps.map((step, index) => <div className="wf-run-plan-step" key={step.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.name}</strong><small>{kindLabel(step.kind)}</small>{step.prompt && <details><summary>查看提示词</summary><pre>{resolvePrompt(step.prompt, values).content}</pre></details>}</div></div>)}</div></>}
      {mode === 'simulation' ? <div className="wf-run-estimate"><span>预计模拟费用</span><strong>¥{money(enabledSteps.reduce((sum, step) => sum + workflowStepCost(step), 0))}</strong><small>虚构演示金额，不是实际扣费。</small></div> : preflight ? studio ? <StudioPreflightResult result={preflight} paidAcknowledged={paidAcknowledged} onPaid={setPaidAcknowledged} onLocate={locateIssue} disabled={!!busy} /> : <PreflightResult result={preflight} paidAcknowledged={paidAcknowledged} onPaid={setPaidAcknowledged} onLocate={locateIssue} disabled={!!busy} /> : <div className="wf-preflight-pending">{busy === 'preflight' ? <LoaderCircle size={26} className="spin" /> : <ShieldCheck size={26} />}<h3>{busy === 'preflight' ? '正在核对调用设置' : studio ? '补全模型和 Key' : '运行前检查'}</h3><p>{studio ? '设置完整后自动检查，不产生生成费用。' : '设置完整后会自动检查，不调用模型。'}</p></div>}
      {!studio && <div className="wf-run-budget"><span>模型步骤金额上限</span><strong>{!modelSteps.length ? '无需模型调用' : !limitedSteps.length ? '未设上限' : limitedSteps.length < modelSteps.length ? `已设部分 ¥${money(configuredLimit)}` : `¥${money(configuredLimit)}`}</strong><small>留空不设上限，费用仍逐次累计。</small></div>}
    </aside></div>
  </WorkflowDialog>;
}

type PreflightViewProps = { result: LivePreflight; paidAcknowledged: boolean; onPaid: (value: boolean) => void; onLocate: (issue: LivePreflightIssue) => void; disabled: boolean };

function PreflightIssues({ result, onLocate, disabled }: Pick<PreflightViewProps, 'result' | 'onLocate' | 'disabled'>) {
  const issues = workflowIssues(result);
  return issues.length > 0 ? <ul className="wf-validation-issues">{issues.map((issue, index) => <li key={`${index}-${issue.message}`}><span>{issue.message}</span>{workflowIssueCanLocate(issue) && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onLocate(issue)}>定位修改<ArrowRight size={13} /></button>}</li>)}</ul> : null;
}
function CallConfirmation({ result, paidAcknowledged, onPaid, disabled }: Omit<PreflightViewProps, 'onLocate'>) {
  if (!result.steps.some(step => !['manual-review', 'export'].includes(step.kind))) return <p>本次仅处理本地文件，不调用模型。</p>;
  return result.ok ? <div className="wf-paid-confirmation"><label><input aria-label="确认本次模型调用" type="checkbox" disabled={disabled} checked={paidAcknowledged} onChange={event => onPaid(event.target.checked)} /><span>我确认向上述服务地址发送本次内容与参考文件，并接受本次模型调用费用。{result.unknownCost && '部分费用需要在返回实际用量后确定，也包含在本次确认内。'}</span></label></div> : null;
}
function StudioPreflightResult(props: PreflightViewProps) {
  const { result, onLocate, disabled } = props;
  return <section className="studio-preflight-summary" aria-label="调用设置检查"><h3>{result.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{result.ok ? '设置已就绪' : '请先补全设置'}</h3><PreflightIssues result={result} onLocate={onLocate} disabled={disabled} />{result.steps.filter(step => step.domain).map(step => <p className="studio-request-target" key={step.id}>{step.domain}<br />Key：{step.credentialName || '未选择'}</p>)}<div className="studio-total"><span>{result.unknownCost ? '本次已知费用预估' : '本次费用预估'}</span><strong>{typeof result.estimatedCents === 'number' ? `¥${money(result.estimatedCents)}` : result.steps.some(step => step.costNote?.includes('自动')) ? '生成后自动计算' : '暂不能预估'}</strong><small>{result.unknownCost ? '部分费用需由返回用量确定，当前预估不是完整总价。' : '最终花费按返回用量累计，可在项目账本查看。'}</small></div>{result.warnings.length > 0 && <details className="studio-run-warnings"><summary>调用说明</summary>{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}</section>;
}
function PreflightResult(props: PreflightViewProps) {
  const { result, onLocate, disabled } = props;
  return <section className={`wf-preflight-result ${result.ok ? 'ok' : 'blocked'}`} aria-label="工作流运行预检"><h3>{result.ok ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{result.ok ? '设置已就绪，可以开始制作' : '请先解决以下问题'}</h3><PreflightIssues result={result} onLocate={onLocate} disabled={disabled} />{result.warnings.length > 0 && <details className="wf-advanced-settings"><summary>调用说明</summary><div className="wf-preflight-warnings">{result.warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div></details>}<div className="wf-preflight-targets">{result.steps.filter(step => step.domain || step.modelName).map(step => <div key={step.id}><strong>{step.name}</strong><code>{step.domain || '未提供域名'}</code><small>{step.modelName} · Key：{step.credentialName || '未选择'}</small><span>{step.costNote || (typeof step.estimatedCents === 'number' ? `预估 ¥${money(step.estimatedCents)}` : '等待实际计费用量')}</span></div>)}</div><div className="wf-run-estimate"><span>本次费用预估</span><strong>{typeof result.estimatedCents === 'number' ? `¥${money(result.estimatedCents)}` : result.steps.some(step => step.costNote?.includes('自动')) ? '生成后自动计算' : '暂不能预估'}</strong><small>{result.unknownCost ? '实际用量返回后自动记录可计算费用。' : '按当前配置单价与用量假设计算，最终按返回用量记录。'}</small></div></section>;
}

function AttemptDetails({ attempts, props, live, projectId }: { attempts: WorkflowAttempt[]; props: PageProps; live: boolean; projectId: string }) {
  const last = attempts.at(-1);
  const [selectedId, setSelectedId] = useState(last?.id || '');
  useEffect(() => { setSelectedId(last?.id || ''); }, [last?.id]);
  const attempt = attempts.find(item => item.id === selectedId) || last;
  if (!attempt) return null;
  const documentKind = props.projects.find(project => project.id === projectId)?.kind;
  const documentResult = live && documentKind && documentKind !== 'image' && attempt.artifacts?.some(artifact => artifact.kind === 'text' || artifact.kind === 'office');
  return <div className="wf-attempt-details">{attempts.length > 1 && <label className="wf-attempt-picker">查看尝试<Select aria-label={`查看步骤 ${attempt.stepName} 的历史尝试`} value={attempt.id} onValueChange={setSelectedId} options={attempts.map((item, index) => ({ value: item.id, label: `第 ${index + 1} 次 · ${item.status === 'complete' ? '完成' : item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '取消' : '处理中'} · ${costPrimary(attemptCostRecord(item, props.ledger, live))}` }))} /></label>}{attempt.error && <p className="wf-attempt-error" role="status"><AlertCircle size={13} />{attempt.error}</p>}{attempt.summary && (documentResult ? <p className="wf-attempt-summary">文档内容已生成，点击下方“查看文档”即可检查与编辑完整内容。</p> : <p className="wf-attempt-summary">{attempt.summary}</p>)}{attempt.costState === 'unknown' && <p className="wf-unknown-cost">本次费用尚未完整计算，不能按零元或免费处理。</p>}{attempt.usage && <p className="wf-usage">{typeof attempt.usage.inputTokens === 'number' ? `输入 ${attempt.usage.inputTokens} Token` : ''}{typeof attempt.usage.outputTokens === 'number' ? ` · 输出 ${attempt.usage.outputTokens} Token` : ''}{typeof attempt.usage.images === 'number' ? ` · ${attempt.usage.images} 张图` : ''}{typeof attempt.usage.seconds === 'number' ? ` · ${attempt.usage.seconds} 秒` : ''}</p>}<details><summary>查看本次输入、提示词与{live ? '结果' : '模拟结果'}</summary><b>本次输入</b><pre>{attempt.input}</pre>{attempt.prompt && <><b>本次提示词</b><pre>{attempt.prompt}</pre></>}<b>结果正文或摘要</b><pre>{attempt.summary || '当前尝试尚未返回内容。'}</pre>{attempt.providerRequestId && <><b>供应商请求编号</b><pre>{attempt.providerRequestId}</pre></>}</details>{attempt.artifacts?.length ? <ArtifactResults artifacts={attempt.artifacts} runner={props.workflowRunner} projectId={projectId} documentKind={documentKind === 'image' ? undefined : documentKind} onEditDocument={documentResult ? () => props.navigate('documents', projectId) : undefined} /> : null}</div>;
}

export function WorkflowRunCard({ props, run: summary }: { props: PageProps; run: WorkflowRun }) {
  const [detailsOpen, setDetailsOpen] = useState(!summary.contentTruncated && summary.projectId === props.activeProject.id);
  const [detail, setDetail] = useState<WorkflowRun>();
  const [detailError, setDetailError] = useState('');
  const run = detail && runDetailKey(detail) === runDetailKey(summary) ? detail : summary;
  useEffect(() => {
    if (!detailsOpen || !summary.contentTruncated || !props.workflowRunner.loadRunDetail) return;
    let stopped = false; setDetailError('');
    void props.workflowRunner.loadRunDetail(summary.id).then(value => { if (!stopped) setDetail(value); }, cause => { if (!stopped) setDetailError(cause instanceof Error ? cause.message : '详情读取失败，可收起后重试。'); });
    return () => { stopped = true; };
  }, [detailsOpen, summary.id, summary.detailVersion, summary.contentTruncated, props.workflowRunner.loadRunDetail]);
  const archived = Boolean(run.hiddenAt || run.trashedAt);
  const [confirmation, setConfirmation] = useState<{ action: 'retry' | 'continue'; stepId?: string; name: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [continueBudget, setContinueBudget] = useState('');
  const [continueBudgetError, setContinueBudgetError] = useState('');
  const terminal = ['complete', 'cancelled', 'interrupted', 'failed'].includes(run.status);
  const live = run.mode === 'live';
  const labels: Record<WorkflowRun['status'], string> = live ? { running: '正在执行', paused: '已暂停', 'waiting-review': '等待人工检查', complete: '已完成', cancelled: '已取消', interrupted: '已中断', failed: '执行失败' } : RUN_LABELS;
  const runLabel = run.status === 'cancelled' && run.supersededByRunId ? '已由后续创作替代' : run.retryStepOnly && run.status === 'complete' ? '单步重试完成' : labels[run.status];
  const cost = summarizeCosts(runCostRecords(run, props.ledger));
  const project = props.projects.find(item => item.id === run.projectId);
  const editableReview = run.mode === 'live' && run.status === 'waiting-review' && !!project && ['word', 'ppt', 'excel'].includes(project.kind);
  function retry(stepId: string, name: string) { if (live && !props.preferences.confirmGeneration) { props.workflowRunner.retry(run.id, stepId); return; } if (live) { setAcknowledged(false); setConfirmation({ action: 'retry', stepId, name }); } else props.workflowRunner.retry(run.id, stepId); }
  function continueRun() {
    if (!live || !props.preferences.confirmGeneration) { props.workflowRunner.resume(run.id); return; }
    const step = run.snapshot.steps[run.stepIndex];
    setContinueBudget(step?.budgetCents == null ? '' : money(step.budgetCents)); setContinueBudgetError(''); setAcknowledged(false);
    setConfirmation({ action: 'continue', stepId: step?.id, name: step?.name || '从当前位置继续' });
  }
  function confirm() {
    if (!confirmation || !acknowledged) return;
    if (confirmation.action === 'retry' && confirmation.stepId) props.workflowRunner.retry(run.id, confirmation.stepId);
    else {
      if (confirmation.stepId !== run.snapshot.steps[run.stepIndex]?.id) { setContinueBudgetError('当前步骤已变化，请关闭后重新确认。'); return; }
      let limit: number | undefined;
      try { limit = parseOptionalBudget(continueBudget); } catch (error) { setContinueBudgetError(error instanceof Error ? error.message : '请填写非负有效金额或留空。'); return; }
      props.workflowRunner.resume(run.id, limit ?? null);
    }
    setConfirmation(null);
  }
  return <section className={`panel wf-run-card ${live ? 'wf-real-run' : ''}`}><header><span className={`wf-run-state-icon ${run.status}`}>{run.status === 'running' ? <LoaderCircle size={20} className="spin" /> : run.status === 'complete' ? <CheckCircle2 size={20} /> : run.status === 'waiting-review' ? <ShieldCheck size={20} /> : run.status === 'failed' ? <AlertCircle size={20} /> : <CirclePause size={20} />}</span><div><h3>{run.workflowName}<span className={`wf-run-mode ${live ? 'live' : ''}`}>{live ? '真实' : '模拟'}</span></h3><p>{project?.name || '关联项目'}<i />{Number.isNaN(Date.parse(run.createdAt)) ? run.createdAt : new Date(run.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p></div><span className={`wf-run-badge ${run.status}`}>{runLabel}</span><strong>{live ? '调用费用 ' : '模拟费用 '}<CostTotal summary={cost} /></strong></header>
    {run.error && <div className="wf-run-error" role="status"><AlertCircle size={15} /><span>{run.error}</span></div>}{run.pauseRequested && <div className="wf-retry-notice"><CirclePause size={13} /><span>已请求暂停，将在当前请求结束后停止后续步骤；已经发出的请求仍可能收费。</span></div>}
    <button className="btn btn-ghost" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? '收起步骤与结果' : '查看步骤与结果'}</button>{detailError && <p className="form-error" role="alert">{detailError}</p>}{detailsOpen && run.contentTruncated && <p role="status">正在按需读取完整执行详情…</p>}{detailsOpen && !run.contentTruncated && <div className="wf-run-steps">{run.snapshot.steps.map((step, index) => {
      const attempts = run.attempts.filter(attempt => attempt.stepId === step.id); const last = attempts.at(-1); const current = index === run.stepIndex;
      const state = !step.enabled ? '已停用' : (current && run.status === 'waiting-review') || last?.status === 'waiting-review' ? '待人工确认' : last?.status === 'running' ? run.status === 'paused' ? '已暂停' : live ? '处理中' : '模拟中' : last?.status === 'complete' ? '已完成' : last?.status === 'failed' ? '执行失败' : last?.status === 'cancelled' ? '本次已取消' : run.retryStepOnly ? '未重新执行' : terminal ? '未执行' : '待执行';
      const stepCost = summarizeCosts(attempts.map(attempt => attemptCostRecord(attempt, props.ledger, live)));
      return <div className={`wf-run-step ${current && !terminal ? 'current' : ''} ${!step.enabled ? 'disabled' : ''}`} key={step.id}><span className="wf-run-step-mark">{state === '已完成' ? <Check size={14} /> : <StepIcon kind={step.kind} size={14} />}</span><div className="wf-run-step-info"><div><strong>{step.name}</strong><span>{state}</span></div><small>{kindLabel(step.kind)}{attempts.length > 0 && <> · {attempts.length} 次尝试 · <CostTotal summary={stepCost} /></>}</small><AttemptDetails attempts={attempts} props={props} live={live} projectId={run.projectId} /></div>{step.enabled && isModelStep(step.kind) && attempts.length > 0 && terminal && !archived && <button className="btn btn-ghost wf-retry-step" aria-label={`重试步骤 ${step.name}`} onClick={() => retry(step.id, step.name)} title={live ? '再次向服务商请求，可能再次收费' : '新增模拟调用与费用'}><RotateCcw size={13} />重试此步</button>}</div>;
    })}</div>}{run.retryStepOnly && <div className="wf-retry-notice"><RotateCcw size={13} /><span>{run.status === 'complete' ? '本次仅完成单步重试，后续步骤未重新运行；已有结果和历史费用仍保留。' : '本次仅重试所选步骤，后续步骤不会自动重新运行。'}</span></div>}
    <footer><span><ShieldCheck size={13} />{live ? '每次重试独立计费，返回用量后自动累计花费' : '演示费用按尝试累计，历史记录保留'}</span><div><TaskRunActions run={run} runner={props.workflowRunner} notify={props.notify} />{!archived && <>{run.status === 'running' && <button className="btn btn-secondary" disabled={run.pauseRequested} onClick={() => props.workflowRunner.pause(run.id)}><CirclePause size={14} />{run.pauseRequested ? '正在暂停…' : '暂停'}</button>}{run.status === 'paused' && <button className="btn btn-primary" onClick={() => live ? continueRun() : props.workflowRunner.resume(run.id)}><Play size={14} />继续运行</button>}{run.status === 'waiting-review' && (editableReview ? <><button className="btn btn-primary" onClick={() => props.navigate('documents', run.projectId)}><Pencil size={14} />编辑并交付</button><details className="wf-advanced-settings"><summary>更多检查操作</summary><p>使用原结果继续不会采用尚未绑定的人工编辑稿，后续步骤按原工作流执行。</p><button className="btn btn-secondary" onClick={() => props.workflowRunner.resume(run.id)}>使用原结果继续</button></details></> : <button className="btn btn-primary" onClick={() => props.workflowRunner.resume(run.id)}><Check size={14} />确认通过，继续</button>)}{live && (run.status === 'failed' || run.status === 'interrupted') && <button className="btn btn-primary" onClick={continueRun}><Play size={14} />从当前位置继续</button>}{!terminal && <button className="btn btn-secondary" onClick={() => props.workflowRunner.cancel(run.id)}><Square size={12} />取消运行</button>}{run.status === 'complete' && project && project.status !== 'complete' && <button className="btn btn-secondary" onClick={() => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)}><Check size={13} />验收并交付当前版本</button>}</>}<button className="btn btn-ghost" onClick={() => props.navigate(project?.kind === 'image' ? 'images' : 'documents', run.projectId)}>查看项目<ArrowRight size={13} /></button></div></footer>
    {confirmation && <WorkflowDialog title={confirmation.action === 'retry' ? '确认单步重试' : '确认继续执行'} subtitle={confirmation.name} className="wf-charge-dialog" onClose={() => setConfirmation(null)} footer={<><button className="btn btn-secondary" onClick={() => setConfirmation(null)}>取消</button><button className="btn btn-primary" disabled={!acknowledged} onClick={confirm}>确认，接受可能再次收费</button></>}><div className="wf-charge-body"><AlertCircle size={28} /><p>{confirmation.action === 'retry' ? '会重新向该步骤配置的服务商发送请求，可能再次收费；后续步骤不会自动重新执行。' : run.status === 'paused' ? '会从暂停位置继续当前及后续步骤，新的请求可能产生费用。' : '会从失败或中断位置重新尝试，然后继续后续步骤，可能再次收费。'}</p><p>会保留本次运行的步骤参数；相同 ID 的模型、连接和凭证使用当前配置。修改了流程模板中的提示词或尺寸时，请重新运行流程。之前发生的费用仍保留，超时或中断不代表供应商未计费。</p>{confirmation.action === 'continue' && <div className="wf-continue-budget"><label className="wf-field"><span>当前步骤金额上限（元，选填）</span><input className="field" aria-label="继续执行当前步骤金额上限" type="number" min="0" step="0.01" value={continueBudget} placeholder="选填，留空不设上限" onChange={event => { setContinueBudget(event.target.value); setContinueBudgetError(''); }} /><small>留空会清除本次运行当前步骤上限，填写 0 表示零上限。已保存流程模板、项目上限及其它提示词与参数保持不变。</small></label><p>项目金额上限独立保留：<b>{budgetLabel(project?.budgetCents)}</b></p>{continueBudgetError && <p className="form-error" role="alert">{continueBudgetError}</p>}</div>}<label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我已检查现有记录，接受重新发送请求可能产生的费用。</label></div></WorkflowDialog>}
  </section>;
}

export function Workflows(props: PageProps) {
  const [taskScope, setTaskScope] = useState<TaskScope>('visible');
  const visibleRuns = scopedTaskRuns(props.workflowRunner.runs, taskScope);
  const [tab, setTab] = useState<'library' | 'runs' | 'batch'>('library');
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
  useEffect(() => { if (previousWorkspace.current === props.workspaceId) return; previousWorkspace.current = props.workspaceId; setTab('library'); setTaskScope('visible'); setQuery(''); setCategory('all'); setOutputKind('all'); setEditor(null); setToRun(null); setPendingRun(null); }, [props.workspaceId]);
  useEffect(() => {
    if (!pendingRun) return;
    const workflow = workflows.find(item => item.id === pendingRun.workflowId);
    if (!workflow) return;
    setToRun({ workflow, context: pendingRun.context }); setPendingRun(null);
  }, [pendingRun, workflows]);
  const running = props.workflowRunner.runs.filter(run => ['running', 'paused', 'waiting-review'].includes(run.status)).length;
  return <div className="wf-page wf-library-page"><div className="page-heading"><div><h1 className="page-title">我的工作流</h1><p className="page-description">保存常用步骤。下次只需选择项目、填写本次需求，再开始制作。</p></div><button className="btn btn-primary" onClick={() => setEditor({ draft: blankWorkflow(props) })}><Plus size={16} />新建工作流</button></div>
    <div className="wf-tabs-row"><div className="tabs wf-tabs"><button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><Layers3 size={15} />我的流程<span>{workflows.length}</span></button><button className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}>批量制作</button><button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}><ListOrdered size={15} />运行记录{running > 0 && <i>{running} 个进行中</i>}</button></div><span className="wf-workspace-note"><ShieldCheck size={13} />{props.workspace.name}</span></div>
    {tab === 'batch' ? <BatchProductionPanel workspaceId={props.workspaceId} workflows={workflows} projects={props.projects} configuration={props.configuration} ledger={props.ledger} notify={props.notify} onProjectsCreated={props.onBatchProjectsCreated} onOpenProject={project => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} /> : tab === 'library' ? <><details className="wf-starter-disclosure" open={!workflows.length}><summary><Sparkles size={16} />从示例开始<span>先保存，再运行；不会立即产生费用</span></summary><div className="wf-starters"><button onClick={() => setEditor({ draft: blankWorkflow(props) })}><span><Plus size={21} /></span><div><strong>从空白开始</strong><small>自由组合你的工作步骤</small></div><ArrowRight size={15} /></button><button onClick={() => setEditor({ draft: exampleWorkflow('document', props) })}><span className="wf-starter-blue"><FileText size={21} /></span><div><strong>图文演示示例</strong><small>配图 → 正文 → PPT成品 → 检查</small></div><ArrowRight size={15} /></button><button onClick={() => setEditor({ draft: exampleWorkflow('product', props) })}><span className="wf-starter-peach"><WandSparkles size={21} /></span><div><strong>商品宣传示例</strong><small>卖点 → 视觉 → 检查 → 交付</small></div><ArrowRight size={15} /></button></div></details><div className="wf-library-toolbar"><label className="wf-search"><Search size={16} /><input aria-label="搜索工作流" placeholder="搜索工作流名称或说明…" value={query} onChange={event => setQuery(event.target.value)} /></label><Select className="field" aria-label="筛选工作流分类" value={category} onValueChange={setCategory} options={[{ value: 'all', label: '全部业务分类' }, { value: 'none', label: '未分类' }, ...choices.map(item => ({ value: item.id, label: item.label }))]} /><Select className="field" aria-label="筛选工作流作品类型" value={outputKind} onValueChange={setOutputKind} options={[{ value: 'all', label: '全部作品类型' }, ...(['ppt', 'word', 'excel', 'image'] as const).map(kind => ({ value: kind, label: KIND_LABEL[kind] }))]} /><span>{filtered.length} 个流程</span></div>
      {filtered.length ? <div className="wf-library-list">{filtered.slice(0, visibleWorkflowCount).map(workflow => {
        const summary = workflowConfigurationSummary(workflow, props.configuration);
        const matches = props.projects.filter(project => project.kind === workflow.outputKind);
        return <article className="panel wf-flow-row" key={workflow.id}>
          <header><span className="wf-flow-icon"><StepIcon kind={workflow.outputKind === 'image' ? 'image-generation' : 'text'} size={22} /></span><div><h2>{workflow.name}</h2><p>{workflow.description || '按自己的习惯安排创作步骤。'}</p></div><span className="wf-output-kind">{KIND_LABEL[workflow.outputKind]}</span></header>
          <ol className="wf-readable-sequence" aria-label={`${workflow.name}的步骤`}>{summary.enabled.slice(0, 5).map((step, index) => <li key={step.id}><span>{index + 1}</span>{step.name}</li>)}{summary.enabled.length > 5 && <li>另 {summary.enabled.length - 5} 步</li>}</ol>
          <div className="wf-flow-readiness"><span className={summary.ready ? 'ready' : 'needs-setup'}>{summary.ready ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{summary.ready ? '本地配置已就绪' : summary.issues[0].message}</span><small>{summary.ready ? '运行时自动预检接口与输入' : summary.issues.length > 1 ? `另有 ${summary.issues.length - 1} 项待设置` : '运行前可以直接补全'}</small></div>
          <footer><span>{choices.find(item => item.id === workflow.businessCategoryId)?.label || '未分类'} · {summary.enabled.length} 步</span><button className="btn-icon" aria-label={`复制工作流 ${workflow.name}`} title="保存一份副本" onClick={() => props.configuration.duplicateWorkflow(workflow.id)}><Copy size={15} /></button><button className="btn btn-secondary" onClick={() => setEditor({ draft: structuredClone(workflow), id: workflow.id })}><Pencil size={14} />编辑流程</button><button className="btn btn-primary" onClick={() => { if (!matches.length) { props.onCreateProject(workflow.outputKind); return; } setToRun({ workflow: summary.workflow }); }}><Play size={14} />{matches.length ? '使用此流程' : '先创建项目'}</button></footer>
        </article>;
      })}{filtered.length > visibleWorkflowCount && <div className="wf-library-load-more"><span>已显示 {Math.min(visibleWorkflowCount, filtered.length)} / {filtered.length} 个流程</span><button className="btn btn-secondary" onClick={() => setVisibleWorkflowCount(value => value + 20)}>再显示 {Math.min(20, filtered.length - visibleWorkflowCount)} 个流程</button></div>}</div> : <div className="panel wf-empty"><GitBranch size={35} /><h3>{query || category !== 'all' || outputKind !== 'all' ? '没有找到匹配的工作流' : '把你的第一个流程搭起来'}</h3><p>{query || category !== 'all' || outputKind !== 'all' ? '试试其他关键词或业务分类。' : '选择上方示例调整，或从空白开始。保存后可反复使用，模型和 Key 会优先带入可用配置。'}</p><button className="btn btn-secondary" onClick={() => { if (query || category !== 'all' || outputKind !== 'all') { setQuery(''); setCategory('all'); setOutputKind('all'); } else setEditor({ draft: blankWorkflow(props) }); }}>{query || category !== 'all' || outputKind !== 'all' ? '清除筛选' : '新建我的工作流'}</button></div>}</> : <div className="wf-run-list"><TaskScopeFilter runs={props.workflowRunner.runs} value={taskScope} onChange={setTaskScope} />{visibleRuns.length ? <TaskRunList key={`${props.workspaceId}-${taskScope}`} runs={visibleRuns} renderRun={run => <WorkflowRunCard props={props} run={run} />} /> : <div className="panel wf-empty"><ListOrdered size={35} /><h3>{taskScope === 'visible' ? '当前没有显示的任务' : taskScope === 'hidden' ? '没有已隐藏任务' : '任务回收站为空'}</h3><p>隐藏和回收只整理任务记录，历史费用与生成文件始终保留。</p><button className="btn btn-secondary" onClick={() => setTab('library')}>返回流程库<ArrowRight size={14} /></button></div>}</div>}
    <div className="wf-page-note"><ShieldCheck size={14} /><span>保存流程与填写参数不调用模型。真实运行前会核对接口能力与凭证；当前未适配的协议会阻止执行，不代表所有供应商和模态已经联通。</span></div>{editor && <WorkflowEditor props={props} initial={editor.draft} workflowId={editor.id} initialStepId={editor.resume?.focusStepId} initialField={editor.resume?.focusField} onClose={() => { if (editor.id && editor.resume) setPendingRun({ workflowId: editor.id, context: editor.resume }); setEditor(null); }} onSaved={editor.id && editor.resume ? () => setPendingRun({ workflowId: editor.id!, context: editor.resume! }) : !editor.id ? () => { setTab('library'); setQuery(''); setCategory('all'); setOutputKind('all'); setVisibleWorkflowCount(20); } : undefined} />}{toRun && <RunWorkflowDialog props={props} workflow={toRun.workflow} initial={toRun.context} onClose={() => setToRun(null)} onStarted={() => setTab('runs')} onEdit={context => { setEditor({ draft: structuredClone(toRun.workflow), id: toRun.workflow.id, resume: context }); setToRun(null); }} />}
  </div>;
}
