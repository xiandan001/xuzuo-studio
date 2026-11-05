import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createAssetLibrary } = require('../../electron/asset-library.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const staged = path.join(root, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(staged) ? staged : path.join(root, 'package.json'));
const JSZip = dependencies('jszip');
async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-asset-library-'));
  const first = path.join(directory, 'first'), second = path.join(directory, 'second'); await fs.mkdir(first); await fs.mkdir(second);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'control') });
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, target) => store.migrateProject(id, target));
  await storage.bindRoot({ workspaceId: 'workspace-one', name: '工作区一', directory: first });
  await storage.bindRoot({ workspaceId: 'workspace-two', name: '工作区二', directory: second });
  const project = await storage.ensureProject({ projectId: 'project-one', workspaceId: 'workspace-one', name: '项目一' });
  const other = await storage.ensureProject({ projectId: 'project-two', workspaceId: 'workspace-two', name: '项目二' });
  const options = { workspaceStorage: storage, artifactStore: store, fileSystem }, library = createAssetLibrary(options);
  const source = path.join(directory, '测试资料.txt'); await fs.writeFile(source, '完整素材正文-END');
  return { directory, first, second, project, other, storage, store, options, library, source, index: path.join(first, '.xuzuo-assets', 'library-v1.json'), files: path.join(first, '.xuzuo-assets', 'files') };
}
const list = f => f.library.list({ workspaceId: 'workspace-one' });
const imported = async f => (await f.library.importPaths({ workspaceId: 'workspace-one', paths: [f.source] }))[0];
const read = (f, id, workspaceId = 'workspace-one') => f.library.read({ workspaceId, id });
const attach = (f, id, projectId = 'project-one', workspaceId = 'workspace-one') => f.library.attach({ workspaceId, id, projectId });
const backingFile = async (f, id) => path.join(f.files, JSON.parse(await fs.readFile(f.index, 'utf8')).assets.find(item => item.id === id).fileName);

