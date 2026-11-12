import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), root = path.resolve('.');
function wiredRuntime() {
  const handlers = new Map(), captures = {}, busy = new Set(), events = [], locations = { workspaces: [{ workspaceId: 'workspace', directory: 'C:\\isolated-workspace' }], projects: [{ projectId: 'project', workspaceId: 'workspace', directory: 'C:\\isolated-workspace\\project', name: '真实接线项目' }] };
  const services = new Map(), pending = () => Promise.resolve(), generic = name => {
    if (services.has(name)) return services.get(name);
    const value = new Proxy({ ready: Promise.resolve(), drain: pending, flush: pending, shutdown: async () => { events.push(name + ':shutdown'); }, prepareClose: async () => { events.push(name + ':prepareClose'); } }, { get: (target, key) => key in target ? target[key] : typeof key === 'symbol' || key === 'then' ? undefined : () => Promise.resolve() }); services.set(name, value); return value;
  };
  const storage = generic('workspace-storage'); storage.list = async () => structuredClone(locations); storage.assertNotPurged = vi.fn(async id => { if (typeof id !== 'string' || !id) throw Error('project id missing'); }); storage.assertProject = vi.fn(async () => {}); storage.repair = vi.fn(async () => 'repaired'); storage.reconnectRoot = vi.fn(async () => 'reconnected'); storage.bindRoot = vi.fn(async () => 'bound'); storage.moveProject = vi.fn(async () => locations.projects[0]);
  const live = generic('live-workflow-engine'); live.snapshot = async () => ({ runs: [], ledger: [] }); live.recordLocalExport = vi.fn(async input => input);
  const data = generic('business-data'); data.store = {}; data.snapshot = vi.fn(async () => ({ revision: 1 })); data.save = vi.fn(async input => input);
  const production = generic('business-production'); production.isProjectBusy = id => busy.has(id); production.isWorkspaceBusy = id => id === 'workspace' && busy.size > 0; production.prepare = production.start = production.control = production.deliver = production.adopt = vi.fn(async () => ({ state: {}, projects: [] }));
  const assist = generic('business-assist'); assist.isProjectBusy = () => false; assist.recover = pending; assist.assist = vi.fn(async () => ({ text: 'reply' }));
  const listing = generic('business-listing'); listing.export = vi.fn(async () => ({ artifacts: [] }));
  const commerce = generic('commerce-images'); commerce.save = vi.fn(async () => 'saved');
  const marketBusy = new Set(), market = generic('bead-market'); market.isProjectBusy = id => marketBusy.has(id); market.isWorkspaceBusy = id => id === 'workspace' && marketBusy.size > 0; market.read = vi.fn(async input => ({ state: { projectId: input.projectId } })); market.save = vi.fn(async input => input); market.query = vi.fn(async () => ({ jobId: 'query' })); market.cancel = vi.fn(pending);
  const animation = generic('animation-service'); animation.isProjectBusy = () => false; animation.isWorkspaceBusy = () => false;
  const marketSessions = generic('bead-market-sessions'); marketSessions.sessions = vi.fn(async () => [{ platform: 'taobao', status: 'not-opened' }]); marketSessions.login = vi.fn(async () => ({ opened: true })); marketSessions.confirmLogin = vi.fn(async () => [{ platform: 'taobao', status: 'confirmed' }]); marketSessions.markNeedsLogin = vi.fn(pending);
  const marketSources = generic('bead-market-sources'); marketSources.search = vi.fn(async () => ({ platform: 'taobao', status: 'needs-login', capturedAt: '2026-11-08T00:00:00.000Z', offers: [] }));
  const automation = generic('automation-center'); automation.getPlanningContext = vi.fn(async () => ({ project: { id: 'project', workspaceId: 'workspace', kind: 'image' }, models: ['model-meta'], connections: ['connection-meta'] })); automation.reserveProject = vi.fn(async () => pending);
  const batches = generic('batch-production'); batches.list = async () => [];
  const backup = generic('project-backup'); backup.exportBackup = vi.fn(async () => ({ files: 1 }));
  const dialog = generic('custom-dialogs'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: 'C:\\outside\\backup.zip' }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['C:\\isolated-workspace'] });
  const electron = { app: { isPackaged: false, getPath: () => 'C:\\isolated-profile', requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }) }, ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} }, nativeTheme: { shouldUseDarkColors: true } };
  const customRequire = name => {
    if (name === 'electron') return electron;
    if (name.startsWith('node:')) return require(name);
    if (name === './production-handlers.cjs' || name === './project-creation.cjs') return require(path.join(root, 'electron', name));
    if (name === './credential-store.cjs') return { isTrustedCredentialSender: () => true, createCredentialStore: () => ({ list: async () => ['key-meta'] }) };
    if (name === './validation-lifecycle.cjs') return { readValidationOwner: () => null, startValidationLifecycle: () => () => {} };
    const short = path.basename(name, '.cjs'); return new Proxy({}, { get: (_target, method) => { if (typeof method === 'string' && (method.startsWith('create') || method === 'registerOfficePreviewHandlers')) return options => { captures[short] = options; return generic(short); }; return () => undefined; } });
  };
  const context = vm.createContext({ require: customRequire, __dirname: path.join(root, 'electron'), process: { env: {}, argv: [] }, Buffer, Promise, Set, Map, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8') + '\n;globalThis.testRuntime={registerRuntime,setClosing:value=>{runtimeClosing=value;},drain:()=>drainRuntime(),writeFailed:()=>closingWriteFailed};', context);
  context.testRuntime.registerRuntime({ list: async () => ['key-meta'] });
  const invoke = (name, input) => Promise.resolve().then(() => handlers.get('runtime:' + name)({}, input));
  return { invoke, context, captures, busy, events, data, production, assist, listing, commerce, live, storage, automation, backup, dialog, market, marketBusy, marketSessions, services };
}
describe('真实main注册的业务IPC与生命周期接线（无Electron进程）', () => {
  it('提前登录不依赖项目，查询受限更新登录状态，退出只允许读取而不追加确认', async () => {
    const f = wiredRuntime(); await expect(f.invoke('bead-market-sessions')).resolves.toEqual([{ platform: 'taobao', status: 'not-opened' }]); await expect(f.invoke('bead-market-login', { platform: 'taobao' })).resolves.toEqual({ opened: true }); expect(f.storage.assertNotPurged).not.toHaveBeenCalled();
    await f.captures['bead-market'].sources.search({ platform: 'taobao' }); expect(f.marketSessions.markNeedsLogin).toHaveBeenCalledWith('taobao', '2026-11-08T00:00:00.000Z'); await f.captures['bead-market-browser'].onLoginConfirmed({ platform: 'taobao' }); expect(f.marketSessions.confirmLogin).toHaveBeenCalledWith({ platform: 'taobao' });
    f.context.testRuntime.setClosing(true); await expect(f.invoke('bead-market-sessions')).resolves.toBeTruthy(); await expect(f.invoke('bead-market-confirm-login', { platform: 'taobao' })).rejects.toThrow('退出'); await expect(f.invoke('bead-market-login', { platform: 'taobao' })).rejects.toThrow('退出'); await f.context.testRuntime.drain();
  });
  it('拼豆比价IPC使用原项目写保护和Key元数据，退出时保存取消可用且不能新查询', async () => {
    const f = wiredRuntime(); await expect(f.invoke('bead-market-query', { projectId: 'project' })).resolves.toEqual({ jobId: 'query' }); expect(f.storage.assertNotPurged).toHaveBeenCalledWith('project'); expect(f.market.query).toHaveBeenCalledOnce();
    expect(await f.captures['bead-market'].getContext({ workspaceId: 'workspace', projectId: 'project' })).toMatchObject({ credentials: ['key-meta'], project: { id: 'project' } });
    f.context.testRuntime.setClosing(true); await expect(f.invoke('bead-market-read', { projectId: 'project' })).resolves.toEqual({ state: { projectId: 'project' } }); await expect(f.invoke('bead-market-save', { projectId: 'project' })).resolves.toBeTruthy(); await expect(f.invoke('bead-market-cancel', { projectId: 'project' })).resolves.toBeUndefined(); await expect(f.invoke('bead-market-query', { projectId: 'project' })).rejects.toThrow('退出');
  });
  it('平台窗口/报价后台任务参与项目目录互斥，原生退出先终止比价再关模型引擎', async () => {
    const f = wiredRuntime(); f.marketBusy.add('project'); await expect(f.captures['project-purge'].withExclusive('project', async () => 'unsafe')).rejects.toThrow(); await expect(f.invoke('workspace-reconnect', { workspaceId: 'workspace' })).rejects.toThrow(); f.marketBusy.clear(); await f.context.testRuntime.drain(); expect(f.events.indexOf('bead-market:prepareClose')).toBeLessThan(f.events.indexOf('live-workflow-engine:shutdown'));
  });
  it('模型上下文提供project/models/connections和Key元数据，准入接受项目ID并校验归属', async () => {
    const f = wiredRuntime(), options = f.captures['business-assist']; expect(await options.getContext({ workspaceId: 'workspace', projectId: 'project' })).toMatchObject({ project: { id: 'project' }, models: ['model-meta'], connections: ['connection-meta'], credentials: ['key-meta'] }); await options.assertAdmission('project'); expect(f.storage.assertNotPurged).toHaveBeenCalledWith('project');
  });
  it('本地compose未显示live running时备份、搬移、重连和永久移除仍被阻断', async () => {
    const f = wiredRuntime(); f.busy.add('project');
    for (const [name, input] of [['backup-export', { workspaceIds: ['workspace'] }], ['workspace-relocate', { workspaceId: 'workspace', mode: 'copy' }], ['workspace-reconnect', { workspaceId: 'workspace' }], ['workspace-repair', { workspaceId: 'workspace' }], ['workspace-choose', { workspaceId: 'workspace', name: '工作区', projects: [] }], ['workspace-move-project', { projectId: 'project', workspaceId: 'workspace' }]]) await expect(f.invoke(name, input)).rejects.toThrow();
    await expect(f.captures['project-purge'].withExclusive('project', async () => 'purged')).rejects.toThrow('仍有制作'); expect(f.backup.exportBackup).not.toHaveBeenCalled();
  });
  it('上架本地阶段全程持有项目/工作区写保护，结束后解除', async () => {
    const f = wiredRuntime(); let release; f.listing.export = vi.fn(() => new Promise(resolve => { release = resolve; })); const task = f.invoke('business-listing', { workspaceId: 'workspace', projectId: 'project' });
    try { while (!release) await new Promise(resolve => setTimeout(resolve, 0)); await expect(f.invoke('workspace-relocate', { workspaceId: 'workspace', mode: 'copy' })).rejects.toThrow(); await expect(f.captures['project-purge'].withExclusive('project', async () => 'purged')).rejects.toThrow(); } finally { release({ artifacts: [] }); await task; }
    await expect(f.invoke('workspace-repair', { workspaceId: 'workspace' })).resolves.toBe('repaired');
  });
  it('目录操作取得锁后拒绝新的业务保存，实际结束才解锁', async () => {
    const f = wiredRuntime(); let release; f.backup.exportBackup = vi.fn(() => new Promise(resolve => { release = resolve; })); const task = f.invoke('backup-export', { workspaceIds: ['workspace'] });
    try { while (!release) await new Promise(resolve => setTimeout(resolve, 0)); await expect(f.invoke('business-save', { workspaceId: 'workspace' })).rejects.toThrow('目录正在处理'); await expect(f.captures['business-production'].getContext({ workspaceId: 'workspace', projectId: 'project' })).rejects.toThrow('目录正在处理'); } finally { release({ files: 1 }); await task; }
    await expect(f.invoke('business-save', { workspaceId: 'workspace' })).resolves.toMatchObject({ workspaceId: 'workspace' });
  });
  it('退出检查阶段仍可保存/读取/恢复，但不能启动新的付费制作，失败保存会阻止静默退出', async () => {
    const f = wiredRuntime(); f.context.testRuntime.setClosing(true); await expect(f.invoke('business-save', { workspaceId: 'workspace' })).resolves.toBeTruthy(); await expect(f.invoke('business-snapshot', 'workspace')).resolves.toEqual({ revision: 1 }); await expect(f.invoke('commerce-save', { projectId: 'project' })).resolves.toBe('saved');
    await expect(f.invoke('business-start', { workspaceId: 'workspace' })).rejects.toThrow('正在保存并退出'); await expect(f.invoke('business-control', { workspaceId: 'workspace', action: 'continue' })).rejects.toThrow();
    f.data.save = async () => { throw Error('controlled disk error'); }; await expect(f.invoke('business-save', { workspaceId: 'workspace' })).rejects.toThrow('disk'); await new Promise(resolve => setTimeout(resolve, 0)); expect(f.context.testRuntime.writeFailed()).toBe(true);
  });
  it('commerce导出透传真实proof与所属工作区，退出顺序先排空生产再关闭隐藏渲染器', async () => {
    const f = wiredRuntime(), proof = { documentSha256: 'a'.repeat(64), originalSourceArtifactId: 'real-source' }, artifacts = [{ id: 'real-output' }]; await f.captures['commerce-images'].onExport({ projectId: 'project', document: { title: '正式产物' }, artifacts, commerceExport: proof }); expect(f.live.recordLocalExport).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', projectId: 'project', artifacts, commerceExport: proof }));
    await f.context.testRuntime.drain(); expect(f.events.indexOf('business-production:prepareClose')).toBeLessThan(f.events.indexOf('commerce-images:shutdown')); expect(f.events.indexOf('commerce-images:shutdown')).toBeLessThan(f.events.indexOf('live-workflow-engine:shutdown'));
  });
  it('新增识读、对账单、预检和聊天导出接入实际main注册器', async () => {
    const f = wiredRuntime(), intake = f.services.get('business-intake'), statements = f.services.get('business-statements'), preflight = f.services.get('delivery-preflight'), chat = f.services.get('chat-service');
    intake.intakeRead = vi.fn(async input => ({ intakeId: 'draft', workspaceId: input.workspaceId }));
    statements.exportStatement = vi.fn(async () => ({ saved: true })); preflight.preflight = vi.fn(async () => ({ version: 1 })); chat.linkExport = vi.fn(async () => ({ exports: [] }));
    await expect(f.invoke('business-intakeRead', { workspaceId: 'workspace', orderId: 'order' })).resolves.toMatchObject({ intakeId: 'draft' });
    await expect(f.invoke('business-exportStatement', { workspaceId: 'workspace', orderId: 'order' })).resolves.toEqual({ saved: true });
    await expect(f.invoke('delivery-preflight', { projectId: 'project', artifactIds: ['file'] })).resolves.toEqual({ version: 1 });
    await expect(f.invoke('chat-linkExport', { workspaceId: 'workspace', conversationId: 'conversation', runId: 'run' })).resolves.toEqual({ exports: [] });
    expect(f.captures['business-intake'].businessStore).toBe(f.data.store); expect(f.captures['business-intake'].businessAssist).toBe(f.assist);
    expect(f.captures['business-statements'].businessStore).toBe(f.data.store); expect(f.captures['delivery-preflight'].officePreview()).toBe(f.services.get('office-preview-handlers'));
    f.context.testRuntime.setClosing(true);
    for (const name of ['business-intakeRead', 'business-intakeExtract', 'business-intakeConfirm', 'business-adoptRevision', 'business-exportStatement', 'delivery-preflight', 'chat-linkExport']) await expect(f.invoke(name, { workspaceId: 'workspace' })).rejects.toThrow('退出');
  });
  it('退出主动取消在途需求识读不是本地保存失败，排空后可退出', async () => {
    const f = wiredRuntime(), intake = f.services.get('business-intake'); let rejectRequest;
    intake.intakeExtract = vi.fn(() => new Promise((_, reject) => { rejectRequest = reject; }));
    const request = f.invoke('business-intakeExtract', { workspaceId: 'workspace', orderId: 'order', intakeId: 'draft' }), observed = request.catch(error => error);
    for (let round = 0; !rejectRequest && round < 30; round++) await Promise.resolve(); expect(rejectRequest).toBeTypeOf('function');
    f.assist.prepareClose = async () => { rejectRequest(Object.assign(Error('已因退出取消识读，费用已保留'), { name: 'AbortError', code: 'BUSINESS_ASSIST_CLOSING' })); };
    await expect(f.context.testRuntime.drain()).resolves.toBeUndefined(); expect((await observed).name).toBe('AbortError'); expect(f.context.testRuntime.writeFailed()).toBe(false);
  });
  it('识读候选真实落盘失败仍阻止静默退出，不能借取消豁免吞写入错误', async () => {
    const f = wiredRuntime(), intake = f.services.get('business-intake'); let rejectRequest;
    intake.intakeExtract = vi.fn(() => new Promise((_, reject) => { rejectRequest = reject; }));
    const request = f.invoke('business-intakeExtract', { workspaceId: 'workspace', orderId: 'order', intakeId: 'draft' }), observed = request.catch(error => error);
    for (let round = 0; !rejectRequest && round < 30; round++) await Promise.resolve(); expect(rejectRequest).toBeTypeOf('function');
    f.assist.prepareClose = async () => { rejectRequest(Error('controlled intake draft disk failure')); };
    await expect(f.context.testRuntime.drain()).rejects.toThrow('未能保存'); expect((await observed).message).toContain('disk failure'); expect(f.context.testRuntime.writeFailed()).toBe(true);
  });

});
