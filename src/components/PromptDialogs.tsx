import { hasManagedDialog } from '../lib/dialog-stack';
import { ModalPortal } from './ModalPortal';
import { Select, isSelectInteraction } from './Select';
import { ExampleTextarea } from './ExampleTextarea';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Braces, Check, CircleHelp, FileText, Image, Info, LayoutTemplate, Pencil, Plus, Search, ShieldCheck, Sparkles, WandSparkles, X } from 'lucide-react';
import type { PromptCategory, PromptDraft, PromptTemplate } from '../types';
import type { BusinessCategory, ImageUseTemplate } from '../configuration-types';
import { BusinessCategorySelect } from './BusinessCategorySelect';
import { PROMPT_CATEGORY_LABELS } from '../prompt-data';
import { extractVariables, resolvePrompt } from '../lib/prompt-variables';
import { availableImageUseTemplates } from '../lib/image-use-templates';
import '../pages/prompts.css';

const CATEGORY_ORDER: PromptCategory[] = ['ppt', 'word', 'excel', 'image', 'general'];
const EXAMPLES: Record<string, string> = {
  主题: '山野咖啡品牌提案', 受众: '希望了解品牌定位的合作伙伴', 风格: '自然简约、温暖克制、层次清楚',
  整理要求: '统一字段格式，标注缺失与重复，保留原始值对照', 计算目标: '按项目状态汇总数量，空白行不参与统计',
  人物描述: '一位原创虚构成年人物', 场景: '自然光下的简洁室内', 角色描述: '戴绿色围巾的原创小橘猫',
  情绪或动作: '开心挥手', 主体描述: '轮廓简洁的原创小橘猫', 主色调: '柔和橙色与浅米色',
  用途: '短视频画面中的装饰元素', 修改范围: '当前页面的标题与正文', 修改目标: '精简重复表达，提高信息层次',
};

