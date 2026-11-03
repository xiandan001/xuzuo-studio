import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');

async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-workspace-files-'));
  const control = path.join(directory, 'control'), legacy = path.join(directory, 'legacy');
  const ws1 = path.join(directory, '客户甲'), ws2 = path.join(directory, '客户乙');
  await fs.mkdir(ws1); await fs.mkdir(ws2);
  const storage = createWorkspaceStorage({ directory: control, fileSystem });
  const store = createArtifactStore({ directory: legacy, workspaceStorage: storage, fileSystem });
  storage.setArtifactMigrator((projectId, target) => store.migrateProject(projectId, target));
  return { directory, control, legacy, ws1, ws2, storage, store };
}
async function bind(f, id = 'w1', directory = f.ws1, projects = []) { return f.storage.bindRoot({ workspaceId: id, name: id, directory, projects }); }
async function project(f, id = 'p1', workspaceId = 'w1', name = '同名项目') { return f.storage.ensureProject({ projectId: id, workspaceId, name }); }
const input = projectId => ({ projectId, name: '实际交付.txt', mimeType: 'text/plain', text: '必须保留的实际文件', runId: 'same-run' });

it('两个本地工作区同名项目分别保存，项目重命名不改路径，重新打开保留登记', async () => {
  const f = await fixture(); await bind(f); await bind(f, 'w2', f.ws2);
  const p1 = await project(f), p2 = await project(f, 'p2', 'w2');
  const a = await f.store.write(input('p1')), b = await f.store.write(input('p2'));
  assert.equal(path.dirname(a.path), path.join(p1.directory, 'files'));
  assert.equal(path.dirname(b.path), path.join(p2.directory, 'files')); assert.notEqual(a.path, b.path);
  assert.equal((await project(f, 'p1', 'w1', '新显示名')).directory, p1.directory);
  const reopened = createWorkspaceStorage({ directory: f.control });
  reopened.setArtifactMigrator((id, target) => f.store.migrateProject(id, target));
  assert.equal(await reopened.projectDirectory('p1'), p1.directory);
  assert.equal((await reopened.list()).workspaces.length, 2);
});

it('未登记项目不能写入，项目与工作区归属必须一致，任意目录不获授权', async () => {
  const f = await fixture(); await bind(f); await project(f);
  await assert.rejects(f.store.write(input('unknown')), /尚未绑定/);
  await assert.rejects(f.storage.assertProject('p1', 'w2'), /不属于/);
  await assert.rejects(f.storage.validateDirectory(f.ws2, 'p1'), /尚未登记/);
  await assert.rejects(project(f, 'p1', 'w2'), /先为这个工作区/);
});

it('工作区目录不能相同或互相嵌套，原绑定不会被新位置静默替换', async () => {
  const f = await fixture(); await bind(f);
  await assert.rejects(bind(f, 'w2', f.ws1), /相同或互相嵌套/);
  const child = path.join(f.ws1, '子目录'); await fs.mkdir(child);
  await assert.rejects(bind(f, 'w2', child), /相同或互相嵌套/);
  await assert.rejects(bind(f, 'w2', f.directory), /相同或互相嵌套/);
  await assert.rejects(bind(f, 'w1', f.ws2), /已绑定本地目录/);
  assert.equal(await f.storage.validateWorkspace('w1'), f.ws1);
  await assert.rejects(f.storage.validateWorkspace('missing'), /尚未绑定/);
});

it('工作区打开检查根目录身份，不能误用项目专用授权或接收替换目录', async () => {
  const f = await fixture(); await bind(f);
  assert.equal(await f.storage.validateWorkspace('w1'), f.ws1);
  await assert.rejects(f.storage.validateDirectory(f.ws1), /尚未登记/);
  await fs.writeFile(path.join(f.ws1, '.xuzuo-workspace-v1.json'), '{"version":1,"workspaceId":"different"}\n');
  await assert.rejects(f.storage.validateWorkspace('w1'), /身份不匹配/);
  await assert.rejects(bind(f), /身份不匹配/);
});

it('绑定旧工作区复制校验后切换ID定位，旧源与原账单保持不变', async () => {
  const f = await fixture();
  const legacyStore = createArtifactStore({ directory: f.legacy });
  const old = await legacyStore.write(input('p1'));
  const feeFile = path.join(f.control, 'fee-fixture.json'); await fs.writeFile(feeFile, '{"cost":"0.00603"}\n');
  await bind(f, 'w1', f.ws1, [{ id: 'p1', name: '旧项目', workspaceId: 'w1' }]);
  const current = await f.store.read(old.id);
  assert.equal(current.id, old.id); assert.equal(current.buffer.toString(), '必须保留的实际文件');
  assert.ok(current.path.startsWith(f.ws1 + path.sep)); assert.notEqual(current.path, old.path);
  assert.equal(await fs.readFile(old.path, 'utf8'), current.buffer.toString());
  assert.equal(await fs.readFile(feeFile, 'utf8'), '{"cost":"0.00603"}\n');
  assert.equal((await f.store.migrateProject('p1')).migrated, 0);
});

