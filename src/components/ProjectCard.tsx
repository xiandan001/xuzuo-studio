import { ArrowUpRight, FileSpreadsheet, FileText, Presentation, Image as ImageIcon, Star } from 'lucide-react';
import { KIND_LABEL, money } from '../data';
import { CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import type { LedgerEntry, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRunner } from '../configuration-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { projectImageContent } from '../lib/image-studio';
import { projectTimeLabel } from '../lib/studio-time';
import { projectCardStatusLabel } from '../lib/project-status';
import { workflowPublicError } from '../lib/studio-run';
import './project-thumbnail.css';

const icons = { ppt: Presentation, word: FileText, excel: FileSpreadsheet, image: ImageIcon };
const previewTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
export function ProjectThumbnail({ project, runner }: { project: Project; runner?: WorkflowRunner }) {
  const Icon = icons[project.kind];
  const generatedImage = useMemo(() => project.kind === 'image' && runner ? projectImageContent(runner.runs, project.id, runner.trashedArtifacts).images.find(image => !image.projectId || image.projectId === project.id) : undefined, [project.kind, project.id, runner?.runs, runner?.trashedArtifacts]);
  const outputIds = (project.localOutputArtifactIds || []).join(','), [localImage, setLocalImage] = useState<ArtifactMetadata>();
  const currentRunner = useRef(runner); currentRunner.current = runner;
  useEffect(() => { let cancelled = false; setLocalImage(undefined); if (!generatedImage && project.kind === 'image' && outputIds && currentRunner.current?.listProjectArtifacts) void currentRunner.current.listProjectArtifacts(project.id).then(files => { if (!cancelled) setLocalImage(files.find(file => file.projectId === project.id && project.localOutputArtifactIds?.includes(file.id) && file.kind === 'image' && !file.unavailable && !file.trashedAt)); }).catch(() => { /* Keep the honest empty-file fallback. */ }); return () => { cancelled = true; }; }, [project.id, project.kind, outputIds, generatedImage?.id, runner?.inventoryRevision]);
  const image = generatedImage || (localImage?.projectId === project.id && project.localOutputArtifactIds?.includes(localImage.id) ? localImage : undefined);
  const originalFormat = image?.mimeType === 'image/gif' || image?.mimeType === 'image/svg+xml';
  const tooLarge = originalFormat && !!image && image.bytes > (image.mimeType === 'image/svg+xml' ? 4 : 20) * 1024 * 1024;
  const eligible = !!image && !image.unavailable && !image.trashedAt && previewTypes.has(image.mimeType) && !tooLarge;
  const key = JSON.stringify([project.id, image?.id, image?.mimeType, image?.bytes, image?.path, image?.createdAt]);
  const element = useRef<HTMLDivElement>(null), [visibleKey, setVisibleKey] = useState(() => typeof IntersectionObserver === 'undefined' ? key : '');
  useEffect(() => {
    setVisibleKey('');
    if (!eligible || !element.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisibleKey(key); return; }
    let disposed = false;
    const observer = new IntersectionObserver(entries => {
      if (disposed) return;
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible) { setVisibleKey(key); if (!originalFormat) observer.disconnect(); }
      else if (originalFormat) setVisibleKey('');
    }, { rootMargin: originalFormat ? '0px' : '160px' });
    observer.observe(element.current); return () => { disposed = true; observer.disconnect(); };
  }, [eligible, key, originalFormat]);
  const [preview, setPreview] = useState<{ key: string; url?: string; error?: string }>();
  useEffect(() => {
    let cancelled = false; setPreview(undefined);
    const runner = currentRunner.current;
    if (eligible && image && visibleKey === key && runner) void (runner.thumbnailArtifact || runner.previewArtifact)(image.id).then(result => {
      const type = result.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,/i)?.[1];
      if (!type || type !== result.mimeType || originalFormat && type !== image.mimeType) throw new Error('图片格式暂不能安全预览，请打开项目查看。');
      if (!cancelled) setPreview({ key, url: result.dataUrl });
    }).catch(error => { if (!cancelled) setPreview({ key, error: workflowPublicError(error, '图片预览暂不可用，请打开项目查看。') }); });
    return () => { cancelled = true; };
  }, [eligible, key, visibleKey]);
  const current = eligible && visibleKey === key && preview?.key === key ? preview : undefined;
  const fallback = image && !previewTypes.has(image.mimeType) ? '此格式暂无缩略预览，请打开项目查看。' : tooLarge ? '图片较大，请打开项目查看。' : image?.unavailable ? '原图片暂不可用，请打开项目查看。' : '暂无可用图片预览';
  return <div ref={element} className={`project-thumb project-neutral project-neutral-${project.kind}`}>{current?.url ? <><img className="project-thumb-image" loading="lazy" decoding="async" src={current.url} alt={project.name} onError={() => setPreview({ key, error: '图片未能显示，请打开项目查看。' })} /><span className="project-thumb-source">{generatedImage ? '实际生成图片' : '已保存图片'}</span></> : <><span className="project-neutral-type"><Icon size={19} />{KIND_LABEL[project.kind]}</span><strong>{project.name}</strong><span className="project-neutral-footer"><span>{project.kind === 'image' ? current?.error || fallback : '类型示意 · 打开查看实际内容'}</span><Icon size={32} strokeWidth={1.4} /></span></>}</div>;
}
export function ProjectCard({ project, ledger, runner, onOpen, onFavorite }: { project: Project; ledger?: LedgerEntry[]; runner?: WorkflowRunner; onOpen: () => void; onFavorite?: () => void }) {
  const Icon = icons[project.kind];
  const realEntries = ledger?.filter(entry => entry.projectId === project.id && entry.billingMode === 'live');
  const statusLabel = projectCardStatusLabel(project, runner?.runs);
  const statusDetail = statusLabel === '已生成' ? '已生成实际成品，仍需交付检查和人工确认。' : undefined;
  return <article className="project-card">
    <button className="project-card-open" onClick={onOpen} aria-label={`打开${project.name}`}><ProjectThumbnail project={project} runner={runner} /><span className="project-open-float"><ArrowUpRight size={18} /></span></button>
    <div className="project-card-info"><div className="project-card-name"><Icon size={15} /><button onClick={onOpen}>{project.name}</button>{onFavorite && <button className={`btn-icon favorite ${project.favorite ? 'is-favorite' : ''}`} aria-label={`${project.favorite ? '取消收藏' : '收藏'}${project.name}`} onClick={onFavorite}><Star size={15} fill={project.favorite ? 'currentColor' : 'none'} /></button>}</div>
    <div className="project-card-meta"><span>{KIND_LABEL[project.kind]}<i />{projectTimeLabel(project.updatedAt)}</span><span className={`badge status-${project.status}`} title={statusDetail} aria-label={statusDetail ? `${statusLabel}，待交付检查` : undefined}>{statusLabel}</span></div>
    <div className="project-card-footer"><span>V{project.version || 1} · {project.version > 1 ? `${project.version} 个版本` : '初始版本'}</span><span>{realEntries?.length ? <>调用费用 <b><CostTotal summary={summarizeCosts(realEntries)} /></b></> : <>累计模拟成本 <b>¥{money(project.costCents)}</b></>}</span></div></div>
  </article>;
}
