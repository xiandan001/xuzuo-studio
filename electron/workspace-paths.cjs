const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const key = filename => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename);
const inside = (root, filename) => key(root) === key(filename) || key(filename).startsWith(`${key(root)}${path.sep}`);
function safeFolder(name, projectId) {
  let stem = String(name || '未命名项目').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[.\s]+$/g, '').trim().slice(0, 48) || '项目';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `项目-${stem}`;
  return `${stem}-${createHash('sha256').update(projectId).digest('hex').slice(0, 12)}`;
}
async function checkedDirectory(fs, directory, create = false) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择有效的本地绝对目录。');
  const absolute = path.resolve(directory), drive = path.parse(absolute).root;
  let current = drive;
  for (const part of absolute.slice(drive.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) throw new Error('本地工作区目录已不可用，请重新连接原目录。');
      try { await fs.mkdir(current); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('工作区路径包含符号链接、junction 或非目录，已拒绝操作。');
  }
  return absolute;
}
async function checkedFile(fs, filename) {
  await checkedDirectory(fs, path.dirname(filename));
  const stat = await fs.lstat(filename);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('项目文件包含符号链接或不是普通文件，已拒绝操作。');
  if (stat.size > 100 * 1024 * 1024) throw new Error('项目文件超过 100 MB，未执行迁移。');
  return stat;
}
async function copyVerifiedFile(fs, source, destination) {
  const before = await checkedFile(fs, source);
  await checkedDirectory(fs, path.dirname(destination), true);
  const bytes = await fs.readFile(source);
  if (bytes.length !== before.size) throw new Error('迁移期间源文件发生变化，原文件已保留。');
  try { await fs.writeFile(destination, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await checkedFile(fs, destination); }
  const saved = await fs.readFile(destination);
  const hash = value => createHash('sha256').update(value).digest('hex');
  if (saved.length !== bytes.length || hash(saved) !== hash(bytes)) throw new Error('目标目录有不同内容的文件，未覆盖已有内容，原文件已保留。');
  const after = await checkedFile(fs, source);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('迁移期间源文件发生变化，原文件已保留。');
}
async function copyProjectTree(fs, source, destination) {
  await checkedDirectory(fs, source); await checkedDirectory(fs, destination, true);
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) throw new Error('项目中包含符号链接或 junction，未移动工作区。');
    if (stat.isDirectory()) await copyProjectTree(fs, from, to);
    else if (stat.isFile()) await copyVerifiedFile(fs, from, to);
    else throw new Error('项目中包含非普通文件，未移动工作区。');
  }
}
async function verifyProjectTree(fs, source, destination) {
  await checkedDirectory(fs, source); await checkedDirectory(fs, destination);
  const names = await fs.readdir(source), copied = await fs.readdir(destination);
  if (names.length !== copied.length || names.some(name => !copied.includes(name))) throw new Error('搬迁期间目录内容发生变化，未切换登记，原目录与复制副本均保留。');
  for (const name of names) {
    const from = path.join(source, name), to = path.join(destination, name), stat = await fs.lstat(from), target = await fs.lstat(to);
    if (stat.isSymbolicLink() || target.isSymbolicLink()) throw new Error('搬迁核验发现链接，未切换目录。');
    if (stat.isDirectory() && target.isDirectory()) await verifyProjectTree(fs, from, to);
    else if (stat.isFile() && target.isFile()) {
      await checkedFile(fs, from); await checkedFile(fs, to);
      if (stat.size !== target.size || hash(await fs.readFile(from)) !== hash(await fs.readFile(to))) throw new Error('搬迁核验发现文件内容不一致，未切换目录。');
    } else throw new Error('搬迁核验发现文件类型不一致，未切换目录。');
  }
}
const hash = value => createHash('sha256').update(value).digest('hex');
async function atomicJson(fs, filename, value) {
  await checkedDirectory(fs, path.dirname(filename), true);
  try { await checkedFile(fs, filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try { await fs.rename(temporary, filename); }
  catch (error) { try { await fs.unlink(temporary); } catch { /* Only this new temporary is removed. */ } throw error; }
}
module.exports = { key, inside, safeFolder, checkedDirectory, checkedFile, copyVerifiedFile, copyProjectTree, verifyProjectTree, atomicJson };
