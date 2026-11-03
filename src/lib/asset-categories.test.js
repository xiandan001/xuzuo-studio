import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createAssetCategories, validateAssetCategoryState, remapAssetCategoryState } = require('../../electron/asset-categories.cjs');
const { createAssetLibrary } = require('../../electron/asset-library.cjs');
const owned = [];
afterEach(async () => {
  for (const directory of owned.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-asset-categories-')) throw new Error('Refusing non-owned cleanup');
    await fs.rm(directory, { recursive: true, force: true });
  }
});
async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-asset-categories-')); owned.push(directory);
  const first = path.join(directory, 'one'), second = path.join(directory, 'two'); await fs.mkdir(first); await fs.mkdir(second);
  const workspaceStorage = { validateWorkspace: async id => { if (id === 'one') return first; if (id === 'two') return second; throw new Error('工作区未登记'); } };
  const library = createAssetLibrary({ workspaceStorage, artifactStore: { write: () => { throw new Error('No project write allowed'); } } });
  const assetLibrary = { list: vi.fn(input => library.list(input)) };
  const builtinAssets = { validateId: vi.fn(async id => { if (!['builtin-one', 'builtin-two'].includes(id)) throw new Error('内置素材不存在'); }), read: vi.fn(() => { throw new Error('Classification must not read PNG bytes'); }) };
  const options = { workspaceStorage, assetLibrary, builtinAssets, fileSystem }, categories = createAssetCategories(options);
  const source = path.join(directory, 'original.txt'); await fs.writeFile(source, '原始素材字节保持-END');
  return { directory, first, second, library, assetLibrary, builtinAssets, options, categories, source, meta: path.join(first, '.xuzuo-assets', 'categories-v1.json'), index: path.join(first, '.xuzuo-assets', 'library-v1.json') };
}
const category = async (f, name = '商业图文', workspaceId = 'one') => (await f.categories.save({ workspaceId, name })).categories.at(-1);
const ownAsset = async (f, workspaceId = 'one') => (await f.library.importPaths({ workspaceId, paths: [f.source] }))[0];
const empty = () => ({ version: 1, categories: [], assignments: {}, builtinAssignments: {} });

