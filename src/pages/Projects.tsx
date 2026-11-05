import { ModalPortal } from '../components/ModalPortal';
import { Select } from '../components/Select';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Clock3, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, LayoutGrid, List, Pencil, Plus, Presentation, Search, SlidersHorizontal, Star, Trash2, RotateCcw, ShieldCheck, X } from 'lucide-react';
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
import { BulkOrganizeDialog } from '../components/BulkOrganizeDialog';
import { ProjectPurgeDialog } from '../components/ProjectPurgeDialog';
import type { ProjectPurgeItem, ProjectPurgeRequest, ProjectPurgeResult } from '../project-purge-types';
import { purgeResultCounts } from '../lib/project-purge';
import { projectTimeLabel, recentProjects } from '../lib/studio-time';
import './operations.css';
import './project-browser.css';

const STATUS_FILTERS = [{ value: 'all', label: '全部状态' }, { value: 'favorite', label: '已收藏' }, { value: 'draft', label: '草稿' }, { value: 'processing', label: '生成中' }, { value: 'review', label: '待交付检查' }, { value: 'complete', label: '已完成' }, { value: 'paused', label: '已暂停' }];

export function recycledProjectSelection(items: Project[], workspaceId: string, ids?: string[]): Project[] {
  const selected = ids && new Set(ids);
  return [...new Map(items.filter(item => item.workspaceId === workspaceId && item.trashedAt && !item.purgedAt && (!selected || selected.has(item.id))).map(item => [item.id, item])).values()];
}
export function pendingProjectPurgeGroups(items: ProjectPurgeItem[], workspaceId: string) {
  const groups = new Map<string, ProjectPurgeItem[]>();
  for (const item of items) if (item.workspaceId === workspaceId && item.recordPurged && (item.filesPending || item.retryable)) { const group = groups.get(item.requestId); if (group) group.push(item); else groups.set(item.requestId, [item]); }
  return [...groups].map(([requestId, items]) => ({ requestId, items }));
}

