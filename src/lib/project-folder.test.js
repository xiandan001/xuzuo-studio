import { it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');

async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-project-folder-'));
  const workspace = path.join(directory, '工作区'); await fs.mkdir(workspace);
  const control = path.join(directory, 'control');
  const storage = createWorkspaceStorage({ directory: control, fileSystem });
  const artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage: storage, fileSystem });
  storage.setArtifactMigrator((id, target, options) => artifacts.migrateProject(id, target, options));
  await storage.bindRoot({ workspaceId: 'workspace-one', name: '隔离工作区', directory: workspace });
  const selected = path.join(workspace, '自己选择的项目目录'); await fs.mkdir(selected);
  const input = { projectId: 'project-one', workspaceId: 'workspace-one', name: '独立作品', directory: selected };
  return { directory, workspace, control, storage, artifacts, selected, input };
}

it('检查所选空目录只读，不登记项目、不创建标记或内部目录', async () => {
  const f = await fixture(), registry = path.join(f.control, 'workspace-directories-v1.json');
  const before = await fs.readFile(registry);
  assert.deepEqual(await f.storage.inspectProjectFolder(f.input), { workspaceId: 'workspace-one', directory: f.selected, folderName: path.basename(f.selected) });
  assert.deepEqual(await fs.readdir(f.selected), []); assert.deepEqual(await fs.readFile(registry), before);
  assert.deepEqual((await f.storage.list()).projects, []);
});

it('确认后精确使用所选文件夹，实际产物保存于其中并可重启读取', async () => {
  const f = await fixture(), place = await f.storage.claimProjectFolder(f.input);
  assert.equal(place.directory, f.selected); assert.deepEqual((await fs.readdir(f.selected)).sort(), ['.xuzuo', 'files', 'trash']);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.selected, '.xuzuo', 'project-v1.json'), 'utf8')).projectId, f.input.projectId);
  const artifact = await f.artifacts.write({ projectId: f.input.projectId, name: '实际成品.txt', mimeType: 'text/plain', text: '原始完整成品' });
  assert.equal(path.dirname(artifact.path), path.join(f.selected, 'files'));
  const reopened = createWorkspaceStorage({ directory: f.control }); reopened.setArtifactMigrator(async () => undefined);
  assert.equal(await reopened.projectDirectory(f.input.projectId), f.selected);
});

it('工作区根、外部目录、保留内部区域和非空目录全部拒绝且不覆盖文件', async () => {
  const f = await fixture(), outside = path.join(f.directory, '外部'); await fs.mkdir(outside);
  const internal = path.join(f.workspace, '.xuzuo-assets'); await fs.mkdir(internal);
  for (const directory of [f.workspace, outside, internal]) await assert.rejects(f.storage.inspectProjectFolder({ ...f.input, directory }));
  const original = path.join(f.selected, '客户原件.txt'); await fs.writeFile(original, '绝不能覆盖');
  await assert.rejects(f.storage.claimProjectFolder(f.input), /空文件夹/);
  assert.equal(await fs.readFile(original, 'utf8'), '绝不能覆盖'); assert.deepEqual((await f.storage.list()).projects, []);
  assert.deepEqual(await fs.readdir(f.selected), ['客户原件.txt']);
});

it('已有项目的祖先、后代以及移动后保留的旧位置不能当作新项目', async () => {
  const f = await fixture(), parent = path.join(f.workspace, '客户资料'); await fs.mkdir(parent);
  const selected = path.join(parent, '已有项目'); await fs.mkdir(selected);
  const place = await f.storage.claimProjectFolder({ ...f.input, directory: selected });
  const child = path.join(place.directory, '新子目录'); await fs.mkdir(child);
  for (const directory of [parent, child, place.directory]) await assert.rejects(f.storage.inspectProjectFolder({ workspaceId: f.input.workspaceId, directory }), /已有项目|重叠/);
  const other = path.join(f.directory, '另一工作区'); await fs.mkdir(other);
  await f.storage.bindRoot({ workspaceId: 'workspace-two', name: '另一区', directory: other });
  await f.storage.moveProject({ projectId: f.input.projectId, workspaceId: 'workspace-two', name: '独立作品' });
  await assert.rejects(f.storage.inspectProjectFolder({ workspaceId: f.input.workspaceId, directory: selected }), /已有项目|重叠/);
});

it('稳定ID同路径重试幂等且保留成品，不能更换已登记项目的位置或工作区', async () => {
  const f = await fixture(), first = await f.storage.claimProjectFolder(f.input);
  await f.artifacts.write({ projectId: f.input.projectId, name: '已有.txt', mimeType: 'text/plain', text: '保留' });
  const registry = await fs.readFile(path.join(f.control, 'workspace-directories-v1.json'));
  assert.deepEqual(await f.storage.claimProjectFolder(f.input), first);
  assert.deepEqual(await fs.readFile(path.join(f.control, 'workspace-directories-v1.json')), registry);
  await assert.rejects(f.storage.claimProjectFolder({ ...f.input, directory: f.workspace }), /位置|目录/);
  await assert.rejects(f.storage.claimProjectFolder({ ...f.input, workspaceId: 'workspace-two' }), /工作区/);
});

