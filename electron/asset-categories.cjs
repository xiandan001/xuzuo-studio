const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');

const CATEGORY_LIMIT = 200, ASSIGNMENT_LIMIT = 5000, METADATA_BYTES = 2 * 1024 * 1024;
const filename = 'categories-v1.json';
const assetId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const categoryId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const empty = () => ({ version: 1, categories: [], assignments: {}, builtinAssignments: {} });
const identity = name => name.normalize('NFKC').toLowerCase();
function categoryName(value) {
  if (typeof value !== 'string') throw new Error('请填写素材分类名称。');
  const name = value.normalize('NFKC').trim();
  if (!name || Array.from(name).length > 30 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('素材分类名称需为 1–30 个字符，不能包含换行或控制字符。');
  return name;
}
function validateAssetCategoryState(value) {
  const fail = () => { throw new Error('素材分类记录格式无效，原文件已保留。'); };
  if (!plain(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'categories', 'assignments', 'builtinAssignments'].includes(key)) || !Array.isArray(value.categories) || value.categories.length > CATEGORY_LIMIT || !plain(value.assignments) || !plain(value.builtinAssignments)) fail();
  const ids = new Set(), names = new Set();
  const categories = value.categories.map(item => {
    if (!plain(item) || Object.keys(item).some(key => !['id', 'name'].includes(key)) || !categoryId(item.id) || ids.has(item.id)) fail();
    let name; try { name = categoryName(item.name); } catch { fail(); }
    if (name !== item.name || names.has(identity(name))) fail();
    ids.add(item.id); names.add(identity(name)); return { id: item.id, name };
  });
  if (Object.keys(value.assignments).length + Object.keys(value.builtinAssignments).length > ASSIGNMENT_LIMIT) fail();
  const assignments = input => Object.fromEntries(Object.entries(input).map(([id, target]) => {
    if (!assetId(id) || !categoryId(target) || !ids.has(target)) fail();
    return [id, target];
  }));
  return { version: 1, categories, assignments: assignments(value.assignments), builtinAssignments: assignments(value.builtinAssignments) };
}
function remapAssetCategoryState(value, idMap) {
  const state = validateAssetCategoryState(value);
  if (!plain(idMap)) throw new Error('素材分类恢复编号映射无效。');
  const mapped = id => Object.hasOwn(idMap, id) ? idMap[id] : id;
  const assignments = (input, remapKeys) => {
    const entries = Object.entries(input).map(([id, target]) => [remapKeys ? mapped(id) : id, mapped(target)]);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('恢复后的素材关联编号重复，未覆盖分类记录。');
    return Object.fromEntries(entries);
  };
  return validateAssetCategoryState({ version: 1, categories: state.categories.map(item => ({ id: mapped(item.id), name: item.name })), assignments: assignments(state.assignments, true), builtinAssignments: assignments(state.builtinAssignments, false) });
}

