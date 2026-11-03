import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, ChevronRight, File, FileText, Folder, FolderPlus, HardDrive, Home, LoaderCircle, RefreshCw, Search, X, AlertTriangle } from 'lucide-react';
import type { CustomDialogRequest, DialogEntry, FileDialogSeed, StudioDialogBridge } from '../dialog-types';
import { useFileDialog } from '../hooks/useFileDialog';
import { canCreateOriginalFolder, dialogBreadcrumbs, dialogFileSize, isWorkspaceRootTarget } from '../lib/dialog-paths';
import { Select, isSelectInteraction } from './Select';

export function FileDialog({ config, bridge, onCancel }: { config: CustomDialogRequest & { seed: FileDialogSeed }; bridge: StudioDialogBridge; onCancel: () => void }) {
  const seed = config.seed, explorer = useFileDialog(bridge, seed);
  const [editingPath, setEditingPath] = useState(false), [path, setPath] = useState(seed.path);
  const [creating, setCreating] = useState(false), [folderName, setFolderName] = useState('新建文件夹');
  const [filter, setFilter] = useState('all'), [activeIndex, setActiveIndex] = useState(0);
  const pathInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), filenameInput = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLDivElement>(null), anchor = useRef(0), cancel = useRef<HTMLButtonElement>(null), primary = useRef<HTMLButtonElement>(null);
  const previousOverwrite = useRef(false);
  const overwriteCancel = useRef<HTMLButtonElement>(null), overwriteConfirm = useRef<HTMLButtonElement>(null);
  const state = useRef({ explorer, editingPath, creating, onCancel }); state.current = { explorer, editingPath, creating, onCancel };
  useEffect(() => { if (explorer.listing) setPath(explorer.listing.path); }, [explorer.listing?.path]);
  useEffect(() => { if (editingPath) { pathInput.current?.focus(); pathInput.current?.select(); } }, [editingPath]);
  useEffect(() => { if (creating) { folderInput.current?.focus(); folderInput.current?.select(); } }, [creating]);
  useEffect(() => { if (explorer.overwrite) overwriteCancel.current?.focus(); else if (previousOverwrite.current) filenameInput.current?.focus(); previousOverwrite.current = !!explorer.overwrite; }, [explorer.overwrite]);
  useEffect(() => {
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (isSelectInteraction(event)) return;
      const value = state.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l' && !value.explorer.overwrite && !value.explorer.busy) { event.preventDefault(); setEditingPath(true); return; }
      if (!value.explorer.overwrite && event.key === 'Tab') {
        const nodes = [...document.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0 && !node.closest('[inert]'));
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (value.explorer.overwrite && event.key === 'Tab') { event.preventDefault(); (document.activeElement === overwriteCancel.current ? overwriteConfirm : overwriteCancel).current?.focus(); return; }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (value.explorer.busy === 'create' || value.explorer.busy === 'accept') return;
        if (value.explorer.overwrite) value.explorer.dismissOverwrite();
        else if (value.editingPath) { setEditingPath(false); setPath(value.explorer.listing?.path || seed.path); }
        else if (value.creating) setCreating(false);
        else value.onCancel();
      }
      if (event.altKey && event.key === 'ArrowLeft' && !value.explorer.busy) { event.preventDefault(); value.explorer.back(); }
      if (event.altKey && event.key === 'ArrowUp' && !value.explorer.busy) { event.preventDefault(); value.explorer.up(); }
    };
    window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
  }, [seed.path]);
  const allCrumbs = dialogBreadcrumbs(explorer.listing?.path || seed.path);
  const scopeStart = seed.allowedRoot ? allCrumbs.findIndex(crumb => crumb.path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() === seed.allowedRoot!.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()) : 0;
  const crumbs = scopeStart >= 0 ? allCrumbs.slice(scopeStart) : allCrumbs;
  const allowed = filter === 'all' ? undefined : seed.filters[Number(filter)]?.extensions.map(value => value.toLowerCase());
  const entries = explorer.listing?.entries.filter(entry => entry.kind !== 'file' || !allowed || allowed.includes('*') || allowed.includes(entry.name.split('.').at(-1)?.toLowerCase() || '')) || [];
  const firstEnabledIndex = Math.max(0, entries.findIndex(entry => entry.kind !== 'link'));
  useEffect(() => { setActiveIndex(firstEnabledIndex); anchor.current = firstEnabledIndex; }, [explorer.listing?.path, explorer.listing?.page, explorer.search, filter, firstEnabledIndex]);
  const disabled = !!explorer.busy || !!explorer.overwrite;
  const canCreateHere = seed.canCreateDirectory && canCreateOriginalFolder(explorer.listing?.path || seed.path, seed.exactPath);
  const projectPicker = seed.directoryOnly && seed.selectEmpty && !!seed.allowedRoot;
  const needsProjectFolder = projectPicker && isWorkspaceRootTarget(explorer.target, seed.allowedRoot);
  const projectEmptyHint = creating ? '输入项目文件夹名称，点击上方“创建并继续”。' : '点击下方“新建项目文件夹并继续”，为本次作品建立独立文件夹。';
  function beginNewFolder() {
    if (!canCreateHere || disabled) return;
    setFolderName(seed.exactPath?.split(/[\\/]/).filter(Boolean).at(-1) || (projectPicker ? '新项目' : '新建文件夹')); setCreating(true); explorer.setError('');
  }
  async function submitFolder() {
    if (!canCreateHere) return;
    const created = await explorer.createFolder(folderName);
    if (!created) return;
    setCreating(false); setFolderName('新建文件夹');
    if (projectPicker) await explorer.accept(created);
    requestAnimationFrame(() => (seed.mode === 'save' ? filenameInput : primary).current?.focus());
  }
  function choose(entry: DialogEntry, index: number, event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    setActiveIndex(index); explorer.select(entry, !!(event.ctrlKey || event.metaKey), event.shiftKey ? entries.slice(Math.min(anchor.current, index), Math.max(anchor.current, index) + 1) : undefined); anchor.current = index;
  }
  return <div className="file-dialog-layout">
    <div className="fd-toolbar" aria-hidden={explorer.overwrite ? true : undefined} inert={!!explorer.overwrite}>
      <div className="fd-nav"><button className="sd-icon-button" aria-label="返回上个目录" disabled={disabled || explorer.history.index < 1} onClick={explorer.back}><ArrowLeft size={18} /></button><button className="sd-icon-button" aria-label="上一级文件夹" disabled={disabled || !explorer.listing?.canGoUp} onClick={explorer.up}><ArrowUp size={18} /></button><button className="sd-icon-button" aria-label="刷新目录" title="刷新当前目录与磁盘列表" disabled={disabled || explorer.locationsLoading} onClick={explorer.reload}><RefreshCw size={17} className={explorer.busy === 'browse' || explorer.locationsLoading ? 'spin' : ''} /></button></div>
      {editingPath ? <form className="fd-path-form" onSubmit={event => { event.preventDefault(); if (disabled) return; setEditingPath(false); explorer.navigate(path); }}><input ref={pathInput} aria-label="输入目录路径" value={path} disabled={disabled} onChange={event => setPath(event.target.value)} spellCheck={false} /><button type="submit" disabled={disabled}>前往</button></form> : <div className="fd-breadcrumbs" aria-label="目录导航">{crumbs.map((crumb, index) => <span key={crumb.path}>{index > 0 && <ChevronRight size={13} />}<button disabled={disabled} onClick={() => explorer.navigate(crumb.path)} title={crumb.path}>{crumb.name}</button></span>)}<button className="fd-edit-path" aria-label="编辑目录路径" title="输入路径 Ctrl+L" onClick={() => setEditingPath(true)} disabled={disabled}>路径</button></div>}
      <label className="fd-search"><Search size={17} /><input aria-label="搜索当前文件夹" placeholder="搜索当前文件夹" value={explorer.search} onChange={event => explorer.searchDirectory(event.target.value)} disabled={!!explorer.overwrite || explorer.busy === 'create' || explorer.busy === 'accept'} /><button className="sd-icon-button" aria-label="清除目录搜索" disabled={!explorer.search || disabled} onClick={() => explorer.searchDirectory('')}><X size={13} /></button></label>
    </div>
    <div className="fd-content" aria-hidden={explorer.overwrite ? true : undefined} inert={!!explorer.overwrite}>
      <aside className="fd-sidebar">{seed.exactPath && <div className="fd-exact-path"><b>需要连接的原位置</b><span>{seed.exactPath}</span></div>}<span className="fd-section-label">{seed.allowedRoot ? '当前工作区' : '常用位置'}</span>{explorer.locations.map(location => <button key={location.path} className={explorer.listing?.path === location.path ? 'selected' : ''} disabled={disabled} title={location.path} onClick={() => explorer.navigate(location.path)}>{location.kind === 'drive' ? <HardDrive size={17} /> : location.kind === 'home' ? <Home size={17} /> : <Folder size={17} />}<span>{location.name}</span></button>)}{seed.allowedRoot && !explorer.locations.some(item => item.path === seed.allowedRoot) && <button disabled={disabled} onClick={() => explorer.navigate(seed.allowedRoot!)}><Folder size={17} /><span>工作区根目录</span></button>}{explorer.locationsLoading && <span className="fd-section-label" role="status">正在更新磁盘…</span>}{explorer.locationWarning && <p className="fd-location-warning" role="status">{explorer.locationWarning}<button className="sd-button sd-button-secondary" disabled={disabled || explorer.locationsLoading} onClick={() => { void explorer.refreshLocations(true); }}>重新识别磁盘</button></p>}<p>{seed.exactPath ? '请重新选择登记的原位置。' : seed.allowedRoot ? '项目使用工作区内的独立文件夹。' : '选择本机位置，文件内容仅在确认后用于当前操作。'}</p></aside>
      <main className="fd-browser">{seed.exactPath && <div className="fd-reconnect-notice"><p>这里只恢复左侧登记的原工作区。要在其它位置创建，请返回并选择“在新位置新建工作区”。</p><button className="sd-button sd-button-secondary" disabled={disabled} onClick={onCancel}>返回工作区选项</button></div>}{projectPicker && <div className="fd-reconnect-notice fd-project-notice"><strong>第 2 步：选择项目文件夹</strong><p>工作区用来集中管理多个项目，每个项目使用其中的独立子文件夹。请选择已有的空子文件夹，或新建一个。</p></div>}<div className="fd-browser-heading"><div><strong>{seed.directoryOnly ? (crumbs.at(-1)?.name || '选择文件夹') : config.kind === 'save' ? '选择保存位置' : '选择文件'}</strong><small>{explorer.listing?.total ?? 0}{seed.directoryOnly ? ' 个可见子文件夹' : ' 项'}{seed.multiSelections ? ` · 最多 ${seed.maxSelections || 20} 个文件` : ''}</small></div><button className="sd-button sd-button-secondary" disabled={!canCreateHere || disabled} title={seed.exactPath ? '仅可在原位置的父目录补建原文件夹；其它位置请新建工作区' : seed.canCreateDirectory ? '在当前目录中新建文件夹' : '当前操作仅选择已有文件'} onClick={beginNewFolder}><FolderPlus size={17} />{seed.exactPath ? '补建原文件夹' : '新建文件夹'}</button></div>
        {creating && <form className="fd-new-folder" onSubmit={event => { event.preventDefault(); void submitFolder(); }}><FolderPlus size={20} /><label>文件夹名称<input ref={folderInput} aria-label="新文件夹名称" value={folderName} onChange={event => { setFolderName(event.target.value); explorer.setError(''); }} maxLength={255} disabled={disabled} readOnly={!!seed.exactPath} /></label><button className="sd-button sd-button-primary" type="submit" disabled={disabled || !canCreateHere || !folderName.trim()}>{explorer.busy === 'create' ? '正在创建…' : projectPicker ? '创建并继续' : '创建文件夹'}</button><button className="sd-icon-button" type="button" aria-label="取消新建文件夹" disabled={disabled} onClick={() => setCreating(false)}><X size={17} /></button></form>}
        <div className="fd-list-heading"><span>名称</span><span>修改时间</span><span>大小</span></div>
        <div className="fd-list" role="listbox" aria-label="文件与文件夹" aria-multiselectable={seed.multiSelections} aria-busy={explorer.loading} ref={rows} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key) || disabled || !entries.length) return; event.preventDefault();
          const at = Number((event.target as HTMLElement).closest<HTMLElement>('[data-file-row]')?.dataset.fileRow || 0), direction = event.key === 'ArrowDown' ? 1 : -1; let index = at + direction;
          while (index >= 0 && index < entries.length && entries[index].kind === 'link') index += direction; if (index < 0 || index >= entries.length) return;
          rows.current?.querySelectorAll<HTMLElement>('[data-file-row]')[index]?.focus(); choose(entries[index], index, event);
        }}>{explorer.loading ? <div className="fd-empty" role="status"><LoaderCircle size={27} className="spin" /><strong>正在读取目录…</strong></div> : entries.length ? entries.map((entry, index) => <button type="button" role="option" aria-selected={explorer.selected.some(item => item.path === entry.path)} disabled={entry.kind === 'link' || disabled} data-file-row={index} tabIndex={index === activeIndex ? 0 : -1} className={`fd-row ${explorer.selected.some(item => item.path === entry.path) ? 'selected' : ''}`} key={entry.path} title={entry.kind === 'link' ? '此位置为链接或不可访问的项目，不能选择' : entry.name} onClick={event => choose(entry, index, event)} onDoubleClick={() => entry.kind === 'directory' ? explorer.navigate(entry.path) : void explorer.accept(entry)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (entry.kind === 'directory') explorer.navigate(entry.path); else void explorer.accept(entry); } }}><span>{entry.kind === 'directory' ? <Folder size={22} /> : entry.kind === 'file' ? <FileText size={21} /> : <File size={21} />}<b>{entry.name}</b></span><time>{entry.modified ? new Date(entry.modified).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</time><small>{entry.kind === 'directory' ? '文件夹' : entry.kind === 'link' ? '不可选择' : dialogFileSize(entry.bytes)}</small></button>) : <div className="fd-empty"><Folder size={39} /><strong>{explorer.search ? '没有找到匹配项目' : needsProjectFolder ? '工作区已就绪，还没有项目文件夹' : seed.directoryOnly ? '没有可显示的子文件夹' : '没有可显示的文件'}</strong><p>{needsProjectFolder ? projectEmptyHint : projectPicker ? '列表只显示子文件夹。若当前文件夹为空，可直接使用；已有文件不会被覆盖。' : seed.canCreateDirectory ? '可以在这里新建文件夹，或返回其他位置。' : '尝试其他位置或搜索名称。'}</p></div>}</div>
        <div className="fd-pagination"><span>仅浏览当前目录</span>{explorer.listing && explorer.listing.total > explorer.listing.pageSize && <div><button disabled={disabled || explorer.listing.page === 0} onClick={() => explorer.page(explorer.listing!.page - 1)}>上一页</button><b>{explorer.listing.page + 1} / {Math.ceil(explorer.listing.total / explorer.listing.pageSize)}</b><button disabled={disabled || (explorer.listing.page + 1) * explorer.listing.pageSize >= explorer.listing.total} onClick={() => explorer.page(explorer.listing!.page + 1)}>下一页</button></div>}</div>
      </main>
    </div>
    {explorer.error && <div className="sd-inline-error" role="alert"><AlertTriangle size={17} /><span>{explorer.error}</span><button className="sd-icon-button" aria-label="关闭错误提示" onClick={() => explorer.setError('')}><X size={14} /></button></div>}
    <footer className="fd-footer" aria-hidden={explorer.overwrite ? true : undefined} inert={!!explorer.overwrite}>
      {!seed.directoryOnly && <div className="fd-filename"><label>{seed.mode === 'save' ? '文件名' : '所选文件'}<input ref={filenameInput} aria-label={seed.mode === 'save' ? '保存文件名' : '所选文件名'} placeholder={seed.mode === 'save' ? '输入文件名' : '选择文件，或输入完整路径'} value={explorer.selected.length > 1 ? explorer.selected.map(item => item.name).join('、') : explorer.filename} readOnly={explorer.selected.length > 1} disabled={disabled} onChange={event => { explorer.clearSelection(); explorer.setFilename(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void explorer.accept(); } }} /></label>{seed.filters.length > 0 && <Select aria-label="文件类型" value={filter} onValueChange={setFilter} disabled={disabled} options={seed.filters.length === 1 ? [{ value: 'all', label: `${seed.filters[0].name} (${seed.filters[0].extensions.map(extension => `.${extension}`).join('、')})` }] : [{ value: 'all', label: '所有适用文件' }, ...seed.filters.map((item, index) => ({ value: String(index), label: item.name, description: item.extensions.map(extension => `*.${extension}`).join('、') }))]} />}</div>}
      <div className="fd-footer-bottom"><div className="fd-target"><span>{seed.mode === 'save' ? '保存到' : needsProjectFolder ? '工作区位置' : projectPicker ? '项目文件夹' : seed.directoryOnly ? '将使用此文件夹' : '当前选择'}</span><strong title={explorer.target}>{explorer.target}</strong></div><div><button ref={cancel} className="sd-button sd-button-secondary" onClick={onCancel} disabled={explorer.busy === 'create' || explorer.busy === 'accept'}>取消</button><button ref={primary} className="sd-button sd-button-primary" disabled={!explorer.canAccept || creating || (!!needsProjectFolder && !canCreateHere)} onClick={() => { if (needsProjectFolder) beginNewFolder(); else void explorer.accept(); }}>{explorer.busy === 'accept' ? <LoaderCircle className="spin" size={16} /> : needsProjectFolder ? <FolderPlus size={17} /> : <Folder size={17} />}{explorer.busy === 'accept' ? '正在确认…' : needsProjectFolder ? '新建项目文件夹并继续' : explorer.actionLabel}</button></div></div>
    </footer>
    {explorer.overwrite && <div className="sd-overwrite-backdrop"><section className="sd-overwrite" role="alertdialog" aria-modal="true" aria-labelledby="overwrite-heading"><span className="sd-warning-icon"><AlertTriangle size={24} /></span><h2 id="overwrite-heading">替换已存在的文件？</h2><p>此位置已存在同名文件。确认后将使用本次内容替换它。</p><code>{explorer.overwrite.path}</code>{explorer.error && <p role="alert">{explorer.error}</p>}<div><button ref={overwriteCancel} className="sd-button sd-button-secondary" disabled={!!explorer.busy} onClick={explorer.dismissOverwrite}>返回修改</button><button ref={overwriteConfirm} className="sd-button sd-button-danger" disabled={!!explorer.busy} onClick={() => { void explorer.accept(); }}>确认覆盖</button></div></section></div>}
  </div>;
}
