import { useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkflowRun } from '../configuration-types';

export function TaskRunList({ runs, renderRun }: { runs: WorkflowRun[]; renderRun: (run: WorkflowRun) => ReactNode }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(runs.length / 25)), current = Math.min(page, pages - 1);
  return <><div className="wf-run-list">{runs.slice(current * 25, (current + 1) * 25).map(run => <div key={run.id}>{renderRun(run)}</div>)}</div>{pages > 1 && <nav className="batch-panel-actions" aria-label="任务列表分页"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages} · 共 {runs.length} 条</span><button className="btn btn-secondary" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>下一页</button></nav>}</>;
}
