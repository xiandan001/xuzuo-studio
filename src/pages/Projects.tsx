import { ModalPortal } from '../components/ModalPortal';
import { Select } from '../components/Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Clock3, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, LayoutGrid, List, Pencil, Plus, Presentation, Search, Star, Trash2, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { PageProps, Project, ProjectKind, ProjectStatus } from '../types';
import { KIND_LABEL, money, budgetLabel, parseOptionalBudget } from '../data';
import { BusinessCategorySelect } from '../components/BusinessCategorySelect';
import { filteredProjects, projectPage } from '../lib/project-browser';
import { projectCardStatusLabel } from '../lib/project-status';
import { registerEditorSession } from '../lib/editor-session-guard';
import { CostTotal } from '../components/CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { blocksProjectTrash } from '../lib/workspace-state';
import { ProjectActionsMenu } from '../components/ProjectActionsMenu';
import { ProjectThumbnail } from '../components/ProjectCard';
import { projectTimeLabel, recentProjects } from '../lib/studio-time';
import './operations.css';
import './project-browser.css';

export function Projects({ projects, trashedProjects, ledger, workspace, workspaces, configuration, workflowRunner, navigate, onCreateProject, onUpdateProject, onMoveProject, onTrashProject, onRestoreProject, notify }: PageProps) {
  const realEntries = useMemo(() => {
    const result = new Map<string, typeof ledger>();
    for (const entry of ledger) if (entry.billingMode === 'live') { const entries = result.get(entry.projectId); if (entries) entries.push(entry); else result.set(entry.projectId, [entry]); }
    return result;
  }, [ledger]);
  function projectCost(project: Project) {
    const entries = realEntries.get(project.id);
    return entries?.length ? <CostTotal summary={summarizeCosts(entries)} /> : <>模拟 ¥{money(project.costCents)}</>;
  }
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<'active' | 'trash'>(() => projects.length === 0 && trashedProjects.length > 0 ? 'trash' : 'active');
  const [trashTarget, setTrashTarget] = useState<Project | null>(null);
  const [kind, setKind] = useState<ProjectKind | 'all'>('all');
  const [status, setStatus] = useState<ProjectStatus | 'all' | 'favorite'>('all');
  const [businessCategory, setBusinessCategory] = useState('all');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(workspace.id);
  const [editedCategory, setEditedCategory] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(0), [moving, setMoving] = useState(false);
  const movingRef = useRef(false), scope = useRef(workspace.id); scope.current = workspace.id;
  useEffect(() => registerEditorSession({ id: `projects-move-${workspace.id}`, projectId: '', label: '正在移动项目文件', getState: () => ({ dirty: false, pending: movingRef.current }), save: async () => false, exportRecovery: () => false }), [workspace.id]);
  useEffect(() => { setQuery(''); setCollection(projects.length === 0 && trashedProjects.length > 0 ? 'trash' : 'active'); setKind('all'); setStatus('all'); setBusinessCategory('all'); setPage(0); setMenu(null); setEditing(null); setTrashTarget(null); setError(''); setTargetWorkspaceId(workspace.id); }, [workspace.id]);
  useEffect(() => { setPage(0); setMenu(null); }, [query, kind, status, businessCategory, collection]);
  const candidates = collection === 'trash' ? trashedProjects : projects;
  const sorted = useMemo(() => recentProjects(candidates), [candidates]);
  const filtered = useMemo(() => filteredProjects(sorted, configuration.categories, { query, kind, status, category: businessCategory }), [sorted, query, kind, status, configuration.categories, businessCategory]);
  const visible = projectPage(filtered, page);
  const hasFilters = !!query.trim() || kind !== 'all' || status !== 'all' || businessCategory !== 'all';
  const resetFilters = () => { setQuery(''); setKind('all'); setStatus('all'); setBusinessCategory('all'); };
  const closeEditor = () => { if (!movingRef.current) setEditing(null); };
  const running = (project: Project) => ['processing', 'paused'].includes((projects.find(item => item.id === project.id) || project).status) || workflowRunner.runs.some(run => run.projectId === project.id && blocksProjectTrash(run));
  function requestTrash(project: Project) {
    if (running(project)) { notify('请先完成或取消项目的运行任务，再移入回收站。', 'info'); return; }
    setMenu(null); setTrashTarget(project);
  }
  function confirmTrash() {
    if (!trashTarget) return;
    if (running(trashTarget)) { notify('项目仍有运行或待确认任务，暂不能移入回收站。', 'info'); return; }
    onTrashProject(trashTarget.id); setTrashTarget(null);
  }
  const open = (p: Project) => navigate(p.kind === 'image' ? 'images' : 'documents', p.id);
  const edit = (p: Project) => { setEditing(p); setName(p.name); setBudget(p.budgetCents == null ? '' : money(p.budgetCents)); setTargetWorkspaceId(p.workspaceId); setEditedCategory(p.businessCategoryId || ''); setError(''); setMenu(null); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || movingRef.current) return;
    let cents: number | undefined;
    try { cents = parseOptionalBudget(budget); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '请填写有效金额，或留空。'); return; }
    if (!name.trim()) { setError('给项目起一个名字吧。'); return; }
    if (!workspaces.some(item => item.id === targetWorkspaceId)) { setError('请选择一个有效的工作区。'); return; }
    const moved = targetWorkspaceId !== editing.workspaceId;
    if (moved) {
      const originalScope = workspace.id;
      movingRef.current = true; setMoving(true); setError('');
      try {
        const success = await onMoveProject(editing.id, targetWorkspaceId, { name: name.trim(), budgetCents: cents });
        if (scope.current !== originalScope) return;
        if (!success) { setError('项目未移动，当前名称和预算修改仍保留。可重试，或保留原工作区。'); return; }
        setEditing(null);
      } catch (caught) { if (scope.current === originalScope) setError(caught instanceof Error ? caught.message : '项目移动未完成，原文件和当前修改仍保留。'); }
      finally { movingRef.current = false; setMoving(false); }
      return;
    }
    onUpdateProject(editing.id, { name: name.trim(), budgetCents: cents, businessCategoryId: editedCategory || undefined, updatedAt: new Date().toISOString() });
    setEditing(null); notify('项目名称、分类与预算已保存');
  };

  return <div className="op-page">
    <div className="page-heading"><div><p className="op-eyebrow">YOUR CREATIVE SPACE</p><h1 className="page-title">我的项目 <span className="op-title-count">{projects.length}</span></h1><p className="page-description">{workspace.name}的项目集中在这里，其他工作区保持独立。</p></div><button className="btn btn-primary" onClick={() => onCreateProject()}><Plus size={17} /> 新建项目</button></div>
    <div className="op-project-collections"><div className="tabs"><button className={collection === 'active' ? 'active' : ''} onClick={() => { setCollection('active'); setMenu(null); setStatus('all'); }}><FolderOpen size={15} />使用中 <span>{projects.length}</span></button><button className={collection === 'trash' ? 'active' : ''} onClick={() => { setCollection('trash'); setMenu(null); setStatus('all'); }}><Trash2 size={15} />回收站 <span>{trashedProjects.length}</span></button></div><span><ShieldCheck size={13} />项目可恢复，历史费用不清零</span></div>
    <div className="op-project-toolbar"><div className="segmented op-kind-filter">{([['all', '全部项目'], ['ppt', 'PPT'], ['word', 'Word'], ['excel', 'Excel'], ['image', '图像']] as const).map(([value, label]) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{label}</button>)}</div><div className="op-toolbar-right"><label className="op-search"><Search size={16} /><input aria-label="搜索项目" placeholder="搜索项目名称…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label><Select className="field op-status-select" aria-label="筛选项目状态" value={status} onValueChange={value => setStatus(value as typeof status)} options={[{ value: 'all', label: '全部状态' }, { value: 'favorite', label: '已收藏' }, { value: 'draft', label: '草稿' }, { value: 'processing', label: '生成中' }, { value: 'review', label: '待交付检查' }, { value: 'complete', label: '已完成' }, { value: 'paused', label: '已暂停' }]} /><div className="op-view-toggle"><button aria-label="网格视图" aria-pressed={layout === 'grid'} className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={17} /></button><button aria-label="列表视图" aria-pressed={layout === 'list'} className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><List size={18} /></button></div></div></div>
    <div className="op-business-filter"><BusinessCategorySelect categories={configuration.categories} value={businessCategory} onChange={setBusinessCategory} label="筛选项目业务分类" includeAll /><span>选择大分类时，包含其小分类下的项目。</span>{hasFilters && <button className="btn btn-ghost" onClick={resetFilters}><X size={14} />清除全部筛选</button>}</div>
    <div className="op-list-heading"><span>{collection === 'trash' ? '已移入回收站' : status === 'favorite' ? '收藏的项目' : '最近更新'}</span><small>{filtered.length ? `${visible.start + 1}–${visible.end} / ` : ''}{filtered.length} 个项目 · {collection === 'trash' ? '恢复后可继续创作' : '点击卡片继续创作'}</small></div>
    {collection === 'trash' ? filtered.length ? <div className="op-trash-project-grid">{visible.items.map(project => <article className="panel op-trash-project-card" key={project.id}><span className={`op-file-icon ${project.kind}`}>{project.kind === 'image' ? <ImageIcon size={22} /> : <FileText size={22} />}</span><div><h3>{project.name}</h3><p>{KIND_LABEL[project.kind]} · v{project.version}</p><small>移入时间：{project.trashedAt ? new Date(project.trashedAt).toLocaleString('zh-CN') : '已移入回收站'}</small></div><span className="op-trash-cost">历史记录成本 <b>{projectCost(project)}</b></span><button className="btn btn-secondary" aria-label={`恢复项目 ${project.name}`} onClick={() => onRestoreProject(project.id)}><RotateCcw size={14} />恢复项目</button></article>)}</div> : <div className="panel empty-state op-empty"><Trash2 size={35} /><h3>{query || kind !== 'all' || businessCategory !== 'all' ? '没有匹配的回收站项目' : '项目回收站为空'}</h3><p>项目移入后可以恢复，相关调用记录与历史费用始终保留。</p><button className="btn btn-secondary" onClick={() => { setQuery(''); setKind('all'); setStatus('all'); setBusinessCategory('all'); if (!trashedProjects.length) setCollection('active'); }}>{trashedProjects.length ? '清除筛选' : '返回使用中的项目'}</button></div> : <>
    {filtered.length ? layout === 'grid' ? <div className="op-project-grid">{visible.items.map(p => {
      const Icon = p.kind === 'ppt' ? Presentation : p.kind === 'word' ? FileText : p.kind === 'excel' ? FileSpreadsheet : ImageIcon;
      return <article className="op-project-card" key={p.id}><button className="op-project-preview" aria-label={`打开${p.name}`} onClick={() => open(p)}><ProjectThumbnail project={p} runner={workflowRunner} /><span className={`op-format-tag ${p.kind}`}><Icon size={13} />{KIND_LABEL[p.kind]}</span><span className="op-card-open"><ArrowUpRight size={18} /></span></button><div className="op-project-card-body"><div className="op-card-title-line"><button className="op-project-name" onClick={() => open(p)}>{p.name}</button><button className={`btn-icon op-star ${p.favorite ? 'is-favorite' : ''}`} aria-label={p.favorite ? `取消收藏${p.name}` : `收藏${p.name}`} onClick={() => onUpdateProject(p.id, { favorite: !p.favorite })}><Star size={16} fill={p.favorite ? 'currentColor' : 'none'} /></button></div><p>{p.description.split('\n')[0]}</p><div className="op-card-meta"><span className={`op-status op-status-${p.status}`} title={p.status === 'review' ? '已有结果仍需核对并确认交付，费用记录保持。' : undefined}><i />{projectCardStatusLabel(p, workflowRunner.runs)}</span><span>v{p.version}</span><ProjectActionsMenu projectName={p.name} open={menu === p.id} onOpenChange={next => setMenu(next ? p.id : null)} canTrash={!running(p)} onEdit={() => edit(p)} onOpen={() => open(p)} onTrash={() => requestTrash(p)} /></div></div><div className="op-project-card-footer"><span><Clock3 size={12} />{projectTimeLabel(p.updatedAt)}</span><span>累计记录成本 <b>{projectCost(p)}</b></span></div></article>;
    })}</div> : <div className="panel table-wrap"><table className="data-table op-project-table"><thead><tr><th>项目名称</th><th>类型</th><th>状态</th><th>更新时间</th><th>累计记录成本 / 预算</th><th>操作</th></tr></thead><tbody>{visible.items.map(p => <tr key={p.id}><td><button className="op-table-project" onClick={() => open(p)}><span className={`op-file-icon ${p.kind}`}>{p.kind === 'image' ? <ImageIcon size={19} /> : p.kind === 'ppt' ? <Presentation size={19} /> : p.kind === 'excel' ? <FileSpreadsheet size={19} /> : <FileText size={19} />}</span><span><b>{p.name}</b><small>版本 v{p.version}</small></span></button></td><td>{KIND_LABEL[p.kind]}</td><td><span className={`op-status op-status-${p.status}`} title={p.status === 'review' ? '已有结果仍需核对并确认交付，费用记录保持。' : undefined}><i />{projectCardStatusLabel(p, workflowRunner.runs)}</span></td><td>{projectTimeLabel(p.updatedAt)}</td><td><b>{projectCost(p)}</b><span className="muted"> / {budgetLabel(p.budgetCents)}</span></td><td><div className="op-project-row-actions"><button className="btn btn-ghost" onClick={() => edit(p)}>编辑</button><button className="btn-icon op-trash-action" aria-label={`移入回收站 ${p.name}`} disabled={running(p)} title={running(p) ? '运行中暂不能删除' : '移入回收站，费用保留'} onClick={() => requestTrash(p)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <div className="panel empty-state op-empty"><FolderOpen size={37} /><h3>{hasFilters ? '没有找到匹配的项目' : '这里还没有项目'}</h3><p>{hasFilters ? '清除筛选后查看全部项目，已有文件与费用不会改变。' : '选择项目文件夹，开始第一份作品。'}</p><button className="btn btn-secondary" onClick={() => hasFilters ? resetFilters() : onCreateProject()}>{hasFilters ? '清除筛选' : '新建项目'}</button></div>}
    </>}
    {visible.pages > 1 && <nav className="project-browser-pagination" aria-label="项目列表分页"><span>第 {visible.start + 1}–{visible.end} 项，共 {filtered.length} 个项目</span><div><button className="btn btn-secondary" disabled={visible.page === 0} onClick={() => { setPage(visible.page - 1); setMenu(null); }}>上一页</button><b>{visible.page + 1} / {visible.pages}</b><button className="btn btn-secondary" disabled={visible.page + 1 === visible.pages} onClick={() => { setPage(visible.page + 1); setMenu(null); }}>下一页</button></div></nav>}
    <div className="op-bottom-note"><span className="op-note-dot" /> 移入回收站仅隐藏项目，可恢复。调用记录和历史费用继续保留，不会因项目或产物删除而清零。</div>
    {trashTarget && <ModalPortal onClose={() => setTrashTarget(null)} busy={false}><div className="op-modal-overlay" onKeyDown={event => event.key === 'Escape' && setTrashTarget(null)} onMouseDown={event => event.target === event.currentTarget && setTrashTarget(null)}><section className="op-modal op-trash-confirm" role="dialog" aria-modal="true" aria-label="确认项目移入回收站"><header><div><span className="op-modal-icon"><Trash2 size={20} /></span><h2>将项目移入回收站？</h2><p>{trashTarget.name}</p></div><button className="btn-icon" aria-label="关闭项目回收确认" onClick={() => setTrashTarget(null)}><X size={19} /></button></header><div className="op-trash-confirm-body"><p>项目将从使用中列表隐藏，可在本工作区的回收站恢复。此操作不需要原文件夹存在，也不会删除本地文件。已在外部删除的文件不会恢复。</p><div><ShieldCheck size={17} /><span>相关费用继续计入账本，当前已记录 <b>{projectCost(trashTarget)}</b>，不会清零。</span></div>{workflowRunner.runs.some(run => run.projectId === trashTarget.id && run.status === 'waiting-review') && <p>待检查任务会随项目隐藏；恢复项目后可继续检查，不会自动执行或调用模型。</p>}{running(trashTarget) && <p className="op-form-error">请先完成或取消运行中的任务。</p>}</div><footer><button autoFocus className="btn btn-secondary" onClick={() => setTrashTarget(null)}>取消</button><button className="btn btn-primary" disabled={running(trashTarget)} onClick={confirmTrash}><Trash2 size={14} />移入回收站</button></footer></section></div></ModalPortal>}
    {editing && <ModalPortal onClose={closeEditor} busy={moving}><div className="op-modal-overlay" onKeyDown={e => { if (e.key === 'Escape') closeEditor(); }} onMouseDown={e => { if (e.target === e.currentTarget) closeEditor(); }}><section className="op-modal" role="dialog" aria-modal="true" aria-labelledby="op-edit-project-title"><header><div><span className="op-modal-icon"><Pencil size={20} /></span><h2 id="op-edit-project-title">编辑项目</h2><p>修改名称、业务分类、预算或所属工作区，保留历史记录。</p></div><button className="btn-icon" aria-label="关闭编辑项目" disabled={moving} onClick={closeEditor}><X size={20} /></button></header><form noValidate onSubmit={event => { void save(event); }}><fieldset className="project-edit-fields" disabled={moving}><label className="form-label" htmlFor="op-project-name">项目名称</label><input id="op-project-name" autoFocus className="field" maxLength={60} value={name} onChange={e => setName(e.target.value)} /><fieldset className="project-edit-category" disabled={targetWorkspaceId !== editing.workspaceId}><BusinessCategorySelect categories={configuration.categories} value={editedCategory} onChange={setEditedCategory} label="项目业务分类" /></fieldset><label className="form-label" htmlFor="op-project-workspace">所属工作区</label><Select id="op-project-workspace" className="field" aria-label="所属工作区" value={targetWorkspaceId} onValueChange={setTargetWorkspaceId} options={workspaces.map(item => ({ value: item.id, label: item.name }))} />{targetWorkspaceId !== editing.workspaceId && <p className="op-workspace-move-note">移动后，项目的相关流水与草稿将随项目归属切换，已发生费用不会清零；原业务分类将在移动成功后解除，可到目标工作区重新归类；取消或失败保留所有当前修改。</p>}<label className="form-label" htmlFor="op-project-budget">金额上限（元，选填）</label><div className="op-currency-field"><span>¥</span><input id="op-project-budget" className="field" type="number" min="0" step="0.01" placeholder="选填，留空不设上限" value={budget} onChange={e => setBudget(e.target.value)} /></div><p className="op-field-hint">已记录费用 {projectCost(editing)}，留空不设上限，填写 0 表示零上限；历史费用保持不变。</p>{error && <p className="op-form-error" role="alert">{error}</p>}</fieldset><footer><button className="btn btn-secondary" type="button" disabled={moving} onClick={closeEditor}>取消</button><button className="btn btn-primary" type="submit" disabled={moving}>{moving ? '正在移动项目…' : targetWorkspaceId !== editing.workspaceId ? '保存并移动' : '保存修改'}</button></footer></form></section></div></ModalPortal>}
  </div>;
}
