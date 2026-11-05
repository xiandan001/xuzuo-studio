import { useAssetAvailability, assetWithAvailability } from '../hooks/useAssetAvailability';
import { RememberedDetails } from '../components/RememberedDetails';
import { hasManagedDialog } from '../lib/dialog-stack';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, LoaderCircle, Plus, RotateCcw, Search, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import type { PageProps } from '../types';
import type { AssetCategoryState, StudioAsset } from '../asset-types';
import type { ArtifactPreview } from '../live-types';
import { PreviewContent } from '../components/ArtifactResults';
import { ModalPortal } from '../components/ModalPortal';
import { Select } from '../components/Select';
import { BuiltinAssetBrowser } from '../components/BuiltinAssetBrowser';
import { AssetCategorySidebar } from '../components/AssetCategorySidebar';
import { AssetThumbnail } from '../components/AssetThumbnail';
import { ResourcePurposeTemplates } from '../components/ResourcePurposeTemplates';
import { AssetBatchDialog } from '../components/AssetBatchDialog';
import type { AssetBatchAction } from '../components/AssetBatchDialog';
import { BuiltinAssetDetails } from '../components/BuiltinAssetDetails';
import { BUILTIN_ASSETS, builtinAssetLicense } from '../lib/builtin-assets';
import type { BuiltinAsset } from '../lib/builtin-assets';
import { assetUsageLabel } from '../lib/asset-library-usage';
import { workflowPublicError } from '../lib/studio-run';
import { registerEditorSession } from '../lib/editor-session-guard';
import './operations.css';
import './assets-library.css';
import './resource-runtime-workspaces.css';

