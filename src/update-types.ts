export interface AppUpdateStatus {
  available: boolean;
  enabled: boolean;
  phase: 'unavailable' | 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  version?: string;
  progress?: number;
  lastCheckedAt?: string;
  message?: string;
}

export interface AppUpdateBridge {
  openDownloads?: () => Promise<void>;
  status: () => Promise<AppUpdateStatus>;
  setEnabled: (enabled: boolean) => Promise<AppUpdateStatus>;
  onStatus: (listener: (status: AppUpdateStatus) => void) => () => void;
}