describe('按工作区独立的素材自定义分类', () => {
  it('首次只读为空，不创建目录、读取素材文件或写入metadata', async () => {
    const f = await fixture(); expect(await f.categories.list({ workspaceId: 'one' })).toEqual(empty());
    await expect(fs.lstat(path.dirname(f.meta))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.assetLibrary.list).not.toHaveBeenCalled(); expect(f.builtinAssets.validateId).not.toHaveBeenCalled(); expect(f.builtinAssets.read).not.toHaveBeenCalled();
    await expect(f.categories.list({ workspaceId: '../outside' })).rejects.toThrow('工作区编号');
    await expect(f.categories.list({ workspaceId: 'unknown' })).rejects.toThrow('未登记');
  });
  it('创建与重命名使用UUID，名称NFKC/去空白并拒绝大小写或全角重名，重启保留', async () => {
    const f = await fixture(), first = await category(f, '  Ｂｒａｎｄ  ');
    expect(first.id).toMatch(/^[a-f0-9-]{36}$/); expect(first.name).toBe('Brand');
    await expect(category(f, 'brand')).rejects.toThrow('同名'); await expect(category(f, 'ＢＲＡＮＤ')).rejects.toThrow('同名');
    for (const name of ['', '  ', 'A'.repeat(31), '分类\n名称']) await expect(category(f, name)).rejects.toThrow('1–30');
    const second = await category(f, '其他');
    await expect(f.categories.save({ workspaceId: 'one', id: second.id, name: 'BRAND' })).rejects.toThrow('同名');
    const renamed = await f.categories.save({ workspaceId: 'one', id: first.id, name: '客户提案' });
    expect(renamed.categories).toEqual([{ id: first.id, name: '客户提案' }, second]);
    const raw = await fs.readFile(f.meta, 'utf8');
    expect(await f.categories.save({ workspaceId: 'one', id: first.id, name: '客户提案' })).toEqual(renamed); expect(await fs.readFile(f.meta, 'utf8')).toBe(raw);
    expect(await createAssetCategories(f.options).list({ workspaceId: 'one' })).toEqual(renamed);
    await expect(f.categories.save({ workspaceId: 'one', id: randomUUID(), name: '新名字' })).rejects.toThrow('找不到');
  });
  it('不同工作区可同名，分类ID和素材ID不能跨区使用', async () => {
    const f = await fixture(), first = await category(f), second = await category(f, '商业图文', 'two'), file = await ownAsset(f);
    expect(first.id).not.toBe(second.id);
    await expect(f.categories.assign({ workspaceId: 'two', id: file.id, categoryId: first.id })).rejects.toThrow('不属于');
    await expect(f.categories.assign({ workspaceId: 'two', id: file.id, categoryId: second.id })).rejects.toThrow('找不到');
    await expect(f.categories.remove({ workspaceId: 'two', id: first.id })).rejects.toThrow('找不到');
    expect((await f.categories.list({ workspaceId: 'two' })).assignments).toEqual({});
  });
  it('自有素材和内置素材分别归类；归档仍可归类，内置校验不读PNG', async () => {
    const f = await fixture(), group = await category(f), file = await ownAsset(f);
    await f.library.update({ workspaceId: 'one', id: file.id, archived: true });
    await f.categories.assign({ workspaceId: 'one', id: file.id, categoryId: group.id });
    await f.categories.assign({ workspaceId: 'one', id: 'builtin-one', categoryId: group.id, builtin: true });
    expect(await f.categories.list({ workspaceId: 'one' })).toEqual({ version: 1, categories: [group], assignments: { [file.id]: group.id }, builtinAssignments: { 'builtin-one': group.id } });
    expect(f.builtinAssets.validateId).toHaveBeenCalledWith('builtin-one'); expect(f.builtinAssets.read).not.toHaveBeenCalled();
    await expect(f.categories.assign({ workspaceId: 'one', id: 'unknown', categoryId: group.id })).rejects.toThrow('找不到');
    await expect(f.categories.assign({ workspaceId: 'one', id: 'unknown', categoryId: group.id, builtin: true })).rejects.toThrow('内置素材不存在');
    await expect(f.categories.assign({ workspaceId: 'one', id: 'builtin-one', categoryId: group.id, builtin: 'true' })).rejects.toThrow('操作无效');
    await f.categories.assign({ workspaceId: 'one', id: file.id }); await f.categories.assign({ workspaceId: 'one', id: 'builtin-one', builtin: true, categoryId: '' });
    const cleared = await f.categories.list({ workspaceId: 'one' }); expect(cleared.assignments).toEqual({}); expect(cleared.builtinAssignments).toEqual({});
  });
  it('删除分类只清关联，原素材字节、素材索引、归档状态和其他分类均不变', async () => {
    const f = await fixture(), first = await category(f), second = await category(f, '保留分类'), file = await ownAsset(f);
    const index = await fs.readFile(f.index), record = JSON.parse(index).assets[0], backing = path.join(f.first, '.xuzuo-assets', 'files', record.fileName), bytes = await fs.readFile(backing);
    await f.categories.assign({ workspaceId: 'one', id: file.id, categoryId: first.id }); await f.categories.assign({ workspaceId: 'one', id: 'builtin-one', builtin: true, categoryId: first.id }); await f.categories.assign({ workspaceId: 'one', id: 'builtin-two', builtin: true, categoryId: second.id });
    const result = await f.categories.remove({ workspaceId: 'one', id: first.id });
    expect(result).toEqual({ version: 1, categories: [second], assignments: {}, builtinAssignments: { 'builtin-two': second.id } });
    expect(await fs.readFile(backing)).toEqual(bytes); expect(await fs.readFile(f.index)).toEqual(index); expect((await f.library.list({ workspaceId: 'one' }))[0]).toMatchObject({ id: file.id, favorite: false });
  });
  it('并发新增和归类串行提交，flush等到已经排队的操作全部持久化', async () => {
    const f = await fixture(); await Promise.all(Array.from({ length: 20 }, (_, index) => category(f, `分类${index}`))); await f.categories.flush();
    const result = await createAssetCategories(f.options).list({ workspaceId: 'one' }); expect(result.categories).toHaveLength(20); expect(new Set(result.categories.map(item => item.id)).size).toBe(20);
    await Promise.all([f.categories.assign({ workspaceId: 'one', id: 'builtin-one', builtin: true, categoryId: result.categories[0].id }), f.categories.assign({ workspaceId: 'one', id: 'builtin-one', builtin: true, categoryId: result.categories[1].id })]);
    expect((await f.categories.list({ workspaceId: 'one' })).builtinAssignments['builtin-one']).toBe(result.categories[1].id);
  });
  it('flush不会提前结束尚在等待原子提交的分类保存', async () => {
    let release, entered; const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const fileSystem = { ...fs, rename: async (from, to) => { if (path.basename(to) === 'categories-v1.json') { entered(); await waiting; } return fs.rename(from, to); } };
    const f = await fixture(fileSystem), saving = category(f); await started;
    let drained = false; const flushing = f.categories.flush().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(drained).toBe(false); release(); await saving; await flushing;
    expect((await createAssetCategories(f.options).list({ workspaceId: 'one' })).categories).toHaveLength(1);
  });
});

