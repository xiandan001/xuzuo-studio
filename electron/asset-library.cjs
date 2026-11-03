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
function createAssetLibrary({ workspaceStorage, artifactStore, fileSystem = fsDefault }) {
  const fs = fileSystem; let queue = Promise.resolve();
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  async function location(workspaceId, create = false) {
    if (!validId(workspaceId)) throw new Error('工作区编号无效。');
    const root = await workspaceStorage.validateWorkspace(workspaceId), directory = path.join(root, '.xuzuo-assets');
    if (create) { await checkedDirectory(fs, directory, true); await checkedDirectory(fs, path.join(directory, 'files'), true); }
    let absent = false;
    if (!create) { try { await fs.lstat(directory); await checkedDirectory(fs, directory); } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; } }
    return { directory, index: path.join(directory, 'library-v1.json'), absent };
  }
  async function readIndex(place) {
    if (place.absent) return [];
    try {
      await checkedFile(fs, place.index);
      const value = JSON.parse(await fs.readFile(place.index, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.assets) || new Set(value.assets.map(item => item.id)).size !== value.assets.length || value.assets.some(item => !validId(item.id) || !safeBasename(item.fileName) || !item.fileName.startsWith(`${item.id}-`) || typeof item.name !== 'string' || !Object.values(TYPES).includes(item.mimeType) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 100 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.createdAt !== 'string' || typeof item.favorite !== 'boolean' || item.archivedAt !== undefined && typeof item.archivedAt !== 'string')) throw new Error('invalid');
      for (const item of value.assets) assetProvenance(item.provenance);
      return value.assets;
    } catch (error) {
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
  return {
    list({ workspaceId }) { return serial(async () => {
      const place = await location(workspaceId), assets = await readIndex(place);
      return Promise.all(assets.map(async item => { let unavailable = false; try { await checkedFile(fs, path.join(place.directory, 'files', item.fileName)); } catch { unavailable = true; } return { ...publicItem(item, workspaceId), unavailable }; }));
    }); },
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
        await atomicJson(fs, place.index, { version: 1, assets: [...added, ...assets] });
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
      try { await atomicJson(fs, place.index, { version: 1, assets: [record, ...assets] }); }
      catch (error) { await removeUncommitted(place, created); throw error; }
      return publicItem(record, workspaceId);
    }); },
    update({ workspaceId, id, favorite, archived }) { return serial(async () => {
      const place = await location(workspaceId), assets = await readIndex(place), item = assets.find(item => item.id === id); if (!item) throw new Error('找不到当前工作区的这份素材。');
      if (favorite !== undefined && typeof favorite !== 'boolean' || archived !== undefined && typeof archived !== 'boolean') throw new Error('素材状态无效。');
      if (favorite !== undefined) item.favorite = favorite;
      if (archived === true) item.archivedAt = new Date().toISOString(); else if (archived === false) delete item.archivedAt;
      await atomicJson(fs, place.index, { version: 1, assets }); return publicItem(item, workspaceId);
    }); },
    read(input) { return serial(() => readAsset(input.workspaceId, input.id)); },
    attach({ workspaceId, id, projectId }) { return serial(async () => {
      await workspaceStorage.assertProject(projectId, workspaceId);
      const asset = await readAsset(workspaceId, id);
      return artifactStore.write({ name: asset.name, mimeType: asset.mimeType, buffer: asset.buffer, projectId, ...(asset.provenance ? { provenance: asset.provenance } : {}) });
    }); },
    flush: () => queue,
  };
}
module.exports = { createAssetLibrary };
