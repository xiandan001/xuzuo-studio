import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, PackageCheck, X } from 'lucide-react';
import type { PageProps, Project } from '../types';
import type { BusinessState } from '../business-types';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import './customer-order-link.css';

export function CustomerOrderLink({ props, project, artifactIds, label = '准备交付', onLinked }: { props: Pick<PageProps, 'workspaceId' | 'notify' | 'navigate' | 'onOpenBusiness'>; project: Project; artifactIds: string[]; label?: string; onLinked?: (state: BusinessState, orderId: string) => void }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn btn-secondary" disabled={!artifactIds.length} onClick={() => setOpen(true)}><PackageCheck size={15} />{label}</button>{open && <OrderLinkDialog props={props} project={project} artifactIds={artifactIds} onClose={() => setOpen(false)} onLinked={onLinked} />}</>;
}
function OrderLinkDialog({ props, project, artifactIds, onClose, onLinked }: { props: Pick<PageProps, 'workspaceId' | 'notify' | 'navigate' | 'onOpenBusiness'>; project: Project; artifactIds: string[]; onClose: () => void; onLinked?: (state: BusinessState, orderId: string) => void }) {
  const [state, setState] = useState<BusinessState>(), [orderId, setOrderId] = useState(''), [name, setName] = useState(project.name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; const bridge = window.desktop?.business; if (!bridge?.linkOutput) { setError('请在最新版桌面应用中关联作品制作单。'); return; } void bridge.snapshot(props.workspaceId).then(value => { if (mounted.current) setState(value); }).catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : '制作单暂时无法读取。'); }); return () => { mounted.current = false; }; }, [props.workspaceId]);
  async function link() {
    const bridge = window.desktop?.business; if (!bridge?.linkOutput || !state || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { const saved = await bridge.linkOutput({ workspaceId: props.workspaceId, projectId: project.id, artifactIds, ...(orderId ? { orderId } : { name: name.trim() }) }); if (!mounted.current) return; const order = orderId ? saved.orders.find(order => order.id === orderId) : saved.orders.find(order => !state.orders.some(old => old.id === order.id)); if (!order) throw Error('关联已保存，但制作单暂未能定位，请到业务制作查看。'); onLinked?.(saved, order.id); props.notify('作品已关联制作单，可继续核对、报价和处理返修。'); onClose(); if (props.onOpenBusiness) props.onOpenBusiness(order.recipe, order.id); else props.navigate('business'); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '关联未完成，原作品与费用保留。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <ModalPortal onClose={onClose} busy={busy}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="customer-order-link-dialog" role="dialog" aria-modal="true" aria-label="作品准备交付"><header><div><h2>准备交付</h2><p>把当前成品接入报价、返修与收支记录。</p></div><button className="btn-icon" type="button" disabled={busy} aria-label="关闭准备交付" onClick={onClose}><X size={18} /></button></header><div><p className="order-link-source"><strong>{project.name}</strong><span>{artifactIds.length} 份已保存文件</span></p><label>归属制作单<Select aria-label="成品归属制作单" value={orderId} disabled={busy || !state} options={[{ value: '', label: '新建制作单' }, ...(state?.orders || []).filter(order => order.status !== 'archived').map(order => ({ value: order.id, label: order.name }))]} onValueChange={setOrderId} /></label>{!orderId && <label>制作单名称<input aria-label="新制作单名称" maxLength={200} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>}<p className="muted">仅关联已保存作品和真实费用，不会重新生成或再次收费。内容、授权和格式仍由你在交付前确认。</p>{error && <p className="inline-notice" role="alert">{error}</p>}</div><footer><button className="btn btn-secondary" type="button" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" type="button" disabled={busy || !state || !orderId && !name.trim() || !window.desktop?.business?.linkOutput} onClick={() => { void link(); }}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}继续准备交付</button></footer></section></div></ModalPortal>;
}
