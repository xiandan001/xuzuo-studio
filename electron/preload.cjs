const { contextBridge, ipcRenderer } = require('electron');
let closeStateReader, lastClosingStatus;
const pendingCloseRequests = new Set(), closingListeners = new Set();
function replyToClose(token) {
  let blocked = true;
  try { blocked = closeStateReader().blocked === true; } catch { /* An unreadable editor remains protected. */ }
  ipcRenderer.send('window:close-state', { token, blocked });
}
ipcRenderer.on('window:close-state-request', (_event, token) => {
  if (closeStateReader) replyToClose(token);
  else { if (pendingCloseRequests.size >= 8) pendingCloseRequests.clear(); pendingCloseRequests.add(token); }
});
ipcRenderer.on('window:closing-status', (_event, value) => {
  lastClosingStatus = value;
  for (const listener of closingListeners) { try { listener(value); } catch { /* Native exit does not depend on rendering progress. */ } }
});

contextBridge.exposeInMainWorld('desktop', {
  maintenance: { status: () => ipcRenderer.invoke('maintenance:status'), openUninstall: () => ipcRenderer.invoke('maintenance:uninstall') },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    setEnabled: enabled => ipcRenderer.invoke('updates:set-enabled', enabled),
    onStatus: listener => { const handler = (_event, value) => listener(value); ipcRenderer.on('updates:status', handler); return () => ipcRenderer.removeListener('updates:status', handler); },
  },
  fileDialogs: {
    setAppearance: value => ipcRenderer.invoke('file-dialog:appearance', value),
    saveText: input => ipcRenderer.invoke('file-dialog:save-text', input),
  },
  validationProfile: process.argv.includes('--xuzuo-isolated-validation'),
  onCloseStateRequested: reader => { closeStateReader = reader; const pending = [...pendingCloseRequests]; pendingCloseRequests.clear(); queueMicrotask(() => { if (closeStateReader === reader) for (const token of pending) replyToClose(token); }); return () => { if (closeStateReader === reader) closeStateReader = undefined; }; },
  onClosingStatus: listener => { closingListeners.add(listener); if (lastClosingStatus) listener(lastClosingStatus); return () => closingListeners.delete(listener); },
  assets: {
    categories: input => ipcRenderer.invoke('runtime:asset-categories', input),
    saveCategory: input => ipcRenderer.invoke('runtime:asset-category-save', input),
    removeCategory: input => ipcRenderer.invoke('runtime:asset-category-remove', input),
    assignCategory: input => ipcRenderer.invoke('runtime:asset-category-assign', input),
    importBuiltin: input => ipcRenderer.invoke('runtime:asset-builtin-import', input),
    attachBuiltin: input => ipcRenderer.invoke('runtime:asset-builtin-attach', input),
    saveBuiltin: input => ipcRenderer.invoke('runtime:asset-builtin-save', input),
    openBuiltinLink: input => ipcRenderer.invoke('runtime:asset-builtin-link', input),
    list: input => ipcRenderer.invoke('runtime:asset-list', input),
    import: input => ipcRenderer.invoke('runtime:asset-import', input),
    update: input => ipcRenderer.invoke('runtime:asset-update', input),
    attach: input => ipcRenderer.invoke('runtime:asset-attach', input),
    preview: input => ipcRenderer.invoke('runtime:asset-preview', input),
    save: input => ipcRenderer.invoke('runtime:asset-save', input),
  },
  dataManagement: {
    exportBackup: input => ipcRenderer.invoke('runtime:backup-export', input),
    inspectBackup: () => ipcRenderer.invoke('runtime:backup-inspect'),
    importBackup: input => ipcRenderer.invoke('runtime:backup-import', input),
    pendingImports: () => ipcRenderer.invoke('runtime:backup-pending'),
    acknowledgeImport: backupId => ipcRenderer.invoke('runtime:backup-acknowledge', backupId),
    relocateWorkspace: input => ipcRenderer.invoke('runtime:workspace-relocate', input),
  },
  delivery: {
    inspect: input => ipcRenderer.invoke('runtime:delivery-inspect', input),
    saveReview: input => ipcRenderer.invoke('runtime:delivery-review', input),
    confirm: input => ipcRenderer.invoke('runtime:delivery-confirm', input),
    history: input => ipcRenderer.invoke('runtime:delivery-history', input),
    exportZip: input => ipcRenderer.invoke('runtime:delivery-zip', input),
  },
  batches: {
    parse: () => ipcRenderer.invoke('runtime:batch-parse'),
    create: input => ipcRenderer.invoke('runtime:batch-create', input),
    list: () => ipcRenderer.invoke('runtime:batch-list'),
    get: input => ipcRenderer.invoke('runtime:batch-get', input),
    control: input => ipcRenderer.invoke('runtime:batch-control', input),
  },
  workspaceFiles: {
    reconnect: input => ipcRenderer.invoke('runtime:workspace-reconnect', input),
    chooseProjectFolder: input => ipcRenderer.invoke('runtime:workspace-project-folder', input),
    createProject: input => ipcRenderer.invoke('runtime:workspace-create-project', input),
    list: () => ipcRenderer.invoke('runtime:workspace-list'),
    repair: input => ipcRenderer.invoke('runtime:workspace-repair', input),
    choose: input => ipcRenderer.invoke('runtime:workspace-choose', input),
    ensureProject: input => ipcRenderer.invoke('runtime:workspace-ensure-project', input),
    moveProject: input => ipcRenderer.invoke('runtime:workspace-move-project', input),
    open: input => ipcRenderer.invoke('runtime:workspace-open', input),
  },
  editor: {
    restore: input => ipcRenderer.invoke('runtime:editor-restore', input),
    load: input => ipcRenderer.invoke('runtime:editor-load', input),
    save: input => ipcRenderer.invoke('runtime:editor-save', input),
    history: input => ipcRenderer.invoke('runtime:editor-history', input),
    loadVersion: input => ipcRenderer.invoke('runtime:editor-loadVersion', input),
    export: input => ipcRenderer.invoke('runtime:editor-export', input),
  },
  spreadsheets: {
    restore: input => ipcRenderer.invoke('runtime:spreadsheet-restore', input),
    load: input => ipcRenderer.invoke('runtime:spreadsheet-load', input),
    save: input => ipcRenderer.invoke('runtime:spreadsheet-save', input),
    history: input => ipcRenderer.invoke('runtime:spreadsheet-history', input),
    loadVersion: input => ipcRenderer.invoke('runtime:spreadsheet-loadVersion', input),
    export: input => ipcRenderer.invoke('runtime:spreadsheet-export', input),
  },
  runtime: {
    listProjectArtifacts: projectId => ipcRenderer.invoke('runtime:list-project-artifacts', projectId),
    exportDraft: input => ipcRenderer.invoke('runtime:export-draft', input),
    status: () => ipcRenderer.invoke('runtime:status'),
    preflight: input => ipcRenderer.invoke('runtime:preflight', input),
    start: input => ipcRenderer.invoke('runtime:start', input),
    runDetail: id => ipcRenderer.invoke('runtime:run-detail', id),
    snapshot: () => ipcRenderer.invoke('runtime:snapshot'),
    pollSnapshot: afterRevision => ipcRenderer.invoke('runtime:poll-snapshot', afterRevision),
    control: input => ipcRenderer.invoke('runtime:control', input),
    reconcile: input => ipcRenderer.invoke('runtime:reconcile', input),
    recalculateCosts: () => ipcRenderer.invoke('runtime:recalculate-costs'),
    manageRun: input => ipcRenderer.invoke('runtime:manage-run', input),
    probe: input => ipcRenderer.invoke('runtime:probe', input),
    importFiles: projectId => ipcRenderer.invoke('runtime:import-files', projectId),
    previewArtifact: id => ipcRenderer.invoke('runtime:preview-artifact', id),
    openArtifact: id => ipcRenderer.invoke('runtime:open-artifact', id),
    saveArtifact: id => ipcRenderer.invoke('runtime:save-artifact', id),
    trashArtifact: id => ipcRenderer.invoke('runtime:trash-artifact', id),
    restoreArtifact: id => ipcRenderer.invoke('runtime:restore-artifact', id),
    listTrashedArtifacts: () => ipcRenderer.invoke('runtime:list-trashed-artifacts'),
  },
  credentials: {
    status: () => ipcRenderer.invoke('credentials:status'),
    list: () => ipcRenderer.invoke('credentials:list'),
    save: input => ipcRenderer.invoke('credentials:save', input),
    setEnabled: input => ipcRenderer.invoke('credentials:set-enabled', input),
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});
