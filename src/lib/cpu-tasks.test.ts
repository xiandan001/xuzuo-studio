import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');

describe('background CPU work', () => {
  it('checks real alpha in a worker and drains serial jobs', async () => {
    const tasks = createCpuTasks();
    const opaque = tasks.run('image-alpha', { width: 1, height: 1, bitmap: Buffer.from([0, 0, 0, 255]) });
    const transparent = tasks.run('image-alpha', { width: 1, height: 1, bitmap: Buffer.from([0, 0, 0, 0]) });
    await expect(opaque).resolves.toMatchObject({ transparency: 'opaque' });
    await expect(transparent).resolves.toMatchObject({ transparency: 'present' });
    await tasks.drain();
  });
  it('rejects unsupported work without preventing the next task', async () => {
    const tasks = createCpuTasks();
    await expect(tasks.run('bad-task', {})).rejects.toThrow('Unsupported');
    await expect(tasks.run('image-alpha', { width: 0, height: 0, bitmap: [] })).resolves.toMatchObject({ transparency: 'unknown' });
  });
});
