import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ArrowRight, Check, Download, FileCheck2, FileSpreadsheet, FileText, FolderOpen, Image, LoaderCircle, MessageSquarePlus, MoreHorizontal, PanelsTopLeft, Presentation, RefreshCw } from 'lucide-react';
import type { PageProps, Project, ProjectKind } from '../types';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import { homeCreationArtifacts, homeCreationDocumentSource, homeCreationPreviewUrl, homeCreationProgress } from '../lib/home-creation';
import { runCostRecords, summarizeCosts } from '../lib/cost-display';
import { workflowPublicError } from '../lib/studio-run';
import { isCoverDeliveryLayoutFailure } from '../lib/local-image-export';
import { hasLegacyCoverAspectReview, recoverableQualityAttempt, workflowReviewState } from '../lib/workflow-review';
import { usePreparedRedPacketCover } from '../hooks/usePreparedRedPacketCover';
import { RedPacketCoverPreview, coverFileSize } from './RedPacketCoverPreview';
import { isRedPacketCoverWorkflow } from '../lib/wechat-red-packet-cover';
import { CostTotal } from './CostAmount';
import { HomeResultFilePicker } from './HomeResultFilePicker';
import { HomeQualityRecovery } from './HomeQualityRecovery';
import { HomeProductionRecovery } from './HomeProductionRecovery';
import { HomeManualReview } from './HomeManualReview';
import { ProjectTemplateActions } from './ProjectTemplateActions';
import { CustomerOrderLink } from './CustomerOrderLink';
import { ClientProofingDialog } from './ClientProofingDialog';
import { ModalPortal } from './ModalPortal';
import { selectPopupPosition } from './Select';
import './home-production-result.css';

const DocumentArtifactPreview = lazy(() => import('./DocumentArtifactPreview').then(module => ({ default: module.DocumentArtifactPreview })));
const icons = { image: Image, word: FileText, ppt: Presentation, excel: FileSpreadsheet };
const names = { image: '图片', word: 'Word', ppt: 'PPT', excel: 'Excel' };

function HomeResultMoreActions({ props, project, file }: { props: PageProps; project: Project; file: ArtifactMetadata }) {
  const [open, setOpen] = useState(false), [mounted, setMounted] = useState(false), [proofing, setProofing] = useState(false), [position, setPosition] = useState<CSSProperties>();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    setPosition(selectPopupPosition(trigger.current.getBoundingClientRect(), window.innerWidth, window.innerHeight, 235));
    const buttons = () => Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    for (const button of buttons()) button.setAttribute('role', 'menuitem');
    const frame = requestAnimationFrame(() => buttons()[0]?.focus({ preventScroll: true }));
    const outside = (event: Event) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false); };
    const moved = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside, true); window.addEventListener('scroll', moved, true); window.addEventListener('resize', moved);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); window.removeEventListener('scroll', moved, true); window.removeEventListener('resize', moved); };
  }, [open]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    else if (event.key === 'Tab') { setOpen(false); trigger.current?.focus(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const buttons = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []), current = buttons.indexOf(document.activeElement as HTMLButtonElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length; buttons[next]?.focus(); }
  }
  return <><button ref={trigger} type="button" className="btn-icon home-result-more-trigger" aria-label="成品更多操作" aria-haspopup="menu" aria-expanded={open} title="更多：模板、交付和客户校样" onClick={() => { setMounted(true); setOpen(value => !value); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMounted(true); setOpen(true); } }}><MoreHorizontal size={19} /></button>{mounted && <ModalPortal><div ref={popup} className="home-result-more-menu" role="menu" aria-label="成品更多操作菜单" hidden={!open} style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onKeyDown={keyboard} onClickCapture={event => { if (event.target instanceof Element && popup.current?.contains(event.target) && event.target.closest('button')) { setOpen(false); trigger.current?.focus({ preventScroll: true }); } }}><button type="button" className="btn btn-secondary" role="menuitem" onClick={() => props.navigate('project', project.id)}><FolderOpen size={15} />项目概览与采用版本</button><ProjectTemplateActions props={props} project={project} artifactId={file.id} /><CustomerOrderLink props={props} project={project} artifactIds={[file.id]} /><button type="button" className="btn btn-secondary" role="menuitem" onClick={() => setProofing(true)}><FileCheck2 size={15} />客户校样与反馈</button></div></ModalPortal>}{proofing && <ClientProofingDialog key={file.id} workspaceId={props.workspaceId} projectId={project.id} files={[file]} title={`${project.name}校样`.slice(0, 120)} onClose={() => setProofing(false)} onImported={result => props.notify(result.annotations ? `已导入 ${result.annotations} 条客户意见，可在业务制作中返修。` : '这些客户意见已导入，没有重复添加。')} />}</>;
}

