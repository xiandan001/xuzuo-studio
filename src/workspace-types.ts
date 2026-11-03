export interface WorkspaceLocation { workspaceId: string; name: string; directory: string; }
export interface ProjectLocation { projectId: string; workspaceId: string; name: string; directory: string; }
export interface ProjectFolderSelection { selectionId: string; projectId: string; workspaceId: string; directory: string; name: string; }
export interface WorkspaceFilesBridge {
  list: () => Promise<{ workspaces: WorkspaceLocation[]; projects: ProjectLocation[] }>;
  reconnect: (input: { workspaceId: string }) => Promise<(WorkspaceLocation & { repaired: boolean; missingProjectIds: string[] }) | null>;
  repair: (input: { workspaceId: string }) => Promise<WorkspaceLocation & { repaired: boolean }>;
  choose: (input: { workspaceId: string; name: string; projects: { id: string; name: string; workspaceId: string }[] }) => Promise<WorkspaceLocation | null>;
  ensureProject: (input: { projectId: string; workspaceId: string; name: string }) => Promise<ProjectLocation>;
  chooseProjectFolder: (input: { workspaceId: string }) => Promise<ProjectFolderSelection | null>;
  createProject: (input: { selectionId: string; name: string }) => Promise<ProjectLocation>;
  moveProject: (input: { projectId: string; workspaceId: string; name: string }) => Promise<ProjectLocation>;
  open: (input: { workspaceId?: string; projectId?: string }) => Promise<void>;
}