function ModalFrame({ title, subtitle, icon, children, footer, onClose, wide = false }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('input:not([aria-hidden="true"]), textarea, [role="combobox"]:not([disabled]), [data-pr-primary]')?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if ((event.key === 'Escape' || event.key === 'Tab') && isSelectInteraction(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  return <ModalPortal onClose={onClose}><div className="pr-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={panel} className={`pr-dialog ${wide ? 'pr-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="pr-dialog-header"><span className="pr-dialog-icon">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div><button className="btn-icon" onClick={onClose} aria-label={`关闭${title}`}><X size={20} /></button></header>{children}{footer && <footer className="pr-dialog-footer">{footer}</footer>}</section></div></ModalPortal>;
}

function CategoryMark({ category }: { category: PromptCategory }) {
  const Icon = category === 'image' ? Image : category === 'general' ? WandSparkles : FileText;
  return <span className={`pr-category-mark pr-category-${category}`}><Icon size={16} /></span>;
}

export interface PromptPickerProps {
  prompts: PromptTemplate[];
  useTemplates?: ImageUseTemplate[];
  category?: PromptCategory;
  onClose: () => void;
  onUse: (template: PromptTemplate, resolvedContent: string) => void;
}

export function PromptPicker({ prompts, useTemplates = [], category, onClose, onUse }: PromptPickerProps) {
  const available = useMemo(() => prompts.filter(prompt => !category || prompt.category === category || prompt.category === 'general'), [prompts, category]);
  const [selected, setSelected] = useState<PromptTemplate | null>(() => available.length === 1 ? available[0] : null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | 'all'>('all');
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<'resolved' | 'template'>('resolved');
  const [error, setError] = useState('');
  const variables = selected ? extractVariables(selected.content) : [];
  const resolution = resolvePrompt(selected?.content ?? '', values);
  const selectedPurpose = selected?.imagePreset ? availableImageUseTemplates(useTemplates, undefined, true).find(item => item.id === selected.imagePreset)?.name || '原用途已删除' : undefined;
  const filtered = available.filter(prompt => (categoryFilter === 'all' || prompt.category === categoryFilter) && `${prompt.name} ${prompt.description} ${prompt.content}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    if (!selected) return;
    const current = available.find(prompt => prompt.id === selected.id);
    if (!current) { setSelected(null); setValues({}); setError(''); }
    else if (current !== selected) setSelected(current);
  }, [available, selected]);

  function choose(prompt: PromptTemplate) { setSelected(prompt); setValues({}); setPreview('resolved'); setError(''); }
  function apply() {
    if (!selected) return;
    if (!resolution.complete) { setError(`请先填写：${resolution.missing.join('、')}`); return; }
    onUse(selected, resolution.content);
    onClose();
  }
  const footer = selected ? <><span className="pr-footer-note"><ShieldCheck size={14} />应用只填入工作台，0 API费用</span><button className="btn btn-secondary" onClick={onClose}>取消</button><button data-pr-primary className="btn btn-primary" disabled={!resolution.complete} onClick={apply}><Check size={15} />应用到工作台</button></> : <><span className="pr-footer-note"><Info size={14} />先选模板，再填写本次创作变量</span><button className="btn btn-secondary" onClick={onClose}>取消</button></>;
  return <ModalFrame title={selected ? '填写变量并应用' : '选择提示词模板'} subtitle={selected ? selected.name : '从内置和当前工作区模板中，选择一个创作起点。'} icon={<LayoutTemplate size={21} />} onClose={onClose} wide footer={footer}>
    {selected ? <div className="pr-resolve-layout"><section className="pr-template-detail"><div className="pr-detail-toolbar"><button className="pr-back-button" onClick={() => { setSelected(null); setValues({}); setError(''); }}><ArrowLeft size={14} />返回模板列表</button><span className="pr-source-badge">{selected.builtin ? '内置 · 只读' : '我的模板'}</span></div><div className="pr-detail-tags"><CategoryMark category={selected.category} /><span>{PROMPT_CATEGORY_LABELS[selected.category]}</span><span className="pr-detail-dot" /><span>{selected.mode === 'create' ? '用于创作' : '用于精修'}</span>{selectedPurpose && <span className="pr-soft-tag">{selectedPurpose}</span>}</div><p className="pr-template-description">{selected.description}</p><div className="pr-preview-tabs"><button className={preview === 'resolved' ? 'active' : ''} onClick={() => setPreview('resolved')}>应用预览</button><button className={preview === 'template' ? 'active' : ''} onClick={() => setPreview('template')}>原始模板</button></div><pre className="pr-prompt-text">{preview === 'template' ? selected.content : resolution.content}</pre><div className="pr-detail-info"><CircleHelp size={15} /><p>模板帮助组织要求，生成结果仍需你核对。使用模板不会自动开始生成或增加账单。</p></div></section><section className="pr-variable-panel"><div className="pr-variable-heading"><div><Braces size={16} /><h3>本次创作变量</h3></div><span>{variables.length ? `${variables.length - resolution.missing.length} / ${variables.length}` : '无需填写'}</span></div>{variables.length > 0 ? <><p>带 <b>*</b> 的字段填完后，即可应用。</p><button className="pr-example-button" onClick={() => { setValues(Object.fromEntries(variables.map(name => [name, EXAMPLES[name] ?? `这里填写${name}`]))); setError(''); }}><Sparkles size={13} />填入示例，再自行调整</button><div className="pr-variable-fields">{variables.map((name, index) => <label className="pr-form-label" key={name}><span>{name}<b>*</b></span><ExampleTextarea autoFocus={index === 0} className="field" rows={name === '主题' || name === '受众' || name === '风格' ? 2 : 3} placeholder={EXAMPLES[name] ? `例如：${EXAMPLES[name]}` : `请填写${name}`} example={EXAMPLES[name]} value={values[name] ?? ''} maxLength={3000} onValueChange={value => { setValues(previous => ({ ...previous, [name]: value })); setError(''); }} /></label>)}</div><div className={`pr-variable-status ${resolution.complete ? 'complete' : ''}`}>{resolution.complete ? <Check size={14} /> : <Info size={14} />}<span>{resolution.complete ? '变量已填齐，可以应用' : `还有 ${resolution.missing.length} 项待填写`}</span></div></> : <div className="pr-no-variables"><Check size={26} /><strong>这条模板可以直接使用</strong><p>应用后还可以在工作台里继续调整。</p></div>}{error && <p className="pr-form-error" role="alert">{error}</p>}</section></div> : <div className="pr-picker-body"><div className="pr-picker-toolbar"><label className="pr-search"><Search size={16} /><input autoFocus aria-label="搜索可用提示词" placeholder="搜索模板名称、描述或内容…" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="pr-select"><Select aria-label="筛选可用提示词分类" value={categoryFilter} onValueChange={value => setCategoryFilter(value as PromptCategory | 'all')} options={[{ value: 'all', label: '全部可用分类' }, ...CATEGORY_ORDER.filter(item => available.some(prompt => prompt.category === item)).map(item => ({ value: item, label: PROMPT_CATEGORY_LABELS[item] }))]} /></label></div><div className="pr-picker-list">{filtered.length ? filtered.map(prompt => <button className="pr-picker-item" key={prompt.id} onClick={() => choose(prompt)}><CategoryMark category={prompt.category} /><div><strong>{prompt.name}</strong><p>{prompt.description}</p><span>{PROMPT_CATEGORY_LABELS[prompt.category]} · {prompt.mode === 'create' ? '创作' : '精修'} · {extractVariables(prompt.content).length} 个变量</span></div><em>{prompt.builtin ? '内置' : '我的'}</em><ArrowRight size={16} /></button>) : <div className="pr-picker-empty"><Search size={30} /><strong>没有找到匹配的模板</strong><p>试试其他关键词，或清除筛选。</p><button className="btn btn-secondary" onClick={() => { setQuery(''); setCategoryFilter('all'); }}>清除筛选</button></div>}</div><div className="pr-picker-caption">{filtered.length} 条可用模板 · 内置模板通用，自定义模板由当前工作区提供</div></div>}
  </ModalFrame>;
}

export interface PromptEditorProps {
  categories?: BusinessCategory[];
  useTemplates?: ImageUseTemplate[];
  initial?: PromptDraft;
  templateId?: string;
  onClose: () => void;
  onSave: (draft: PromptDraft, id?: string) => void;
}

export function PromptEditor({ initial, templateId, categories = [], useTemplates = [], onClose, onSave }: PromptEditorProps) {
  const [draft, setDraft] = useState<PromptDraft>(() => initial ? { ...initial } : { name: '', description: '', category: 'general', mode: 'create', content: '' });
  const [error, setError] = useState('');
  const variables = extractVariables(draft.content);
  const formId = 'pr-prompt-editor-form';
  const imagePurposes = availableImageUseTemplates(useTemplates);
  const imageOptions = [{ value: '', label: '通用图像' }, ...imagePurposes.map(item => ({ value: item.id, label: item.name })), ...(draft.imagePreset && !imagePurposes.some(item => item.id === draft.imagePreset) ? [{ value: draft.imagePreset, label: '原用途（已删除或停用）', disabled: true }] : [])];
  function update<K extends keyof PromptDraft>(key: K, value: PromptDraft[K]) { setDraft(previous => ({ ...previous, [key]: value })); setError(''); }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.description.trim() || !draft.content.trim()) { setError('请填写模板名称、简短描述和提示词正文。'); return; }
    if (!CATEGORY_ORDER.includes(draft.category) || !['create', 'refine'].includes(draft.mode)) { setError('请选择有效的分类和用途。'); return; }
    if (/{{\s*}}/.test(draft.content)) { setError('发现空白变量，请在双花括号内填写变量名。'); return; }
    onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim(), content: draft.content.trim().replace(/\r\n?/g, '\n'), imagePreset: draft.category === 'image' ? draft.imagePreset || undefined : undefined }, templateId);
    onClose();
  }
  return <ModalFrame title={templateId ? '编辑我的提示词' : '新建自定义提示词'} subtitle="保存到当前工作区，后续创作时可以反复使用。" icon={templateId ? <Pencil size={20} /> : <Plus size={22} />} onClose={onClose} wide footer={<><span className="pr-footer-note"><ShieldCheck size={14} />本地保存 · 0 API费用</span><button className="btn btn-secondary" onClick={onClose}>取消</button><button data-pr-primary className="btn btn-primary" type="submit" form={formId}><Check size={15} />{templateId ? '保存修改' : '保存到工作区'}</button></>}>
    <form className="pr-editor-body" id={formId} onSubmit={save}><div className="pr-editor-layout"><section className="pr-editor-meta"><label className="pr-form-label"><span>模板名称<b>*</b></span><input autoFocus className="field" value={draft.name} maxLength={60} placeholder="例如：我的品牌提案流程" onChange={event => update('name', event.target.value)} /></label><div className="pr-editor-two-fields"><label className="pr-form-label"><span>适用分类<b>*</b></span><Select className="field" aria-label="适用分类" value={draft.category} onValueChange={value => { update('category', value as PromptCategory); setDraft(previous => ({ ...previous, imagePreset: undefined })); }} options={CATEGORY_ORDER.map(category => ({ value: category, label: PROMPT_CATEGORY_LABELS[category] }))} /></label><label className="pr-form-label"><span>使用位置<b>*</b></span><Select className="field" aria-label="使用位置" value={draft.mode} onValueChange={value => update('mode', value as PromptDraft['mode'])} options={[{ value: 'create', label: '创作需求' }, { value: 'refine', label: 'AI 精修' }]} /></label></div>{draft.category === 'image' && <label className="pr-form-label"><span>图像类型</span><Select className="field" aria-label="图像类型" value={draft.imagePreset ?? ''} onValueChange={value => update('imagePreset', value || undefined)} options={imageOptions} /></label>}<BusinessCategorySelect categories={categories} value={draft.businessCategoryId || ''} onChange={value => update('businessCategoryId', value || undefined)} label="模板业务分类" /><label className="pr-form-label"><span>简短描述<b>*</b></span><textarea className="field" rows={3} value={draft.description} maxLength={180} placeholder="这条模板适合什么场景，能帮你完成什么？" onChange={event => update('description', event.target.value)} /></label><div className="pr-editor-help"><Braces size={17} /><div><strong>把变化的部分做成变量</strong><p>用 <code>{'{{主题}}'}</code>、<code>{'{{受众}}'}</code> 或 <code>{'{{风格}}'}</code> 标记。每次应用时填写，同名变量只需填一次。</p></div></div><div className="pr-editor-scope"><ShieldCheck size={15} /><p>内置模板不会被覆盖。自定义内容仅保存在当前工作区，不包含真实密钥。</p></div></section><section className="pr-editor-content"><div className="pr-content-label"><label htmlFor="pr-prompt-content">提示词正文 <b>*</b></label><span>{draft.content.length} / 10000</span></div><textarea id="pr-prompt-content" className="field pr-content-textarea" maxLength={10000} value={draft.content} onChange={event => update('content', event.target.value)} placeholder={'请为{{主题}}制作一份面向{{受众}}的内容，风格为{{风格}}。\n\n说明输出结构、保留哪些信息、需要检查什么，以及哪些内容应标为待确认。'} /><div className="pr-detected-variables"><span><Braces size={13} />已识别变量</span><div>{variables.length ? variables.map(variable => <code key={variable}>{`{{${variable}}}`}</code>) : <small>尚未设置变量，也可以保存固定提示词。</small>}</div></div><div className="pr-editor-footnote"><Info size={14} />保存模板或填入工作台都不会自动调用模型。</div></section></div>{error && <p className="pr-form-error" role="alert">{error}</p>}</form>
  </ModalFrame>;
}
