import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import type { PageProps } from '../types';
import type { BusinessState } from '../business-types';
import { allocationPercent, allocatedAmount } from '../lib/cost-allocations';
import { costPrimary, displayCost } from '../lib/cost-display';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import './cost-allocation.css';

interface Row { id: string; target: string; percent: string; }
export function CostAllocationDialog({ props, entryId, onClose, onSaved }: { props: Pick<PageProps, 'workspaceId' | 'projects' | 'ledger'>; entryId?: string; onClose: () => void; onSaved?: (state: BusinessState) => void }) {
  const [state, setState] = useState<BusinessState>(), [selected, setSelected] = useState(entryId || ''), [rows, setRows] = useState<Row[]>([]), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  const entries = useMemo(() => props.ledger.filter(entry => entry.scope === 'chat' && entry.billingMode === 'live' && entry.status !== 'processing' && entry.costState !== 'not-incurred').slice(0, 200), [props.ledger]);
  useEffect(() => { mounted.current = true; const bridge = window.desktop?.business; if (!bridge?.allocateCosts) { setError('请在最新版桌面应用中管理费用归属。'); return; } void bridge.snapshot(props.workspaceId).then(value => { if (mounted.current) { setState(value); setSelected(current => current || entries[0]?.id || ''); } }).catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : '费用归属暂时无法读取。'); }); return () => { mounted.current = false; }; }, [props.workspaceId]);
  useEffect(() => { const current = (state?.costAllocations || []).filter(row => row.entryId === selected && !row.voidedAt); setRows(current.map(row => ({ id: row.id, target: row.orderId ? `o:${row.orderId}` : `p:${row.projectId}`, percent: String(row.basisPoints / 100) }))); setNote(current[0]?.note || ''); }, [selected, state]);
  const source = entries.find(entry => entry.id === selected), value = source && displayCost(source);
  const targets = [{ value: '', label: '选择项目或制作单' }, ...props.projects.map(project => ({ value: `p:${project.id}`, label: project.name, group: '项目' })), ...(state?.orders || []).map(order => ({ value: `o:${order.id}`, label: order.name, group: '制作单' }))];
  let total = 0, calculationError = '';
  try { total = rows.reduce((sum, row) => sum + allocationPercent(row.percent), 0); if (total > 10000) calculationError = '分摊比例合计不能超过100%。'; } catch (cause) { calculationError = cause instanceof Error ? cause.message : '比例无效。'; }
  async function save() {
    const bridge = window.desktop?.business;
    if (pending.current || !state || !source || !bridge?.allocateCosts) return;
    if (calculationError || rows.some(row => !row.target)) { setError(calculationError || '请为每一行选择归属目标。'); return; }
    pending.current = true; setBusy(true); setError('');
    try { const saved = await bridge.allocateCosts({ workspaceId: props.workspaceId, expectedRevision: state.revision, entryId: source.id, allocations: rows.map(row => ({ ...(row.target.startsWith('o:') ? { orderId: row.target.slice(2) } : { projectId: row.target.slice(2) }), basisPoints: allocationPercent(row.percent) })), note }); if (mounted.current) { setState(saved); onSaved?.(saved); onClose(); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '归属未保存，原费用未改变。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <ModalPortal onClose={onClose} busy={busy}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="cost-allocation-dialog" role="dialog" aria-modal="true" aria-label="前期费用归属"><header><div><h2>前期费用归属</h2><p>把聊天、看图和方案准备费用计入对应作品。</p></div><button type="button" className="btn-icon" disabled={busy} aria-label="关闭费用归属" onClick={onClose}><X size={18} /></button></header><div className="cost-allocation-body"><label>选择原调用<Select aria-label="分摊的聊天费用" value={selected} disabled={busy} options={[{ value: '', label: entries.length ? '选择一笔聊天费用' : '暂无可分摊聊天费用' }, ...entries.map(entry => ({ value: entry.id, label: entry.projectName, description: `${entry.model} · ${costPrimary(entry)}` }))]} onValueChange={setSelected} /></label>{source && <div className="allocation-source"><strong>{costPrimary(source)}</strong><span>原账本保持不变，工作区总额只计算一次。</span></div>}
      {rows.map(row => <div className="allocation-row" key={row.id}><Select aria-label="费用归属目标" disabled={busy} value={row.target} options={targets} onValueChange={target => setRows(items => items.map(item => item.id === row.id ? { ...item, target } : item))} /><label><input aria-label="分摊比例" inputMode="decimal" maxLength={6} disabled={busy} value={row.percent} onChange={event => setRows(items => items.map(item => item.id === row.id ? { ...item, percent: event.target.value } : item))} /><span>%</span></label><button type="button" className="btn-icon" disabled={busy} aria-label="移除这行归属" onClick={() => setRows(items => items.filter(item => item.id !== row.id))}><Trash2 size={15} /></button></div>)}
      <button type="button" className="text-button" disabled={busy || !source || rows.length >= 20} onClick={() => setRows(items => [...items, { id: crypto.randomUUID(), target: props.projects[0] ? `p:${props.projects[0].id}` : '', percent: String(Math.max(0, 10000 - total) / 100) }])}><Plus size={14} />添加归属</button>
      <div className="allocation-summary"><strong>已分摊 {total / 100}%</strong><span>{value?.nativeAmount && !calculationError && total > 0 ? `对应原币 ${allocatedAmount(value.nativeAmount, total)} ${value.nativeCurrency}` : '未分配的部分继续保留在工作区聊天费用中。'}</span></div><label>备注（可选）<input maxLength={1000} disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label><p className="muted">修改归属不会退款或再扣费。无归属行时保存会解除本笔分摊，历史记录仍保留；未知费用会继续提示待补齐，不按零成本报价。</p>{(error || calculationError) && <p className="inline-notice" role="alert">{error || calculationError}</p>}</div><footer><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="btn btn-primary" disabled={busy || !state || !source || !!calculationError} onClick={() => { void save(); }}>{busy ? <LoaderCircle size={15} className="spin" /> : null}保存归属</button></footer></section></div></ModalPortal>;
}
