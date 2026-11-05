import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, FileText, FolderOpen, GitBranch, Image, LoaderCircle, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { PageProps, ViewId } from '../types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import { groupedLocalSearch, localSearchIndex, normalizeSearch, searchOwnAssetItems } from '../lib/global-search';
import type { LocalSearchItem, SearchGroupKind, SearchTarget } from '../lib/global-search';
import { useGlobalAssetSearch } from '../hooks/useGlobalAssetSearch';
import { useProjectInventory } from '../hooks/useProjectInventory';
import { workflowPublicError } from '../lib/studio-run';
import { PreviewContent } from './ArtifactResults';
import { ModalPortal } from './ModalPortal';
import './global-search.css';

const OfficeFilePreview = lazy(() => import('./OfficeFilePreview').then(module => ({ default: module.OfficeFilePreview })));
interface Props { props: PageProps; navigation: { id: ViewId; label: string; icon: LucideIcon }[]; onClose: () => void; onNavigate: (view: ViewId, projectId?: string, target?: SearchTarget) => void; }
const iconFor = (item: LocalSearchItem) => item.kind === 'project' ? FolderOpen : item.kind === 'asset' ? Image : item.kind === 'prompt' ? BookOpen : item.kind === 'workflow' ? GitBranch : FileText;

export function GlobalSearch({ props, navigation, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState(''), deferred = useDeferredValue(query), normalized = normalizeSearch(deferred.slice(0, 120)).slice(0, 120), updating = normalizeSearch(query.slice(0, 120)).slice(0, 120) !== normalized;
  const [limits, setLimits] = useState<Partial<Record<SearchGroupKind, number>>>({}), [activeKey, setActiveKey] = useState('');
  const [file, setFile] = useState<LocalSearchItem>(), [preview, setPreview] = useState<ArtifactPreview>(), [fileError, setFileError] = useState(''), [reading, setReading] = useState(false), [opening, setOpening] = useState(false), [office, setOffice] = useState<ArtifactMetadata>();
  const scope = useRef(props.workspaceId); scope.current = props.workspaceId;
  const section = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null), generation = useRef(0), openRequest = useRef(0);
  const assetResults = useGlobalAssetSearch(props.workspaceId, normalized, limits.asset || 6);
  const inventory = useProjectInventory(props.activeProject.workspaceId === props.workspaceId && !props.activeProject.trashedAt && !props.activeProject.purgedAt ? props.activeProject.id : undefined, props.workflowRunner);
  const indexed = useMemo(() => localSearchIndex(props, navigation, inventory.files), [props.workspaceId, props.projects, props.prompts, props.configuration.workflows, props.workflowRunner.runs, props.workflowRunner.trashedArtifacts, inventory.files, navigation]);
  const own = useMemo(() => searchOwnAssetItems(assetResults.items, props.workspaceId), [assetResults.items, props.workspaceId]);
  const groups = useMemo(() => groupedLocalSearch([...indexed, ...own], normalized, limits).map(group => group.kind === 'asset' ? { ...group, total: group.total + Math.max(0, assetResults.total - own.length) } : group), [indexed, own, normalized, limits, assetResults.total]);
  const visible = groups.flatMap(group => group.items), selected = visible.find(item => item.key === activeKey) || visible[0];
  const fileAllowed = !!file?.projectId && props.projects.some(project => project.id === file.projectId && project.workspaceId === props.workspaceId && !project.trashedAt && !project.purgedAt);
  const officeAllowed = !!office?.projectId && props.projects.some(project => project.id === office.projectId && project.workspaceId === props.workspaceId && !project.trashedAt && !project.purgedAt);
  useEffect(() => { setActiveKey(''); setLimits({}); }, [normalized]);
  useEffect(() => { generation.current++; openRequest.current++; setFile(undefined); setPreview(undefined); setFileError(''); setReading(false); setOpening(false); setOffice(undefined); setQuery(''); setLimits({}); }, [props.workspaceId]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (selected) document.getElementById(`global-result-${encodeURIComponent(selected.key)}`)?.scrollIntoView({ block: 'nearest' }); }, [selected?.key]);
  useEffect(() => {
    if (!file?.file || !fileAllowed) return;
    let disposed = false; const identity = props.workspaceId, request = ++generation.current;
    setReading(true); setFileError(''); setPreview(undefined);
    void props.workflowRunner.previewArtifact(file.file.id).then(result => { if (!disposed && scope.current === identity && generation.current === request) setPreview(result); }).catch(cause => { if (!disposed && scope.current === identity && generation.current === request) setFileError(workflowPublicError(cause, '文件暂时无法预览，原文件与费用记录保留。')); }).finally(() => { if (!disposed && scope.current === identity && generation.current === request) setReading(false); });
    return () => { disposed = true; };
  }, [file?.key, props.workspaceId, fileAllowed]);
  function open(item: LocalSearchItem) {
    if (item.kind === 'file') { if (item.file?.kind === 'office') setOffice(item.file); else { setFile(item); input.current?.focus(); } return; }
    const target = ['asset', 'prompt', 'workflow'].includes(item.kind) ? { token: crypto.randomUUID(), kind: item.kind as SearchTarget['kind'], id: item.id, name: item.name, workspaceId: props.workspaceId } : undefined;
    if (item.view) onNavigate(item.view, item.projectId, target);
  }
  function dismiss() { if (file && fileAllowed) { generation.current++; setFile(undefined); input.current?.focus(); } else onClose(); }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== section.current) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
    if (file || !visible.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.target !== input.current && (!(event.target instanceof Element) || !event.target.closest('[role="option"]'))) return;
    event.preventDefault();
    if (updating) return;
    if (event.key === 'Enter') { if (selected) open(selected); return; }
    const index = visible.findIndex(item => item.key === selected?.key), next = (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    setActiveKey(visible[next].key);
  }
  async function openFile() {
    if (!file?.file || opening) return;
    const request = ++openRequest.current, identity = props.workspaceId, read = generation.current;
    setOpening(true); setFileError('');
    try { await props.workflowRunner.openArtifact(file.file.id); }
    catch (cause) { if (request === openRequest.current && scope.current === identity && generation.current === read) setFileError(workflowPublicError(cause, '未能打开原文件，请保留文件并检查本地路径。')); }
    finally { if (request === openRequest.current && scope.current === identity) setOpening(false); }
  }
  return <ModalPortal onClose={dismiss}><div className="global-search-backdrop modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={section} className="command-palette global-search-dialog" role="dialog" aria-modal="true" aria-label="统一搜索" onKeyDown={keydown}><header><Search size={20} /><input ref={input} autoFocus role="combobox" aria-label="搜索项目文件素材提示词和工作流" aria-autocomplete="list" aria-expanded={!file} aria-controls="global-search-results" aria-activedescendant={!file && selected ? `global-result-${encodeURIComponent(selected.key)}` : undefined} value={query} maxLength={120} placeholder="搜索项目、文件、素材、提示词、工作流…" onChange={event => { setFile(undefined); setQuery(event.target.value); }} />{query && <button type="button" className="btn-icon" aria-label="清空统一搜索" onClick={() => { setQuery(''); setFile(undefined); input.current?.focus(); }}><X size={16} /></button>}<button type="button" className="btn-icon" aria-label="关闭统一搜索" onClick={onClose}><X size={19} /></button></header>
    <div className="global-search-scope"><span>{props.workspace.name}</span><small>当前工作区与内置资源 · 搜索名称与说明</small></div>
    {file && fileAllowed ? <div className="global-file-preview"><button type="button" className="btn btn-ghost" onClick={() => { generation.current++; setFile(undefined); input.current?.focus(); }}><ArrowLeft size={15} />返回搜索结果</button><h2>{file.name}</h2><p>{file.description}</p>{reading ? <p role="status"><LoaderCircle size={18} className="spin" />正在读取所选文件…</p> : preview && file.file ? <PreviewContent artifact={file.file} preview={preview} /> : null}{fileError && <p role="alert" className="global-search-error">{fileError}</p>}<div className="global-file-actions"><button type="button" className="btn btn-secondary" disabled={opening} onClick={() => { void openFile(); }}>在本机打开原文件</button>{file.view && <button type="button" className="btn btn-primary" onClick={() => onNavigate(file.view!, file.projectId)}>进入项目工作台</button>}</div></div> : <div id="global-search-results" className="global-search-results" role="listbox" aria-label="分组搜索结果">{groups.map(group => group.items.length ? <section key={group.kind} role="group" aria-label={group.label}><div className="global-search-group"><strong>{group.label}</strong><small>{group.total} 项</small></div>{group.items.map(item => { const Icon = item.kind === 'page' ? navigation.find(page => page.id === item.view)?.icon || FileText : iconFor(item); return <button type="button" role="option" tabIndex={-1} id={`global-result-${encodeURIComponent(item.key)}`} key={item.key} className={`global-search-result ${selected?.key === item.key ? 'is-active' : ''}`} disabled={updating} aria-selected={selected?.key === item.key} onMouseMove={() => setActiveKey(item.key)} onClick={() => open(item)}><span className={`global-result-icon kind-${item.kind}`}><Icon size={17} /></span><span><strong>{item.name}</strong><small>{item.description || '打开查看，不会自动生成'}</small></span><ArrowUpRight size={15} /></button>; })}{group.total > group.items.length && <div className="global-search-more">{(limits[group.kind] || 6) < 50 ? <button type="button" onClick={() => setLimits(previous => ({ ...previous, [group.kind]: Math.min(50, (previous[group.kind] || 6) + 6) }))}>查看更多{group.label}（已显示 {group.items.length} / {group.total}）</button> : <small>已显示前 50 项，请缩小关键词继续查找。</small>}</div>}</section> : null)}{!visible.length && <div className="global-search-empty"><Search size={30} /><h2>{assetResults.loading ? '正在查找已登记内容…' : '没有找到匹配内容'}</h2><p>换个名称或关键词，或清空搜索查看当前工作区内容。</p><button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); input.current?.focus(); }}>清空搜索</button></div>}{assetResults.loading && visible.length > 0 && <p className="global-search-note" role="status"><LoaderCircle size={14} className="spin" />正在检索我的素材索引…</p>}{assetResults.error && <p className="global-search-error" role="alert">{assetResults.error}<button type="button" onClick={assetResults.retry}>重新读取素材索引</button></p>}{!assetResults.supported && <p className="global-search-note">当前环境可搜索内置素材；我的素材索引搜索需要新版桌面应用。</p>}{inventory.error && <p className="global-search-note">当前项目的额外文件清单暂不可读取；已登记运行产物仍可搜索。</p>}</div>}
    <footer><span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span><small>打开结果不启动模型，不扫描整个磁盘</small></footer></section></div>{office && officeAllowed && <Suspense fallback={<p role="status">正在打开实际文件预览…</p>}><OfficeFilePreview artifact={office} onClose={() => setOffice(undefined)} onOpenSource={() => { void props.workflowRunner.openArtifact(office.id).catch(cause => props.notify(workflowPublicError(cause, "原文件暂时无法打开。"), "error")); }} /></Suspense>}</ModalPortal>;
}
