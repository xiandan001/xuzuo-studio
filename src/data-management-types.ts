import type { ConfigurationState } from './lib/configuration';
import type { WorkspaceState } from './lib/workspace-state';
import type { ProjectLocation, WorkspaceLocation } from './workspace-types';
import type { QuoteBackupRecord } from './quote-backup-types';

export type BackupMeta = Omit<WorkspaceState, 'activeWorkspaceId'> & { activeWorkspaceId?: string; configuration: ConfigurationState; quoteDrafts?: QuoteBackupRecord[] };
export interface BackupSelection { workspaceIds: string[]; projectIds?: string[]; }
export interface BackupInspection {
  filePath: string;
  backupId: string;
  createdAt: string;
  scope: 'projects' | 'workspaces';
  workspaces: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  files: number;
  bytes: number;
  secretsIncluded: false;
}
export interface DirectoryLocations { workspaces: WorkspaceLocation[]; projects: ProjectLocation[]; }
export interface BackupImportResult {
  meta: BackupMeta;
  locations: DirectoryLocations;
  idMap: Record<string, string>;
  backupId: string;
  receiptPath: string;
}
export interface DataManagementBridge {
  exportBackup: (input: { meta: BackupMeta; workspaceIds: string[]; projectIds?: string[] }) => Promise<{ saved: boolean; path?: string; files?: number; bytes?: number }>;
  inspectBackup: () => Promise<BackupInspection | null>;
  importBackup: (input: { filePath: string }) => Promise<BackupImportResult | null>;
  pendingImports: () => Promise<BackupImportResult[]>;
  acknowledgeImport: (backupId: string) => Promise<void>;
  relocateWorkspace: (input: { workspaceId: string; mode: 'reconnect' | 'copy' }) => Promise<DirectoryLocations | null>;
}
