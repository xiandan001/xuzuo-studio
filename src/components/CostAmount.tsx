import type { CostRecord, CostSummary } from '../lib/cost-display';
import { costPrimary, costSecondary, costSummaryPrimary, costSummarySecondary } from '../lib/cost-display';
import './cost-amount.css';

export function CostAmount({ entry }: { entry: CostRecord }) {
  const secondary = costSecondary(entry);
  return <span className="cost-amount"><span>{costPrimary(entry)}</span>{secondary && <small title={secondary}>{secondary}</small>}</span>;
}
export function CostTotal({ summary }: { summary: CostSummary }) {
  const secondary = costSummarySecondary(summary);
  return <span className="cost-amount"><span>{costSummaryPrimary(summary)}</span>{secondary && <small title={secondary}>{secondary}</small>}</span>;
}
