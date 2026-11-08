const path = require('node:path');

const windowsPath = value => typeof value === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
function sourcePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('备份目录路径无效。');
  const windows = windowsPath(value), paths = windows ? path.win32 : path.posix;
  if (!paths.isAbsolute(value) || windows && (/^\\\\[.?]\\/.test(value) || value.slice(3).includes(':'))) throw new Error('备份目录路径无效。');
  const normalized = paths.normalize(value);
  // Backups describe paths on the source machine. Only fixed macOS system aliases are equivalent.
  return { windows, paths, value: windows ? normalized : normalized.replace(/^\/(?:var|tmp|etc)(?=\/|$)/, alias => `/private${alias}`) };
}
function backupRelative(root, target) {
  const parent = sourcePath(root), child = sourcePath(target);
  if (parent.windows !== child.windows) throw new Error('备份项目路径不属于其工作区。');
  const relative = parent.paths.relative(parent.value, child.value);
  if (relative === '..' || relative.startsWith(`..${parent.paths.sep}`) || parent.paths.isAbsolute(relative)) throw new Error('备份项目路径不属于其工作区。');
  return relative.split(parent.paths.sep).join('/');
}
module.exports = { backupRelative, windowsPath };
