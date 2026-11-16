import { useEffect, useState } from 'react';
import { ArrowRight, CalendarClock } from 'lucide-react';
import type { PageProps } from '../types';
import type { BusinessState, BusinessTransaction } from '../business-types';
import { businessOrderReceivables, businessToday } from '../lib/business-receivables';
import { focusBusinessView } from '../lib/business-view';
import './business/business-intake-payments.css';

export function HomeBusinessTodos({ props }: { props: PageProps }) {
  const [state, setState] = useState<BusinessState>(), [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const bridge = window.desktop?.business;
    if (!props.workspace.directory || !bridge) { setState(undefined); return; }
    let alive = true, busy = false, requested = false, timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => { if (!alive || document.hidden) return; if (busy) { requested = true; return; } busy = true; try { const next = await bridge.snapshot(props.workspaceId); if (alive) setState(next); } catch { if (alive) setState(undefined); } finally { busy = false; if (alive && requested) { requested = false; void read(); } } };
    const schedule = () => { if (timer !== undefined || document.hidden) return; timer = setTimeout(() => { timer = undefined; void read(); }, 250); };
    const unsubscribe = bridge.onChanged?.(event => { if (event.workspaceId === props.workspaceId) schedule(); });
    const visible = () => { if (!document.hidden) { setNow(new Date()); schedule(); } };
    const clock = setInterval(() => { if (!document.hidden) setNow(new Date()); }, 60000);
    document.addEventListener('visibilitychange', visible); void read();
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); clearInterval(clock); unsubscribe?.(); document.removeEventListener('visibilitychange', visible); };
  }, [props.workspaceId, props.workspace.directory]);
  if (!state || state.workspaceId !== props.workspaceId || !props.onOpenBusiness) return null;
  const transactions = new Map<string, BusinessTransaction[]>(), feedback = new Map<string, number>(), today = businessToday(now);
  for (const row of state.transactions) { if (row.voidedAt || !['receipt', 'refund'].includes(row.kind)) continue; const rows = transactions.get(row.orderId) || []; rows.push(row); transactions.set(row.orderId, rows); }
  for (const row of state.feedback) if (row.status !== 'confirmed') feedback.set(row.orderId, (feedback.get(row.orderId) || 0) + 1);
  const todos = state.orders.filter(order => order.status !== 'archived').flatMap(order => {
    const result: { id: string; title: string; detail: string; badge: string; tab: 'feedback' | 'finance' | 'files'; order: typeof order }[] = [];
    const receipts = businessOrderReceivables(order, transactions.get(order.id) || [], today), open = feedback.get(order.id) || 0;
    if (receipts.dueCents > 0) result.push({ id: `${order.id}-payment`, title: order.name, detail: `到期应收 ¥${(receipts.dueCents / 100).toFixed(2)}，未记为已收款`, badge: '待收款', tab: 'finance', order });
    if (open) result.push({ id: `${order.id}-feedback`, title: order.name, detail: `${open} 轮客户反馈待处理`, badge: '待返修', tab: 'feedback', order });
    if (order.deadline && order.status !== 'complete' && Date.parse(`${order.deadline.slice(0, 10)}T23:59:59+08:00`) < now.getTime() + 86400000) result.push({ id: `${order.id}-deadline`, title: order.name, detail: `交付日期 ${order.deadline.slice(0, 10)}`, badge: '交付临近', tab: 'files', order });
    return result;
  });
  if (!todos.length) return null;
  return <section className="bs-home-todos" aria-label="业务待办"><header><h2><CalendarClock size={17} /> 本机待办 <small>{todos.length} 项</small></h2><small>仅提醒已保存的约定</small></header>{todos.slice(0, 4).map(todo => <button type="button" key={todo.id} onClick={() => { focusBusinessView(props.workspaceId, todo.order.id, todo.tab); props.onOpenBusiness?.(todo.order.recipe, todo.order.id); }}><span><strong>{todo.title}</strong><small>{todo.detail}</small></span><span className="bs-todo-badge">{todo.badge}<ArrowRight size={15} /></span></button>)}</section>;
}