describe('素材分类损坏与提交失败保护', () => {
  it.each(['{broken', JSON.stringify({ version: 2, categories: [], assignments: {}, builtinAssignments: {} }), JSON.stringify({ ...empty(), assignments: { asset: randomUUID() } }), JSON.stringify({ ...empty(), apiKey: 'fixture-not-real' })])('损坏metadata不被读取、新增或归类覆盖：%s', async raw => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.meta)); await fs.writeFile(f.meta, raw);
    await expect(f.categories.list({ workspaceId: 'one' })).rejects.toThrow('无法读取'); await expect(category(f)).rejects.toThrow('无法读取'); await expect(f.categories.assign({ workspaceId: 'one', id: 'builtin-one', builtin: true })).rejects.toThrow('无法读取'); await expect(f.categories.remove({ workspaceId: 'one', id: randomUUID() })).rejects.toThrow('无法读取');
    expect(await fs.readFile(f.meta, 'utf8')).toBe(raw);
  });
  it('分类文件缺失但有保存残留时不自动建空记录，也不删除残留', async () => {
    const f = await fixture(); await fs.mkdir(path.dirname(f.meta)); const pending = `${f.meta}.fixture.tmp`; await fs.writeFile(pending, '{broken pending categories');
    await expect(f.categories.list({ workspaceId: 'one' })).rejects.toThrow('临时文件'); await expect(category(f)).rejects.toThrow('临时文件');
    expect(await fs.readFile(pending, 'utf8')).toBe('{broken pending categories'); await expect(fs.lstat(f.meta)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('原子rename失败保留旧索引并清理本次temp，队列后续仍可继续', async () => {
    let fail = false;
    const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'categories-v1.json') throw Object.assign(new Error('fixture rename failed'), { code: 'EACCES' }); return fs.rename(from, to); } };
    const f = await fixture(fileSystem), first = await category(f), original = await fs.readFile(f.meta);
    fail = true; await expect(category(f, '未提交的分类')).rejects.toThrow('rename failed');
    expect(await fs.readFile(f.meta)).toEqual(original); expect((await fs.readdir(path.dirname(f.meta))).some(name => name.endsWith('.tmp'))).toBe(false);
    fail = false; expect((await category(f, '新分类')).name).toBe('新分类'); expect((await f.categories.list({ workspaceId: 'one' })).categories[0]).toEqual(first);
  });
  it('等待素材身份检查期间外部修改metadata时拒绝覆盖该新记录', async () => {
    const f = await fixture(), group = await category(f), file = await ownAsset(f);
    let release, entered; const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    f.assetLibrary.list.mockImplementationOnce(async input => { entered(); await waiting; return f.library.list(input); });
    const assigning = f.categories.assign({ workspaceId: 'one', id: file.id, categoryId: group.id }); await started;
    const changed = { ...empty(), categories: [{ ...group, name: '外部新名称' }] }, raw = JSON.stringify(changed); await fs.writeFile(f.meta, raw); release();
    await expect(assigning).rejects.toThrow('其他操作修改'); expect(await fs.readFile(f.meta, 'utf8')).toBe(raw);
  });
  it('不安全目录、过大metadata与越界关联不会改变文件', async () => {
    const f = await fixture(); await fs.writeFile(path.dirname(f.meta), 'not a directory');
    await expect(category(f)).rejects.toThrow(/目录|路径/); expect(await fs.readFile(path.dirname(f.meta), 'utf8')).toBe('not a directory');
    await fs.unlink(path.dirname(f.meta)); await fs.mkdir(path.dirname(f.meta)); await fs.writeFile(f.meta, ' '.repeat(2 * 1024 * 1024 + 1));
    await expect(category(f)).rejects.toThrow('无法读取'); expect((await fs.stat(f.meta)).size).toBe(2 * 1024 * 1024 + 1);
  });
  it('素材目录junction不被跟随，分类保存不向外部目录写入metadata', async () => {
    const f = await fixture(), outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'canary.txt'), '保留外部目标');
    await fs.symlink(outside, path.dirname(f.meta), 'junction');
    await expect(f.categories.list({ workspaceId: 'one' })).rejects.toThrow(/junction|符号链接/); await expect(category(f)).rejects.toThrow(/junction|符号链接/);
    await expect(fs.lstat(path.join(outside, 'categories-v1.json'))).rejects.toMatchObject({ code: 'ENOENT' }); expect(await fs.readFile(path.join(outside, 'canary.txt'), 'utf8')).toBe('保留外部目标');
    await fs.unlink(path.dirname(f.meta));
  });
});