describe('真实本地素材库', () => {
  it('首次空库正确返回空列表，读取不自动创建目录', async () => {
    const f = await fixture(); expect(await list(f)).toEqual([]);
    await expect(fs.lstat(path.join(f.first, '.xuzuo-assets'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await imported(f)).name).toBe('测试资料.txt');
  });
  it('重启仍保留实际素材、收藏与归档状态，恢复归档后仍可读原字节', async () => {
    const f = await fixture(), item = await imported(f);
    await f.library.update({ workspaceId: 'workspace-one', id: item.id, favorite: true, archived: true });
    const reopened = createAssetLibrary(f.options), items = await reopened.list({ workspaceId: 'workspace-one' });
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ id: item.id, favorite: true, archivedAt: expect.any(String) });
    await expect(reopened.read({ workspaceId: 'workspace-one', id: item.id })).rejects.toThrow('回收站');
    await reopened.update({ workspaceId: 'workspace-one', id: item.id, archived: false });
    expect((await reopened.read({ workspaceId: 'workspace-one', id: item.id })).buffer.toString()).toBe('完整素材正文-END');
  });
  it('加入项目复制真实bytes和独立ID，归档／外部删除素材不破坏项目副本', async () => {
    const f = await fixture(), item = await imported(f), copy = await attach(f, item.id);
    expect(copy.name).toBe(item.name);
    expect(copy.id).not.toBe(item.id); expect(path.dirname(copy.path)).toBe(path.join(f.project.directory, 'files'));
    expect((await f.store.read(copy.id)).buffer).toEqual(await fs.readFile(f.source));
    await f.library.update({ workspaceId: 'workspace-one', id: item.id, archived: true }); await expect(attach(f, item.id)).rejects.toThrow('回收站');
    await fs.unlink(await backingFile(f, item.id));
    expect((await f.store.read(copy.id)).buffer.toString()).toBe('完整素材正文-END');
  });
  it('跨工作区、未知素材／项目ID和未登记工作区均被拒绝，不能偷换来源', async () => {
    const f = await fixture(), item = await imported(f);
    await expect(attach(f, item.id, 'project-two')).rejects.toThrow(/不属于|工作区/);
    await expect(attach(f, item.id, 'project-two', 'workspace-two')).rejects.toThrow(/不存在|回收站/);
    await expect(read(f, item.id, 'workspace-two')).rejects.toThrow('不存在');
    await expect(attach(f, '../../outside')).rejects.toThrow('不存在');
    await expect(attach(f, item.id, 'unknown-project')).rejects.toThrow(/不属于|工作区/);
    await expect(f.library.list({ workspaceId: 'unknown-workspace' })).rejects.toThrow('尚未绑定');
    expect(await fs.readdir(path.join(f.other.directory, 'files'))).toEqual([]);
  });
  it('损坏索引不自动重置，list／update／新增均保留原串和原素材', async () => {
    const f = await fixture(), item = await imported(f), beforeFiles = await fs.readdir(f.files), broken = '{broken asset index'; await fs.writeFile(f.index, broken);
    await expect(list(f)).rejects.toThrow('索引无法读取');
    await expect(f.library.update({ workspaceId: 'workspace-one', id: item.id, favorite: true })).rejects.toThrow('索引无法读取');
    await expect(imported(f)).rejects.toThrow('索引无法读取');
    expect(await fs.readFile(f.index, 'utf8')).toBe(broken); expect(await fs.readdir(f.files)).toEqual(beforeFiles);
  });
  it('索引丢失但已有素材时拒绝把它当空库，不能覆盖遗留文件关系', async () => {
    const f = await fixture(); await imported(f); const files = await fs.readdir(f.files); await fs.rename(f.index, `${f.index}.fixture-backup`);
    await expect(list(f)).rejects.toThrow('索引缺失'); await expect(imported(f)).rejects.toThrow('索引缺失');
    await expect(fs.lstat(f.index)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await fs.readdir(f.files)).toEqual(files);
  });
  it('素材被外部删除时标为不可用，预览读取和加入项目都拒绝', async () => {
    const f = await fixture(), item = await imported(f); await fs.unlink(await backingFile(f, item.id));
    expect((await list(f))[0].unavailable).toBe(true); await expect(read(f, item.id)).rejects.toThrow(); await expect(attach(f, item.id)).rejects.toThrow();
    expect(await fs.readdir(path.join(f.project.directory, 'files'))).toEqual([]);
  });
  it('相同长度的篡改也必须通过sha256检查，不能只看大小就复制', async () => {
    const f = await fixture(), item = await imported(f), filename = await backingFile(f, item.id), bytes = await fs.readFile(filename); bytes[0] ^= 1; await fs.writeFile(filename, bytes);
    await expect(read(f, item.id)).rejects.toThrow('内容已改变'); await expect(attach(f, item.id)).rejects.toThrow('内容已改变');
    expect(await fs.readdir(path.join(f.project.directory, 'files'))).toEqual([]);
  });
  it('真实素材目录junction替换被拒绝，不读取或修改外部内容', async () => {
    const f = await fixture(), item = await imported(f), originalFile = await backingFile(f, item.id), outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
    const external = path.join(outside, path.basename(originalFile)); await fs.writeFile(external, '外部文件不能读写');
    await fs.rename(f.files, `${f.files}-original`); await fs.symlink(outside, f.files, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(read(f, item.id)).rejects.toThrow(/junction|链接/); await expect(attach(f, item.id)).rejects.toThrow(/junction|链接/);
    expect((await list(f))[0].unavailable).toBe(true); expect(await fs.readFile(external, 'utf8')).toBe('外部文件不能读写');
  });
  it('索引链接元数据被拒绝，不覆盖它或开始复制新文件', async () => {
    let linked = false;
    const fileSystem = { ...fs, lstat: async filename => { const stat = await fs.lstat(filename); if (linked && path.basename(filename) === 'library-v1.json') stat.isSymbolicLink = () => true; return stat; } };
    const f = await fixture(fileSystem); await imported(f); const before = await fs.readFile(f.index), files = await fs.readdir(f.files); linked = true;
    await expect(list(f)).rejects.toThrow('索引无法读取'); await expect(imported(f)).rejects.toThrow('索引无法读取');
    expect(await fs.readFile(f.index)).toEqual(before); expect(await fs.readdir(f.files)).toEqual(files);
  });
  it('已有库的索引提交失败只清本次新文件，旧素材和源文件逐字节保留', async () => {
    let deny = false;
    const fileSystem = { ...fs, rename: async (from, to) => { if (deny && path.basename(to) === 'library-v1.json') throw new Error('index commit denied'); return fs.rename(from, to); } };
    const f = await fixture(fileSystem), item = await imported(f), before = await fs.readFile(f.index), filename = await backingFile(f, item.id), bytes = await fs.readFile(filename), files = await fs.readdir(f.files); deny = true;
    await expect(imported(f)).rejects.toThrow('index commit denied');
    expect(await fs.readFile(f.index)).toEqual(before); expect(await fs.readFile(filename)).toEqual(bytes); expect(await fs.readdir(f.files)).toEqual(files); expect(await fs.readFile(f.source)).toEqual(bytes);
  });
  it('首次导入的索引提交失败也清理本次文件，仍可重新导入', async () => {
    let deny = true;
    const fileSystem = { ...fs, rename: async (from, to) => { if (deny && path.basename(to) === 'library-v1.json') throw new Error('first index denied'); return fs.rename(from, to); } };
    const f = await fixture(fileSystem); await expect(imported(f)).rejects.toThrow('first index denied'); expect(await fs.readdir(f.files)).toEqual([]); expect(await list(f)).toEqual([]);
    deny = false; expect((await imported(f)).name).toBe('测试资料.txt');
  });
  it('独占创建后只写了部分bytes便失败也清理本次文件，不触碰源', async () => {
    let deny = true;
    const fileSystem = { ...fs, open: async (filename, ...args) => {
      const handle = await fs.open(filename, ...args);
      if (!deny || path.dirname(filename).split(path.sep).at(-1) !== 'files') return handle;
      return { stat: () => handle.stat(), close: () => handle.close(), writeFile: async bytes => { await handle.writeFile(bytes.subarray(0, 3)); throw new Error('partial copy denied'); } };
    } };
    const f = await fixture(fileSystem), source = await fs.readFile(f.source);
    await expect(imported(f)).rejects.toThrow('partial copy denied'); expect(await fs.readdir(f.files)).toEqual([]); expect(await fs.readFile(f.source)).toEqual(source);
    deny = false; expect((await imported(f)).bytes).toBe(source.length);
  });
  it('索引实际rename成功后才报错也不删除已经被新索引引用的文件', async () => {
    let deny = false;
    const fileSystem = { ...fs, rename: async (from, to) => { await fs.rename(from, to); if (deny && path.basename(to) === 'library-v1.json') { deny = false; throw new Error('lost commit acknowledgement'); } } };
    const f = await fixture(fileSystem); await imported(f); deny = true;
    await expect(imported(f)).rejects.toThrow('lost commit acknowledgement'); const items = await list(f); expect(items).toHaveLength(2);
    for (const item of items) expect((await read(f, item.id)).buffer.toString()).toBe('完整素材正文-END');
  });
  it('对renderer只返回白名单元数据，不返回文件路径、摘要或注入的Key字段', async () => {
    const f = await fixture(), item = await imported(f), value = JSON.parse(await fs.readFile(f.index, 'utf8'));
    Object.assign(value.assets[0], { apiKey: 'SYNTHETIC_SECRET_SHOULD_NOT_LEAK', authorization: 'fixture-only' }); await fs.writeFile(f.index, JSON.stringify(value));
    for (const result of [(await list(f))[0], await f.library.update({ workspaceId: 'workspace-one', id: item.id, favorite: true }), await read(f, item.id)]) {
      expect(result).not.toHaveProperty('apiKey'); expect(result).not.toHaveProperty('authorization'); expect(result).not.toHaveProperty('fileName'); expect(result).not.toHaveProperty('sha256'); expect(result).not.toHaveProperty('path');
    }
  });
  it('真正DOCX导出可导入素材并复制到同工作区另一项目，内容不是文件名占位', async () => {
    const f = await fixture(), exported = await f.store.exportOffice({ kind: 'word', title: '真实Office素材', projectId: 'project-one', text: JSON.stringify({ sections: [{ heading: '交付范围', paragraphs: ['完整真实DOCX素材正文-END'] }] }) });
    const docx = exported.find(item => item.name.endsWith('.docx'));
    const [asset] = await f.library.importPaths({ workspaceId: 'workspace-one', paths: [docx.path] });
    await f.storage.ensureProject({ projectId: 'project-three', workspaceId: 'workspace-one', name: '项目三' });
    const copy = await attach(f, asset.id, 'project-three'), file = await f.store.read(copy.id), zip = await JSZip.loadAsync(file.buffer);
    expect(await zip.file('word/document.xml').async('string')).toContain('完整真实DOCX素材正文-END'); expect(file.buffer).toEqual((await read(f, asset.id)).buffer);
  });
  it('flush等待已进入队列的素材索引提交，返回后重开可见', async () => {
    let release, entered; const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const fileSystem = { ...fs, rename: async (from, to) => { if (path.basename(to) === 'library-v1.json') { entered(); await waiting; } return fs.rename(from, to); } };
    const f = await fixture(fileSystem), adding = imported(f); await started; let drained = false; const flushing = f.library.flush().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(drained).toBe(false); release(); await adding; await flushing;
    expect((await createAssetLibrary(f.options).list({ workspaceId: 'workspace-one' })).length).toBe(1);
  });
});
