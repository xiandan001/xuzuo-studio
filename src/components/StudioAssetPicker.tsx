import { RememberedDetails } from './RememberedDetails';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, Image, LoaderCircle, Search, ShieldCheck, X } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import type { AssetCategoryState, StudioAsset } from '../asset-types';
import { BUILTIN_ASSETS, BUILTIN_COLLECTIONS, builtinAssetImage, builtinAssetLicense, filterBuiltinAssets } from '../lib/builtin-assets';
import type { BuiltinAsset } from '../lib/builtin-assets';
import { studioAssetCandidates, studioAssetImageUrl } from '../lib/studio-asset-picker';
import { workflowPublicError } from '../lib/studio-run';
import { registerEditorSession } from '../lib/editor-session-guard';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import './StudioAssetPicker.css';

export interface StudioAssetPickerProps {
  props: PageProps;
  onClose: () => void;
  onChoose: (file: ArtifactMetadata) => void | Promise<void>;
  title?: string;
  description?: string;
  confirmLabel?: string;
  imagesOnly?: boolean;
  embedded?: boolean;
}
type Selection = { source: 'builtin'; asset: BuiltinAsset } | { source: 'mine'; asset: StudioAsset };
const emptyCategories = (): AssetCategoryState => ({ categories: [], assignments: {}, builtinAssignments: {} });

