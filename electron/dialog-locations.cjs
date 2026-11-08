const path = require('node:path');
const { execFile } = require('node:child_process');

const driveLocation = (directory, removable = false) => ({ name: `${removable ? '可移动磁盘' : '本地磁盘'} (${directory.slice(0, 2)})`, path: directory, kind: 'drive' });
const canceled = () => Object.assign(new Error('磁盘查询已取消。'), { name: 'AbortError', code: 'ABORT_ERR' });
function defaultHelperPath() {
  const root = path.resolve(__dirname, '..');
  return path.join(/\.asar$/i.test(root) ? `${root}.unpacked` : root, 'assets/windows-drive-info.exe');
}
async function readMacVolumes({ fileSystem, signal }) {
  const fs = fileSystem || require('node:fs/promises');
  const drives = [{ name: '启动磁盘', path: '/', kind: 'drive' }];
  if (signal?.aborted) throw canceled();
  const entries = await fs.readdir('/Volumes', { withFileTypes: true });
  if (entries.length > 256) throw new Error('挂载宗卷数量过多，请直接输入目录路径。');
  for (const entry of entries) {
    if (signal?.aborted) throw canceled();
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const directory = path.posix.join('/Volumes', entry.name);
    try {
      const stat = await fs.lstat(directory);
      if (stat.isDirectory() && !stat.isSymbolicLink()) drives.push({ name: entry.name, path: directory, kind: 'drive' });
    } catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
  }
  if (signal?.aborted) throw canceled();
  return drives;
}
function readLocalDrives({ execute = execFile, platform = process.platform, signal, helperPath = defaultHelperPath(), fileSystem } = {}) {
  if (signal?.aborted) return Promise.reject(canceled());
  if (platform === 'darwin') return readMacVolumes({ fileSystem, signal });
  if (platform !== 'win32') return Promise.resolve([{ name: '文件系统', path: '/', kind: 'drive' }]);
  return new Promise((resolve, reject) => {
    execute(helperPath, [], { windowsHide: true, timeout: 4000, maxBuffer: 16384, encoding: 'utf8', ...(signal ? { signal } : {}) }, (error, stdout) => {
      if (error) { reject(error); return; }
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, ''));
        if (result?.version !== 1 || !Array.isArray(result.drives) || result.drives.length > 26) throw new Error('磁盘助手返回格式无效。');
        const drives = result.drives.filter(item => item && [2, 3].includes(item.type) && typeof item.letter === 'string' && /^[A-Z]$/i.test(item.letter)).map(item => driveLocation(`${item.letter.toUpperCase()}:\\`, item.type === 2));
        if (!drives.length) throw new Error('没有取得本机磁盘列表。');
        resolve([...new Map(drives.map(item => [item.path, item])).values()]);
      } catch (error) { reject(error); }
    });
  });
}
function createDialogLocations(app, { readDrives = readLocalDrives, platform = process.platform, now = () => performance.now() } = {}) {
  let pending, cached, checkedAt = 0, lastGood = [];
  const paths = platform === 'win32' ? path.win32 : path.posix;
  function currentDrives(force) {
    if (pending) return pending.promise;
    const age = now() - checkedAt;
    if (cached && age < 15000 && (!force || cached.warning && age < 1000)) return Promise.resolve(cached);
    const controller = new AbortController(), task = { controller };
    let abort;
    const cancellation = new Promise((_resolve, reject) => { abort = () => reject(canceled()); controller.signal.addEventListener('abort', abort, { once: true }); });
    pending = task;
    task.promise = Promise.race([Promise.resolve().then(() => readDrives({ signal: controller.signal, platform })), cancellation]).then(drives => {
      if (controller.signal.aborted) throw canceled();
      if (!Array.isArray(drives) || !drives.length) throw new Error('没有取得磁盘列表。');
      lastGood = drives; cached = { drives }; checkedAt = now(); return cached;
    }).catch(error => {
      if (controller.signal.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') throw error;
      cached = { drives: lastGood, warning: '未能读取完整磁盘列表，当前仅显示已知位置，请点击刷新重试。' }; checkedAt = now(); return cached;
    }).finally(() => { controller.signal.removeEventListener('abort', abort); if (pending === task) pending = undefined; });
    return task.promise;
  }
  function assemble(defaultPath, result, includeKnownRoots = Boolean(result.warning)) {
    const locations = [];
    for (const [name, kind] of [['桌面', 'desktop'], ['文档', 'documents'], ['下载', 'downloads'], ['个人文件夹', 'home']]) {
      try { locations.push({ name, path: app.getPath(kind), kind: 'shortcut' }); } catch { /* A missing platform shortcut does not prevent directory navigation. */ }
    }
    const drives = [...result.drives];
    if (includeKnownRoots) for (const candidate of [defaultPath, ...locations.map(item => item.path)]) {
      if (typeof candidate !== 'string' || !paths.isAbsolute(candidate)) continue;
      const directory = paths.parse(candidate).root;
      if (platform === 'win32' ? /^[A-Z]:\\$/i.test(directory) : directory === '/') drives.push(platform === 'win32' ? driveLocation(directory.toUpperCase()) : { name: '文件系统', path: '/', kind: 'drive' });
    }
    locations.push(...drives);
    return { locations: locations.filter((item, index) => locations.findIndex(other => (platform === 'win32' ? other.path.toLowerCase() === item.path.toLowerCase() : other.path === item.path)) === index), ...(result.warning ? { warning: result.warning } : {}) };
  }
  const locationsFor = async (defaultPath, { force = false } = {}) => assemble(defaultPath, await currentDrives(force === true));
  locationsFor.peek = defaultPath => {
    const fresh = Boolean(cached && now() - checkedAt < 15000);
    return { ...assemble(defaultPath, cached || { drives: lastGood }, !fresh || Boolean(cached?.warning)), pending: !fresh };
  };
  locationsFor.cancelPending = () => { const task = pending; pending = undefined; task?.controller.abort(); };
  return locationsFor;
}
module.exports = { createDialogLocations, readLocalDrives };