it('本地目录内删除/恢复产物沿原项目目录，重启后保留同一ID', async () => {
  const f = await fixture(); await bind(f); const p = await project(f);
  const a = await f.store.write(input('p1')); const trashed = await f.store.trash(a.id);
  assert.equal(path.dirname(trashed.path), path.join(p.directory, 'trash'));
  await assert.rejects(f.store.read(a.id), /回收站/);
  const reopened = createArtifactStore({ directory: f.legacy, workspaceStorage: f.storage });
  assert.equal((await reopened.listTrash())[0].id, a.id);
  const restored = await reopened.restore(a.id);
  assert.equal(restored.id, a.id); assert.equal(restored.path, a.path);
  assert.equal((await reopened.read(a.id)).buffer.toString(), '必须保留的实际文件');
});

it('跨工作区复制编辑源、正常和回收文件，切换后新产物都进入新项目目录', async () => {
  const f = await fixture(); await bind(f); await bind(f, 'w2', f.ws2); const p = await project(f);
  const a = await f.store.write(input('p1')), b = await f.store.write(input('p1')); const trashed = await f.store.trash(b.id);
  await fs.writeFile(path.join(p.directory, '.xuzuo', 'editor-v1.json'), '{"revision":2}\n');
  const moved = await f.storage.moveProject({ projectId: 'p1', workspaceId: 'w2', name: '同名项目' });
  assert.ok(moved.directory.startsWith(f.ws2 + path.sep));
  assert.equal((await f.store.read(a.id)).path, path.join(moved.directory, 'files', path.basename(a.path)));
  assert.equal((await f.store.listTrash())[0].path, path.join(moved.directory, 'trash', path.basename(trashed.path)));
  assert.equal(await fs.readFile(path.join(moved.directory, '.xuzuo', 'editor-v1.json'), 'utf8'), '{"revision":2}\n');
  assert.equal(await fs.readFile(a.path, 'utf8'), '必须保留的实际文件');
  const next = await f.store.write(input('p1')); assert.equal(path.dirname(next.path), path.join(moved.directory, 'files'));
  await assert.rejects(f.storage.assertProject('p1', 'w1'), /不属于/); assert.equal((await f.storage.assertProject('p1', 'w2')).projectId, 'p1');
  await fs.writeFile(path.join(moved.directory, '.xuzuo', 'editor-v1.json'), '{"revision":3}\n');
  const returned = await f.storage.moveProject({ projectId: 'p1', workspaceId: 'w1', name: '同名项目' });
  assert.notEqual(returned.directory, p.directory);
  assert.equal(await fs.readFile(path.join(returned.directory, '.xuzuo', 'editor-v1.json'), 'utf8'), '{"revision":3}\n');
  assert.equal(await fs.readFile(path.join(p.directory, '.xuzuo', 'editor-v1.json'), 'utf8'), '{"revision":2}\n');
});

it('迁移manifest提交失败保留源和恢复日志，再打开按同一ID完成迁移', async () => {
  let fail = false;
  const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'manifest-v1.json') throw Object.assign(new Error('test disk busy'), { code: 'EIO' }); return fs.rename(from, to); } };
  const f = await fixture(fileSystem); const legacyStore = createArtifactStore({ directory: f.legacy }); const a = await legacyStore.write(input('p1'));
  fail = true;
  await assert.rejects(bind(f, 'w1', f.ws1, [{ id: 'p1', workspaceId: 'w1', name: '旧项目' }]), /恢复记录已保留/);
  assert.equal(await fs.readFile(a.path, 'utf8'), '必须保留的实际文件');
  await fs.lstat(path.join(f.control, 'workspace-directories-transition-v1.json'));
  fail = false;
  const reopened = createWorkspaceStorage({ directory: f.control, fileSystem });
  const artifacts = createArtifactStore({ directory: f.legacy, workspaceStorage: reopened, fileSystem });
  reopened.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  assert.equal((await reopened.list()).projects[0].projectId, 'p1');
  assert.equal((await artifacts.read(a.id)).buffer.toString(), '必须保留的实际文件');
  await assert.rejects(fs.lstat(path.join(f.control, 'workspace-directories-transition-v1.json')), { code: 'ENOENT' });
});

it('准备迁移日志失败前不改变artifact manifest，下一次操作可正常重试', async () => {
  let deny = false;
  const fileSystem = { ...fs, writeFile: async (filename, ...args) => { if (deny && path.basename(filename).startsWith('workspace-directories-transition-v1.json.')) throw new Error('journal denied'); return fs.writeFile(filename, ...args); } };
  const f = await fixture(fileSystem), legacyStore = createArtifactStore({ directory: f.legacy }); const a = await legacyStore.write(input('p1'));
  const before = await fs.readFile(path.join(f.legacy, 'manifest-v1.json'), 'utf8');
  deny = true;
  await assert.rejects(bind(f, 'w1', f.ws1, [{ id: 'p1', workspaceId: 'w1', name: '旧项目' }]), /原有登记和文件保持不变/);
  assert.equal(await fs.readFile(path.join(f.legacy, 'manifest-v1.json'), 'utf8'), before);
  assert.equal((await f.storage.list()).workspaces.length, 0);
  deny = false;
  await bind(f, 'w1', f.ws1, [{ id: 'p1', workspaceId: 'w1', name: '旧项目' }]);
  assert.ok((await f.store.read(a.id)).path.startsWith(f.ws1 + path.sep));
});

