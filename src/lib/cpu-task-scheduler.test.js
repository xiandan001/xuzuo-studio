import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createCpuTaskScheduler } = require('../../electron/cpu-task-scheduler.cjs');
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function fixture() {
  const started = [], releases = new Map();
  const scheduler = createCpuTaskScheduler((task, input) => { started.push(input.id); return new Promise((resolve, reject) => releases.set(input.id, { resolve, reject })); });
  return { scheduler, started, release: id => releases.get(id).resolve(id), fail: id => releases.get(id).reject(Error('实际处理失败')) };
}
describe('交互优先的本地处理队列', () => {
  it('保持当前任务，交互预览优先于尚未开始的导出且只执行一项', async () => {
    const f = fixture(), first = f.scheduler.run('office', { id: 'first' }); await flush();
    const later = f.scheduler.run('office', { id: 'later' }), preview = f.scheduler.run('commerce-preview', { id: 'preview' });
    expect(f.started).toEqual(['first']); expect(f.scheduler.snapshot().pending).toBe(2);
    f.release('first'); await first; await flush(); expect(f.started).toEqual(['first', 'preview']);
    f.release('preview'); await preview; await flush(); expect(f.started).toEqual(['first', 'preview', 'later']);
    f.release('later'); await later; await f.scheduler.drain(); expect(f.scheduler.snapshot().running).toBeUndefined();
  });
  it('撤回等待项不创建处理任务，也不阻止其他工作落盘', async () => {
    const f = fixture(), first = f.scheduler.run('office', { id: 'first' }); await flush();
    const controller = new AbortController(), removed = f.scheduler.run('office', { id: 'removed' }, { signal: controller.signal });
    const rejection = expect(removed).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejection;
    f.release('first'); await first; await f.scheduler.drain(); expect(f.started).toEqual(['first']); expect(f.scheduler.snapshot().recent.some(row => row.outcome === 'cancelled')).toBe(true);
  });
  it('低占用时给正在操作的用户让出间隙，预览立即开始，后台随后继续', async () => {
    vi.useFakeTimers(); const f = fixture(); f.scheduler.setLowResource(true); f.scheduler.noteInteraction();
    const background = f.scheduler.run('office', { id: 'background' }); await flush(); expect(f.started).toEqual([]);
    const preview = f.scheduler.run('commerce-preview', { id: 'preview' }); await flush(); expect(f.started).toEqual(['preview']);
    f.release('preview'); await preview; await flush(); await vi.advanceTimersByTimeAsync(1000); expect(f.started).toEqual(['preview', 'background']);
    f.release('background'); await background; await f.scheduler.drain();
  });
  it('持续输入不会无限饿死已经排队的后台工作', async () => {
    vi.useFakeTimers(); const f = fixture(); f.scheduler.setLowResource(true); f.scheduler.noteInteraction();
    const background = f.scheduler.run('office', { id: 'background' });
    for (let index = 0; index < 8; index++) { await vi.advanceTimersByTimeAsync(500); f.scheduler.noteInteraction(); }
    await flush(); expect(f.started).toEqual(['background']); f.release('background'); await background;
  });
  it('失败后继续队列，drain在实际所有任务结束后才完成', async () => {
    const f = fixture(), first = f.scheduler.run('office', { id: 'first' }); const rejection = expect(first).rejects.toThrow('实际处理失败'); await flush();
    const next = f.scheduler.run('office', { id: 'next' }); let drained = false; const draining = f.scheduler.drain().then(() => { drained = true; });
    f.fail('first'); await rejection; await flush(); expect(drained).toBe(false); expect(f.started).toEqual(['first', 'next']);
    f.release('next'); await next; await draining; expect(drained).toBe(true);
  });
  it('采样有界且不收集文稿、文件路径、凭证或输入内容', async () => {
    const scheduler = createCpuTaskScheduler(async () => 'ok');
    for (let index = 0; index < 25; index++) await scheduler.run('reference-text', { path: 'private-file', apiKey: 'secret-value', text: 'private-text' });
    await scheduler.drain(); const value = scheduler.snapshot(); expect(value.recent).toHaveLength(20); expect(JSON.stringify(value)).not.toMatch(/private-file|private-text|secret-value/); expect(value.recent.every(row => row.outcome === 'complete' && row.runMs >= 0 && row.queueMs >= 0)).toBe(true);
  });
});
