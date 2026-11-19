import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Play, RefreshCw, Square } from 'lucide-react';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { workflowPublicError } from '../lib/studio-run';
import { workflowOutputRetryLimit } from '../lib/workflow-output-retry';
import { canResumeLocalImageExport } from '../lib/local-image-export';

export function HomeProductionRecovery({ run, project, props, onRead }: { run: WorkflowRun; project: Project; props: PageProps; onRead: (run: WorkflowRun) => void }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const pending = useRef(false), scope = `${props.workspaceId}/${run.id}`, current = useRef(scope); current.current = scope;
  const source = useRef(props); source.current = props;
  useEffect(() => () => { current.current = ''; }, []);
  const localExport = canResumeLocalImageExport(run);
  const canContinue = (localExport || ['paused', 'failed', 'interrupted'].includes(run.status)) && !run.referenceIssue;
  const canCancel = ['running', 'paused', 'waiting-review'].includes(run.status);
  const step = run.snapshot?.steps[run.stepIndex];
  const latest = run.attempts?.filter(attempt => attempt.stepId === step?.id).at(-1);
  const failed = run.status === 'failed' && latest?.status === 'failed' ? latest : undefined;
  const message = run.error || '';
  const needsModel = failed?.httpStatus !== undefined
    ? [401, 402, 403, 404, 429].includes(failed.httpStatus)
    : ['INVALID_CREDENTIAL', 'INVALID_MODEL'].includes(failed?.errorCode || '')
      || /凭证(?:无效|不可用|不存在)|请重新录入自己的 API Key|HTTP (?:401|402|403|404|429)\b|账户额度不足|请选择启用的真实模型和连接/i.test(message);
  const originalLimit = step?.maxOutputTokens || 2048;
  const stepMaxOutputTokens = workflowOutputRetryLimit(run);
  async function act(action: 'read' | 'continue' | 'cancel') {
    if (pending.current) return;
    const requested = current.current; pending.current = true; setBusy(action); setError('');
    try {
      const bridge = window.desktop?.runtime;
      if (action !== 'read') {
        if (!bridge) throw Error('请在桌面应用中处理任务。');
        await bridge.control({
          id: run.id,
          action: action === 'continue' && run.status === 'paused' ? 'resume' : action,
          ...(action === 'continue' && stepMaxOutputTokens !== undefined ? { stepMaxOutputTokens } : {}),
          project,
          connections: source.current.configuration.connections,
          models: source.current.configuration.models,
        });
      }
      const read = bridge?.runDetail || source.current.workflowRunner.loadRunDetail;
      if (!read) throw Error('此版本暂不支持就地读取任务，请到运行记录查看。');
      const fresh = await read(run.id);
      if (current.current === requested) onRead(fresh);
    } catch (cause) { if (current.current === requested) setError(workflowPublicError(cause, '操作未完成，已有结果和费用保留。')); }
    finally { pending.current = false; if (current.current === requested) setBusy(''); }
  }
  const showContinue = canContinue && !needsModel;
  return <div className="home-result-recovery" aria-label="就地处理制作任务">
    <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void act('read'); }}>
      {busy === 'read' ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}重新读取状态
    </button>
    {run.referenceIssue || needsModel ? <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => props.navigate(run.referenceIssue ? project.kind === 'image' ? 'images' : 'documents' : 'models', project.id)}>
      修复{run.referenceIssue ? '参考资料' : '模型设置'}<ArrowRight size={14} />
    </button> : showContinue && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => { void act('continue'); }}>
      {busy === 'continue' ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}{localExport ? '继续本地导出' : stepMaxOutputTokens === undefined ? '继续制作' : '继续当前步骤'}
    </button>}
    {canCancel && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void act('cancel'); }}>
      {busy === 'cancel' ? <LoaderCircle size={14} className="spin" /> : <Square size={14} />}取消后续制作
    </button>}
    <p>{localExport ? '继续保存已生成的图片；本地导出不调用模型。' : showContinue ? <>
      {stepMaxOutputTokens !== undefined && `继续时将“${step?.name || '当前步骤'}”的输出上限从 ${originalLimit} 提高到 ${stepMaxOutputTokens} Token。`}
      从当前步骤继续，保留已完成内容。再次调用模型会新增费用。
    </> : '重新读取和修改设置不调用模型，已有结果和费用保留。'}</p>
    {error && <p className="home-plan-error" role="alert">{error}</p>}
  </div>;
}
