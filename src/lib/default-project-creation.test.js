import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { registerProjectCreation } = require('../../electron/project-creation.cjs');
const { defaultDirectoryKey } = require('../../electron/default-project-folder.cjs');
const profiles = [];
async function fixture(fileSystem = fs, migrator = async () => undefined) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-default-project-')), control = path.join(directory, 'control'), workspace = path.join(directory, 'workspace');
  await fs.mkdir(workspace); const storage = createWorkspaceStorage({ directory: control, fileSystem }); storage.setArtifactMigrator(migrator);
  await storage.bindRoot({ workspaceId: 'one', name: '当前工作区', directory: workspace });
  const f = { directory, control, workspace, storage, fileSystem }; profiles.push(f); return f;
}
const input = (projectId = 'project-one', name = '产品海报') => ({ projectId, workspaceId: 'one', name });
const intentPath = (f, id = 'project-one') => path.join(f.control, 'default-project-creations-v1', id + '.json');
const children = async f => (await fs.readdir(f.workspace)).filter(name => !name.startsWith('.')).sort();
afterEach(async () => {
  for (const f of profiles.splice(0)) {
    const actual = await fs.realpath(f.directory), temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(actual).toLowerCase() !== temporary.toLowerCase() || !path.basename(actual).startsWith('xuzuo-default-project-')) throw Error('Unowned default project fixture');
    await fs.rm(actual, { recursive: true, force: true });
  }
});