function createAssetCategories({ workspaceStorage, assetLibrary, builtinAssets, fileSystem = fsDefault }) {
  const fs = fileSystem; let queue = Promise.resolve();
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  async function location(workspaceId) {
    if (!assetId(workspaceId)) throw new Error('工作区编号无效。');
    const root = await workspaceStorage.validateWorkspace(workspaceId), directory = path.join(root, '.xuzuo-assets');
    try { await fs.lstat(directory); await checkedDirectory(fs, directory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { directory, index: path.join(directory, filename), absent: true }; }
    return { directory, index: path.join(directory, filename), absent: false };
  }
  async function read(place) {
    if (place.absent) return { state: empty(), original: undefined };
    try {
      const stat = await checkedFile(fs, place.index);
      if (stat.size > METADATA_BYTES) throw new Error('素材分类记录超过容量，未读取或覆盖原文件。');
      const original = await fs.readFile(place.index, 'utf8');
      if (Buffer.byteLength(original, 'utf8') > METADATA_BYTES) throw new Error('素材分类记录超过容量，未读取或覆盖原文件。');
      return { state: validateAssetCategoryState(JSON.parse(original)), original };
    } catch (error) {
      if (error.code === 'ENOENT') {
        const leftovers = (await fs.readdir(place.directory)).some(name => name.startsWith(`${filename}.`) && name.endsWith('.tmp'));
        if (leftovers) throw new Error('素材分类存在未完成保存的临时文件，请保留目录并检查备份；未创建空分类记录。');
        return { state: empty(), original: undefined };
      }
      throw new Error('素材分类记录无法读取，原文件已保留，请检查工作区或备份。');
    }
  }
  async function commit(place, original, state) {
    const next = validateAssetCategoryState(state);
    await checkedDirectory(fs, place.directory, true);
    const latest = await read({ ...place, absent: false });
    if (latest.original !== original) throw new Error('素材分类已被其他操作修改，请重新读取后重试；未覆盖新记录。');
    await atomicJson(fs, place.index, next); return next;
  }
  return {
    list({ workspaceId }) { return serial(async () => (await read(await location(workspaceId))).state); },
    save({ workspaceId, id, name }) { return serial(async () => {
      const normalized = categoryName(name), place = await location(workspaceId), { state, original } = await read(place);
      const previous = id === undefined ? undefined : state.categories.find(item => item.id === id);
      if (id !== undefined && !previous) throw new Error('找不到当前工作区的素材分类。');
      if (state.categories.some(item => item.id !== id && identity(item.name) === identity(normalized))) throw new Error('当前工作区已存在同名素材分类。');
      if (previous?.name === normalized) return state;
      if (!previous && state.categories.length >= CATEGORY_LIMIT) throw new Error(`每个工作区最多保存 ${CATEGORY_LIMIT} 个素材分类。`);
      const categories = previous ? state.categories.map(item => item.id === id ? { ...item, name: normalized } : item) : [...state.categories, { id: randomUUID(), name: normalized }];
      return commit(place, original, { ...state, categories });
    }); },
    remove({ workspaceId, id }) { return serial(async () => {
      const place = await location(workspaceId), { state, original } = await read(place);
      if (!state.categories.some(item => item.id === id)) throw new Error('找不到当前工作区的素材分类。');
      const clear = map => Object.fromEntries(Object.entries(map).filter(([, value]) => value !== id));
      return commit(place, original, { ...state, categories: state.categories.filter(item => item.id !== id), assignments: clear(state.assignments), builtinAssignments: clear(state.builtinAssignments) });
    }); },
    assign({ workspaceId, id, categoryId: selectedId, builtin = false }) { return serial(async () => {
      if (!assetId(id) || typeof builtin !== 'boolean') throw new Error('素材编号或分类操作无效。');
      const place = await location(workspaceId), { state, original } = await read(place);
      const target = selectedId === '' ? undefined : selectedId;
      if (target !== undefined && !state.categories.some(item => item.id === target)) throw new Error('目标分类不属于当前工作区，请重新选择。');
      if (builtin) await builtinAssets.validateId(id);
      else if (!(await assetLibrary.list({ workspaceId })).some(item => item.id === id && item.workspaceId === workspaceId)) throw new Error('找不到当前工作区的这份素材。');
      const field = builtin ? 'builtinAssignments' : 'assignments';
      if ((Object.hasOwn(state[field], id) ? state[field][id] : undefined) === target) return;
      const assignments = { ...state[field] };
      if (target === undefined) delete assignments[id]; else assignments[id] = target;
      if (Object.keys(assignments).length + Object.keys(state[builtin ? 'assignments' : 'builtinAssignments']).length > ASSIGNMENT_LIMIT) throw new Error(`每个工作区最多保存 ${ASSIGNMENT_LIMIT} 份素材分类关联。`);
      await commit(place, original, { ...state, [field]: assignments });
    }); },
    flush: () => queue,
  };
}
module.exports = { createAssetCategories, validateAssetCategoryState, remapAssetCategoryState };
