import { ModalPortal } from '../components/ModalPortal';
import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, FileText, FolderOpen, FolderPlus, GitBranch, Layers3, Pencil, Plus, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import type { BusinessCategory } from '../configuration-types';
import type { PageProps } from '../types';
import { Select } from '../components/Select';
import { categoryContains, categoryPath, categoryRows } from '../lib/category-library';
import { KIND_LABEL } from '../data';
import './categories.css';

type ContentTab = 'projects' | 'prompts' | 'workflows';
export function Categories(props: PageProps) {
  const { configuration, workspace, projects, prompts, navigate } = props;
  const { categories, workflows, saveCategory, archiveCategory } = configuration;
  const [archived, setArchived] = useState(false), [selectedId, setSelectedId] = useState('all');
  const [query, setQuery] = useState(''), [contentQuery, setContentQuery] = useState('');
  const [tab, setTab] = useState<ContentTab>('projects'), [limit, setLimit] = useState(20);
  const [editing, setEditing] = useState<{ id?: string; name: string; parentId?: string } | null>(null);
  const [error, setError] = useState('');
  const selected = categories.find(item => item.id === selectedId);
  const parent = categories.find(item => item.id === selected?.parentId);
  const rows = useMemo(() => categoryRows(categories, archived, query), [categories, archived, query]);
  const mine = prompts.filter(item => !item.builtin);
  const unclassifiedCount = [...projects, ...mine, ...workflows].filter(item => !item.businessCategoryId).length;
  const inCategory = (categoryId?: string) => categoryContains(categories, selectedId, categoryId);
  const related = { projects: projects.filter(item => inCategory(item.businessCategoryId)), prompts: mine.filter(item => inCategory(item.businessCategoryId)), workflows: workflows.filter(item => inCategory(item.businessCategoryId)) };
  const content = related[tab].filter(item => `${item.name} ${item.description}`.toLowerCase().includes(contentQuery.trim().toLowerCase()));
  const activeOptions = categoryRows(categories, false).map(item => ({ value: item.id, label: categoryPath(categories, item.id) }));
  useEffect(() => { setSelectedId('all'); setArchived(false); setQuery(''); setContentQuery(''); setEditing(null); }, [props.workspaceId]);
  useEffect(() => { setLimit(20); }, [selectedId, contentQuery, tab]);
  useEffect(() => { if (selectedId !== 'all' && selectedId !== 'none' && !selected) setSelectedId('all'); }, [selectedId, selected]);
  const openEditor = (item?: BusinessCategory, parentId?: string) => { setEditing({ id: item?.id, name: item?.name || '', parentId: item?.parentId || parentId }); setError(''); };
  const save = () => {
    if (!editing?.name.trim()) { setError('请填写分类名称。'); return; }
    if (saveCategory(editing, editing.id)) setEditing(null);
  };
  const assign = (id: string, value: string) => {
    const businessCategoryId = value || undefined;
    if (tab === 'projects') props.onUpdateProject(id, { businessCategoryId });
    if (tab === 'prompts') { const prompt = mine.find(item => item.id === id); if (prompt) props.onSavePrompt({ ...prompt, businessCategoryId }, id); }
    if (tab === 'workflows') { const workflow = workflows.find(item => item.id === id); if (workflow) configuration.saveWorkflow({ ...workflow, businessCategoryId }, id); }
  };
  return <div className="ct-page page-enter">
    <div className="page-heading"><div><h1 className="page-title">我的分类</h1><p className="page-description">按客户、业务或用途整理项目、提示词和工作流。分类不会移动本地文件。</p></div><button className="btn btn-primary" onClick={() => openEditor()}><FolderPlus size={16} />新建分类</button></div>
    <div className="ct-library-layout">
      <aside className="panel ct-directory" aria-label="业务分类目录"><header><Layers3 size={18} /><strong>{workspace.name}</strong><span>{activeOptions.length}</span></header>
        <label className="ct-search"><Search size={16} /><input aria-label="搜索业务分类" placeholder="搜索分类…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="清除分类搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
        <div className="ct-directory-tabs"><button className={!archived ? 'active' : ''} onClick={() => { setArchived(false); setSelectedId('all'); }}>使用中</button><button className={archived ? 'active' : ''} onClick={() => { setArchived(true); setSelectedId('all'); }}><Archive size={14} />已归档</button></div>
        {!archived && !query && <div className="ct-special-folders"><button className={selectedId === 'all' ? 'selected' : ''} onClick={() => setSelectedId('all')}><Layers3 size={17} />全部内容</button><button className={selectedId === 'none' ? 'selected' : ''} onClick={() => setSelectedId('none')}><FolderOpen size={17} />未分类<span>{unclassifiedCount}</span></button></div>}
        <nav className="ct-tree" aria-label={archived ? '已归档分类' : '使用中的分类'}>{rows.length ? rows.map(item => <button key={item.id} className={`${selectedId === item.id ? 'selected' : ''} ${item.parentId ? 'ct-tree-child' : ''}`} onClick={() => setSelectedId(item.id)} title={categoryPath(categories, item.id)}><FolderOpen size={17} /><span>{query || archived ? categoryPath(categories, item.id) : item.name}</span>{item.archived && <Archive size={12} />}</button>) : <p className="ct-tree-empty">{query ? '没有匹配的分类' : archived ? '没有已归档分类' : '还没有业务分类'}</p>}</nav>
        <button className="ct-directory-add" onClick={() => openEditor()}><Plus size={16} />新建大分类</button>
        <p className="ct-directory-note"><ShieldCheck size={14} />分类保存在当前工作区；归档后关联内容仍然保留。</p>
      </aside>
      <section className="panel ct-content"><header className="ct-content-heading"><div><p>{selected?.parentId ? '小分类' : selected ? '大分类 · 包含下属小分类' : '业务内容'}</p><h2>{selected ? categoryPath(categories, selected.id) : selectedId === 'none' ? '未分类' : archived ? '选择一个归档分类' : '全部内容'}</h2><span>{selectedId === 'none' ? '在下方选择分类，即可整理这些内容。' : selected ? '查看关联内容，或直接调整它们的归属。' : '选择左侧分类，查看这项业务中的作品与工具。'}</span></div>{selected && <div className="ct-heading-actions">{!selected.parentId && !selected.archived && <button className="btn btn-secondary" onClick={() => openEditor(undefined, selected.id)}><Plus size={14} />新增小分类</button>}<button className="btn-icon" aria-label={`重命名${selected.name}`} onClick={() => openEditor(selected)}><Pencil size={16} /></button><button className="btn btn-ghost" onClick={() => { if (parent?.archived) { setSelectedId(parent.id); return; } archiveCategory(selected.id, !selected.archived); }}>{selected.archived || parent?.archived ? <RotateCcw size={15} /> : <Archive size={15} />}{parent?.archived ? '前往恢复大分类' : selected.archived ? '恢复分类' : '归档分类'}</button></div>}</header>
        {archived && !selected ? <div className="ct-content-empty"><Archive size={32} /><h3>归档只收起分类，不删除内容</h3><p>选择左侧分类查看关联内容，恢复后可继续使用。</p></div> : <>
          <div className="ct-content-toolbar"><div className="tabs" role="tablist" aria-label="分类关联内容">{(['projects', 'prompts', 'workflows'] as const).map(type => <button key={type} role="tab" aria-selected={tab === type} className={tab === type ? 'active' : ''} onClick={() => setTab(type)}>{type === 'projects' ? '项目' : type === 'prompts' ? '我的提示词' : '工作流'}<span>{related[type].length}</span></button>)}</div><label className="ct-search"><Search size={15} /><input aria-label="搜索分类关联内容" placeholder="搜索名称…" value={contentQuery} onChange={event => setContentQuery(event.target.value)} /></label></div>
          <div className="ct-content-list">{content.length ? content.slice(0, limit).map(item => <article className="ct-resource" key={item.id}><span className="ct-resource-icon">{tab === 'workflows' ? <GitBranch size={20} /> : <FileText size={20} />}</span><div><strong>{item.name}</strong><p>{tab === 'projects' ? KIND_LABEL[projects.find(project => project.id === item.id)!.kind] : tab === 'prompts' ? '提示词模板' : KIND_LABEL[workflows.find(workflow => workflow.id === item.id)!.outputKind]} · {categoryPath(categories, item.businessCategoryId)}</p></div><Select className="field ct-assignment" aria-label={`调整${item.name}的分类`} value={item.businessCategoryId || ''} options={[{ value: '', label: '未分类' }, ...activeOptions, ...(item.businessCategoryId && !activeOptions.some(option => option.value === item.businessCategoryId) ? [{ value: item.businessCategoryId, label: `${categoryPath(categories, item.businessCategoryId)}（已归档）`, disabled: true }] : [])]} onValueChange={value => assign(item.id, value)} />{tab === 'projects' && <button className="btn btn-ghost" onClick={() => { const project = projects.find(project => project.id === item.id)!; navigate(project.kind === 'image' ? 'images' : 'documents', project.id); }}>打开<ArrowRight size={14} /></button>}</article>) : <div className="ct-content-empty"><FolderOpen size={32} /><h3>{contentQuery ? '没有匹配的内容' : `这里还没有${tab === 'projects' ? '项目' : tab === 'prompts' ? '我的提示词' : '工作流'}`}</h3><p>{contentQuery ? '换一个关键词，或清除搜索。' : '从“未分类”或“全部内容”中，为已有内容选择这个分类。'}</p>{contentQuery && <button className="btn btn-secondary" onClick={() => setContentQuery('')}>清除搜索</button>}{selectedId !== 'none' && !contentQuery && <button className="btn btn-secondary" onClick={() => { setSelectedId('none'); setArchived(false); }}>整理未分类内容<ArrowRight size={14} /></button>}</div>}</div>
          {content.length > limit && <button className="btn btn-secondary ct-load-more" onClick={() => setLimit(value => value + 20)}>再显示 20 项 · 共 {content.length} 项</button>}
          {tab !== 'projects' && <footer className="ct-content-footer"><span>需要编辑内容或开始制作？</span><button className="btn btn-ghost" onClick={() => navigate(tab === 'prompts' ? 'prompts' : 'workflows')}>打开{tab === 'prompts' ? '提示词模板' : '我的工作流'}<ArrowRight size={14} /></button></footer>}
        </>}
      </section>
    </div>
    {editing && <ModalPortal onClose={() => setEditing(null)} busy={false}><div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="modal ct-modal" role="dialog" aria-modal="true" aria-labelledby="ct-editor-title" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><span className="modal-heading-icon"><FolderPlus size={22} /></span><button className="btn-icon" aria-label="关闭分类编辑" onClick={() => setEditing(null)}><X size={18} /></button></div><h2 id="ct-editor-title">{editing.id ? '编辑分类' : editing.parentId ? '新建小分类' : '新建大分类'}</h2><p className="muted">{editing.parentId ? `所属大分类：${categories.find(item => item.id === editing.parentId)?.name}` : `保存到“${workspace.name}”，与其他工作区独立。`}</p><label className="form-label">分类名称<input autoFocus aria-label="分类名称" className="field" maxLength={30} value={editing.name} onChange={event => { setEditing({ ...editing, name: event.target.value }); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') setEditing(null); }} placeholder={editing.parentId ? '例如：新品发布' : '例如：电商内容'} /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="btn btn-secondary" onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" onClick={save}>保存分类<ArrowRight size={14} /></button></div></section></div></ModalPortal>}
  </div>;
}
