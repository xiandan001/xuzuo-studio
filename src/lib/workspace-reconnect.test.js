import { it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const { createWorkspaceStorage } = createRequire(import.meta.url)('../../electron/workspace-storage.cjs');

async function fixture(count = 2, fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-workspace-reconnect-'));
  const workspace = path.join(directory, 'Downloads'), control = path.join(directory, 'control'); await fs.mkdir(workspace);
  const storage = createWorkspaceStorage({ directory: control, fileSystem }); storage.setArtifactMigrator(async () => undefined);
  await storage.bindRoot({ workspaceId: 'workspace-one', name: '原工作区', directory: workspace });
  const projects = [];
  for (let index = 0; index < count; index++) projects.push(await storage.ensureProject({ projectId: `project-${index}`, workspaceId: 'workspace-one', name: `回收项目${index}` }));
  const registry = path.join(control, 'workspace-directories-v1.json');
  return { directory, workspace, control, storage, projects, registry, marker: path.join(workspace, '.xuzuo-workspace-v1.json') };
}
const reconnect = (f, directory = f.workspace) => f.storage.reconnectRoot({ workspaceId: 'workspace-one', directory });
async function moveOwned(f, from, to) {
  for (const filename of [from, to]) { const relative = path.relative(f.directory, path.resolve(filename)); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); }
  await fs.rename(from, to);
}
async function missing(filename) { await assert.rejects(fs.lstat(filename), { code: 'ENOENT' }); }

it('显式重选同一原目录后恢复8个已外删旧项目的工作区连接，不重建旧项目或改变账本与索引', async () => {
  const f = await fixture(8), before = await fs.readFile(f.registry), ledger = path.join(f.control, 'ledger-fixture.json');
  await fs.writeFile(ledger, '{"amount":"0.0246785","entries":4}\n'); const originalLedger = await fs.readFile(ledger);
  for (const project of f.projects) await moveOwned(f, project.directory, path.join(f.directory, `removed-${project.projectId}`));
  await fs.unlink(f.marker);
  await assert.rejects(f.storage.repair({ workspaceId: 'workspace-one' }), /项目目录或项目身份标记/);
  const result = await reconnect(f);
  assert.equal(result.repaired, true); assert.deepEqual(result.missingProjectIds, f.projects.map(item => item.projectId));
  assert.deepEqual(await fs.readFile(f.registry), before); assert.deepEqual(await fs.readFile(ledger), originalLedger);
  for (const project of f.projects) await missing(project.directory);
  assert.deepEqual((await f.storage.list()).projects, f.projects);
  const selected = path.join(f.workspace, '新项目文件夹'); await fs.mkdir(selected);
  const created = await f.storage.claimProjectFolder({ projectId: 'new-project', workspaceId: 'workspace-one', directory: selected, name: '新项目' });
  assert.equal(created.directory, selected); assert.equal(await f.storage.projectDirectory('new-project'), selected);
  assert.deepEqual(await fs.readFile(ledger), originalLedger);
});

it('部分旧项目真实存在时核验其身份和文件，缺失项目只返回编号，重复重连幂等', async () => {
  const f = await fixture(), existing = f.projects[0], raw = path.join(existing.directory, 'files', 'keep.txt');
  await fs.writeFile(raw, '原始正文保留'); const registry = await fs.readFile(f.registry);
  await moveOwned(f, f.projects[1].directory, path.join(f.directory, 'removed-one')); await fs.unlink(f.marker);
  assert.deepEqual((await reconnect(f)).missingProjectIds, [f.projects[1].projectId]);
  assert.deepEqual(await reconnect(f), { workspaceId: 'workspace-one', name: '原工作区', directory: f.workspace, repaired: false, missingProjectIds: [f.projects[1].projectId] });
  assert.equal(await fs.readFile(raw, 'utf8'), '原始正文保留'); assert.deepEqual(await fs.readFile(f.registry), registry);
});

it('空工作区可在用户显式重选同一原目录后恢复，原严格repair仍不放宽', async () => {
  const f = await fixture(0); await fs.unlink(f.marker);
  await assert.rejects(f.storage.repair({ workspaceId: 'workspace-one' }), /没有可核验/); await missing(f.marker);
  assert.deepEqual((await reconnect(f)).missingProjectIds, []); assert.equal(await f.storage.validateWorkspace('workspace-one'), f.workspace);
});

it('不接受别的位置、父目录、未登记编号或相对路径，不改登记或创建标记', async () => {
  const f = await fixture(0), wrong = path.join(f.directory, 'other'); await fs.mkdir(wrong); await fs.unlink(f.marker);
  for (const directory of [wrong, f.directory, 'relative']) await assert.rejects(reconnect(f, directory), /原登记|原工作区|绝对目录/);
  await assert.rejects(f.storage.reconnectRoot({ workspaceId: 'unknown', directory: f.workspace }), /尚未绑定/);
  await missing(f.marker); await missing(path.join(wrong, '.xuzuo-workspace-v1.json'));
});

it('原目录不存在时不自动造空目录，用户手工新建原位置后才可重连且不重建历史项目', async () => {
  const f = await fixture(); await fs.unlink(f.marker); const offline = path.join(f.directory, 'old-root'); await moveOwned(f, f.workspace, offline);
  await assert.rejects(reconnect(f), /目录已不可用/); await missing(f.workspace);
  await fs.mkdir(f.workspace); const result = await reconnect(f); assert.equal(result.missingProjectIds.length, 2);
  for (const project of f.projects) await missing(project.directory);
  assert.equal((await fs.lstat(path.join(offline, path.basename(f.projects[0].directory)))).isDirectory(), true);
});

