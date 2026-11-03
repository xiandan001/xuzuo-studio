import { hasManagedDialog } from '../lib/dialog-stack';
import { ModalPortal } from './ModalPortal';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, Check, Copy, ImagePlus, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { ImageUseTemplate, ImageUseTemplateDraft } from '../configuration-types';
import { availableImageUseTemplates, IMAGE_SIZES, useTemplateError } from '../lib/image-use-templates';
import { Select, isSelectInteraction } from './Select';
import './purpose-templates.css';

interface PurposeTemplatesProps {
  templates: ImageUseTemplate[];
  workspaceId: string;
  workspaceName: string;
  initialMode: 'create' | 'manage';
  onSave: (draft: ImageUseTemplateDraft, id?: string) => boolean;
  onDelete: (id: string) => boolean;
  onClose: () => void;
}
const emptyDraft = (): ImageUseTemplateDraft => ({ name: '', prompt: '', size: '1024x1024', background: 'auto', minReferences: 0, enabled: true });
function templateDraft(template: ImageUseTemplate, copy = false): ImageUseTemplateDraft {
  return { name: copy ? `${template.name.slice(0, 24)}（副本）` : template.name, prompt: template.prompt, size: template.size, background: template.background, minReferences: template.minReferences, enabled: copy || template.enabled };
}