export function StudioAssetPicker({ props, onClose, onChoose, title = '选择素材', description, confirmLabel = '插入素材', imagesOnly = true, embedded = false }: StudioAssetPickerProps) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.assets;
  const project = props.activeProject, scope = `${props.workspaceId}/${project.id}`;
  const [source, setSource] = useState<'builtin' | 'mine'>('builtin');
  const [query, setQuery] = useState(''), [collection, setCollection] = useState('all'), [category, setCategory] = useState('all');
  const [categories, setCategories] = useState<AssetCategoryState>(emptyCategories);
  const [own, setOwn] = useState<StudioAsset[]>([]), [loadedOwnScope, setLoadedOwnScope] = useState('');
  const [selection, setSelection] = useState<Selection>(), [preview, setPreview] = useState<ArtifactPreview>();
  const [loadingOwn, setLoadingOwn] = useState(false), [loadingPreview, setLoadingPreview] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [ownError, setOwnError] = useState(''), [categoryError, setCategoryError] = useState(''), [previewError, setPreviewError] = useState('');
  const [limit, setLimit] = useState(12), [refreshOwn, setRefreshOwn] = useState(0);
  const mounted = useRef(false), pending = useRef(false), request = useRef(0);
  const current = useRef({ scope, onChoose, onClose }); current.current = { scope, onChoose, onClose };
  const contextValid = project.workspaceId === props.workspaceId && !project.trashedAt && !!project.id;
  const bound = !!props.workspace.directory;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => registerEditorSession({ id: `material-picker-${scope}`, projectId: project.id, label: '正在复制并使用素材', getState: () => ({ dirty: false, pending: pending.current }), save: async () => false, exportRecovery: () => false }), [scope, project.id]);
  useEffect(() => {
    request.current++; pending.current = false; setBusy(false); setSelection(undefined); setPreview(undefined); setError(''); setPreviewError(''); setCategoryError(''); setOwnError(''); setOwn([]); setLoadedOwnScope(''); setCategories(emptyCategories()); setCategory('all');
  }, [scope]);
  useEffect(() => {
    let disposed = false;
    if (!bound || !bridge?.categories) return;
    void bridge.categories({ workspaceId: props.workspaceId }).then(result => { if (!disposed) setCategories(result); }).catch(cause => { if (!disposed) setCategoryError(workflowPublicError(cause, '分类暂时无法读取，仍可浏览内置集合。')); });
    return () => { disposed = true; };
  }, [scope, bound, bridge]);
  useEffect(() => {
    if (source !== 'mine' || !bridge || !bound) return;
    let disposed = false; setLoadingOwn(true); setOwnError('');
    void bridge.list({ workspaceId: props.workspaceId }).then(result => { if (!disposed) { setOwn(result); setLoadedOwnScope(scope); } }).catch(cause => { if (!disposed) setOwnError(workflowPublicError(cause, '我的素材暂时无法读取，原文件未修改。')); }).finally(() => { if (!disposed) setLoadingOwn(false); });
    return () => { disposed = true; };
  }, [source, scope, bridge, bound, refreshOwn]);
  useEffect(() => {
    setPreview(undefined); setPreviewError(''); setLoadingPreview(false);
    if (selection?.source !== 'mine' || !bridge || selection.asset.unavailable) return;
    let disposed = false; setLoadingPreview(true);
    void bridge.preview({ workspaceId: props.workspaceId, id: selection.asset.id }).then(result => { if (!disposed) setPreview(result); }).catch(cause => { if (!disposed) setPreviewError(workflowPublicError(cause, '预览暂时无法读取，未使用这份文件。')); }).finally(() => { if (!disposed) setLoadingPreview(false); });
    return () => { disposed = true; };
  }, [selection, scope, bridge]);
  useEffect(() => { setLimit(12); setSelection(undefined); setError(''); }, [source, query, collection, category]);

  const builtin = useMemo(() => filterBuiltinAssets(BUILTIN_ASSETS, { query, collection, origin: 'all', transparent: false }).filter(asset => category === 'all' || category === 'none' ? category !== 'none' || !categories.builtinAssignments[asset.id] : categories.builtinAssignments[asset.id] === category), [query, collection, category, categories]);
  const mine = useMemo(() => studioAssetCandidates(loadedOwnScope === scope ? own : [], props.workspaceId, imagesOnly, query, category, categories.assignments), [own, loadedOwnScope, scope, props.workspaceId, imagesOnly, query, category, categories]);
  const total = source === 'builtin' ? builtin.length : mine.length;
  const selectedBuiltin = selection?.source === 'builtin' ? selection.asset : undefined;
  const selectedOwn = selection?.source === 'mine' ? selection.asset : undefined;
  const license = selectedBuiltin ? builtinAssetLicense(selectedBuiltin) : undefined;
  const imageUrl = selectedBuiltin ? builtinAssetImage(selectedBuiltin, false) : studioAssetImageUrl(preview?.dataUrl);
  const usable = !!selection && !(selection.source === 'mine' && selection.asset.unavailable) && contextValid && bound && !!bridge && (selection.source === 'builtin' ? !!bridge.attachBuiltin : !!bridge.attach);

  async function choose(item = selection) {
    if (!item || pending.current || !bridge || !contextValid || !bound || item.source === 'mine' && item.asset.unavailable) return;
    const callback = current.current, identity = scope, operation = ++request.current;
    pending.current = true; setBusy(true); setError('');
    let copied = false;
    try {
      const file = item.source === 'builtin' ? await bridge.attachBuiltin?.({ workspaceId: props.workspaceId, projectId: project.id, id: item.asset.id }) : await bridge.attach({ workspaceId: props.workspaceId, projectId: project.id, id: item.asset.id });
      if (!file) throw new Error('请升级桌面应用后使用内置素材。');
      copied = true;
      if (!mounted.current || current.current.scope !== identity || request.current !== operation) return;
      if (file.projectId !== project.id || file.unavailable || file.trashedAt || (imagesOnly && file.kind !== 'image')) throw new Error('返回的素材不属于当前项目或已不可用。');
      await callback.onChoose(file);
      if (mounted.current && current.current.scope === identity && request.current === operation) callback.onClose();
    } catch (cause) {
      if (mounted.current && current.current.scope === identity && request.current === operation) setError(`${workflowPublicError(cause, '素材未能应用。')}${copied ? ' 副本已保留在项目文件中，当前内容未被覆盖。' : ''}`);
    } finally {
      if (mounted.current && current.current.scope === identity && request.current === operation) { pending.current = false; setBusy(false); }
    }
  }
  function select(item: Selection) { if (!pending.current) { setSelection(previous => previous?.source === item.source && previous.asset.id === item.asset.id ? previous : item); setError(''); } }
  const availabilityNote = !bridge ? '浏览器中可预览；请在桌面版中选择并使用真实素材。' : !contextValid ? '请先打开一个有效的项目工作台。' : !bound ? '请先连接当前工作区的本地文件夹。' : source === 'builtin' && !bridge.attachBuiltin ? '请升级桌面应用后使用内置素材。' : '只复制所选文件，不离开工作台，也不会自动调用模型。';
  const panel = <section className={`sap-dialog ${embedded ? "sap-embedded" : ""}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="选择工作台素材"><header className="sap-header"><span className="sap-heading-icon"><Image size={22} /></span><div><h2>{title}</h2><p>{description || (imagesOnly ? '选择图片，直接用于当前工作台' : '选择素材，加入当前项目的参考资料')}</p></div><button type="button" className="btn-icon" disabled={busy} aria-label="关闭素材选择" onClick={onClose}><X size={19} /></button></header>
    <div className="sap-toolbar"><div className="sap-source-tabs" role="tablist" aria-label="素材来源"><button type="button" role="tab" aria-selected={source === 'builtin'} className={source === 'builtin' ? 'active' : ''} disabled={busy} onClick={() => setSource('builtin')}>内置素材<span>{BUILTIN_ASSETS.length}</span></button><button type="button" role="tab" aria-selected={source === 'mine'} className={source === 'mine' ? 'active' : ''} disabled={busy} onClick={() => setSource('mine')}>我的素材</button></div><label className="sap-search"><Search size={17} /><input autoFocus disabled={busy} aria-label="搜索工作台素材" placeholder="搜索名称、用途或关键词" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" disabled={busy} aria-label="清除素材搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label><div className="sap-filters">{source === 'builtin' && <Select disabled={busy} aria-label="素材集合" value={collection} onValueChange={setCollection} options={[{ value: 'all', label: '全部集合' }, ...BUILTIN_COLLECTIONS.map(value => ({ value, label: value }))]} />}<Select disabled={busy || !bound || !bridge?.categories} aria-label="素材分类" value={category} onValueChange={setCategory} options={[{ value: 'all', label: '全部我的分类' }, { value: 'none', label: '未归类' }, ...categories.categories.map(item => ({ value: item.id, label: item.name }))]} /></div></div>
    <div className="sap-body"><div className="sap-results"><div className="sap-result-heading"><span>{loadingOwn && source === 'mine' ? '正在读取我的素材…' : `${total} 件可选素材`}</span><small>单击预览 · 双击直接使用</small></div>{categoryError && <p className="sap-inline-note">{categoryError}</p>}{source === 'mine' && (!bridge || !bound) ? <div className="sap-empty"><FileText size={30} /><strong>暂时无法读取我的素材</strong><p>{availabilityNote}</p></div> : source === 'mine' && ownError ? <div className="sap-empty"><FileText size={30} /><p role="alert">{ownError}</p><button type="button" className="btn btn-secondary" onClick={() => setRefreshOwn(value => value + 1)}>重新读取</button></div> : loadingOwn && source === 'mine' ? <div className="sap-empty" role="status"><LoaderCircle size={25} className="spin" /><p>正在读取当前工作区素材</p></div> : <><div className="sap-grid">{source === 'builtin' ? builtin.slice(0, limit).map(asset => <button type="button" className={`sap-card ${selection?.source === 'builtin' && selection.asset.id === asset.id ? 'selected' : ''}`} key={asset.id} aria-label={`选择素材 ${asset.name}`} aria-pressed={selection?.source === 'builtin' && selection.asset.id === asset.id} disabled={busy} onClick={() => select({ source: 'builtin', asset })} onDoubleClick={() => { void choose({ source: 'builtin', asset }); }}><span className={`sap-thumb ${asset.transparent ? 'transparent' : ''}`}><img src={builtinAssetImage(asset)} alt="" width="320" height="180" loading="lazy" decoding="async" />{selection?.source === 'builtin' && selection.asset.id === asset.id && <i><Check size={15} /></i>}</span><strong>{asset.name}</strong><small>{asset.collection}</small></button>) : mine.slice(0, limit).map(asset => <button type="button" className={`sap-card sap-own-card ${selection?.source === 'mine' && selection.asset.id === asset.id ? 'selected' : ''}`} key={asset.id} aria-label={`选择素材 ${asset.name}`} aria-pressed={selection?.source === 'mine' && selection.asset.id === asset.id} disabled={busy || asset.unavailable} onClick={() => select({ source: 'mine', asset })} onDoubleClick={() => { void choose({ source: 'mine', asset }); }}><span className="sap-thumb">{asset.kind === 'image' ? <Image size={34} /> : <FileText size={34} />}{selection?.source === 'mine' && selection.asset.id === asset.id && <i><Check size={15} /></i>}</span><strong>{asset.name}</strong><small>{asset.unavailable ? '文件不可用' : `${(asset.bytes / 1024).toFixed(1)} KB · ${asset.kind === 'image' ? '图片' : '参考资料'}`}</small></button>)}</div>{!total && <div className="sap-empty"><Search size={30} /><strong>{query || category !== 'all' || collection !== 'all' ? '没有匹配的素材' : source === 'mine' ? '我的素材里还没有可用内容' : '这里还没有素材'}</strong><p>{source === 'mine' && !query ? '可先在素材库中导入文件，再回到这里选择。' : '换个关键词，或清除筛选条件。'}</p>{(query || category !== 'all' || collection !== 'all') && <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setCollection('all'); setCategory('all'); }}>清除筛选</button>}</div>}{total > limit && <button type="button" disabled={busy} className="btn btn-secondary sap-load-more" onClick={() => setLimit(value => value + 12)}>再显示 {Math.min(12, total - limit)} 件</button>}</> }</div>
      <aside className="sap-preview" aria-label="素材预览">{selection ? <><div className={`sap-preview-image ${selectedBuiltin?.transparent ? 'transparent' : ''}`}>{loadingPreview ? <span role="status"><LoaderCircle size={24} className="spin" />正在读取预览…</span> : imageUrl ? <img src={imageUrl} alt={`${selection.asset.name}预览`} decoding="async" /> : preview?.text ? <pre>{preview.text.slice(0, 12000)}</pre> : selectedOwn && !previewError ? <span><FileText size={35} />此格式可作为参考资料使用</span> : <Image size={35} />}</div><h3>{selection.asset.name}</h3><p>{selectedBuiltin?.description || `${selection.asset.mimeType} · ${(selection.asset.bytes / 1024).toFixed(1)} KB`}</p>{preview?.text && preview.text.length > 12000 && <small>这里只预览前 12000 字符，使用时会复制完整文件。</small>}{previewError && <p role="alert" className="sap-error">{previewError}</p>}{selectedOwn?.provenance && <RememberedDetails rememberKey={`asset:${selectedOwn.id}:picker-license`} className="sap-license"><summary><ShieldCheck size={14} />来源与使用许可</summary><p>{selectedOwn.provenance.author} · {selectedOwn.provenance.licenseName}</p><p>{selectedOwn.provenance.usageNote}</p><pre>{selectedOwn.provenance.licenseNotice}</pre></RememberedDetails>}{selectedBuiltin && <RememberedDetails rememberKey={`builtin-asset:${selectedBuiltin.id}:picker-license`} className="sap-license"><summary><ShieldCheck size={14} />{license?.name || selectedBuiltin.licenseId}</summary><p>{selectedBuiltin.author}</p><p>{selectedBuiltin.usageNote}</p><pre>{license?.notice}</pre></RememberedDetails>}</> : <div className="sap-empty sap-preview-empty"><Image size={35} /><strong>先选一件素材</strong><p>在左侧预览，再点击下方按钮使用。</p></div>}</aside>
    </div><footer className="sap-footer"><div>{error ? <p className="sap-error" role="alert">{error}</p> : <p>{availabilityNote}</p>}</div><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="btn btn-primary" aria-label="确认使用所选素材" disabled={busy || !usable} onClick={() => { void choose(); }}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? '正在使用…' : confirmLabel}</button></footer>
  </section>;
  return embedded ? panel : <ModalPortal onClose={onClose} busy={busy}><div className="sap-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !pending.current) onClose(); }}>{panel}</div></ModalPortal>;
}
