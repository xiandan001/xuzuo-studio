import { describe, expect, it, vi } from 'vitest';
import { createArtifactPreviewCache } from './artifact-preview-cache';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';

const metadata: ArtifactMetadata = { id: 'file', name: '内容', mimeType: 'text/plain', bytes: 4, path: 'C:/isolated/file', kind: 'text', createdAt: '2026-11-01', projectId: 'project' };
describe('预览仅合并正在执行的读取', () => {
  it('工作区恢复后旧 unavailable 元信息不能阻止新的原生文件校验', async () => {
    const cache = createArtifactPreviewCache(), read = vi.fn(async () => ({ mimeType: 'text/plain', text: '恢复后的真实文件' }));
    await expect(cache.preview('workspace', 'file', read, { ...metadata, unavailable: true })).resolves.toMatchObject({ text: '恢复后的真实文件' });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('同工作区/编号/元信息并发请求只发一次 IPC，完成后再次读取并校验文件', async () => {
    const cache = createArtifactPreviewCache(); let resolve!: (result: ArtifactPreview) => void;
    const read = vi.fn(() => new Promise<ArtifactPreview>(done => { resolve = done; }));
    const first = cache.preview('workspace', 'file', read, metadata), second = cache.preview('workspace', 'file', read, metadata);
    expect(first).toBe(second); await Promise.resolve(); expect(read).toHaveBeenCalledTimes(1);
    resolve({ mimeType: 'text/plain', text: '原文' }); await expect(first).resolves.toMatchObject({ text: '原文' });
    const changed = vi.fn(async () => ({ mimeType: 'text/plain', text: '外部修改后的原文' }));
    await expect(cache.preview('workspace', 'file', changed, metadata)).resolves.toMatchObject({ text: '外部修改后的原文' }); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('拒绝缓存失败、外部删改在下一次打开仍由后台hash/read失败暴露', async () => {
    const cache = createArtifactPreviewCache(), read = vi.fn(async () => { throw new Error('文件校验失败'); });
    await expect(cache.preview('workspace', 'file', read)).rejects.toThrow('校验失败');
    await expect(cache.preview('workspace', 'file', read)).rejects.toThrow('校验失败'); expect(read).toHaveBeenCalledTimes(2);
  });
  it('工作区和元信息变化不共用读取；trash/restore失效阻止旧读取返回', async () => {
    const cache = createArtifactPreviewCache(); let resolve!: (value: ArtifactPreview) => void;
    const old = cache.preview('one', 'file', () => new Promise<ArtifactPreview>(done => { resolve = done; }), metadata);
    await Promise.resolve(); cache.invalidate('file');
    const current = cache.preview('one', 'file', async () => ({ mimeType: 'text/plain', text: '恢复后内容' }), metadata);
    resolve({ mimeType: 'text/plain', text: '删除前旧内容' });
    await expect(old).rejects.toThrow('状态已改变'); await expect(current).resolves.toMatchObject({ text: '恢复后内容' });
    const read = vi.fn(async () => ({ mimeType: 'text/plain' }));
    await Promise.all([cache.preview('one', 'file', read, metadata), cache.preview('two', 'file', read, metadata), cache.preview('one', 'file', read, { ...metadata, bytes: 5 })]); expect(read).toHaveBeenCalledTimes(3);
    await expect(cache.preview('one', 'file', read, { ...metadata, trashedAt: 'now' })).rejects.toThrow('不可预览');
  });
});

describe('缩略图完成缓存受容量、时间和文件状态约束', () => {
  it('只在启用时复用完成结果，过期或回收后重新读取', async () => {
    let time = 0;
    const cache = createArtifactPreviewCache({ completed: true, ttlMs: 20, now: () => time });
    const read = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,aaaa', thumbnail: true }));
    await cache.preview('one', 'file', read, metadata); await cache.preview('one', 'file', read, metadata); expect(read).toHaveBeenCalledTimes(1);
    time = 21; await cache.preview('one', 'file', read, metadata); expect(read).toHaveBeenCalledTimes(2);
    cache.invalidate('file'); await cache.preview('one', 'file', read, metadata); expect(read).toHaveBeenCalledTimes(3);
    await expect(cache.preview('one', 'file', read, { ...metadata, trashedAt: 'now' })).rejects.toThrow('不可预览');
  });
  it('条数和字节限制会驱逐旧缩略图，不常驻原图或失败结果', async () => {
    const cache = createArtifactPreviewCache({ completed: true, maxEntries: 1, maxBytes: 100 });
    const read = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: 'small' }));
    await cache.preview('one', 'first', read); await cache.preview('one', 'second', read); await cache.preview('one', 'first', read); expect(read).toHaveBeenCalledTimes(3);
    const oversized = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: 'a'.repeat(101) }));
    await cache.preview('one', 'large', oversized); await cache.preview('one', 'large', oversized); expect(oversized).toHaveBeenCalledTimes(2);
  });
});
