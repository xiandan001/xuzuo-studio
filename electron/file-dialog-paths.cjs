const path = require('node:path');
const { resolveMacSystemPath } = require('./macos-system-paths.cjs');

const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
function sameIdentity(left, right) {
  return left.dev != null && left.ino != null && String(left.ino) !== '0' && String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino) && left.isDirectory() === right.isDirectory() && left.isFile() === right.isFile();
}
const changed = () => new Error('路径对应的位置已变化，请重新选择普通文件或文件夹。');

// Share only within one policy preparation or selection; never retain filesystem metadata between user operations.
function createDialogPathResolver(fs) {
  const directoryStats = new Map();
  async function checkedParents(directory, assertActive, fresh = false) {
    const drive = path.parse(directory).root;
    let current = drive;
    for (const part of [null, ...directory.slice(drive.length).split(path.sep).filter(Boolean)]) {
      assertActive();
      if (part !== null) current = path.join(current, part);
      if (fresh || !directoryStats.has(current)) directoryStats.set(current, fs.lstat(current));
      const stat = await directoryStats.get(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目录不可用或包含链接，请选择普通文件夹。');
    }
  }
  return async function resolve(value, { allowMissing = false, requireDirectory = false, validateCanonical = () => undefined, assertActive = () => undefined } = {}) {
    const target = await resolveMacSystemPath(fs, value), suffix = [];
    let existing = target, before;
    for (;;) {
      assertActive();
      try { await checkedParents(path.dirname(existing), assertActive); before = await fs.lstat(existing); break; }
      catch (error) {
        const parent = path.dirname(existing);
        if (!allowMissing || error.code !== 'ENOENT' || parent === existing) throw error;
        suffix.unshift(path.basename(existing)); existing = parent;
      }
    }
    if (before.isSymbolicLink() || !before.isDirectory() && (!before.isFile() || suffix.length || requireDirectory)) throw new Error('位置不可用或包含链接，请选择普通文件或文件夹。');
    const canonical = path.resolve(await fs.realpath(existing)), resolved = path.join(canonical, ...suffix);
    validateCanonical(resolved);
    await checkedParents(path.dirname(canonical), assertActive);
    const after = samePath(existing, canonical) ? before : await fs.lstat(canonical);
    if (after.isSymbolicLink() || before.isDirectory() !== after.isDirectory() || before.isFile() !== after.isFile()) throw changed();
    if (!samePath(existing, canonical)) {
      await checkedParents(path.dirname(existing), assertActive, true);
      const current = await fs.lstat(existing);
      if (current.isSymbolicLink() || !sameIdentity(before, current) || !sameIdentity(current, after)) throw changed();
    }
    assertActive();
    return { path: resolved, stat: suffix.length ? undefined : after };
  };
}

module.exports = { createDialogPathResolver, samePath };
