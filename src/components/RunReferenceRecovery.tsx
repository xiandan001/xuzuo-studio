import { AlertCircle, FolderOpen, LoaderCircle, RefreshCw, ArrowRight } from 'lucide-react';
import type { WorkflowReferenceIssue } from '../configuration-types';
import './RunReferenceRecovery.css';

export interface RunReferenceRecoveryProps {
  issue: WorkflowReferenceIssue;
  message?: string;
  onShowFiles: () => void;
  onRefreshFiles?: () => void;
  onReturnToStudio: () => void;
  refreshing?: boolean;
  feedback?: string;
}

export function RunReferenceRecovery({ issue, message, onShowFiles, onRefreshFiles, onReturnToStudio, refreshing = false, feedback }: RunReferenceRecoveryProps) {
  return <section className="wf-reference-recovery" aria-label="处理不可用引用">
    {message && <p role="alert"><AlertCircle size={16} /><span>{message}</span></p>}
    <div className="wf-reference-recovery-actions">
      <button type="button" className="btn btn-secondary" onClick={onShowFiles}><FolderOpen size={15} />查看来源文件</button>
      {onRefreshFiles && <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={onRefreshFiles}>{refreshing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{refreshing ? '正在刷新' : '刷新文件清单'}</button>}
      <button type="button" className="btn btn-ghost" onClick={onReturnToStudio}>返回工作台<ArrowRight size={15} /></button>
    </div>
    <small>{['unsupported-format', 'foreign-project', 'incomplete'].includes(issue.reason) ? '请在工作台重新选择或重新准备引用；原任务和费用保留。' : '可在来源步骤的文件区查看回收站，恢复后刷新，再明确点击继续。刷新不会调用模型。'}</small>
    {feedback && <small role="status">{feedback}</small>}
  </section>;
}
