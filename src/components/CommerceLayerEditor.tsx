import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, History, ImagePlus, Layers3, LoaderCircle, LockKeyhole, Plus, Redo2, Save, ShieldCheck, Trash2, Type, Undo2, UnlockKeyhole } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { CommerceImageRenderResult, CommerceImageSavedVersion, CommerceImageSize } from '../commerce-image-types';
import { useCommerceDocument } from '../hooks/useCommerceDocument';
import { changeCommerceLayer, commerceDocumentIssue, commerceImageLayer, commerceTextLayer, moveCommerceLayer } from '../lib/commerce-image';
import { registerEditorSession } from '../lib/editor-session-guard';
import { isTextEditingTarget } from '../lib/edit-history';
import { Select } from './Select';
import { StudioDrawer } from './StudioDrawer';
import { CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { CommerceLayerCanvas } from './CommerceLayerCanvas';
import type { CommerceLayerCanvasHandle, CommerceMaskMode } from './CommerceLayerCanvas';
import { CommerceLayerProperties } from './CommerceLayerProperties';
import './CommerceLayerEditor.css';

export interface CommerceLayerEditorProps { props: PageProps; projectId: string; sourceArtifactId?: string; backgroundArtifactId?: string; alphaArtifactId?: string; logoArtifactId?: string; initialText?: string; onExport?: (result: CommerceImageRenderResult) => void; }
const isImage = (file: ArtifactMetadata) => file.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) && !file.trashedAt && !file.unavailable;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作暂未完成，当前图层和已发生费用保留。';

