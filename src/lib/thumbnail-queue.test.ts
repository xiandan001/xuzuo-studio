import { describe, expect, it, vi } from 'vitest';
import { createThumbnailQueue } from './thumbnail-queue';

describe('成品缩略图的有界读取', () => {
  it('最多同时读取两份，完成后再开始下一份', async () => {
    const queue = createThumbnailQueue(2), resolves: (() => void)[] = [];
    let active = 0, maximum = 0;
    const read = vi.fn(() => new Promise<void>(resolve => { active++; maximum = Math.max(maximum, active); resolves.push(() => { active--; resolve(); }); }));
    const tasks = Array.from({ length: 5 }, () => queue.schedule(read));
    await Promise.resolve(); expect(read).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 5; index++) { resolves[index](); await tasks[index].promise; await new Promise(resolve => setTimeout(resolve, 0)); }
    await Promise.all(tasks.map(task => task.promise)); expect(maximum).toBe(2);
  });
  it('离开视图的排队项不会继续触发读取，运行中的项完成不阻塞下一份', async () => {
    const queue = createThumbnailQueue(1); let finish!: () => void;
    const first = queue.schedule(() => new Promise<void>(resolve => { finish = resolve; }));
    const skipped = vi.fn(async () => 'skipped'), cancelled = queue.schedule(skipped);
    const caught = cancelled.promise.catch(error => error.message); cancelled.cancel();
    const last = queue.schedule(async () => 'last');
    await Promise.resolve(); finish(); await first.promise;
    expect(await caught).toContain('离开'); expect(await last.promise).toBe('last'); expect(skipped).not.toHaveBeenCalled();
  });
});
