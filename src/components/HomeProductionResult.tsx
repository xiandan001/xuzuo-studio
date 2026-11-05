import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Download, FileSpreadsheet, FileText, Image, LoaderCircle, Presentation, RefreshCw } from 'lucide-react';
import type { PageProps, ProjectKind } from '../types';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import { homeCreationArtifacts, homeCreationDocumentSource, homeCreationPreviewUrl, homeCreationProgress } from '../lib/home-creation';
import { runCostRecords, summarizeCosts } from '../lib/cost-display';
import { workflowPublicError } from '../lib/studio-run';
import { CostTotal } from './CostAmount';

const DocumentArtifactPreview = lazy(() => import('./DocumentArtifactPreview').then(module => ({ default: module.DocumentArtifactPreview })));
const icons = { image: Image, word: FileText, ppt: Presentation, excel: FileSpreadsheet };
const names = { image: '图片', word: 'Word', ppt: 'PPT', excel: 'Excel' };

function HomeArtifactPreview({ file, kind, props }: { file: ArtifactMetadata; kind: ProjectKind; props: PageProps }) {
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
    void read(file.id).then(preview => { if (current) setState({ id: file.id, preview }); }).catch(cause => { if (current) setState({ id: file.id, error: workflowPublicError(cause, '暂时无法读取这个结果，原文件未修改。') }); });
    return () => { current = false; };
  }, [file.id, kind, visible, retry]);
  const current = state?.id === file.id ? state : undefined, url = homeCreationPreviewUrl(current?.preview?.dataUrl);
  return <div ref={host} className={`creation-result-preview preview-${kind}`} aria-label="实际生成结果预览">
    {current?.error ? <div className="creation-preview-empty"><FileText size={28} /><p role="alert">{current.error}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />重新读取 · 不调用 AI</button></div> : !visible || !current?.preview ? <div className="creation-preview-empty"><LoaderCircle size={23} className="spin" /><p>正在读取已保存的{names[kind]}结果…</p></div> : url ? <img src={url} alt={file.name} /> : current.preview.text ? kind === 'image' ? <p className="creation-preview-empty">图片未返回可展示的本地预览，可打开编辑器查看。</p> : <Suspense fallback={<div className="creation-preview-empty">正在打开文档内容…</div>}><DocumentArtifactPreview text={current.preview.text} title={file.name} hint={kind} /></Suspense> : <div className="creation-preview-empty"><FileText size={28} /><strong>{file.name}</strong><p>实际文件已保存，打开编辑器可查看内容和版式。</p></div>}
  </div>;
}

export function HomeProductionResult({ props, run, kind }: { props: PageProps; run: WorkflowRun; kind: ProjectKind }) {
  const [detail, setDetail] = useState<WorkflowRun>(), [selectedId, setSelectedId] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
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
  const actual = detail?.id === run.id && detail.updatedAt === run.updatedAt ? detail : run;
  const trashed = new Set((props.workflowRunner.trashedArtifacts || []).map(file => file.id));
  const files = homeCreationArtifacts(actual, kind).filter(file => !trashed.has(file.id));
  const documentSource = !files.length ? homeCreationDocumentSource(actual, kind, trashed) : undefined;
  const file = files.find(item => item.id === selectedId) || files[0] || documentSource;
  const project = props.projects.find(item => item.id === run.projectId && item.workspaceId === props.workspaceId && !item.trashedAt && !item.purgedAt);
  if (!project || run.workspaceId !== props.workspaceId || run.purpose === 'automation-plan' || run.mode !== 'live') return null;
  const Icon = icons[kind], progress = homeCreationProgress(actual), finished = ['complete', 'waiting-review'].includes(run.status), needsHelp = ['paused', 'failed', 'interrupted', 'cancelled'].includes(run.status);
  async function save() {
    if (!file || pending.current) return;
    const requested = currentScope.current; pending.current = true; setSaving(true); setError('');
    try { const result = await runner.current.saveArtifact(file.id); if (currentScope.current === requested && result.saved) props.notify('实际生成文件已另存，历史版本和费用保持。'); }
    catch (cause) { if (currentScope.current === requested) setError(workflowPublicError(cause, '文件未能另存，项目内原文件仍保留。')); }
    finally { pending.current = false; if (currentScope.current === requested) setSaving(false); }
  }
  return <section ref={host} className="creation-production" aria-label="当前方案制作结果">
    <header><div className={`creation-production-icon ${finished && file ? 'is-ready' : ''}`}>{finished && file ? <Check size={18} /> : run.status === 'running' ? <LoaderCircle size={18} className="spin" /> : <Icon size={19} />}</div><div><div className="creation-production-stage">制作进度</div><h3>{finished && documentSource ? '文稿已生成 · 尚未导出' : finished && file ? '作品已生成' : run.status === 'waiting-review' ? '等待检查当前内容' : finished ? '制作已结束' : run.status === 'cancelled' ? '本次制作已取消' : needsHelp ? '制作需要你处理' : '正在按方案制作'}</h3><p>{finished && documentSource ? `已保存到「${project.name}」 · 可直接检查、编辑并导出正式${names[kind]}文件` : finished && file ? `已保存到「${project.name}」${run.status === 'waiting-review' ? ' · 待人工验收' : ' · 可继续修改与导出'}` : finished ? '当前还没有可用的交付文件，已保存内容和费用仍保留。' : needsHelp ? run.error || '已完成的步骤和费用保留，不会自动重发模型请求。' : `正在处理：${progress.label}`}</p></div><div className="creation-production-cost"><span>本次制作</span><CostTotal summary={summarizeCosts(runCostRecords(run, props.ledger))} /></div></header>
    {!finished && <div className="creation-production-progress"><div><span>{progress.completed} / {progress.total} 步已完成</span><span>{run.status === 'running' ? '可以继续浏览，完成后在这里查看' : '当前进度已保留'}</span></div><div role="progressbar" aria-label="实际制作步骤进度" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.percent}%` }} /></div><button type="button" className="text-button" onClick={() => props.navigate('activity', project.id)}>查看步骤{needsHelp ? '与恢复操作' : ''}<ArrowRight size={13} /></button></div>}
    {file && finished && <><HomeArtifactPreview key={`${scope}/${file.id}`} file={file} kind={kind} props={props} />{files.length > 1 && <div className="creation-result-files" aria-label="选择本次制作结果">{files.map((item, index) => <button type="button" key={item.id} className={file.id === item.id ? 'active' : ''} aria-pressed={file.id === item.id} onClick={() => setSelectedId(item.id)} title={item.name}>{names[kind]} {index + 1}</button>)}</div>}<footer><span title={file.name}>{documentSource ? `${names[kind]}文稿 · 待检查` : file.name}<small>{(file.bytes / 1024).toFixed(0)} KB · {documentSource ? '生成源稿，编辑后导出正式文件' : '实际文件'}</small></span><div><button type="button" className={`btn ${documentSource ? 'btn-primary' : 'btn-secondary'}`} onClick={() => props.navigate(kind === 'image' ? 'images' : 'documents', project.id)}>打开编辑器</button>{!documentSource && <button type="button" className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}导出{names[kind]}</button>}</div></footer></>}
    {finished && !file && <div className="creation-production-empty"><p>这次制作尚无可用的{names[kind]}成品。已保存的步骤、源内容和费用仍保留。</p><button type="button" className="btn btn-secondary" onClick={() => props.navigate('activity', project.id)}>查看结果与步骤</button></div>}
    {error && <p className="home-plan-error" role="alert">{error}</p>}
  </section>;
}
