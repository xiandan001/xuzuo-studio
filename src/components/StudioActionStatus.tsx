import type { StudioActionIssue, StudioActionTarget } from '../lib/studio-action-status';
import './studio-action-status.css';

export function StudioActionStatus({ id, issue, error, note, onFix }: { id: string; issue?: StudioActionIssue; error?: string; note?: string; onFix: (target: StudioActionTarget) => void }) {
  if (!issue && !error && !note) return null;
  return <div id={id} className="studio-action-status" role="status" aria-live="polite">{error && <p role="alert">{error}</p>}{issue && <div><span>{issue.message}</span>{issue.target && issue.action && <button type="button" onClick={() => onFix(issue.target!)}>{issue.action}</button>}</div>}{note && <p>{note}</p>}</div>;
}
