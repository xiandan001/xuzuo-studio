import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project, Workspace } from '../types';
import type { ProjectFolderSelection } from '../workspace-types';
type Options = { workspaces: Workspace[]; projects: Project[]; setWorkspaces: Dispatch<SetStateAction<Workspace[]>>; setProjects: Dispatch<SetStateAction<Project[]>>; notify: (message: string, type?: 'success' | 'info' | 'error') => void };
const publicError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '本地工作区操作未完成。';
export function useWorkspaceFiles(options: Options) {
  const current = useRef(options); current.current = options;
  const refresh = async () => {
    const bridge = window.desktop?.workspaceFiles; if (!bridge) return;
    const locations = await bridge.list();
    current.current.setWorkspaces(items => items.map(item => { const location = locations.workspaces.find(entry => entry.workspaceId === item.id); return location && location.directory !== item.directory ? { ...item, directory: location.directory } : item; }));
    current.current.setProjects(items => items.map(item => { if (item.purgedAt) return item; const location = locations.projects.find(entry => entry.projectId === item.id); return location && (location.directory !== item.directory || location.workspaceId !== item.workspaceId) ? { ...item, directory: location.directory, workspaceId: location.workspaceId, businessCategoryId: location.workspaceId === item.workspaceId ? item.businessCategoryId : undefined } : item; }));
    return locations;
  };
  useEffect(() => { void refresh().catch(error => current.current.notify(publicError(error), 'error')); }, []);
  const choose = async (workspace: Pick<Workspace, 'id' | 'name'>) => {
    const bridge = window.desktop?.workspaceFiles; if (!bridge) return undefined;
    const result = await bridge.choose({ workspaceId: workspace.id, name: workspace.name, projects: current.current.projects.filter(project => project.workspaceId === workspace.id && !project.purgedAt).map(({ id, name, workspaceId }) => ({ id, name, workspaceId })) });
    if (result) await refresh();
    return result;
  };
  const ensureBound = async (workspace: Workspace) => {
    const locations = await refresh();
    return locations?.workspaces.find(item => item.workspaceId === workspace.id) || choose(workspace);
  };
  return {
    refresh, choose,
    async chooseProjectFolder(workspaceId: string) {
      const bridge = window.desktop?.workspaceFiles;
      if (!bridge?.chooseProjectFolder || !bridge.createProject) throw new Error('本地项目创建需要新版桌面应用，请先更新并启动 Windows EXE。');
      const workspace = current.current.workspaces.find(item => item.id === workspaceId);
      if (!workspace) throw new Error('项目工作区不存在。');
      if (!await ensureBound(workspace)) return null;
      return bridge.chooseProjectFolder({ workspaceId });
    },
    async reconnect(workspaceId: string) {
      const bridge = window.desktop?.workspaceFiles;
      if (!bridge?.reconnect) throw new Error('请更新并启动支持工作区重新连接的桌面应用。');
      const result = await bridge.reconnect({ workspaceId });
      if (result) await refresh();
      return result;
    },
    async createProject(selection: ProjectFolderSelection, name: string) {
      const bridge = window.desktop?.workspaceFiles;
      if (!bridge?.createProject) throw new Error('本地项目创建需要新版桌面应用。');
      return bridge.createProject({ selectionId: selection.selectionId, name });
    },
    async bind(id: string) {
      const workspace = current.current.workspaces.find(item => item.id === id); if (!workspace) return false;
      try { const result = await choose(workspace); if (result) current.current.notify('本地工作区已绑定，已有产物与费用保留。'); return Boolean(result); }
      catch (error) { current.current.notify(publicError(error), 'error'); return false; }
    },
    async ensureProject(project: Project) {
      if (project.purgedAt) throw new Error('项目已永久移除，不能重新创建其目录；历史费用保留。');
      const bridge = window.desktop?.workspaceFiles; if (!bridge) return undefined;
      const workspace = current.current.workspaces.find(item => item.id === project.workspaceId); if (!workspace) throw new Error('项目工作区不存在。');
      if (!await ensureBound(workspace)) return null;
      return bridge.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
    },
    async move(project: Project, destination: string) {
      if (project.purgedAt) throw new Error('项目已永久移除，不能移动或恢复。');
      const bridge = window.desktop?.workspaceFiles; if (!bridge) return undefined;
      const workspace = current.current.workspaces.find(item => item.id === destination); if (!workspace) throw new Error('目标工作区不存在。');
      const locations = await refresh();
      if (!locations?.projects.some(item => item.projectId === project.id)) {
        const source = current.current.workspaces.find(item => item.id === project.workspaceId); if (!source) throw new Error('来源工作区不存在。');
        if (!await ensureBound(source)) return null;
        await bridge.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
      }
      if (!await ensureBound(workspace)) return null;
      try { return await bridge.moveProject({ projectId: project.id, workspaceId: destination, name: project.name }); }
      catch (error) {
        const recovered = (await refresh().catch(() => undefined))?.projects.find(item => item.projectId === project.id && item.workspaceId === destination && item.name === project.name.trim());
        if (recovered) return recovered;
        throw new Error(publicError(error));
      }
    },
    async open(workspaceId: string, projectId?: string) {
      if (projectId && current.current.projects.some(project => project.id === projectId && project.purgedAt)) { current.current.notify('项目已永久移除，不能从软件打开；历史费用保留。', 'info'); return; }
      try { await window.desktop?.workspaceFiles?.open(projectId ? { projectId } : { workspaceId }); }
      catch (error) { current.current.notify(publicError(error), 'error'); }
    },
  };
}
