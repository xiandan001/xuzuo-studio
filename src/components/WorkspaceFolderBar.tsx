import { useState } from 'react';
import { ChevronDown, FolderOpen, FolderPlus } from 'lucide-react';
import type { Project, Workspace } from '../types';
export function WorkspaceFolderBar({ workspace, project, onBind, onOpen }: { workspace: Workspace; project?: Project; onBind: () => void; onOpen: (projectId?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!window.desktop?.workspaceFiles) return null;
  return <section className={`workspace-folder-bar ${workspace.directory ? 'compact' : 'unbound'}`} aria-label="当前本地工作区"><FolderOpen size={17} /><div>{workspace.directory ? <><button className="workspace-location-toggle" title={project?.directory || workspace.directory} aria-label="查看存储位置" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><strong>{workspace.name}{project ? ` / ${project.name}` : ''}</strong><ChevronDown size={14} /></button>{expanded && <div className="workspace-folder-details"><p>工作区：{workspace.directory}</p>{project?.directory && <small>项目：{project.directory}</small>}</div>}</> : <><strong>为工作区设置本地文件夹</strong><p>项目文件将分别保存在独立子文件夹中。</p></>}</div><span>{workspace.directory ? <button className="btn btn-ghost" onClick={() => onOpen(project?.directory ? project.id : undefined)}><FolderOpen size={15} />打开文件夹</button> : <button className="btn btn-secondary" onClick={onBind}><FolderPlus size={15} />选择工作区文件夹</button>}</span></section>;
}
