import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createFileDialogSession } = createRequire(import.meta.url)('../../electron/file-dialog-session.cjs');
afterEach(() => vi.restoreAllMocks());

async function fixture(options = {}, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-file-dialog-'));
  const locations = [{ name: '隔离目录', path: root, kind: 'workspace' }];
  const session = createFileDialogSession({ options: { mode: 'open', properties: ['openFile'], defaultPath: root, ...options }, locations, ...extra });
  return { root, session, locations };
}

describe('custom file dialog session', () => {
  it('explains a marker-only workspace root before checking emptiness and only accepts an independent child', async () => {
    const f = await fixture(), workspace = path.join(f.root, 'workspace'), outside = path.join(f.root, 'outside');
    await fs.mkdir(workspace); await fs.mkdir(outside); await fs.writeFile(path.join(workspace, '.xuzuo-workspace-v1.json'), '{"version":1}');
    const s = createFileDialogSession({ options: { properties: ['openDirectory', 'createDirectory'], defaultPath: workspace, allowedRoot: workspace, selectEmpty: true }, locations: f.locations });
    expect((await s.seed()).selectEmpty).toBe(true); expect((await f.session.seed()).selectEmpty).toBeUndefined();
    const listing = await s.list({ path: workspace }); expect(listing.total).toBe(0); expect(listing.parentPath).toBeNull();
    await expect(s.accept({ directory: workspace })).rejects.toThrow('这是工作区根目录，请先在其中新建或选择独立的项目子文件夹。');
    expect(await fs.readdir(workspace)).toEqual(['.xuzuo-workspace-v1.json']);
    const child = await s.createFolder({ path: workspace, name: '独立项目' });
    expect((await s.accept({ directory: child.path })).paths).toEqual([child.path]);
    await expect(s.list({ path: outside })).rejects.toThrow('范围'); await expect(s.accept({ directory: outside })).rejects.toThrow('范围');
  });
  it('still rejects ordinary or hidden files in a child that appears to have no visible subfolders', async () => {
    const f = await fixture(), s = createFileDialogSession({ options: { properties: ['openDirectory'], allowedRoot: f.root, selectEmpty: true }, locations: f.locations });
    for (const name of ['old.txt', '.hidden.txt', '.xuzuo-workspace-v1.json']) {
      const child = path.join(f.root, `child-${name.replaceAll('.', '_')}`); await fs.mkdir(child); await fs.writeFile(path.join(child, name), 'keep existing bytes');
      expect((await s.list({ path: child })).total).toBe(0);
      await expect(s.accept({ directory: child })).rejects.toThrow('列表只显示子文件夹');
      expect(await fs.readFile(path.join(child, name), 'utf8')).toBe('keep existing bytes'); expect(await fs.readdir(child)).toEqual([name]);
    }
  });
  it('checks canonical paths so alternate filesystem names cannot bypass private-path protection', async () => {
    const f = await fixture(), apparent = path.join(f.root, 'alias.json'), protectedFile = path.join(f.root, 'credentials-v1.json');
    await fs.writeFile(apparent, '{}'); await fs.writeFile(protectedFile, '{}');
    const nativeFs = { ...fs, realpath: async value => value === apparent ? protectedFile : fs.realpath(value) };
    const session = createFileDialogSession({ options: { properties: ['openFile'], defaultPath: f.root }, locations: f.locations, blockedPaths: [protectedFile], fileSystem: nativeFs });
    await expect(session.accept({ paths: [apparent] })).rejects.toThrow('受保护');
    const save = createFileDialogSession({ options: { mode: 'save', defaultPath: f.root }, locations: f.locations, blockedPaths: [protectedFile], fileSystem: nativeFs });
    await expect(save.accept({ directory: f.root, filename: 'alias.json' })).rejects.toThrow('受保护');
  });
  it('hides and rejects workspace control files and directories, including attempts to create them', async () => {
    const f = await fixture({ properties: ['openFile', 'createDirectory'] });
    await fs.mkdir(path.join(f.root, '.xuzuo')); await fs.writeFile(path.join(f.root, '.xuzuo-workspace-v1.json'), '{}');
    expect((await f.session.list({ path: f.root })).entries).toHaveLength(0);
    await expect(f.session.accept({ paths: [path.join(f.root, '.xuzuo-workspace-v1.json')] })).rejects.toThrow('受保护');
    await expect(f.session.createFolder({ path: f.root, name: '.xuzuo-assets' })).rejects.toThrow('受保护');
    await expect(fs.lstat(path.join(f.root, '.xuzuo-assets'))).rejects.toMatchObject({ code: 'ENOENT' });
    const restricted = createFileDialogSession({ options: { properties: ['openFile', 'multiSelections'], defaultPath: f.root, maxSelections: 3 }, locations: f.locations });
    expect((await restricted.seed()).maxSelections).toBe(3);
  });
  it('seeds save names and falls back from a missing default file inside the allowed root', async () => {
    const f = await fixture(); const child = path.join(f.root, 'child'); await fs.mkdir(child);
    const s = createFileDialogSession({ options: { mode: 'save', defaultPath: path.join(child, '报告.zip'), allowedRoot: f.root, filters: [{ name: 'ZIP', extensions: ['zip'] }] }, locations: f.locations });
    const seeded = await s.seed(); expect(seeded.path).toBe(child); expect(seeded.defaultFilename).toBe('报告.zip'); expect(seeded.canCreateDirectory).toBe(true);
    const listing = await s.list({ path: f.root }); expect(listing.canGoUp).toBe(false); expect(listing.parentPath).toBeNull();
  });
  it('lists folders first, filters file names, omits protected paths, and never reads contents or recurses', async () => {
    const f = await fixture(), folder = path.join(f.root, '子目录'), protectedFile = path.join(f.root, 'credentials-v1.json');
    await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'nested.txt'), 'must not enumerate');
    for (const [name, text] of [['z.txt', 'one'], ['a.png', 'two'], ['credentials-v1.json', 'must not read']]) await fs.writeFile(path.join(f.root, name), text);
    const read = vi.fn(() => { throw Error('No file bytes may be read'); }), readdir = vi.fn((...args) => fs.readdir(...args));
    const session = createFileDialogSession({ options: { properties: ['openFile'], filters: [{ name: '文本', extensions: ['txt', 'json'] }] }, locations: f.locations, blockedPaths: [protectedFile], fileSystem: { ...fs, readFile: read, readdir } });
    const listed = await session.list({ path: f.root }); expect(listed.entries.map(item => item.name)).toEqual(['子目录', 'z.txt']);
    expect(listed.entries[1]).toMatchObject({ kind: 'file', bytes: 3 }); expect(read).not.toHaveBeenCalled(); expect(readdir).toHaveBeenCalledExactlyOnceWith(f.root, { withFileTypes: true });
    await expect(session.accept({ paths: [protectedFile] })).rejects.toThrow('受保护');
  });
  it('paginates before metadata lookup and searches only within the current directory', async () => {
    const f = await fixture(); await Promise.all(Array.from({ length: 120 }, (_, index) => fs.writeFile(path.join(f.root, `${String(index).padStart(3, '0')}.txt`), 'x')));
    let fileStats = 0; const session = createFileDialogSession({ options: { properties: ['openFile'] }, locations: f.locations, fileSystem: { ...fs, lstat: async p => { if (path.extname(p) === '.txt') fileStats++; return fs.lstat(p); } } });
    const second = await session.list({ path: f.root, page: 1, pageSize: 10 }); expect(second.total).toBe(120); expect(second.entries).toHaveLength(10); expect(second.entries[0].name).toBe('010.txt'); expect(fileStats).toBe(10);
    expect((await session.list({ path: f.root, search: '119' })).entries.map(item => item.name)).toEqual(['119.txt']);
    await expect(session.list({ path: f.root, pageSize: 201 })).rejects.toThrow('分页');
  });
  it('keeps navigation and file selection inside the native allowed root', async () => {
    const f = await fixture(); const allowed = path.join(f.root, 'allowed'), other = path.join(f.root, 'allowed-other'); await fs.mkdir(allowed); await fs.mkdir(other);
    await fs.writeFile(path.join(allowed, 'a.txt'), 'a'); await fs.writeFile(path.join(other, 'b.txt'), 'b');
    const s = createFileDialogSession({ options: { properties: ['openFile'], allowedRoot: allowed }, locations: f.locations });
    await expect(s.list({ path: other })).rejects.toThrow('范围'); await expect(s.accept({ paths: [path.join(other, 'b.txt')] })).rejects.toThrow('范围');
    expect((await s.accept({ paths: [path.join(allowed, 'a.txt')] })).paths).toEqual([path.join(allowed, 'a.txt')]);
  });
  it('rejects links in listing navigation and acceptance, including replaced parent directories', async () => {
    const f = await fixture(), target = path.join(f.root, 'target'), link = path.join(f.root, 'link'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'a.txt'), 'a');
    await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await f.session.list({ path: f.root })).entries.find(item => item.name === 'link').kind).toBe('link');
    await expect(f.session.list({ path: link })).rejects.toThrow('链接');
    await expect(f.session.accept({ paths: [path.join(link, 'a.txt')] })).rejects.toThrow('链接');
  });
  it('requires ordinary empty directories when the business request asks for an empty project folder', async () => {
    const f = await fixture(), empty = path.join(f.root, 'empty'), occupied = path.join(f.root, 'occupied'); await fs.mkdir(empty); await fs.mkdir(occupied); await fs.writeFile(path.join(occupied, 'old.txt'), 'keep');
    const s = createFileDialogSession({ options: { properties: ['openDirectory', 'createDirectory'], allowedRoot: f.root, selectEmpty: true }, locations: f.locations });
    await expect(s.accept({ directory: occupied })).rejects.toThrow('空项目');
    expect((await s.accept({ directory: empty })).paths).toEqual([empty]); expect(await fs.readFile(path.join(occupied, 'old.txt'), 'utf8')).toBe('keep');
  });
  it('enforces multi-selection limits and extensions even when the renderer bypasses its visible filter', async () => {
    const f = await fixture({ properties: ['openFile', 'multiSelections'], maxSelections: 2, filters: [{ name: '文本', extensions: ['txt'] }] });
    const names = ['a.txt', 'b.txt', 'other.png']; await Promise.all(names.map(name => fs.writeFile(path.join(f.root, name), name)));
    await expect(f.session.accept({ paths: names.map(name => path.join(f.root, name)) })).rejects.toThrow('1至2');
    await expect(f.session.accept({ paths: [path.join(f.root, 'other.png')] })).rejects.toThrow('类型');
    expect((await f.session.accept({ paths: names.slice(0, 2).map(name => path.join(f.root, name)) })).paths).toHaveLength(2);
  });
  it('creates only a single validated folder and never overwrites an existing name', async () => {
    const f = await fixture({ properties: ['openDirectory', 'createDirectory'] });
    const added = await f.session.createFolder({ path: f.root, name: '客户文件夹' }); expect(added).toEqual({ path: path.join(f.root, '客户文件夹'), parentPath: f.root });
    await expect(f.session.createFolder({ path: f.root, name: '客户文件夹' })).rejects.toThrow('同名');
    for (const name of ['../outside', 'a/b', 'a\\b', 'file:stream', '.', '..', 'CON', 'name.']) await expect(f.session.createFolder({ path: f.root, name })).rejects.toThrow('名称');
    const readOnly = createFileDialogSession({ options: { properties: ['openFile'] }, locations: f.locations }); await expect(readOnly.createFolder({ path: f.root, name: 'forbidden' })).rejects.toThrow('不允许');
  });
  it('allows recreating only the exact original directory for a reconnect operation', async () => {
    const f = await fixture(), wanted = path.join(f.root, '原目录');
    const s = createFileDialogSession({ options: { properties: ['openDirectory', 'createDirectory'], exactPath: wanted, defaultPath: wanted }, locations: f.locations });
    expect((await s.seed()).path).toBe(f.root);
    await expect(s.createFolder({ path: f.root, name: 'other' })).rejects.toThrow('原登记'); await s.createFolder({ path: f.root, name: '原目录' });
    await expect(s.accept({ directory: f.root })).rejects.toThrow('原位置'); expect((await s.accept({ directory: wanted })).paths).toEqual([wanted]);
  });
  it('requires fresh overwrite confirmation and preserves existing bytes until a native writer acts', async () => {
    const f = await fixture({ mode: 'save', defaultPath: '报告.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] }), target = path.join(f.root, '报告.zip'); await fs.writeFile(target, 'old');
    const first = await f.session.accept({ directory: f.root, filename: '报告' }); expect(first).toMatchObject({ overwriteRequired: true, path: target }); expect(await fs.readFile(target, 'utf8')).toBe('old');
    await expect(f.session.assertSaveTarget(target)).rejects.toThrow('尚未');
    await fs.writeFile(target, 'changed bytes'); const changed = await f.session.accept({ directory: f.root, filename: '报告.zip', overwriteToken: first.token }); expect(changed.overwriteRequired).toBe(true); expect(changed.token).not.toBe(first.token);
    expect((await f.session.accept({ directory: f.root, filename: '报告.zip', overwriteToken: changed.token })).paths).toEqual([target]);
    expect(await f.session.assertSaveTarget(target)).toBe(target); expect(await f.session.assertSaveTarget(target)).toBe(target);
    await fs.writeFile(target, 'newer changed bytes'); await expect(f.session.assertSaveTarget(target)).rejects.toThrow('变化');
  });
  it('detects newly appearing save files after a previously empty target was approved', async () => {
    const f = await fixture({ mode: 'save', filters: [{ name: 'JSON', extensions: ['json'] }] });
    const result = await f.session.accept({ directory: f.root, filename: 'new' }), target = path.join(f.root, 'new.json'); expect(result.paths).toEqual([target]);
    expect(await f.session.assertSaveTarget(target)).toBe(target); await fs.writeFile(target, 'external'); await expect(f.session.assertSaveTarget(target)).rejects.toThrow('变化');
    await expect(f.session.accept({ directory: f.root, filename: '../forged' })).rejects.toThrow('名称'); await expect(f.session.accept({ directory: f.root, filename: 'wrong.png' })).rejects.toThrow('扩展名');
  });
  it('rejects deleted files and turns filesystem permission errors into actionable messages', async () => {
    const f = await fixture(); await expect(f.session.accept({ paths: [path.join(f.root, 'gone.txt')] })).rejects.toThrow('不存在');
    const s = createFileDialogSession({ options: { properties: ['openDirectory'] }, locations: f.locations, fileSystem: { ...fs, lstat: async () => { throw Object.assign(new Error('fixture permission'), { code: 'EACCES' }); } } });
    await expect(s.list({ path: f.root })).rejects.toThrow('没有权限');
  });
  it('cancellation while checking a parent prevents a late folder creation', async () => {
    const f = await fixture(); let active = true, release, reached;
    const entered = new Promise(resolve => { reached = resolve; });
    const session = createFileDialogSession({ options: { properties: ['openDirectory', 'createDirectory'] }, locations: f.locations,
      assertActive: () => { if (!active) throw Error('已取消'); },
      fileSystem: { ...fs, lstat: async filename => { if (filename === f.root) { reached(); await new Promise(resolve => { release = resolve; }); } return fs.lstat(filename); } },
    });
    const pending = session.createFolder({ path: f.root, name: 'never-created' }); await entered; active = false; release();
    await expect(pending).rejects.toThrow('已取消'); await expect(fs.lstat(path.join(f.root, 'never-created'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps approved native save assertions usable after the picker window closes', async () => {
    const f = await fixture(); let active = true;
    const session = createFileDialogSession({ options: { mode: 'save' }, locations: f.locations, assertActive: () => { if (!active) throw Error('closed'); } });
    const result = await session.accept({ directory: f.root, filename: 'approved.txt' }); active = false;
    await expect(session.list({ path: f.root })).rejects.toThrow('closed');
    expect(await session.assertSaveTarget(result.paths[0])).toBe(path.join(f.root, 'approved.txt'));
  });
});
