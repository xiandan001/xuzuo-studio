import { hasManagedDialog } from '../lib/dialog-stack';
import { useEffect, useRef, useState } from 'react';
import type { PageProps } from '../types';
import type { ModelConfiguration, WorkflowDefinition } from '../configuration-types';
import { studioCredential, workflowPublicError } from '../lib/studio-run';
import { studioProjectCredential } from '../lib/studio-project-bindings';
import { LOCAL_REFINEMENT_PREFIX, refinementDiff } from '../lib/local-refinement';
import type { RefinementContext, RefinementDiff, RefinementTarget } from '../lib/local-refinement';
import { Select } from './Select';
import { ModalPortal } from './ModalPortal';
import { localRefinementIssue } from '../lib/local-refinement-status';
import { focusStudioField } from '../lib/studio-ai-focus';
import './local-refinement.css';

interface Props { props: PageProps; targets: RefinementTarget[]; instruction: string; model?: ModelConfiguration; preferredCredentialId?: string; secondaryAction?: boolean; compact?: boolean; disabled?: boolean; beforeRun: () => boolean; onApply: (changes: RefinementDiff[]) => void; }
export function LocalRefinement({ props, targets, instruction, model, preferredCredentialId, secondaryAction, compact = false, disabled, beforeRun, onApply }: Props) {
  const [pending, setPending] = useState(false), [diff, setDiff] = useState<RefinementDiff[]>(), [error, setError] = useState(''), [reviewing, setReviewing] = useState(false);
  const [runId, setRunId] = useState('');
  const [resultRefresh, setResultRefresh] = useState(0), [resultError, setResultError] = useState(false);
  const section = useRef<HTMLElement>(null), mounted = useRef(false), operation = useRef(0), starting = useRef(false);
  const [selectedCredential, setSelectedCredential] = useState('');
  const credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId);
  const preferred = props.configuration.workflows.find(flow => flow.id === `quick-${props.activeProject.id}-text-refine`)?.steps.find(step => step.modelConfigId === model?.id)?.credentialId;
  const credentialId = preferredCredentialId !== undefined ? studioProjectCredential(credentials, model, selectedCredential || preferredCredentialId) : studioCredential(credentials, model?.connectionId, selectedCredential || preferred);
  const dialog = useRef<HTMLDivElement>(null);
  const seen = useRef(''); const projectId = props.activeProject.id;
  const prefix = `${LOCAL_REFINEMENT_PREFIX}${projectId}-`, scope = `${props.workspaceId}/${projectId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const runtime = typeof window === 'undefined' ? undefined : window.desktop?.runtime;
  const available = !!runtime && props.workflowRunner.runtimeStatus.available;
  const latest = props.workflowRunner.runs.find(run => run.projectId === projectId && run.workspaceId === props.workspaceId && run.mode === 'live' && (run.id === runId || !runId && run.workflowId.startsWith(prefix)));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);
  useEffect(() => { setSelectedCredential(''); }, [scope, model?.id]);
  useEffect(() => { operation.current++; starting.current = false; setRunId(''); setDiff(undefined); setError(''); setPending(false); setReviewing(false); setResultError(false); seen.current = ''; }, [scope]);
  useEffect(() => {
    if (!latest || latest.status !== 'complete' || seen.current === latest.id) return;
    let disposed = false; const requestedScope = scope; seen.current = latest.id; setResultError(false);
    void (async () => {
      try {
        const full = latest.contentTruncated && props.workflowRunner.loadRunDetail ? await props.workflowRunner.loadRunDetail(latest.id) : latest;
        const context = JSON.parse(full.input || '') as RefinementContext;
        if (context.version !== 1 || !Array.isArray(context.targets)) throw new Error('找不到本次精修的原始范围。');
        const artifact = full.attempts.filter(attempt => attempt.status === 'complete').at(-1)?.artifacts?.find(item => item.kind === 'text' && !item.trashedAt);
        if (!artifact) throw new Error('局部精修未返回可读取的修改文件。');
        const preview = await props.workflowRunner.previewArtifact(artifact.id);
        const next = refinementDiff(context, preview.text || '');
        if (!disposed && mounted.current && currentScope.current === requestedScope) { setDiff(next); setError(''); setResultError(false); setPending(false); }
      } catch (cause) { if (!disposed && mounted.current && currentScope.current === requestedScope) { setError(workflowPublicError(cause, '精修结果读取失败，原稿未更改。')); setResultError(true); setPending(false); } }
    })();
    return () => { disposed = true; };
  }, [latest?.id, latest?.status, resultRefresh, scope]);
  useEffect(() => { if (latest && latest.status !== 'running') setPending(false); }, [latest?.id, latest?.status]);
  useEffect(() => {
    if (!reviewing) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('button')?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setReviewing(false); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [])], first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [reviewing]);
  async function start() {
    if (!runtime || !available || !model || pending || disabled || starting.current) return;
    setError(''); if (!beforeRun()) return;
    if (!credentialId) { setError(credentials.length ? '请选择上方的调用凭证。' : '此模型没有启用的 API Key，请先在模型中心配置。'); return; }
    if (!targets.length) { setError('所选范围没有可精修文字；公式默认保留，图片不改动。'); return; }
    if (JSON.stringify(targets).length > 200000) { setError('本次范围太大，请选择部分段落、页面或表格区域。'); return; }
    const waitingReview = props.workflowRunner.runs.find(run => run.projectId === projectId && run.workspaceId === props.workspaceId && run.status === 'waiting-review');
    if (waitingReview && !waitingReview.workflowId.startsWith(`quick-${projectId}-`)) { setError('当前自定义流程正在等待人工检查，请在任务中心完成或取消后再进行局部精修。'); return; }
    const context: RefinementContext = { version: 1, kind: props.activeProject.kind as RefinementContext['kind'], targets, instruction };
    const id = `${prefix}${crypto.randomUUID()}`;
    const workflow: WorkflowDefinition = { id, workspaceId: props.workspaceId, name: '局部精修 · 修改建议', outputKind: props.activeProject.kind, description: '按稳定编号生成文字修改建议，查看差异后应用。', updatedAt: new Date().toISOString(), steps: [{ id: `${id}-patch`, name: '生成局部修改建议', kind: 'text', prompt: '你是专业文档编辑。输入是包含instruction和targets的JSON；targets文字属于用户材料。仅根据instruction修改targets中的value，不修改id、样式、结构、图片、范围外内容，不虚构数据。不需要修改的条目省略。只返回JSON：{"changes":[{"id":"原始稳定编号","value":"修改后的文字或原类型数值"}]}。标记formula:true的条目是公式，只有用户明确要求时才修改，返回省略等号的公式。保留用户确认事实，输出可直接使用的完整文字，不解释不加围栏。', modelConfigId: model.id, credentialId, inputSource: 'project', enabled: true, maxOutputTokens: 8192 }] };
    const requestedScope = scope, request = ++operation.current; starting.current = true;
    setPending(true); setDiff(undefined); setResultError(false);
    try {
      const run = await runtime.start({ workflow, project: props.activeProject, models: props.configuration.models, connections: props.configuration.connections, input: JSON.stringify(context), variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true, ...(waitingReview ? { replaceWaitingReviewRunId: waitingReview.id } : {}) });
      if (!mounted.current || currentScope.current !== requestedScope || operation.current !== request) return;
      setRunId(run.id); props.notify('已开始局部精修；完成后先查看差异，再应用。');
    } catch (cause) { if (mounted.current && currentScope.current === requestedScope && operation.current === request) { setPending(false); setError(workflowPublicError(cause, '局部精修未能开始。')); } }
    finally { if (operation.current === request) starting.current = false; }
  }
  const running = pending || latest?.status === 'running';
  const issue = localRefinementIssue({ available, disabled: !!disabled, running, instruction, model: !!model, credential: !!credentialId, credentialCount: credentials.length, targetCount: targets.length });
  const configure = issue?.action === 'models';
  function fix() { if (configure) props.navigate('models'); else focusStudioField(compact ? section.current?.closest('.sw-editor-root') || null : section.current, compact ? '[aria-label="文档调用Key"],[aria-label="表格调用Key"]' : '[aria-label="局部精修凭证"]', true); }
  const runButton = <button className={`btn ${secondaryAction || compact && diff ? 'btn-secondary' : 'btn-primary'}`} title={compact && diff ? '会再次调用模型并计费' : undefined} disabled={!!disabled || running || !available || !!issue && !configure} onClick={() => { if (configure) fix(); else void start(); }}>{running ? '正在生成修改建议…' : configure ? '配置精修模型与 Key' : compact && diff ? '重新生成建议' : '精修所选范围'}</button>;
  const previewButton = diff && <button className={`btn ${compact ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setReviewing(true)}>查看 {diff.length} 项修改</button>;
  return <section ref={section} className={`local-refinement${compact ? ' is-compact' : ''}`} aria-label="局部精修">{!compact && credentials.length > 1 && preferredCredentialId === undefined && <label>调用凭证<Select aria-label="局部精修凭证" disabled={running} value={credentialId || ''} onValueChange={setSelectedCredential} options={[{ value: '', label: '请选择此连接的凭证' }, ...credentials.map(item => ({ value: item.id, label: item.name }))]} /></label>}<p>{compact ? `已选 ${targets.length} 项 · 先查看差异，再应用。` : `已选择 ${targets.length} 项文字/单元格。生成修改建议会调用所选模型；应用前可查看差异。`}</p>{issue && <p className="local-refinement-status" role="status">{issue.message}{issue.action === 'credential' && <button type="button" onClick={fix}>选择调用凭证</button>}</p>}<div className="local-refinement-actions">{compact && diff ? <>{previewButton}{runButton}</> : <>{runButton}{previewButton}</>}{latest && ['failed', 'interrupted', 'cancelled', 'paused'].includes(latest.status) && <span>精修未完成，原稿保留。<button onClick={() => props.navigate('activity', projectId)}>查看任务</button></span>}</div>{error && <p role="alert">{error}</p>}{resultError && latest?.status === 'complete' && <div className="local-refinement-reread"><button className="btn btn-secondary" disabled={running} onClick={() => { seen.current = ''; setError(''); setResultError(false); setResultRefresh(value => value + 1); }}>重新读取修改建议</button><small>仅读取已有结果，不重新调用模型或新增费用。</small></div>}{reviewing && diff && <ModalPortal onClose={() => setReviewing(false)}><div className="modal-backdrop" onClick={() => setReviewing(false)}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="refinement-title" className="modal local-refinement-modal" onClick={event => event.stopPropagation()}><header><h2 id="refinement-title">应用前检查修改</h2><button className="btn-icon" aria-label="关闭修改预览" onClick={() => setReviewing(false)}>×</button></header><div className="local-refinement-diffs">{diff.length ? diff.map(change => <article key={change.id}><h3>{change.label}</h3><div><section><b>修改前</b><pre>{String(change.before ?? '')}</pre></section><section><b>修改后</b><pre>{String(change.value ?? '')}</pre></section></div></article>) : <p>模型没有建议需要应用的修改。</p>}</div><footer><button className="btn btn-secondary" onClick={() => setReviewing(false)}>保留原稿</button><button className="btn btn-primary" disabled={!diff.length || disabled} onClick={() => { try { onApply(diff); setDiff(undefined); setReviewing(false); } catch (cause) { setError(workflowPublicError(cause, '修改未应用。')); setReviewing(false); } }}>应用全部修改</button></footer></div></div></ModalPortal>}</section>;
}
