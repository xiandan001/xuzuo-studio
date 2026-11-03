import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createEditorStore } = require('../../electron/editor-store.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const healthyManifest = path.join(root, 'work', 'ui-build', 'package.json');
const dependencies = createRequire(existsSync(healthyManifest) ? healthyManifest : path.join(root, 'package.json'));
const JSZip = dependencies('jszip');
const fixtures = [];

function strictlyInside(parent, filename) {
  const relative = path.relative(path.resolve(parent), path.resolve(filename));
  assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), `${filename} must stay inside ${parent}`);
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    strictlyInside(os.tmpdir(), fixture.directory);
    assert.ok(path.basename(fixture.directory).startsWith('xuzuo-project-inventory-'));
    for (const link of fixture.links) {
      strictlyInside(fixture.directory, link);
      await fs.unlink(link);
    }
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

function word(text) {
  return {
    schemaVersion: 1, kind: 'word', title: '真实本机交付清单',
    blocks: [{ id: 'paragraph-one', type: 'paragraph', text, fontSize: 12, align: 'left', bold: false, italic: false }],
  };
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-project-inventory-'));
  const f = { directory, links: [], reads: [], failEditorCommit: false, failedCommits: 0 };
  fixtures.push(f);
  f.control = path.join(directory, 'control');
  f.artifactDirectory = path.join(directory, 'artifact-registry');
  f.workspaceDirectory = path.join(directory, 'workspace');
  await fs.mkdir(f.workspaceDirectory);
  f.fileSystem = {
    ...fs,
    async readFile(filename, ...args) {
      const read = { filename: path.resolve(filename), succeeded: false };
      f.reads.push(read);
      try {
        const value = await fs.readFile(filename, ...args);
        read.succeeded = true;
        return value;
      } catch (error) {
        read.code = error.code;
        throw error;
      }
    },
    async rename(from, to) {
      if (f.failEditorCommit && path.basename(to) === 'editor-v1.json') {
        f.failedCommits += 1;
        throw new Error('injected editor source commit failure');
      }
      return fs.rename(from, to);
    },
  };
  f.storage = createWorkspaceStorage({ directory: f.control, fileSystem: f.fileSystem });
  f.storeOptions = { directory: f.artifactDirectory, workspaceStorage: f.storage, fileSystem: f.fileSystem, loadModule: dependencies };
  f.artifacts = createArtifactStore(f.storeOptions);
  f.storage.setArtifactMigrator((projectId, target) => f.artifacts.migrateProject(projectId, target));
  await f.storage.bindRoot({ workspaceId: 'workspace-one', name: '测试工作区', directory: f.workspaceDirectory });
  f.projects = [];
  for (const projectId of ['project-one', 'project-two']) {
    f.projects.push(await f.storage.ensureProject({ projectId, workspaceId: 'workspace-one', name: projectId }));
  }
  f.editor = createEditorStore({ workspaceStorage: f.storage, artifactStore: f.artifacts, fileSystem: f.fileSystem });
  return f;
}

function assertMetadataReadsOnly(f, artifacts) {
  const allowed = new Set([
    path.join(f.artifactDirectory, 'manifest-v1.json'),
    path.join(f.control, 'workspace-directories-v1.json'),
    path.join(f.workspaceDirectory, '.xuzuo-workspace-v1.json'),
    ...f.projects.map(project => path.join(project.directory, '.xuzuo', 'project-v1.json')),
  ]);
  assert.ok(f.reads.some(read => read.succeeded && read.filename === path.join(f.artifactDirectory, 'manifest-v1.json')));
  for (const read of f.reads) {
    assert.ok(!artifacts.some(artifact => artifact.path === read.filename), `inventory must not read artifact bytes: ${read.filename}`);
    if (read.succeeded) assert.ok(allowed.has(read.filename), `unexpected successful inventory read: ${read.filename}`);
    else {
      // Recovery checks may probe an absent control journal; no payload bytes are read.
      assert.equal(read.filename, path.join(f.artifactDirectory, 'artifact-move-v1.json'));
      assert.equal(read.code, 'ENOENT');
    }
  }
}

