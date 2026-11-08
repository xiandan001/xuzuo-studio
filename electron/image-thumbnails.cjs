const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { checkedDirectory, checkedFile } = require('./workspace-paths.cjs');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_THUMB_BYTES = 1024 * 1024;
function createImageThumbnails({ directory, nativeImage, fileSystem = fsDefault, maxEntries = 120, maxBytes = 24 * 1024 * 1024 }) {
  const fs = fileSystem, root = path.resolve(directory), pending = new Map(), memory = new Map(), loaders = new Set(), waitingLoaders = [], writes = new Map(), waitingWriters = [], cacheErrors = [];
  let memoryBytes = 0, queue = Promise.resolve(), writerQueue = Promise.resolve(), draining, writerSlots = 0, activeLoaders = 0, dirty = false, cleanupScheduled = false, failureCount = 0, lastBudget, unprunedWrites = 0, lastWrittenKey;
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  function cacheFailure(error, operation, key) {
    failureCount++; cacheErrors.push({ operation, ...(key ? { key } : {}), message: String(error?.message || error).slice(0, 500), ...(typeof error?.code === 'string' ? { code: error.code.slice(0, 64) } : {}) });
    if (cacheErrors.length > 8) cacheErrors.shift();
  }
  async function writerSlot() {
    if (writerSlots === 8) await new Promise(resolve => waitingWriters.push(resolve)); else writerSlots++;
  }
  function releaseWriter() { const next = waitingWriters.shift(); if (next) next(); else writerSlots--; }
  async function loaderSlot(action) {
    if (activeLoaders === 2) await new Promise(resolve => waitingLoaders.push(resolve)); else activeLoaders++;
    try { return await action(); }
    finally { const next = waitingLoaders.shift(); if (next) next(); else activeLoaders--; }
  }
  async function cleanup(keep, force = false) {
    if (!dirty && !force) return;
    lastBudget = undefined;
    try { await fs.lstat(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; dirty = false; unprunedWrites = 0; lastBudget = { entries: 0, bytes: 0 }; return; }
    lastBudget = await prune(keep); dirty = false; unprunedWrites = 0;
  }
  function cleanupIfIdle() {
    if (pending.size || loaders.size || writes.size || !dirty || cleanupScheduled || draining) return;
    cleanupScheduled = true;
    writerQueue = writerQueue.then(() => cleanup(lastWrittenKey)).catch(error => cacheFailure(error, 'cleanup')).finally(() => { cleanupScheduled = false; });
  }
  function retain(key, result, bytes) {
    if (memory.has(key)) { memoryBytes -= memory.get(key).bytes; memory.delete(key); }
    if (bytes <= MAX_THUMB_BYTES) { memory.set(key, { result, bytes }); memoryBytes += bytes; }
    while (memory.size > 32 || memoryBytes > 4 * 1024 * 1024) { const first = memory.keys().next().value; memoryBytes -= memory.get(first).bytes; memory.delete(first); }
    return result;
  }
  function memoryPreview(key) {
    if (!memory.has(key)) return;
    const value = memory.get(key); memory.delete(key); memory.set(key, value); return value.result;
  }
  async function cached(key) {
    const reused = memoryPreview(key); if (reused) return reused;
    const metaPath = path.join(root, key + '.json'), imagePath = path.join(root, key + '.png');
    try {
      await fs.lstat(root);
      await checkedDirectory(fs, root); await checkedFile(fs, metaPath); await checkedFile(fs, imagePath);
      const stat = await fs.lstat(metaPath); if (stat.size > 4096) return;
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      if (meta.version !== 1 || meta.key !== key || !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.width) || !Number.isSafeInteger(meta.height) || meta.width < 1 || meta.height < 1 || meta.width > 320 || meta.height > 320 || !Number.isSafeInteger(meta.originalWidth) || !Number.isSafeInteger(meta.originalHeight) || meta.originalWidth < 1 || meta.originalHeight < 1 || meta.originalWidth * meta.originalHeight > 67_108_864 || !['present', 'unknown'].includes(meta.transparency)) return;
      const imageStat = await fs.lstat(imagePath); if (imageStat.size > MAX_THUMB_BYTES) return;
      const buffer = await fs.readFile(imagePath); if (hash(buffer) !== meta.sha256) return;
      const result = { mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + buffer.toString('base64'), width: meta.width, height: meta.height, originalWidth: meta.originalWidth, originalHeight: meta.originalHeight, transparency: meta.transparency, thumbnail: true };
      return retain(key, result, result.dataUrl.length * 2 + 256);
    } catch (error) { if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error; }
  }
  async function atomic(filename, bytes) {
    const identity = await directoryIdentity();
    try { await fs.lstat(filename); await checkedFile(fs, filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = filename + '.' + randomUUID() + '.tmp';
    let attempted = false, collision = false, renamed = false;
    try {
      if (identity !== await directoryIdentity()) throw new Error('缩略图缓存目录已变化，未提交缓存。');
      attempted = true;
      try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); }
      catch (error) { collision = error.code === 'EEXIST'; throw error; }
      if (identity !== await directoryIdentity()) throw new Error('缩略图缓存目录已变化，未提交缓存。');
      await fs.rename(temporary, filename); renamed = true;
    } finally {
      // A replaced directory may point outside this cache. Never clean through it.
      if (attempted && !collision && !renamed && identity === await directoryIdentity().catch(() => undefined)) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function directoryIdentity() {
    await checkedDirectory(fs, root); const stat = await fs.lstat(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('缩略图缓存目录已变化，未执行清理。');
    return `${stat.dev}:${stat.ino}`;
  }
  async function cachedLeaf(filename) {
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('缩略图缓存包含链接或无效文件，未执行清理。');
    return stat;
  }
  async function cacheEntries() {
    const identity = await directoryIdentity(), names = (await fs.readdir(root)).filter(name => /^[a-f0-9]{64}\.png$/.test(name));
    const entries = new Array(names.length); let next = 0;
    const tasks = await Promise.allSettled(Array.from({ length: Math.min(8, names.length) }, async () => {
      while (next < names.length) {
        const index = next++, name = names[index], filename = path.join(root, name), stat = await cachedLeaf(filename); let metadataBytes = 0;
        try { metadataBytes = (await cachedLeaf(filename.slice(0, -4) + '.json')).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        entries[index] = { name, filename, bytes: stat.size + metadataBytes, at: stat.mtimeMs };
      }
    }));
    const failed = tasks.find(task => task.status === 'rejected'); if (failed) throw failed.reason;
    if (identity !== await directoryIdentity()) throw new Error('缩略图缓存目录已变化，未执行清理。');
    return entries;
  }
  async function prune(keep) {
    const entries = await cacheEntries();
    entries.sort((a, b) => a.at - b.at); let bytes = entries.reduce((total, entry) => total + entry.bytes, 0), count = entries.length;
    for (const entry of entries) {
      if (count <= maxEntries && bytes <= maxBytes) break;
      if (entry.name === keep + '.png') continue;
      const meta = entry.filename.slice(0, -4) + '.json';
      try { await checkedFile(fs, meta); await fs.unlink(meta); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.unlink(entry.filename); count--; bytes -= entry.bytes;
    }
    return { entries: count, bytes };
  }
  function preview(buffer, meta) {
    return { mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + buffer.toString('base64'), width: meta.width, height: meta.height, originalWidth: meta.originalWidth, originalHeight: meta.originalHeight, transparency: meta.transparency, thumbnail: true };
  }
  function pendingPreview(key) {
    const item = writes.get(key); if (!item) return;
    const result = preview(item.buffer, item.meta); return retain(key, result, result.dataUrl.length * 2 + 256);
  }
  async function persistCache(key, buffer, meta) {
    if (unprunedWrites >= 7) await cleanup(lastWrittenKey);
    // Count attempts even when only the PNG commits, so an eighth cannot leak.
    await checkedDirectory(fs, root, true); dirty = true; unprunedWrites++;
    await atomic(path.join(root, key + '.png'), buffer); await atomic(path.join(root, key + '.json'), Buffer.from(JSON.stringify(meta) + '\n')); lastWrittenKey = key;
    if (unprunedWrites >= 7) await cleanup(key);
  }
  function writeCache(key, buffer, meta) {
    writes.set(key, { buffer, meta });
    writerQueue = writerQueue.then(() => persistCache(key, buffer, meta)).catch(error => cacheFailure(error, 'write', key)).finally(() => { writes.delete(key); releaseWriter(); cleanupIfIdle(); });
  }
  async function generate(source, key) {
    if (['image/gif', 'image/svg+xml'].includes(source.artifact.mimeType)) {
      const file = await source.read(), mimeType = source.artifact.mimeType;
      if (!file?.buffer?.length || file.buffer.length > 20 * 1024 * 1024) throw new Error('图片为空或超过20MB，请打开项目查看原文件。');
      if (file.mimeType && file.mimeType !== mimeType) throw new Error('图片格式与登记不一致，请重新读取项目文件。');
      const formats = require('./image-output-formats.cjs');
      if (mimeType === 'image/gif') formats.validateLocalGif(file.buffer); else formats.validateSvg(file.buffer);
      // Keep animation/vector bytes; this preview is never an image API input.
      const result = { mimeType, dataUrl: `data:${mimeType};base64,${file.buffer.toString('base64')}`, thumbnail: false };
      return retain(key, result, result.dataUrl.length * 2 + 256);
    }
    const waiting = pendingPreview(key); if (waiting) return waiting;
    const reused = await cached(key); if (reused) return reused;
    await writerSlot();
    let transferred = false;
    try {
      const file = await source.read();
      if (!file?.buffer || file.buffer.length > 32 * 1024 * 1024) throw new Error('此图片超过缩略图处理范围，请打开原文件查看。');
      const image = nativeImage.createFromBuffer(file.buffer); if (image.isEmpty()) throw new Error('图片无法解码，原文件与记录未改动。');
      const size = image.getSize(), ratio = Math.min(1, 320 / size.width, 320 / size.height);
      if (!size.width || !size.height || size.width * size.height > 67_108_864) throw new Error('图片像素过大，请打开原文件查看。');
      const width = Math.max(1, Math.round(size.width * ratio)), height = Math.max(1, Math.round(size.height * ratio));
      const thumbnail = image.resize({ width, height, quality: 'good' }), buffer = thumbnail.toPNG();
      if (buffer.length > MAX_THUMB_BYTES) throw new Error('缩略图超过允许大小，原文件未修改。');
      const pixels = thumbnail.toBitmap(); let transparency = 'unknown'; for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] < 255) { transparency = 'present'; break; }
      const meta = { version: 1, key, width, height, originalWidth: size.width, originalHeight: size.height, transparency, sha256: hash(buffer) };
      const result = preview(buffer, meta); writeCache(key, buffer, meta); transferred = true;
      return retain(key, result, result.dataUrl.length * 2 + 256);
    } finally { if (!transferred) releaseWriter(); }
  }
  function get(source) {
    if (!source || source.artifact?.kind !== 'image' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(source.artifact.mimeType) || typeof source.key !== 'string' || typeof source.read !== 'function') return Promise.reject(new Error('请选择可预览的受管图片。'));
    const key = hash(['image/gif', 'image/svg+xml'].includes(source.artifact.mimeType) ? source.artifact.mimeType + ':' + source.key : source.key), ready = memoryPreview(key) || pendingPreview(key); if (ready) return Promise.resolve({ ...ready, artifact: source.artifact });
    if (pending.has(key)) return pending.get(key);
    const task = serial(() => generate(source, key)).then(result => ({ ...result, artifact: source.artifact })).finally(() => { pending.delete(key); cleanupIfIdle(); }); pending.set(key, task); return task;
  }
  const cacheStatus = () => ({ pendingWrites: writes.size, pendingPngBytes: [...writes.values()].reduce((bytes, item) => bytes + item.buffer.length, 0), reservedWrites: writerSlots, memoryEntries: memory.size, memoryBytes, cacheFailures: failureCount, errors: cacheErrors.map(error => ({ ...error })), budget: lastBudget ? { ...lastBudget } : undefined, budgetVerified: !pending.size && !loaders.size && !writes.size && !writerSlots && !cleanupScheduled && !dirty && !!lastBudget && lastBudget.entries <= maxEntries && lastBudget.bytes <= maxBytes });
  return {
    get,
    getFrom(loadSource) {
      if (typeof loadSource !== 'function') return Promise.reject(new Error('缩略图来源读取无效。'));
      let task;
      task = loaderSlot(async () => get(await loadSource())).finally(() => { loaders.delete(task); cleanupIfIdle(); });
      loaders.add(task); return task;
    },
    clear() { memory.clear(); memoryBytes = 0; },
    cacheStatus,
    drain() {
      if (draining) return draining;
      draining = (async () => {
        do {
          while (pending.size || loaders.size || writes.size || writerSlots || cleanupScheduled) await Promise.allSettled([...pending.values(), ...loaders, writerQueue]);
          writerQueue = writerQueue.then(() => cleanup(undefined, true)).catch(error => cacheFailure(error, 'drain-cleanup'));
          await writerQueue;
        } while (pending.size || loaders.size || writes.size || writerSlots || cleanupScheduled);
        return cacheStatus();
      })().finally(() => { draining = undefined; });
      return draining;
    },
  };
}
module.exports = { createImageThumbnails };
