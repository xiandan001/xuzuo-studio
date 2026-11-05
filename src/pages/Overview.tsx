import { lazy, Suspense, useMemo } from 'react';
import { ArrowRight, FileSpreadsheet, FileText, Image, Presentation } from 'lucide-react';
import type { PageProps, ProjectKind } from '../types';
import { projectTimeLabel, recentProjects } from '../lib/studio-time';
import './conversation-home.css';

const HomeAutomationChat = lazy(() => import('../components/HomeAutomationChat').then(module => ({ default: module.HomeAutomationChat })));
const icons = { word: FileText, ppt: Presentation, excel: FileSpreadsheet, image: Image };
const kinds: Record<ProjectKind, string> = { word: 'Word', ppt: 'PPT', excel: 'Excel', image: '图片' };
export function Overview(props: PageProps) {
  const recent = useMemo(() => recentProjects(props.projects).slice(0, 3), [props.projects]);
  return <div className="conversation-home page-enter">
    <h1 className="conversation-home-title">创作对话</h1>
    <Suspense fallback={<section className="conversation-home-loading" role="region" aria-label="首页AI对话">正在打开创作对话…</section>}><HomeAutomationChat {...props} /></Suspense>
    {!!recent.length && <section className="conversation-recent" aria-label="最近作品"><header><h2>最近作品</h2><button type="button" className="text-button" onClick={() => props.navigate('projects')}>全部作品 <ArrowRight size={14} /></button></header><div>{recent.map(project => { const Icon = icons[project.kind]; return <button type="button" className="conversation-recent-work" key={project.id} onClick={() => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)}><span className={`conversation-work-icon work-${project.kind}`}><Icon size={18} /></span><span><strong>{project.name}</strong><small>{kinds[project.kind]} · {projectTimeLabel(project.updatedAt)}</small></span><ArrowRight size={14} /></button>; })}</div></section>}
  </div>;
}
