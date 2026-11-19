import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createRepository, createSnapshotWriter, openSnapshot, validateSnapshot } = require('../../electron/incremental-backup-store.cjs');
const { digest, PART_BYTES, READ_BYTES, fileIdentity } = require('../../electron/incremental-backup-paths.cjs');
const { validateManifest } = require('../../electron/backup-format.cjs');
const roots = [], ownerId = 'test-backup-owner', workspaceId = 'test-workspace';
afterEach(async () => {
  for (const directory of roots.splice(0)) {
    const real = await fs.realpath(directory), temporary = await fs.realpath(os.tmpdir());
    const allowedParents = [temporary, ...(process.platform === 'darwin' ? ['/private/tmp'] : [])];
    if (!allowedParents.some(parent => path.dirname(real).toLowerCase() === parent.toLowerCase()) || !path.basename(real).startsWith('xuzuo-incremental-store-')) throw Error('Unowned incremental fixture');
    await fs.rm(real, { recursive: true, force: true });
  }
});
async function fixture(parent = os.tmpdir()) {
  const directory = await fs.mkdtemp(path.join(parent, 'xuzuo-incremental-store-')); roots.push(directory);
  const repository = await createRepository({ directory, ownerId, workspaceId }); return { directory, repository: repository.directory };
}
function manifest(id, files) {
  return { kind: 'xuzuo-internal-backup', version: 1, backupId: id, createdAt: '2026-11-17T00:00:00.000Z', scope: 'workspaces', secretsIncluded: false,
    locations: { workspaces: [{ workspaceId, directory: path.resolve('synthetic-source') }], projects: [] },
    meta: { workspaces: [{ id: workspaceId, name: '真实文件测试' }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: {}, configuration: { connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] } }, artifacts: [], records: [], files };
}
async function snapshot(f, bytes, options = {}) {
  const writer = await createSnapshotWriter({ repository: f.repository, ownerId, ...options }), file = await writer.addBuffer(bytes, `workspaces/${workspaceId}/file.bin`);
  const result = await writer.commit(manifest(writer.id, [file])); return { result, file };
}
async function index(f) { return JSON.parse(await fs.readFile(path.join(f.repository, 'index.json'), 'utf8')); }