describe('素材分类backup纯schema校验与容量', () => {
  it('恢复分类ID和自有素材字典键/分类值，保留名称、未知ID及内置catalog稳定ID', () => {
    const first = randomUUID(), second = randomUUID(), restored = randomUUID();
    const state = { version: 1, categories: [{ id: first, name: 'asset-one' }, { id: second, name: '未映射分类' }], assignments: { [first]: first, 'asset-one': first, 'unknown-asset': second }, builtinAssignments: { 'builtin-one': first, 'builtin-two': second } }, original = JSON.stringify(state);
    const result = remapAssetCategoryState(state, { [first]: restored, 'asset-one': 'restored-asset', 'builtin-one': 'must-not-map-stable-builtin' });
    expect(result.categories).toEqual([{ id: restored, name: 'asset-one' }, { id: second, name: '未映射分类' }]);
    expect(result.assignments).toEqual({ [restored]: restored, 'restored-asset': restored, 'unknown-asset': second });
    expect(result.builtinAssignments).toEqual({ 'builtin-one': restored, 'builtin-two': second });
    expect(JSON.stringify(state)).toBe(original);
  });
  it('恢复映射导致分类或自有素材编号冲突、失效时拒绝，不静默丢弃字典关联', () => {
    const first = randomUUID(), second = randomUUID(), state = { version: 1, categories: [{ id: first, name: '甲分类' }, { id: second, name: '乙分类' }], assignments: { alpha: first, beta: second }, builtinAssignments: {} };
    expect(() => remapAssetCategoryState(state, { alpha: 'collision', beta: 'collision' })).toThrow('编号重复');
    expect(() => remapAssetCategoryState(state, { [first]: second })).toThrow('格式无效');
    expect(() => remapAssetCategoryState(state, { [first]: '../bad-id' })).toThrow('格式无效');
    expect(() => remapAssetCategoryState(state, { alpha: '../bad-id' })).toThrow('格式无效');
    expect(() => remapAssetCategoryState(state, [])).toThrow('映射无效');
  });
  it('拒绝重复ID、NFKC重复名、未知字段、路径键和不存在的分类引用', () => {
    const first = { id: randomUUID(), name: 'ABC' }, second = { id: randomUUID(), name: 'abc' };
    for (const state of [{ ...empty(), categories: [first, first] }, { ...empty(), categories: [first, second] }, { ...empty(), categories: [{ ...first, extra: true }] }, { ...empty(), categories: [first], assignments: { '../asset': first.id } }, { ...empty(), categories: [first], builtinAssignments: { builtin: second.id } }]) expect(() => validateAssetCategoryState(state)).toThrow('格式无效');
    const input = { ...empty(), categories: [first], assignments: { 'restored-own-asset': first.id }, builtinAssignments: { 'restored-builtin': first.id } };
    const checked = validateAssetCategoryState(input); expect(checked).toEqual(input); expect(checked).not.toBe(input); expect(checked.categories[0]).not.toBe(first);
  });
  it('200分类与合计5000关联边界，越界拒绝；纯校验不访问文件系统', () => {
    const categories = Array.from({ length: 200 }, (_, index) => ({ id: randomUUID(), name: `分类${index}` }));
    const assignments = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`asset-${index}`, categories[0].id]));
    expect(validateAssetCategoryState({ ...empty(), categories, assignments }).categories).toHaveLength(200);
    expect(() => validateAssetCategoryState({ ...empty(), categories: [...categories, { id: randomUUID(), name: '超量分类' }] })).toThrow('格式无效');
    expect(() => validateAssetCategoryState({ ...empty(), categories, assignments, builtinAssignments: { 'builtin-one': categories[0].id } })).toThrow('格式无效');
  });
});
