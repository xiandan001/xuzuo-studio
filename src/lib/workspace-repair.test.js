import { it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createEditorStore } = require('../../electron/editor-store.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const staged = path.join(root, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(staged) ? staged : path.join(root, 'package.json'));
const JSZip = dependencies('jszip');
async function fixture(fileSystem = fs, count = 2) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-workspace-repair-'));
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'control'), fileSystem });
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, target) => store.migrateProject(id, target));
  await storage.bindRoot({ workspaceId: 'workspace-one', name: '隔离工作区', directory: workspace });
  const projects = [];
  for (let index = 0; index < count; index++) projects.push(await storage.ensureProject({ projectId: `project-${index}`, workspaceId: 'workspace-one', name: `项目${index}` }));
  return { directory, workspace, storage, store, projects, marker: path.join(workspace, '.xuzuo-workspace-v1.json') };
}
const repair = f => f.storage.repair({ workspaceId: 'workspace-one' });
it('只在显式恢复时核验全部已登记项目重建缺失根标记，原文件和费用保持不变', async () => {
  const f = await fixture(), projectId = f.projects[0].projectId;
  const raw = await f.store.write({ projectId, name: 'result.txt', mimeType: 'text/plain', text: '需要保留的完整文稿' });
  const editor = createEditorStore({ workspaceStorage: f.storage, artifactStore: f.store });
  const document = { schemaVersion: 1, kind: 'word', title: '原编辑文稿', blocks: [{ id: 'body-one', type: 'paragraph', text: '完整保留的原始内容', fontSize: 14, align: 'left', bold: false, italic: false }] };
  await editor.save({ projectId, expectedRevision: 0, document, sourceArtifactIds: [raw.id] });
  const editorFile = path.join(f.projects[0].directory, '.xuzuo', 'editor-v1.json'), before = await fs.readFile(editorFile);
  const registry = path.join(f.directory, 'control', 'workspace-directories-v1.json'), beforeRegistry = await fs.readFile(registry);
  const fees = path.join(f.directory, 'cost-fixture.json'); await fs.writeFile(fees, '{"cost":17}\n');
  await fs.unlink(f.marker);
  await assert.rejects(editor.load({ projectId, kind: 'word' }), /工作区连接标记丢失/);
  await assert.rejects(f.storage.assertProject(projectId), /检查并恢复工作区/);
  await assert.rejects(fs.lstat(f.marker), { code: 'ENOENT' });
  assert.equal((await repair(f)).repaired, true);
  assert.deepEqual(await fs.readFile(registry), beforeRegistry);
  assert.equal((await editor.load({ projectId, kind: 'word' })).document.blocks[0].text, '完整保留的原始内容');
  assert.deepEqual(await fs.readFile(editorFile), before);
  assert.equal((await f.store.read(raw.id)).buffer.toString(), '需要保留的完整文稿');
  for (const [kind, extension, inner, text] of [['word', 'docx', 'word/document.xml', '恢复后的完整正文'], ['ppt', 'pptx', 'ppt/slides/slide1.xml', '恢复后的演示正文'], ['excel', 'xlsx', 'xl/worksheets/sheet1.xml', '{"sheets":[{"name":"明细","rows":[["名称","金额"],["测试",20]]}]}']]) {
    const exported = await f.store.exportOffice({ kind, title: `恢复后${kind}`, text, projectId });
    const office = exported.find(item => item.name.endsWith(`.${extension}`)); assert.ok(office);
    const zip = await JSZip.loadAsync((await f.store.read(office.id)).buffer); assert.ok(zip.file(inner));
  }
  assert.equal(await fs.readFile(fees, 'utf8'), '{"cost":17}\n');
  assert.equal((await repair(f)).repaired, false);
});
it('根目录丢失时拒绝恢复，不创建空工作区', async () => {
  const f = await fixture(); await fs.rename(f.workspace, `${f.workspace}-offline`);
  await assert.rejects(repair(f), /本地工作区目录已不可用/);
  await assert.rejects(fs.lstat(f.workspace), { code: 'ENOENT' });
});
it('根标记完好也核验项目，项目已删除时不会错误提示连接恢复', async () => {
  const f = await fixture();
  const original = await fs.readFile(f.marker);
  await fs.rename(f.projects[0].directory, `${f.projects[0].directory}-offline`);
  await assert.rejects(repair(f), /项目目录或项目身份标记/);
  assert.deepEqual(await fs.readFile(f.marker), original);
  await assert.rejects(fs.lstat(f.projects[0].directory), { code: 'ENOENT' });
});
it('缺失根标记但任何登记项目缺失、标记不匹配或损坏时拒绝恢复', async () => {
  for (const type of ['directory', 'missing', 'different', 'corrupt']) {
    const f = await fixture(); await fs.unlink(f.marker);
    const project = f.projects[1], marker = path.join(project.directory, '.xuzuo', 'project-v1.json');
    if (type === 'directory') await fs.rename(project.directory, `${project.directory}-offline`);
    else if (type === 'missing') await fs.unlink(marker);
    else await fs.writeFile(marker, type === 'different' ? '{"version":1,"projectId":"other"}' : '{broken');
    await assert.rejects(repair(f), /项目目录或项目身份标记/);
    await assert.rejects(fs.lstat(f.marker), { code: 'ENOENT' });
    if (type === 'directory') await assert.rejects(fs.lstat(project.directory), { code: 'ENOENT' });
  }
});
it('已有冲突或损坏的根标记永不覆盖，包括null和非文件标记', async () => {
  for (const text of ['{"version":1,"workspaceId":"other"}', '{broken', 'null']) {
    const f = await fixture(); await fs.writeFile(f.marker, text);
    await assert.rejects(repair(f), /身份不匹配|连接标记无法读取/);
    assert.equal(await fs.readFile(f.marker, 'utf8'), text);
  }
  const f = await fixture(); await fs.unlink(f.marker); await fs.mkdir(f.marker);
  await assert.rejects(repair(f), /连接标记无法读取/); assert.equal((await fs.lstat(f.marker)).isDirectory(), true);
});
it('没有项目身份佐证时不自动补根标记，未登记工作区无恢复权限', async () => {
  const f = await fixture(fs, 0); await fs.unlink(f.marker);
  await assert.rejects(repair(f), /没有可核验/); await assert.rejects(fs.lstat(f.marker), { code: 'ENOENT' });
  await assert.rejects(f.storage.repair({ workspaceId: 'other' }), /尚未绑定/);
});
it('项目路径替换成junction时拒绝恢复，不操作链接目标', async () => {
  const f = await fixture(); await fs.unlink(f.marker);
  const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), '保留');
  await fs.rename(f.projects[1].directory, `${f.projects[1].directory}-original`);
  await fs.symlink(outside, f.projects[1].directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(repair(f), /项目目录或项目身份标记/);
  await assert.rejects(fs.lstat(f.marker), { code: 'ENOENT' }); assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), '保留');
});
it('根标记的符号链接元数据被拒绝，不读取或覆盖链接目标', async () => {
  let link = false, markerReads = 0;
  const fileSystem = { ...fs,
    lstat: async filename => { const stat = await fs.lstat(filename); if (link && path.basename(filename) === '.xuzuo-workspace-v1.json') stat.isSymbolicLink = () => true; return stat; },
    readFile: async (filename, ...args) => { if (link && path.basename(filename) === '.xuzuo-workspace-v1.json') markerReads++; return fs.readFile(filename, ...args); },
  };
  const f = await fixture(fileSystem), original = await fs.readFile(f.marker); link = true;
  await assert.rejects(repair(f), /连接标记无法读取/);
  assert.equal(markerReads, 0); assert.deepEqual(await fs.readFile(f.marker), original);
});
it('wx竞争只接受同一身份的普通文件，竞争中的冲突标记不覆盖', async () => {
  for (const same of [true, false]) {
    let race = false;
    const fileSystem = { ...fs, writeFile: async (filename, data, options) => {
      if (race && path.basename(filename) === '.xuzuo-workspace-v1.json') {
        race = false; await fs.writeFile(filename, JSON.stringify({ version: 1, workspaceId: same ? 'workspace-one' : 'other' }), { flag: 'wx' });
      }
      return fs.writeFile(filename, data, options);
    } };
    const f = await fixture(fileSystem); await fs.unlink(f.marker); race = true;
    if (same) assert.equal((await repair(f)).repaired, false);
    else await assert.rejects(repair(f), /身份不匹配/);
    assert.equal(JSON.parse(await fs.readFile(f.marker, 'utf8')).workspaceId, same ? 'workspace-one' : 'other');
  }
});
it('恢复写入失败保留原状态，下次显式点击能够重试', async () => {
  let deny = false;
  const fileSystem = { ...fs, writeFile: async (filename, ...args) => {
    if (deny && path.basename(filename) === '.xuzuo-workspace-v1.json') throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return fs.writeFile(filename, ...args);
  } };
  const f = await fixture(fileSystem); await fs.unlink(f.marker); deny = true;
  await assert.rejects(repair(f), /未能保存/); await assert.rejects(fs.lstat(f.marker), { code: 'ENOENT' });
  deny = false; assert.equal((await repair(f)).repaired, true);
});
