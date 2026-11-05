import type { PageProps } from '../types';
import { lazy, Suspense } from 'react';

const EditableDocumentStudio = lazy(() => import('../components/EditableDocumentStudio').then(module => ({ default: module.EditableDocumentStudio })));
const SpreadsheetStudio = lazy(() => import('../components/SpreadsheetStudio').then(module => ({ default: module.SpreadsheetStudio })));

export function DocumentStudio(props: PageProps) {
  const project = props.activeProject.kind === 'image' ? props.projects.find(item => item.kind !== 'image') : props.activeProject;
  if (!project) return <div className="panel" style={{ padding: 30 }}>请先新建一个文档项目。</div>;
  const documentProps = { ...props, activeProject: project };
  return <Suspense fallback={<div className="empty-state" role="status">正在打开{project.kind === 'excel' ? 'Excel' : project.kind === 'word' ? 'Word' : 'PPT'}工作台…</div>}>{project.kind === 'excel' ? <SpreadsheetStudio key={project.id} {...documentProps} /> : <EditableDocumentStudio key={project.id} {...documentProps} />}</Suspense>;
}
