const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { checkedDirectory, checkedFile } = require('./workspace-paths.cjs');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_THUMB_BYTES = 1024 * 1024;
function createImageThumbnails({ directory, nativeImage, fileSystem = fsDefault, maxEntries = 120, maxBytes = 24 * 1024 * 1024 }) {
  const fs = fileSystem, root = path.resolve(directory), pending = new Map(), memory = new Map(), loaders = new Set(), waitingLoaders = [];
  let memoryBytes = 0, queue = Promise.resolve(), activeLoaders = 0, dirty = false, unprunedWrites = 0, lastWrittenKey;
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  async function loaderSlot(action) {
    if (activeLoaders === 2) await new Promise(resolve => waitingLoaders.push(resolve)); else activeLoaders++;
    try { return await action(); }
    finally { const next = waitingLoaders.shift(); if (next) next(); else activeLoaders--; }
  }
  async function cleanup(keep, force = false) {
    if (!dirty && !force) return;
    try { await fs.lstat(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; dirty = false; unprunedWrites = 0; return; }
    await prune(keep); dirty = false; unprunedWrites = 0;
  }
  async function cleanupIfIdle() {
    if (!pending.size && !loaders.size && dirty) await serial(() => cleanup(lastWrittenKey));
  }
  function retain(key, result, bytes) {
    if (memory.has(key)) { memoryBytes -= memory.get(key).bytes; memory.delete(key); }
    if (bytes <= MAX_THUMB_BYTES) { memory.set(key, { result, bytes }); memoryBytes += bytes; }
    while (memory.size > 32 || memoryBytes > 4 * 1024 * 1024) { const first = memory.keys().next().value; memoryBytes -= memory.get(first).bytes; memory.delete(first); }
    return result;
  }
  async function cached(key) {
    if (memory.has(key)) { const value = memory.get(key); memory.delete(key); memory.set(key, value); return value.result; }
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
    try { await fs.lstat(filename); await checkedFile(fs, filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, filename); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
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
  }
  async function generate(source, key) {
    const reused = await cached(key); if (reused) return reused;
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
    if (unprunedWrites >= 7) await cleanup(lastWrittenKey);
    // Count attempts so a failed metadata commit cannot allow an eighth extra PNG.
    await checkedDirectory(fs, root, true); dirty = true; unprunedWrites++;
    await atomic(path.join(root, key + '.png'), buffer); await atomic(path.join(root, key + '.json'), Buffer.from(JSON.stringify(meta) + '\n')); lastWrittenKey = key;
    if (unprunedWrites >= 7 || pending.size <= 1 && loaders.size <= 1) await cleanup(key);
    const result = { mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + buffer.toString('base64'), width, height, originalWidth: size.width, originalHeight: size.height, transparency, thumbnail: true };
    return retain(key, result, result.dataUrl.length * 2 + 256);
  }
  function get(source) {
    if (!source || source.artifact?.kind !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(source.artifact.mimeType) || typeof source.key !== 'string' || typeof source.read !== 'function') return Promise.reject(new Error('请选择可预览的受管图片。'));
    const key = hash(source.key); if (pending.has(key)) return pending.get(key);
    const task = serial(() => generate(source, key)).then(result => ({ ...result, artifact: source.artifact })).finally(async () => { pending.delete(key); await cleanupIfIdle(); }); pending.set(key, task); return task;
  }
  return {
    get,
    getFrom(loadSource) {
      if (typeof loadSource !== 'function') return Promise.reject(new Error('缩略图来源读取无效。'));
      let task;
      task = loaderSlot(async () => get(await loadSource())).finally(async () => { loaders.delete(task); await cleanupIfIdle(); });
      loaders.add(task); return task;
    },
    clear() { memory.clear(); memoryBytes = 0; },
    async drain() {
      while (pending.size || loaders.size) await Promise.allSettled([...pending.values(), ...loaders]);
      await serial(() => cleanup(undefined, true));
    },
  };
}
module.exports = { createImageThumbnails };
