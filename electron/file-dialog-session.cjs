const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createDialogPathResolver } = require('./file-dialog-paths.cjs');

const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
function within(root, target) {
  const relative = path.relative(root, target);
  return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function absolute(value) {
  if (typeof value !== 'string' || !value || value.length > 32767 || value.includes('\0') || !path.isAbsolute(value)) throw new Error('请输入有效的本地绝对路径。');
  if (process.platform === 'win32' && (/^\\\\[.?]\\/.test(value) || value.slice(3).includes(':'))) throw new Error('不支持设备路径或文件数据流。');
  return path.resolve(value);
}
function basename(value) {
  if (typeof value !== 'string' || !value || value.length > 255 || value !== value.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || ['.', '..'].includes(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new Error('名称不能包含路径、特殊字符、保留设备名或结尾空格/句点。');
  return value;
}
const signature = stat => JSON.stringify(['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].map(key => String(stat[key])));
const extension = filename => path.extname(filename).slice(1).toLowerCase();
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
function filesystemError(error) {
  const message = error.code === 'ENOENT' ? '此位置已经不存在，请重新选择。' : ['EACCES', 'EPERM'].includes(error.code) ? '没有权限访问此位置，请选择其他文件夹。' : error.code === 'ENOTDIR' ? '这个位置不是文件夹。' : error.code === 'ENOSPC' ? '磁盘空间不足，请选择其他位置。' : error.code === 'EBUSY' ? '此位置正在使用，请稍后重试。' : '无法访问此位置，请检查目录或磁盘连接。';
  return Object.assign(new Error(message), { code: error.code });
}

function createFileDialogSession({ options = {}, locations = [], blockedPaths = [], fileSystem = fsDefault, assertActive = () => undefined }) {
  const fs = fileSystem, mode = options.mode === 'save' ? 'save' : 'open';
  const directoryOnly = mode === 'open' && options.properties?.includes('openDirectory') && !options.properties?.includes('openFile');
  const multiSelections = !directoryOnly && mode === 'open' && options.properties?.includes('multiSelections') === true;
  const maxSelections = Math.min(20, Math.max(1, Number.isSafeInteger(options.maxSelections) ? options.maxSelections : 20));
  const filters = (options.filters || []).map(filter => ({ name: String(filter.name || '文件'), extensions: [...new Set((filter.extensions || []).map(item => String(item).replace(/^\./, '').toLowerCase()))] }));
  if (filters.some(filter => !filter.extensions.length || filter.extensions.some(item => !/^(?:[a-z0-9][a-z0-9_-]*|\*)$/.test(item)))) throw new Error('文件类型筛选配置无效。');
  const extensions = new Set(filters.flatMap(filter => filter.extensions));
  const root = options.allowedRoot ? absolute(options.allowedRoot) : undefined, exact = options.exactPath ? absolute(options.exactPath) : undefined;
  const blocked = blockedPaths.map(absolute);
  const canCreateDirectory = options.allowCreateDirectory === true || options.properties?.includes('createDirectory') === true || mode === 'save';
  const overwrite = new Map(); let approved;
  let roots = root ? [root] : [], exactPaths = exact ? [exact] : [], protectedPaths = blocked, preparation, refreshing, policyPaths, hasAliases = false;

  async function readPolicyPaths() {
    assertActive(); const resolve = createDialogPathResolver(fs);
    const values = await Promise.all([
      root ? resolve(root, { requireDirectory: true, assertActive }) : undefined,
      exact ? resolve(exact, { allowMissing: true, assertActive }) : undefined,
      ...blocked.map(item => resolve(item, { allowMissing: true, assertActive })),
    ]);
    assertActive(); return values.map(item => item?.path);
  }
  async function prepare() {
    try {
      if (!preparation) {
        preparation = readPolicyPaths().then(values => {
          policyPaths = values;
          roots = root ? [...new Set([root, values[0]])] : [];
          exactPaths = exact ? [...new Set([exact, values[1]])] : [];
          protectedPaths = [...new Set([...blocked, ...values.slice(2)])];
          hasAliases = [root, exact, ...blocked].some((item, index) => item && !samePath(item, values[index]));
        });
        return await preparation;
      }
      await preparation;
      if (!hasAliases) return;
      if (!refreshing) refreshing = readPolicyPaths().then(values => {
        if (values.some((item, index) => item !== undefined && !samePath(item, policyPaths[index]))) throw new Error('路径对应的位置已变化，请关闭窗口后重新选择。');
      }).finally(() => { refreshing = undefined; });
      await refreshing;
    } catch (error) { throw error.code ? filesystemError(error) : error; }
  }

  function isBlocked(target) { const parts = target.split(path.sep).map(part => part.toLowerCase()); return parts.some(part => ['.xuzuo', '.xuzuo-assets', '.xuzuo-workspace-v1.json'].includes(part)) || protectedPaths.some(item => within(item, target)); }
  function checkScope(value) {
    const target = absolute(value);
    if (root && !roots.some(item => within(item, target))) throw new Error('此位置超出当前操作允许的目录范围。');
    if (isBlocked(target)) throw new Error('此位置属于应用受保护的本地资料，不能在这里选择或保存文件。');
    if (process.platform === 'win32' && target.startsWith('\\\\') && !options.allowNetworkPaths && !root?.startsWith('\\\\')) throw new Error('请选择本机目录，当前操作不支持网络路径。');
    return target;
  }
  function checkSelection(target) { if (exact && !exactPaths.some(item => samePath(item, target))) throw new Error(`请选择此操作指定的原位置：${exact}`); }
  async function checkedDirectory(value) {
    const target = checkScope(value);
    try { return (await createDialogPathResolver(fs)(target, { requireDirectory: true, validateCanonical: checkScope })).path; }
    catch (error) { throw error.code ? filesystemError(error) : error; }
  }
  async function fileStat(value) {
    const target = checkScope(value);
    try {
      const { stat } = await createDialogPathResolver(fs)(target, { allowMissing: true, validateCanonical: checkScope });
      if (stat && !stat.isFile()) throw new Error('此位置不是可选择或覆盖的普通文件。');
      return stat;
    } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }
  function allowedFile(filename) { return !extensions.size || extensions.has('*') || extensions.has(extension(filename)); }
  function filterLocations(values) {
    return values.filter(item => item && typeof item.path === 'string' && path.isAbsolute(item.path) && (!root || roots.some(rootPath => within(rootPath, absolute(item.path)))) && !isBlocked(absolute(item.path))).map(item => ({ name: String(item.name || item.path), path: absolute(item.path), ...(item.kind ? { kind: item.kind } : {}) }));
  }
  async function initialPath() {
    let candidate = typeof options.defaultPath === 'string' && path.isAbsolute(options.defaultPath) && (!root || roots.some(item => within(item, absolute(options.defaultPath)))) ? options.defaultPath : root;
    if (candidate) {
      candidate = absolute(candidate);
      for (;;) {
        try { return await checkedDirectory(candidate); } catch (error) {
          const parent = path.dirname(candidate);
          if (parent === candidate || root && !roots.some(item => within(item, parent))) { if (root) throw error; break; }
          candidate = parent;
        }
      }
    }
    for (const location of locations) try { return await checkedDirectory(location.path); } catch { /* Try another native-supplied location. */ }
    return checkedDirectory(path.parse(process.cwd()).root);
  }
  async function list({ path: directoryName, search = '', page = 0, pageSize = 100 } = {}) {
    assertActive(); await prepare();
    if (typeof search !== 'string' || search.length > 255 || !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new Error('目录筛选或分页参数无效。');
    const directory = await checkedDirectory(directoryName), query = search.toLocaleLowerCase();
    let children; try { children = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { throw filesystemError(error); }
    const names = children.filter(item => !isBlocked(path.join(directory, item.name)) && (!query || item.name.toLocaleLowerCase().includes(query)) && (item.isDirectory() || item.isSymbolicLink() || !directoryOnly && allowedFile(item.name)));
    names.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || collator.compare(a.name, b.name));
    const total = names.length, effectivePage = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1)), shown = names.slice(effectivePage * pageSize, (effectivePage + 1) * pageSize);
    const entries = [];
    for (let start = 0; start < shown.length; start += 8) {
      const batch = await Promise.all(shown.slice(start, start + 8).map(async item => {
        const filename = path.join(directory, item.name);
        try {
          const stat = await fs.lstat(filename), kind = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'link';
          return { name: item.name, path: filename, kind, ...(kind === 'file' ? { bytes: stat.size } : {}), ...(Number.isFinite(stat.mtimeMs) ? { modified: new Date(stat.mtimeMs).toISOString() } : {}) };
        } catch (error) { if (error.code === 'ENOENT') return undefined; return { name: item.name, path: filename, kind: 'link' }; }
      }));
      assertActive(); entries.push(...batch.filter(Boolean));
    }
    const parentPath = path.dirname(directory), canGoUp = parentPath !== directory && (!root || roots.some(item => within(item, parentPath))) && !isBlocked(parentPath);
    assertActive(); return { path: directory, parentPath: canGoUp ? parentPath : null, entries, total, page: effectivePage, pageSize, canGoUp };
  }
  async function createFolder({ path: directoryName, name } = {}) {
    assertActive(); await prepare();
    if (!canCreateDirectory) throw new Error('当前文件选择不允许新建文件夹。');
    const parentPath = await checkedDirectory(directoryName), target = checkScope(path.join(parentPath, basename(name)));
    if (exact && !exactPaths.some(item => samePath(item, target))) throw new Error('当前操作只允许新建原登记位置的文件夹。');
    assertActive();
    try { await fs.mkdir(target); } catch (error) { if (error.code === 'EEXIST') throw new Error('同名文件或文件夹已存在，请换一个名称。'); throw filesystemError(error); }
    await checkedDirectory(target); assertActive(); return { path: target, parentPath };
  }
  async function accept(input = {}) {
    assertActive(); await prepare();
    if (mode === 'save') {
      const directory = await checkedDirectory(input.directory); let name = basename(input.filename);
      if (!extension(name) && extensions.size && !extensions.has('*')) name += `.${extensions.has(extension(String(options.defaultPath || ''))) ? extension(options.defaultPath) : [...extensions][0]}`;
      if (!allowedFile(name)) throw new Error('文件扩展名不符合当前保存格式。');
      const target = checkScope(path.join(directory, name)); checkSelection(target);
      const stat = await fileStat(target), now = stat ? signature(stat) : null; assertActive();
      if (stat && overwrite.get(input.overwriteToken) !== `${target}\0${now}`) {
        overwrite.clear(); const token = randomUUID(); overwrite.set(token, `${target}\0${now}`);
        return { overwriteRequired: true, path: target, token };
      }
      approved = { path: target, signature: now }; overwrite.clear(); return { paths: [target] };
    }
    const values = Array.isArray(input.paths) && input.paths.length ? input.paths : directoryOnly && input.directory ? [input.directory] : [];
    if (!values.length || values.length > maxSelections || !multiSelections && values.length !== 1) throw new Error(`请选择${multiSelections ? `1至${maxSelections}个` : '一个'}${directoryOnly ? '文件夹' : '文件'}。`);
    const paths = [];
    for (const value of values) {
      const target = directoryOnly ? await checkedDirectory(value) : checkScope(value); checkSelection(target);
      if (directoryOnly) {
        if (options.selectEmpty) {
          if (root && roots.some(item => samePath(item, target))) throw new Error('这是工作区根目录，请先在其中新建或选择独立的项目子文件夹。');
          if ((await fs.readdir(target)).length) throw new Error('当前文件夹仍有内容（列表只显示子文件夹）。请选择空项目文件夹，已有文件不会被覆盖。');
        }
      }
      else { if (!allowedFile(target)) throw new Error('所选文件类型不符合当前操作。'); if (!await fileStat(target)) throw new Error('所选文件已经不存在，请重新选择。'); }
      if (!paths.some(item => samePath(item, target))) paths.push(target);
    }
    assertActive(); return { paths };
  }
  return {
    async seed() {
      assertActive(); await prepare(); const directory = await initialPath(); assertActive();
      return { mode, title: options.title || (mode === 'save' ? '保存文件' : directoryOnly ? '选择文件夹' : '选择文件'), buttonLabel: options.buttonLabel || (mode === 'save' ? '保存到这里' : '确认选择'), path: directory,
        defaultFilename: mode === 'save' ? path.basename(String(options.defaultPath || options.defaultFilename || '未命名')) : '',
        locations: filterLocations(locations),
        filters, multiSelections, maxSelections, directoryOnly: !!directoryOnly, canCreateDirectory, ...(options.selectEmpty ? { selectEmpty: true } : {}), ...(root ? { allowedRoot: roots.at(-1) } : {}), ...(exact ? { exactPath: exactPaths.at(-1) } : {}) };
    },
    list, createFolder, accept, filterLocations,
    async assertSaveTarget(value) {
      if (mode !== 'save' || !approved || !samePath(checkScope(value), approved.path)) throw new Error('保存位置尚未通过本次窗口确认。');
      const stat = await fileStat(approved.path), now = stat ? signature(stat) : null;
      if (now !== approved.signature) throw new Error('保存目标在确认后已变化，请重新选择并确认覆盖。');
      return approved.path;
    },
  };
}
module.exports = { createFileDialogSession };
