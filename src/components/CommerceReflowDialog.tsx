import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, LayoutGrid, LoaderCircle, X } from 'lucide-react';
import type { CommerceImagesBridge, CommerceImageScope, CommerceImageSize, CommerceReflowPreview, CommerceReflowResult } from '../commerce-image-types';
import { registerEditorSession } from '../lib/editor-session-guard';
import { ModalPortal } from './ModalPortal';
import './commerce-reflow-dialog.css';

const presets = [
  { id: 'square', label: '正方形 · 1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: '竖版 · 3:4', width: 1080, height: 1440 },
  { id: 'portrait-feed', label: '竖版 · 4:5', width: 1080, height: 1350 },
  { id: 'story', label: '全屏竖版 · 9:16', width: 1080, height: 1920 },
  { id: 'landscape', label: '横版 · 16:9', width: 1920, height: 1080 },
];
const message = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '重排尚未完成，原稿与已有文件保留。';
export function CommerceReflowDialog({ scope, revision, bridge, onClose, onExport }: { scope: CommerceImageScope; revision: number; bridge: CommerceImagesBridge; onClose: () => void; onExport: (result: CommerceReflowResult) => void }) {
  const [selected, setSelected] = useState(new Set(['square', 'portrait', 'landscape'])), [custom, setCustom] = useState(false), [width, setWidth] = useState('1600'), [height, setHeight] = useState('900');
  const [preview, setPreview] = useState<CommerceReflowPreview>(), [approved, setApproved] = useState(new Set<string>()), [busy, setBusy] = useState<'preview' | 'export'>(), [error, setError] = useState('');
  const alive = useRef(true), request = useRef(''), pending = useRef(false), selection = useRef<HTMLDivElement>(null);
  const targets = useMemo<CommerceImageSize[]>(() => [...presets.filter(item => selected.has(item.id)).map(({ width, height, label }) => ({ width, height, label })), ...(custom ? [{ width: Number(width), height: Number(height), label: '自定义' }] : [])], [selected, custom, width, height]);
  const issue = !targets.length ? '至少选择一个目标尺寸。' : targets.some(target => !Number.isSafeInteger(target.width) || !Number.isSafeInteger(target.height) || target.width < 8 || target.height < 8 || target.width > 8192 || target.height > 8192 || target.width * target.height > 16000000) ? '自定义尺寸每边8–8192像素，单版最多1600万像素。' : new Set(targets.map(target => `${target.width}x${target.height}`)).size !== targets.length ? '自定义尺寸与已选尺寸重复，请调整。' : targets.reduce((sum, target) => sum + target.width * target.height, 0) > 48000000 ? '所选尺寸合计最多4800万像素，请分批导出。' : '';
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (request.current) void bridge.cancelPreview?.({ projectId: scope.projectId, requestId: request.current }).catch(() => undefined); }; }, [bridge, scope.projectId]);
  useEffect(() => registerEditorSession({ id: `commerce-reflow:${scope.projectId}`, projectId: scope.projectId, label: '正在本地重排图片', getState: () => ({ dirty: false, pending: pending.current }), save: async () => false, exportRecovery: () => false }), [scope.projectId]);
  function reset() { setPreview(undefined); setApproved(new Set()); setError(''); }
  function close() { if (busy === 'export') return; if (request.current) void bridge.cancelPreview?.({ projectId: scope.projectId, requestId: request.current }).catch(() => undefined); onClose(); }
  async function createPreview() {
    if (pending.current || issue || !bridge.reflowPreview) return; pending.current = true; setBusy('preview'); setError(''); const requestId = crypto.randomUUID(); request.current = requestId;
    try { const result = await bridge.reflowPreview({ ...scope, expectedRevision: revision, requestId, targets }); if (alive.current && request.current === requestId) { setPreview(result); setApproved(new Set()); } }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (request.current === requestId) request.current = ''; pending.current = false; if (alive.current) setBusy(undefined); }
  }
  async function exportConfirmed() {
    if (pending.current || !preview || approved.size !== preview.targets.length || !bridge.reflowExport) return; pending.current = true; setBusy('export'); setError('');
    try { const result = await bridge.reflowExport({ ...scope, expectedRevision: revision, previewId: preview.previewId, approvedTargetIds: [...approved] }); if (alive.current) { onExport(result); onClose(); } }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(undefined); }
  }
  return <ModalPortal onClose={close} busy={busy === 'export'}><div className="modal-backdrop"><section className="commerce-reflow-dialog" role="dialog" aria-modal="true" aria-label="多比例智能排版"><header><div><LayoutGrid size={22} /><div><h2>一张设计，适配多个比例</h2><p>重新安排主体、文字与 Logo，原稿保持不变。</p></div></div><button className="btn-icon" aria-label="关闭多比例排版" disabled={busy === 'export'} onClick={close}><X size={19} /></button></header>
    <div className="commerce-reflow-body"><div ref={selection}><fieldset disabled={!!busy}><legend>选择需要的成品</legend><div className="commerce-reflow-presets">{presets.map(item => <label key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={event => { setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; }); reset(); }} /><span><strong>{item.label}</strong><small>{item.width} × {item.height}</small></span></label>)}<label><input type="checkbox" checked={custom} onChange={event => { setCustom(event.target.checked); reset(); }} /><span><strong>自定义像素</strong><small>按你的交付要求填写</small></span></label></div>{custom && <div className="commerce-reflow-custom"><label>宽度<input aria-label="重排自定义宽度" className="field" inputMode="numeric" value={width} onChange={event => { setWidth(event.target.value); reset(); }} /></label><span>×</span><label>高度<input aria-label="重排自定义高度" className="field" inputMode="numeric" value={height} onChange={event => { setHeight(event.target.value); reset(); }} /></label></div>}</fieldset>{issue && <p className="inline-notice" role="status">{issue}</p>}</div>
    {preview && <div className="commerce-reflow-previews">{preview.targets.map(target => <article key={target.id}><header><strong>{target.label}</strong><span>{target.width} × {target.height}</span></header><div className="commerce-reflow-image"><img src={target.previewDataUrl} alt={`${target.label}重排预览`} /></div>{target.warnings.length > 0 && <ul>{target.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}<label><input type="checkbox" aria-label={`确认${target.label}版式`} disabled={!!busy} checked={approved.has(target.id)} onChange={event => setApproved(current => { const next = new Set(current); if (event.target.checked) next.add(target.id); else next.delete(target.id); return next; })} />我已检查此版的主体和文字</label></article>)}</div>}
    {error && <p className="inline-notice" role="alert">{error}</p>}</div><footer><p>本地重排 · 0 API · 不增加原图细节</p><div><button className="btn btn-secondary" disabled={busy === 'export'} onClick={close}>{busy === 'preview' ? '取消预览' : '取消'}</button>{preview && <button className="btn btn-ghost" disabled={!!busy} onClick={() => { reset(); selection.current?.scrollIntoView({ block: 'start' }); }}>调整尺寸</button>}<button className="btn btn-primary" disabled={!!busy || !!issue || (preview ? !bridge.reflowExport : !bridge.reflowPreview) || !!preview && approved.size !== preview.targets.length} onClick={() => { void (preview ? exportConfirmed() : createPreview()); }}>{busy ? <LoaderCircle size={15} className="spin" /> : preview ? <Download size={15} /> : <Check size={15} />}{busy === 'preview' ? '正在准备版式…' : busy === 'export' ? '正在保存独立成品…' : preview ? `确认并导出 ${preview.targets.length} 版` : `生成 ${targets.length} 版预览`}</button></div></footer></section></div></ModalPortal>;
}
