import type { ConfigurationState } from './lib/configuration';
import type { WorkspaceState } from './lib/workspace-state';
import type { ProjectLocation, WorkspaceLocation } from './workspace-types';
import type { QuoteBackupRecord } from './quote-backup-types';

export type BackupMeta = Omit<WorkspaceState, 'activeWorkspaceId'> & { activeWorkspaceId?: string; configuration: ConfigurationState; quoteDrafts?: QuoteBackupRecord[] };
export interface BackupSelection { workspaceIds: string[]; projectIds?: string[]; }
export interface BackupInspection {
  format?: 'incremental';
  chatConversations?: number;
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
export interface BackupScheduleStatus {
  workspaceId: string;
  enabledWorkspaceIds?: string[];
  available: boolean;
  configured: boolean;
  enabled: boolean;
  repository?: string;
  lastSuccess?: string;
  lastSnapshot?: string;
  files?: number;
  bytes?: number;
  newBytes?: number;
  running: boolean;
  manualOperation?: 'inspect' | 'restore';
  pending: boolean;
  waitingForMeta: boolean;
  error?: string;
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
  backupStatus?: (input: { workspaceId: string }) => Promise<BackupScheduleStatus>;
  configureAutoBackup?: (input: { workspaceId: string; enabled: boolean; chooseTarget?: boolean }) => Promise<BackupScheduleStatus | null>;
  syncBackupMeta?: (input: { workspaceId: string; meta?: BackupMeta; issue?: string }) => Promise<BackupScheduleStatus>;
  runIncrementalBackup?: (input: { workspaceId: string; meta?: BackupMeta }) => Promise<BackupScheduleStatus>;
  cancelIncrementalBackup?: (input: { workspaceId: string }) => Promise<BackupScheduleStatus>;
  inspectIncrementalBackup?: (input: { workspaceId: string }) => Promise<BackupInspection | null>;
  restoreIncrementalBackup?: (input: { workspaceId: string; filePath: string }) => Promise<BackupImportResult | null>;
  onBackupChanged?: (listener: (event: { workspaceId?: string }) => void) => () => void;
  exportBackup: (input: { meta: BackupMeta; workspaceIds: string[]; projectIds?: string[] }) => Promise<{ saved: boolean; path?: string; files?: number; bytes?: number }>;
  inspectBackup: () => Promise<BackupInspection | null>;
  importBackup: (input: { filePath: string }) => Promise<BackupImportResult | null>;
  pendingImports: () => Promise<BackupImportResult[]>;
  acknowledgeImport: (backupId: string) => Promise<void>;
  relocateWorkspace: (input: { workspaceId: string; mode: 'reconnect' | 'copy' }) => Promise<DirectoryLocations | null>;
}