function HomeArtifactPreview({ file, kind, props, onReady }: { file: ArtifactMetadata; kind: ProjectKind; props: PageProps; onReady?: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null), runner = useRef(props.workflowRunner); runner.current = props.workflowRunner;
  const [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ id: string; preview?: ArtifactPreview; error?: string }>();
  useEffect(() => {
    if (!host.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '100px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let current = true; setState({ id: file.id });
    const source = runner.current, read = kind === 'image' && source.thumbnailArtifact ? source.thumbnailArtifact : source.previewArtifact;
    void read(file.id).then(preview => {
      if (!current) return;
      setState({ id: file.id, preview });
      if (homeCreationPreviewUrl(preview.dataUrl) || kind !== 'image' && preview.text?.trim()) onReady?.(file.id);
    }).catch(cause => { if (current) setState({ id: file.id, error: workflowPublicError(cause, '暂时无法读取这个结果，原文件未修改。') }); });
    return () => { current = false; };
  }, [file.id, kind, visible, retry, onReady]);
  const current = state?.id === file.id ? state : undefined, url = homeCreationPreviewUrl(current?.preview?.dataUrl), documentProjectId = file.projectId;
  return <div ref={host} className={`creation-result-preview preview-${kind}`} aria-label="实际生成结果预览">
    {current?.error ? <div className="creation-preview-empty"><FileText size={28} /><p role="alert">{current.error}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />重新读取 · 不调用 AI</button></div> : !visible || !current?.preview ? <div className="creation-preview-empty"><LoaderCircle size={23} className="spin" /><p>正在读取已保存的{names[kind]}结果…</p></div> : url ? <img src={url} alt={file.name} /> : current.preview.text ? kind === 'image' ? <p className="creation-preview-empty">图片未返回可展示的本地预览，可打开编辑器查看。</p> : <Suspense fallback={<div className="creation-preview-empty">正在打开文档内容…</div>}><DocumentArtifactPreview text={current.preview.text} title={file.name} hint={kind} imageContext={documentProjectId ? { scope: props.workspaceId + '/' + documentProjectId + '/' + file.id + '/' + (current.preview.sourceRevision || 0), projectId: documentProjectId, runner: props.workflowRunner, onEditUnit: props.onOpenDocumentUnit ? unitId => props.onOpenDocumentUnit?.({ workspaceId: props.workspaceId, projectId: documentProjectId, artifactId: file.id, unitId, kind: kind === 'ppt' ? 'ppt' : kind === 'excel' ? 'excel' : 'word', sourceRevision: current.preview?.sourceRevision }) : undefined } : undefined} /></Suspense> : <div className="creation-preview-empty"><FileText size={28} /><strong>{file.name}</strong><p>实际文件已保存，打开编辑器可查看内容和版式。</p></div>}
  </div>;
}

export function HomeProductionResult({ props, run, kind }: { props: PageProps; run: WorkflowRun; kind: ProjectKind }) {
  const [detail, setDetail] = useState<WorkflowRun>(), [selectedId, setSelectedId] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const runner = useRef(props.workflowRunner); runner.current = props.workflowRunner;
  const scope = `${props.workspaceId}/${run.projectId}/${run.id}`, currentScope = useRef(scope), pending = useRef(false); currentScope.current = scope;
  const host = useRef<HTMLElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '150px' }); observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !run.contentTruncated || !runner.current.loadRunDetail) return;
    let current = true;
    setError('');
    void runner.current.loadRunDetail(run.id).then(result => { if (current && result.id === run.id && result.updatedAt === run.updatedAt) setDetail(result); }).catch(cause => { if (current) setError(workflowPublicError(cause, '制作详情暂时无法读取，可保留当前页面后重试。')); });
    return () => { current = false; };
  }, [run.id, run.updatedAt, run.contentTruncated, visible]);
  useEffect(() => () => { currentScope.current = ''; }, []);
  const actual = detail?.id === run.id && (detail.updatedAt === run.updatedAt || Date.parse(detail.updatedAt) > Date.parse(run.updatedAt)) ? detail : run;
  const trashed = new Set((props.workflowRunner.trashedArtifacts || []).map(file => file.id));
  const files = homeCreationArtifacts(actual, kind).filter(file => !trashed.has(file.id));
  const documentSource = !files.length ? homeCreationDocumentSource(actual, kind, trashed) : undefined;
  const file = files.find(item => item.id === selectedId) || files[0] || documentSource;
  const cover = kind === 'image' && isRedPacketCoverWorkflow(actual.snapshot, actual.projectId);
  const project = props.projects.find(item => item.id === run.projectId && item.workspaceId === props.workspaceId && !item.trashedAt && !item.purgedAt);
  const reviewState = workflowReviewState(actual);
  const finished = actual.status === 'complete' || reviewState === 'manual';
  const preparation = usePreparedRedPacketCover(props.workflowRunner, run.projectId, project && run.workspaceId === props.workspaceId && cover && visible && finished ? file : undefined);
  if (!project || run.workspaceId !== props.workspaceId || run.purpose === 'automation-plan' || run.mode !== 'live') return null;
  const Icon = icons[kind], progress = homeCreationProgress(actual);
  const originalId = preparation.file?.originalArtifactId;
  const coverOriginal = originalId ? actual.attempts.flatMap(attempt => attempt.artifacts || []).find(item => item.id === originalId && !item.unavailable && !item.trashedAt && !trashed.has(item.id)) : file;
  const recoveryAttempt = recoverableQualityAttempt(actual);
  const blocked = reviewState === 'quality-failed' || reviewState === 'blocked';
  const needsHelp = ['paused', 'failed', 'interrupted', 'cancelled'].includes(actual.status);
  const coverLayoutFailure = isCoverDeliveryLayoutFailure(actual);
  const step = actual.snapshot.steps[actual.stepIndex], attempt = actual.attempts.filter(row => row.stepId === step?.id).at(-1);
  const approvalId = reviewState === 'manual' && !actual.contentTruncated && !actual.referenceIssue && !actual.hiddenAt && !actual.trashedAt && !actual.supersededByRunId && !actual.retryStepOnly &&
    !actual.snapshot.steps.slice(actual.stepIndex + 1).some(item => item.enabled) && file?.runId === actual.id && file.projectId === project.id && !documentSource ? attempt?.id : undefined;
  const recovery = needsHelp || blocked && !!actual.referenceIssue;
  const openSteps = () => props.onOpenTask ? props.onOpenTask(actual.id, project.id) : props.navigate('activity', project.id);
  async function save() {
    if (!file || pending.current) return;
    const requested = currentScope.current; pending.current = true; setSaving(true); setError('');
    try {
      const bridge = runner.current;
      if (cover && (!bridge.exportRedPacketCover || !preparation.file)) throw Error('请先等待上传封面准备完成。');
      const result = cover ? await bridge.exportRedPacketCover!({ projectId: run.projectId, sourceArtifactId: file.id, preparedSha256: preparation.file!.sha256, sourceSha256: preparation.file!.sourceSha256 }) : await bridge.saveArtifact(file.id);
      if (currentScope.current === requested && result.saved) props.notify(cover ? `封面已导出 · ${preparation.file!.width} × ${preparation.file!.height} · ${coverFileSize(preparation.file!.bytes)}` : '实际生成文件已另存，历史版本和费用保持。');
    }
    catch (cause) { if (currentScope.current === requested) setError(workflowPublicError(cause, '文件未能另存，项目内原文件仍保留。')); }
    finally { pending.current = false; if (currentScope.current === requested) setSaving(false); }
  }
  return <section ref={host} className="creation-production" aria-label="当前方案制作结果">
    <header>
      <div className={`creation-production-icon ${finished && file ? 'is-ready' : ''}`}>{finished && file ? <Check size={18} /> : actual.status === 'running' ? <LoaderCircle size={18} className="spin" /> : <Icon size={19} />}</div>
      <div>
        <div className="creation-production-stage">制作进度</div>
        <h3>{coverLayoutFailure ? '封面构图需要调整' : reviewState === 'quality-failed' ? '质检未通过' : blocked ? '制作需要检查' : finished && documentSource ? '文稿已生成 · 尚未导出' : finished && file ? '作品已生成' : finished ? '制作已结束' : actual.status === 'cancelled' ? '本次制作已取消' : needsHelp ? '制作需要你处理' : '正在按方案制作'}</h3>
        {actual.status === 'failed' && actual.snapshot.steps[actual.stepIndex] && <p className="creation-production-failed-step">{coverLayoutFailure ? '本地封面检查未通过' : `失败步骤 · ${progress.label}`}</p>}
        <p>{finished && documentSource ? `已保存到「${project.name}」 · 可直接检查、编辑并导出正式${names[kind]}文件` : finished && file ? `已保存到「${project.name}」${reviewState === 'manual' ? ' · 待人工验收' : ' · 可继续修改与导出'}` : finished ? '当前还没有可用的交付文件，已保存内容和费用仍保留。' : coverLayoutFailure ? actual.error || '当前样稿的构图不符合封面要求，调整后可继续导出。' : hasLegacyCoverAspectReview(actual) ? '上次按旧画幅检查。样稿与原检查记录已保留，可按当前红包封面标准重新质检。' : needsHelp || blocked ? actual.error || '已完成的步骤和费用保留。' : `正在处理：${progress.label}`}</p>
      </div>
      <div className="creation-production-cost"><span>本次制作</span><CostTotal summary={summarizeCosts(runCostRecords(actual, props.ledger))} /></div>
    </header>
    {!finished && <div className="creation-production-progress"><div><span>{progress.completed} / {progress.total} 步已完成</span><span>{actual.status === 'running' ? '可以继续浏览，完成后在这里查看' : '当前进度已保留'}</span></div><div role="progressbar" aria-label="实际制作步骤进度" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.percent}%` }} /></div>
      {!recovery && !recoveryAttempt && <button type="button" className="text-button" onClick={openSteps}>查看步骤<ArrowRight size={13} /></button>}
    </div>}
    {recoveryAttempt && !recovery && <HomeQualityRecovery key={scope + '/' + recoveryAttempt.id} run={actual} project={project} props={props} onRead={setDetail} onOpenSteps={openSteps} />}
    {recovery && <HomeProductionRecovery key={scope + '/' + (attempt?.id || '')} run={actual} project={project} props={props} onRead={setDetail} onOpenSteps={openSteps} visible={visible} />}
    {file && (blocked || coverLayoutFailure) && <><p className="creation-production-draft">当前样稿</p><HomeArtifactPreview key={`${scope}/draft/${file.id}`} file={file} kind={kind} props={props} /></>}
    {file && finished && <>
      {cover ? <RedPacketCoverPreview key={file.id} preparation={preparation} original={coverOriginal && <HomeArtifactPreview file={coverOriginal} kind={kind} props={props} />} />
        : <HomeArtifactPreview key={`${scope}/${file.id}`} file={file} kind={kind} props={props} onReady={approvalId ? setPreviewId : undefined} />}
      {files.length > 1 && <HomeResultFilePicker files={files} selectedId={file.id} runner={props.workflowRunner} onSelect={setSelectedId} />}
      <footer>
        <span title={file.name}>{documentSource ? `${names[kind]}文稿 · 待检查` : file.name}<small>{cover ? originalId ? '上传 JPG · ' : '生成源图 · ' : ''}{(file.bytes / 1024).toFixed(0)} KB · {documentSource ? '生成源稿，编辑后导出正式文件' : '实际文件'}</small></span>
        <div className="home-result-primary-actions">
          {!documentSource && !approvalId && props.onDiscussArtifact && <button type="button" className="home-result-discuss" onClick={() => props.onDiscussArtifact?.(file, kind)}><MessageSquarePlus size={16} />继续修改这份</button>}
          <button type="button" className={documentSource ? 'btn btn-primary' : 'btn-icon home-result-editor-trigger'} aria-label="打开编辑器" title="打开编辑器" onClick={() => props.navigate(kind === 'image' ? 'images' : 'documents', project.id)}>{documentSource ? '打开编辑器' : <PanelsTopLeft size={18} />}</button>
          {reviewState === 'manual' && <button type="button" className="text-button" onClick={openSteps}>验收详情<ArrowRight size={13} /></button>}
          {approvalId ? <HomeManualReview key={`${run.id}/${approvalId}/${file.id}`} run={actual} project={project} attemptId={approvalId} artifactId={file.id} ready={cover ? !!preparation.file : previewId === file.id} props={props} onRead={setDetail} />
            : !documentSource && <button type="button" className="btn btn-primary" disabled={saving || cover && !preparation.file} onClick={() => { void save(); }}>{saving ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}{cover ? '导出微信封面 JPG' : `导出${names[kind]}`}</button>}
          {!documentSource && !approvalId && <HomeResultMoreActions key={`${scope}/${file.id}`} props={props} project={project} file={file} />}
        </div>
      </footer>
    </>}
    {finished && !file && <div className="creation-production-empty"><p>这次制作尚无可用的{names[kind]}成品。已保存的步骤、源内容和费用仍保留。</p><button type="button" className="btn btn-secondary" onClick={() => props.navigate('activity', project.id)}>查看结果与步骤</button></div>}
    {error && <p className="home-plan-error" role="alert">{error}{cover && <button type="button" className="text-button" disabled={saving} onClick={() => { setError(''); preparation.retry(); }}>刷新封面</button>}</p>}
  </section>;
}
