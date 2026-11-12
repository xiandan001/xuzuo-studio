import type { BusinessOrder, BusinessState, BusinessTransaction } from '../business-types';

const shanghaiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export function businessToday(now: Date) { const parts = shanghaiDate.formatToParts(now); return ['year', 'month', 'day'].map(kind => parts.find(part => part.type === kind)?.value || '').join('-'); }

export function businessReceivables(state: BusinessState, orderId: string, now = new Date()) {
  const order = state.orders.find(row => row.id === orderId);
  return businessOrderReceivables(order, state.transactions.filter(row => row.orderId === orderId), businessToday(now));
}
export function businessOrderReceivables(order: BusinessOrder | undefined, transactions: BusinessTransaction[], today: string) {
  const plan = order?.paymentPlan;
  const rows = transactions.filter(row => !row.voidedAt && ['receipt', 'refund'].includes(row.kind));
  const assignments = new Map((plan?.assignments || []).filter(row => !row.voidedAt).map(row => [row.transactionId, row.milestoneId]));
  const assignedTo = (row: BusinessTransaction) => assignments.has(row.id) ? assignments.get(row.id) : row.paymentMilestoneId;
  const net = rows.reduce((sum, row) => sum + (row.kind === 'receipt' ? row.amountCents : -row.amountCents), 0);
  let unassigned = rows.filter(row => !assignedTo(row)).reduce((sum, row) => sum + (row.kind === 'receipt' ? row.amountCents : -row.amountCents), 0);
  const milestones = (plan?.milestones || []).map(row => {
    const explicit = rows.filter(item => assignedTo(item) === row.id).reduce((sum, item) => sum + (item.kind === 'receipt' ? item.amountCents : -item.amountCents), 0);
    const allocated = Math.min(Math.max(0, row.amountCents - explicit), Math.max(0, unassigned));
    unassigned -= allocated;
    const paidCents = explicit + allocated, remainingCents = Math.max(0, row.amountCents - paidCents);
    return { ...row, paidCents, remainingCents, automaticCents: allocated, overdue: !!row.dueDate && row.dueDate < today && remainingCents > 0, due: !!row.dueDate && row.dueDate <= today && remainingCents > 0 };
  });
  const remainingCents = plan ? Math.max(0, plan.agreedCents - net) : 0;
  return { hasPlan: !!plan, agreedCents: plan?.agreedCents || 0, netReceivedCents: net, remainingCents, overpaidCents: plan ? Math.max(0, net - plan.agreedCents) : 0, unassignedCents: unassigned, milestones, dueCents: Math.min(remainingCents, milestones.filter(row => row.due).reduce((sum, row) => sum + row.remainingCents, 0)), needsAllocation: !!plan && (unassigned < 0 || milestones.some(row => row.paidCents < 0 || row.paidCents > row.amountCents)) };
}