it('registry提交失败但artifact已切换时仍可安全读取，重启按迁移日志补交登记', async () => {
  let fail = false;
  const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'workspace-directories-v1.json') throw new Error('registry denied'); return fs.rename(from, to); } };
  const f = await fixture(fileSystem), legacyStore = createArtifactStore({ directory: f.legacy }); const a = await legacyStore.write(input('p1'));
  fail = true;
  await assert.rejects(bind(f, 'w1', f.ws1, [{ id: 'p1', workspaceId: 'w1', name: '旧项目' }]), /恢复记录已保留/);
  assert.equal((await f.store.read(a.id)).buffer.toString(), '必须保留的实际文件');
  fail = false;
  const reopened = createWorkspaceStorage({ directory: f.control }); const artifacts = createArtifactStore({ directory: f.legacy, workspaceStorage: reopened });
  reopened.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  assert.equal((await reopened.list()).projects[0].projectId, 'p1');
  assert.ok((await artifacts.read(a.id)).path.startsWith(f.ws1 + path.sep));
});

it('项目目录产物回收失败后可按中央日志恢复真实位置，不回落legacy files', async () => {
  let failCommit = false, failRollback = false;
  const fileSystem = { ...fs, rename: async (from, to) => {
    if (failCommit && path.basename(to) === 'manifest-v1.json') { failCommit = false; failRollback = true; throw new Error('manifest denied'); }
    if (failRollback && path.basename(path.dirname(from)) === 'trash' && path.basename(path.dirname(to)) === 'files') throw new Error('rollback denied');
    return fs.rename(from, to);
  } };
  const f = await fixture(fileSystem); await bind(f); const p = await project(f); const a = await f.store.write(input('p1'));
  failCommit = true; await assert.rejects(f.store.trash(a.id), /文件仍被保留/);
  const reopened = createArtifactStore({ directory: f.legacy, workspaceStorage: f.storage });
  const trash = await reopened.listTrash(); assert.equal(trash[0].id, a.id); assert.equal(path.dirname(trash[0].path), path.join(p.directory, 'trash'));
  const restored = await reopened.restore(a.id); assert.equal(restored.path, a.path);
});

it('掉盘或项目目录被移走时不重建空目录，读写和创建均明确拒绝', async () => {
  const f = await fixture(); await bind(f); const p = await project(f); const a = await f.store.write(input('p1'));
  const moved = `${p.directory}-moved`; await fs.rename(p.directory, moved);
  await assert.rejects(f.storage.assertProject('p1'), /不可用/); await assert.rejects(f.store.read(a.id), /不可用/);
  await assert.rejects(project(f), /不可用/); await assert.rejects(fs.lstat(p.directory), { code: 'ENOENT' });
});

it('写权限失败在assertProject探针中报告，不静默回落全局目录', async () => {
  let deny = false;
  const fileSystem = { ...fs, writeFile: async (filename, ...args) => { if (deny && path.basename(filename).startsWith('.write-probe-')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.writeFile(filename, ...args); } };
  const f = await fixture(fileSystem); await bind(f); await project(f); deny = true;
  await assert.rejects(f.storage.assertProject('p1'), /不可写/);
});

it('编辑源目录可写但files不可写时，付费前检查同样拒绝', async () => {
  let deny = false;
  const fileSystem = { ...fs, writeFile: async (filename, ...args) => { if (deny && path.basename(path.dirname(filename)) === 'files' && path.basename(filename).startsWith('.write-probe-')) throw Object.assign(new Error('files denied'), { code: 'EACCES' }); return fs.writeFile(filename, ...args); } };
  const f = await fixture(fileSystem); await bind(f); await project(f); deny = true;
  await assert.rejects(f.storage.assertProject('p1'), /不可写/);
});

it('真实junction和项目内链接被拒，外部文件不被复制或读取', async () => {
  const f = await fixture(); const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), '不能读写');
  const linked = path.join(f.directory, 'linked'); await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(bind(f, 'w1', linked), /junction/);
  await bind(f); await bind(f, 'w2', f.ws2); const p = await project(f);
  await fs.symlink(outside, path.join(p.directory, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.storage.moveProject({ projectId: 'p1', workspaceId: 'w2', name: '项目' }), /junction/);
  assert.equal((await f.storage.list()).projects[0].workspaceId, 'w1');
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), '不能读写');
});