it('默认名称目录直接创建，同名数字后缀不接管已有空目录、原件目录或junction', async () => {
  const f = await fixture(), outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
  await fs.mkdir(path.join(f.workspace, '产品海报')); await fs.mkdir(path.join(f.workspace, '产品海报 (2)'));
  await fs.writeFile(path.join(f.workspace, '产品海报 (2)', '客户原件.txt'), '不可覆盖');
  await fs.symlink(outside, path.join(f.workspace, '产品海报 (3)'), 'junction');
  const created = await f.storage.createDefaultProject(input()), second = await f.storage.createDefaultProject(input('project-two'));
  expect(path.basename(created.directory)).toBe('产品海报 (4)'); expect(path.basename(second.directory)).toBe('产品海报 (5)');
  expect(await fs.readdir(path.join(f.workspace, '产品海报'))).toEqual([]); expect(await fs.readFile(path.join(f.workspace, '产品海报 (2)', '客户原件.txt'), 'utf8')).toBe('不可覆盖'); expect(await fs.readdir(outside)).toEqual([]);
  expect(JSON.parse(await fs.readFile(path.join(created.directory, '.xuzuo/project-v1.json'), 'utf8')).projectId).toBe('project-one');
  expect((await f.storage.list()).projects).toHaveLength(2); await expect(fs.lstat(intentPath(f))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('去除旧ID后缀后仍处理Windows设备名、尾点空格与截断边界，不落成系统别名', async () => {
  const f = await fixture(), names = ['CON', 'NUL.txt', 'PRN.', 'COM1', 'LPT9.txt', 'aux ', 'a'.repeat(47) + '.x', 'a'.repeat(47) + ' x', 'a'.repeat(47)];
  const created = [];
  for (const [index, name] of names.entries()) {
    const location = await f.storage.createDefaultProject(input('reserved-' + index, name)), base = path.basename(location.directory);
    expect(base).not.toMatch(/[.\s]$/); expect(base).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i);
    expect(path.dirname(location.directory)).toBe(f.workspace); expect(path.basename(await fs.realpath(location.directory))).toBe(base); created.push(location.directory);
  }
  expect(new Set(created).size).toBe(names.length); expect(await children(f)).toHaveLength(names.length);
});

it('同ID并发与重放仅创建一个位置；用户后来重命名仍返回现有登记而不改回或清空文件', async () => {
  const f = await fixture(), [first, second] = await Promise.all([f.storage.createDefaultProject(input()), f.storage.createDefaultProject(input())]);
  expect(second).toEqual(first); expect(await children(f)).toEqual(['产品海报']);
  await fs.writeFile(path.join(first.directory, 'files', '原文件.txt'), '保留已有内容');
  await f.storage.ensureProject(input('project-one', '用户后来改的显示名'));
  const registry = await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'));
  const replay = await f.storage.createDefaultProject(input()); expect(replay.directory).toBe(first.directory); expect(replay.name).toBe('用户后来改的显示名');
  expect((await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'))).equals(registry)).toBe(true); expect(await fs.readFile(path.join(first.directory, 'files', '原文件.txt'), 'utf8')).toBe('保留已有内容');
});

it('目录已准备但提交日志写失败，同ID跨重启续用同一目录；冻结请求名称不能偷偷改掉', async () => {
  let fail = false;
  const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'workspace-directories-transition-v1.json') throw Object.assign(Error('synthetic busy'), { code: 'EIO' }); return fs.rename(from, to); } };
  const f = await fixture(fileSystem); fail = true;
  await expect(f.storage.createDefaultProject(input())).rejects.toThrow('准备工作区迁移记录');
  const record = JSON.parse(await fs.readFile(intentPath(f), 'utf8')).intent; expect(record.phase).toBe('prepared'); expect(await children(f)).toEqual(['产品海报']);
  await expect(f.storage.createDefaultProject(input('project-one', '改成另一个名字'))).rejects.toThrow(/已变化|恢复原创建/); expect(await children(f)).toEqual(['产品海报']);
  fail = false; const reopened = createWorkspaceStorage({ directory: f.control, fileSystem }); reopened.setArtifactMigrator(async () => undefined);
  expect((await reopened.createDefaultProject(input())).directory).toBe(record.directory); expect((await reopened.list()).projects).toHaveLength(1); expect(await children(f)).toEqual(['产品海报']); await expect(fs.lstat(intentPath(f))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('已写提交恢复日志的中断可先settle再按同ID返回，不重复分配文件夹', async () => {
  let fail = false; const f = await fixture(fs, async () => { if (fail) throw Error('synthetic migration interruption'); }); fail = true;
  await expect(f.storage.createDefaultProject(input())).rejects.toThrow('恢复记录已保留');
  const record = JSON.parse(await fs.readFile(intentPath(f), 'utf8')).intent; await fs.lstat(path.join(f.control, 'workspace-directories-transition-v1.json'));
  fail = false; const reopened = createWorkspaceStorage({ directory: f.control }); reopened.setArtifactMigrator(async () => undefined);
  const recovered = await reopened.createDefaultProject(input()); expect(recovered.directory).toBe(record.directory); expect(await children(f)).toEqual(['产品海报']);
  await expect(fs.lstat(path.join(f.control, 'workspace-directories-transition-v1.json'))).rejects.toMatchObject({ code: 'ENOENT' }); await expect(fs.lstat(intentPath(f))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('丢失IPC成功回执可从list和同ID免费确认，不打开选择器也不采用renderer指定路径', async () => {
  const f = await fixture(), handlers = new Map(), picker = vi.fn(); let loseAck = true;
  registerProjectCreation({ handle: (name, action) => handlers.set(name, action), dialog: { showOpenDialog: picker }, getWindow: () => undefined, workspaceStorage: f.storage, withProjectWrite: async (_id, action) => { const result = await action(); if (loseAck) { loseAck = false; throw Error('synthetic acknowledgement lost'); } return result; } });
  const create = handlers.get('workspace-create-default-project'), request = { ...input(), directory: path.join(f.directory, 'renderer-forged') };
  await expect(create(request)).rejects.toThrow('acknowledgement'); const [registered] = (await f.storage.list()).projects;
  expect(await create(request)).toEqual(registered); expect(path.dirname(registered.directory)).toBe(f.workspace); expect(await children(f)).toEqual(['产品海报']); expect(picker).not.toHaveBeenCalled();
  await expect(fs.lstat(request.directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('已有自选同名空目录不被默认创建接管，旧选择票据仍只认领原位置', async () => {
  const f = await fixture(), selectedDirectory = path.join(f.workspace, '产品海报'), handlers = new Map(); await fs.mkdir(selectedDirectory);
  const picker = vi.fn(async () => ({ canceled: false, filePaths: [selectedDirectory] }));
  registerProjectCreation({ handle: (name, action) => handlers.set(name, action), dialog: { showOpenDialog: picker }, getWindow: () => undefined, workspaceStorage: f.storage, withProjectWrite: (_id, action) => action() });
  const selection = await handlers.get('workspace-project-folder')({ workspaceId: 'one' }), automatic = await handlers.get('workspace-create-default-project')(input());
  expect(path.basename(automatic.directory)).toBe('产品海报 (2)'); expect(await fs.readdir(selectedDirectory)).toEqual([]);
  const manual = await handlers.get('workspace-create-project')({ selectionId: selection.selectionId, name: '产品海报' });
  expect(manual.directory).toBe(selectedDirectory); expect(manual.projectId).toBe(selection.projectId); expect(manual.projectId).not.toBe(automatic.projectId); expect((await f.storage.list()).projects).toHaveLength(2); expect(picker).toHaveBeenCalledTimes(1);
});

it('已登记项目目录被本地改名后旧请求明确拒绝，不扫描新位置或重建缺失路径', async () => {
  const f = await fixture(), created = await f.storage.createDefaultProject(input()), renamed = path.join(f.workspace, '本地改名后的位置');
  expect(path.dirname(path.resolve(created.directory))).toBe(path.resolve(f.workspace)); await fs.rename(created.directory, renamed);
  await expect(f.storage.createDefaultProject(input())).rejects.toThrow(/不可用|原目录/); await expect(fs.lstat(created.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await fs.readFile(path.join(renamed, '.xuzuo/project-v1.json'), 'utf8')).projectId).toBe('project-one'); expect(await children(f)).toEqual(['本地改名后的位置']);
});

it('候选目录即使已被移走，只要仍有当前或历史location登记就跳过，不能先mkdir重建', async () => {
  const f = await fixture(), previous = await f.storage.createDefaultProject(input('old-project', '历史目录')), movedAside = path.join(f.workspace, '用户保留的旧目录');
  expect(path.dirname(path.resolve(previous.directory))).toBe(path.resolve(f.workspace)); await fs.rename(previous.directory, movedAside);
  const next = await f.storage.createDefaultProject(input('new-project', '历史目录')); expect(path.basename(next.directory)).toBe('历史目录 (2)'); await expect(fs.lstat(previous.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  const secondWorkspace = path.join(f.directory, 'second-workspace'); await fs.mkdir(secondWorkspace); await f.storage.bindRoot({ workspaceId: 'two', name: '另一区', directory: secondWorkspace });
  const historical = await f.storage.createDefaultProject(input('historical-project', '已移动项目')); await f.storage.moveProject({ projectId: historical.projectId, workspaceId: 'two', name: historical.name });
  const oldAside = path.join(f.workspace, '历史原位置已移走'); expect(path.dirname(path.resolve(historical.directory))).toBe(path.resolve(f.workspace)); await fs.rename(historical.directory, oldAside);
  const afterMove = await f.storage.createDefaultProject(input('after-move-project', '已移动项目')); expect(path.basename(afterMove.directory)).toBe('已移动项目 (2)'); await expect(fs.lstat(historical.directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('Windows历史location含尾点空格文本时保守跳过缺失原位置，不探测该路径的文件', async () => {
  expect(defaultDirectoryKey(path.resolve('alias-workspace', '作品. '), 'win32')).toBe(defaultDirectoryKey(path.resolve('alias-workspace', '作品'), 'win32'));
  if (process.platform !== 'win32') return; // Only Windows applies the conservative DOS spelling comparison.
  const f = await fixture(), old = await f.storage.createDefaultProject(input('old-alias-project', '作品')), original = old.directory, alias = original + '. ';
  await fs.writeFile(path.join(original, 'files', '旧原件.txt'), '历史原件保留');
  const second = path.join(f.directory, 'second-workspace'); await fs.mkdir(second); await f.storage.bindRoot({ workspaceId: 'two', name: '另一区', directory: second });
  await f.storage.moveProject({ projectId: old.projectId, workspaceId: 'two', name: '已迁移项目' });
  const moved = path.join(f.workspace, '用户保留的旧作品'); expect(path.dirname(path.resolve(original))).toBe(path.resolve(f.workspace)); await fs.rename(original, moved);
  // Model an accepted older registry spelling; this does not claim Node can create a trailing-dot directory.
  const registryFile = path.join(f.control, 'workspace-directories-v1.json'), registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  registry.locations.find(item => item.projectId === old.projectId && item.directory === original).directory = alias;
  await fs.writeFile(registryFile, JSON.stringify(registry, null, 2) + '\n');
  const oldKeys = [original, alias].map(name => path.resolve(name).toLowerCase()), touched = [];
  const oldPath = name => typeof name === 'string' && oldKeys.some(key => path.resolve(name).toLowerCase() === key || path.resolve(name).toLowerCase().startsWith(key + path.sep));
  const fileSystem = { ...fs, lstat: (...args) => { if (oldPath(args[0])) touched.push('stat'); return fs.lstat(...args); }, readFile: (...args) => { if (oldPath(args[0])) touched.push('read'); return fs.readFile(...args); } };
  const reopened = createWorkspaceStorage({ directory: f.control, fileSystem }); reopened.setArtifactMigrator(async () => undefined);
  const created = await reopened.createDefaultProject(input('new-alias-project', '作品'));
  expect(path.basename(created.directory)).toBe('作品 (2)'); expect(touched).toEqual([]); await expect(fs.lstat(original)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(moved, 'files', '旧原件.txt'), 'utf8')).toBe('历史原件保留');
});

it('macOS保留历史目录的系统别名、大小写与Unicode等价名称', () => {
  expect(defaultDirectoryKey('workspace/Cafe\u0301', 'darwin'))
    .toBe(defaultDirectoryKey('workspace/CAFÉ', 'darwin'));
  if (process.platform === 'darwin') {
    expect(defaultDirectoryKey('/var/folders/workspace/Cafe\u0301', 'darwin'))
      .toBe(defaultDirectoryKey('/private/var/folders/workspace/CAFÉ', 'darwin'));
  }
  expect(defaultDirectoryKey('/Users/example/link/CAFÉ', 'darwin'))
    .not.toBe(defaultDirectoryKey('/Users/example/target/Café', 'darwin'));
});

it.skipIf(process.platform !== 'darwin')('macOS原目录移走后保留历史名称，且拒绝与待清理目录等价的新建位置', async () => {
  const f = await fixture();
  const previous = await f.storage.createDefaultProject(input('old-project', 'Cafe\u0301'));
  const moved = path.join(f.workspace, '用户保留的旧作品');
  await fs.rename(previous.directory, moved);
  const next = await f.storage.createDefaultProject(input('new-project', 'CAFÉ'));
  expect(path.basename(next.directory).normalize('NFC')).toBe('CAFÉ (2)');
  await expect(fs.lstat(previous.directory)).rejects.toMatchObject({ code: 'ENOENT' });

  const blocked = path.join(await fs.realpath(f.workspace), 'Re\u0301serve');
  f.storage.setProjectPurgeGuard({
    ready: Promise.resolve(),
    isPurged: () => false,
    blockedPaths: () => [blocked],
  });
  await expect(f.storage.createDefaultProject(input('blocked-project', 'RÉSERVE')))
    .rejects.toThrow('尚未完成的永久清理任务');
  await expect(fs.lstat(path.join(f.workspace, 'RÉSERVE'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('mkdir成功但身份回执未能保存的模糊中断不会自动接管空目录或换名重发', async () => {
  let fail = false;
  const fileSystem = { ...fs, mkdir: async (...args) => { const result = await fs.mkdir(...args); if (fail && path.basename(args[0]) === '产品海报') throw Object.assign(Error('synthetic mkdir acknowledgement lost'), { code: 'EIO' }); return result; } };
  const f = await fixture(fileSystem); fail = true; await expect(f.storage.createDefaultProject(input())).rejects.toThrow('acknowledgement'); fail = false;
  expect(JSON.parse(await fs.readFile(intentPath(f), 'utf8')).intent.phase).toBe('allocated'); await expect(f.storage.createDefaultProject(input())).rejects.toThrow('身份尚未确认');
  expect(await children(f)).toEqual(['产品海报']); expect(await fs.readdir(path.join(f.workspace, '产品海报'))).toEqual([]); expect((await f.storage.list()).projects).toEqual([]);
});

it('成功提交后清理受管intent；临时清理失败不另建，永久移除时按明确ID清理且账本保留', async () => {
  let failCleanup = false;
  const fileSystem = { ...fs, unlink: async filename => { if (failCleanup && path.basename(path.dirname(filename)) === 'default-project-creations-v1') throw Object.assign(Error('synthetic cleanup busy'), { code: 'EACCES' }); return fs.unlink(filename); } };
  const f = await fixture(fileSystem), ledger = path.join(f.control, 'fee-proof.json'); await fs.writeFile(ledger, '{"nativeAmount":"0.048","costCents":39}\n'); failCleanup = true;
  const created = await f.storage.createDefaultProject(input()); await fs.lstat(intentPath(f)); expect((await f.storage.createDefaultProject(input())).directory).toBe(created.directory); expect(await children(f)).toEqual(['产品海报']);
  failCleanup = false; const time = '2026-11-18T00:00:00.000Z'; await f.storage.forgetProject({ projectId: created.projectId, workspaceId: 'one', audit: { projectId: created.projectId, workspaceId: 'one', name: created.name, kind: 'image', purgedAt: time, trashedAt: time, updatedAt: time, costCents: 39, directories: [created.directory] } });
  await expect(fs.lstat(intentPath(f))).rejects.toMatchObject({ code: 'ENOENT' }); await expect(f.storage.createDefaultProject(input())).rejects.toThrow('永久移除');
  expect(await fs.readFile(ledger, 'utf8')).toBe('{"nativeAmount":"0.048","costCents":39}\n');
});
