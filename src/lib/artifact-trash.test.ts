import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata } from '../live-types';

interface TrashMetadata extends ArtifactMetadata { trashedAt: string; }
interface Store {
  write: (input: { name: string; mimeType: string; text: string; runId?: string; projectId?: string }) => Promise<ArtifactMetadata>;
  read: (id: string) => Promise<ArtifactMetadata & { buffer: Buffer }>;
  list: (ids: string[]) => Promise<ArtifactMetadata[]>;
  preview: (id: string) => Promise<unknown>;
  trash: (id: string) => Promise<TrashMetadata>;
  restore: (id: string) => Promise<ArtifactMetadata>;
  listTrash: () => Promise<TrashMetadata[]>;
}
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (options: { directory: string; fileSystem?: Record<string, unknown> }) => Store };

async function fixture(fileSystem?: Record<string, unknown>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-trash-tests-'));
  const store = createArtifactStore({ directory, fileSystem });
  const artifact = await store.write({ name: '交付说明.txt', mimeType: 'text/plain', text: '需要保留的实际产物', runId: 'owned-run', projectId: 'owned-project' });
  const ledgerFile = path.join(directory, 'live-workflows-v1.json'), keyFile = path.join(directory, 'credentials-v1.json');
  const ledger = JSON.stringify({ costCents: 321, attempts: [{ artifactId: artifact.id, costCents: 321 }] });
  const fakeEncrypted = 'owned-test-only-encrypted-placeholder';
  await fs.writeFile(ledgerFile, ledger, { flag: 'wx' }); await fs.writeFile(keyFile, fakeEncrypted, { flag: 'wx' });
  return { directory, store, artifact, ledgerFile, keyFile, ledger, fakeEncrypted };
}

