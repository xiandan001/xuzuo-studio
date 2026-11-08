const path = require('node:path');

// macOS ships these root aliases. User-created links are never accepted by this policy.
const systemAlias = value => /^\/(?:tmp|var|etc)(?=\/|$)/.exec(value)?.[0];
function macSystemPath(value, platform = process.platform) {
  const absolute = path.resolve(value), alias = platform === 'darwin' && systemAlias(absolute);
  return alias ? `/private${absolute}` : absolute;
}
async function resolveMacSystemPath(fs, value, platform = process.platform) {
  const absolute = path.resolve(value), alias = platform === 'darwin' && systemAlias(absolute);
  if (!alias) return absolute;
  const expected = `/private${alias}`, stat = await fs.lstat(alias);
  if (!stat.isSymbolicLink()) return absolute;
  if (path.resolve(await fs.realpath(alias)) !== expected) throw new Error('系统路径别名已变化，已拒绝访问。');
  const target = await fs.lstat(expected);
  if (target.isSymbolicLink() || !target.isDirectory()) throw new Error('系统路径别名目标无效，已拒绝访问。');
  return `/private${absolute}`;
}
module.exports = { macSystemPath, resolveMacSystemPath };
