const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, safeStorage, shell, net, nativeImage, nativeTheme, screen, powerMonitor } = require('electron');
const path = require('node:path');
const { createImageThumbnails } = require('./image-thumbnails.cjs');
const { registerOfficePreviewHandlers } = require('./office-preview-handlers.cjs');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { createCustomDialogs } = require('./custom-dialogs.cjs');
const { createAppMaintenance } = require('./app-maintenance.cjs');
const { createAppUpdater } = require('./app-updater.cjs');
const { writeDialogFile } = require('./dialog-save.cjs');
const { createCredentialStore, isTrustedCredentialSender } = require('./credential-store.cjs');
const { createArtifactStore } = require('./artifact-store.cjs');
const { createModelRuntime } = require('./model-runtime.cjs');
const { createLiveWorkflowEngine } = require('./live-workflow-engine.cjs');
const { createAutomationCenter } = require('./automation-center.cjs');
const { createAutomationPlanning } = require('./automation-planning.cjs');
const { startChecked, lookupStart } = require('./live-start.cjs');
const { createCustomerQuoteExporter } = require('./customer-quote-export.cjs');
const { probeConnection } = require('./connection-probe.cjs');
const { extractReferenceText } = require('./reference-text.cjs');
const { artifactTrashError, artifactRequestError } = require('./artifact-lifecycle.cjs');
const { createFxRateService } = require('./fx-rates.cjs');
const { createAutomaticBilling, pendingBilling } = require('./automatic-billing.cjs');
const { createCpuTasks } = require('./cpu-tasks.cjs');
const { createProjectBackup } = require('./project-backup.cjs');
const { registerProductionHandlers } = require('./production-handlers.cjs');
const { registerProjectCreation } = require('./project-creation.cjs');
const { createDeliveryStore } = require('./delivery-store.cjs');
const { createBatchProduction } = require('./batch-production.cjs');
const { createWorkspaceStorage } = require('./workspace-storage.cjs');
const { createProjectPurge } = require('./project-purge.cjs');
const { createEditorStore } = require('./editor-store.cjs');
const { createSpreadsheetStore } = require('./spreadsheet-store.cjs');
const { createDocumentArtifactPreview } = require('./artifact-document-preview.cjs');
const { createAssetLibrary } = require('./asset-library.cjs');
const { createBuiltinAssets } = require('./builtin-assets.cjs');
const { createAssetCategories } = require('./asset-categories.cjs');
const { createApplicationExit } = require('./application-exit.cjs');
const { readValidationOwner, startValidationLifecycle } = require('./validation-lifecycle.cjs');

let mainWindow;
let liveEngine, applicationExit, stopValidationLifecycle, automaticBilling, studioDialogs, appUpdater, automationCenter, chatService;
let runtimeClosing = false, drainRuntime = async () => undefined;
const runtimeRequests = new Set();
let closingWriteFailed = false;
function trackRuntimeTask(task, write = false, cancellationSafe = false) {
  runtimeRequests.add(task);
  task.then(() => runtimeRequests.delete(task), error => { runtimeRequests.delete(task); if (write && runtimeClosing && !(cancellationSafe && error?.name === 'AbortError')) closingWriteFailed = true; });
}
const validationRequested = Boolean(process.env.XUZUO_QA_PROFILE && (!app.isPackaged || process.argv.includes('--isolated-validation')));
if (validationRequested) {
  app.setName('序作工作台独立验证');
  app.setPath('userData', path.resolve(process.env.XUZUO_QA_PROFILE));
}
const validationOwner = validationRequested ? readValidationOwner(app.getPath('userData')) : null;
const visibleValidation = process.env.XUZUO_QA_VISIBLE === '1';
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed() && !runtimeClosing) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
const applicationUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;

function trustedSender(event) {
  return isTrustedCredentialSender(event, mainWindow?.webContents, applicationUrl);
}

function registerCredentials() {
  const credentials = createCredentialStore({ directory: app.getPath('userData'), safeStorage });
  const handle = (name, action) => ipcMain.handle(`credentials:${name}`, (event, input) => {
    if (!trustedSender(event)) throw new Error('此页面无权访问本机凭证。');
    if (runtimeClosing && !['list', 'status'].includes(name)) throw new Error('应用正在保存并退出，未修改密钥。');
    const task = Promise.resolve().then(() => action(input));
    if (['save', 'set-enabled'].includes(name)) trackRuntimeTask(task, true);
    return task;
  });
  handle('status', () => credentials.status());
  handle('list', () => credentials.list());
  handle('save', input => credentials.save(input));
  handle('set-enabled', input => credentials.setEnabled(input));
  return credentials;
}

