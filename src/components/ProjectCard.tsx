import { ArrowUpRight, FileSpreadsheet, FileText, Presentation, Image as ImageIcon, Star } from 'lucide-react';
import { KIND_LABEL, money } from '../data';
import { CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import type { LedgerEntry, Project } from '../types';
import type { WorkflowRunner } from '../configuration-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { projectImageContent } from '../lib/image-studio';
import { projectTimeLabel } from '../lib/studio-time';
import { projectCardStatusLabel } from '../lib/project-status';
import './project-thumbnail.css';

const icons = { ppt: Presentation, word: FileText, excel: FileSpreadsheet, image: ImageIcon };
export function ProjectThumbnail({ project, runner }: { project: Project; runner?: WorkflowRunner }) {
  const Icon = icons[project.kind];
  const imageId = useMemo(() => project.kind === 'image' && runner ? projectImageContent(runner.runs, project.id, runner.trashedArtifacts).images.find(image => !image.projectId || image.projectId === project.id)?.id : undefined, [project.kind, project.id, runner?.runs, runner?.trashedArtifacts]);
  const element = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !element.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(element.current); return () => observer.disconnect();
  }, []);
  const currentRunner = useRef(runner); currentRunner.current = runner;
  const [preview, setPreview] = useState<{ projectId: string; imageId: string; url: string }>();
  useEffect(() => {
    let cancelled = false; setPreview(undefined);
    if (imageId && visible) void currentRunner.current?.previewArtifact(imageId).then(result => {
      if (!cancelled && result.dataUrl && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(result.dataUrl)) setPreview({ projectId: project.id, imageId, url: result.dataUrl });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [project.id, imageId, visible]);
  const actual = preview?.projectId === project.id && preview.imageId === imageId ? preview.url : undefined;
  return <div ref={element} className={`project-thumb project-neutral project-neutral-${project.kind}`}>{actual ? <><img className="project-thumb-image" loading="lazy" decoding="async" src={actual} alt={project.name} onError={() => setPreview(undefined)} /><span className="project-thumb-source">实际生成图片</span></> : <><span className="project-neutral-type"><Icon size={19} />{KIND_LABEL[project.kind]}</span><strong>{project.name}</strong><span className="project-neutral-footer"><span>{project.kind === 'image' ? '暂无可用图片预览' : '类型示意 · 打开查看实际内容'}</span><Icon size={32} strokeWidth={1.4} /></span></>}</div>;
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
