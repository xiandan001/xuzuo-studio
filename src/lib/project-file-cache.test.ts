import { describe, expect, it, vi } from 'vitest';
import { createProjectFileCache } from './project-file-cache';
import type { ArtifactMetadata } from '../live-types';
const file = { id: 'a', projectId: 'project', name: 'one.png' } as ArtifactMetadata;
describe('同项目文件清单共用原生读取', () => {
  it('三个工作台消费者合并读取，手动刷新与到期重新核验', async () => {
    let time = 0; const cache = createProjectFileCache(() => time), load = vi.fn(async () => [file]);
    const values = await Promise.all([cache.read('p', load), cache.read('p', load), cache.read('p', load)]);
    expect(load).toHaveBeenCalledTimes(1); expect(values[0]).toBe(values[2]);
    await cache.read('p', load); expect(load).toHaveBeenCalledTimes(1);
    await cache.read('p', load, true); expect(load).toHaveBeenCalledTimes(2);
    time = 1600; await cache.read('p', load); expect(load).toHaveBeenCalledTimes(3);
  });
  it('写入期间的旧结果不能覆盖失效后的新清单，费用从不参与缓存', async () => {
    const cache = createProjectFileCache(); let finish!: (files: ArtifactMetadata[]) => void;
    const old = cache.read('p', () => new Promise(resolve => { finish = resolve; })); await Promise.resolve();
    cache.invalidate('p'); const fresh = [{ ...file, id: 'b' }]; await expect(cache.read('p', async () => fresh)).resolves.toBe(fresh);
    finish([file]); await old; const unnecessary = vi.fn(async () => []); expect(await cache.read('p', unnecessary)).toBe(fresh); expect(unnecessary).not.toHaveBeenCalled();
  });
  it('失败可重试且项目之间不共用内容', async () => {
    const cache = createProjectFileCache(), bad = vi.fn(async () => { throw Error('目录离线'); });
    await expect(cache.read('p', bad)).rejects.toThrow('目录离线'); await expect(cache.read('p', async () => [file])).resolves.toEqual([file]);
    const other = vi.fn(async () => []); await cache.read('other', other); expect(other).toHaveBeenCalledTimes(1);
  });
});
