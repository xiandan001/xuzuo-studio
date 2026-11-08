const path = require('node:path');
const { resolveMacSystemPath } = require('./macos-system-paths.cjs');
const { createHash } = require('node:crypto');
const { key, inside } = require('./workspace-paths.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;

async function ancestors(fs, target) {
  const absolute = await resolveMacSystemPath(fs, target), root = path.parse(absolute).root; let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('目录包含链接、junction或非目录，未删除文件。');
  }
  return fs.lstat(absolute);
}
async function jsonMarker(fs, filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('目录身份标记不安全，未删除文件。');
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}
async function inspectTree(fs, directory, projectId, expected) {
  let count = 0;
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (++count > 200000) throw Error('项目文件数量超过安全处理范围，请先整理目录。');
      const filename = path.join(current, entry.name), stat = await fs.lstat(filename);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw Error('项目中包含链接、junction或特殊文件，未删除文件。');
      if (entry.name.toLowerCase() === '.xuzuo-workspace-v1.json' || key(current) !== key(path.join(directory, '.xuzuo')) && entry.name.toLowerCase() === 'project-v1.json' && path.basename(current).toLowerCase() === '.xuzuo') throw Error('项目内嵌套了其它工作区或项目，未删除文件。');
      if (stat.isDirectory()) await walk(filename);
    }
  }
  let marker;
  try { marker = await jsonMarker(fs, path.join(directory, '.xuzuo', 'project-v1.json')); }
  catch (error) { if (error.code !== 'ENOENT' || !expected) throw error; }
  if (marker && (marker.version !== 1 || marker.projectId !== projectId)) throw Error('项目目录身份不匹配，未删除文件。');
  await walk(directory); return marker ? hash(JSON.stringify(marker)) : expected.markerHash;
}
async function inspectPurgeDirectory({ fs, target, metadata, protectedRoots = [], expected, quarantine = false }) {
  const workspace = metadata.workspaces.find(item => item.workspaceId === target.workspaceId), directory = path.resolve(target.directory || '');
  if (!workspace || !target.directory || !path.isAbsolute(target.directory) || key(directory) === key(path.parse(directory).root) || !inside(workspace.directory, directory) || key(workspace.directory) === key(directory)) throw Error('删除位置不是当前工作区内独立项目目录。');
  if (path.relative(key(workspace.directory), key(directory)).split(path.sep).some(part => ['.xuzuo', '.xuzuo-assets'].includes(part.toLowerCase()))) throw Error('不能删除应用内部资料区域。');
  if ([...protectedRoots, ...metadata.workspaces.map(item => item.directory)].some(root => inside(directory, root) || protectedRoots.includes(root) && inside(root, directory))) throw Error('删除位置涉及工作区根或应用受保护目录。');
  if ([...metadata.projects, ...metadata.locations].some(item => item.projectId !== target.projectId && (inside(directory, item.directory) || inside(item.directory, directory)))) throw Error('删除位置与其它项目或历史目录重叠。');
  let stat;
  try { stat = await ancestors(fs, directory); } catch (error) { if (error.code === 'ENOENT' && !quarantine) return { missing: true }; throw error; }
  await ancestors(fs, workspace.directory);
  const workspaceMarker = await jsonMarker(fs, path.join(workspace.directory, '.xuzuo-workspace-v1.json'));
  if (workspaceMarker.version !== 1 || workspaceMarker.workspaceId !== target.workspaceId) throw Error('工作区目录身份不匹配。');
  const canonical = await fs.realpath(directory), canonicalWorkspace = await fs.realpath(workspace.directory);
  if (!inside(canonicalWorkspace, canonical) || key(canonicalWorkspace) === key(canonical)) throw Error('项目实际位置超出所属工作区。');
  if (expected && identity(stat) !== expected.identity) throw Error('项目目录身份已变化，未删除新位置或新建目录。');
  const markerHash = await inspectTree(fs, directory, target.projectId, quarantine ? expected : undefined), value = { missing: false, identity: identity(stat), markerHash, canonical };
  if (expected && (value.identity !== expected.identity || value.markerHash !== expected.markerHash)) throw Error('项目目录身份已变化，未删除新位置或新建目录。');
  return value;
}
async function removePurgeTree(fs, directory, expected) {
  const root = await ancestors(fs, directory); if (identity(root) !== expected.identity) throw Error('隔离目录身份已变化，停止删除。');
  async function walk(current) {
    await ancestors(fs, current);
    if (key(current) !== key(directory)) {
      const nested = await fs.lstat(path.join(current, '.xuzuo', 'project-v1.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const workspace = await fs.lstat(path.join(current, '.xuzuo-workspace-v1.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (nested || workspace) throw Error('清理期间出现嵌套项目或工作区，停止删除。');
    }
    for (const name of await fs.readdir(current)) {
      const filename = path.join(current, name), before = await fs.lstat(filename);
      if (before.isSymbolicLink() || !before.isDirectory() && !before.isFile()) throw Error('清理期间发现链接或特殊文件，停止删除。');
      if (before.isDirectory()) await walk(filename);
      else { await ancestors(fs, current); const after = await fs.lstat(filename); if (after.isSymbolicLink() || identity(after) !== identity(before)) throw Error('文件在清理期间变化，已停止。'); await fs.unlink(filename); }
    }
    await ancestors(fs, current); await fs.rmdir(current);
  }
  await walk(directory);
}
module.exports = { inspectPurgeDirectory, removePurgeTree, identity };
