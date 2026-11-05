const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { safeBasename } = require('./trash-store.cjs');
const { assetProvenance } = require('./asset-provenance.cjs');
const TYPES = { '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = id => typeof id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(id);
const kind = type => type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : type.startsWith('video/') ? 'video' : type.includes('officedocument') ? 'office' : type.startsWith('text/') || type === 'application/json' ? 'text' : 'other';
const INDEX_CACHE_BYTES = 8 * 1024 * 1024;
function createAssetLibrary({ workspaceStorage, artifactStore, fileSystem = fsDefault }) {
  const fs = fileSystem; let queue = Promise.resolve(), indexGeneration = 0, activeLeaves = 0, activeThumbnails = 0, indexCache;
  const pendingListings = new Set(), waitingLeaves = [], pendingThumbnails = new Set(), waitingThumbnails = [];
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  function trackListing(action) {
    const task = Promise.resolve().then(action); pendingListings.add(task);
    const finished = () => pendingListings.delete(task); task.then(finished, finished); return task;
  }
  async function leafSlot(action) {
    if (activeLeaves === 8) await new Promise(resolve => waitingLeaves.push(resolve)); else activeLeaves++;
    try { return await action(); }
    finally { const next = waitingLeaves.shift(); if (next) next(); else activeLeaves--; }
  }
  async function thumbnailSlot(action) {
    if (activeThumbnails === 2) await new Promise(resolve => waitingThumbnails.push(resolve)); else activeThumbnails++;
    try { return await action(); }
    finally { const next = waitingThumbnails.shift(); if (next) next(); else activeThumbnails--; }
  }
  function thumbnailTask(action) {
    const task = thumbnailSlot(action); pendingThumbnails.add(task);
    const finished = () => pendingThumbnails.delete(task); task.then(finished, finished); return task;
  }
  function validateProbeIds(ids) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw new Error('请选择当前工作区中最多100份不重复的素材。');
  }
  async function commitIndex(place, assets) {
    try { await atomicJson(fs, place.index, { version: 1, assets }); }
    finally { if (indexCache?.path === place.index) indexCache = undefined; indexGeneration++; }
  }
  async function location(workspaceId, create = false) {
    if (!validId(workspaceId)) throw new Error('工作区编号无效。');
    const root = await workspaceStorage.validateWorkspace(workspaceId), directory = path.join(root, '.xuzuo-assets');
    if (create) { await checkedDirectory(fs, directory, true); await checkedDirectory(fs, path.join(directory, 'files'), true); }
    let absent = false;
    if (!create) { try { await fs.lstat(directory); await checkedDirectory(fs, directory); } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; } }
    return { directory, index: path.join(directory, 'library-v1.json'), absent };
  }
  async function readIndex(place) {
    if (place.absent) { if (indexCache?.path === place.index) indexCache = undefined; return []; }
    try {
      await checkedFile(fs, place.index);
      const bytes = await fs.readFile(place.index), sha256 = bytes.length <= INDEX_CACHE_BYTES ? digest(bytes) : undefined;
      if (sha256 && indexCache?.path === place.index && indexCache.sha256 === sha256) return indexCache.assets;
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.version !== 1 || !Array.isArray(value.assets) || new Set(value.assets.map(item => item.id)).size !== value.assets.length || value.assets.some(item => !validId(item.id) || !safeBasename(item.fileName) || !item.fileName.startsWith(`${item.id}-`) || typeof item.name !== 'string' || !Object.values(TYPES).includes(item.mimeType) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 100 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.createdAt !== 'string' || typeof item.favorite !== 'boolean' || item.archivedAt !== undefined && typeof item.archivedAt !== 'string')) throw new Error('invalid');
      for (const item of value.assets) assetProvenance(item.provenance);
      indexCache = sha256 ? { path: place.index, sha256, assets: Object.freeze(value.assets.map(item => Object.freeze(item))) } : undefined;
      return indexCache?.assets || value.assets;
    } catch (error) {
      if (indexCache?.path === place.index) indexCache = undefined;
      if (error.code === 'ENOENT') {
        const files = path.join(place.directory, 'files'); let exists = true;
        try { await fs.lstat(files); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; exists = false; }
        if (!exists) return [];
        await checkedDirectory(fs, files);
        if (!(await fs.readdir(files)).length) return [];
        throw new Error('素材索引缺失，但素材文件仍在。未创建空索引，请保留目录并从备份恢复。');
      }
      throw new Error('素材索引无法读取，原文件已保留，请检查工作区后重试。');
    }
  }
  const publicItem = (item, workspaceId) => ({ id: item.id, name: item.name, mimeType: item.mimeType, bytes: item.bytes, createdAt: item.createdAt, favorite: item.favorite, ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}), workspaceId, kind: kind(item.mimeType), ...(item.provenance ? { provenance: assetProvenance(item.provenance) } : {}) });
  async function removeUncommitted(place, created) {
    let protectedIds;
    try {
      await checkedFile(fs, place.index);
      const current = JSON.parse(await fs.readFile(place.index, 'utf8'));
      if (current.version === 1 && Array.isArray(current.assets)) protectedIds = new Set(current.assets.map(item => item.id));
    } catch (error) { if (error.code === 'ENOENT') protectedIds = new Set(); }
    if (!protectedIds) return;
    for (const item of created.filter(item => !protectedIds.has(item.id))) {
      try { const stat = await checkedFile(fs, item.target); if (stat.ino === item.ino && stat.dev === item.dev) await fs.unlink(item.target); }
      catch { /* Keep files when ownership or directory identity cannot be confirmed. */ }
    }
  }
  async function readAsset(workspaceId, id) {
    const place = await location(workspaceId), record = (await readIndex(place)).find(item => item.id === id);
    if (!record || record.archivedAt) throw new Error('素材不存在或已移入素材回收站。');
    const filename = path.join(place.directory, 'files', record.fileName); await checkedFile(fs, filename);
    const buffer = await fs.readFile(filename);
    if (buffer.length !== record.bytes || digest(buffer) !== record.sha256) throw new Error('素材文件内容已改变，请重新导入；未把不一致的文件加入项目。');
    return { ...publicItem(record, workspaceId), buffer };
  }
  async function filesIdentity(directory) {
    await checkedDirectory(fs, directory);
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('素材目录已变化。');
    return `${stat.dev}:${stat.ino}`;
  }
  async function probeLeaves(directory, assets, workspaceId) {
    const items = new Array(assets.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, assets.length) }, async () => {
      while (next < assets.length) {
        const index = next++, item = assets[index]; let unavailable = false;
        try {
          const stat = await leafSlot(() => fs.lstat(path.join(directory, item.fileName)));
          unavailable = stat.isSymbolicLink() || !stat.isFile() || stat.size > 100 * 1024 * 1024;
        } catch { unavailable = true; }
        items[index] = { ...publicItem(item, workspaceId), unavailable };
      }
    }));
    return items;
  }
  async function probeAssets(place, assets, workspaceId) {
    if (!assets.length) return [];
    const directory = path.join(place.directory, 'files'); let before;
    try { before = await filesIdentity(directory); }
    catch { return assets.map(item => ({ ...publicItem(item, workspaceId), unavailable: true })); }
    const items = await probeLeaves(directory, assets, workspaceId);
    try { if (await filesIdentity(directory) === before) return items; }
    catch { /* A changed common path invalidates all leaf availability observations. */ }
    return items.map(item => ({ ...item, unavailable: true }));
  }
  function selectedAssets(assets, ids) {
    if (ids === undefined) return assets;
    const byId = new Map(assets.map(item => [item.id, item]));
    return ids.map(id => { const item = byId.get(id); if (!item) throw new Error('所选素材不属于当前工作区或已移除，请重新读取。'); return item; });
  }
  async function listResult(snapshot, workspaceId, ids, probeOnly) {
    const selected = selectedAssets(snapshot.assets, ids);
    const inspect = ids === undefined ? selected : selected.filter(item => !item.archivedAt);
    const checked = await probeAssets(snapshot.place, inspect, workspaceId);
    if (ids === undefined) return checked;
    const unavailable = new Map(checked.map(item => [item.id, item.unavailable]));
    for (const item of selected) if (item.archivedAt) unavailable.set(item.id, true);
    if (probeOnly) return selected.map(item => ({ id: item.id, unavailable: unavailable.get(item.id) }));
    return snapshot.assets.map(item => ({ ...publicItem(item, workspaceId), ...(unavailable.has(item.id) ? { unavailable: unavailable.get(item.id) } : {}) }));
  }
  async function listAssets(workspaceId, ids, probeOnly = false) {
    while (true) {
      const snapshot = await serial(async () => {
        const place = await location(workspaceId), assets = await readIndex(place);
        return { place, assets, generation: indexGeneration };
      });
      const items = await listResult(snapshot, workspaceId, ids, probeOnly);
      if (await serial(() => snapshot.generation === indexGeneration)) return items;
    }
  }
  return {
    search({ workspaceId, query, limit = 6 }) { return serial(async () => {
      if (typeof query !== 'string' || query.length > 120 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('搜索内容最多 120 个字符，结果数量需为 1–50。');
      const place = await location(workspaceId), assets = await readIndex(place), terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      const found = assets.filter(item => !item.archivedAt && terms.every(term => `${item.id} ${item.name} ${item.mimeType} ${kind(item.mimeType)}`.normalize('NFKC').toLocaleLowerCase().includes(term)));
      found.sort((left, right) => { const a = left.name.normalize('NFKC').toLocaleLowerCase(), b = right.name.normalize('NFKC').toLocaleLowerCase(), text = terms.join(' '); return Number(right.id === text) - Number(left.id === text) || Number(b === text) - Number(a === text) || Number(b.startsWith(text)) - Number(a.startsWith(text)) || (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0); });
      return { total: found.length, items: found.slice(0, limit).map(item => { const metadata = publicItem(item, workspaceId); if (query.trim() !== item.id) delete metadata.provenance; return metadata; }) };
    }); },
    list({ workspaceId, availabilityIds }) {
      return trackListing(() => {
        if (availabilityIds !== undefined) validateProbeIds(availabilityIds);
        const ids = availabilityIds === undefined ? undefined : [...availabilityIds];
        if (ids?.length === 0) return serial(async () => { const place = await location(workspaceId), assets = await readIndex(place); return assets.map(item => publicItem(item, workspaceId)); });
        return listAssets(workspaceId, ids);
      });
    },
    probe({ workspaceId, ids }) {
      return trackListing(() => { validateProbeIds(ids); return listAssets(workspaceId, [...ids], true); });
    },
    importPaths({ workspaceId, paths }) { return serial(async () => {
      if (!Array.isArray(paths) || !paths.length || paths.length > 20 || paths.some(source => typeof source !== 'string' || !path.isAbsolute(source))) throw new Error('一次请选择 1–20 个本机素材文件。');
      const place = await location(workspaceId, true), assets = await readIndex(place), added = [], created = []; let total = 0;
      try {
        for (const source of paths) {
          const mimeType = TYPES[path.extname(source).toLowerCase()]; if (!mimeType) throw new Error('所选文件类型暂不支持作为素材。');
          const stat = await checkedFile(fs, source); total += stat.size;
          if (total > 200 * 1024 * 1024) throw new Error('一次导入的素材总大小不能超过 200 MB，请分批添加。');
          const buffer = await fs.readFile(source); if (buffer.length !== stat.size) throw new Error('导入期间原文件发生变化，未覆盖原文件。');
          const after = await checkedFile(fs, source); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('导入期间原文件发生变化，未把不一致内容保存为素材。');
          const id = randomUUID(), name = path.basename(source), fileName = `${id}${path.extname(source).toLowerCase()}`;
          const record = { id, name, fileName: `${id}-${fileName}`, mimeType, bytes: buffer.length, sha256: digest(buffer), createdAt: new Date().toISOString(), favorite: false };
          const target = path.join(place.directory, 'files', record.fileName), handle = await fs.open(target, 'wx');
          try { const owned = await handle.stat(); created.push({ id, target, ino: owned.ino, dev: owned.dev }); await handle.writeFile(buffer); }
          finally { await handle.close(); }
          added.push(record);
        }
        await commitIndex(place, [...added, ...assets]);
      } catch (error) { await removeUncommitted(place, created); throw error; }
      return added.map(item => publicItem(item, workspaceId));
    }); },
    importBuiltin({ workspaceId, file }) { return serial(async () => {
      if (!file || file.mimeType !== 'image/png' || !(file.buffer instanceof Uint8Array) || file.buffer.length > 20 * 1024 * 1024) throw new Error('内置素材文件无效，未保存副本。');
      const provenance = assetProvenance(file.provenance); if (!provenance) throw new Error('内置素材缺少授权信息。');
      const place = await location(workspaceId, true), assets = await readIndex(place), buffer = Buffer.from(file.buffer), sha256 = digest(buffer);
      const existing = assets.find(item => !item.archivedAt && item.provenance?.builtinId === provenance.builtinId && item.sha256 === sha256);
      if (existing) { try { await readAsset(workspaceId, existing.id); return publicItem(existing, workspaceId); } catch { /* An unavailable old copy does not block a new independent copy. */ } }
      const id = randomUUID(), name = `${path.basename(file.name, path.extname(file.name))}.png`, record = { id, name, fileName: `${id}-${id}.png`, mimeType: 'image/png', bytes: buffer.length, sha256, createdAt: new Date().toISOString(), favorite: false, provenance };
      const target = path.join(place.directory, 'files', record.fileName), created = [], handle = await fs.open(target, 'wx');
      try { const owned = await handle.stat(); created.push({ id, target, ino: owned.ino, dev: owned.dev }); await handle.writeFile(buffer); }
      catch (error) { await handle.close(); await removeUncommitted(place, created); throw error; }
      await handle.close();
      try { await commitIndex(place, [record, ...assets]); }
      catch (error) { await removeUncommitted(place, created); throw error; }
      return publicItem(record, workspaceId);
    }); },
    update({ workspaceId, id, favorite, archived }) { return serial(async () => {
      const place = await location(workspaceId), assets = [...await readIndex(place)], index = assets.findIndex(item => item.id === id); if (index < 0) throw new Error('找不到当前工作区的这份素材。');
      const item = { ...assets[index] }; assets[index] = item;
      if (favorite !== undefined && typeof favorite !== 'boolean' || archived !== undefined && typeof archived !== 'boolean') throw new Error('素材状态无效。');
      if (favorite !== undefined) item.favorite = favorite;
      if (archived === true) item.archivedAt = new Date().toISOString(); else if (archived === false) delete item.archivedAt;
      await commitIndex(place, assets); return publicItem(item, workspaceId);
    }); },
    read(input) { return serial(() => readAsset(input.workspaceId, input.id)); },
    thumbnailSource({ workspaceId, id }) { return thumbnailTask(() => serial(async () => {
      const place = await location(workspaceId), record = (await readIndex(place)).find(item => item.id === id);
      if (!record || record.archivedAt || kind(record.mimeType) !== 'image') throw new Error('素材图片不存在或已回收。');
      const filename = path.join(place.directory, 'files', record.fileName), stat = await checkedFile(fs, filename);
      if (stat.size !== record.bytes) throw new Error('素材文件大小已改变，请重新导入。');
      return { artifact: publicItem(record, workspaceId), key: JSON.stringify([workspaceId, id, filename, record.sha256, stat.size, stat.mtimeMs, stat.ctimeMs]), read: () => thumbnailTask(() => serial(() => readAsset(workspaceId, id))) };
    })); },
    attach({ workspaceId, id, projectId }) { return serial(async () => {
      await workspaceStorage.assertProject(projectId, workspaceId);
      const asset = await readAsset(workspaceId, id);
      return artifactStore.write({ name: asset.name, mimeType: asset.mimeType, buffer: asset.buffer, projectId, preserveOriginalName: true, ...(asset.provenance ? { provenance: asset.provenance } : {}) });
    }); },
    flush: async () => { await Promise.allSettled([queue, ...pendingListings, ...pendingThumbnails]); },
  };
}
module.exports = { createAssetLibrary };
