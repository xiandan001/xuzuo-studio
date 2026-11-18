const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { checkedDirectory, atomicJson } = require('./workspace-paths.cjs');
const { validId, safePath, validateManifest } = require('./backup-format.cjs');
const { fsDefault, PART_BYTES, READ_BYTES, MAX_FILE, MAX_TOTAL, MAX_FILES, MAX_METADATA, metadataBytes, digest, active, yieldToInteraction, sameFile, ordinaryFile, readChunks, fileIdentity, freeSpace, readJson, childPath } = require('./incremental-backup-paths.cjs');

const MARKER = '.xuzuo-incremental-backup.json', SNAPSHOT_SUFFIX = '.xuzuo-snapshot.json';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function repositoryPath(directory, ownerId, workspaceId) {
  if (!validId(ownerId) || !validId(workspaceId)) throw Error('自动备份范围编号无效。');
  return childPath(path.resolve(directory), `序作备份-${digest(ownerId + '/' + workspaceId).slice(0, 12)}`);
}
async function checkRepository(fs, directory, ownerId) {
  await checkedDirectory(fs, directory); const marker = await readJson(fs, path.join(directory, MARKER), 4096);
  if (marker.kind !== 'xuzuo-incremental-repository' || marker.version !== 1 || !validId(marker.ownerId) || !validId(marker.workspaceId) || ownerId !== undefined && marker.ownerId !== ownerId) throw Error('自动备份位置的所有权标记不匹配，未修改其中的内容。');
  return marker;
}
async function createRepository({ directory, ownerId, workspaceId, fileSystem = fsDefault }) {
  const fs = fileSystem, root = repositoryPath(directory, ownerId, workspaceId); await checkedDirectory(fs, path.resolve(directory));
  try { await fs.mkdir(root); }
  catch (error) { if (error.code !== 'EEXIST') throw error; const marker = await checkRepository(fs, root, ownerId); if (marker.workspaceId !== workspaceId) throw Error('备份位置属于其他工作区，未改动它。'); return { directory: root, ownerId, workspaceId }; }
  const marker = { kind: 'xuzuo-incremental-repository', version: 1, ownerId, workspaceId };
  await fs.writeFile(path.join(root, MARKER), JSON.stringify(marker) + '\n', { flag: 'wx' });
  for (const name of ['blobs', 'snapshots', '.incomplete']) await fs.mkdir(path.join(root, name));
  await atomicJson(fs, path.join(root, 'index.json'), { kind: 'xuzuo-incremental-index', version: 1, ownerId, snapshots: [] });
  return { directory: root, ownerId, workspaceId };
}
function validateStreamManifest(manifest) {
  if (!Array.isArray(manifest?.files) || manifest.files.length >= MAX_FILES) throw Error('增量备份文件数量超过限制。');
  validateManifest({ ...manifest, files: [] }); const seen = new Set(); let bytes = 0;
  for (const file of manifest.files) {
    safePath(file.path);
    if (seen.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE || !hex(file.sha256) || (bytes += file.bytes) > MAX_TOTAL) throw Error('增量备份文件清单重复、哈希无效或超过单文件100MB、总量16GB限制。');
    seen.add(file.path.toLowerCase());
  }
  metadataBytes(manifest, 16 * 1024 * 1024);
  return bytes;
}
function validateSnapshot(value, marker) {
  if (value?.kind !== 'xuzuo-incremental-snapshot' || value.version !== 1 || value.ownerId !== marker.ownerId || !validId(value.snapshotId) || value.snapshotId !== value.manifest?.backupId || !Array.isArray(value.files) || value.files.length !== value.manifest.files?.length) throw Error('增量快照的格式或所有权无效。');
  const bytes = validateStreamManifest(value.manifest), names = new Set(), byPath = new Map(value.manifest.files.map(file => [file.path, file]));
  if (value.manifest.locations.workspaces.length !== 1 || value.manifest.locations.workspaces[0].workspaceId !== marker.workspaceId) throw Error('快照不属于该自动备份位置登记的工作区。');
  for (const entry of value.files) {
    const file = byPath.get(entry.path);
    if (!file || names.has(entry.path) || !Array.isArray(entry.parts) || entry.parts.length !== Math.ceil(file.bytes / PART_BYTES) || entry.parts.some((part, index) => !hex(part.sha256) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 || part.bytes > PART_BYTES || index < entry.parts.length - 1 && part.bytes !== PART_BYTES) || entry.parts.reduce((sum, part) => sum + part.bytes, 0) !== file.bytes) throw Error('增量快照的分卷清单与文件不一致。');
    names.add(entry.path);
  }
  return bytes;
}
function fileSources(fs, repository, marker, snapshot, options) {
  const files = new Map(), byPath = new Map(snapshot.files.map(file => [file.path, file])); let verifiedBytes = 0;
  for (const file of snapshot.manifest.files) {
    const parts = byPath.get(file.path).parts;
    async function consume(onChunk, overrides = {}) {
      const settings = { ...options, ...overrides }, hash = createHash('sha256'); let bytes = 0;
      await checkRepository(fs, repository, marker.ownerId);
      for (const part of parts) {
        const partHash = createHash('sha256'), filename = childPath(repository, 'blobs', part.sha256.slice(0, 2), part.sha256 + '.bin'); let partBytes = 0;
        await readChunks(fs, filename, async chunk => { partBytes += chunk.length; bytes += chunk.length; partHash.update(chunk); hash.update(chunk); await onChunk(chunk); }, { ...settings, maximum: PART_BYTES });
        if (partBytes !== part.bytes || partHash.digest('hex') !== part.sha256) throw Error('备份分卷缺失、损坏或哈希不一致，未登记恢复结果。');
      }
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw Error('备份文件的完整字节与哈希不一致。');
    }
    files.set(file.path, {
      kind: 'xuzuo-stream-file', bytes: file.bytes, sha256: file.sha256,
      async verify() { await consume(() => undefined); verifiedBytes += file.bytes; },
      async readBytes() { const chunks = []; await consume(chunk => { chunks.push(Buffer.from(chunk)); }); return Buffer.concat(chunks, file.bytes); },
      async copyTo(destination, overrides) {
        await checkedDirectory(fs, path.dirname(destination), true); await freeSpace(fs, path.dirname(destination), file.bytes);
        const output = await fs.open(destination, 'wx');
        try { await consume(async chunk => { let offset = 0; while (offset < chunk.length) { const result = await output.write(chunk, offset); if (!result.bytesWritten) throw Error('恢复文件未能完整写入。'); offset += result.bytesWritten; } }, overrides); await output.sync(); } finally { await output.close(); }
        const saved = await fileIdentity(fs, destination, { ...options, ...overrides });
        if (saved.bytes !== file.bytes || saved.sha256 !== file.sha256) throw Error('恢复文件写入核验失败，独立恢复副本保留。');
      },
    });
  }
  return { files, async verify() { for (const source of files.values()) await source.verify(); return { verifiedBytes, peakReadBytes: READ_BYTES }; } };
}
async function readIndex(fs, repository, marker) {
  const value = await readJson(fs, path.join(repository, 'index.json'));
  if (value.kind !== 'xuzuo-incremental-index' || value.version !== 1 || value.ownerId !== marker.ownerId || !Array.isArray(value.snapshots) || value.snapshots.length > 10000 || new Set(value.snapshots.map(item => item.id)).size !== value.snapshots.length || value.snapshots.some(item => !validId(item.id) || item.fileName !== item.id + SNAPSHOT_SUFFIX || !hex(item.sha256))) throw Error('自动备份目录索引无效，已有快照未修改。');
  return value;
}
async function openSnapshot(filePath, { fileSystem = fsDefault, signal, yieldBackground } = {}) {
  const fs = fileSystem, filename = path.resolve(filePath), repository = path.dirname(path.dirname(filename));
  if (path.basename(path.dirname(filename)) !== 'snapshots') throw Error('请选择自动备份 snapshots 目录中的快照文件。');
  const marker = await checkRepository(fs, repository), value = await readJson(fs, filename);
  if (path.basename(filename) !== value.snapshotId + SNAPSHOT_SUFFIX) throw Error('快照文件名与内部编号不一致。');
  const index = await readIndex(fs, repository, marker), committed = index.snapshots.find(item => item.id === value.snapshotId);
  const identity = await fileIdentity(fs, filename, { signal, yieldBackground, maximum: MAX_METADATA });
  if (!committed || committed.fileName !== path.basename(filename) || committed.sha256 !== identity.sha256) throw Error('快照尚未完成提交或快照索引哈希不一致，未登记恢复结果。');
  const bytes = validateSnapshot(value, marker), sources = fileSources(fs, repository, marker, value, { signal, yieldBackground });
  const verification = await sources.verify();
  return { manifest: value.manifest, files: sources.files, repository, ownerId: marker.ownerId, snapshotId: value.snapshotId, bytes, verification };
}
async function createSnapshotWriter({ repository, ownerId, fileSystem = fsDefault, signal, yieldBackground }) {
  const fs = fileSystem, marker = await checkRepository(fs, repository, ownerId), id = randomUUID(), job = childPath(repository, '.incomplete', id);
  await checkedDirectory(fs, path.join(repository, '.incomplete')); await fs.mkdir(job);
  const state = { kind: 'xuzuo-incremental-write', version: 1, ownerId, id, phase: 'copying', files: 0, bytes: 0, createdAt: new Date().toISOString() };
  const pieces = new Map(), sourceStats = new Map(), directoryStats = new Map(); let newBytes = 0, reusedBytes = 0, total = 0;
  const writeState = () => atomicJson(fs, path.join(job, 'state.json'), state);
  await writeState();
  async function finishPart(temporary, bytes, sha256) {
    const actual = await fileIdentity(fs, temporary, { signal, yieldBackground, maximum: PART_BYTES });
    if (actual.bytes !== bytes || actual.sha256 !== sha256) throw Error('新备份分卷写入后校验失败，未替换已有快照。');
    await checkRepository(fs, repository, ownerId); const folder = childPath(repository, 'blobs', sha256.slice(0, 2)); await checkedDirectory(fs, folder, true);
    const destination = path.join(folder, sha256 + '.bin');
    try { await fs.link(temporary, destination); newBytes += bytes; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const saved = await fileIdentity(fs, destination, { signal, yieldBackground, maximum: PART_BYTES });
      if (saved.bytes !== bytes || saved.sha256 !== sha256) throw Error('已有备份分卷内容已改变，未覆盖它。');
      reusedBytes += bytes;
    }
    await fs.unlink(temporary);
    return { bytes, sha256 };
  }
  async function add(relative, consume) {
    safePath(relative); active(signal); if (pieces.has(relative.toLowerCase())) throw Error('备份文件路径重复。');
    if (pieces.size >= MAX_FILES - 1) throw Error('备份超过49999个文件，请分工作区保存。');
    const hash = createHash('sha256'), parts = []; let bytes = 0, partBytes = 0, partHash, output, temporary;
    async function beginPart() { await freeSpace(fs, repository, PART_BYTES); temporary = childPath(job, `${pieces.size}-${parts.length}.part`); output = await fs.open(temporary, 'wx'); partHash = createHash('sha256'); partBytes = 0; }
    async function closePart() { await output.sync(); await output.close(); output = undefined; parts.push(await finishPart(temporary, partBytes, partHash.digest('hex'))); }
    try {
      await consume(async chunk => {
        let offset = 0;
        while (offset < chunk.length) {
          await yieldToInteraction(signal, yieldBackground); if (!output) await beginPart();
          const length = Math.min(chunk.length - offset, PART_BYTES - partBytes), piece = chunk.subarray(offset, offset + length);
          let written = 0; while (written < piece.length) { const result = await output.write(piece, written); if (!result.bytesWritten) throw Error('备份分卷未能完整写入。'); written += result.bytesWritten; }
          bytes += length; total += length; partBytes += length; offset += length; hash.update(piece); partHash.update(piece);
          if (bytes > MAX_FILE || total > MAX_TOTAL) throw Error('增量备份超过单文件100MB或总量16GB限制。');
          if (partBytes === PART_BYTES) await closePart();
        }
      });
      if (output) await closePart();
    } finally { if (output) await output.close(); }
    const descriptor = { path: relative, bytes, sha256: hash.digest('hex') }; pieces.set(relative.toLowerCase(), { path: relative, parts });
    state.files = pieces.size; state.bytes = total; await writeState(); return descriptor;
  }
  return {
    id, workspaceId: marker.workspaceId,
    async trackDirectory(directory) { await checkedDirectory(fs, directory); if (!directoryStats.has(directory)) directoryStats.set(directory, await fs.lstat(directory)); },
    trackFile(filename, stat) { sourceStats.set(filename, stat); },
    async addFile(filename, relative) { const before = await ordinaryFile(fs, filename); const value = await add(relative, consume => readChunks(fs, filename, consume, { signal, yieldBackground })); sourceStats.set(filename, before); return value; },
    addBuffer(buffer, relative) { if (!Buffer.isBuffer(buffer) || buffer.length > MAX_FILE) throw Error('备份材料不是受支持的有限文件。'); return add(relative, async consume => { for (let at = 0; at < buffer.length; at += READ_BYTES) await consume(buffer.subarray(at, at + READ_BYTES)); }); },
    async commit(manifest, validate, beforeCommit) {
      if (manifest.backupId !== id) throw Error('备份编号与写入任务不一致。');
      const snapshot = { kind: 'xuzuo-incremental-snapshot', version: 1, ownerId, snapshotId: id, manifest, files: [...pieces.values()] };
      const bytes = validateSnapshot(snapshot, marker), sources = fileSources(fs, repository, marker, snapshot, { signal, yieldBackground });
      const verification = await sources.verify(); await validate?.(manifest, sources.files);
      validateSnapshot(snapshot, marker);
      for (const [filename, before] of sourceStats) if (!sameFile(before, await ordinaryFile(fs, filename))) throw Error('源文件在备份完成前发生变化，原文件与上次快照保留。');
      for (const [directory, before] of directoryStats) { await checkedDirectory(fs, directory); const after = await fs.lstat(directory); if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) throw Error('源目录在备份期间发生变化，请空闲后重新备份。'); }
      await yieldToInteraction(signal, yieldBackground); await beforeCommit?.(); active(signal); await checkRepository(fs, repository, ownerId);
      metadataBytes(snapshot, MAX_METADATA - 1);
      const encoded = Buffer.from(JSON.stringify(snapshot) + '\n');
      const temporary = path.join(job, 'snapshot.json.partial'), handle = await fs.open(temporary, 'wx'); try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      const snapshotPath = childPath(repository, 'snapshots', id + SNAPSHOT_SUFFIX); await checkedDirectory(fs, path.dirname(snapshotPath)); await fs.rename(temporary, snapshotPath);
      const index = await readIndex(fs, repository, marker); if (index.snapshots.length >= 10000) throw Error('备份快照超过10000份，请选择新的备份位置。');
      const summary = { id, fileName: id + SNAPSHOT_SUFFIX, createdAt: manifest.createdAt, files: manifest.files.length, bytes, newBytes, reusedBytes, sha256: digest(encoded), projects: manifest.meta.projects.filter(project => !project.purgedAt).length };
      index.snapshots.push(summary); await atomicJson(fs, path.join(repository, 'index.json'), index);
      state.phase = 'complete'; state.snapshotPath = snapshotPath; await writeState().catch(() => undefined);
      return { saved: true, path: snapshotPath, snapshotPath, backupId: id, files: summary.files, bytes, newBytes, reusedBytes, volumes: new Set(snapshot.files.flatMap(file => file.parts.map(part => part.sha256))).size, projects: summary.projects, verification };
    },
    async fail(error) { state.phase = error?.name === 'AbortError' ? 'cancelled' : 'failed'; state.error = String(error?.message || error).slice(0, 1000); await writeState(); },
  };
}
module.exports = { MARKER, SNAPSHOT_SUFFIX, repositoryPath, createRepository, checkRepository, validateStreamManifest, validateSnapshot, openSnapshot, createSnapshotWriter, readIndex };
