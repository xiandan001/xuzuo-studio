import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { PageProps } from '../types';
import type { WorkflowRun } from '../configuration-types';
import { ModalPortal } from './ModalPortal';
import { WorkflowRunCard } from './WorkflowRunCard';
export function AutomationRunViewer({ props, runId, onClose }: { props: PageProps; runId: string; onClose: () => void }) {
  const summary = props.workflowRunner.runs.find(run => run.id === runId);
  const [record, setRecord] = useState<WorkflowRun>(), [error, setError] = useState(''), [revision, setRevision] = useState(0), [loading, setLoading] = useState(false);
  const current = useRef(`${props.workspaceId}/${runId}`); current.current = `${props.workspaceId}/${runId}`;
  useEffect(() => {
    let disposed = false; const scope = current.current; setLoading(true); setError('');
    const read = window.desktop?.runtime?.runDetail ? window.desktop.runtime.runDetail(runId) : props.workflowRunner.loadRunDetail?.(runId);
    if (!read) { setRecord(summary); setLoading(false); return; }
    void read.then(run => { if (!disposed && current.current === scope) { if (!props.projects.some(project => project.id === run.projectId && project.workspaceId === props.workspaceId)) throw Error('任务不属于当前工作区。'); setRecord(run); } }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '任务暂时无法读取，未重新执行。'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [props.workspaceId, runId, summary?.detailVersion, summary?.updatedAt, summary?.status, revision]);
  return <ModalPortal onClose={onClose}><div className="auto-modal-backdrop"><section className="auto-modal auto-run-modal" role="dialog" aria-modal="true" aria-labelledby="auto-run-title"><header><div><h2 id="auto-run-title">实际执行步骤与结果</h2><p>每次尝试、产物与调用费用都保留在对应任务中。</p></div><button className="btn-icon" aria-label="关闭自动化任务详情" onClick={onClose}><X size={20} /></button></header><div className="auto-run-content">{error && <p className="auto-error" role="alert">{error}</p>}{loading && !record && <p role="status"><LoaderCircle size={18} className="spin" />正在读取已保存记录…</p>}{record && <WorkflowRunCard props={props} run={record} />}<button className="btn btn-secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />仅读取最新记录</button></div></section></div></ModalPortal>;
}
