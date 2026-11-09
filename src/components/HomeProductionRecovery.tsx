import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Play, RefreshCw, Square } from 'lucide-react';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { workflowPublicError } from '../lib/studio-run';

export function HomeProductionRecovery({ run, project, props, onRead }: { run: WorkflowRun; project: Project; props: PageProps; onRead: (run: WorkflowRun) => void }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const pending = useRef(false), scope = `${props.workspaceId}/${run.id}`, current = useRef(scope); current.current = scope;
  const source = useRef(props); source.current = props;
  useEffect(() => () => { current.current = ''; }, []);
  const canContinue = ['paused', 'failed', 'interrupted'].includes(run.status) && !run.referenceIssue;
  const canCancel = ['running', 'paused', 'waiting-review'].includes(run.status);
  const needsModel = /模型|凭证|Key|401|403|额度|账户/i.test(run.error || '');
  async function act(action: 'read' | 'continue' | 'cancel') {
    if (pending.current) return;
    const requested = current.current; pending.current = true; setBusy(action); setError('');
    try {
      const bridge = window.desktop?.runtime;
      if (action !== 'read') {
        if (!bridge) throw Error('请在桌面应用中处理任务。');
        await bridge.control({ id: run.id, action: action === 'continue' && run.status === 'paused' ? 'resume' : action, project, connections: source.current.configuration.connections, models: source.current.configuration.models });
      }
      const read = bridge?.runDetail || source.current.workflowRunner.loadRunDetail;
      if (!read) throw Error('此版本暂不支持就地读取任务，请到运行记录查看。');
      const fresh = await read(run.id);
      if (current.current === requested) onRead(fresh);
    } catch (cause) { if (current.current === requested) setError(workflowPublicError(cause, '操作未完成，已有结果和费用保留。')); }
    finally { pending.current = false; if (current.current === requested) setBusy(''); }
  }
  return <div className="home-result-recovery" aria-label="就地处理制作任务"><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void act('read'); }}>{busy === 'read' ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}重新读取状态</button>{run.referenceIssue || needsModel ? <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => props.navigate(run.referenceIssue ? project.kind === 'image' ? 'images' : 'documents' : 'models', project.id)}>修复{run.referenceIssue ? '参考资料' : '模型设置'}<ArrowRight size={14} /></button> : canContinue && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => { void act('continue'); }}>{busy === 'continue' ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}继续制作</button>}{canCancel && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void act('cancel'); }}>{busy === 'cancel' ? <LoaderCircle size={14} className="spin" /> : <Square size={14} />}取消后续制作</button>}<p>{canContinue ? '继续会从当前步骤处理；如果需要再次调用模型，会新增费用。已完成内容保留。' : '重新读取和修改设置不调用模型，已有结果和费用保留。'}</p>{error && <p className="home-plan-error" role="alert">{error}</p>}</div>;
}
