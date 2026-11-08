const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const { invalidateBusinessInputs } = require('./business-inputs.cjs');
const core = require('./business-data.runtime.cjs');
const copy = value => structuredClone(value);
const conflict = () => Object.assign(Error('业务资料已在另一处更新，请读取最新资料后重试。'), { code: 'BUSINESS_CONFLICT' });
function businessProjectIds(state) {
  return [...new Set([...state.products.map(row => row.projectId), ...state.brands.map(row => row.projectId), ...state.orders.flatMap(row => [row.sourceProjectId, ...row.projectIds, ...row.tasks.map(task => task.projectId), ...(row.deliveries || []).flatMap(receipt => receipt.files.map(file => file.projectId))]), ...state.feedback.map(row => row.target.projectId)].filter(Boolean))];
}
function businessArtifactIds(state) {
  return [...new Set([...state.products.flatMap(row => row.referenceArtifactIds), ...state.brands.flatMap(row => [row.logoArtifactId, ...row.approvedSampleIds]), ...state.orders.flatMap(row => [...row.outputIds, ...(row.referenceArtifactIds || []), ...row.tasks.flatMap(task => [...task.artifactIds, ...(task.referenceArtifactIds || [])]), ...(row.deliveries || []).flatMap(receipt => receipt.files.map(file => file.artifactId))]), ...state.feedback.map(row => row.target.artifactId), ...state.metrics.flatMap(row => [row.artifactId, row.evidenceArtifactId])].filter(Boolean))];
}
function checkFinancialHistory(before, next) {
  for (const old of before.transactions) {
    const current = next.transactions.find(row => row.id === old.id);
    if (!current) throw Error('实收流水不能删除，请作废原记录后追加更正；API费用保持不变。');
    const signature = row => JSON.stringify(Object.entries(row).filter(([key, value]) => key !== 'voidedAt' && value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
    if (signature(old) !== signature(current) || old.voidedAt && current.voidedAt !== old.voidedAt) throw Error('已记录的实收流水不能改写或恢复，请作废后追加更正。');
  }
  for (const old of before.orders) {
    const current = next.orders.find(row => row.id === old.id);
    if (!current && (old.runIds.length || old.deliveries?.length)) throw Error('有模型费用或交付历史的制作单不能删除，请归档。');
    if (current && old.runIds.some(id => !current.runIds.includes(id))) throw Error('已关联的模型运行和费用不能移除，原费用继续保留。');
    for (const receipt of old.deliveries || []) if (!current?.deliveries?.some(row => row.id === receipt.id && JSON.stringify(row) === JSON.stringify(receipt))) throw Error('历史交付回执不能删除或改写。');
  }
}
function createBusinessStore({ workspaceStorage, artifactStore, onChanged, fileSystem = fsDefault }) {
  const fs = fileSystem, queue = createSerialQueue();
  async function location(workspaceId, create = false) {
    if (!core.businessId(workspaceId)) throw Error('请选择有效工作区。');
    const workspace = await workspaceStorage.validateWorkspace(workspaceId), directory = path.join(workspace, '.xuzuo-business');
    try { await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT' && !create) return { directory, filename: path.join(directory, 'state-v1.json'), absent: true }; if (error.code !== 'ENOENT') throw error; }
    await checkedDirectory(fs, directory, create);
    return { directory, filename: path.join(directory, 'state-v1.json'), absent: false };
  }
  async function read(workspaceId) {
    const place = await location(workspaceId);
    if (place.absent) return { place, raw: undefined, state: core.newBusinessState(workspaceId) };
    let everSaved = false;
    try {
      const markerPath = path.join(place.directory, 'state-marker-v1.json'), marker = await checkedFile(fs, markerPath);
      if (marker.size > 1000) throw Error('业务保存标记无效。');
      const value = JSON.parse(await fs.readFile(markerPath, 'utf8'));
      if (value.version !== 1 || value.workspaceId !== workspaceId) throw Error('业务保存标记不属于当前工作区。');
      everSaved = true;
    } catch (error) { if (error.code !== 'ENOENT') throw Error('业务保存标记无法读取，未创建或覆盖任何资料。', { cause: error }); }
    try {
      const stat = await checkedFile(fs, place.filename);
      if (stat.size > core.BUSINESS_STATE_BYTES) throw Error('业务资料超过8MB。');
      const raw = await fs.readFile(place.filename);
      if (raw.length > core.BUSINESS_STATE_BYTES) throw Error('业务资料超过8MB。');
      const state = core.checkedBusinessState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), workspaceId);
      return { place, raw, state };
    } catch (error) {
      if (error.code === 'ENOENT') {
        const leftovers = (await fs.readdir(place.directory)).some(name => name.startsWith('state-v1.json.') && name.endsWith('.tmp'));
        if (!leftovers && !everSaved) return { place, raw: undefined, state: core.newBusinessState(workspaceId) };
      }
      throw Error('业务资料无法安全读取，原文件保留；请导出当前内存资料或恢复备份，不会创建空表覆盖。', { cause: error });
    }
  }
  async function scope(next, before) {
    if (!workspaceStorage.list) return;
    const registry = await workspaceStorage.list(), projects = registry.projects.filter(row => row.workspaceId === next.workspaceId), known = new Set(projects.map(row => row.projectId));
    const previousProjects = new Set(businessProjectIds(before)), introduced = businessProjectIds(next).filter(id => !previousProjects.has(id));
    if (introduced.some(id => !known.has(id))) throw Error('新增业务项目不属于当前工作区，未保存关联。');
    if (!artifactStore?.backupEntries) return;
    const previousArtifacts = new Set(businessArtifactIds(before)), added = businessArtifactIds(next).filter(id => !previousArtifacts.has(id));
    if (!added.length) return;
    const entries = await artifactStore.backupEntries([...known]), metadata = new Map(entries.map(row => [row.id, row]));
    if (added.some(id => !metadata.has(id) || metadata.get(id).trashedAt || metadata.get(id).unavailable)) throw Error('新增素材或产物不属于当前工作区，或已不可用；未读取任何大图。');
    for (const product of next.products) for (const id of product.referenceArtifactIds.filter(id => added.includes(id))) {
      const file = metadata.get(id);
      if (file.projectId !== product.projectId || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw Error('商品原图必须是该商品项目中的静态PNG、JPEG或WebP。');
    }
    for (const order of next.orders) for (const id of (order.referenceArtifactIds || []).filter(id => added.includes(id))) if (metadata.get(id).projectId !== order.sourceProjectId) throw Error('共用客户资料需要先导入当前制作单的来源项目，未混入其他项目文件。');
  }
  async function write(workspaceId, found, candidate, internal = false) {
    const next = core.checkedBusinessState(candidate, workspaceId);
    if (next.revision !== found.state.revision) throw conflict();
    if (!internal) invalidateBusinessInputs(found.state, next);
    checkFinancialHistory(found.state, next); await scope(next, found.state);
    if (!internal && next.orders.some(row => (row.deliveries || []).some(receipt => !found.state.orders.find(old => old.id === row.id)?.deliveries?.some(old => old.id === receipt.id)))) throw Error('交付回执需由后端检查文件后生成，请使用确认交付。');
    next.revision++;
    core.checkedBusinessState(next, workspaceId);
    const place = await location(workspaceId, true), current = await read(workspaceId);
    if (current.raw?.toString('base64') !== found.raw?.toString('base64')) throw conflict();
    await atomicJson(fs, place.filename, next);
    const marker = path.join(place.directory, 'state-marker-v1.json');
    try { await fs.writeFile(marker, JSON.stringify({ version: 1, workspaceId }) + '\n', { encoding: 'utf8', flag: 'wx' }); }
    catch { /* The state is already committed. A late marker failure must not replay a cash receipt. */ }
    try { void Promise.resolve(onChanged?.({ workspaceId, revision: next.revision })).catch(() => undefined); } catch { /* An observer cannot undo a durable transaction. */ }
    return copy(next);
  }
  const snapshot = workspaceId => queue.run(workspaceId, async () => copy((await read(workspaceId)).state));
  return {
    snapshot, read: snapshot,
    save(input) { return queue.run(input?.workspaceId, async () => {
      if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error('业务保存版本无效。');
      const found = await read(input.workspaceId); if (found.state.revision !== input.expectedRevision) throw conflict();
      return write(input.workspaceId, found, input.state);
    }); },
    mutate(workspaceId, transform) { return queue.run(workspaceId, async () => {
      if (typeof transform !== 'function') throw Error('业务更新函数无效。');
      const found = await read(workspaceId), candidate = await transform(copy(found.state));
      return write(workspaceId, found, candidate, true);
    }); },
    drain: queue.drain,
  };
}
module.exports = { createBusinessStore, businessProjectIds, businessArtifactIds, checkFinancialHistory };
