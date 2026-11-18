import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Clock3, RefreshCw, Square } from 'lucide-react';
import type { AutomationBridge } from '../automation-types';
import { RememberedDetails } from './RememberedDetails';
import type { DispatchTask } from '../lib/dispatch-tasks';
import './dispatch-task.css';

interface TaskProps { task: DispatchTask; disabled?: boolean; }
interface DetailProps extends TaskProps { bridge?: AutomationBridge; refresh: () => Promise<void>; }
type Action = 'refresh' | 'stop' | 'continue';

function localTime(value: string) {
  if (Number.isNaN(Date.parse(value))) return value;
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function DispatchTaskRow({ task, disabled, onOpen }: TaskProps & { onOpen?: () => void }) {
  const Icon = task.group === 'attention' ? CircleAlert : task.group === 'running' ? Clock3 : CheckCircle2;
  return <article className="panel dispatch-task-row" data-task-id={task.id}>
    <div className="dispatch-task-main">
      <div className="dispatch-task-labels">
        <h3>{task.title}</h3>
        <span className={`dispatch-task-state ${task.group}`}><Icon size={12} aria-hidden="true" />{task.statusLabel}</span>
      </div>
      <p className="dispatch-task-project">{task.projectName}</p>
      <p className="dispatch-task-summary">{task.summary}</p>
    </div>
    <div className="dispatch-task-side">
      {onOpen && <button type="button" className={`btn ${task.group === 'attention' ? 'btn-primary' : 'btn-secondary'}`} aria-label={`查看调度任务 ${task.title}`} disabled={disabled} onClick={onOpen}>{task.group === 'attention' ? '处理' : '详情'}<ArrowRight size={14} aria-hidden="true" /></button>}
    </div>
  </article>;
}

export function DispatchTaskDetail({ task, bridge, refresh, disabled }: DetailProps) {
  const { decision, job } = task;
  const [draft, setDraft] = useState<{ id: string; note: string; remember: boolean }>();
  const [confirmation, setConfirmation] = useState<{ action: 'stop' | 'continue'; jobId: string; decisionId?: string }>();
  const [pending, setPending] = useState<Action>();
  const [error, setError] = useState('');
  const request = useRef(false);
  const note = decision && draft?.id === decision.id ? draft.note : decision?.note || '';
  const remember = Boolean(decision && draft?.id === decision.id && draft.remember);
  const locked = disabled || !bridge || !!pending;
  const confirm = confirmation?.jobId === job.id && confirmation.decisionId === decision?.id ? confirmation.action : undefined;
  const canConfirm = confirm === 'stop' ? task.canStop : confirm === 'continue' && task.canContinue;

  function ask(action: 'stop' | 'continue') {
    setConfirmation({ action, jobId: job.id, decisionId: decision?.id });
  }

  async function act(action: Action) {
    if (locked || request.current || !bridge || (action === 'continue' && (!task.canContinue || !decision)) || action === 'stop' && !task.canStop) return;
    request.current = true;
    setPending(action);
    setError('');
    try {
      if (action === 'refresh') {
        if (decision) await bridge.resolve({ id: decision.id, action: 'refresh' });
      } else if (decision) {
        await bridge.resolve({ id: decision.id, action: action === 'stop' ? 'reject' : 'continue', note, remember });
      } else if (action === 'stop') {
        await bridge.cancelJob(job.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作未能确认，请刷新状态后查看。');
    } finally {
      try { await refresh(); }
      catch { setError(current => current || '当前状态未能刷新，请重试读取。'); }
      setConfirmation(undefined);
      request.current = false;
      setPending(undefined);
    }
  }

  return <div className="dispatch-task-detail">
    <div className="dispatch-task-detail-heading"><h3>{task.title}</h3><strong>{task.statusLabel}</strong><span>{task.projectName} · {localTime(task.updatedAt)}</span></div>
    {decision?.title && decision.title !== task.title && <strong>{decision.title}</strong>}
    <p>{task.summary}</p>
    {task.linkedRunId && task.summary !== '关联的运行记录暂不可见。' && <p className="dispatch-task-faint">关联的运行记录暂不可见，请刷新后核对。</p>}
    {task.lastDecision?.note && <div className="dispatch-task-note"><strong>上次处理备注</strong><p>{task.lastDecision.note}</p></div>}
    {decision && <RememberedDetails rememberKey={`task:${job.id}:dispatch-note`} className="dispatch-task-note">
      <summary>填写处理备注</summary>
      <textarea className="field" aria-label="待办备注" value={note} maxLength={3000} rows={3} disabled={locked} onChange={event => setDraft({ id: decision.id, note: event.target.value, remember })} placeholder="记录处理原因或本项目偏好" />
      <label><input type="checkbox" checked={remember} disabled={locked} onChange={event => setDraft({ id: decision.id, note, remember: event.target.checked })} />保存为项目记忆</label>
    </RememberedDetails>}
    {error && <p role="alert" className="dispatch-task-error">{error}</p>}
    {confirm && canConfirm ? <div className="dispatch-task-confirm">
      <p>{confirm === 'continue' ? '继续时后台会先核对已有记录。若需重新调用模型，可能产生费用。' : '后台会核对停止结果，已有文件和费用记录会保留。'}</p>
      <div className="dispatch-task-actions"><button type="button" className="btn btn-secondary" disabled={!!pending} onClick={() => setConfirmation(undefined)}>返回</button>
        <button type="button" className={`btn ${confirm === 'stop' ? 'btn-secondary' : 'btn-primary'}`} disabled={locked} onClick={() => { void act(confirm); }}>{pending ? '正在提交…' : confirm === 'stop' ? '确认停止任务' : '确认继续任务'}</button></div>
    </div> : <div className="dispatch-task-actions">
      <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => { void act('refresh'); }}><RefreshCw size={15} aria-hidden="true" />{pending === 'refresh' ? '正在读取…' : '刷新状态'}</button>
      {task.canStop && <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => ask('stop')}><Square size={14} aria-hidden="true" />停止任务</button>}
      {task.canContinue && <button type="button" className="btn btn-primary" disabled={locked} onClick={() => ask('continue')}>明确继续 · 可能新增调用费</button>}
    </div>}
  </div>;
}
