import { hasManagedDialog } from '../lib/dialog-stack';
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog';
import { WorkspaceManagementDialog } from './WorkspaceManagementDialog';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronDown, FolderOpen, Layers3, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import type { Project, ProjectKind, Workspace } from '../types';
import { visibleWorkspaces } from '../lib/workspace-state';
import './workspaces.css';

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: Project[];
  onSelect: (workspaceId: string) => void;
  onCreate: (name: string, description: string) => Promise<boolean>;
  onBind: (id: string) => Promise<boolean>;
  onOpen: (id: string) => void;
  onRemove: (id: string) => Promise<boolean>;
  onRestore: (id: string) => Promise<boolean>;
}
export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, projects, onSelect, onCreate, onBind, onOpen, onRemove, onRestore }: WorkspaceSwitcherProps) {
  const visible = visibleWorkspaces(workspaces), removed = workspaces.filter(workspace => workspace.removedAt);
  const active = visible.find(workspace => workspace.id === activeWorkspaceId) || visible[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string>(), [showRemoved, setShowRemoved] = useState(false);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (hasManagedDialog()) return; if (event.key === 'Escape') { setMenuOpen(false); setCreating(false); } };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  return <div className="wsc-root">
    <button className={`workspace-selector wsc-trigger ${menuOpen ? 'wsc-open' : ''}`} aria-label={`切换工作区：${active.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><span className="workspace-avatar">{Array.from(active.name)[0]}</span><span><strong>{active.name}</strong><small>独立工作区 · {projects.filter(project => project.workspaceId === active.id).length} 个项目</small></span><ChevronDown size={14} /></button>
    {menuOpen && <><button className="wsc-dismiss" aria-label="关闭工作区菜单" onClick={() => setMenuOpen(false)} /><section className="wsc-menu" aria-label="选择工作区"><div className="wsc-menu-label"><Layers3 size={14} /> 我的工作区 <span>{visible.length}</span></div><div className="wsc-menu-list">{visible.map(workspace => <div key={workspace.id} className={`wsc-workspace-row ${workspace.id === activeWorkspaceId ? 'active' : ''}`}><button type="button" className="wsc-workspace-select" onClick={() => { onSelect(workspace.id); setMenuOpen(false); }}><span className="wsc-avatar">{Array.from(workspace.name)[0]}</span><span><strong>{workspace.name}</strong><small>{projects.filter(project => project.workspaceId === workspace.id).length} 个项目 · 独立费用与资料</small></span>{workspace.id === activeWorkspaceId && <Check size={15} />}</button><button type="button" className="btn-icon wsc-remove-trigger" aria-label={`移除工作区：${workspace.name}`} title="从列表移除，之后可以恢复" onClick={() => { setMenuOpen(false); setRemoving(workspace.id); }}><Trash2 size={16} /></button></div>)}</div><button className="wsc-new" onClick={() => { setMenuOpen(false); setCreating(true); }}><Plus size={16} /> 新建工作区</button><button className="wsc-new" onClick={() => { setMenuOpen(false); setShowRemoved(true); }}><RotateCcw size={16} />已移除的工作区 <span className="wsc-removed-count">{removed.length}</span></button><button className="wsc-new" onClick={() => { setMenuOpen(false); if (active.directory) onOpen(active.id); else void onBind(active.id); }}><FolderOpen size={16} />{active.directory ? '打开工作区文件夹' : '绑定本地文件夹'}</button><p title={active.directory}><ShieldCheck size={12} />{active.directory || '项目、素材、提示词和报价分区管理'}</p></section></>}
    {creating && <WorkspaceCreateDialog workspaces={workspaces} onCreate={onCreate} onClose={() => setCreating(false)} />}
    {(removing || showRemoved) && <WorkspaceManagementDialog target={workspaces.find(workspace => workspace.id === removing)} workspaces={workspaces} projects={projects} onRemove={onRemove} onRestore={onRestore} onClose={() => { setRemoving(undefined); setShowRemoved(false); }} />}
  </div>;
}

export function EmptyWorkspace({ workspace, projectCount = 0, trashedProjectCount = 0, kind, onCreateProject, onOpenPrompts, onOpenTrash }: { workspace: Workspace; projectCount?: number; trashedProjectCount?: number; kind?: ProjectKind; onCreateProject: () => void; onOpenPrompts: () => void; onOpenTrash?: () => void }) {
  return <section className="wsc-empty-page page-enter"><div className="wsc-empty-icon"><FolderOpen size={35} /><span><Check size={13} /></span></div><span className="pill soft-purple">{workspace.name}</span><h1>{projectCount > 0 ? kind === 'image' ? '添加这个工作区的第一份图像创作' : '添加这个工作区的第一份文档' : '工作区已就绪，开始第一份作品'}</h1><p>{workspace.description || '在这个独立空间里，整理属于这次创作的文档、图像与灵感。'}</p>{projectCount === 0 && <div className="wsc-empty-stats"><span>项目 <b>0</b></span><span>{trashedProjectCount ? <>回收站 <b>{trashedProjectCount} 个项目</b></> : <>演示成本 <b>¥0.00</b></>}</span><span>{trashedProjectCount ? <>历史费用 <b>保留在账本</b></> : <>素材与自定义模板 <b>独立保存</b></>}</span></div>}<div className="wsc-empty-actions"><button className="btn btn-primary" onClick={onCreateProject}><Plus size={16} />{kind === 'image' ? '新建图像项目' : projectCount > 0 ? '新建文档项目' : '新建第一个项目'}</button><button className="btn btn-secondary" onClick={onOpenPrompts}>先选一个提示词模板 <ArrowRight size={14} /></button></div>{trashedProjectCount > 0 && onOpenTrash && <button className="btn btn-ghost" onClick={onOpenTrash}><FolderOpen size={14} />查看项目回收站（{trashedProjectCount}）</button>}<small><ShieldCheck size={13} /> 切回原工作区，之前的项目与费用都还在。</small></section>;
}
