const path = require('node:path');
const { inside, key, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const areas = new Set(['files', 'trash', '.xuzuo']);
const same = (left, right) => key(left) === key(right);

async function preparedFolder(fs, directory, projectId) {
  if (!projectId) return false;
  try {
    const names = await fs.readdir(directory);
    if (names.some(name => !areas.has(name.toLowerCase()))) return false;
    const control = path.join(directory, '.xuzuo'), filename = path.join(control, 'project-v1.json');
    await checkedDirectory(fs, control); await checkedFile(fs, filename);
    const marker = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (marker.version !== 1 || marker.projectId !== projectId || (await fs.readdir(control)).some(name => name !== 'project-v1.json')) return false;
    for (const name of ['files', 'trash']) {
      const area = path.join(directory, name);
      try { await fs.lstat(area); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await checkedDirectory(fs, area); if ((await fs.readdir(area)).length) return false;
    }
    return true;
  } catch { return false; }
}

async function inspectSelectedProjectFolder({ fs, workspace, projects, locations, directory: selected, projectId }) {
  const directory = await checkedDirectory(fs, selected);
  if (!inside(workspace.directory, directory) || same(workspace.directory, directory)) throw new Error('请选择当前工作区内独立的项目子文件夹，不能使用工作区根目录。');
  const relative = path.relative(key(workspace.directory), key(directory));
  if (relative.split(path.sep).some(name => ['.xuzuo', '.xuzuo-assets'].includes(name.toLowerCase()) || name.toLowerCase().startsWith('.xuzuo-purge-'))) throw new Error('所选文件夹属于应用内部资料区域，请选择其他项目文件夹。');
  if ([...projects, ...locations].some(item => inside(item.directory, directory) || inside(directory, item.directory))) throw new Error('所选文件夹与已有项目目录重叠，请选择独立的空文件夹。');
  const names = await fs.readdir(directory);
  if (names.length && !await preparedFolder(fs, directory, projectId)) throw new Error('请选择空文件夹；已有文件或项目身份不会被覆盖。');
  return { workspaceId: workspace.workspaceId, directory, folderName: path.basename(directory) };
}

async function prepareSelectedProjectFolder(fs, directory, projectId) {
  await checkedDirectory(fs, directory);
  const control = path.join(directory, '.xuzuo');
  if (!await preparedFolder(fs, directory, projectId)) {
    if ((await fs.readdir(directory)).length) throw new Error('文件夹内容已变化，请重新选择空文件夹。');
    try { await fs.mkdir(control); }
    catch { throw new Error('项目目录已被占用或无法写入，未覆盖已有内容。'); }
    try {
      if ((await fs.readdir(directory)).some(name => name !== '.xuzuo')) throw new Error('文件夹内容已变化，请重新选择空文件夹。');
      await fs.writeFile(path.join(control, 'project-v1.json'), `${JSON.stringify({ version: 1, projectId })}\n`, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      try { await checkedDirectory(fs, control); await fs.rmdir(control); } catch { /* Only the new empty control directory may be removed; existing contents stay. */ }
      throw error;
    }
  }
  for (const name of ['files', 'trash']) {
    const area = path.join(directory, name);
    try { await fs.mkdir(area); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await checkedDirectory(fs, area);
  }
  if (!await preparedFolder(fs, directory, projectId)) throw new Error('项目准备目录中出现额外内容，请保留原文件并重新选择空文件夹。');
}
module.exports = { inspectSelectedProjectFolder, prepareSelectedProjectFolder };