export function Assets(props: PageProps) {
  const { workspace, workspaceId, projects, activeProject, notify } = props, bridge = window.desktop?.assets;
  const [tab, setTab] = useState<'builtin' | 'mine'>('builtin');
  const [selectedBuiltin, setSelectedBuiltin] = useState<BuiltinAsset>();
  const [categoryState, setCategoryState] = useState<AssetCategoryState>({ categories: [], builtinAssignments: {}, assignments: {} });
  const [selectedCategory, setSelectedCategory] = useState('all'), [builtinCollection, setBuiltinCollection] = useState('all');
  const [categoryReady, setCategoryReady] = useState(false), [categoryError, setCategoryError] = useState('');
  const [assetRevision, setAssetRevision] = useState(0);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assets, setAssets] = useState<StudioAsset[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [ownLimit, setOwnLimit] = useState(24);
  const deferredQuery = useDeferredValue(query);
  const [selectedIds, setSelectedIds] = useState(new Set<string>()), [batchIntent, setBatchIntent] = useState<AssetBatchAction>();
  const [selected, setSelected] = useState<StudioAsset>(), [preview, setPreview] = useState<ArtifactPreview>(), [previewError, setPreviewError] = useState('');
  const [targetId, setTargetId] = useState(projects.some(project => project.id === activeProject.id) ? activeProject.id : '');
  const currentWorkspace = useRef(workspaceId); currentWorkspace.current = workspaceId;
  const assetLoadRequest = useRef(0);
  const previewRequest = useRef(0);
  const searchOpening = useRef(''), searchIdentity = useRef(props.searchTarget?.token); searchIdentity.current = props.searchTarget?.token;
  const pending = useRef(busy); pending.current = busy;
  useEffect(() => registerEditorSession({ id: `assets-${workspaceId}`, projectId: '', label: '正在保存素材文件', getState: () => ({ dirty: false, pending: ['import', 'attach', 'save', 'builtin-import', 'builtin-attach', 'builtin-save'].includes(pending.current) || pending.current.startsWith('category-') || pending.current.startsWith('batch-') }), save: async () => false, exportRecovery: () => false }), [workspaceId]);
  useEffect(() => { setSelectedIds(new Set()); setBatchIntent(undefined); }, [workspaceId, query, filter, selectedCategory, tab]);
  async function load() {
    const request = ++assetLoadRequest.current;
    if (!bridge || !workspace.directory) { setAssets([]); setLoadingAssets(false); return; }
    const id = workspaceId; setLoadingAssets(true);
    try { const result = await bridge.list({ workspaceId: id, ...(bridge.probe ? { availabilityIds: [] } : {}) }); if (currentWorkspace.current === id && request === assetLoadRequest.current) { setAssets(result); setAssetRevision(value => value + 1); setError(''); } }
    catch (cause) { if (currentWorkspace.current === id && request === assetLoadRequest.current) setError(workflowPublicError(cause, '素材库未能读取，原文件仍保留。')); }
    finally { if (currentWorkspace.current === id && request === assetLoadRequest.current) setLoadingAssets(false); }
  }
  function applyCategoryState(next: AssetCategoryState) {
    setCategoryState(next); setCategoryReady(true); setCategoryError('');
    setAssets(items => items.map(item => ({ ...item, categoryId: next.assignments[item.id] || undefined })));
    setSelected(item => item ? { ...item, categoryId: next.assignments[item.id] || undefined } : item);
  }
  async function loadCategories() {
    if (!bridge?.categories || !workspace.directory) return;
    const id = workspaceId;
    try { const result = await bridge.categories({ workspaceId: id }); if (currentWorkspace.current === id) applyCategoryState(result); }
    catch (cause) { if (currentWorkspace.current === id) { setCategoryReady(false); setCategoryError(workflowPublicError(cause, '素材分类暂时无法读取，素材文件仍保留。')); } }
  }
  useEffect(() => { setCategoryState({ categories: [], builtinAssignments: {}, assignments: {} }); setCategoryReady(false); setCategoryError(''); setSelectedCategory('all'); setBuiltinCollection('all'); void loadCategories(); }, [workspaceId, workspace.directory, bridge]);
  useEffect(() => { previewRequest.current++; setSelected(undefined); setSelectedBuiltin(undefined); setPreview(undefined); setPreviewError(''); setAssets([]); setError(''); setBusy(''); if (tab === 'mine') void load(); }, [workspaceId, workspace.directory, bridge, tab]);
  useEffect(() => {
    const target = props.searchTarget; if (!target || target.kind !== 'asset' || busy) return;
    if (target.workspaceId && target.workspaceId !== workspaceId) { props.onSearchTargetConsumed?.(target.token); return; }
    const builtin = BUILTIN_ASSETS.find(item => item.id === target.id), needed = builtin ? 'builtin' : 'mine';
    if (tab !== needed) { setTab(needed); return; }
    if (searchOpening.current === target.token) return; searchOpening.current = target.token;
    setQuery(builtin ? '' : target.name); setFilter('all'); setSelectedCategory('all'); setBuiltinCollection('all'); setOwnLimit(24);
    if (builtin) { setSelectedBuiltin(builtin); props.onSearchTargetConsumed?.(target.token); return; }
    void (async () => {
      try {
        const asset = assets.find(item => item.id === target.id) || (await bridge?.search?.({ workspaceId, query: target.id, limit: 1 }))?.items.find(item => item.id === target.id);
        if (currentWorkspace.current !== workspaceId || searchIdentity.current !== target.token) return;
        if (!asset || asset.archivedAt) throw new Error('此素材已归档、移除或不属于当前工作区，请重新搜索。');
        void show(asset);
      } catch (cause) { if (currentWorkspace.current === workspaceId && searchIdentity.current === target.token) setError(workflowPublicError(cause, '素材暂时无法定位，原文件未修改。')); }
      finally { if (currentWorkspace.current === workspaceId && searchIdentity.current === target.token) props.onSearchTargetConsumed?.(target.token); }
    })();
  }, [props.searchTarget?.token, workspaceId, tab, bridge, busy]);
  useEffect(() => { if (!projects.some(project => project.id === targetId && project.workspaceId === workspaceId)) setTargetId(projects.find(project => project.workspaceId === workspaceId)?.id || ''); }, [projects, targetId, workspaceId]);
  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return; if (event.key === 'Escape' && !busy) { previewRequest.current++; setSelected(undefined); } };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [selected, busy]);
  async function importAssets() {
    if (!bridge || busy) return;
    const category = canManageCategories ? categoryState.categories.find(category => category.id === selectedCategory) : undefined;
    const id = workspaceId; setBusy('import'); setError('');
    try {
      const imported = await bridge.import({ workspaceId: id }); if (currentWorkspace.current !== id || !imported.length) return;
      let assignmentFailed = false;
      if (category) for (const asset of imported) {
        try { await bridge.assignCategory!({ workspaceId: id, id: asset.id, categoryId: category.id }); }
        catch { assignmentFailed = true; }
        if (currentWorkspace.current !== id) return;
      }
      setQuery(''); setFilter('all'); setOwnLimit(24); setSelectedCategory(category && !assignmentFailed ? category.id : 'all');
      await loadCategories(); if (currentWorkspace.current !== id) return;
      if (tab === 'mine') await load(); else setTab('mine');
      notify(assignmentFailed ? `已导入 ${imported.length} 份素材，但部分归类未完成；已显示全部，可在素材详情继续归类。` : category ? `已导入 ${imported.length} 份素材到“${category.name}”。` : `已将 ${imported.length} 份真实文件保存到工作区，重启后仍可使用。`, assignmentFailed ? 'info' : 'success');
    }
    catch (cause) { if (currentWorkspace.current === id) setError(workflowPublicError(cause, '导入未完成。')); }
    finally { if (currentWorkspace.current === id) setBusy(''); }
  }
  async function update(asset: StudioAsset, changes: { favorite?: boolean; archived?: boolean }) {
    if (!bridge || busy) return;
    const id = workspaceId; setBusy(asset.id);
    try { await bridge.update({ workspaceId: id, id: asset.id, ...changes }); if (currentWorkspace.current !== id) return; await load(); setSelected(undefined); }
    catch (cause) { if (currentWorkspace.current === id) setError(workflowPublicError(cause, '素材状态未能保存。')); }
    finally { if (currentWorkspace.current === id) setBusy(''); }
  }
  async function show(asset: StudioAsset) {
    if (!bridge || asset.archivedAt || busy) return;
    const request = ++previewRequest.current; setSelected(asset); setPreview(undefined); setPreviewError('');
    try { const result = await bridge.preview({ workspaceId, id: asset.id }); if (request === previewRequest.current) setPreview(result); }
    catch (cause) { if (request === previewRequest.current) setPreviewError(workflowPublicError(cause, '暂不能预览，可另存后打开。')); }
  }
  function showAssetError(message: string) {
    if (selected || selectedBuiltin) setPreviewError(message); else { setError(message); notify(message, 'error'); }
  }
  async function attach(asset = selected, destination = targetId) {
    if (!bridge || !asset || busy) return;
    const target = projects.find(project => project.id === destination && project.workspaceId === workspaceId);
    if (!target) { showAssetError('请先选择一个目标项目。'); return; }
    const directImage = !!props.onUseAsset && asset.kind === 'image' && target.kind !== 'excel';
    if (!directImage && (target.referenceFiles?.length || 0) >= 16) { showAssetError('目标项目已附加 16 份资料，请先移除不需要的引用。'); return; }
    const id = workspaceId; pending.current = 'attach'; setBusy('attach'); setPreviewError(''); setError('');
    try {
      const file = await bridge.attach({ workspaceId: id, id: asset.id, projectId: target.id });
      if (currentWorkspace.current !== id) return;
      if (!directImage) props.onUpdateProject(target.id, { referenceFiles: [...(target.referenceFiles || []), { id: file.id, name: file.name, mimeType: file.mimeType, kind: file.kind, bytes: file.bytes, ...(file.provenance ? { provenance: file.provenance } : {}) }] });
      previewRequest.current++; setSelected(undefined); pending.current = '';
      if (directImage) {
        setBusy('asset-use');
        try { const accepted = await props.onUseAsset!(target.id, file); if (currentWorkspace.current === id && !accepted) notify('素材文件已复制，但尚未应用到工作台；可在项目文件中继续使用。', 'info'); }
        catch { if (currentWorkspace.current === id) notify('素材文件已复制，但工作台未能应用；可在项目文件中继续使用。', 'info'); }
      } else { setBusy(''); props.navigate(target.kind === 'image' ? 'images' : 'documents', target.id); notify('真实文件已加入项目参考，来源与许可保留；本次未调用模型。'); }
    } catch (cause) { if (currentWorkspace.current === id) { const message = workflowPublicError(cause, '文件未能加入项目。'); if (selected) setPreviewError(message); else setError(message); } }
    finally { if (currentWorkspace.current === id) { pending.current = ''; setBusy(''); } }
  }
  async function save() {
    if (!selected || !bridge || busy) return;
    setBusy('save');
    try { const result = await bridge.save({ workspaceId, id: selected.id }); if (result.saved) notify('已另存真实素材文件。'); }
    catch (cause) { setPreviewError(workflowPublicError(cause, '文件未能另存。')); }
    finally { setBusy(''); }
  }
  async function builtinAction(action: 'import' | 'attach' | 'save', asset = selectedBuiltin, destination = targetId) {
    if (!asset || !bridge || busy) return;
    const id = workspaceId;
    const target = projects.find(project => project.id === destination && project.workspaceId === id);
    const directImage = !!props.onUseAsset && target?.kind !== 'excel';
    if (action !== 'save' && !workspace.directory) { showAssetError('请先选择当前工作区的本地文件夹。'); return; }
    if (action === 'attach' && !target) { showAssetError('请先选择一个目标项目。'); return; }
    if (action === 'attach' && !directImage && (target!.referenceFiles?.length || 0) >= 16) { showAssetError('目标项目已附加 16 份资料，请先移除不需要的引用。'); return; }
    pending.current = `builtin-${action}`; setBusy(pending.current); setPreviewError(''); setError('');
    try {
      if (action === 'save') {
        if (!bridge.saveBuiltin) throw new Error('请安装新版桌面应用后另存内置素材。');
        const result = await bridge.saveBuiltin({ id: asset.id, format: 'bundle' });
        if (currentWorkspace.current === id && result.saved) notify('已另存素材包，包含 PNG、SVG 源文件和许可证；不产生 API 费用。');
      } else if (action === 'import') {
        if (!bridge.importBuiltin) throw new Error('请安装新版桌面应用后保存内置素材。');
        const imported = await bridge.importBuiltin({ workspaceId: id, id: asset.id });
        if (currentWorkspace.current !== id) return;
        const retainedCategory = categoryState.assignments[imported.id];
        const inheritedCategory = retainedCategory ? undefined : categoryState.builtinAssignments[asset.id];
        let assignmentFailed = false;
        if (inheritedCategory && bridge.assignCategory) {
          try { await bridge.assignCategory({ workspaceId: id, id: imported.id, categoryId: inheritedCategory }); await loadCategories(); }
          catch { assignmentFailed = true; setSelectedCategory('all'); setBuiltinCollection('all'); }
        }
        if (currentWorkspace.current !== id) return;
        if (retainedCategory && selectedCategory !== 'all' && retainedCategory !== selectedCategory) setSelectedCategory('all');
        setQuery(''); setFilter('all'); setSelectedBuiltin(undefined); if (tab === 'mine') await load(); else setTab('mine');
        notify(assignmentFailed ? '素材文件已保存，但分类未能保存；已显示全部我的素材，可重新归类。来源与许可保留。' : '已保存到当前工作区的“我的素材”，来源、许可和分类一并保留。');
      } else {
        if (!bridge.attachBuiltin) throw new Error('请安装新版桌面应用后使用内置素材。');
        const file = await bridge.attachBuiltin({ workspaceId: id, id: asset.id, projectId: target!.id });
        if (currentWorkspace.current !== id) return;
        if (!directImage) props.onUpdateProject(target!.id, { referenceFiles: [...(target!.referenceFiles || []), { id: file.id, name: file.name, mimeType: file.mimeType, kind: file.kind, bytes: file.bytes, ...(file.provenance ? { provenance: file.provenance } : {}) }] });
        setSelectedBuiltin(undefined); pending.current = '';
        if (directImage) {
          setBusy('asset-use');
          try { const accepted = await props.onUseAsset!(target!.id, file); if (currentWorkspace.current === id && !accepted) notify('素材文件已复制，但尚未应用到工作台；可在项目文件中继续使用。', 'info'); }
          catch { if (currentWorkspace.current === id) notify('素材文件已复制，但工作台未能应用；可在项目文件中继续使用。', 'info'); }
        } else { setBusy(''); props.navigate(target!.kind === 'image' ? 'images' : 'documents', target!.id); notify('素材已加入项目参考并保留使用许可，本次未调用模型。'); }
      }
    } catch (cause) { if (currentWorkspace.current === id) { const message = workflowPublicError(cause, '素材操作未完成，原文件仍保留。'); if (selectedBuiltin) setPreviewError(message); else setError(message); } }
    finally { if (currentWorkspace.current === id) { pending.current = ''; setBusy(''); } }
  }
  async function openBuiltinLink(asset: BuiltinAsset, kind: 'source' | 'license') {
    if (!bridge?.openBuiltinLink) return;
    try { await bridge.openBuiltinLink({ id: asset.id, kind }); }
    catch (cause) { setPreviewError(workflowPublicError(cause, '来源链接暂时无法打开。')); }
  }
  const canManageCategories = !!workspace.directory && !!bridge?.categories && !!bridge.saveCategory && !!bridge.removeCategory && !!bridge.assignCategory && categoryReady;
  async function confirmBatch(categoryId: string) {
    if (!bridge || pending.current || !batchIntent || !selectedIds.size) return;
    const identity = workspaceId, action = batchIntent, chosen = assets.filter(asset => selectedIds.has(asset.id)), failures: string[] = [];
    pending.current = `batch-${action}`; setBusy(pending.current); setError(''); let completed = 0;
    try {
      for (const asset of chosen) {
        if (currentWorkspace.current !== identity) break;
        try {
          if (action === 'category') { if (!bridge.assignCategory) throw Error('请升级桌面应用后批量归类'); await bridge.assignCategory({ workspaceId: identity, id: asset.id, categoryId: categoryId || undefined }); }
          else await bridge.update({ workspaceId: identity, id: asset.id, archived: action === 'archive' });
          completed++;
        } catch { failures.push(asset.id); }
      }
      if (currentWorkspace.current !== identity) return;
      setSelectedIds(new Set(failures)); setBatchIntent(undefined); await load(); if (action === 'category') await loadCategories();
      if (failures.length) setError(`已完成 ${completed} 份，另有 ${failures.length} 份未完成并保持选中。可检查目录权限后重试，历史费用未改动。`);
      else notify(`已完成 ${completed} 份素材${action === 'category' ? '归类' : action === 'archive' ? '归档' : '恢复'}，项目副本与历史费用保留。`);
    } catch (cause) { if (currentWorkspace.current === identity) setError(workflowPublicError(cause, '批量处理后列表未能刷新，请重新读取；已完成的操作和原文件保留。')); }
    finally { if (currentWorkspace.current === identity) { pending.current = ''; setBusy(''); } }
  }
  const categoryUnavailable = !bridge ? '内置集合可直接浏览；自定义分类请在 Windows 桌面版保存。' : !workspace.directory ? '绑定当前工作区文件夹后，即可建立并保存我的素材分类。' : !bridge.categories ? '请升级桌面应用后使用自定义素材分类。' : categoryError ? '分类读取未完成，请在右侧重新读取；素材文件未改动。' : '正在读取当前工作区的素材分类…';
  async function saveCategory(input: { id?: string; name: string }) {
    if (!bridge?.saveCategory || !canManageCategories || busy) return;
    const id = workspaceId; pending.current = 'category-save'; setBusy(pending.current);
    try { const result = await bridge.saveCategory({ workspaceId: id, ...input }); if (currentWorkspace.current !== id) return; applyCategoryState(result); const saved = result.categories.find(item => item.id === input.id || item.name === input.name.normalize('NFKC').trim()); if (saved) { setSelectedCategory(saved.id); setBuiltinCollection('all'); } notify('素材分类已保存，仅影响当前工作区的整理方式。'); }
    finally { if (currentWorkspace.current === id) { pending.current = ''; setBusy(''); } }
  }
  async function removeCategory(id: string) {
    if (!bridge?.removeCategory || !canManageCategories || busy) return;
    const workspace = workspaceId; pending.current = 'category-delete'; setBusy(pending.current);
    try { const result = await bridge.removeCategory({ workspaceId: workspace, id }); if (currentWorkspace.current !== workspace) return; applyCategoryState(result); if (selectedCategory === id) { setSelectedCategory('all'); setBuiltinCollection('all'); } notify('已删除分类并解除归属，素材文件、项目副本与费用全部保留。'); }
    finally { if (currentWorkspace.current === workspace) { pending.current = ''; setBusy(''); } }
  }
  async function assignCategory(id: string, categoryId: string, builtin: boolean) {
    if (!bridge?.assignCategory || !canManageCategories || busy) return;
    const workspace = workspaceId; pending.current = 'category-assign'; setBusy(pending.current); setPreviewError('');
    try { await bridge.assignCategory({ workspaceId: workspace, id, categoryId: categoryId || undefined, builtin }); if (currentWorkspace.current === workspace) await loadCategories(); }
    catch (cause) { if (currentWorkspace.current === workspace) setPreviewError(workflowPublicError(cause, '分类未能保存，素材文件未修改。')); }
    finally { if (currentWorkspace.current === workspace) { pending.current = ''; setBusy(''); } }
  }
  function categoryField(id: string, builtin = false) {
    const categoryId = builtin ? categoryState.builtinAssignments[id] || '' : categoryState.assignments[id] || '';
    return <section className="asset-detail-category"><label>我的素材分类<Select aria-label="素材归属分类" value={categoryId} disabled={!canManageCategories || !!busy} onValueChange={value => { void assignCategory(id, value, builtin); }} options={[{ value: '', label: '未归入我的分类' }, ...categoryState.categories.map(item => ({ value: item.id, label: item.name }))]} /></label><small>{canManageCategories ? '归类只保存引用，不移动素材。可在左侧“我的分类”中新建或管理分类。' : categoryUnavailable}</small></section>;
  }
  const inCategory = (categoryId?: string) => selectedCategory === 'all' || (selectedCategory === 'none' ? !categoryId : categoryId === selectedCategory);
  const builtinItems = BUILTIN_ASSETS.filter(asset => inCategory(categoryState.builtinAssignments[asset.id]));
  const selectedCategoryName = selectedCategory === 'none' ? '未归入我的分类' : categoryState.categories.find(item => item.id === selectedCategory)?.name;
  useEffect(() => { setOwnLimit(24); }, [query, filter, workspaceId, selectedCategory]);
  const filtered = useMemo(() => assets.filter(asset => (selectedCategory === 'all' || (selectedCategory === 'none' ? !asset.categoryId : asset.categoryId === selectedCategory)) && (filter === 'trash' ? !!asset.archivedAt : !asset.archivedAt) && (filter !== 'favorite' || asset.favorite) && (filter !== 'image' || asset.kind === 'image') && `${asset.name} ${asset.mimeType}`.toLowerCase().includes(deferredQuery.toLowerCase())), [assets, selectedCategory, filter, deferredQuery]);
  const availability = useAssetAvailability(bridge, workspaceId, filtered.slice(0, ownLimit).filter(asset => !asset.archivedAt).map(asset => asset.id), assetRevision, tab === 'mine' && !!workspace.directory);
  const visibleAssets = filtered.slice(0, ownLimit).map(asset => assetWithAvailability(asset, availability.values));
  return <div className="op-page asset-library-page"><div className="page-heading"><div><h1 className="page-title">素材库</h1><p className="page-description">按用途整理素材，在编辑器中直接插入。</p></div><div className="resource-header-actions"><ResourcePurposeTemplates props={props} /><button className="btn btn-primary" disabled={!!busy || !bridge || (!workspace.directory && !props.onBindWorkspace)} onClick={() => { if (!workspace.directory) void props.onBindWorkspace?.(); else void importAssets(); }}><Plus size={17} />{busy === 'import' ? '正在保存素材' : workspace.directory ? '添加素材' : '设置保存位置'}</button></div></div>
    {error && <div className="inline-notice asset-library-error" role="alert">{error}<button className="btn btn-secondary" onClick={() => { void load(); }}>重新读取我的素材</button></div>}
    <div className="asset-library-layout"><AssetCategorySidebar key={workspaceId} categories={categoryState.categories} selected={selectedCategory} collection={builtinCollection} source={tab} enabled={canManageCategories} busy={!!busy} unavailableReason={categoryUnavailable} onSelect={id => { setSelectedCategory(id); setBuiltinCollection('all'); }} onCollection={value => { setBuiltinCollection(value); if (value !== 'all') setTab('builtin'); }} onSave={saveCategory} onRemove={removeCategory} /><div className="asset-library-content">
    {categoryError && <div className="inline-notice asset-library-error" role="alert">{categoryError}<button className="btn btn-secondary" onClick={() => { void loadCategories(); }}>重新读取分类</button></div>}
    <div className="asset-library-source-tabs" role="tablist" aria-label="素材来源"><button role="tab" aria-selected={tab === 'builtin'} className={tab === 'builtin' ? 'active' : ''} disabled={!!busy} onClick={() => setTab('builtin')}>内置素材<span>{BUILTIN_ASSETS.length}</span></button><button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} disabled={!!busy} onClick={() => setTab('mine')}>我的素材</button></div>
    {selectedCategoryName && <div className="asset-library-active-category"><span>我的分类：<strong>{selectedCategoryName}</strong></span><button onClick={() => setSelectedCategory('all')}>查看全部</button></div>}
    {tab === 'builtin' ? <BuiltinAssetBrowser onUse={asset => { if (!targetId || !bridge?.attachBuiltin || !workspace.directory) { setSelectedBuiltin(asset); setPreviewError(''); return; } void builtinAction('attach', asset); }} busy={!!busy} assets={builtinItems} collection={builtinCollection} onCollection={setBuiltinCollection} onShowAll={() => { setSelectedCategory('all'); setBuiltinCollection('all'); }} onPick={asset => { setPreviewError(''); setSelectedBuiltin(asset); }} /> : <>
    {!bridge && <div className="inline-notice">请在桌面版使用“我的素材”。内置素材可直接浏览，复制与文件保存需要 Windows 桌面版。</div>}
    {bridge && !workspace.directory && <div className="inline-notice">先为当前工作区选择本地文件夹。<button className="btn btn-secondary" onClick={() => { void props.onBindWorkspace?.(); }}>设置工作区文件夹</button></div>}
    {bridge && workspace.directory && <>
    <div className="op-project-toolbar"><div className="segmented">{[['all', '全部素材'], ['image', '图片'], ['favorite', '我的收藏'], ['trash', '素材回收站']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="op-search"><Search size={16} /><input aria-label="搜索素材" placeholder="搜索文件名或类型" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    {availability.error && <div className="inline-notice" role="status">{availability.error}<button type="button" className="text-button" onClick={() => { void load(); }}>刷新素材</button></div>}
    <div className="asset-library-result-count"><span role="status">{loadingAssets ? '正在读取素材…' : `${filtered.length} 份工作区素材`}</span><div className="asset-library-result-actions">{filtered.length > 0 && <button type="button" className="text-button" disabled={!!busy || loadingAssets} onClick={() => setSelectedIds(new Set(filtered.slice(0, ownLimit).map(asset => asset.id)))}>选择当前显示的 {Math.min(ownLimit, filtered.length)} 份</button>}{bridge && workspace.directory && <button type="button" className="text-button" disabled={loadingAssets || !!busy} onClick={() => { void load(); }}>刷新素材</button>}</div></div>
    {selectedIds.size > 0 && <div className="asset-batch-toolbar"><strong>已选 {selectedIds.size} 份</strong><button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setSelectedIds(new Set())}>清除选择</button>{filter === 'trash' ? <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setBatchIntent('restore')}><RotateCcw size={14} />批量恢复</button> : <><button type="button" className="btn btn-secondary" disabled={!!busy || !canManageCategories} onClick={() => setBatchIntent('category')}>批量归类</button><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setBatchIntent('archive')}><Trash2 size={14} />批量移入回收站</button></>}</div>}
    <div className="asset-library-grid">{visibleAssets.map(asset => <article className={`panel asset-library-card ${selectedIds.has(asset.id) ? 'is-selected' : ''}`} key={asset.id}><label className="asset-library-select"><input type="checkbox" aria-label={`选择素材 ${asset.name}`} checked={selectedIds.has(asset.id)} disabled={!!busy} onChange={event => { const selected = event.target.checked; setSelectedIds(previous => { const next = new Set(previous); if (selected) next.add(asset.id); else next.delete(asset.id); return next; }); }} />选择素材</label><AssetThumbnail asset={asset} workspaceId={workspaceId} onOpen={() => { void show(asset); }} /><button className="asset-library-name" disabled={!!asset.archivedAt} onClick={() => { void show(asset); }}>{asset.name}</button><p>{(asset.bytes / 1024).toFixed(1)} KB · {new Date(asset.createdAt).toLocaleDateString('zh-CN')}</p>{asset.unavailable && <small>文件不可用，请检查目录或重新导入</small>}<div>{!asset.archivedAt && <button type="button" className="btn btn-secondary asset-library-use" disabled={!!busy || !!asset.unavailable} onClick={() => { if (targetId) void attach(asset); else void show(asset); }}>在作品中使用</button>}{asset.archivedAt ? <button className="btn btn-secondary" disabled={!!busy} onClick={() => { void update(asset, { archived: false }); }}><RotateCcw size={14} />恢复素材</button> : <><button className="btn-icon" disabled={!!busy} aria-label={`${asset.favorite ? '取消收藏' : '收藏'}${asset.name}`} onClick={() => { void update(asset, { favorite: !asset.favorite }); }}><Star size={16} fill={asset.favorite ? 'currentColor' : 'none'} /></button><button className="btn btn-ghost" disabled={!!busy} onClick={() => { void show(asset); }}>查看详情</button><button className="btn-icon" disabled={!!busy} aria-label={`移入素材回收站 ${asset.name}`} title="仅归档素材，已加入项目的文件保持独立" onClick={() => { void update(asset, { archived: true }); }}><Trash2 size={16} /></button></>}</div></article>)}</div>
    {filtered.length > ownLimit && <div className="asset-library-load-more"><button className="btn btn-secondary" onClick={() => setOwnLimit(value => value + 24)}>再显示 {Math.min(24, filtered.length - ownLimit)} 份 · 共 {filtered.length} 份</button></div>}
    {!filtered.length && loadingAssets && <div className="panel empty-state" role="status"><LoaderCircle size={28} className="spin" /><h3>正在读取素材</h3></div>}{!filtered.length && !loadingAssets && <div className="panel empty-state"><FileText size={32} /><h3>{filter === 'trash' ? '素材回收站为空' : !assets.length && !query ? '还没有自己的素材' : '没有匹配的素材'}</h3><p>{!assets.length && !query && filter !== 'trash' ? '点击右上角“添加素材”，导入常用图片、文档或其他文件。' : '可调整搜索和筛选条件，或添加新的素材。'}</p></div>}
    {batchIntent && <AssetBatchDialog action={batchIntent} count={selectedIds.size} categories={categoryState.categories} busy={busy.startsWith('batch-')} onClose={() => { if (!pending.current) setBatchIntent(undefined); }} onConfirm={category => { void confirmBatch(category); }} />}
    </>}
    </>}
    </div></div>
    {selectedBuiltin && <BuiltinAssetDetails categoryField={categoryField(selectedBuiltin.id, true)} asset={selectedBuiltin} props={props} targetId={targetId} onTarget={setTargetId} busy={busy} error={previewError} onClose={() => setSelectedBuiltin(undefined)} onImport={() => { void builtinAction('import'); }} onAttach={() => { void builtinAction('attach'); }} onSave={() => { void builtinAction('save'); }} onLink={kind => { void openBuiltinLink(selectedBuiltin, kind); }} />}
    {selected && <ModalPortal onClose={() => { previewRequest.current++; setSelected(undefined); }} busy={!!busy}><div className="op-modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) { previewRequest.current++; setSelected(undefined); } }}><section className="op-modal asset-library-preview" role="dialog" aria-modal="true" aria-label="真实素材预览"><header><h2>{selected.name}</h2><button autoFocus className="btn-icon" disabled={!!busy} aria-label="关闭素材预览" onClick={() => { previewRequest.current++; setSelected(undefined); }}><X size={18} /></button></header><div className="asset-library-preview-body">{previewError && <p role="alert">{previewError}</p>}{preview ? <PreviewContent artifact={{ ...selected, path: '' }} preview={preview} /> : !previewError && <p><LoaderCircle size={18} className="spin" />正在读取真实文件</p>}<label>目标项目<Select aria-label="素材目标项目" value={targetId} onValueChange={setTargetId} options={[{ value: '', label: '请选择项目' }, ...projects.map(project => ({ value: project.id, label: project.name }))]} /></label>{projects.filter(project => project.workspaceId === workspaceId).length === 0 && <button className="btn btn-secondary" onClick={() => { setSelected(undefined); props.onCreateProject(); }}>新建项目</button>}<p>加入时会复制实际文件；此后归档素材不会破坏项目副本。仅适配的正文/图像功能会读取相应资料，不会仅凭文件名冒充已理解。</p>{categoryField(selected.id)}{selected.provenance && <section className="asset-license-info asset-owned-provenance" aria-label="素材来源与许可"><h3><ShieldCheck size={17} />来源与使用许可</h3><p>{selected.provenance.author} · {selected.provenance.licenseName}</p><p>{selected.provenance.usageNote}</p><RememberedDetails rememberKey={`asset:${selected.id}:library-license`}><summary>查看本地许可说明</summary><pre>{BUILTIN_ASSETS.some(asset => asset.id === selected.provenance!.builtinId) ? builtinAssetLicense(BUILTIN_ASSETS.find(asset => asset.id === selected.provenance!.builtinId)!)?.notice || selected.provenance.licenseNotice : selected.provenance.licenseNotice}</pre></RememberedDetails></section>}</div><footer><button className="btn btn-secondary" disabled={!!busy} onClick={() => { void save(); }}><Download size={15} />另存文件</button><button className="btn btn-primary" disabled={!!busy || !targetId || selected.unavailable} onClick={() => { void attach(); }}>{busy === 'attach' ? '正在复制' : projects.find(project => project.id === targetId) ? assetUsageLabel(projects.find(project => project.id === targetId)!.kind, selected.kind === 'image') : '选择项目后使用'}</button></footer></section></div></ModalPortal>}
  </div>;
}