function registerRuntime(credentials) {
  studioDialogs = createCustomDialogs({ app, BrowserWindow, ipcMain, getWindow: () => mainWindow, trustedSender, canStart: () => !runtimeClosing, trackTask: trackRuntimeTask, hidden: Boolean(validationOwner && !visibleValidation), initialAppearance: { mode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', palette: 'violet' }, getWorkArea: window => window ? screen.getDisplayMatching(window.getBounds()).workAreaSize : screen.getPrimaryDisplay().workAreaSize });
  const dialog = studioDialogs;
  const cpuTasks = createCpuTasks();
  const workspaceStorage = createWorkspaceStorage({ directory: app.getPath('userData') });
  let projectPurge, beadMarket, marketSessions, animationService;
  const artifactStore = createArtifactStore({ directory: path.join(app.getPath('userData'), 'artifacts-v1'), workspaceStorage, renderOffice: input => cpuTasks.run('office', input), fitWallpaper: (input, options) => cpuTasks.run('wallpaper', input, options), fitEngineering: (input, options) => cpuTasks.run('engineering', input, options), convertImage: buffer => { const image = nativeImage.createFromBuffer(buffer); if (image.isEmpty()) throw new Error('这张图像无法转换为 Office 所需的 PNG，请先检查原文件。'); return image.toPNG(); } });
  const thumbnails = createImageThumbnails({ directory: path.join(app.getPath('userData'), 'thumbnail-cache-v1'), nativeImage });
  workspaceStorage.setArtifactMigrator((projectId, destination, options) => artifactStore.migrateProject(projectId, destination, options));
  const editorStore = createEditorStore({ workspaceStorage, artifactStore });
  const spreadsheetStore = createSpreadsheetStore({ workspaceStorage, artifactStore });
  const beadStore = require('./bead-store.cjs').createBeadStore({ workspaceStorage });
  const animationStore = require('./animation-store.cjs').createAnimationStore({ workspaceStorage, onChanged: value => { try { mainWindow?.webContents.send('animation:changed', value); } catch { /* Saved animation sources remain available. */ } } });
  const assets = createAssetLibrary({ workspaceStorage, artifactStore });
  const builtinAssets = createBuiltinAssets({ workspaceStorage, artifactStore, assetLibrary: assets });
  const assetCategories = createAssetCategories({ workspaceStorage, assetLibrary: assets, builtinAssets });
  const fetchImpl = (url, options) => net.fetch(url, options);
  const normalizeRasterReference = require('./image-reference-normalization.cjs').createImageReferenceNormalizer({ nativeImage });
  const modelRuntime = createModelRuntime({ credentialStore: credentials, artifactStore, fetchImpl, normalizeRasterReference, directory: app.getPath('userData'), getAvailableRuns: async projectIds => (await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds })).runs });
  const fxRates = createFxRateService({ directory: app.getPath('userData'), fetchImpl });
  chatService = require('./chat-service.cjs').createChatService({ directory: app.getPath('userData'), credentialStore: credentials, fetchImpl, fxRates, onChanged: value => { try { mainWindow?.webContents.send('chat:changed', value); } catch { /* Conversations persist independently of the renderer. */ } } });
  liveEngine = createLiveWorkflowEngine({ directory: app.getPath('userData'), credentials, artifactStore, modelRuntime, fxRates, readBeadDocument: projectId => beadStore.read({ projectId }), readAnimationDocument: projectId => animationStore.read({ projectId }), localAnimationStep: async input => animationService.executeWorkflowStep(input), localAnimationStatus: () => animationService.status(), assertProjectAdmission: async projectId => { await workspaceStorage.assertNotPurged(projectId); if (relocatingProjects.has(projectId)) throw Error('项目目录正在处理，未开始请求。'); } });
  const documentArtifactPreview = createDocumentArtifactPreview({ liveEngine, editorStore, spreadsheetStore });
  automaticBilling = createAutomaticBilling({ needsRecalculation: async () => !runtimeClosing && pendingBilling([...(await liveEngine.snapshot(undefined, { summaryOnly: true })).ledger, ...await chatService.ledger()]), recalculate: async options => { await liveEngine.recalculateCosts(options); await chatService.recalculateCosts(options); } });
  automaticBilling.start();
  const backupManager = createProjectBackup({ directory: app.getPath('userData'), workspaceStorage, artifactStore, liveEngine, batchProduction: () => batches, automationProvider: () => automationCenter, receiptProvider: () => modelRuntime, chatProvider: () => chatService });
  const deliveries = createDeliveryStore({ directory: app.getPath('userData'), workspaceStorage, artifactStore, liveEngine, editorStore, spreadsheetStore, readBeadDocument: projectId => beadStore.read({ projectId }), readAnimationDocument: projectId => animationStore.read({ projectId }), inspectImage: async buffer => {
    const special = require('./image-output-formats.cjs').imageType(buffer); if (['svg', 'gif'].includes(special.extension)) return { ...require('./image-output-formats.cjs').rasterDimensions(buffer), transparency: 'unknown' };
    const image = nativeImage.createFromBuffer(buffer); if (image.isEmpty()) throw new Error('实际图像无法解码，请检查源文件。');
    const { width, height } = image.getSize();
    if (width * height > 16777216) return { width, height, transparency: 'unknown' };
    return cpuTasks.run('image-alpha', { width, height, bitmap: image.toBitmap() });
  } });
  const batches = createBatchProduction({ directory: app.getPath('userData'), workspaceStorage, artifactStore, liveEngine, withProjectWrite: (id, action) => withProjectWrite(id, action), assertAdmission: async project => { await workspaceStorage.assertNotPurged(project.id); if (runtimeClosing || relocatingProjects.has(project.id)) throw new Error('目录或应用正在退出处理，请稍后显式继续队列。'); } });
  const movingArtifacts = new Map();
  const relocatingProjects = new Set();
  const relocatingWorkspaces = new Set(), businessWorkspaceWrites = new Map();
  const writingProjects = new Map();
  const withProjectWrite = async (id, action) => {
    await workspaceStorage.assertNotPurged(id);
    const location = (await workspaceStorage.list()).projects.find(project => project.projectId === id);
    if (!id || relocatingProjects.has(id) || location && relocatingWorkspaces.has(location.workspaceId)) throw new Error('项目目录正在处理，请稍后再试。');
    writingProjects.set(id, (writingProjects.get(id) || 0) + 1);
    try { const result = await action(); try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('runtime:project-files-changed', { projectId: id }); } catch { /* A window closing after a successful write must not turn it into a failed write. */ } return result; } finally { const count = writingProjects.get(id) - 1; if (count) writingProjects.set(id, count); else writingProjects.delete(id); }
  };
  const notifyBusiness = value => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('business:changed', value); } catch { /* Saved data is independent of the renderer. */ } };
  const businessData = require('./business-data.cjs').createBusinessData({ workspaceStorage, artifactStore, dialog, getWindow: () => mainWindow, getLedger: async () => (await liveEngine.snapshot(undefined, { summaryOnly: true })).ledger, onChanged: notifyBusiness });
  const commerceImages = require('./commerce-images.cjs').createCommerceImages({ workspaceStorage, artifactStore, nativeImage, cpuTasks, BrowserWindow, dialog, getWindow: () => mainWindow, onChanged: projectId => { try { mainWindow?.webContents.send('runtime:project-files-changed', { projectId }); } catch { /* The saved file remains available. */ } }, onExport: async input => { const location = await editorProject(input.projectId); return liveEngine.recordLocalExport({ projectId: input.projectId, workspaceId: location.workspaceId, name: input.document.title, kind: 'image', artifacts: input.artifacts, commerceExport: input.commerceExport }); } });
  const getBusinessContext = async input => { if (relocatingWorkspaces.has(input?.workspaceId) || relocatingProjects.has(input?.projectId)) throw Error('工作区目录正在处理，请稍后继续。'); return { ...await automationCenter.getPlanningContext(input), credentials: await credentials.list() }; };
  const businessOptions = { businessStore: businessData.store, workspaceStorage, artifactStore, liveEngine, commerceImages, editorStore, spreadsheetStore, getContext: getBusinessContext, assertAdmission: async project => { const id = typeof project === 'string' ? project : project?.id; if (runtimeClosing || relocatingProjects.has(id)) throw Error('项目目录正在处理，请稍后继续。'); await workspaceStorage.assertNotPurged(id); }, start: input => withProjectWrite(input.project.id, () => liveEngine.start(input)) };
  const businessProduction = require('./business-production.cjs').createBusinessProduction(businessOptions);
  const businessAssist = require('./business-assist.cjs').createBusinessAssist(businessOptions);
  const businessListing = require('./business-listing.cjs').createBusinessListing({ ...businessOptions, cpuTasks });
  const isBusinessWorkspaceBusy = workspaceId => businessWorkspaceWrites.has(workspaceId) || businessProduction.isWorkspaceBusy(workspaceId) || Boolean(beadMarket?.isWorkspaceBusy(workspaceId)) || Boolean(animationService?.isWorkspaceBusy(workspaceId));
  const isBusinessProjectBusy = id => businessProduction.isProjectBusy(id) || businessAssist.isProjectBusy(id) || Boolean(beadMarket?.isProjectBusy(id)) || Boolean(animationService?.isProjectBusy(id));
  const withBusinessWrite = async (workspaceId, action) => {
    if (typeof workspaceId !== 'string' || relocatingWorkspaces.has(workspaceId)) throw Error('工作区目录正在处理，请稍后再保存或制作。');
    businessWorkspaceWrites.set(workspaceId, (businessWorkspaceWrites.get(workspaceId) || 0) + 1);
    try { return await action(); } finally { const count = businessWorkspaceWrites.get(workspaceId) - 1; if (count) businessWorkspaceWrites.set(workspaceId, count); else businessWorkspaceWrites.delete(workspaceId); }
  };
  const withWorkspaceDirectory = async (workspaceId, action) => {
    if (typeof workspaceId !== 'string' || relocatingWorkspaces.has(workspaceId) || isBusinessWorkspaceBusy(workspaceId)) throw Error('工作区仍有制作或文件操作，请结束后再处理目录。');
    relocatingWorkspaces.add(workspaceId); try { return await action(); } finally { relocatingWorkspaces.delete(workspaceId); }
  };
  const assertFilesReady = input => { const error = artifactRequestError(input, [...movingArtifacts.values()]); if (error) throw new Error(error); };
  const assertProjectReady = async input => {
    assertFilesReady(input);
    if (!input?.project?.id || relocatingProjects.has(input.project.id)) throw new Error('项目目录正在处理，请稍后再试。');
    await workspaceStorage.assertProject(input.project.id, input.project.workspaceId);
  };
  const quoteExporter = createCustomerQuoteExporter({ BrowserWindow, artifactStore, workspaceStorage });
  const beadPrinter = require('./bead-pdf-printer.cjs').createBeadPdfPrinter({ BrowserWindow });
  const beads = require('./bead-service.cjs').createBeadService({ workspaceStorage, artifactStore, nativeImage, cpuTasks, dialog, store: beadStore, getWindow: () => mainWindow, printPdf: (input, options) => beadPrinter.print(input, options), onChanged: projectId => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:project-files-changed', { projectId }); } catch { /* Completed files remain available if the renderer is closing. */ } }, onExport: async input => { const location = await editorProject(input.projectId); return liveEngine.recordLocalExport({ projectId: input.projectId, workspaceId: location.workspaceId, name: input.document.title, kind: 'image', artifacts: input.artifacts, beadExport: input.beadExport }); } });
  const marketSources = require('./bead-market-sources.cjs').createBeadMarketSources({ session });
  const recordPlatformStatus = async result => { if (result.status === 'needs-login') await marketSessions?.markNeedsLogin(result.platform, result.capturedAt).catch(() => undefined); return result; };
  const sources = { ...marketSources, search: input => marketSources.search(input).then(recordPlatformStatus), details: input => marketSources.details(input).then(recordPlatformStatus) };
  beadMarket = require('./bead-market.cjs').createBeadMarket({ ...businessOptions, sources, readDocument: projectId => beadStore.read({ projectId }), dialog, session, getWindow: () => mainWindow, onChanged: value => { try { mainWindow?.webContents.send('bead-market:changed', value); } catch { /* Saved quotes outlive their renderer. */ } } });
  const marketBrowser = require('./bead-market-browser.cjs').createBeadMarketBrowser({ app, BrowserWindow, WebContentsView, ipcMain, session, getWindow: () => mainWindow, onCapture: input => beadMarket.acceptCapture(input), onLoginConfirmed: input => marketSessions.confirmLogin(input), appearance: () => ({ dark: (studioDialogs.getAppearance?.()?.mode || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')) === 'dark' }) });
  marketSessions = require('./bead-market-sessions.cjs').createBeadMarketSessions({ directory: app.getPath('userData'), browser: marketBrowser, onChanged: () => { try { mainWindow?.webContents.send('bead-market:sessions-changed'); } catch { /* Session metadata survives a closed renderer. */ } } });
  beadMarket.setBrowser(marketBrowser);
  const animationTool = require('./animation-tool.cjs').createAnimationTool({ directory: app.getPath('userData'), ...(app.isPackaged ? { executablePath: path.join(process.resourcesPath, 'animation-tool', 'xuzuo-animation.exe') } : { developmentPython: process.env.XUZUO_ANIMATION_PYTHON || 'python' }) });
  animationService = require('./animation-service.cjs').createAnimationService({ ...businessOptions, directory: app.getPath('userData'), store: animationStore, tool: animationTool, onChanged: value => { try { mainWindow?.webContents.send('animation:changed', value); } catch { /* The renderer may already be closed. */ } }, onExport: async input => { const location = await editorProject(input.projectId); await liveEngine.recordLocalExport({ ...input, workspaceId: location.workspaceId, name: input.document.title, kind: 'image' }); try { mainWindow?.webContents.send('runtime:project-files-changed', { projectId: input.projectId }); } catch { /* Completed artifacts remain registered. */ } } });
  const exportWallpaper4K = require('./local-wallpaper-export.cjs').createLocalWallpaperExporter({ artifactStore, fitWallpaper: (input, options) => cpuTasks.run('wallpaper', input, options), onExport: async input => { const location = await editorProject(input.projectId); return liveEngine.recordLocalExport({ projectId: input.projectId, workspaceId: location.workspaceId, name: input.artifact.name, kind: 'image', artifacts: [input.artifact], wallpaperExport: { sourceArtifactId: input.sourceArtifactId, sourceSha256: input.sourceSha256, target: input.target } }); } });
  automationCenter = createAutomationCenter({ directory: app.getPath('userData'), liveEngine, onChanged: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('automation:changed'); }, assertAdmission: async project => !runtimeClosing && !relocatingProjects.has(project.id) && !writingProjects.has(project.id), start: input => withProjectWrite(input.project.id, async () => { await assertProjectReady(input); return liveEngine.start(input); }), control: async input => {
    if (!['resume', 'continue', 'retry'].includes(input.action)) return liveEngine.control(input);
    if (!input.project) throw new Error('请先恢复任务所属项目。');
    return withProjectWrite(input.project.id, async () => { await assertProjectReady(input); return liveEngine.control(input); });
  } });
  projectPurge = createProjectPurge({ directory: app.getPath('userData'), workspaceStorage, automationCenter, liveEngine, protectedRoots: [app.getPath('userData'), path.dirname(app.getPath('exe'))], withExclusive: async (id, action) => {
    const location = (await workspaceStorage.list()).projects.find(project => project.projectId === id);
    if (runtimeClosing || relocatingProjects.has(id) || writingProjects.has(id) || isBusinessProjectBusy(id) || location && (relocatingWorkspaces.has(location.workspaceId) || isBusinessWorkspaceBusy(location.workspaceId))) throw Error('项目仍有制作或文件操作，请结束后再永久移除。');
    relocatingProjects.add(id);
    try {
      if (writingProjects.has(id)) throw Error('项目有文件写入尚未结束。');
      const queues = await batches.list();
      if (queues.some(queue => queue.status === 'running' && queue.items.some(item => item.project.id === id && ['queued', 'submitting', 'running'].includes(item.status)))) throw Error('此项目仍在批量队列中，请暂停队列后再永久移除。');
      return await action();
    } finally { relocatingProjects.delete(id); }
  } });
  workspaceStorage.setProjectPurgeGuard({ ready: projectPurge.ready, isPurged: projectPurge.isPurged, audits: projectPurge.audits, blockedPaths: projectPurge.blockedPaths });
  automationCenter.setProjectPurgeGuard(id => projectPurge.isPurged(id) || workspaceStorage.isProjectPurged(id), projectPurge.ready);
  void projectPurge.ready.then(() => automationCenter.start()).catch(() => undefined);
  const automationPlanning = createAutomationPlanning({ directory: app.getPath('userData'), liveEngine, automationCenter, credentials, assertAdmission: project => !runtimeClosing && !relocatingProjects.has(project.id) && !writingProjects.has(project.id), start: input => withProjectWrite(input.project.id, async () => { await assertProjectReady(input); return liveEngine.start(input); }) });
  const handle = (name, action) => ipcMain.handle(`runtime:${name}`, (event, input) => {
    if (!trustedSender(event)) throw new Error('此页面无权执行本机模型任务。');
    const closingMarketRead = ['bead-market-read', 'bead-market-save', 'bead-market-cancel', 'bead-market-sessions'].includes(name);
    const closingAnimationRead = ['animation-read', 'animation-save'].includes(name) || name === 'animation-control' && input?.action === 'cancel';
    const closingBusinessRead = ['business-snapshot', 'business-save', 'business-export-recovery', 'commerce-read', 'commerce-save', 'commerce-history', 'commerce-cancel', 'commerce-exportRecovery'].includes(name) || name === 'business-control' && ['pause', 'cancel'].includes(input?.action);
    if (runtimeClosing && !['chat-read', 'chat-list', 'chat-ledger', 'chat-cancel', 'chat-flush'].includes(name) && !closingAnimationRead && !closingMarketRead && !closingBusinessRead && !['status', 'snapshot', 'poll-snapshot', 'lookup-start', 'run-detail', 'editor-load', 'editor-history', 'editor-loadVersion', 'spreadsheet-load', 'spreadsheet-history', 'spreadsheet-loadVersion', 'bead-read', 'bead-history', 'bead-cancel', 'bead-export-recovery'].includes(name)) throw new Error('应用正在保存并退出，未开始新的操作。');
    const task = Promise.resolve().then(async () => { if (!name.startsWith('chat-') && !['status', 'snapshot', 'poll-snapshot', 'start-checked', 'lookup-start', 'run-detail', 'recalculate-costs', 'bead-export-recovery', 'bead-cancel', 'bead-market-sessions', 'bead-market-login', 'bead-market-confirm-login'].includes(name)) await projectPurge.ready; return ['workspace-choose', 'workspace-repair', 'workspace-reconnect'].includes(name) ? withWorkspaceDirectory(input?.workspaceId, () => action(input)) : action(input); });
    const marketWrite = name.startsWith('bead-market-') && !['bead-market-read', 'bead-market-cancel', 'bead-market-openSource', 'bead-market-sessions'].includes(name) || name.startsWith('animation-') && !['animation-read', 'animation-control'].includes(name);
    const businessWrite = /^(?:business-(?:save|import-commit|export-recovery|prepare|deliver|adopt|listing)|commerce-(?:save|render|applyAlpha|protect|mask|restore|exportRecovery))$/.test(name);
    if (!['status', 'snapshot', 'poll-snapshot', 'lookup-start'].includes(name)) trackRuntimeTask(task, ['chat-start', 'chat-cancel', 'chat-flush'].includes(name) || marketWrite || businessWrite || name.startsWith('automation-planning-') || /^(?:editor|spreadsheet)-(?:save|export|restore)$/.test(name) || /^(?:bead-(?:generate|save|restore|export|import-document|export-recovery)|export-wallpaper-4k)$/.test(name) || ['project-purge-execute', 'customer-quote-export', 'automation-context', 'automation-save-rule', 'automation-enabled', 'automation-trigger', 'automation-cancel-job', 'automation-resolve', 'automation-archive-project', 'automation-restore-project', 'save-image-markup', 'asset-import', 'asset-update', 'asset-attach', 'asset-save', 'workspace-choose', 'workspace-move-project', 'workspace-ensure-project', 'workspace-create-project', 'workspace-reconnect', 'export-draft', 'backup-export', 'backup-import', 'backup-acknowledge', 'workspace-relocate', 'delivery-review', 'delivery-confirm', 'delivery-zip', 'batch-create', 'batch-control'].includes(name), name.startsWith('bead-') || name.startsWith('commerce-') || name === 'business-listing');
    return task;
  });
  const officePreview = registerOfficePreviewHandlers({ handle, dialog, getWindow: () => mainWindow, artifactStore, directory: path.join(app.getPath('userData'), 'office-preview-v1'), withProjectWrite, shell, trackWrite: task => trackRuntimeTask(task, true) });
  drainRuntime = async () => {
    runtimeClosing = true;
    studioDialogs.cancelPickers();
    await chatService.shutdown();
    await animationService.prepareClose();
    await beadMarket.prepareClose();
    await businessProduction.prepareClose();
    await businessAssist.prepareClose();
    await businessListing.prepareClose();
    await commerceImages.prepareClose();
    await beads.prepareClose();
    await beadPrinter.drain();
    await officePreview.shutdown();
    await automaticBilling.stop();
    await commerceImages.shutdown();
    await projectPurge.drain();
    await automationCenter.shutdown();
    await batches.shutdown();
    await liveEngine.shutdown();
    await automationPlanning.shutdown();
    await Promise.allSettled([...runtimeRequests]);
    await Promise.all([editorStore.drain(), spreadsheetStore.drain(), artifactStore.drain(), assets.flush(), assetCategories.flush(), backupManager.flush(), deliveries.drain(), cpuTasks.drain(), thumbnails.drain(), quoteExporter.drain()]);
    await liveEngine.flush();
    await businessData.drain();
    await beadMarket.drain();
    await animationService.drain();
    await marketSessions.drain();
    if (closingWriteFailed) throw new Error('退出期间有本地文件或密钥未能保存。');
  };
  registerProductionHandlers({ handle, dialog, getWindow: () => mainWindow, workspaceStorage, liveEngine, backupManager, deliveries, batches, relocatingProjects, relocatingWorkspaces, writingProjects, withProjectWrite, automationCenter, isWorkspaceBusy: isBusinessWorkspaceBusy, isProjectBusy: isBusinessProjectBusy });
  handle('project-purge-preview', input => projectPurge.preview(input));
  handle('project-purge-execute', input => projectPurge.execute(input));
  handle('project-purge-status', input => projectPurge.status(input));
  handle('project-purge-tombstones', input => projectPurge.tombstones(input));
  registerProjectCreation({ handle, dialog, getWindow: () => mainWindow, workspaceStorage, withProjectWrite, beforeReconnect: async workspaceId => {
    const ids = (await workspaceStorage.list()).projects.filter(item => item.workspaceId === workspaceId).map(item => item.projectId);
    const snapshot = await liveEngine.snapshot(undefined, { summaryOnly: true });
    if (isBusinessWorkspaceBusy(workspaceId) || ids.some(id => writingProjects.has(id) || relocatingProjects.has(id) || isBusinessProjectBusy(id)) || snapshot.runs.some(run => run.workspaceId === workspaceId && run.status === 'running')) throw new Error('请等待本工作区当前请求或文件操作结束，再重新连接目录。');
  } });
  handle('business-snapshot', workspaceId => withBusinessWrite(workspaceId, async () => { await businessAssist.recover(workspaceId); return businessData.snapshot(workspaceId); }));
  for (const [method, name] of Object.entries({ save: 'save', importPreview: 'import-preview', importCommit: 'import-commit', exportRecovery: 'export-recovery' })) handle(`business-${name}`, input => withBusinessWrite(input?.workspaceId, () => businessData[method](input)));
  for (const method of ['prepare', 'start', 'control', 'deliver', 'adopt']) handle(`business-${method}`, input => withBusinessWrite(input?.workspaceId, () => businessProduction[method](input)));
  handle('business-assist', input => withBusinessWrite(input?.workspaceId, () => businessAssist.assist(input)));
  handle('business-listing', input => withBusinessWrite(input?.workspaceId, () => withProjectWrite(input?.projectId, () => businessListing.export(input))));
  for (const method of ['read', 'save', 'render', 'applyAlpha', 'protect', 'mask', 'cancel', 'history', 'restore', 'exportRecovery']) handle(`commerce-${method}`, input => ['read', 'history', 'cancel', 'exportRecovery'].includes(method) ? commerceImages[method](input) : withProjectWrite(input?.projectId, () => commerceImages[method](input)));
  for (const method of ['read', 'save', 'query', 'cancel', 'openSource', 'captureSource', 'importLinks', 'importFile', 'extractImage', 'commitImport', 'export']) handle('bead-market-' + method, input => ['read', 'cancel'].includes(method) ? beadMarket[method](input) : withProjectWrite(input?.projectId, () => beadMarket[method](input)));
  handle('bead-market-sessions', () => marketSessions.sessions());
  handle('bead-market-login', input => { if (runtimeClosing) throw Error('应用正在保存并退出，未打开平台。'); return marketSessions.login(input); });
  handle('bead-market-confirm-login', input => { if (runtimeClosing) throw Error('应用正在保存并退出，未新增登录确认。'); return marketSessions.confirmLogin(input); });
  for (const method of ['read', 'save', 'restore', 'generate', 'refine', 'control', 'compose', 'export', 'importProject']) handle('animation-' + method, input => method === 'read' || method === 'control' && input?.action === 'cancel' ? animationService[method](input) : withProjectWrite(input?.projectId, () => animationService[method](input)));
  handle('asset-builtin-import', input => assets.flush().then(() => builtinAssets.import(input)));
  handle('asset-builtin-attach', input => withProjectWrite(input?.projectId, () => builtinAssets.attach(input)));
  handle('asset-builtin-save', async input => {
    if (input?.format !== undefined && !['png', 'bundle'].includes(input.format)) throw new Error('请选择 PNG 或完整素材包。');
    const bundle = input?.format === 'bundle', file = await builtinAssets[bundle ? 'bundle' : 'read'](input);
    const result = await dialog.showSaveDialog(mainWindow, { title: bundle ? '另存完整素材包（含 SVG 与许可证）' : '另存内置 PNG 素材', defaultPath: file.name, filters: [{ name: bundle ? '完整素材包' : 'PNG 图片', extensions: [bundle ? 'zip' : 'png'] }] });
    return result.canceled || !result.filePath ? { saved: false } : writeDialogFile(result, file.buffer);
  });
  handle('asset-builtin-link', async input => { await shell.openExternal(await builtinAssets.link(input)); });
  handle('asset-categories', input => assetCategories.list(input));
  handle('asset-category-save', input => assetCategories.save(input));
  handle('asset-category-remove', input => assetCategories.remove(input));
  handle('asset-category-assign', input => assetCategories.assign(input));
  handle('asset-list', async input => { const [items, categories] = await Promise.all([assets.list(input), assetCategories.list(input)]); return items.map(item => ({ ...item, ...(categories.assignments[item.id] ? { categoryId: categories.assignments[item.id] } : {}) })); });
  handle('asset-search', input => assets.search(input));
  handle('asset-probe', input => assets.probe(input));
  handle('asset-import', async input => {
    await workspaceStorage.validateWorkspace(input?.workspaceId);
    const result = await dialog.showOpenDialog(mainWindow, { title: '添加到当前工作区素材库', properties: ['openFile', 'multiSelections'], filters: [{ name: '素材文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'pptx', 'xlsx', 'docx', 'txt', 'md', 'json', 'csv', 'tsv', 'mp3', 'wav', 'm4a', 'mp4'] }] });
    return result.canceled ? [] : assets.importPaths({ workspaceId: input.workspaceId, paths: result.filePaths });
  });
  handle('asset-update', input => assets.update(input));
  handle('asset-thumbnail', input => thumbnails.getFrom(() => assets.thumbnailSource(input)));
  handle('asset-attach', input => withProjectWrite(input?.projectId, () => assets.attach(input)));
  handle('asset-preview', async input => {
    const file = await assets.read(input);
    if (['image', 'audio', 'video'].includes(file.kind)) {
      if (file.bytes > 32 * 1024 * 1024) throw new Error('素材超过内嵌预览大小，请另存后查看。');
      if (file.kind === 'image' && nativeImage.createFromBuffer(file.buffer).isEmpty()) throw new Error('素材图片无法解码，请另存检查原文件或重新导入。');
      return { mimeType: file.mimeType, dataUrl: `data:${file.mimeType};base64,${file.buffer.toString('base64')}` };
    }
    if (file.kind === 'office' || file.kind === 'text') return { mimeType: file.mimeType, text: await extractReferenceText(file) };
    return { mimeType: file.mimeType };
  });
  handle('asset-save', async input => {
    const file = await assets.read(input);
    const result = await dialog.showSaveDialog(mainWindow, { title: '另存真实素材文件', defaultPath: file.name, filters: [{ name: '原始文件格式', extensions: [path.extname(file.name).slice(1) || '*'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    return writeDialogFile(result, file.buffer);
  });
  handle('status', () => ({ available: true }));
  for (const method of ['list', 'read', 'start', 'cancel', 'flush', 'ledger']) handle(`chat-${method}`, input => chatService[method](input));
  handle('save-image-markup', input => withProjectWrite(input?.projectId, () => require('./image-markup.cjs').saveImageMarkup(artifactStore, input)));
  const prepareAnimationReference = require('./generated-animation-reference.cjs').createGeneratedAnimationReference({ artifactStore, liveEngine });
  handle('prepare-generated-animation-reference', input => withProjectWrite(input?.projectId, async () => { await editorProject(input?.projectId); if (movingArtifacts.has(input?.sourceArtifactId)) throw Error('这份动画正在移动，请稍后再试。'); return prepareAnimationReference(input); }));
  const prepareSvgReference = require('./svg-reference.cjs').createSvgReference({ artifactStore });
  handle('prepare-svg-reference', input => withProjectWrite(input?.projectId, async () => { await editorProject(input?.projectId); if (movingArtifacts.has(input?.sourceArtifactId)) throw Error('这份SVG正在移动，请稍后再试。'); return prepareSvgReference(input); }));
  handle('customer-quote-export', input => withProjectWrite(input?.projectId, () => quoteExporter.export(input)));
  handle('automation-snapshot', workspaceId => automationCenter.snapshot(workspaceId));
  handle('automation-planning-start', input => automationPlanning.start(input));
  handle('automation-planning-read', input => automationPlanning.read(input));
  handle('automation-planning-list', workspaceId => automationPlanning.list(workspaceId));
  handle('automation-planning-cancel', input => automationPlanning.cancel(input));
  handle('automation-archive-project', input => automationCenter.prepareProjectArchive(input));
  handle('automation-restore-project', input => automationCenter.restoreProjectArchive(input));
  handle('automation-context', context => automationCenter.syncContext(context));
  handle('automation-reload', () => automationCenter.reload());
  handle('automation-save-rule', input => automationCenter.saveRule(input));
  handle('automation-enabled', input => automationCenter.setEnabled(input));
  handle('automation-trigger', input => automationCenter.trigger(input));
  handle('automation-cancel-job', id => automationCenter.cancelJob(id));
  handle('automation-resolve', input => automationCenter.resolve(input));
  handle('preflight', async input => { await assertProjectReady(input); return liveEngine.preflight(input); });
  handle('start', input => withProjectWrite(input?.project?.id, async () => { await assertProjectReady(input); return liveEngine.start(input); }));
  handle('start-checked', input => startChecked(liveEngine, async request => { await projectPurge.ready; return withProjectWrite(request?.project?.id, async () => { await assertProjectReady(request); return liveEngine.start(request); }); }, input));
  handle('lookup-start', input => lookupStart(liveEngine, input));
  handle('snapshot', () => liveEngine.snapshot());
  handle('poll-snapshot', afterRevision => liveEngine.snapshot(afterRevision, { summaryOnly: true, delta: true }));
  handle('run-detail', id => liveEngine.runDetail(id));
  handle('control', async input => {
    if (['resume', 'continue', 'retry'].includes(input?.action)) {
      const run = (await liveEngine.snapshot(undefined, { summaryOnly: true })).runs.find(item => item.id === input.id);
      if (run) return withProjectWrite(run.projectId, async () => {
        await assertProjectReady({ project: { id: run.projectId, workspaceId: input.project?.workspaceId || run.workspaceId }, attachmentIds: [...(run.attachmentIds || []), ...run.attempts.flatMap(attempt => (attempt.artifacts || []).map(artifact => artifact.id))] });
        return liveEngine.control(input);
      });
    }
    return liveEngine.control(input);
  });
  handle('reconcile', async input => (await chatService.ledger()).some(entry => entry.id === input?.entryId) ? chatService.reconcile(input) : liveEngine.reconcile(input));
  handle('recalculate-costs', async () => { const production = await liveEngine.recalculateCosts(); const chat = await chatService.recalculateCosts(); return { updated: (production?.updated || 0) + (chat?.updated || 0) }; });
  handle('manage-run', input => liveEngine.manageRun(input));
  handle('workspace-list', () => workspaceStorage.list());
  handle('workspace-repair', async input => {
    if (!input || typeof input.workspaceId !== 'string') throw new Error('工作区参数无效。');
    const locations = await workspaceStorage.list();
    if (!locations.workspaces.some(item => item.workspaceId === input.workspaceId)) throw new Error('工作区尚未绑定本地文件夹。');
    const ids = locations.projects.filter(item => item.workspaceId === input.workspaceId).map(item => item.projectId);
    const runs = (await liveEngine.snapshot(undefined, { summaryOnly: true })).runs;
    if (runs.some(run => (run.workspaceId === input.workspaceId || ids.includes(run.projectId)) && run.status === 'running') || ids.some(id => writingProjects.has(id) || relocatingProjects.has(id))) throw new Error('请等待当前模型请求、文件写入或目录操作结束，再恢复工作区连接。');
    for (const id of ids) relocatingProjects.add(id);
    try { return await workspaceStorage.repair(input); }
    finally { for (const id of ids) relocatingProjects.delete(id); }
  });
  handle('workspace-choose', async input => {
    if (!input || typeof input.workspaceId !== 'string' || typeof input.name !== 'string' || !Array.isArray(input.projects)) throw new Error('工作区参数无效。');
    const projects = input.projects.filter(project => project.workspaceId === input.workspaceId);
    const ids = new Set(projects.map(project => project.id));
    const runs = (await liveEngine.snapshot(undefined, { summaryOnly: true })).runs;
    if (runs.some(run => ids.has(run.projectId) && run.status === 'running') || [...ids].some(id => relocatingProjects.has(id) || writingProjects.has(id))) throw new Error('请等待项目当前请求结束，再绑定工作区目录。');
    const result = await dialog.showOpenDialog(mainWindow, { title: `为“${input.name}”选择或新建工作区文件夹`, properties: ['openDirectory', 'createDirectory'], buttonLabel: '使用此工作区' });
    if (result.canceled || !result.filePaths[0]) return null;
    // Recheck after the native dialog, because a task may have started meanwhile.
    if ((await liveEngine.snapshot(undefined, { summaryOnly: true })).runs.some(run => ids.has(run.projectId) && run.status === 'running') || [...ids].some(id => writingProjects.has(id) || relocatingProjects.has(id))) throw new Error('项目已开始运行，请完成当前请求后再绑定目录。');
    for (const id of ids) relocatingProjects.add(id);
    try { const location = await workspaceStorage.bindRoot({ ...input, projects, directory: result.filePaths[0] }); await liveEngine.refreshArtifactLocations(); return location; }
    finally { for (const id of ids) relocatingProjects.delete(id); }
  });
  handle('workspace-ensure-project', input => withProjectWrite(input?.projectId, () => workspaceStorage.ensureProject(input)));
  handle('workspace-move-project', async input => {
    const release = await automationCenter.reserveProject(input?.projectId);
    const workspaceLocks = [];
    try {
      const location = (await workspaceStorage.list()).projects.find(project => project.projectId === input?.projectId), workspaces = [...new Set([location?.workspaceId, input?.workspaceId].filter(Boolean))];
      if (relocatingProjects.has(input?.projectId) || writingProjects.has(input?.projectId) || isBusinessProjectBusy(input?.projectId) || workspaces.some(id => relocatingWorkspaces.has(id) || isBusinessWorkspaceBusy(id))) throw new Error('项目仍在制作、写入或移动，请等待当前操作结束。');
      for (const id of workspaces) { relocatingWorkspaces.add(id); workspaceLocks.push(id); }
      if ((await liveEngine.snapshot(undefined, { summaryOnly: true })).runs.some(run => run.projectId === input?.projectId && ['running', 'paused', 'waiting-review'].includes(run.status))) throw new Error('请先完成或取消项目任务，再移动工作区。');
      if (writingProjects.has(input.projectId) || relocatingProjects.has(input.projectId) || isBusinessProjectBusy(input.projectId) || workspaces.some(isBusinessWorkspaceBusy)) throw new Error('项目有本地写入或目录操作尚未完成，请稍后再移动。');
      relocatingProjects.add(input.projectId);
      try { const location = await workspaceStorage.moveProject(input); await liveEngine.refreshArtifactLocations([location]); return location; } finally { relocatingProjects.delete(input.projectId); }
    } finally {
      workspaceLocks.forEach(id => relocatingWorkspaces.delete(id));
      const location = (await workspaceStorage.list().catch(() => undefined))?.projects.find(project => project.projectId === input?.projectId);
      await release(location ? { workspaceId: location.workspaceId } : undefined);
    }
  });
  handle('workspace-open', async input => {
    let directory;
    if (input?.projectId) directory = await workspaceStorage.projectDirectory(input.projectId);
    else {
      const location = (await workspaceStorage.list()).workspaces.find(item => item.workspaceId === input?.workspaceId);
      if (!location) throw new Error('请先绑定工作区文件夹。');
      directory = await workspaceStorage.validateWorkspace(location.workspaceId);
    }
    if (await shell.openPath(directory)) throw new Error('系统无法打开这个文件夹，请检查它是否仍可用。');
  });
  const editorProject = async projectId => {
    const location = (await workspaceStorage.list()).projects.find(item => item.projectId === projectId);
    if (!location || relocatingProjects.has(projectId)) throw new Error('请先为当前工作区绑定文件夹，或等待目录移动完成。');
    await workspaceStorage.assertProject(projectId, location.workspaceId); return location;
  };
  for (const [name, method] of [['source', 'source'], ['read', 'read'], ['history', 'history'], ['restore', 'restore'], ['generate', 'generate'], ['save', 'save'], ['export', 'export'], ['import-palette', 'importPalette'], ['import-document', 'importDocument'], ['cancel', 'cancel'], ['export-recovery', 'exportRecovery']]) handle(`bead-${name}`, input => ['generate', 'save', 'restore', 'export', 'import-document'].includes(name) ? withProjectWrite(input?.projectId, () => beads[method](input)) : beads[method](input));
  handle('export-wallpaper-4k', input => withProjectWrite(input?.projectId, async () => { await editorProject(input?.projectId); return exportWallpaper4K(input); }));
  for (const action of ['load', 'save', 'history', 'loadVersion']) handle(`editor-${action}`, input => { const execute = async () => { await editorProject(input?.projectId); return editorStore[action](input); }; return action === 'save' ? withProjectWrite(input?.projectId, execute) : execute(); });
  handle('editor-restore', input => withProjectWrite(input?.projectId, async () => { await editorProject(input?.projectId); return editorStore.restore(input); }));
  handle('editor-export', input => withProjectWrite(input?.projectId, async () => {
    const location = await editorProject(input?.projectId);
    const result = await editorStore.export(input);
    await liveEngine.recordLocalExport({ projectId: location.projectId, workspaceId: location.workspaceId, name: result.record.document.title, kind: result.record.document.kind, sourceRevision: result.record.revision, artifacts: result.artifacts, sourceArtifactIds: result.record.sourceArtifactIds });
    return result;
  }));
  for (const action of ['load', 'save', 'history', 'loadVersion']) handle(`spreadsheet-${action}`, input => {
    const execute = async () => { await editorProject(input?.projectId); return spreadsheetStore[action](input); };
    return action === 'save' ? withProjectWrite(input?.projectId, execute) : execute();
  });
  handle('spreadsheet-export', input => withProjectWrite(input?.projectId, async () => {
    const location = await editorProject(input?.projectId);
    const result = await spreadsheetStore.export(input);
    await liveEngine.recordLocalExport({ projectId: location.projectId, workspaceId: location.workspaceId, name: result.record.document.title, kind: 'excel', sourceRevision: result.record.revision, artifacts: result.artifacts, sourceArtifactIds: result.record.sourceArtifactIds });
    return result;
  }));
  handle('spreadsheet-restore', input => withProjectWrite(input?.projectId, async () => { await editorProject(input?.projectId); return spreadsheetStore.restore(input); }));
  handle('probe', input => probeConnection(input, credentials, fetchImpl));
  handle('export-draft', input => withProjectWrite(input?.project?.id, async () => {
    if (!input?.project || typeof input.title !== 'string' || typeof input.text !== 'string' || !input.text.trim()) throw new Error('草稿内容为空，请先编辑正文。');
    await assertProjectReady(input);
    const id = `local-export-${Date.now()}`;
    const workflow = { id, workspaceId: input.project.workspaceId, name: `${input.title} · 本地导出`, description: '本地草稿生成文件，不调用模型。', outputKind: input.project.kind, updatedAt: new Date().toISOString(), steps: [{ id: `${id}-file`, name: '生成实际文件', kind: 'export', prompt: '', inputSource: 'project', budgetCents: 0, enabled: true }] };
    const run = await liveEngine.start({ workflow, project: { ...input.project, name: input.title }, connections: [], models: [], input: input.text, variables: {}, attachmentIds: input.attachmentIds || [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const snapshot = await liveEngine.snapshot(undefined, { summaryOnly: true });
      const current = snapshot.runs.find(item => item.id === run.id);
      if (current.status === 'complete') return current.attempts.flatMap(attempt => attempt.artifacts || []);
      if (['failed', 'cancelled', 'interrupted'].includes(current.status)) throw new Error(current.error || '本地文件导出未完成。');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('文件仍在后台处理，可在工作流运行记录中查看，未重复生成。');
  }));
  handle('import-files', projectId => withProjectWrite(projectId, async () => {
    if (!projectId) throw new Error('请先选择导入资料所属的项目。');
    await editorProject(projectId);
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择参考文件或可编辑工程', properties: ['openFile', 'multiSelections'], filters: [{ name: '参考资料、图片、音视频与工程ZIP', extensions: ['txt', 'md', 'json', 'csv', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'm4a', 'mp4', 'zip'] }] });
    if (result.canceled) return [];
    const files = await artifactStore.importPaths(result.filePaths, { projectId });
    const location = (await workspaceStorage.list()).projects.find(project => project.projectId === projectId);
    if (location && files.length) await automationCenter.referenceImported({ projectId, workspaceId: location.workspaceId, files });
    return files;
  }));
  handle('thumbnail-artifact', id => thumbnails.getFrom(() => artifactStore.thumbnailSource(id)));
  handle('inspect-image-artifact', id => artifactStore.inspectImageArtifact(id));
  handle('preview-artifact', async id => { const [artifact] = await artifactStore.list([id]); if (artifact.kind === 'office') { const file = await artifactStore.read(id), structured = await documentArtifactPreview(artifact).catch(() => undefined); return { mimeType: file.mimeType, artifact, ...(structured || { text: await extractReferenceText(file) }), supported: true }; } const preview = await artifactStore.preview(id); return { mimeType: preview.artifact?.mimeType || preview.mimeType, ...preview }; });
  handle('trash-artifact', async id => {
    if (movingArtifacts.has(id)) throw new Error('这个文件正在处理，请稍后再试。');
    const [artifact] = await artifactStore.list([id]);
    movingArtifacts.set(id, artifact);
    try {
      const error = artifactTrashError(artifact, (await liveEngine.snapshot(undefined, { summaryOnly: true })).runs);
      if (error) throw new Error(error);
      const execute = async () => { const metadata = await artifactStore.trash(id); await liveEngine.refreshArtifactLocations(); return metadata; };
      return artifact.projectId ? await withProjectWrite(artifact.projectId, execute) : await execute();
    } finally { movingArtifacts.delete(id); }
  });
  handle('restore-artifact', async id => {
    if (movingArtifacts.has(id)) throw new Error('这个文件正在处理，请稍后再恢复。');
    const artifact = (await artifactStore.listTrash()).find(item => item.id === id);
    const execute = async () => { const metadata = await artifactStore.restore(id); await liveEngine.refreshArtifactLocations(); return metadata; };
    return artifact?.projectId ? withProjectWrite(artifact.projectId, execute) : execute();
  });
  handle('list-trashed-artifacts', () => artifactStore.listTrash());
  handle('list-project-artifacts', projectId => artifactStore.listProject(projectId));
  handle('open-artifact', async id => {
    const [artifact] = await artifactStore.list([id]);
    if (!artifact || !['pptx', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'm4a', 'mp4', 'txt', 'md', 'json', 'csv'].includes(path.extname(artifact.path).slice(1).toLowerCase())) throw new Error('这个文件类型不支持直接打开，请使用另存。');
    const error = await shell.openPath(artifact.path); if (error) throw new Error('系统无法打开文件，请另存后使用相应软件打开。');
  });
  handle('save-artifact', async id => {
    const file = await artifactStore.read(id);
    const result = await dialog.showSaveDialog(mainWindow, { title: '另存工作流产物', defaultPath: file.name, filters: [{ name: '原始文件格式', extensions: [path.extname(file.name).slice(1) || '*'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    return writeDialogFile(result, file.buffer);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    skipTaskbar: Boolean(validationOwner && !visibleValidation),
    frame: false,
    backgroundColor: '#f5f6fa',
    title: '序作工作台',
    icon: path.join(__dirname, '..', 'assets', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !validationOwner,
      additionalArguments: validationRequested ? ['--xuzuo-isolated-validation'] : [],
    },
  });
  applicationExit.install(mainWindow);
  mainWindow.on('query-session-end', () => appUpdater?.sessionEnding());
  mainWindow.on('session-end', () => appUpdater?.sessionEnding());
  studioDialogs.installOwner(mainWindow);
  mainWindow.on('focus', () => { void automaticBilling?.trigger(); });
  mainWindow.on('restore', () => { void automaticBilling?.trigger(); });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== applicationUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => { if (!validationOwner || visibleValidation) mainWindow.show(); });
  if (validationRequested) mainWindow.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle('序作工作台 · 独立测试窗口'); });
  mainWindow.loadURL(applicationUrl);
}
app.whenReady().then(() => {
  if (!ownsInstance) return;
  const credentials = registerCredentials();
  registerRuntime(credentials);
  applicationExit = createApplicationExit({ app, dialog: studioDialogs, ipcMain, getWindow: () => mainWindow, trustedSender, getTaskState: async () => ({ running: (await liveEngine.snapshot(undefined, { summaryOnly: true })).runs.filter(run => run.status === 'running').length + (await chatService.status()).running }), drain: () => drainRuntime(), beforeExit: async () => { try { await appUpdater?.prepareInstall(); } finally { appUpdater?.stop(); } }, validationOwner, visibleValidation, onStatus: state => { if (state.phase === 'cancelled') { runtimeClosing = false; closingWriteFailed = false; chatService?.resume(); } else runtimeClosing = true; } });
  const maintenance = createAppMaintenance({ app, appId: 'local.xuzuo.studio' });
  appUpdater = createAppUpdater({ app, maintenance, fetchImpl: (url, options) => net.fetch(url, options), powerMonitor, platform: validationRequested ? 'validation' : process.platform, onStatus: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:status', state); } });
  const updatesReady = appUpdater.start();
  ipcMain.handle('updates:status', async event => { if (!trustedSender(event)) throw new Error('此页面无权读取更新状态。'); await updatesReady; return appUpdater.status(); });
  ipcMain.handle('updates:set-enabled', async (event, enabled) => {
    if (!trustedSender(event) || runtimeClosing || typeof enabled !== 'boolean') throw new Error('应用正在退出或更新设置无效。');
    await updatesReady;
    if (!trustedSender(event) || runtimeClosing) throw new Error('应用正在退出，未修改自动更新设置。');
    const task = appUpdater.setEnabled(enabled); trackRuntimeTask(task, true); return task;
  });
  ipcMain.handle('maintenance:status', event => { if (!trustedSender(event)) throw new Error('此页面无权读取应用维护状态。'); return maintenance.status(); });
  ipcMain.handle('maintenance:uninstall', event => { if (!trustedSender(event) || runtimeClosing) throw new Error('应用正在退出或当前页面无权启动维护。'); return maintenance.openUninstall(); });
  ipcMain.on('window:minimize', event => { if (trustedSender(event)) mainWindow.minimize(); });
  ipcMain.on('window:maximize', event => { if (trustedSender(event)) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
  ipcMain.on('window:close', event => { if (trustedSender(event)) mainWindow.close(); });
  createWindow();
  if (validationOwner) stopValidationLifecycle = startValidationLifecycle({ ...validationOwner, requestExit: async () => { await drainRuntime(); app.exit(0); }, forceExit: () => app.exit(0) });
  powerMonitor.on('shutdown', () => appUpdater.sessionEnding());
  app.on('quit', () => { appUpdater.stop(); stopValidationLifecycle?.(); studioDialogs?.dispose(); });
});
