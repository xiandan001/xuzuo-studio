import { AlertCircle, CheckCircle2, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { WorkflowDialog } from './workflow-shared';

export type StudioStartPhase = 'checking' | 'starting' | 'recovering' | 'unknown' | 'rejected' | 'ready';
export function StudioStartStatus({ phase, projectName, operation, message, onClose, onRetry, onRead, onConfigure, onTasks }: { phase: StudioStartPhase; projectName: string; operation: string; message?: string; onClose: () => void; onRetry: () => void; onRead: () => void; onConfigure: () => void; onTasks: () => void }) {
  const pending = ['checking', 'starting', 'recovering'].includes(phase);
  const title = phase === 'checking' ? `正在检查${operation}设置` : phase === 'recovering' ? '正在确认任务状态' : phase === 'unknown' ? '暂未确认任务状态' : phase === 'rejected' ? '这次还没有开始' : phase === 'ready' ? '设置已就绪' : `正在开始${operation}`;
  return <WorkflowDialog title={title} subtitle={projectName} busy={false} onClose={onClose} className="studio-direct-dialog" footer={<>
    <button type="button" className="btn btn-secondary" onClick={onClose}>返回工作台</button>
    <button type="button" className="btn btn-ghost" onClick={onTasks}>查看项目任务</button>
    {(phase === 'rejected' || phase === 'ready') && <button type="button" className="btn btn-ghost" onClick={onConfigure}>调整设置</button>}
    {phase === 'unknown' && <button type="button" className="btn btn-primary" onClick={onRead}><RefreshCw size={16} />读取任务状态</button>}
    {(phase === 'rejected' || phase === 'ready') && <button type="button" className="btn btn-primary" onClick={onRetry}><Play size={16} />{phase === 'ready' ? `开始${operation}` : `重试${operation}`}</button>}
  </>}><div className={`studio-direct-progress studio-start-${phase}`} role={phase === 'rejected' ? 'alert' : 'status'} aria-live="polite">
    {pending ? <LoaderCircle size={28} className="spin" /> : phase === 'ready' ? <CheckCircle2 size={28} /> : <AlertCircle size={28} />}
    <strong>{title}</strong>
    <p>{message || (phase === 'checking' ? '自动核对模型、Key 和参考文件，不调用模型。' : phase === 'starting' ? '正在提交本次操作，结果和实际费用会保存到项目。' : phase === 'recovering' || phase === 'unknown' ? '正在读取已提交任务，避免重复生成或重复收费。' : '原图片和历史费用都保留，可以直接重试或调整设置。')}</p>
  </div></WorkflowDialog>;
}
