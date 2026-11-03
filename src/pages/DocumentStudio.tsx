import type { PageProps } from '../types';
import { EditableDocumentStudio } from '../components/EditableDocumentStudio';
import { SpreadsheetStudio } from '../components/SpreadsheetStudio';

export function DocumentStudio(props: PageProps) {
  const project = props.activeProject.kind === 'image' ? props.projects.find(item => item.kind !== 'image') : props.activeProject;
  if (!project) return <div className="panel" style={{ padding: 30 }}>请先新建一个文档项目。</div>;
  const documentProps = { ...props, activeProject: project };
  return project.kind === 'excel' ? <SpreadsheetStudio key={project.id} {...documentProps} /> : <EditableDocumentStudio key={project.id} {...documentProps} />;
}
