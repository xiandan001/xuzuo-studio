const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createBusinessStore } = require('./business-store.cjs');
const { parseBatchImport } = require('./batch-import.cjs');
const { checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const core = require('./business-data.runtime.cjs');
const validKinds = ['products', 'transactions', 'metrics'];
function createBusinessData({ workspaceStorage, artifactStore, dialog, getWindow = () => undefined, getLedger = async () => [], onChanged, fileSystem = fsDefault, loadModule = require, store: providedStore }) {
  const fs = fileSystem, store = providedStore || createBusinessStore({ workspaceStorage, artifactStore, onChanged, fileSystem }), previews = new Map(), tasks = new Set(); let closing = false;
  const track = action => { if (closing) return Promise.reject(Error('业务资料正在保存并退出，请稍后操作。')); const task = Promise.resolve().then(action); tasks.add(task); void task.finally(() => tasks.delete(task)).catch(() => undefined); return task; };
  async function context(input, state) {
    const registry = await workspaceStorage.list();
    if (input.projectId && !registry.projects.some(row => row.projectId === input.projectId && row.workspaceId === input.workspaceId)) throw Error('导入目标项目不属于当前工作区。');
    if (input.orderId && !state.orders.some(row => row.id === input.orderId)) throw Error('导入目标制作单不存在。');
    const projects = registry.projects.filter(row => row.workspaceId === input.workspaceId).map(row => row.projectId);
    return { state, projectId: input.projectId, orderId: input.orderId, artifacts: artifactStore?.backupEntries ? await artifactStore.backupEntries(projects) : [], now: new Date().toISOString(), idFactory: randomUUID };
  }
  async function importPreview(input) {
    if (!input || !validKinds.includes(input.kind)) throw Error('请选择商品、实收流水或平台数据表。');
    const state = await store.snapshot(input.workspaceId);
    const selected = await dialog.showOpenDialog(getWindow(), { title: '导入业务表格', properties: ['openFile'], filters: [{ name: 'CSV UTF-8或Excel表格', extensions: ['csv', 'xlsx'] }] });
    if (selected.canceled || !selected.filePaths?.length) return undefined;
    const filename = selected.filePaths[0]; if (!path.isAbsolute(filename)) throw Error('请选择本机表格。');
    const before = await checkedFile(fs, filename); if (before.size > 8 * 1024 * 1024) throw Error('业务表格最多8MB、500行。');
    const buffer = await fs.readFile(filename), after = await checkedFile(fs, filename);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || buffer.length !== before.size) throw Error('读取期间表格已变化，请重新选择。');
    const table = await parseBatchImport({ name: filename, buffer }, loadModule);
    const rowContext = await context(input, state), normalized = core.normalizeBusinessRows(input.kind, table.rows, rowContext), token = randomUUID(), now = Date.now();
    for (const [id, preview] of previews) if (preview.expires < now) previews.delete(id);
    if (previews.size >= 8) previews.delete(previews.keys().next().value);
    previews.set(token, { workspaceId: input.workspaceId, kind: input.kind, rows: table.rows, projectId: input.projectId, orderId: input.orderId, expires: now + 15 * 60 * 1000 });
    return { token, kind: input.kind, columns: table.columns, rows: table.rows, issues: normalized.issues, duplicates: normalized.duplicates, conflicts: normalized.conflicts, warnings: table.warnings || [] };
  }
  async function importCommit(input) {
    const preview = previews.get(input?.token);
    if (!preview || preview.expires < Date.now() || preview.workspaceId !== input.workspaceId || input.orderId !== undefined && input.orderId !== preview.orderId || input.projectId !== undefined && input.projectId !== preview.projectId) throw Error('导入预览已过期或不属于当前工作区，请重新选择表格。');
    const state = await store.snapshot(input.workspaceId);
    if (state.revision !== input.expectedRevision) throw Object.assign(Error('业务资料已变化，请重新预览后导入。'), { code: 'BUSINESS_CONFLICT' });
    const rowContext = await context(preview, state), normalized = core.normalizeBusinessRows(preview.kind, preview.rows, rowContext);
    if (normalized.issues.length || normalized.conflicts.length) throw Error([...normalized.issues, ...normalized.conflicts].join('；'));
    const next = { ...state, [preview.kind]: [...state[preview.kind], ...normalized.records] };
    let linked = false;
    if (preview.kind === 'products' && preview.orderId) next.orders = state.orders.map(order => {
      if (order.id !== preview.orderId) return order;
      const productIds = [...new Set([...order.productIds, ...normalized.matchedIds])]; linked = productIds.length !== order.productIds.length;
      return { ...order, productIds };
    });
    const result = normalized.records.length || linked ? await store.save({ workspaceId: input.workspaceId, expectedRevision: input.expectedRevision, state: next }) : state;
    previews.delete(input.token); return result;
  }
  async function exportRecovery(input) {
    const state = core.checkedBusinessState(input.state || await store.snapshot(input.workspaceId), input.workspaceId), stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const picked = await dialog.showSaveDialog(getWindow(), { title: '导出业务资料恢复文件', defaultPath: '业务资料恢复-' + stamp + '.json', filters: [{ name: '业务资料JSON', extensions: ['json'] }] });
    if (picked.canceled || !picked.filePath) return { saved: false };
    let filename = path.resolve(picked.filePath); if (!path.extname(filename)) filename += '.json';
    if (!path.isAbsolute(picked.filePath) || path.extname(filename).toLowerCase() !== '.json' || filename.split(/[\\/]/).some(part => ['.xuzuo', '.xuzuo-business', '.xuzuo-assets'].includes(part.toLowerCase()))) throw Error('请使用普通JSON文件名，不能覆盖内部业务状态。');
    await checkedDirectory(fs, path.dirname(filename));
    const bytes = Buffer.from(JSON.stringify(state, null, 2) + '\n'); let handle;
    try { handle = await fs.open(filename, 'wx'); } catch (cause) { throw Error(cause.code === 'EEXIST' ? '恢复文件已存在，请换一个文件名；原文件未覆盖。' : '恢复位置无法写入，请选择其他可用目录。'); }
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    const written = await fs.readFile(filename), hash = value => createHash('sha256').update(value).digest('hex');
    if (written.length !== bytes.length || hash(written) !== hash(bytes)) throw Error('恢复文件未完整写入，请换其他目录重新导出；内存资料仍保留。');
    return { saved: true, path: filename };
  }
  return {
    snapshot: workspaceId => track(() => store.snapshot(workspaceId)),
    save: input => track(() => store.save(input)),
    mutate: (workspaceId, transform) => track(() => store.mutate(workspaceId, transform)),
    importPreview: input => track(() => importPreview(input)),
    importCommit: input => track(() => importCommit(input)),
    exportRecovery: input => track(() => exportRecovery(input)),
    economics: input => track(async () => core.businessEconomics(await store.snapshot(input.workspaceId), input.orderId, await getLedger(input.workspaceId))),
    async drain() { await Promise.allSettled([...tasks]); await store.drain(); },
    async shutdown() { closing = true; await Promise.allSettled([...tasks]); await store.drain(); previews.clear(); },
    store,
  };
}
module.exports = { createBusinessData };
