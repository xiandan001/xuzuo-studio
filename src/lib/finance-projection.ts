import type { LedgerEntry } from '../types';
import { summarizeCosts } from './cost-display';
import { monthlyEntries, shanghaiMonth } from './studio-time';

const isLive = (entry: LedgerEntry) => entry.billingMode === 'live';
function build(ledger: LedgerEntry[]) {
  const real = ledger.filter(isLive), simulation = ledger.filter(entry => !isLive(entry));
  return { real, simulation, realSummary: summarizeCosts(real), simulationSummary: summarizeCosts(simulation),
    realEdits: summarizeCosts(real.filter(entry => entry.action === 'AI 精修' || entry.action === '重新生成')),
    simulationEdits: summarizeCosts(simulation.filter(entry => entry.action === 'AI 精修' || entry.action === '重新生成')) };
}
type Base = ReturnType<typeof build>;
interface Projection extends Base { monthKey?: string; month?: { entries: ReturnType<typeof monthlyEntries>; summary: ReturnType<typeof summarizeCosts> }; }
// React ledger arrays are immutable. Cache ownership is weak and ends when a ledger is replaced.
const cache = new WeakMap<LedgerEntry[], Projection>();
export function financeProjection(ledger: LedgerEntry[]) {
  let value = cache.get(ledger);
  if (!value) { value = build(ledger); cache.set(ledger, value); }
  return value;
}
export function financeMonth(ledger: LedgerEntry[], now: number) {
  const value = financeProjection(ledger), key = shanghaiMonth(now);
  if (!value.month || value.monthKey !== key) {
    const entries = monthlyEntries(value.real, now);
    value.month = { entries, summary: summarizeCosts(entries.current) }; value.monthKey = key;
  }
  return value.month;
}