it('其他项目身份标记不能被相同名称或不同新ID覆盖', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.selected, '.xuzuo'));
  const filename = path.join(f.selected, '.xuzuo', 'project-v1.json'), content = '{"version":1,"projectId":"another-project"}\n';
  await fs.writeFile(filename, content);
  await assert.rejects(f.storage.claimProjectFolder(f.input));
  assert.equal(await fs.readFile(filename, 'utf8'), content); assert.deepEqual((await f.storage.list()).projects, []);
});

it('选择后目录被其它文件占用，提交时重新检查并保留这些文件', async () => {
  const f = await fixture(); await f.storage.inspectProjectFolder(f.input);
  await fs.writeFile(path.join(f.selected, '后来添加.txt'), '后来添加的原件');
  await assert.rejects(f.storage.claimProjectFolder(f.input), /空文件夹/);
  assert.deepEqual(await fs.readdir(f.selected), ['后来添加.txt']);
});

it('选择后空目录被外部删除时拒绝提交，不重新创建空项目覆盖缺失路径', async () => {
  const f = await fixture(); await f.storage.inspectProjectFolder(f.input); await fs.rmdir(f.selected);
  await assert.rejects(f.storage.claimProjectFolder(f.input), /目录已不可用/);
  await assert.rejects(fs.lstat(f.selected), { code: 'ENOENT' }); assert.deepEqual((await f.storage.list()).projects, []);
});

it('拒绝经过符号链接或junction的目录', async () => {
  const f = await fixture(), outside = path.join(f.directory, '链接目标'); await fs.mkdir(outside);
  const link = path.join(f.workspace, '目录链接'); await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.storage.inspectProjectFolder({ ...f.input, directory: link }), /链接|junction/);
  assert.deepEqual(await fs.readdir(outside), []);
});

it('两个新ID同时认领一个空目录时只登记一个项目', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.storage.claimProjectFolder(f.input), f.storage.claimProjectFolder({ ...f.input, projectId: 'project-two' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await f.storage.list()).projects.length, 1);
});

it('准备目录后登记写入失败，同一稳定ID可重试且不会另建文件夹', async () => {
  let fail = false;
  const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'workspace-directories-transition-v1.json') throw Object.assign(new Error('fixture write denied'), { code: 'EIO' }); return fs.rename(from, to); } };
  const f = await fixture(fileSystem); fail = true;
  await assert.rejects(f.storage.claimProjectFolder(f.input), /准备工作区迁移记录/);
  assert.equal((await f.storage.list()).projects.length, 0);
  fail = false; assert.equal((await f.storage.claimProjectFolder(f.input)).directory, f.selected);
  assert.equal((await f.storage.list()).projects.length, 1);
  assert.equal((await fs.readdir(f.workspace)).filter(name => !name.startsWith('.')).length, 1);
});

it('失败后的自有准备目录出现额外文件时，不再把它作为空目录认领', async () => {
  let fail = false;
  const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'workspace-directories-transition-v1.json') throw new Error('fixture'); return fs.rename(from, to); } };
  const f = await fixture(fileSystem); fail = true; await assert.rejects(f.storage.claimProjectFolder(f.input)); fail = false;
  await fs.writeFile(path.join(f.selected, '外部文件.txt'), '外部内容');
  await assert.rejects(f.storage.claimProjectFolder(f.input), /空文件夹/);
  assert.equal(await fs.readFile(path.join(f.selected, '外部文件.txt'), 'utf8'), '外部内容');
});

it('已有自动目录接口和跨工作区移动继续保留原行为', async () => {
  const f = await fixture(), automatic = await f.storage.ensureProject({ projectId: 'auto-project', workspaceId: 'workspace-one', name: '自动项目' });
  assert.notEqual(automatic.directory, f.selected); assert.ok(path.basename(automatic.directory).startsWith('自动项目-'));
  const target = path.join(f.directory, '目标区'); await fs.mkdir(target);
  await f.storage.bindRoot({ workspaceId: 'workspace-two', name: '目标', directory: target });
  await f.storage.claimProjectFolder(f.input);
  await f.artifacts.write({ projectId: f.input.projectId, name: '移动.txt', mimeType: 'text/plain', text: '完整内容' });
  const moved = await f.storage.moveProject({ projectId: f.input.projectId, workspaceId: 'workspace-two', name: '独立作品' });
  assert.equal((await f.artifacts.listProject(f.input.projectId))[0].path.startsWith(moved.directory + path.sep), true);
  assert.equal(await fs.readFile((await f.artifacts.listProject(f.input.projectId))[0].path, 'utf8'), '完整内容');
});
