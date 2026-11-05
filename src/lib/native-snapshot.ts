import type { LiveSnapshot } from '../live-types';

export function mergeNativeSnapshot(previous: LiveSnapshot, incoming: LiveSnapshot): LiveSnapshot {
  if (!incoming.delta) return incoming;
  const runs = new Map(incoming.runs.map(run => [run.id, run]));
  const known = new Set(previous.runs.map(run => run.id));
  const nextRuns = [...incoming.runs.filter(run => !known.has(run.id)), ...previous.runs.map(run => runs.get(run.id) || run)];
  const ledger = new Map(previous.ledger.map(entry => [entry.id, entry]));
  for (const entry of incoming.ledger) { const old = ledger.get(entry.id); ledger.set(entry.id, old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry); }
  return { revision: incoming.revision, runs: nextRuns, ledger: [...ledger.values()].sort((a, b) => b.time.localeCompare(a.time)) };
}
