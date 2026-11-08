const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');
const { resolveMacSystemPath } = require('./macos-system-paths.cjs');
const { randomUUID } = require('node:crypto');

const JOURNAL_NAME = 'artifact-move-v1.json';
function safeBasename(value) {
  return typeof value === 'string' && value.length > 0 && !['.', '..'].includes(value) && !/[<>:"|?*\\/\x00-\x1f]/.test(value) && !/[.\s]$/.test(value) && path.basename(value) === value;
}

function createTrashStore({ directory, fileSystem = defaultFileSystem, maxBytes }) {
  const root = path.resolve(directory);
  const fs = fileSystem;
  const areaPath = area => {
    if (!['files', 'trash'].includes(area)) throw new Error('产物目录无效。');
    return path.join(root, area);
  };
  const filePath = (area, name) => {
    if (!safeBasename(name)) throw new Error('产物文件名无效，已拒绝目录外操作。');
    const filename = path.resolve(areaPath(area), name);
    if (path.dirname(filename) !== areaPath(area)) throw new Error('产物路径超出管理目录。');
    return filename;
  };

  async function ensureDirectory(directoryName, create) {
    const absolute = await resolveMacSystemPath(fs, directoryName);
    const drive = path.parse(absolute).root;
    let current = drive;
    for (const part of absolute.slice(drive.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) return false;
        try { await fs.mkdir(current); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
        stat = await fs.lstat(current);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('产物目录包含符号链接、junction 或非目录，已拒绝操作。');
    }
    return true;
  }

  async function ensureRoot(create = false) { return ensureDirectory(root, create); }
  async function ensureArea(area, create = false) { return ensureDirectory(areaPath(area), create); }

  async function inspect(area, name) {
    const filename = filePath(area, name);
    if (!(await ensureArea(area))) return null;
    let stat;
    try { stat = await fs.lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('产物是符号链接或非普通文件，已拒绝操作。');
    if (stat.size > maxBytes) throw new Error('产物超过允许的文件大小，已拒绝操作。');
    return { filename, stat };
  }

  async function existingPath(area, name) {
    const value = await inspect(area, name);
    if (!value) throw new Error('产物文件已不存在，请保留记录并检查本机文件。');
    return value.filename;
  }

  async function controlPath(name, createRoot = false) {
    if (!safeBasename(name)) throw new Error('产物状态文件名无效。');
    const filename = path.join(root, name);
    if (!(await ensureRoot(createRoot))) return null;
    try {
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('产物状态文件包含符号链接或不是普通文件，已拒绝操作。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return filename;
  }

  async function move(from, to) {
    const source = await existingPath(from.area, from.name);
    await ensureArea(to.area, true);
    const destination = filePath(to.area, to.name);
    if (await inspect(to.area, to.name)) throw new Error('目标位置已有文件，已保留已有内容。');
    await fs.rename(source, destination);
    return destination;
  }

  async function readJournal() {
    const filename = await controlPath(JOURNAL_NAME);
    if (!filename) return null;
    try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('产物回收事务记录无法读取，文件已保留，请勿清理管理目录。'); }
  }

  async function clearJournal() {
    const filename = await controlPath(JOURNAL_NAME);
    if (!filename) return;
    try { await fs.unlink(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function writeJournal(value) {
    const filename = await controlPath(JOURNAL_NAME, true);
    try { await fs.lstat(filename); throw new Error('上次回收操作仍待恢复，请先重新读取回收站。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, filename);
    } catch (error) {
      try { await fs.unlink(temporary); } catch { /* Only this new transaction temporary file is removed. */ }
      throw error;
    }
  }

  return { root, ensureRoot, ensureArea, inspect, existingPath, controlPath, filePath, move, readJournal, writeJournal, clearJournal };
}

module.exports = { createTrashStore, safeBasename };