export function CommerceLayerEditor(props: CommerceLayerEditorProps) { return <CommerceLayerEditorProject key={`${props.projectId}:${props.sourceArtifactId || ''}`} {...props} />; }
function CommerceLayerEditorProject({ props, projectId, sourceArtifactId: initialSource, backgroundArtifactId, alphaArtifactId, logoArtifactId, initialText, onExport }: CommerceLayerEditorProps) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.commerceImages, project = props.projects.find(item => item.id === projectId);
  const [sourceId, setSourceId] = useState(initialSource || ''), [files, setFiles] = useState<ArtifactMetadata[]>([]), [previews, setPreviews] = useState<Record<string, string>>({}), [selectedId, setSelectedId] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [maskMode, setMaskMode] = useState<CommerceMaskMode>(), [maskBase, setMaskBase] = useState(''), [historyOpen, setHistoryOpen] = useState(false), [versions, setVersions] = useState<CommerceImageSavedVersion[]>([]), [outputs, setOutputs] = useState<ArtifactMetadata[]>([]), [exportSize, setExportSize] = useState('original');
  const [customWidth, setCustomWidth] = useState('1080'), [customHeight, setCustomHeight] = useState('1080');
  const store = useCommerceDocument(projectId, sourceId || undefined, bridge, project?.name || '商品图片'), canvas = useRef<CommerceLayerCanvasHandle>(null), alive = useRef(true), operations = useRef(new Set<Promise<unknown>>()), maskDirty = useRef(false), initialApplied = useRef(''), protectionBase = useRef('');
  const latest = useRef({ store, busy, onExport }); latest.current = { store, busy, onExport };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const track = useCallback((task: Promise<unknown>) => { operations.current.add(task); void task.finally(() => operations.current.delete(task)).catch(() => undefined); }, []);
  const flushAll = useCallback(async () => { canvas.current?.flushDrag(); if (!await canvas.current?.applyPendingMask() && maskDirty.current) return false; return latest.current.store.flush(); }, []);
  useEffect(() => registerEditorSession({ id: `commerce-tasks:${projectId}`, projectId, label: '商品图层与保护区', getState: () => ({ dirty: maskDirty.current || !!canvas.current?.hasPendingEdits(), pending: operations.current.size > 0 || maskDirty.current || !!canvas.current?.hasPendingEdits() }), save: async () => { await Promise.allSettled([...operations.current]); return flushAll(); }, exportRecovery: () => latest.current.store.recover() }), [projectId, flushAll]);
  const document = store.document, source = store.readResult?.source, selected = document?.layers.find(layer => layer.id === selectedId), disabled = Boolean(busy || store.loading || !bridge);
  useEffect(() => { if (!document) return; if (!document.layers.some(layer => layer.id === selectedId)) setSelectedId(document.layers.at(-1)?.id || ''); }, [document?.id, document?.layers, selectedId]);
  useEffect(() => { if (store.readResult) setPreviews(previous => ({ ...previous, ...store.readResult!.previews })); }, [store.readResult]);
  useEffect(() => { if (store.dirty) { setOutputs([]); if (project?.confirmedDelivery) props.onUpdateProject(projectId, { confirmedDelivery: undefined, ...(project.status === 'complete' ? { status: 'review' as const } : {}) }); } }, [store.dirty, project?.confirmedDelivery]);
  useEffect(() => {
    let disposed = false; void props.workflowRunner.listProjectArtifacts?.(projectId).then(result => { if (!disposed) setFiles(result.filter(isImage)); }).catch(cause => { if (!disposed) setError(errorText(cause)); });
    return () => { disposed = true; };
  }, [projectId, props.workflowRunner.inventoryRevision]);
  async function preview(fileId: string) {
    if (previews[fileId]) return previews[fileId];
    const value = props.workflowRunner.thumbnailArtifact ? await props.workflowRunner.thumbnailArtifact(fileId) : await props.workflowRunner.previewArtifact(fileId);
    if (value.dataUrl && alive.current) setPreviews(previous => ({ ...previous, [fileId]: value.dataUrl! })); return value.dataUrl;
  }
  useEffect(() => {
    if (!document || !source || store.readResult?.document || initialApplied.current === document.id || !(backgroundArtifactId || alphaArtifactId || logoArtifactId || initialText)) return;
    initialApplied.current = document.id; const captured = document;
    const task = (async () => {
      let value = captured;
      if (backgroundArtifactId) value = { ...value, layers: [commerceImageLayer(backgroundArtifactId, '背景', value.width, value.height, 'background'), ...value.layers] };
      if (logoArtifactId) value = { ...value, layers: [...value.layers, commerceImageLayer(logoArtifactId, '品牌Logo', value.width * .2, value.height * .15)] };
      if (initialText) value = { ...value, layers: [...value.layers, commerceTextLayer(value.width, value.height, initialText)] };
      if (alphaArtifactId && bridge) { const result = await bridge.applyAlpha({ projectId, sourceArtifactId: source.id, alphaArtifactId }); value = { ...value, layers: value.layers.map(layer => layer.type === 'image' && layer.role === 'product' ? { ...layer, artifactId: result.artifact.id } : layer) }; await preview(result.artifact.id); }
      if (alive.current && store.current.current === captured) store.change(value); else if (alive.current) setError('主体素材已保留在项目中，当前后续编辑没有被旧准备结果覆盖。');
    })().catch(cause => { if (alive.current) setError(errorText(cause)); }); track(task);
  }, [document?.id, source?.id]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => { if (disabled || isTextEditingTarget(event.target) || !(event.ctrlKey || event.metaKey)) return; if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) store.redo(); else store.undo(); } if (event.key.toLowerCase() === 's') { event.preventDefault(); void flushAll(); } };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [disabled, store.undo, store.redo, flushAll]);
  async function importImage(role: 'source' | 'background' | 'logo') {
    if (disabled) return; setBusy('import'); setError('');
    try {
      if (role === 'source' && store.current.current && !await flushAll()) return;
      const items = (await props.workflowRunner.importFiles(projectId)).filter(isImage); if (!alive.current) return;
      const file = items[0]; if (!file) return; setFiles(previous => [...items, ...previous.filter(old => !items.some(item => item.id === old.id))]);
      if (role === 'source') { setSourceId(file.id); return; }
      const current = store.current.current; if (!current) return;
      const thumbnail = props.workflowRunner.thumbnailArtifact ? await props.workflowRunner.thumbnailArtifact(file.id) : await props.workflowRunner.previewArtifact(file.id); if (!alive.current) return;
      if (thumbnail.dataUrl) setPreviews(previous => ({ ...previous, [file.id]: thumbnail.dataUrl! }));
      const iw = thumbnail.originalWidth || thumbnail.width || current.width, ih = thumbnail.originalHeight || thumbnail.height || current.height, scale = role === 'background' ? Math.max(current.width / iw, current.height / ih) : Math.min(current.width * .2 / iw, current.height * .18 / ih);
      const layer = { ...commerceImageLayer(file.id, role === 'logo' ? '品牌Logo' : '背景', iw * scale, ih * scale, role), x: role === 'logo' ? current.width * .04 : (current.width - iw * scale) / 2, y: role === 'logo' ? current.height * .04 : (current.height - ih * scale) / 2 };
      const latest = store.current.current; if (!latest || latest.id !== current.id) return; store.change({ ...latest, layers: role === 'background' ? [layer, ...latest.layers] : [...latest.layers, layer] }); setSelectedId(layer.id);
    } catch (cause) { if (alive.current) setError(errorText(cause)); } finally { if (alive.current) setBusy(''); }
  }
  async function selectSource(id: string) { if (disabled || !id || id === sourceId) return; if (store.current.current && !await flushAll()) return; setSourceId(id); setMaskMode(undefined); setOutputs([]); }
  async function beginMask(mode: CommerceMaskMode) {
    if (disabled || !bridge || !document || !source) return; setError('');
    if (mode === 'product') { setMaskMode(mode); return; }
    setBusy('protect-base');
    try {
      if (!await flushAll() || !store.scope.current) return;
      const current = store.current.current!;
      const result = await bridge.render({ ...store.scope.current, expectedRevision: store.revision.current, sizes: [{ width: current.width, height: current.height, label: '保护基准' }] });
      if (!alive.current || current.id !== store.current.current?.id) return;
      const file = result.artifacts.find(item => item.mimeType === 'image/png'); if (!file) throw Error('没有生成实际保护基准图。');
      protectionBase.current = file.id; setMaskBase(await preview(file.id) || ''); setMaskMode('protect');
    } catch (cause) { if (alive.current) setError(errorText(cause)); } finally { if (alive.current) setBusy(''); }
  }
  async function applyMask(dataUrl: string) {
    if (!bridge || !store.scope.current || !source) throw Error('请先选择原图。'); setError('');
    try {
      const scope = { ...store.scope.current }, documentId = store.current.current?.id, artifact = await bridge.mask({ ...scope, dataUrl });
      let product: ArtifactMetadata | undefined;
      if (maskMode === 'product') product = (await bridge.applyAlpha({ ...scope, alphaArtifactId: artifact.id })).artifact;
      const current = store.current.current; if (!alive.current || !current || current.id !== documentId) return;
      if (product) { await preview(product.id); store.change({ ...current, layers: current.layers.map(layer => layer.type === 'image' && layer.role === 'product' ? { ...layer, artifactId: product!.id } : layer) }); }
      else { await preview(artifact.id); store.change({ ...current, protectedMaskArtifactId: artifact.id, protectionSourceArtifactId: protectionBase.current }); }
      setMaskMode(undefined); props.notify(product ? '已用蒙版透明度保留原图主体RGB，未调用模型。' : '保护区已应用，未选区域将保留基准原像素。');
    } catch (cause) { if (alive.current) setError(errorText(cause)); throw cause; }
  }
  function sizes(): CommerceImageSize[] {
    const current = store.current.current!;
    if (exportSize === 'all') return [{ width: current.width, height: current.height, label: '原画布' }, { width: 1080, height: 1080, label: '正方形' }, { width: 1080, height: 1440, label: '竖版' }].filter((item, index, all) => all.findIndex(other => other.width === item.width && other.height === item.height) === index);
    if (exportSize === 'custom') return [{ width: Number(customWidth), height: Number(customHeight), label: '自定义' }];
    return [{ width: current.width, height: current.height, label: '原画布' }];
  }
  async function exportImages() {
    if (disabled || !bridge) return; setBusy('export'); setError('');
    try {
      if (!await flushAll() || !store.scope.current) return;
      const id = store.current.current?.id, result = await bridge.render({ ...store.scope.current, expectedRevision: store.revision.current, sizes: sizes() });
      if (!alive.current || store.current.current?.id !== id) return; setOutputs(result.artifacts.filter(item => item.mimeType === 'image/png')); latest.current.onExport?.(result); props.notify('实际PNG和可编辑图层已保存，手工排版没有调用模型。');
    } catch (cause) { if (alive.current) setError(errorText(cause)); } finally { if (alive.current) setBusy(''); }
  }
  async function showHistory() { if (!bridge?.history || !store.scope.current || disabled) return; setBusy('history'); try { setVersions(await bridge.history(store.scope.current)); if (alive.current) setHistoryOpen(true); } catch (cause) { if (alive.current) setError(errorText(cause)); } finally { if (alive.current) setBusy(''); } }
  async function restore(version: number) { if (!bridge?.restore || !store.scope.current) return; setBusy('restore'); try { if (!await flushAll()) return; const value = await bridge.restore({ ...store.scope.current, expectedRevision: store.revision.current, revision: version }); if (alive.current) { store.accept(value, true); setHistoryOpen(false); setOutputs([]); } } catch (cause) { if (alive.current) setError(errorText(cause)); } finally { if (alive.current) setBusy(''); } }
  const fees = summarizeCosts(props.ledger.filter(entry => entry.projectId === projectId && entry.billingMode === 'live')), issue = document && commerceDocumentIssue(document);
  return <section className="commerce-layer-editor" aria-label="商品图层与原像素保护"><header className="cle-heading"><div><Layers3 size={23} /><div><h2>排版与主体保护</h2><span role="status">{store.loading ? '正在读取图层…' : store.saving ? '保存中…' : store.dirty ? '有未保存修改' : document?.revision ? `已保存 · v${document.revision}` : '选择原图后编辑'}</span></div></div><nav><button type="button" className="btn btn-secondary" disabled={disabled || !document} onClick={() => { track(flushAll()); }}><Save size={16} />保存</button><button type="button" className="btn btn-ghost" disabled={disabled || !document} onClick={() => { void showHistory(); }}><History size={16} />记录</button><button type="button" className="btn btn-primary" disabled={disabled || !document || !!issue} onClick={() => { track(exportImages()); }}>{busy === 'export' ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}导出成品</button></nav></header>
    <div className="cle-toolbar"><label>图片<Select aria-label="图层原图或已有成品" value={sourceId} disabled={disabled} onValueChange={id => { void selectSource(id); }} options={[{ value: '', label: '选择本项目图片' }, ...files.map(file => ({ value: file.id, label: file.name })), ...(sourceId && !files.some(file => file.id === sourceId) ? [{ value: sourceId, label: '当前图片' }] : [])]} /></label><button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => { track(importImage('source')); }}><ImagePlus size={16} />导入</button><div className="cle-toolbar-separator" /><button type="button" className="btn-icon" aria-label="撤销图层修改" disabled={disabled || !store.canUndo} onClick={store.undo}><Undo2 size={17} /></button><button type="button" className="btn-icon" aria-label="重做图层修改" disabled={disabled || !store.canRedo} onClick={store.redo}><Redo2 size={17} /></button><span>改字、改价、Logo排版和撤销不消耗API费用</span></div>
    {(error || store.error) && <div className="cle-error" role="alert"><span>{error || store.error}</span>{store.error && <><button type="button" className="text-button" onClick={() => { void store.recover(); }}>导出当前恢复JSON</button><button type="button" className="text-button" onClick={() => { void store.reload(); }}>重新读取</button></>}</div>}
    {store.readResult?.workingDiffersFromExport && <div className="cle-resume-note" role="status"><span>正在继续这份成品的较新图层工作稿；已导出的原成品保持原样。</span><button type="button" className="text-button" disabled={disabled} onClick={() => { void store.reload(true); }}>从所选成品另建编辑分支</button></div>}
    {!bridge && <div className="cle-empty"><h3>请使用新版桌面应用</h3><p>本地背景、主体、文字、Logo图层需要桌面文件服务。</p></div>}
    {bridge && !document && <div className="cle-empty">{store.loading ? <LoaderCircle size={28} className="spin" /> : <><ImagePlus size={34} /><h3>选择一张图片开始</h3><p>已有商品成品会恢复其文字和Logo图层，原图始终保留。</p><button type="button" className="btn btn-primary" disabled={disabled} onClick={() => { track(importImage('source')); }}>导入原图</button></>}</div>}
    {document && source && <div className="cle-layout"><aside className="cle-layers" aria-label="独立图层"><header><strong>图层</strong><span>{document.layers.length} / 32</span></header><div className="cle-add-actions"><button type="button" className="btn btn-secondary" disabled={disabled || document.layers.length >= 32} onClick={() => { const current = store.current.current!; const layer = commerceTextLayer(current.width, current.height); store.change({ ...current, layers: [...current.layers, layer] }); setSelectedId(layer.id); }}><Type size={15} />加文字</button><button type="button" className="btn btn-secondary" disabled={disabled || document.layers.length >= 32} onClick={() => { track(importImage('logo')); }}>Logo</button><button type="button" className="btn btn-secondary" disabled={disabled || document.layers.length >= 32} onClick={() => { track(importImage('background')); }}><Plus size={15} />背景</button></div><div className="cle-layer-list">{[...document.layers].reverse().map(layer => <article key={layer.id} className={selectedId === layer.id ? 'active' : ''}><button type="button" className="cle-layer-name" onClick={() => setSelectedId(layer.id)}><span>{layer.type === 'text' ? '文' : layer.role === 'product' ? '物' : layer.role === 'logo' ? '标' : '景'}</span><strong>{layer.name}</strong></button><div><button type="button" className="btn-icon" aria-label={`${layer.visible ? '隐藏' : '显示'}图层${layer.name}`} disabled={disabled} onClick={() => store.change(changeCommerceLayer(document, layer.id, { visible: !layer.visible }, true))}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button type="button" className="btn-icon" aria-label={`${layer.locked ? '解锁' : '锁定'}图层${layer.name}`} disabled={disabled} onClick={() => store.change(changeCommerceLayer(document, layer.id, { locked: !layer.locked }, true))}>{layer.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}</button></div></article>)}</div><div className="cle-layer-order"><button type="button" className="btn-icon" aria-label="上移图层" disabled={disabled || !selected || selected.locked} onClick={() => store.change(moveCommerceLayer(document, selectedId, 1))}><ArrowUp size={16} /></button><button type="button" className="btn-icon" aria-label="下移图层" disabled={disabled || !selected || selected.locked} onClick={() => store.change(moveCommerceLayer(document, selectedId, -1))}><ArrowDown size={16} /></button><button type="button" className="btn-icon" aria-label="删除图层" disabled={disabled || !selected || selected.locked} onClick={() => store.change({ ...document, layers: document.layers.filter(layer => layer.id !== selectedId) })}><Trash2 size={16} /></button></div><section className="cle-local-tools"><label>画布背景<Select aria-label="图层画布背景" value={document.background} disabled={disabled} onValueChange={background => store.change({ ...document, background })} options={[{ value: '#FFFFFF', label: '白底' }, { value: '#111111', label: '深色' }, { value: 'transparent', label: '透明背景' }, ...(!['#FFFFFF', '#111111', 'transparent'].includes(document.background) ? [{ value: document.background, label: '当前品牌色' }] : [])]} /></label><h3>主体与局部保护</h3><button type="button" className="btn btn-secondary" disabled={disabled || !!maskMode} onClick={() => { track(beginMask('product')); }}>手工涂选主体</button><button type="button" className="btn btn-secondary" disabled={disabled || !!maskMode} onClick={() => { track(beginMask('protect')); }}><ShieldCheck size={15} />选择允许修改区</button>{document.protectedMaskArtifactId && <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => store.change({ ...document, protectedMaskArtifactId: undefined, protectionSourceArtifactId: undefined })}>取消保护限制</button>}<p>涂选主体只改变透明度。保护区锁定未选位置；改动未选文字或Logo前可取消保护。</p></section></aside>
      <CommerceLayerCanvas ref={canvas} document={document} source={source} previews={previews} selectedId={selectedId} disabled={disabled} maskMode={maskMode} maskBase={maskBase} maskArtifactId={protectionBase.current} previewBridge={bridge} onSelect={setSelectedId} onChange={store.change} onMask={applyMask} onCancelMask={() => { setMaskMode(undefined); maskDirty.current = false; }} onMaskDirty={value => { maskDirty.current = value; }} />
      <CommerceLayerProperties document={document} selected={selected} disabled={disabled || !!maskMode} onChange={store.change} />
    </div>}
    {document && <footer className="cle-footer"><div className="cle-export-options"><Select aria-label="本地导出尺寸" value={exportSize} disabled={disabled} onValueChange={setExportSize} options={[{ value: 'original', label: '当前画布尺寸' }, { value: 'all', label: '画布＋正方形＋竖版' }, { value: 'custom', label: '自定义像素' }]} />{exportSize === 'custom' && <><input className="field" aria-label="导出宽度" inputMode="numeric" value={customWidth} disabled={disabled} onChange={event => setCustomWidth(event.target.value)} /><span>×</span><input className="field" aria-label="导出高度" inputMode="numeric" value={customHeight} disabled={disabled} onChange={event => setCustomHeight(event.target.value)} /></>}{issue && <span className="cle-inline-error">{issue}</span>}</div><span>项目原有API花费 <CostTotal summary={fees} /></span></footer>}
    {outputs.length > 0 && <div className="cle-output-files" role="status"><strong>实际成品已保存</strong>{outputs.map(file => <button key={file.id} type="button" className="text-button" onClick={() => { void props.workflowRunner.saveArtifact(file.id).catch(cause => setError(errorText(cause))); }}>{file.name}<Download size={14} /></button>)}</div>}
    {historyOpen && <StudioDrawer title="图层保存记录" description="恢复只改变图层内容，已发生费用不会撤回。" onClose={() => setHistoryOpen(false)}>{versions.length ? versions.map(version => <article className="cle-history-item" key={version.revision}><div><strong>v{version.revision} · {version.title}</strong><small>{new Date(version.savedAt).toLocaleString('zh-CN')}</small></div><button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => { track(restore(version.revision)); }}>恢复此版</button></article>) : <p>保存工程后会保留最近20个记录。</p>}</StudioDrawer>}
  </section>;
}