it('任何仍存在的项目目录缺少、损坏或冲突身份都拒绝，不把现存资料当作删除', async () => {
  for (const kind of ['missing', 'different', 'corrupt', 'null', 'file']) {
    const f = await fixture(1), project = f.projects[0], marker = path.join(project.directory, '.xuzuo', 'project-v1.json'); await fs.unlink(f.marker);
    if (kind === 'file') { await moveOwned(f, project.directory, path.join(f.directory, 'old-project')); await fs.writeFile(project.directory, '占位原文件'); }
    else if (kind === 'missing') await fs.unlink(marker);
    else await fs.writeFile(marker, kind === 'different' ? '{"version":1,"projectId":"other"}' : kind === 'null' ? 'null' : '{broken');
    await assert.rejects(reconnect(f), /项目目录.*身份|项目身份/); await missing(f.marker);
    if (kind === 'file') assert.equal(await fs.readFile(project.directory, 'utf8'), '占位原文件');
  }
});

it('拒绝项目junction，不读取或改动它指向的外部资料', async () => {
  const f = await fixture(1), project = f.projects[0], outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), '不改');
  await moveOwned(f, project.directory, path.join(f.directory, 'old-project')); await fs.symlink(outside, project.directory, process.platform === 'win32' ? 'junction' : 'dir'); await fs.unlink(f.marker);
  await assert.rejects(reconnect(f), /项目目录.*身份|项目身份/); await missing(f.marker); assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), '不改');
});

it('已有根标记损坏、冲突、非文件或链接时一律拒绝，不覆盖原标记', async () => {
  for (const text of ['{"version":1,"workspaceId":"other"}', '{broken', 'null']) {
    const f = await fixture(0); await fs.writeFile(f.marker, text); await assert.rejects(reconnect(f), /身份不匹配|连接标记无法读取/); assert.equal(await fs.readFile(f.marker, 'utf8'), text);
  }
  const f = await fixture(0); await fs.unlink(f.marker); await fs.mkdir(f.marker); await assert.rejects(reconnect(f), /连接标记无法读取/); assert.equal((await fs.lstat(f.marker)).isDirectory(), true);
  let blocked = false, reads = 0;
  const fileSystem = { ...fs, lstat: async filename => { const stat = await fs.lstat(filename); if (blocked && path.basename(filename) === '.xuzuo-workspace-v1.json') stat.isSymbolicLink = () => true; return stat; }, readFile: async (filename, ...args) => { if (blocked && path.basename(filename) === '.xuzuo-workspace-v1.json') reads++; return fs.readFile(filename, ...args); } };
  const linked = await fixture(0, fileSystem), original = await fs.readFile(linked.marker); blocked = true;
  await assert.rejects(reconnect(linked), /连接标记无法读取/); assert.equal(reads, 0); assert.deepEqual(await fs.readFile(linked.marker), original);
});

it('原根目录被替换为junction或文件时拒绝，不在链接目标恢复标记', async () => {
  for (const kind of ['link', 'file']) {
    const f = await fixture(0); await fs.unlink(f.marker); await moveOwned(f, f.workspace, path.join(f.directory, 'old-root'));
    if (kind === 'link') { const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, f.workspace, process.platform === 'win32' ? 'junction' : 'dir'); }
    else await fs.writeFile(f.workspace, '保留原文件');
    await assert.rejects(reconnect(f), /符号链接|非目录/);
    if (kind === 'link') await missing(path.join(f.directory, 'outside', '.xuzuo-workspace-v1.json'));
    else assert.equal(await fs.readFile(f.workspace, 'utf8'), '保留原文件');
  }
});

it('项目lstat权限错误不能当作目录已删除跳过', async () => {
  let denied;
  const fileSystem = { ...fs, lstat: async filename => { if (filename === denied) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.lstat(filename); } };
  const f = await fixture(1, fileSystem); await fs.unlink(f.marker); denied = f.projects[0].directory;
  await assert.rejects(reconnect(f), /项目目录.*身份|项目身份/); await missing(f.marker);
});

it('wx写入竞争只接受同身份普通标记；冲突竞争、写入失败都不覆盖并支持重试', async () => {
  for (const same of [true, false]) {
    let racing = false;
    const fileSystem = { ...fs, writeFile: async (filename, data, options) => { if (racing && path.basename(filename) === '.xuzuo-workspace-v1.json') { racing = false; await fs.writeFile(filename, JSON.stringify({ version: 1, workspaceId: same ? 'workspace-one' : 'other' }), { flag: 'wx' }); } return fs.writeFile(filename, data, options); } };
    const f = await fixture(0, fileSystem); await fs.unlink(f.marker); racing = true;
    if (same) assert.equal((await reconnect(f)).repaired, false); else await assert.rejects(reconnect(f), /身份不匹配/);
    assert.equal(JSON.parse(await fs.readFile(f.marker, 'utf8')).workspaceId, same ? 'workspace-one' : 'other');
  }
  let denied = false;
  const fileSystem = { ...fs, writeFile: async (filename, ...args) => { if (denied && path.basename(filename) === '.xuzuo-workspace-v1.json') throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.writeFile(filename, ...args); } };
  const f = await fixture(0, fileSystem); await fs.unlink(f.marker); denied = true;
  await assert.rejects(reconnect(f), /未能保存/); await missing(f.marker); denied = false; assert.equal((await reconnect(f)).repaired, true);
});