export function PurposeTemplates({ templates, workspaceId, workspaceName, initialMode, onSave, onDelete, onClose }: PurposeTemplatesProps) {
  const [editor, setEditor] = useState<{ id?: string; draft: ImageUseTemplateDraft } | null>(() => initialMode === 'create' ? { draft: emptyDraft() } : null);
  const [pendingDelete, setPendingDelete] = useState<ImageUseTemplate>();
  const [error, setError] = useState('');
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const local = templates.filter(item => item.workspaceId === workspaceId && !item.builtin);
  const rows = availableImageUseTemplates(local, workspaceId, true);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('input, textarea') || panel.current?.querySelector<HTMLElement>('button'))?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (isSelectInteraction(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]), [role="combobox"]:not([disabled])') || [])].filter(item => item.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (first && last && event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (first && last && !event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  useEffect(() => { if (pendingDelete) panel.current?.querySelector<HTMLButtonElement>('.purpose-delete button')?.focus(); }, [pendingDelete]);
  function edit(template?: ImageUseTemplate, copy = false) { setError(''); setPendingDelete(undefined); setEditor(template ? { id: copy ? undefined : template.id, draft: templateDraft(template, copy) } : { draft: emptyDraft() }); }
  function change(changes: Partial<ImageUseTemplateDraft>) { setEditor(value => value && { ...value, draft: { ...value.draft, ...changes } }); setError(''); }
  function save(event: FormEvent) {
    event.preventDefault(); if (!editor) return;
    const message = useTemplateError(templates, workspaceId, editor.draft, editor.id);
    if (message) { setError(message); return; }
    if (onSave(editor.draft, editor.id)) { setEditor(null); setError(''); }
    else setError('用途暂未保存，请检查名称或当前工作区。');
  }
  function remove() {
    if (!pendingDelete) return;
    if (onDelete(pendingDelete.id)) { if (editor?.id === pendingDelete.id) setEditor(null); setPendingDelete(undefined); }
  }
  return <ModalPortal onClose={onClose}><div className="purpose-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={panel} className="purpose-dialog" role="dialog" aria-modal="true" aria-label={editor ? editor.id ? '编辑用途模板' : '新增用途模板' : '管理用途模板'}>
    <header><span><ImagePlus size={22} /></span><div><h2>{editor ? editor.id ? '编辑用途模板' : '新增用途模板' : '管理用途模板'}</h2><p>{workspaceName} · 自定义用途仅在当前工作区可用</p></div><button className="btn-icon" aria-label="关闭用途模板" onClick={onClose}><X size={20} /></button></header>
    <div className="purpose-body">{editor ? <form id="purpose-template-form" onSubmit={save}>
      <button type="button" className="purpose-back" onClick={() => { setEditor(null); setError(''); }}><ArrowLeft size={15} />返回用途列表</button>
      <label className="purpose-field"><span>用途名称 <b>*</b></span><input autoFocus className="field" aria-label="用途模板名称" value={editor.draft.name} maxLength={30} placeholder="例如：电商商品主图" onChange={event => change({ name: event.target.value })} /></label>
      <label className="purpose-field"><span>默认画面描述 <b>*</b></span><textarea className="field" aria-label="用途模板默认描述" rows={5} value={editor.draft.prompt} maxLength={10000} placeholder="写下此用途常用的主体、构图、风格及检查要求。" onChange={event => change({ prompt: event.target.value })} /><small>选择用途后主动应用默认描述，已有项目文字不会被自动替换。</small></label>
      <div className="purpose-fields"><label className="purpose-field"><span>默认尺寸</span><Select className="field" aria-label="用途模板默认尺寸" value={editor.draft.size} onValueChange={size => change({ size })} options={IMAGE_SIZES} /></label><label className="purpose-field"><span>默认背景</span><Select className="field" aria-label="用途模板默认背景" value={editor.draft.background} onValueChange={value => change({ background: value as ImageUseTemplateDraft['background'] })} options={[{ value: 'auto', label: '自动' }, { value: 'opaque', label: '不透明背景' }, { value: 'transparent', label: '透明 PNG 背景' }]} /></label></div>
      <label className="purpose-field"><span>最少参考图片</span><Select className="field" aria-label="用途模板最少参考图" value={String(editor.draft.minReferences)} onValueChange={value => change({ minReferences: Number(value) })} options={Array.from({ length: 13 }, (_, value) => ({ value: String(value), label: value ? `至少 ${value} 张` : '不要求参考图' }))} /><small>例如试衣用途可要求人物与服装两张图，数量不足时不能直接生成。</small></label>
      <label className="purpose-enabled"><input type="checkbox" checked={editor.draft.enabled} onChange={event => change({ enabled: event.target.checked })} />在用途下拉中显示</label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form> : <><div className="purpose-list-heading"><span>我的用途 <b>{local.length}</b> · 内置 {rows.length - local.length}</span><button className="btn btn-primary" onClick={() => edit()}><Plus size={15} />新增用途</button></div>
      {!local.length && <p className="purpose-empty">还没有自定义用途。可以新建，或复制下方的内置用途调整。</p>}
      {pendingDelete && <div className="purpose-delete" role="alert"><strong>删除“{pendingDelete.name}”？</strong><p>只移除当前工作区的用途模板。项目描述、参数、参考图、产物与费用继续保留。</p><div><button className="btn btn-secondary" onClick={() => setPendingDelete(undefined)}>保留模板</button><button className="btn btn-secondary" onClick={remove}>确认删除用途</button></div></div>}
      <div className="purpose-list">{[...local, ...rows.filter(item => item.builtin)].map(template => <article key={template.id} className={!template.enabled ? 'is-disabled' : ''}><div><strong>{template.name}<span>{template.builtin ? '内置' : template.enabled ? '自定义' : '已停用'}</span></strong><p>{template.prompt}</p><small>{IMAGE_SIZES.find(item => item.value === template.size)?.label} · {template.background === 'transparent' ? '透明背景' : template.background === 'opaque' ? '不透明背景' : '自动背景'} · {template.minReferences ? `至少 ${template.minReferences} 张参考图` : '参考图可选'}</small></div><div className="purpose-row-actions"><button className="btn-icon" aria-label={`复制用途 ${template.name}`} title="复制为自定义用途" onClick={() => edit(template, true)}><Copy size={16} /></button>{!template.builtin && <><button className="btn-icon" aria-label={`编辑用途 ${template.name}`} onClick={() => edit(template)}><Pencil size={16} /></button><button className="btn-icon" aria-label={`删除用途 ${template.name}`} onClick={() => setPendingDelete(template)}><Trash2 size={16} /></button></>}</div></article>)}</div>
    </>}</div><footer><span><ShieldCheck size={14} />保存用途不调用模型，不增加费用</span><button className="btn btn-secondary" onClick={onClose}>关闭</button>{editor && <button className="btn btn-primary" form="purpose-template-form" type="submit"><Check size={16} />保存用途模板</button>}</footer>
  </section></div></ModalPortal>;
}
