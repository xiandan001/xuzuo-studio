import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { RememberedDetails } from './RememberedDetails';
import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Download, History, LoaderCircle, RefreshCw } from 'lucide-react';
import type { DeliveryInspection, DeliveryReceipt, DeliverySelection } from '../delivery-types';
import type { DeliveryCheck } from '../lib/delivery-quality';
import type { ProjectKind } from '../types';
import { DeliveryChecklist } from './DeliveryChecklist';
import './delivery-batch.css';
import { StudioDrawer } from './StudioDrawer';

export interface DeliveryPanelProps { projectId: string; kind: ProjectKind; artifactIds?: string[]; sourceRevision: number | string; deliveryContext?: string; dirty?: boolean; checks: DeliveryCheck[]; visible?: boolean; inline?: boolean; onClose?: () => void; onDelivered?: (receipt: DeliveryReceipt, selection: DeliverySelection) => void | Promise<void>; onInvalidated?: () => void; }
const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '交付操作未完成，原记录仍保留。';
export function DeliveryPanel({ projectId, kind, artifactIds = [], sourceRevision, deliveryContext = '', dirty = false, checks, visible = true, inline = false, onClose, onDelivered, onInvalidated }: DeliveryPanelProps) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.delivery;
  const selection: DeliverySelection = { projectId, kind, artifactIds, sourceRevision, checks };
  const signature = JSON.stringify(selection), epoch = useRef(0), current = useRef(selection); current.current = selection;
  const [inspection, setInspection] = useState<DeliveryInspection>();
  const [history, setHistory] = useState<DeliveryReceipt[]>([]);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useRememberedBoolean(`project:${projectId}:delivery-panel-collapsed`, false);
  const bodyId = useId();
  const callbacks = useRef({ onDelivered, onInvalidated }); callbacks.current = { onDelivered, onInvalidated };
  const announced = useRef<string | undefined>(undefined), invalidated = useRef<string | undefined>(undefined);
  function invalidate(key: string) {
    if (invalidated.current === key) return;
    invalidated.current = key; announced.current = undefined; callbacks.current.onInvalidated?.();
  }
  async function announce(receipt: DeliveryReceipt, requested: DeliverySelection, context: string) {
    const key = `${receipt.projectId}|${receipt.id}|${receipt.fingerprint}|${context}`;
    if (announced.current === key) return;
    announced.current = key; invalidated.current = undefined;
    try { await callbacks.current.onDelivered?.(receipt, requested); }
    catch (cause) { if (announced.current === key) announced.current = undefined; throw cause; }
  }
  useEffect(() => {
    const generation = ++epoch.current; setInspection(undefined); setError(''); setFeedback('');
    const requested = current.current, invalidKey = `${signature}|${deliveryContext}|${dirty}`;
    if (dirty) invalidate(invalidKey);
    if (!bridge || !visible) { setBusy(''); return; }
    setBusy('inspect');
    void Promise.all([dirty ? Promise.resolve(undefined) : bridge.inspect(requested), bridge.history({ projectId })]).then(async ([result, receipts]) => {
      if (generation !== epoch.current) return;
      setInspection(result); setHistory(receipts);
      if (!dirty && result?.ready && !result.errors.length && result.currentReceipt) await announce(result.currentReceipt, requested, deliveryContext);
      else invalidate(invalidKey);
    }).catch(cause => { if (generation === epoch.current) { setError(message(cause)); invalidate(invalidKey); } }).finally(() => { if (generation === epoch.current) setBusy(''); });
  }, [signature, dirty, refresh, bridge, projectId, deliveryContext, visible]);
  async function saveReview(checkedIds: string[]) {
    if (!bridge || !inspection || dirty || busy) return;
    const generation = epoch.current; setBusy('review'); setError(''); setFeedback('');
    try { const requested = current.current, result = await bridge.saveReview({ ...requested, fingerprint: inspection.fingerprint, checkedIds }); if (generation === epoch.current) { setInspection(result); if (result.ready && !result.errors.length && result.currentReceipt) await announce(result.currentReceipt, requested, deliveryContext); else invalidate(`${signature}|${deliveryContext}|${dirty}`); } }
    catch (cause) { if (generation === epoch.current) setError(message(cause)); }
    finally { if (generation === epoch.current) setBusy(''); }
  }
  async function confirm() {
    if (!bridge || !inspection?.ready || dirty || busy || error) return;
    const generation = epoch.current; setBusy('confirm'); setError('');
    try { const requested = current.current, receipt = await bridge.confirm({ ...requested, fingerprint: inspection.fingerprint }); if (generation === epoch.current) { await announce(receipt, requested, deliveryContext); if (generation !== epoch.current) return; setHistory(items => [receipt, ...items.filter(item => item.id !== receipt.id)]); setInspection(previous => previous ? { ...previous, currentReceipt: receipt } : previous); setFeedback('当前版本已确认交付，历史记录已保存。'); } }
    catch (cause) { if (generation === epoch.current) setError(message(cause)); }
    finally { if (generation === epoch.current) setBusy(''); }
  }
  async function zip(receipt: DeliveryReceipt) {
    if (!bridge || busy) return; const generation = epoch.current; setBusy('zip'); setError('');
    try { const result = await bridge.exportZip({ projectId, deliveryId: receipt.id }); if (generation === epoch.current) setFeedback(result.saved ? '客户成品ZIP已保存，仅包含本次成品和说明清单。' : '已取消保存ZIP，交付记录仍保留。'); }
    catch (cause) { if (generation === epoch.current) setError(message(cause)); }
    finally { if (generation === epoch.current) setBusy(''); }
  }
  const delivered = !dirty && !error && inspection?.ready && inspection.currentReceipt;
  const panelTitle = delivered ? '当前版本已交付' : dirty ? '更改尚未导出' : history.length ? '当前有未交付的更改' : '确认本次交付';
  const failed = !!error || !!inspection?.errors.length;
  const visibleChecks = inspection?.checks || checks;
  const passed = visibleChecks.filter(check => check.status === 'passed' || check.status === 'manual' && inspection?.checkedIds.includes(check.id)).length;
  if (!visible) return null;
  const panel = <section className={`delivery-panel${collapsed ? ' is-collapsed' : ''}`} aria-label="版本交付">
    <header className="delivery-panel-header"><button className="delivery-fold" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? '展开交付面板' : '收起交付面板'}><CheckCircle2 size={19} /><span><strong>{panelTitle}</strong><small>{failed ? '检查发现问题，展开查看' : busy === 'inspect' ? '正在核对文件…' : `${passed} / ${visibleChecks.length} 项检查 · ${collapsed ? '点击展开' : '点击收起'}`}</small></span><ChevronDown size={17} className={collapsed ? 'delivery-fold-closed' : ''} /></button></header>
    {collapsed && failed && <p className="delivery-collapsed-error" role="alert">{error || inspection?.errors[0]}</p>}
    <div id={bodyId} className="delivery-panel-body" hidden={collapsed}>
      {!bridge ? <><DeliveryChecklist projectId={projectId} kind={kind} sourceRevision={sourceRevision} artifactId={artifactIds.join('|')} checks={checks} /><p className="delivery-panel-note">在新版桌面应用中可确认版本交付并导出客户成品ZIP。</p></> : <>
        <div className="delivery-inspection-toolbar"><span>{inspection?.revision.startsWith('editor:') ? `编辑版本 v${inspection.revision.slice(7)}` : kind === 'image' ? '当前所选成品' : '当前生成成品'}</span><button className="btn btn-ghost" disabled={!!busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />刷新检查</button></div>
        {dirty && <p role="status">当前有未保存修改，请保存并导出后验收。旧交付记录保留。</p>}{error && <p className="form-error" role="alert">{error}</p>}{inspection?.errors.map((item, index) => <p className="form-error" key={index}>{item}</p>)}{busy === 'inspect' && <p><LoaderCircle className="spin" size={16} />正在核对实际文件与保存版本…</p>}
        <DeliveryChecklist projectId={projectId} kind={kind} sourceRevision={sourceRevision} artifactId={artifactIds.join('|')} checks={visibleChecks} controlledReview={{ checkedIds: inspection?.checkedIds || [], persisted: !!inspection?.reviewSavedAt && !dirty, busy: !!busy || dirty || !inspection, error }} onCheckedChange={ids => { void saveReview(ids); }} />
        {inspection?.files.length ? <ul className="delivery-file-list">{inspection.files.map(file => <li key={file.id}><span>{file.name}</span><small>{(file.bytes / 1024).toFixed(0)} KB · SHA256 {file.sha256.slice(0, 12)}</small></li>)}</ul> : null}<div className="delivery-panel-actions"><button className="btn btn-primary" disabled={!inspection?.ready || !!busy || dirty || !!error || !!delivered} onClick={() => { void confirm(); }}><CheckCircle2 size={16} />{delivered ? '已确认交付' : '确认交付当前版本'}</button>{delivered && <button className="btn btn-secondary" disabled={!!busy} onClick={() => { void zip(delivered); }}><Download size={16} />客户成品ZIP</button>}</div>{feedback && <p role="status">{feedback}</p>}<p className="delivery-panel-note">客户ZIP只包含选定成品和文件说明，不包含Key、提示词、费用账本或原始参考资料。</p>{history.length > 0 && <RememberedDetails rememberKey={`project:${projectId}:delivery-history`} className="delivery-history"><summary><History size={15} />历史交付 · {history.length} 次</summary>{history.map(receipt => <article key={receipt.id}><div><strong>{receipt.revision.startsWith('editor:') ? `编辑版本 v${receipt.revision.slice(7)}` : '生成成品'}</strong><span>{new Date(receipt.confirmedAt).toLocaleString('zh-CN')} · {receipt.files.length} 份</span></div><button className="btn btn-ghost" disabled={!!busy} onClick={() => { void zip(receipt); }}><Download size={14} />导出此版ZIP</button></article>)}</RememberedDetails>}
      </>}
    </div>
  </section>;
  return onClose && !inline ? <StudioDrawer title="交付检查与客户文件" description="导出文件后，按需完成当前版本的人工验收。" onClose={onClose}>{panel}</StudioDrawer> : panel;
}