async function exists(filename: string) { try { await fs.lstat(filename); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
const inside = (directory: string, filename: string) => path.resolve(filename).startsWith(`${path.resolve(directory)}${path.sep}`);

describe('产物可恢复回收', () => {
  it('移入本应用回收目录后所有普通读取入口拒绝，费用和凭证文件保持原样', async () => {
    const f = await fixture();
    const trashed = await f.store.trash(f.artifact.id);
    expect(trashed).toMatchObject({ id: f.artifact.id, name: f.artifact.name, projectId: 'owned-project', runId: 'owned-run', trashedAt: expect.any(String) });
    expect(inside(path.join(f.directory, 'trash'), trashed.path)).toBe(true);
    expect(await exists(f.artifact.path)).toBe(false); expect((await fs.readFile(trashed.path)).toString()).toBe('需要保留的实际产物');
    await expect(f.store.read(f.artifact.id)).rejects.toMatchObject({ code: 'ARTIFACT_TRASHED' });
    await expect(f.store.list([f.artifact.id])).rejects.toThrow('回收站');
    await expect(f.store.preview(f.artifact.id)).rejects.toThrow('回收站');
    expect(await f.store.listTrash()).toEqual([trashed]);
    expect(await fs.readFile(f.ledgerFile, 'utf8')).toBe(f.ledger); expect(await fs.readFile(f.keyFile, 'utf8')).toBe(f.fakeEncrypted);
  });

  it('重建store后能恢复，ID和内容不变，清除回收状态', async () => {
    const f = await fixture(); await f.store.trash(f.artifact.id);
    const reopened = createArtifactStore({ directory: f.directory });
    expect(await reopened.listTrash()).toHaveLength(1);
    const restored = await reopened.restore(f.artifact.id);
    expect(restored.id).toBe(f.artifact.id); expect(restored.path).toBe(f.artifact.path); expect(restored).not.toHaveProperty('trashedAt');
    expect((await reopened.read(restored.id)).buffer.toString()).toBe('需要保留的实际产物'); expect(await reopened.listTrash()).toEqual([]);
    expect((await reopened.list([restored.id]))[0].path).toBe(restored.path);
  });

  it('原位置有普通文件时选新安全文件名恢复，不覆盖占用者', async () => {
    const f = await fixture(); await f.store.trash(f.artifact.id);
    await fs.writeFile(f.artifact.path, '不能覆盖的同名文件', { flag: 'wx' });
    const restored = await f.store.restore(f.artifact.id);
    expect(restored.id).toBe(f.artifact.id); expect(restored.path).not.toBe(f.artifact.path); expect(inside(path.join(f.directory, 'files'), restored.path)).toBe(true);
    expect(await fs.readFile(f.artifact.path, 'utf8')).toBe('不能覆盖的同名文件'); expect((await f.store.read(restored.id)).buffer.toString()).toBe('需要保留的实际产物');
  });

  it('重复回收和恢复是幂等操作，不建立新ID或丢失内容', async () => {
    const f = await fixture(); const first = await f.store.trash(f.artifact.id), second = await f.store.trash(f.artifact.id);
    expect(second).toEqual(first); expect(await f.store.listTrash()).toHaveLength(1);
    const restored = await f.store.restore(f.artifact.id); expect(await f.store.restore(f.artifact.id)).toEqual(restored);
    expect(await f.store.listTrash()).toHaveLength(0);
  });

  it('物理移动失败时保持原文件及登记状态，可随后重试', async () => {
    let blocked = false;
    const fileSystem = { ...fs, rename: async (from: string, to: string) => { if (blocked && path.basename(path.dirname(from)) === 'files' && path.basename(path.dirname(to)) === 'trash') throw Object.assign(new Error('owned test busy'), { code: 'EBUSY' }); await fs.rename(from, to); } };
    const f = await fixture(fileSystem); blocked = true;
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('原有文件保持不变'); expect((await f.store.read(f.artifact.id)).buffer.toString()).toBe('需要保留的实际产物'); expect(await f.store.listTrash()).toEqual([]);
    blocked = false; expect((await f.store.trash(f.artifact.id)).id).toBe(f.artifact.id);
  });

  it('回收后manifest更新失败会移回原位置且保留旧登记', async () => {
    let fail = false;
    const fileSystem = { ...fs, rename: async (from: string, to: string) => { if (fail && path.basename(to) === 'manifest-v1.json') { fail = false; throw Object.assign(new Error('owned disk error'), { code: 'EIO' }); } await fs.rename(from, to); } };
    const f = await fixture(fileSystem); fail = true;
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('文件已回到原位置');
    expect(await exists(f.artifact.path)).toBe(true); expect(await f.store.listTrash()).toEqual([]); expect((await f.store.read(f.artifact.id)).buffer.toString()).toBe('需要保留的实际产物');
    expect(await exists(path.join(f.directory, 'artifact-move-v1.json'))).toBe(false);
  });

  it('底层rename已移动但返回错误时仍按实际位置回滚，不丢失恢复索引', async () => {
    let fail = false;
    const fileSystem = { ...fs, rename: async (from: string, to: string) => {
      await fs.rename(from, to);
      if (fail && path.basename(path.dirname(from)) === 'files' && path.basename(path.dirname(to)) === 'trash') { fail = false; throw Object.assign(new Error('owned ambiguous rename error'), { code: 'EIO' }); }
    } };
    const f = await fixture(fileSystem); fail = true;
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('文件已回到原位置');
    expect((await f.store.read(f.artifact.id)).buffer.toString()).toBe('需要保留的实际产物'); expect(await f.store.listTrash()).toEqual([]);
  });

  it('恢复后manifest更新失败会回滚到回收站，而非丢失产物', async () => {
    let fail = false;
    const fileSystem = { ...fs, rename: async (from: string, to: string) => { if (fail && path.basename(to) === 'manifest-v1.json') { fail = false; throw Object.assign(new Error('owned disk error'), { code: 'EIO' }); } await fs.rename(from, to); } };
    const f = await fixture(fileSystem); const trashed = await f.store.trash(f.artifact.id); fail = true;
    await expect(f.store.restore(f.artifact.id)).rejects.toThrow('文件已回到原位置');
    expect(await exists(trashed.path)).toBe(true); expect(await exists(f.artifact.path)).toBe(false); expect(await f.store.listTrash()).toEqual([trashed]);
    expect((await f.store.restore(f.artifact.id)).id).toBe(f.artifact.id);
  });

  it('回滚被占用时保留事务和文件，重开按实际位置恢复可见的回收记录', async () => {
    let failCommit = false, blockRollback = false;
    const fileSystem = { ...fs, rename: async (from: string, to: string) => {
      if (failCommit && path.basename(to) === 'manifest-v1.json') { failCommit = false; blockRollback = true; throw Object.assign(new Error('owned disk error'), { code: 'EIO' }); }
      if (blockRollback && path.basename(path.dirname(from)) === 'trash' && path.basename(path.dirname(to)) === 'files') throw Object.assign(new Error('owned rollback busy'), { code: 'EBUSY' });
      await fs.rename(from, to);
    } };
    const f = await fixture(fileSystem); failCommit = true;
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('文件仍被保留'); expect(await exists(path.join(f.directory, 'artifact-move-v1.json'))).toBe(true);
    const reopened = createArtifactStore({ directory: f.directory }); const recovered = await reopened.listTrash();
    expect(recovered).toHaveLength(1); expect(recovered[0].id).toBe(f.artifact.id); expect(await exists(path.join(f.directory, 'artifact-move-v1.json'))).toBe(false);
    const restored = await reopened.restore(f.artifact.id); expect((await reopened.read(restored.id)).buffer.toString()).toBe('需要保留的实际产物');
  });

  it('事务准备写入失败前不会移动产物', async () => {
    let blocked = false;
    const fileSystem = { ...fs, writeFile: async (filename: string, value: string | Buffer, options: Parameters<typeof fs.writeFile>[2]) => { if (blocked && path.basename(filename).startsWith('artifact-move-v1.json.')) throw new Error('owned journal failure'); await fs.writeFile(filename, value, options); } };
    const f = await fixture(fileSystem); blocked = true;
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('原文件保持不变'); expect((await f.store.read(f.artifact.id)).buffer.toString()).toBe('需要保留的实际产物'); expect(await f.store.listTrash()).toEqual([]);
  });

  it('拒绝原始路径和越界manifest记录，不对目录外文件执行移动', async () => {
    const f = await fixture(); await expect(f.store.trash('../credentials-v1.json')).rejects.toThrow('产物编号');
    const manifestFile = path.join(f.directory, 'manifest-v1.json'); const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.artifacts[0].fileName = '../outside.txt'; await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('登记表'); expect(await exists(f.artifact.path)).toBe(true); expect(await fs.readFile(f.keyFile, 'utf8')).toBe(f.fakeEncrypted);
  });

  it('不跟随单文件符号链接，外部目标和保留副本均不变', async context => {
    const f = await fixture(); const holding = path.join(f.directory, 'owned-preserved-original.txt');
    const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-trash-outside-')), outside = path.join(outsideDirectory, 'outside.txt');
    await fs.writeFile(outside, '不可触碰的外部内容', { flag: 'wx' });
    if (!inside(f.directory, f.artifact.path) || !inside(f.directory, holding)) throw new Error('invalid fixture target');
    await fs.rename(f.artifact.path, holding);
    try { await fs.symlink(outside, f.artifact.path, 'file'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) { context.skip(); return; } throw error; }
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('符号链接'); await expect(f.store.read(f.artifact.id)).rejects.toThrow('符号链接'); await expect(f.store.list([f.artifact.id])).rejects.toThrow('符号链接');
    expect(await fs.readFile(outside, 'utf8')).toBe('不可触碰的外部内容'); expect(await fs.readFile(holding, 'utf8')).toBe('需要保留的实际产物');
  });

  it('文件符号链接判定在没有创建链接权限时仍由注入lstat验证', async () => {
    let linkedPath = '';
    const fileSystem = { ...fs, lstat: async (filename: string) => {
      const stat = await fs.lstat(filename);
      return filename === linkedPath ? { ...stat, isSymbolicLink: () => true, isFile: () => true, isDirectory: () => false } : stat;
    } };
    const f = await fixture(fileSystem); linkedPath = f.artifact.path;
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('符号链接'); await expect(f.store.read(f.artifact.id)).rejects.toThrow('符号链接');
    expect(await fs.readFile(f.artifact.path, 'utf8')).toBe('需要保留的实际产物'); expect(await fs.readFile(f.keyFile, 'utf8')).toBe(f.fakeEncrypted);
  });

  it('不跟随trash目录junction，正常产物保持原位置', async context => {
    const f = await fixture(), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-trash-junction-'));
    try { await fs.symlink(outside, path.join(f.directory, 'trash'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) { context.skip(); return; } throw error; }
    await expect(f.store.trash(f.artifact.id)).rejects.toThrow('符号链接'); expect(await fs.readdir(outside)).toEqual([]); expect((await f.store.read(f.artifact.id)).buffer.toString()).toBe('需要保留的实际产物');
  });
});
