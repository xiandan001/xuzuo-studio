const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { checkedDirectory } = require('./workspace-paths.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const snapshotName = /^revision-([1-9]\d*)-([a-f0-9]{64})(?:-[a-f0-9-]+)?\.json$/;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sameRaw = (left, right) => Buffer.isBuffer(left) && Buffer.isBuffer(right) ? left.equals(right) : left === right;

function createRevisionStore({ fileSystem: fs, location, prefix, validateRecord, maxBytes }) {
  async function area(projectId, create = false) {
    const place = await location(projectId), directory = path.join(place.directory, `${prefix}-revisions-v1`);
    try { await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT' && !create) return { ...place, snapshotDirectory: directory, absent: true }; if (error.code !== 'ENOENT') throw error; }
    await checkedDirectory(fs, directory, create);
    return { ...place, snapshotDirectory: directory, index: path.join(directory, 'index-v1.json') };
  }
  async function ordinary(filename, limit = maxBytes * 2, binary = false) {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('历史修订包含链接、非普通文件或超过单修订容量，原文件已保留。');
    const bytes = await fs.readFile(filename);
    if (binary) return bytes;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('文件 UTF-8 编码损坏，原始字节仍保留。'); }
  }
  async function indexAt(place, projectId) {
    if (place.absent) return { entries: [], highWater: 0 };
    let raw;
    try { raw = await ordinary(place.index, 16 * 1024 * 1024, true); }
    catch (error) { if (error.code === 'ENOENT') return { entries: [], highWater: 0 }; throw error; }
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (value.version !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.highWater) || value.highWater < 0 || !Array.isArray(value.entries) || value.entries.some(item => !Number.isSafeInteger(item.revision) || item.revision < 1 || !snapshotName.test(item.fileName) || !/^[a-f0-9]{64}$/.test(item.hash) || typeof item.committed !== 'boolean')) throw new Error('invalid');
      if (new Set(value.entries.map(item => item.revision)).size !== value.entries.length || value.entries.some(item => Number(snapshotName.exec(item.fileName)[1]) !== item.revision || snapshotName.exec(item.fileName)[2] !== item.hash || item.revision > value.highWater)) throw new Error('invalid');
      return { ...value, raw };
    } catch { return { entries: [], highWater: 0, invalidRaw: raw }; }
  }
  async function snapshotsAt(place, projectId, revision) {
    if (place.absent || revision === null) return [];
    const result = [];
    for (const name of await fs.readdir(place.snapshotDirectory)) {
      const match = snapshotName.exec(name); if (!match) continue;
      if (revision !== undefined && Number(match[1]) !== revision) continue;
      try {
        const value = JSON.parse(await ordinary(path.join(place.snapshotDirectory, name)));
        const digest = hash(JSON.stringify(value.record)), record = validateRecord(value.record, projectId);
        if (value.version !== 1 || value.projectId !== projectId || value.hash !== digest || match[2] !== digest || record.revision !== Number(match[1])) continue;
        result.push({ record, fileName: name, hash: digest });
      } catch { /* A bad independent revision cannot hide the other valid revisions. */ }
    }
    return result;
  }
  async function inspect(projectId, revision) {
    const place = await area(projectId), index = await indexAt(place, projectId), snapshots = await snapshotsAt(place, projectId, revision);
    const names = place.absent ? [] : await fs.readdir(place.snapshotDirectory);
    const highWater = Math.max(index.highWater, ...names.map(name => Number(snapshotName.exec(name)?.[1] || 0)), 0);
    if (!Number.isSafeInteger(highWater) || highWater >= Number.MAX_SAFE_INTEGER) throw new Error('历史版本编号无效，未写入新版本。');
    return { place, index, snapshots, highWater };
  }
  async function replaceIndex(place, projectId, index, entries, highWater) {
    if (index.invalidRaw !== undefined) {
      await fs.writeFile(path.join(place.snapshotDirectory, `index-invalid-${randomUUID()}.json`), index.invalidRaw, { encoding: 'utf8', flag: 'wx' });
    }
    const temporary = path.join(place.snapshotDirectory, `index-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify({ version: 1, projectId, highWater, entries })}\n`, { encoding: 'utf8', flag: 'wx' });
    try { await fs.rename(temporary, place.index); }
    catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
  }
  async function put(projectId, record, committed) {
    record = validateRecord(record, projectId);
    if (Buffer.byteLength(JSON.stringify({ ...record, history: [] })) > maxBytes) throw new Error('当前修订超过单修订容量，未保存。');
    const found = await inspect(projectId, record.revision), place = await area(projectId, true);
    const existing = found.snapshots.filter(item => item.record.revision === record.revision);
    if (existing.some(item => !same(item.record, record))) throw new Error('此修订已有不同内容的独立快照，未覆盖原始历史。');
    const digest = hash(JSON.stringify(record));
    let entry = existing.find(item => item.hash === digest);
    if (!entry) {
      let fileName = `revision-${record.revision}-${digest}.json`;
      const contents = `${JSON.stringify({ version: 1, projectId, hash: digest, record })}\n`;
      try { await fs.writeFile(path.join(place.snapshotDirectory, fileName), contents, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        fileName = `revision-${record.revision}-${digest}-${randomUUID()}.json`;
        await fs.writeFile(path.join(place.snapshotDirectory, fileName), contents, { encoding: 'utf8', flag: 'wx' });
      }
      entry = { record, fileName, hash: digest };
    }
    const previous = found.index.entries.find(item => item.revision === record.revision);
    if (previous?.fileName === entry.fileName && previous.hash === digest && (previous.committed || !committed)) return record;
    const next = { revision: record.revision, fileName: entry.fileName, hash: digest, committed: Boolean(committed || previous?.committed) };
    const entries = [...found.index.entries.filter(item => item.revision !== record.revision), next];
    await replaceIndex(place, projectId, found.index, entries, Math.max(found.highWater, record.revision));
    return record;
  }
  async function list(projectId, records = []) {
    const found = await inspect(projectId), result = new Map();
    for (const item of found.snapshots) {
      const alternatives = found.snapshots.filter(other => other.record.revision === item.record.revision);
      if (new Set(alternatives.map(other => other.hash)).size > 1 && !found.index.entries.some(entry => alternatives.some(other => entry.revision === other.record.revision && entry.fileName === other.fileName && entry.hash === other.hash))) continue;
      const indexed = found.index.entries.find(entry => entry.revision === item.record.revision && entry.fileName === item.fileName && entry.hash === item.hash);
      const state = indexed ? indexed.committed ? 'saved' : 'prepared' : 'unverified';
      const previous = result.get(item.record.revision);
      if (!previous || state === 'saved') result.set(item.record.revision, { ...item.record, recoveryState: state });
    }
    for (const value of records) { const record = validateRecord(value, projectId); const previous = result.get(record.revision); if (!previous || same(validateRecord(previous, projectId), record)) result.set(record.revision, { ...record, recoveryState: 'saved' }); }
    return [...result.values()].sort((a, b) => b.revision - a.revision);
  }
  async function commit(projectId, record, originalRaw, { restore = false, legacy = [] } = {}) {
    const place = await location(projectId);
    for (const prior of legacy) await put(projectId, prior, true);
    await put(projectId, record, false);
    const serialized = `${JSON.stringify({ ...record, history: [] })}\n`;
    if (Buffer.byteLength(serialized) > maxBytes) throw new Error('当前修订超过单修订容量，未保存。');
    const readOriginal = async () => { try { return await ordinary(place.filename, restore ? 100 * 1024 * 1024 : maxBytes, restore); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
    if (!sameRaw(await readOriginal(), originalRaw)) throw new Error('编辑源已在另一处更新，未覆盖原稿，请重新读取后再保存。');
    if (restore && originalRaw !== undefined) await fs.writeFile(path.join(place.directory, `${prefix}-before-restore-${randomUUID()}.json`), originalRaw, { encoding: 'utf8', flag: 'wx' });
    const temporary = path.join(place.directory, `${prefix}-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    try { await location(projectId); if (!sameRaw(await readOriginal(), originalRaw)) throw new Error('编辑源已在另一处更新，未覆盖原稿。'); await fs.rename(temporary, place.filename); }
    catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
    await put(projectId, record, true);
    return record;
  }
  async function raw(projectId, restore = false) { const place = await location(projectId); try { return await ordinary(place.filename, restore ? 100 * 1024 * 1024 : maxBytes, restore); } catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error(`${prefix === 'workbook' ? '工作簿编辑源' : '编辑源文件'}无法安全读取，原文件已保留，请检查独立历史版本。`); } }
  return { list, commit, raw, async nextRevision(projectId, current = 0) { const found = await inspect(projectId, null); return Math.max(found.highWater, current) + 1; } };
}
module.exports = { createRevisionStore };
