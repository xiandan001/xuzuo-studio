import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { createPerformanceControl } = require('../../electron/performance-control.cjs');
const directories = [];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-performance-')); directories.push(directory);
  let lowResource = false;
  const cpuTasks = { setLowResource: value => { lowResource = value; }, snapshot: () => ({ lowResource, pending: 0, recent: [] }) };
  return { directory, cpuTasks };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) { expect(path.dirname(await fs.realpath(directory))).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-performance-/); await fs.rm(directory, { recursive: true, force: true }); }
});
it('低占用偏好真实持久化并在重启服务后恢复，采样不持续轮询', async () => {
  const f = await fixture(), metrics = vi.fn(() => [{ cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 2048 } }]);
  const first = createPerformanceControl({ ...f, metrics }); await first.ready;
  expect(metrics).not.toHaveBeenCalled(); expect((await first.save({ lowResource: true })).lowResource).toBe(true);
  const next = createPerformanceControl({ ...f, metrics }); await next.ready; expect((await next.read()).lowResource).toBe(true);
  expect((await next.read()).cpuPercent).toBe(3); expect((await next.read()).memoryMb).toBe(2);
  expect(JSON.parse(await fs.readFile(path.join(f.directory, 'performance-v1.json'), 'utf8'))).toEqual({ version: 1, lowResource: true }); await next.flush();
});
it('保存失败保留原模式，指标读取失败不冒充零CPU或导致已保存偏好报失败', async () => {
  const f = await fixture(), control = createPerformanceControl({ ...f, metrics: () => { throw Error('指标暂不可用'); } });
  await expect(control.save({ lowResource: true })).resolves.toMatchObject({ lowResource: true }); expect((await control.read()).cpuPercent).toBeUndefined();
  await expect(control.save({ lowResource: false, apiKey: 'not-allowed' })).rejects.toThrow('请选择'); expect((await control.read()).lowResource).toBe(true);
  const blocked = createPerformanceControl({ ...f, fileSystem: { ...fs, rename: async () => { throw Error('磁盘忙'); } } }); await blocked.ready;
  await expect(blocked.save({ lowResource: false })).rejects.toThrow('磁盘忙'); expect((await blocked.read()).lowResource).toBe(true);
});
it('损坏的偏好有明确状态，重新保存修复偏好而不访问其他资料', async () => {
  const f = await fixture(); await fs.writeFile(path.join(f.directory, 'performance-v1.json'), '{invalid');
  const control = createPerformanceControl(f); expect((await control.read()).preferenceError).toContain('尚未读取');
  const result = await control.save({ lowResource: true }); expect(result.preferenceError).toBeUndefined(); expect(result.lowResource).toBe(true);
});
