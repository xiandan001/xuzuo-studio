export interface DialogAppearance { mode: 'light' | 'dark'; palette: 'violet' | 'blue' | 'warm'; }
export interface DialogFilter { name: string; extensions: string[]; }
export interface DialogLocation { name: string; path: string; kind?: string; }
export interface DialogLocationUpdate { locations: DialogLocation[]; warning?: string; }
export interface DialogEntry { name: string; path: string; kind: 'directory' | 'file' | 'link'; bytes?: number; modified?: string | number; }
export interface DialogDirectory { path: string; parentPath: string | null; entries: DialogEntry[]; total: number; page: number; pageSize: number; canGoUp: boolean; }
export interface FileDialogSeed {
  mode: 'open' | 'save'; title: string; buttonLabel: string; path: string; defaultFilename?: string;
  locations: DialogLocation[]; filters: DialogFilter[]; multiSelections: boolean; directoryOnly: boolean;
  canCreateDirectory: boolean; allowedRoot?: string; exactPath?: string; maxSelections?: number; locationWarning?: string; selectEmpty?: boolean; locationsPending?: boolean;
}
export interface CustomDialogRequest {
  id: string; kind: 'open' | 'save' | 'message'; title: string; appearance: DialogAppearance; seed?: FileDialogSeed;
  options: { properties?: string[]; filters?: DialogFilter[]; buttonLabel?: string; message?: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number; type?: string };
}
export interface DialogAcceptance { paths?: string[]; directory?: string; filename?: string; overwriteToken?: string; }
export interface OverwriteRequest { overwriteRequired: true; path: string; token: string; }
export interface StudioDialogBridge {
  request: () => Promise<CustomDialogRequest>;
  list: (input: { path: string; search?: string; page?: number; pageSize?: number }) => Promise<DialogDirectory>;
  refreshLocations: (input?: { force?: boolean }) => Promise<DialogLocationUpdate>;
  createFolder: (input: { path: string; name: string }) => Promise<{ path: string; parentPath: string }>;
  accept: (input: DialogAcceptance) => Promise<{ accepted: true } | OverwriteRequest>;
  cancel: () => Promise<void>;
  respondMessage: (index: number) => Promise<void>;
  onAppearance: (listener: (appearance: DialogAppearance) => void) => () => void;
}
export interface FileDialogsBridge {
  setAppearance: (appearance: DialogAppearance) => void | Promise<void>;
  saveText: (input: { filename: string; text: string; mimeType: string }) => Promise<{ saved: boolean; path?: string }>;
}
declare global { interface Window { studioDialog?: StudioDialogBridge; } }
