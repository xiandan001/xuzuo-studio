const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const core = require('./bead-market.runtime.cjs');
const conflict = () => Object.assign(Error('材料报价已更新，请读取最新资料后重试。'), { code: 'BEAD_MARKET_CONFLICT' });
const clone = value => structuredClone(value);
function createBeadMarketStore({ workspaceStorage, artifactStore, readDocument = async () => undefined, onChanged, fileSystem = fsDefault }) {
  const fs = fileSystem, queue = createSerialQueue();
  async function location(projectId, create = false) {
    if (!core.beadMarketId(projectId)) throw Error('请选择有效的拼豆项目。');
    const project = await workspaceStorage.projectDirectory(projectId), directory = path.join(project, '.xuzuo');
    try { await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT' && !create) return { directory, filename: path.join(directory, 'bead-market-v1.json'), absent: true }; if (error.code !== 'ENOENT') throw error; }
    await checkedDirectory(fs, directory, create); return { directory, filename: path.join(directory, 'bead-market-v1.json'), absent: false };
  }
  async function found(projectId) {
    const place = await location(projectId), document = await readDocument(projectId);
    if (document && document.projectId !== projectId) throw Error('当前图纸不属于报价项目。');
    if (place.absent) return { place, document, state: core.newBeadMarketState(projectId, document), raw: undefined };
    let marker = false;
    try { const filename = path.join(place.directory, 'bead-market-marker-v1.json'), stat = await checkedFile(fs, filename); if (stat.size > 1000) throw Error('marker'); const value = JSON.parse(await fs.readFile(filename, 'utf8')); if (value.version !== 1 || value.projectId !== projectId) throw Error('marker'); marker = true; }
    catch (error) { if (error.code !== 'ENOENT') throw Error('报价保存标记无法读取，原文件保留。', { cause: error }); }
    try {
      const stat = await checkedFile(fs, place.filename); if (stat.size > core.BEAD_MARKET_STATE_BYTES) throw Error('size'); const raw = await fs.readFile(place.filename); if (raw.length > core.BEAD_MARKET_STATE_BYTES) throw Error('size');
      return { place, document, raw, state: core.checkedBeadMarketState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), projectId) };
    } catch (error) {
      if (error.code === 'ENOENT' && !marker && !(await fs.readdir(place.directory)).some(name => name.startsWith('bead-market-v1.json.') && name.endsWith('.tmp'))) return { place, document, state: core.newBeadMarketState(projectId, document), raw: undefined };
      throw Error('材料报价无法安全读取，原文件保留，请恢复报价备份；不会创建空表覆盖。', { cause: error });
    }
  }
  async function scope(next, before) {
    const old = new Set(before.offers.map(offer => offer.evidence.artifactId).filter(Boolean)), ids = [...new Set(next.offers.map(offer => offer.evidence.artifactId).filter(id => id && !old.has(id)))];
    if (!ids.length) return;
    if (!artifactStore?.list) throw Error('当前后台不能核验报价附件，请更新桌面应用。');
    const files = new Map((await artifactStore.list(ids)).map(file => [file.id, file]));
    for (const id of ids) { const file = files.get(id); if (!file || file.projectId !== next.projectId || file.trashedAt || file.unavailable) throw Error('报价证据必须属于当前项目且可读取。'); }
  }
  function aligned(state, document) {
    if (!document) return state;
    const spec = core.beadMarketSpecForDocument(state.spec, document), changed = JSON.stringify(spec) !== JSON.stringify(state.spec);
    return changed ? { ...state, spec, selections: {}, ...(state.lastQuery?.status === 'querying' ? { lastQuery: { ...state.lastQuery, status: 'cancelled', finishedAt: new Date().toISOString(), sources: Object.fromEntries(Object.entries(state.lastQuery.sources).map(([key, value]) => [key, { ...value, status: 'cancelled', message: '图纸色卡已改变，请重新查询。' }])) } } : {}) } : state;
  }
  async function write(projectId, previous, candidate) {
    let next = core.checkedBeadMarketState(candidate, projectId); if (next.revision !== previous.state.revision) throw conflict();
    next = core.checkedBeadMarketState(aligned(next, previous.document), projectId); await scope(next, previous.state); next.revision++;
    const place = await location(projectId, true), current = await found(projectId); if (current.raw?.toString('base64') !== previous.raw?.toString('base64')) throw conflict();
    if (current.document?.revision !== previous.document?.revision || current.document?.id !== previous.document?.id) throw Object.assign(Error('图纸已改变，请重新核对当前材料需求。'), { code: 'BEAD_MARKET_DEMAND_CHANGED' });
    await atomicJson(fs, place.filename, next);
    try { await fs.writeFile(path.join(place.directory, 'bead-market-marker-v1.json'), JSON.stringify({ version: 1, projectId }) + '\n', { flag: 'wx', encoding: 'utf8' }); } catch { /* The committed state remains authoritative. */ }
    try { void Promise.resolve(onChanged?.({ projectId, revision: next.revision })).catch(() => undefined); } catch { /* Observers do not undo committed writes. */ }
    return clone(next);
  }
  const read = projectId => queue.run(projectId, async () => { const previous = await found(projectId), next = aligned(previous.state, previous.document); return next !== previous.state ? write(projectId, previous, next) : clone(previous.state); });
  return {
    read, snapshot: read,
    save: input => queue.run(input?.projectId, async () => { if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error('报价保存版本无效。'); const previous = await found(input.projectId); if (previous.state.revision !== input.expectedRevision) throw conflict(); return write(input.projectId, previous, input.state); }),
    mutate: (projectId, transform) => queue.run(projectId, async () => { if (typeof transform !== 'function') throw Error('报价更新函数无效。'); const previous = await found(projectId); return write(projectId, previous, await transform(clone(aligned(previous.state, previous.document)))); }),
    drain: queue.drain,
  };
}
module.exports = { createBeadMarketStore };
