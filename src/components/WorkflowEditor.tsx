import { WorkflowQualitySettings } from './WorkflowQualitySettings';
import { RememberedDetails } from './RememberedDetails';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Braces, Check, Layers3, ListOrdered, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ModelConfiguration, WorkflowDraft, WorkflowStep, WorkflowStepKind } from '../configuration-types';
import type { LivePreflightIssue } from '../live-types';
import { Select } from './Select';
import type { PageProps, ProjectKind } from '../types';
import { KIND_LABEL, parseOptionalBudget } from '../data';
import { studioCredential, workflowStepSelection, workflowSelections, WORKFLOW_OUTPUT_MIN, WORKFLOW_OUTPUT_MAX } from '../lib/studio-run';
import '../pages/workflows.css';
import { STEP_KINDS, isModelStep, kindLabel, StepIcon, categoryOptions, makeStep, normalizeSteps, WorkflowDialog } from './workflow-shared';

function availableModels(props: PageProps, kind: WorkflowStepKind): ModelConfiguration[] {
  if (!isModelStep(kind)) return [];
  return props.configuration.models.filter(model => model.enabled && model.capabilities.includes(kind) && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled));
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


function StepSettings({ props, step, index, firstEnabledIndex, priorContentSteps, priorSteps = priorContentSteps, onChange, focusField, outputKind }: { props: PageProps; outputKind?: ProjectKind; step: WorkflowStep; index: number; firstEnabledIndex: number; priorContentSteps: WorkflowStep[]; priorSteps?: WorkflowStep[]; onChange: (changes: Partial<WorkflowStep>) => void; focusField?: LivePreflightIssue['field']; }) {
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
      <RememberedDetails rememberKey={`workflow-step:${step.id}:connections`} className="wf-step-connections" defaultOpen={!model || !step.credentialId && !model.demo}><summary><span>{model && (step.credentialId || model.demo) ? `已带入：${model.name}` : '选择这一步的模型和 Key'}</span><small>展开调整</small></summary>      <label className="wf-field"><span>使用模型</span><Select className="field" aria-label="步骤模型" value={step.modelConfigId || ''} onValueChange={value => { const next = models.find(item => item.id === value); onChange({ modelConfigId: next?.id, credentialId: next && !next.demo ? studioCredential(props.configuration.credentials, next.connectionId, step.credentialId) : undefined }); }} options={[{ value: '', label: '请选择匹配能力的模型' }, ...models.map(item => ({ value: item.id, label: `${item.name}${item.demo ? ' · 仅模拟' : ''}` }))]} />{!models.length && <small className="wf-warning">没有可用模型。请先到“模型与连接”配置具备{kindLabel(step.kind)}能力的模型。</small>}</label>
      <label className="wf-field"><span>API 凭证</span><Select className="field" aria-label="步骤 API 凭证" value={step.credentialId || ''} disabled={!connection || !!connection.demo} onValueChange={value => onChange({ credentialId: value || undefined })} options={[{ value: '', label: '请选择 API Key' }, ...credentials.map(item => ({ value: item.id, label: `${item.name} · ••••${item.lastFour}` }))]} /><small>{connection?.demo ? '此模型仅支持模拟运行，不需要 API Key。' : '真实模式使用所选凭证，由桌面主进程发送请求；界面不会读取完整 Key。'}</small></label>
      </RememberedDetails>
      <label className="wf-field"><span>从提示词模板开始 <small>可选</small></span><Select className="field" aria-label="步骤提示词模板" value={step.promptTemplateId || ''} onValueChange={value => { const template = templates.find(item => item.id === value); onChange({ promptTemplateId: template?.id, ...(template ? { prompt: template.content } : {}) }); }} options={[{ value: '', label: '自己编写提示词' }, ...templates.map(template => ({ value: template.id, label: template.name }))]} /></label>
      <label className="wf-field"><span>这一步要做什么 <b>*</b></span><textarea className="field" aria-label="步骤提示词" rows={6} value={step.prompt} maxLength={10000} onChange={event => onChange({ prompt: event.target.value, promptTemplateId: undefined })} placeholder="例如：根据资料，整理{{主题}}的内容结构；不要编造未提供的事实。" /><small><Braces size={12} /> 使用 {'{{主题}}'} 等变量，运行前统一填写。</small></label>
      {step.kind === 'text' && (outputKind === 'ppt' || outputKind === 'word') && <label className="wf-field"><span>文档配图</span><Select className="field" aria-label="文档插图来源" value={step.documentImageSource || ''} onValueChange={value => onChange({ documentImageSource: value ? value as 'references' | 'previous' : undefined })} options={[{ value: '', label: '纯文字文稿' }, { value: 'references', label: '排入本次上传的参考图片' }, { value: 'previous', label: '排入上一步生成的图片' }]} /><small>本地自动排版并嵌入实际图片，不额外调用模型。选择上一步图片时，请将生图步骤放在正文步骤之前。</small></label>}
      <RememberedDetails rememberKey={`workflow-step:${step.id}:advanced`} className="wf-advanced-settings"><summary>高级参数 · 输出长度、尺寸与金额上限</summary>
      <WorkflowQualitySettings step={step} priorSteps={priorSteps} onChange={onChange} />
      {(step.kind === 'text' || step.kind === 'vision' || step.kind === 'video-understanding') && <label className="wf-field"><span>最大输出 Token 数</span><input className="field" aria-label="最大输出 Token 数" type="number" min={WORKFLOW_OUTPUT_MIN} max={WORKFLOW_OUTPUT_MAX} step="1" value={step.maxOutputTokens ?? 2048} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value)) onChange({ maxOutputTokens: value }); }} /><small>本工作流支持 16–16384 Token，具体型号可能有更低上限。</small></label>}
      {(step.kind === 'image-generation' || step.kind === 'image-editing') && <div className="wf-image-parameters"><div className="wf-two-fields"><label className="wf-field"><span>图片尺寸</span><Select className="field" aria-label="工作流图片尺寸" value={step.imageSize || '1024x1024'} onValueChange={value => onChange({ imageSize: value })} options={['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'].map(size => ({ value: size, label: size }))} /></label><label className="wf-field"><span>图片数量</span><Select className="field" aria-label="工作流图片数量" value={String(step.count || 1)} onValueChange={value => onChange({ count: Number(value) })} options={[1, 2, 4].map(count => ({ value: String(count), label: `${count} 张` }))} /></label></div><label className="wf-field"><span>背景</span><Select className="field" aria-label="工作流图片背景" value={step.imageBackground || 'auto'} onValueChange={value => onChange({ imageBackground: value as WorkflowStep['imageBackground'] })} options={[{ value: 'auto', label: '自动' }, { value: 'opaque', label: '不透明背景' }, { value: 'transparent', label: '透明背景' }]} /><small>尺寸、数量和透明输出须由该模型实际支持，调用前会预检接口能力。</small></label></div>}
      {step.kind === 'video-generation' && <label className="wf-field"><span>视频尺寸</span><Select className="field" aria-label="工作流视频尺寸" value={['1280x720', '720x1280', '960x960'].includes(step.imageSize || '') ? step.imageSize! : '1280x720'} onValueChange={value => onChange({ imageSize: value })} options={['1280x720', '720x1280', '960x960'].map(size => ({ value: size, label: size }))} /><small>具体服务商、模型及异步接口是否适配，以运行预检为准。</small></label>}
      {step.kind === 'speech' && <label className="wf-field"><span>语音名称</span><input className="field" aria-label="工作流语音名称" maxLength={80} value={step.voice || 'alloy'} onChange={event => onChange({ voice: event.target.value })} placeholder="复制服务商支持的 voice 名称" /><small>填写所选语音模型支持的声音标识。</small></label>}
      <label className="wf-field"><span>本步骤金额上限（元，选填）</span><input className="field" aria-label="步骤金额上限" type="number" min="0" step="0.01" placeholder="选填，留空不设上限" value={step.budgetCents == null ? '' : step.budgetCents / 100} onChange={event => { try { const budgetCents = parseOptionalBudget(event.target.value); event.currentTarget.setCustomValidity(''); onChange({ budgetCents }); } catch (error) { event.currentTarget.setCustomValidity(error instanceof Error ? error.message : '请填写有效金额或留空。'); } }} /><small>留空不限制本步骤，填写 0 表示零上限；实际费用仍按每次调用累计。</small></label>
      </RememberedDetails>
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
    </section><div className="wf-editor-inspector">{selected ? <StepSettings props={props} outputKind={draft.outputKind} step={selected} index={index} firstEnabledIndex={firstEnabledIndex} priorSteps={draft.steps.slice(0, index).filter(step => step.enabled)} priorContentSteps={draft.steps.slice(0, index).filter(step => step.enabled && !['planner', 'reviewer'].includes(step.role || '') && (step.kind === 'text' || step.kind === 'transcription'))} onChange={changeStep} focusField={focus.stepId === selectedId ? focus.field : undefined} /> : <div className="wf-inspector-empty"><Layers3 size={32} /><h3>从一个步骤开始</h3><p>在左侧选择类型并添加，逐步搭好你的工作流。</p></div>}</div>{error && <p className="wf-editor-error" role="alert">{error}</p>}</form>
  </WorkflowDialog>;
}
