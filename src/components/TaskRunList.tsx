import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export function TaskRunList<T extends { id: string }>({ runs, renderRun, initialRunId, followRunId, onPageChange }: { runs: T[]; renderRun: (run: T) => ReactNode; initialRunId?: string; followRunId?: string; onPageChange?: () => void }) {
  const [page, setPage] = useState(() => Math.floor(Math.max(0, runs.findIndex(run => run.id === initialRunId)) / 25));
  const pages = Math.max(1, Math.ceil(runs.length / 25)), followedIndex = followRunId ? runs.findIndex(run => run.id === followRunId) : -1;
  const current = followedIndex >= 0 ? Math.floor(followedIndex / 25) : Math.min(page, pages - 1);
  const followedPage = followedIndex >= 0 ? Math.floor(followedIndex / 25) : undefined;
  useEffect(() => { if (followedPage !== undefined) setPage(followedPage); }, [followedPage]);
  function changePage(next: number) { setPage(next); onPageChange?.(); }
  return <><div className="wf-run-list">{runs.slice(current * 25, (current + 1) * 25).map(run => <div key={run.id}>{renderRun(run)}</div>)}</div>{pages > 1 && <nav className="batch-panel-actions" aria-label="任务列表分页"><button className="btn btn-secondary" disabled={!current} onClick={() => changePage(current - 1)}>上一页</button><span>{current + 1} / {pages} · 共 {runs.length} 条</span><button className="btn btn-secondary" disabled={current === pages - 1} onClick={() => changePage(current + 1)}>下一页</button></nav>}</>;
}