describe('原生项目产物清单', () => {
  it('Office 已真实注册而编辑主源提交失败时，重开清单仍找到正文完整的 DOCX', async () => {
    const f = await fixture();
    const previous = await f.editor.save({ projectId: 'project-one', expectedRevision: 0, document: word('旧编辑源正文') });
    const sourceFile = path.join(f.projects[0].directory, '.xuzuo', 'editor-v1.json');
    const sourceBefore = await fs.readFile(sourceFile);
    f.failEditorCommit = true;
    await assert.rejects(f.editor.export({ projectId: 'project-one', expectedRevision: previous.revision, document: word('已经导出但未提交主源的中文正文 2026') }), /injected editor source commit failure/);
    assert.equal(f.failedCommits, 1);
    assert.deepEqual(await fs.readFile(sourceFile), sourceBefore);
    assert.equal((await f.editor.load({ projectId: 'project-one', kind: 'word' })).revision, previous.revision);

    const reopened = createArtifactStore(f.storeOptions);
    const inventory = await reopened.listProject('project-one');
    const docx = inventory.find(item => item.name.endsWith('.docx'));
    assert.ok(docx, 'the persisted registry must retain the real Office file after editor export rejects');
    assert.equal(docx.projectId, 'project-one');
    assert.equal(docx.kind, 'office');
    assert.equal(docx.unavailable, undefined);
    assert.equal(path.dirname(docx.path), path.join(f.projects[0].directory, 'files'));
    assert.ok(inventory.every(item => !Object.hasOwn(item, 'sourceRevision')));
    const bytes = await fs.readFile(docx.path);
    assert.equal(bytes.length, docx.bytes);
    assert.ok(bytes.length > 1000);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml').async('string');
    assert.ok(xml.includes('已经导出但未提交主源的中文正文 2026'));
    assert.ok(!xml.includes('旧编辑源正文'));
  });

  it('只返回已登记项目自己的产物，未登记编号和本机路径均被拒绝', async () => {
    const f = await fixture();
    const first = await f.artifacts.write({ projectId: 'project-one', name: '项目一.txt', mimeType: 'text/plain', text: '项目一私有内容' });
    const second = await f.artifacts.write({ projectId: 'project-two', name: '项目二.txt', mimeType: 'text/plain', text: '项目二私有内容' });
    const legacy = createArtifactStore({ directory: f.artifactDirectory, loadModule: dependencies });
    await legacy.write({ projectId: 'unregistered-project', name: '未登记.txt', mimeType: 'text/plain', text: '有产物记录也不授予项目读取权限' });
    assert.deepEqual((await f.artifacts.listProject('project-one')).map(item => item.id), [first.id]);
    assert.deepEqual((await f.artifacts.listProject('project-two')).map(item => item.id), [second.id]);
    await assert.rejects(f.artifacts.listProject('unregistered-project'), /项目未登记/);
    f.reads.length = 0;
    for (const value of [f.projects[0].directory, first.path, '../project-one', 'project-one/files', { projectId: 'project-one' }, undefined]) {
      await assert.rejects(f.artifacts.listProject(value), /项目编号/);
    }
    assert.equal(f.reads.length, 0, 'invalid project selectors must be rejected before filesystem reads');
  });

  it('缺失文件保留 unavailable 记录，回收文件保留真实回收状态和位置', async () => {
    const f = await fixture();
    const missing = await f.artifacts.write({ projectId: 'project-one', name: '已移走.txt', mimeType: 'text/plain', text: '清单必须保留这条记录' });
    const active = await f.artifacts.write({ projectId: 'project-one', name: '仍存在.txt', mimeType: 'text/plain', text: '正常文件' });
    const removed = await f.artifacts.write({ projectId: 'project-one', name: '回收文件.txt', mimeType: 'text/plain', text: '可以恢复的原始正文' });
    const trashed = await f.artifacts.trash(removed.id);
    strictlyInside(f.directory, missing.path);
    await fs.unlink(missing.path);
    const inventory = await createArtifactStore(f.storeOptions).listProject('project-one');
    assert.equal(inventory.length, 3);
    const unavailable = inventory.find(item => item.id === missing.id);
    assert.equal(unavailable.unavailable, true);
    assert.ok(unavailable.unavailableReason);
    assert.equal(inventory.find(item => item.id === active.id).unavailable, undefined);
    const recovered = inventory.find(item => item.id === removed.id);
    assert.equal(recovered.trashedAt, trashed.trashedAt);
    assert.equal(recovered.path, trashed.path);
    assert.equal(path.dirname(recovered.path), path.join(f.projects[0].directory, 'trash'));
    assert.equal(recovered.unavailable, undefined);
    await assert.rejects(f.artifacts.read(recovered.id), /回收站/);
    assert.equal(await fs.readFile(recovered.path, 'utf8'), '可以恢复的原始正文');
  });

  it('清单只读取登记和身份标记，不读取 Office、检查报告或编辑正文', async () => {
    const f = await fixture();
    const exported = await f.editor.export({ projectId: 'project-one', expectedRevision: 0, document: word('只允许清单核验元数据，不读取该文档正文') });
    assert.ok(exported.artifacts.some(item => item.name.endsWith('.docx')));
    assert.ok(exported.artifacts.some(item => item.name.endsWith('-检查报告.json')));
    f.reads.length = 0;
    const inventory = await f.artifacts.listProject('project-one');
    assert.deepEqual(new Set(inventory.map(item => item.id)), new Set(exported.artifacts.map(item => item.id)));
    assertMetadataReadsOnly(f, exported.artifacts);
  });

  it('files 被替换为真实 junction 后拒绝该位置，不读取外部目录正文', async () => {
    const f = await fixture();
    const content = '不可经由目录链接读取的外部正文';
    const artifact = await f.artifacts.write({ projectId: 'project-one', name: '交付正文.txt', mimeType: 'text/plain', text: content });
    const files = path.dirname(artifact.path);
    const retained = path.join(f.projects[0].directory, 'original-files');
    const outside = path.join(f.directory, 'outside-workspace');
    const outsideFile = path.join(outside, path.basename(artifact.path));
    await fs.mkdir(outside);
    await fs.writeFile(outsideFile, content, 'utf8');
    strictlyInside(f.directory, files);
    strictlyInside(f.directory, retained);
    await fs.rename(files, retained);
    await fs.symlink(outside, files, process.platform === 'win32' ? 'junction' : 'dir');
    f.links.push(files);
    assert.equal((await fs.lstat(files)).isSymbolicLink(), true);
    f.reads.length = 0;
    const inventory = await f.artifacts.listProject('project-one');
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].id, artifact.id);
    assert.equal(inventory[0].unavailable, true);
    assert.equal(inventory[0].path, '');
    assert.ok(inventory[0].unavailableReason);
    assertMetadataReadsOnly(f, [artifact]);
    assert.ok(f.reads.every(read => read.filename !== outsideFile && !read.filename.startsWith(`${outside}${path.sep}`)));
    assert.equal(await fs.readFile(outsideFile, 'utf8'), content);
    assert.equal(await fs.readFile(path.join(retained, path.basename(artifact.path)), 'utf8'), content);
  });
});