describe('流式不可变分卷与真实内容校验', () => {
  it('平台允许的父目录别名仍核对真实叶子和字节，拒绝叶子转向、超限和目录链接', async () => {
    const f = await fixture(process.platform === 'darwin' ? '/tmp' : os.tmpdir());
    const canonical = path.join(await fs.realpath(f.directory), 'canonical-long-parent');
    const alias = process.platform === 'win32' ? path.join(f.directory, 'CANONI~1') : path.join(f.directory, 'canonical-long-parent');
    await fs.mkdir(canonical); const data = Buffer.from('Actual ordinary file under a canonical parent'), filename = path.join(canonical, 'source.bin'); await fs.writeFile(filename, data);
    const translated = value => process.platform === 'win32' && (value === alias || value.startsWith(alias + path.sep)) ? canonical + value.slice(alias.length) : value;
    let opens = 0;
    const aliasFs = { ...fs, lstat: value => fs.lstat(translated(value)), realpath: value => fs.realpath(translated(value)), open: (...args) => { opens++; return fs.open(translated(args[0]), ...args.slice(1)); } };
    expect(await fileIdentity(aliasFs, path.join(alias, 'source.bin'))).toEqual({ bytes: data.length, sha256: digest(data) });
    if (process.platform !== 'win32') {
      const changedCase = { ...aliasFs, realpath: async value => value === path.join(alias, 'source.bin') ? path.join(canonical, 'SOURCE.bin') : aliasFs.realpath(value) };
      const openedBefore = opens;
      await expect(fileIdentity(changedCase, path.join(alias, 'source.bin'))).rejects.toThrow(/路径已变化/);
      expect(opens).toBe(openedBefore);
    }
    const before = opens, other = path.join(f.directory, 'other.bin'); await fs.writeFile(other, data);
    const redirected = { ...aliasFs, realpath: value => value === path.join(alias, 'source.bin') ? fs.realpath(other) : aliasFs.realpath(value) };
    await expect(fileIdentity(redirected, path.join(alias, 'source.bin'))).rejects.toThrow(/路径已变化/); expect(opens).toBe(before);
    await expect(fileIdentity(aliasFs, path.join(alias, 'source.bin'), { maximum: data.length - 1 })).rejects.toThrow(/大小限制/); expect(opens).toBe(before);
    const junction = path.join(f.directory, 'redirected-parent'); await fs.symlink(canonical, junction, 'junction');
    await expect(fileIdentity(fs, path.join(junction, 'source.bin'))).rejects.toThrow(/junction|符号链接/);
    expect((await fs.readFile(filename)).equals(data)).toBe(true);
  });
  it('真实文件分块保存与恢复，读缓冲有界且不会把描述符冒充Buffer', async () => {
    const f = await fixture(), data = Buffer.alloc(PART_BYTES + 137, 49); data.writeUInt32LE(7182);
    const created = await snapshot(f, data), opened = await openSnapshot(created.result.snapshotPath), source = opened.files.get(created.file.path);
    expect(created.result.volumes).toBe(2); expect(opened.verification).toEqual({ verifiedBytes: data.length, peakReadBytes: READ_BYTES });
    expect(Buffer.isBuffer(source)).toBe(false); expect(source.kind).toBe('xuzuo-stream-file');
    const output = path.join(f.directory, 'restored.bin'); await source.copyTo(output);
    expect(await fileIdentity(fs, output)).toEqual({ bytes: data.length, sha256: digest(data) });
    expect((await fs.readFile(output)).equals(data)).toBe(true);
    await expect(source.copyTo(output)).rejects.toMatchObject({ code: 'EEXIST' });
  }, 20000);
  it('相同内容复用真实分卷，新增快照不覆盖早前快照', async () => {
    const f = await fixture(), data = Buffer.from('保留原稿与消费费用');
    const first = await snapshot(f, data), before = await fs.readFile(first.result.snapshotPath);
    const second = await snapshot(f, data);
    expect(second.result.newBytes).toBe(0); expect(second.result.reusedBytes).toBe(data.length);
    expect((await index(f)).snapshots.map(item => item.id)).toEqual([first.result.backupId, second.result.backupId]);
    expect((await fs.readFile(first.result.snapshotPath)).equals(before)).toBe(true);
    expect((await openSnapshot(first.result.snapshotPath)).manifest.files[0].sha256).toBe(digest(data));
  });
  it('后续写入取消后保留原文件、已成功快照和明确的不完整证据', async () => {
    const f = await fixture(), first = await snapshot(f, Buffer.from('previous good')), before = await fs.readFile(path.join(f.repository, 'index.json'));
    const original = path.join(f.directory, 'source.bin'); await fs.writeFile(original, Buffer.alloc(1024 * 1024, 88)); const originalHash = await fileIdentity(fs, original);
    const controller = new AbortController(); let yields = 0;
    const writer = await createSnapshotWriter({ repository: f.repository, ownerId, signal: controller.signal, yieldBackground: async () => { if (++yields === 3) controller.abort(); } });
    let failure; try { await writer.addFile(original, `workspaces/${workspaceId}/new.bin`); } catch (error) { failure = error; await writer.fail(error); }
    expect(failure?.name).toBe('AbortError'); expect(await fileIdentity(fs, original)).toEqual(originalHash);
    expect((await fs.readFile(path.join(f.repository, 'index.json'))).equals(before)).toBe(true); expect((await openSnapshot(first.result.snapshotPath)).manifest.backupId).toBe(first.result.backupId);
    const journal = JSON.parse(await fs.readFile(path.join(f.repository, '.incomplete', writer.id, 'state.json'), 'utf8')); expect(journal.phase).toBe('cancelled');
  });
  it('实际分卷被改、缺失或预览后被改都会拒绝读取，不用元数据代替字节核验', async () => {
    const f = await fixture(), created = await snapshot(f, Buffer.from('actual immutable content')), opened = await openSnapshot(created.result.snapshotPath);
    const value = JSON.parse(await fs.readFile(created.result.snapshotPath, 'utf8')), part = value.files[0].parts[0], filename = path.join(f.repository, 'blobs', part.sha256.slice(0, 2), part.sha256 + '.bin');
    await fs.writeFile(filename, Buffer.alloc(part.bytes, 66));
    await expect(openSnapshot(created.result.snapshotPath)).rejects.toThrow(/哈希|分卷/);
    await expect(opened.files.get(created.file.path).copyTo(path.join(f.directory, 'late.bin'))).rejects.toThrow(/哈希|分卷/);
    await fs.unlink(filename); await expect(openSnapshot(created.result.snapshotPath)).rejects.toThrow();
  });
  it('快照内容与提交索引不一致时不把快照当成成功结果', async () => {
    const f = await fixture(), created = await snapshot(f, Buffer.from('owned'));
    const value = JSON.parse(await fs.readFile(created.result.snapshotPath, 'utf8')); value.manifest.meta.workspaces[0].name = '改变后的内容';
    await fs.writeFile(created.result.snapshotPath, JSON.stringify(value) + '\n');
    await expect(openSnapshot(created.result.snapshotPath)).rejects.toThrow('快照索引哈希不一致');
  });
  it('不接管已存在的用户目录，不通过路径穿越或错误工作区读取其他文件', async () => {
    const f = await fixture(), created = await snapshot(f, Buffer.from('good')), value = JSON.parse(await fs.readFile(created.result.snapshotPath, 'utf8'));
    value.manifest.files[0].path = '../foreign'; value.files[0].path = '../foreign';
    expect(() => validateSnapshot(value, { ownerId, workspaceId })).toThrow('不安全');
    value.manifest.files[0].path = created.file.path; value.files[0].path = created.file.path;
    expect(() => validateSnapshot(value, { ownerId, workspaceId: 'different-workspace' })).toThrow('工作区');
    const marker = path.join(f.repository, '.xuzuo-incremental-backup.json'); await fs.unlink(marker); await fs.writeFile(path.join(f.repository, 'user-file.txt'), 'keep');
    await expect(createRepository({ directory: f.directory, ownerId, workspaceId })).rejects.toThrow(); expect(await fs.readFile(path.join(f.repository, 'user-file.txt'), 'utf8')).toBe('keep');
  });
  it('新格式允许多于旧ZIP的有界文件清单，旧ZIP总量限制仍然保留', () => {
    const files = Array.from({ length: 11000 }, (_, index) => ({ path: `workspaces/${workspaceId}/f-${index}`, bytes: 0, sha256: digest(Buffer.alloc(0)) }));
    const data = manifest('large-manifest', files), value = { kind: 'xuzuo-incremental-snapshot', version: 1, ownerId, snapshotId: data.backupId, manifest: data, files: files.map(file => ({ path: file.path, parts: [] })) };
    expect(validateSnapshot(value, { ownerId, workspaceId })).toBe(0); expect(() => validateManifest(data)).toThrow();
  });
});
