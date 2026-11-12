import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Save, Trash2 } from 'lucide-react';
import type { PageProps } from '../../types';
import type { BusinessOrder, BusinessPaymentPlan, BusinessState } from '../../business-types';
import type { BusinessCommit } from './BrandPanel';
import { businessReceivables } from '../../lib/business-receivables';
import { businessDate } from '../../lib/business-extra-validation';
import { quoteHundredths } from '../../lib/quote-calculator';
import { useRememberedString } from '../../hooks/useRememberedString';
import { RememberedDetails } from '../RememberedDetails';
import './business-intake-payments.css';

const cash = (value: number) => `¥${(value / 100).toFixed(2)}`;
interface Draft { base: string; amount: string; rows: { id: string; label: string; amount: string; dueDate: string; note: string }[]; }
const fromPlan = (plan?: BusinessPaymentPlan): Draft => ({ base: JSON.stringify(plan || null), amount: plan ? (plan.agreedCents / 100).toFixed(2) : '', rows: (plan?.milestones || []).map(row => ({ id: row.id, label: row.label, amount: (row.amountCents / 100).toFixed(2), dueDate: row.dueDate || '', note: row.note || '' })) });
export function PaymentPlanPanel({ props, state, order, commit }: { props: PageProps; state: BusinessState; order: BusinessOrder; commit: BusinessCommit }) {
  const summary = businessReceivables(state, order.id), signature = JSON.stringify(order.paymentPlan || null), [raw, setRaw] = useRememberedString(`business:${props.workspaceId}:${order.id}:payment-draft`, JSON.stringify(fromPlan(order.paymentPlan)));
  let draft: Draft; try { draft = JSON.parse(raw); if (!draft || typeof draft.base !== 'string' || typeof draft.amount !== 'string' || !Array.isArray(draft.rows) || draft.rows.length > 12 || draft.rows.some(row => !row || ['id', 'label', 'amount', 'dueDate', 'note'].some(key => typeof row[key as keyof typeof row] !== 'string'))) throw Error(); } catch { draft = fromPlan(order.paymentPlan); }
  const [busy, setBusy] = useState(''), [issue, setIssue] = useState(''), lock = useRef(false);
  useEffect(() => { if (draft.base === signature) return; let pristine = !draft.rows.length && !draft.amount; try { pristine ||= raw === JSON.stringify(fromPlan(JSON.parse(draft.base) || undefined)); } catch { /* Keep the current draft for explicit recovery. */ } if (pristine) setRaw(JSON.stringify(fromPlan(order.paymentPlan))); }, [signature]);
  const update = (change: Partial<Draft>) => setRaw(JSON.stringify({ ...draft, ...change }));
  const updateRow = (id: string, changes: Partial<Draft['rows'][number]>) => update({ rows: draft.rows.map(row => row.id === id ? { ...row, ...changes } : row) });
  function template(parts: number) {
    try {
      const total = quoteHundredths(draft.amount, '约定总金额'); if (total < parts) throw Error('请先填写大于0的约定总金额。');
      const used = new Set([...state.transactions.filter(row => row.orderId === order.id && row.paymentMilestoneId).map(row => row.paymentMilestoneId), ...(order.paymentPlan?.assignments || []).map(row => row.milestoneId)]);
      if (draft.rows.some(row => used.has(row.id))) throw Error('已有流水归属分期，请直接调整原分期，避免丢失收退款归属。');
      const labels = parts === 1 ? ['一次付清'] : parts === 2 ? ['订金', '尾款'] : ['订金', '样稿款', '尾款'];
      update({ rows: labels.map((label, index) => ({ id: crypto.randomUUID(), label, amount: ((Math.floor(total / parts) + (index === parts - 1 ? total % parts : 0)) / 100).toFixed(2), dueDate: '', note: '' })) }); setIssue('');
    } catch (cause) { setIssue(cause instanceof Error ? cause.message : '请先填写约定金额。'); }
  }
  async function save() {
    if (lock.current) return; lock.current = true; setBusy('save'); setIssue('');
    try {
      const agreedCents = quoteHundredths(draft.amount, '约定总金额');
      const milestones = draft.rows.map(row => { const amountCents = quoteHundredths(row.amount, row.label || '阶段金额'); if (!row.label.trim() || amountCents <= 0 || row.dueDate && !businessDate(row.dueDate)) throw Error('请填写阶段名称、正数金额，以及有效的YYYY-MM-DD日期（可留空）。'); return { id: row.id, label: row.label.trim(), amountCents, ...(row.dueDate ? { dueDate: row.dueDate } : {}), ...(row.note ? { note: row.note } : {}) }; });
      if (!milestones.length || milestones.reduce((sum, row) => sum + row.amountCents, 0) !== agreedCents) throw Error('各阶段金额合计需要等于约定总金额。');
      const paymentPlan: BusinessPaymentPlan = { currency: 'CNY', agreedCents, milestones, ...(order.paymentPlan?.assignments ? { assignments: order.paymentPlan.assignments } : {}) };
      const saved = await commit(state => { const current = state.orders.find(row => row.id === order.id); if (!current || JSON.stringify(current.paymentPlan || null) !== draft.base) throw Error('付款约定已在另一处更新，请先读取最新约定；本次草稿仍保留。'); return { ...state, orders: state.orders.map(row => row.id === order.id ? { ...row, paymentPlan, updatedAt: new Date().toISOString() } : row) }; });
      if (!saved) throw Error('付款约定尚未保存，草稿保留。');
      setRaw(JSON.stringify(fromPlan(paymentPlan))); props.notify('付款约定已保存；尚未收款的金额不会计入实收。');
    } catch (cause) { setIssue(cause instanceof Error ? cause.message : '付款约定尚未保存。'); }
    finally { lock.current = false; setBusy(''); }
  }
  async function statement() {
    if (lock.current) return; lock.current = true; setBusy('statement'); setIssue('');
    try { if (!window.desktop?.business?.exportStatement) throw Error('请更新桌面版本后导出对账单。'); const result = await window.desktop.business.exportStatement({ workspaceId: props.workspaceId, orderId: order.id }); if (result.saved) props.notify('已保存可打印HTML对账单，可在浏览器打印或另存为PDF。'); }
    catch (cause) { setIssue(cause instanceof Error ? cause.message : '对账单尚未导出。'); } finally { lock.current = false; setBusy(''); }
  }
  const referenced = new Set([...state.transactions.filter(row => row.orderId === order.id).map(row => row.paymentMilestoneId), ...(order.paymentPlan?.assignments || []).map(row => row.milestoneId)]);
  return <section className="bs-payment-plan"><header><div><h3>订金与尾款</h3><p className="bs-note">先约定分期，再记录真正收到的款项。</p></div><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void statement(); }}><Download size={16} />客户对账单</button></header><div className="bs-receivable-summary"><div><span>约定总额</span><strong>{summary.hasPlan ? cash(summary.agreedCents) : '未约定'}</strong></div><div><span>实际净收款</span><strong>{cash(summary.netReceivedCents)}</strong></div><div><span>剩余应收</span><strong>{summary.hasPlan ? cash(summary.remainingCents) : '待约定'}</strong></div></div>{summary.overpaidCents > 0 && <p className="bs-inline-warning">已超约定净收 {cash(summary.overpaidCents)}，请核对。</p>}{summary.needsAllocation && <p className="bs-inline-warning">有退款或超额的分期归属，请核对流水；未更改任何实收记录。</p>}{summary.milestones.map(row => <div className={`bs-payment-progress ${row.overdue ? 'is-overdue' : ''}`} key={row.id}><div><strong>{row.label}</strong><small>{row.dueDate ? `到期 ${row.dueDate}` : '未约定日期'}{row.automaticCents > 0 ? ' · 包含未指定分期的顺序归集' : ''}</small></div><div><span>{row.remainingCents === 0 ? '已按流水收齐' : row.overdue ? '已到期' : '待收'}</span><strong>{cash(row.remainingCents)}</strong></div></div>)}
    <RememberedDetails rememberKey={`business:${order.id}:payment-plan-edit`} defaultOpen={!order.paymentPlan}><summary>{order.paymentPlan ? '调整付款约定' : '设置约定金额与分期'}<small>约定不会生成收款</small></summary><fieldset disabled={!!busy}><label className="bs-payment-total">约定总金额（元）<input className="field" aria-label="约定总金额" inputMode="decimal" maxLength={16} value={draft.amount} onChange={event => update({ amount: event.target.value })} placeholder="例如1000.00" /></label><div className="bs-action-row">{[1, 2, 3].map(parts => <button type="button" key={parts} className="btn btn-secondary" onClick={() => template(parts)}>{parts === 1 ? '一次付清' : parts === 2 ? '订金＋尾款' : '订金＋样稿＋尾款'}</button>)}</div>{draft.rows.map(row => <div className="bs-payment-edit-row" key={row.id}><label>阶段<input className="field" aria-label="付款阶段名称" maxLength={100} value={row.label} onChange={event => updateRow(row.id, { label: event.target.value })} /></label><label>金额（元）<input className="field" aria-label={`${row.label}约定金额`} inputMode="decimal" maxLength={16} value={row.amount} onChange={event => updateRow(row.id, { amount: event.target.value })} /></label><label>到期日期<input className="field" aria-label={`${row.label}到期日期`} maxLength={10} value={row.dueDate} onChange={event => updateRow(row.id, { dueDate: event.target.value })} placeholder="YYYY-MM-DD，可不填" /></label><button type="button" className="icon-button" aria-label={`删除${row.label}阶段`} title={referenced.has(row.id) ? '已有流水归属，需保留阶段' : '删除阶段'} disabled={referenced.has(row.id)} onClick={() => update({ rows: draft.rows.filter(item => item.id !== row.id) })}><Trash2 size={16} /></button></div>)}<div className="bs-action-row"><button type="button" className="text-button" disabled={draft.rows.length >= 12} onClick={() => update({ rows: [...draft.rows, { id: crypto.randomUUID(), label: `第${draft.rows.length + 1}期`, amount: '', dueDate: '', note: '' }] })}><Plus size={16} />添加分期</button><button type="button" className="btn btn-primary" onClick={() => { void save(); }}><Save size={16} />保存付款约定</button>{draft.base !== signature && <button type="button" className="text-button" onClick={() => setRaw(JSON.stringify(fromPlan(order.paymentPlan)))}>读取最新约定</button>}</div></fieldset></RememberedDetails>{issue && <p className="bs-error" role="alert">{issue}</p>}<p className="bs-note">历史未指定分期的收退款按阶段顺序自动归集；阶段明细与订单总实收分别核算。API费用和收款互不抵消。</p></section>;
}
