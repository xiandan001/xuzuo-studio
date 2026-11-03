import { useState } from 'react';
import { Check, Folder, FolderPlus, Layers3, MoreHorizontal, Shapes, Trash2, X } from 'lucide-react';
import { BUILTIN_COLLECTIONS } from '../lib/builtin-assets';
import { workflowPublicError } from '../lib/studio-run';
import { ModalPortal } from './ModalPortal';

interface Category { id: string; name: string; }
interface Props { categories: Category[]; selected: string; collection: string; source: 'builtin' | 'mine'; enabled: boolean; busy: boolean; unavailableReason: string; onSelect: (id: string) => void; onCollection: (collection: string) => void; onSave: (category: { id?: string; name: string }) => Promise<void>; onRemove: (id: string) => Promise<void>; }
export function AssetCategorySidebar({ categories, selected, collection, source, enabled, busy, unavailableReason, onSelect, onCollection, onSave, onRemove }: Props) {
  const [editing, setEditing] = useState<{ id?: string; name: string }>(), [error, setError] = useState(''), [deleting, setDeleting] = useState(false), [saving, setSaving] = useState(false);
  const locked = busy || saving;
  function open(category?: Category) { setEditing(category ? { id: category.id, name: category.name } : { name: '' }); setError(''); setDeleting(false); }
  async function save() {
    if (!editing || locked) return;
    if (!editing.name.trim()) { setError('请填写分类名称。'); return; }
    setSaving(true); setError('');
    try { await onSave({ ...editing, name: editing.name.trim() }); setEditing(undefined); }
    catch (cause) { setError(workflowPublicError(cause, '分类尚未保存，素材文件未修改。')); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!editing?.id || locked) return;
    setSaving(true); setError('');
    try { await onRemove(editing.id); setEditing(undefined); }
    catch (cause) { setError(workflowPublicError(cause, '分类尚未删除，素材文件保留。')); }
    finally { setSaving(false); }
  }
  return <aside className="asset-category-sidebar panel" aria-label="素材分类目录"><header><Layers3 size={18} /><strong>素材分类</strong></header><nav className="asset-category-general" aria-label="素材整理范围"><button className={selected === 'all' && (source !== 'builtin' || collection === 'all') ? 'selected' : ''} onClick={() => { onSelect('all'); onCollection('all'); }}><Layers3 size={16} />全部素材</button><button disabled={!enabled} className={selected === 'none' ? 'selected' : ''} onClick={() => onSelect('none')}><Folder size={16} />未归入我的分类</button></nav><section className="asset-category-group"><h3><Shapes size={14} />内置集合</h3><nav aria-label="内置素材集合">{BUILTIN_COLLECTIONS.map(item => <button key={item} className={source === 'builtin' && selected === 'all' && collection === item ? 'selected' : ''} onClick={() => { onSelect('all'); onCollection(item); }}><Folder size={16} /><span>{item}</span></button>)}</nav></section><section className="asset-category-group"><h3>我的分类<button className="btn-icon" disabled={!enabled || locked} aria-label="新增素材分类" onClick={() => open()}><FolderPlus size={16} /></button></h3><nav aria-label="我的素材分类">{categories.map(category => <div className="asset-category-row" key={category.id}><button className={selected === category.id ? 'selected' : ''} disabled={!enabled} onClick={() => onSelect(category.id)}><Folder size={16} /><span>{category.name}</span></button><button className="btn-icon" disabled={!enabled || locked} aria-label={`管理素材分类 ${category.name}`} onClick={() => open(category)}><MoreHorizontal size={15} /></button></div>)}</nav>{categories.length === 0 && <p className="asset-category-empty">按品牌、项目或用途建立自己的素材分类。</p>}<button className="asset-category-create" disabled={!enabled || locked} onClick={() => open()}><FolderPlus size={15} />新建分类</button></section><p className="asset-category-note">{enabled ? '我的分类仅保存在当前工作区，归类与删除分类均不移动或删除素材文件。' : unavailableReason}</p>
    {editing && <ModalPortal onClose={() => setEditing(undefined)} busy={locked}><div className="op-modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !locked) setEditing(undefined); }}><section className="op-modal asset-category-dialog" role="dialog" aria-modal="true" aria-label={editing.id ? '管理素材分类' : '新建素材分类'}><header><h2>{editing.id ? '管理素材分类' : '新建素材分类'}</h2><button className="btn-icon" disabled={locked} aria-label="关闭素材分类窗口" onClick={() => setEditing(undefined)}><X size={18} /></button></header><form id="asset-category-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>分类名称<input autoFocus className="field" aria-label="素材分类名称" value={editing.name} disabled={locked || deleting} maxLength={30} placeholder="例如：品牌封面、常用图解" onChange={event => { setEditing({ ...editing, name: event.target.value }); setError(''); }} /></label><p>独立整理当前工作区中的内置素材引用和我的素材，不影响业务分类或本地文件夹。</p>{deleting && <div className="asset-category-delete-note" role="alert"><strong>删除“{editing.name}”？</strong><p>只移除这个分类及其归属记录，素材文件、项目副本和费用全部保留。</p></div>}{error && <p className="form-error" role="alert">{error}</p>}</form><footer>{editing.id && !deleting && <button className="btn btn-ghost asset-category-remove" disabled={locked} onClick={() => setDeleting(true)}><Trash2 size={15} />删除分类</button>}<div>{deleting ? <><button className="btn btn-secondary" disabled={locked} onClick={() => setDeleting(false)}>保留分类</button><button className="btn btn-primary" disabled={locked} onClick={() => { void remove(); }}>删除并保留素材</button></> : <><button className="btn btn-secondary" disabled={locked} onClick={() => setEditing(undefined)}>取消</button><button className="btn btn-primary" type="submit" form="asset-category-form" disabled={locked}><Check size={15} />{saving ? '正在保存' : '保存分类'}</button></>}</div></footer></section></div></ModalPortal>}
  </aside>;
}