export function Projects({ projects, trashedProjects, ledger, workspace, workspaces, configuration, workflowRunner, navigate, onCreateProject, onUpdateProject, onMoveProject, onTrashProject, onRestoreProject, onBulkProjectAction, projectPurgeLoading = false, projectPurgeError = '', pendingProjectPurges = [], onPurgeProjects, onRetryProjectPurge, onRefreshProjectPurges, notify }: PageProps) {
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
  const [filtersOpen, setFiltersOpen] = useRememberedBoolean(`workspace:${workspace.id}:project-filters`, false);
  const activeFilters = useRef({ query: '', kind: 'all' as typeof kind, status: 'all' as typeof status, businessCategory: 'all' });
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(workspace.id);
  const [editedCategory, setEditedCategory] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(0), [moving, setMoving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false), [selectedIds, setSelectedIds] = useState(new Set<string>()), [bulkBusy, setBulkBusy] = useState(false), [bulkMessage, setBulkMessage] = useState('');
  const [bulkJob, setBulkJob] = useState<{ action: 'trash' | 'restore'; items: { id: string; name: string }[] }>();
  const [purgeSelection, setPurgeSelection] = useState<{ workspaceId: string; projects: Project[]; emptyTrash: boolean }>();
  const [purgeExecuting, setPurgeExecuting] = useState(false), [purgeMessage, setPurgeMessage] = useState('');
  const [retryingPurges, setRetryingPurges] = useState(new Set<string>());
  const purgeExecutionCount = useRef(0), purgeRetries = useRef(new Set<string>());
  const purgeReceipts = useRef(new Map<string, ProjectPurgeResult>());
  const bulkPending = useRef(false);
  const movingRef = useRef(false), scope = useRef(workspace.id); scope.current = workspace.id;
  useEffect(() => { scope.current = workspace.id; return () => { scope.current = ''; }; }, [workspace.id]);
  useEffect(() => registerEditorSession({ id: `projects-move-${workspace.id}`, projectId: '', label: '正在移动项目文件', getState: () => ({ dirty: false, pending: movingRef.current }), save: async () => false, exportRecovery: () => false }), [workspace.id]);
  useEffect(() => registerEditorSession({ id: `projects-bulk-${workspace.id}`, projectId: '', label: '正在批量整理项目', getState: () => ({ dirty: false, pending: bulkPending.current }), save: async () => false, exportRecovery: () => false }), [workspace.id]);
  useEffect(() => registerEditorSession({ id: `projects-purge-${workspace.id}`, projectId: '', label: '正在永久删除或清理项目', getState: () => ({ dirty: false, pending: purgeExecutionCount.current > 0 || purgeRetries.current.size > 0 }), save: async () => false, exportRecovery: () => false }), [workspace.id]);
  useEffect(() => { setPurgeSelection(undefined); setPurgeMessage(''); setPurgeExecuting(false); setRetryingPurges(new Set()); }, [workspace.id]);
  useEffect(() => { setBulkMode(false); setSelectedIds(new Set()); setBulkJob(undefined); setBulkMessage(''); bulkPending.current = false; setBulkBusy(false); }, [workspace.id]);
  useEffect(() => { setSelectedIds(new Set()); setBulkJob(undefined); setBulkMessage(''); }, [query, kind, status, businessCategory, collection]);
  useEffect(() => { activeFilters.current = { query: '', kind: 'all', status: 'all', businessCategory: 'all' }; setQuery(''); setCollection(projects.length === 0 && trashedProjects.length > 0 ? 'trash' : 'active'); setKind('all'); setStatus('all'); setBusinessCategory('all'); setPage(0); setMenu(null); setEditing(null); setTrashTarget(null); setError(''); setTargetWorkspaceId(workspace.id); }, [workspace.id]);
  useEffect(() => { setPage(0); setMenu(null); }, [query, kind, status, businessCategory, collection]);
  const candidates = collection === 'trash' ? trashedProjects : projects;
  const sorted = useMemo(() => recentProjects(candidates), [candidates]);
  const filtered = useMemo(() => filteredProjects(sorted, configuration.categories, { query, kind, status, category: businessCategory }), [sorted, query, kind, status, configuration.categories, businessCategory]);
  const visible = projectPage(filtered, page);
  useEffect(() => { if (page !== visible.page) setPage(visible.page); }, [page, visible.page]);
  const recycled = useMemo(() => recycledProjectSelection(trashedProjects, workspace.id), [trashedProjects, workspace.id]);
  const pendingPurges = useMemo(() => pendingProjectPurgeGroups(pendingProjectPurges, workspace.id), [pendingProjectPurges, workspace.id]);
  const nativePurgeAvailable = typeof window !== 'undefined' && !!window.desktop?.projectPurge;
  const purgeDisabled = projectPurgeLoading || !!projectPurgeError || purgeExecuting || bulkBusy || moving || !nativePurgeAvailable || !onPurgeProjects;
  const hasFilters = !!query.trim() || kind !== 'all' || status !== 'all' || businessCategory !== 'all';
  const advancedFilters = [status !== 'all' ? STATUS_FILTERS.find(option => option.value === status)?.label : '', businessCategory !== 'all' ? !businessCategory || businessCategory === 'none' ? '未分类' : configuration.categories.find(category => category.id === businessCategory)?.name || '已选业务分类' : ''].filter(Boolean);
  const filtersId = `project-filters-${workspace.id}`;
  const clearAdvancedFilters = () => { setStatus('all'); setBusinessCategory('all'); };
  const resetFilters = () => { setQuery(''); setKind('all'); setStatus('all'); setBusinessCategory('all'); };
  const switchCollection = (next: 'active' | 'trash') => {
    if (next === collection) return;
    if (next === 'trash') { activeFilters.current = { query, kind, status, businessCategory }; resetFilters(); }
    else { const previous = activeFilters.current; setQuery(previous.query); setKind(previous.kind); setStatus(previous.status); setBusinessCategory(previous.businessCategory); }
    setCollection(next); setMenu(null);
  };
  const closeEditor = () => { if (!movingRef.current) setEditing(null); };
  const running = (project: Project) => ['processing', 'paused'].includes((projects.find(item => item.id === project.id) || project).status) || workflowRunner.runs.some(run => run.projectId === project.id && blocksProjectTrash(run));
  const selectedProjects = candidates.filter(project => selectedIds.has(project.id));
  const pageSelectable = visible.items.filter(project => collection === 'trash' || !running(project));
  function selectProject(id: string, selected: boolean) { setSelectedIds(previous => { const next = new Set(previous); if (selected) next.add(id); else next.delete(id); return next; }); }
  async function confirmBulk() {
    if (!onBulkProjectAction || !bulkJob || bulkPending.current) return;
    const job = bulkJob, identity = workspace.id; bulkPending.current = true; setBulkBusy(true); setBulkMessage('');
    try {
      const result = await onBulkProjectAction(job.items.map(item => item.id), job.action);
      if (scope.current !== identity) return;
      const message = `已${job.action === 'trash' ? '移入回收站' : '恢复'} ${result.done} 个项目${result.skipped ? `，跳过或未完成 ${result.skipped} 个项目` : ''}。历史费用和本地文件保持不变。`;
      setBulkMessage(message); setBulkJob(undefined); if (result.failedIds) setSelectedIds(new Set(result.failedIds)); else if (!result.skipped) setSelectedIds(new Set()); notify(message, result.skipped ? 'info' : 'success');
    } catch (cause) { if (scope.current === identity) { setBulkJob(undefined); setBulkMessage(cause instanceof Error ? cause.message : '批量整理尚未全部确认，已完成的操作保留。请核对列表后重试。'); } }
    finally { if (scope.current === identity) { bulkPending.current = false; setBulkBusy(false); } }
  }
  function requestTrash(project: Project) {
    if (running(project)) { notify('请先完成或取消项目的运行任务，再移入回收站。', 'info'); return; }
    setMenu(null); setTrashTarget(project);
  }
  function confirmTrash() {
    if (!trashTarget) return;
    if (running(trashTarget)) { notify('项目仍有运行或待确认任务，暂不能移入回收站。', 'info'); return; }
    onTrashProject(trashTarget.id); setTrashTarget(null);
  }
  function requestPurge(ids?: string[], emptyTrash = false) {
    if (purgeDisabled) return;
    const items = recycledProjectSelection(trashedProjects, workspace.id, ids);
    if (!items.length) return;
    purgeReceipts.current.clear(); setPurgeMessage(''); setMenu(null); setPurgeSelection({ workspaceId: workspace.id, projects: items, emptyTrash });
  }
  async function executePurge(request: ProjectPurgeRequest) {
    if (!onPurgeProjects || request.workspaceId !== scope.current) throw Error('工作区已变化，请重新选择当前工作区的项目。');
    const identity = scope.current; purgeExecutionCount.current++; setPurgeExecuting(true);
    try {
      const result = await onPurgeProjects(request);
      if (scope.current === identity) { purgeReceipts.current.set(result.id, result); setSelectedIds(new Set()); const counts = purgeResultCounts([...purgeReceipts.current.values()].flatMap(receipt => receipt.items)); setPurgeMessage(`已永久移除 ${counts.removed} 个项目记录${counts.pending ? `，${counts.pending} 项删除收尾未完成` : ''}${counts.failed ? `，${counts.failed} 项未移除` : ''}。历史费用继续保留。`); }
      return result;
    } finally { purgeExecutionCount.current--; if (scope.current === identity) setPurgeExecuting(purgeExecutionCount.current > 0); }
  }
  async function retryPurge(requestId: string) {
    if (!onRetryProjectPurge || projectPurgeLoading || projectPurgeError || purgeRetries.current.has(requestId)) return;
    const identity = workspace.id; purgeRetries.current.add(requestId); setRetryingPurges(new Set(purgeRetries.current)); setPurgeMessage('');
    try { const result = await onRetryProjectPurge(requestId); if (scope.current === identity) { const unfinished = result.items.filter(item => item.recordPurged && (item.filesPending || item.retryable)).length; setPurgeMessage(unfinished ? `原请求仍有 ${unfinished} 项删除收尾未完成，请查看下方原因后重试。` : '原请求的删除收尾已完成，历史费用保持不变。'); } }
    catch (cause) { if (scope.current === identity) setPurgeMessage(cause instanceof Error ? cause.message : '删除收尾尚未完成，项目不会恢复；请稍后重试原请求。'); }
    finally { purgeRetries.current.delete(requestId); if (scope.current === identity) setRetryingPurges(new Set(purgeRetries.current)); }
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
    <div className="page-heading"><div><p className="op-eyebrow">YOUR CREATIVE SPACE</p><h1 className="page-title">我的作品 <span className="op-title-count">{projects.length}</span></h1><p className="page-description">在{workspace.name}继续编辑和导出作品。</p></div><div className="bulk-organize-heading-actions"><button type="button" className="btn btn-secondary" aria-pressed={bulkMode} disabled={moving || bulkBusy} onClick={() => { setBulkMode(value => !value); setSelectedIds(new Set()); }}>{bulkMode ? '退出批量整理' : '批量整理项目'}</button><button className="btn btn-primary" onClick={() => onCreateProject()}><Plus size={17} /> 新建作品</button></div></div>
    <div className="op-project-collections"><div className="tabs"><button className={collection === 'active' ? 'active' : ''} onClick={() => switchCollection('active')}><FolderOpen size={15} />使用中 <span>{projects.length}</span></button><button className={collection === 'trash' ? 'active' : ''} onClick={() => switchCollection('trash')}><Trash2 size={15} />回收站 <span>{recycled.length}</span></button></div><div className="project-purge-row-actions">{collection === 'trash' && <button type="button" className="btn btn-ghost project-purge-danger-button" disabled={purgeDisabled || !recycled.length} onClick={() => requestPurge(undefined, true)}><Trash2 size={14} />清空回收站</button>}<span><ShieldCheck size={13} />历史费用保留，永久删除后不能恢复项目</span></div></div>
    {(projectPurgeLoading || projectPurgeError) && <div className="project-purge-audit" role={projectPurgeError ? 'alert' : 'status'}><ShieldCheck size={16} /><span>{projectPurgeLoading ? '正在读取永久删除状态，请稍候…' : projectPurgeError}</span>{projectPurgeError && onRefreshProjectPurges && <button type="button" className="btn btn-secondary" disabled={projectPurgeLoading || purgeExecuting} onClick={() => { void onRefreshProjectPurges().catch(cause => notify(cause instanceof Error ? cause.message : '读取状态失败，请稍后重试。', 'error')); }}>重新读取删除状态</button>}</div>}
    {pendingPurges.length > 0 && <section className="project-purge-pending" aria-label="永久删除未完成"><h3>删除收尾未完成 · {pendingPurges.reduce((total, group) => total + group.items.length, 0)} 个项目</h3><p>这些项目记录已永久移除，不能恢复。以下仅按原请求完成记录登记或隔离文件清理，已发生费用保持不变。</p>{pendingPurges.map(group => <article key={group.requestId}><div><strong>{group.items.map(item => item.name).join('、')}</strong>{group.items.map(item => <div key={item.projectId}><small>{('cleanupDirectory' in item && typeof item.cleanupDirectory === 'string' ? item.cleanupDirectory : item.directory) || '没有登记目录'}</small><small>{item.filesPending ? '文件清理尚未完成' : '项目已移除，记录登记尚未完成'}</small><small>{item.error || '请按原请求重试收尾。'}</small></div>)}</div><button type="button" className="btn btn-secondary" aria-label={(group.items.some(item => item.filesPending) ? '重试清理请求 ' : '重试记录收尾请求 ') + group.requestId} disabled={!onRetryProjectPurge || projectPurgeLoading || !!projectPurgeError || purgeExecuting || retryingPurges.has(group.requestId) || !group.items.some(item => item.retryable)} onClick={() => { void retryPurge(group.requestId); }}>{retryingPurges.has(group.requestId) ? '正在重试…' : group.items.some(item => item.filesPending) ? '重试清理' : '重试记录收尾'}</button></article>)}</section>}
    {purgeMessage && <p className="bulk-organize-result" role="status">{purgeMessage}</p>}
    <div className="op-project-toolbar"><div className="segmented op-kind-filter">{([['all', '全部项目'], ['ppt', 'PPT'], ['word', 'Word'], ['excel', 'Excel'], ['image', '图像']] as const).map(([value, label]) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{label}</button>)}</div><div className="op-toolbar-right"><label className="op-search"><Search size={16} /><input aria-label="搜索项目" placeholder="搜索项目名称…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label><button type="button" className={`btn btn-secondary project-filter-toggle${filtersOpen ? ' active' : ''}`} aria-label="作品筛选" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={15} />筛选{advancedFilters.length > 0 && <span className="project-filter-count" aria-label={`${advancedFilters.length} 项筛选条件`}>{advancedFilters.length}</span>}</button><div className="op-view-toggle"><button aria-label="网格视图" aria-pressed={layout === 'grid'} className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={17} /></button><button aria-label="列表视图" aria-pressed={layout === 'list'} className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><List size={18} /></button></div></div></div>
    {filtersOpen && <section id={filtersId} className="project-advanced-filters" role="region" aria-label="作品高级筛选"><label className="form-label">项目状态<Select className="field op-status-select" aria-label="筛选项目状态" value={status} onValueChange={value => setStatus(value as typeof status)} options={STATUS_FILTERS} /></label><BusinessCategorySelect categories={configuration.categories} value={businessCategory} onChange={setBusinessCategory} label="筛选项目业务分类" includeAll /><span>选择大分类时，包含其小分类下的项目。</span>{hasFilters && <button type="button" className="btn btn-ghost" onClick={resetFilters}><X size={14} />清除全部筛选</button>}</section>}
    {advancedFilters.length > 0 && <div className="project-active-filters" role="status" aria-label="已应用作品筛选"><span>已筛选</span>{advancedFilters.map((label, index) => <strong key={index}>{label}</strong>)}<button type="button" onClick={clearAdvancedFilters}><X size={13} />清除筛选</button></div>}
    {bulkMode && <div className="bulk-organize-toolbar"><strong>已选 {selectedProjects.length} 个项目</strong><button type="button" className="btn btn-ghost" disabled={bulkBusy || !pageSelectable.length} onClick={() => setSelectedIds(previous => new Set([...previous, ...pageSelectable.map(project => project.id)]))}>选择当前页可整理项目</button><button type="button" className="btn btn-ghost" disabled={bulkBusy || !selectedProjects.length} onClick={() => setSelectedIds(new Set())}>清除项目选择</button><button type="button" className="btn btn-secondary" disabled={bulkBusy || !selectedProjects.length || !onBulkProjectAction} onClick={() => setBulkJob({ action: collection === 'trash' ? 'restore' : 'trash', items: selectedProjects.map(project => ({ id: project.id, name: project.name })) })}>{collection === 'trash' ? <RotateCcw size={14} /> : <Trash2 size={14} />}{collection === 'trash' ? '批量恢复项目' : '批量移入项目回收站'}</button>{collection === 'trash' && <button type="button" className="btn btn-ghost project-purge-danger-button" disabled={purgeDisabled || !selectedProjects.length} onClick={() => requestPurge(selectedProjects.map(project => project.id))}><Trash2 size={14} />批量永久删除</button>}<span>整理最多100项；永久删除自动分批，历史费用保留。</span></div>}{bulkMessage && <p className="bulk-organize-result" role="status">{bulkMessage}</p>}<div className="op-list-heading"><span>{collection === 'trash' ? '已移入回收站' : status === 'favorite' ? '收藏的项目' : '最近更新'}</span><small>{filtered.length ? `${visible.start + 1}–${visible.end} / ` : ''}{filtered.length} 个项目 · {collection === 'trash' ? '恢复后可继续创作' : '点击卡片继续创作'}</small></div>
    {collection === 'trash' ? filtered.length ? <div className="op-trash-project-grid">{visible.items.map(project => <article className={'panel op-trash-project-card' + (selectedIds.has(project.id) ? ' bulk-selected-project' : '')} key={project.id}>{bulkMode && <label className="bulk-selection-label bulk-trash-check"><input type="checkbox" aria-label={'选择项目 ' + project.name} checked={selectedIds.has(project.id)} disabled={bulkBusy} onChange={event => selectProject(project.id, event.target.checked)} />选择</label>}<span className={`op-file-icon ${project.kind}`}>{project.kind === 'image' ? <ImageIcon size={22} /> : <FileText size={22} />}</span><div><h3>{project.name}</h3><p>{KIND_LABEL[project.kind]} · v{project.version}</p><small>移入时间：{project.trashedAt ? new Date(project.trashedAt).toLocaleString('zh-CN') : '已移入回收站'}</small></div><span className="op-trash-cost">历史记录成本 <b>{projectCost(project)}</b></span><div className="project-purge-row-actions"><button className="btn btn-secondary" aria-label={`恢复项目 ${project.name}`} disabled={purgeExecuting} onClick={() => onRestoreProject(project.id)}><RotateCcw size={14} />恢复项目</button><button type="button" className="btn btn-ghost project-purge-danger-button" aria-label={`永久删除项目 ${project.name}`} disabled={purgeDisabled} onClick={() => requestPurge([project.id])}><Trash2 size={14} />永久删除</button></div></article>)}</div> : <div className="panel empty-state op-empty"><Trash2 size={35} /><h3>{query || kind !== 'all' || businessCategory !== 'all' ? '没有匹配的回收站项目' : '项目回收站为空'}</h3><p>项目移入后可以恢复，相关调用记录与历史费用始终保留。</p><button className="btn btn-secondary" onClick={() => { setQuery(''); setKind('all'); setStatus('all'); setBusinessCategory('all'); if (!trashedProjects.length) setCollection('active'); }}>{trashedProjects.length ? '清除筛选' : '返回使用中的项目'}</button></div> : <>
    {filtered.length ? layout === 'grid' ? <div className="op-project-grid">{visible.items.map(p => {
      const Icon = p.kind === 'ppt' ? Presentation : p.kind === 'word' ? FileText : p.kind === 'excel' ? FileSpreadsheet : ImageIcon;
      return <article className={'op-project-card' + (selectedIds.has(p.id) ? ' bulk-selected-project' : '')} key={p.id}>{bulkMode && <label className="bulk-selection-label bulk-project-check"><input type="checkbox" aria-label={'选择项目 ' + p.name} checked={selectedIds.has(p.id)} disabled={bulkBusy || running(p)} onChange={event => selectProject(p.id, event.target.checked)} />{running(p) ? '运行中，暂不能整理' : '选择项目'}</label>}<button className="op-project-preview" aria-label={`打开${p.name}`} onClick={() => open(p)}><ProjectThumbnail project={p} runner={workflowRunner} /><span className={`op-format-tag ${p.kind}`}><Icon size={13} />{KIND_LABEL[p.kind]}</span><span className="op-card-open"><ArrowUpRight size={18} /></span></button><div className="op-project-card-body"><div className="op-card-title-line"><button className="op-project-name" onClick={() => open(p)}>{p.name}</button><button className={`btn-icon op-star ${p.favorite ? 'is-favorite' : ''}`} aria-label={p.favorite ? `取消收藏${p.name}` : `收藏${p.name}`} onClick={() => onUpdateProject(p.id, { favorite: !p.favorite })}><Star size={16} fill={p.favorite ? 'currentColor' : 'none'} /></button></div><p>{p.description.split('\n')[0]}</p><div className="op-card-meta"><span className={`op-status op-status-${p.status}`} title={p.status === 'review' ? '已有结果仍需核对并确认交付，费用记录保持。' : undefined}><i />{projectCardStatusLabel(p, workflowRunner.runs)}</span><span>v{p.version}</span><ProjectActionsMenu projectName={p.name} open={menu === p.id} onOpenChange={next => setMenu(next ? p.id : null)} canTrash={!running(p)} onEdit={() => edit(p)} onOpen={() => open(p)} onTrash={() => requestTrash(p)} /></div></div><div className="op-project-card-footer"><span><Clock3 size={12} />{projectTimeLabel(p.updatedAt)}</span><span>累计记录成本 <b>{projectCost(p)}</b></span></div></article>;
    })}</div> : <div className="panel table-wrap"><table className="data-table op-project-table"><thead><tr>{bulkMode && <th>选择</th>}<th>项目名称</th><th>类型</th><th>状态</th><th>更新时间</th><th>累计记录成本 / 预算</th><th>操作</th></tr></thead><tbody>{visible.items.map(p => <tr key={p.id}>{bulkMode && <td className="bulk-project-table-check"><input type="checkbox" aria-label={'选择项目 ' + p.name} checked={selectedIds.has(p.id)} disabled={bulkBusy || running(p)} onChange={event => selectProject(p.id, event.target.checked)} /></td>}<td><button className="op-table-project" onClick={() => open(p)}><span className={`op-file-icon ${p.kind}`}>{p.kind === 'image' ? <ImageIcon size={19} /> : p.kind === 'ppt' ? <Presentation size={19} /> : p.kind === 'excel' ? <FileSpreadsheet size={19} /> : <FileText size={19} />}</span><span><b>{p.name}</b><small>版本 v{p.version}</small></span></button></td><td>{KIND_LABEL[p.kind]}</td><td><span className={`op-status op-status-${p.status}`} title={p.status === 'review' ? '已有结果仍需核对并确认交付，费用记录保持。' : undefined}><i />{projectCardStatusLabel(p, workflowRunner.runs)}</span></td><td>{projectTimeLabel(p.updatedAt)}</td><td><b>{projectCost(p)}</b><span className="muted"> / {budgetLabel(p.budgetCents)}</span></td><td><div className="op-project-row-actions"><button className="btn btn-ghost" onClick={() => edit(p)}>编辑</button><button className="btn-icon op-trash-action" aria-label={`移入回收站 ${p.name}`} disabled={running(p)} title={running(p) ? '运行中暂不能删除' : '移入回收站，费用保留'} onClick={() => requestTrash(p)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <div className="panel empty-state op-empty"><FolderOpen size={37} /><h3>{hasFilters ? '没有找到匹配的项目' : '这里还没有项目'}</h3><p>{hasFilters ? '清除筛选后查看全部项目，已有文件与费用不会改变。' : '选择项目文件夹，开始第一份作品。'}</p><button className="btn btn-secondary" onClick={() => hasFilters ? resetFilters() : onCreateProject()}>{hasFilters ? '清除筛选' : '新建项目'}</button></div>}
    </>}
    {visible.pages > 1 && <nav className="project-browser-pagination" aria-label="项目列表分页"><span>第 {visible.start + 1}–{visible.end} 项，共 {filtered.length} 个项目</span><div><button className="btn btn-secondary" disabled={visible.page === 0} onClick={() => { setPage(visible.page - 1); setMenu(null); }}>上一页</button><b>{visible.page + 1} / {visible.pages}</b><button className="btn btn-secondary" disabled={visible.page + 1 === visible.pages} onClick={() => { setPage(visible.page + 1); setMenu(null); }}>下一页</button></div></nav>}
    <div className="op-bottom-note"><span className="op-note-dot" /> 移入回收站仅隐藏项目，可恢复。调用记录和历史费用继续保留，不会因项目或产物删除而清零。</div>
    {purgeSelection && purgeSelection.workspaceId === workspace.id && <ProjectPurgeDialog key={purgeSelection.workspaceId + ':' + purgeSelection.projects.map(project => project.id).join(',')} workspaceId={purgeSelection.workspaceId} projects={purgeSelection.projects} emptyTrash={purgeSelection.emptyTrash} onExecute={executePurge} onClose={() => { setPurgeSelection(undefined); setSelectedIds(new Set()); }} />}
    {bulkJob && <BulkOrganizeDialog title={bulkJob.action === 'trash' ? '批量移入项目回收站' : '批量恢复项目'} noun="项目" items={bulkJob.items} busy={bulkBusy} onClose={() => { if (!bulkPending.current) setBulkJob(undefined); }} onConfirm={() => { void confirmBulk(); }} />}
    {trashTarget && <ModalPortal onClose={() => setTrashTarget(null)} busy={false}><div className="op-modal-overlay" onKeyDown={event => event.key === 'Escape' && setTrashTarget(null)} onMouseDown={event => event.target === event.currentTarget && setTrashTarget(null)}><section className="op-modal op-trash-confirm" role="dialog" aria-modal="true" aria-label="确认项目移入回收站"><header><div><span className="op-modal-icon"><Trash2 size={20} /></span><h2>将项目移入回收站？</h2><p>{trashTarget.name}</p></div><button className="btn-icon" aria-label="关闭项目回收确认" onClick={() => setTrashTarget(null)}><X size={19} /></button></header><div className="op-trash-confirm-body"><p>项目将从使用中列表隐藏，可在本工作区的回收站恢复。此操作不需要原文件夹存在，也不会删除本地文件。已在外部删除的文件不会恢复。</p><div><ShieldCheck size={17} /><span>相关费用继续计入账本，当前已记录 <b>{projectCost(trashTarget)}</b>，不会清零。</span></div>{workflowRunner.runs.some(run => run.projectId === trashTarget.id && run.status === 'waiting-review') && <p>待检查任务会随项目隐藏；恢复项目后可继续检查，不会自动执行或调用模型。</p>}{running(trashTarget) && <p className="op-form-error">请先完成或取消运行中的任务。</p>}</div><footer><button autoFocus className="btn btn-secondary" onClick={() => setTrashTarget(null)}>取消</button><button className="btn btn-primary" disabled={running(trashTarget)} onClick={confirmTrash}><Trash2 size={14} />移入回收站</button></footer></section></div></ModalPortal>}
    {editing && <ModalPortal onClose={closeEditor} busy={moving}><div className="op-modal-overlay" onKeyDown={e => { if (e.key === 'Escape') closeEditor(); }} onMouseDown={e => { if (e.target === e.currentTarget) closeEditor(); }}><section className="op-modal" role="dialog" aria-modal="true" aria-labelledby="op-edit-project-title"><header><div><span className="op-modal-icon"><Pencil size={20} /></span><h2 id="op-edit-project-title">编辑项目</h2><p>修改名称、业务分类、预算或所属工作区，保留历史记录。</p></div><button className="btn-icon" aria-label="关闭编辑项目" disabled={moving} onClick={closeEditor}><X size={20} /></button></header><form noValidate onSubmit={event => { void save(event); }}><fieldset className="project-edit-fields" disabled={moving}><label className="form-label" htmlFor="op-project-name">项目名称</label><input id="op-project-name" autoFocus className="field" maxLength={60} value={name} onChange={e => setName(e.target.value)} /><fieldset className="project-edit-category" disabled={targetWorkspaceId !== editing.workspaceId}><BusinessCategorySelect categories={configuration.categories} value={editedCategory} onChange={setEditedCategory} label="项目业务分类" /></fieldset><label className="form-label" htmlFor="op-project-workspace">所属工作区</label><Select id="op-project-workspace" className="field" aria-label="所属工作区" value={targetWorkspaceId} onValueChange={setTargetWorkspaceId} options={workspaces.map(item => ({ value: item.id, label: item.name }))} />{targetWorkspaceId !== editing.workspaceId && <p className="op-workspace-move-note">移动后，项目的相关流水与草稿将随项目归属切换，已发生费用不会清零；原业务分类将在移动成功后解除，可到目标工作区重新归类；取消或失败保留所有当前修改。</p>}<label className="form-label" htmlFor="op-project-budget">金额上限（元，选填）</label><div className="op-currency-field"><span>¥</span><input id="op-project-budget" className="field" type="number" min="0" step="0.01" placeholder="选填，留空不设上限" value={budget} onChange={e => setBudget(e.target.value)} /></div><p className="op-field-hint">已记录费用 {projectCost(editing)}，留空不设上限，填写 0 表示零上限；历史费用保持不变。</p>{error && <p className="op-form-error" role="alert">{error}</p>}</fieldset><footer><button className="btn btn-secondary" type="button" disabled={moving} onClick={closeEditor}>取消</button><button className="btn btn-primary" type="submit" disabled={moving}>{moving ? '正在移动项目…' : targetWorkspaceId !== editing.workspaceId ? '保存并移动' : '保存修改'}</button></footer></form></section></div></ModalPortal>}
  </div>;
}
