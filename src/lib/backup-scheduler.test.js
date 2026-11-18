import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url), { createBackupScheduler } = require('../../electron/backup-scheduler.cjs');
const fixtures = [], stamp = '2026-11-17T00:00:00.000Z';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, match) { const deadline = Date.now() + 4000; while (Date.now() < deadline) { const value = await read(); if (match(value)) return value; await delay(10); } throw Error('Scheduler fixture did not settle'); }
function meta(workspaceId = 'one', name = 'Saved state') { return { workspaces: [{ id: workspaceId, name, createdAt: stamp }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: {}, configuration: { version: 1, connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] } }; }
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-backup-scheduler-')), calls = [], changes = [];
  let idle = false, hold = false, failure = false, scheduler;
  const manager = {
    async createSnapshotRepository({ workspaceId }) { const target = path.join(directory, 'repository-' + workspaceId); await fs.mkdir(target, { recursive: true }); return { directory: target }; },
    async exportSnapshot(input) {
      calls.push(input);
      if (hold) await new Promise((resolve, reject) => { if (input.signal.aborted) { reject(Object.assign(Error('cancelled'), { name: 'AbortError' })); return; } input.signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })), { once: true }); });
      if (failure) throw Error('Synthetic owned disk failure'); await input.beforeWrite();
      return { saved: true, snapshotPath: path.join(input.repository, 'synthetic-' + calls.length + '.json'), files: 3, bytes: 100, newBytes: 10 };
    },
  };
  const start = () => { scheduler = createBackupScheduler({ directory, backupManager: manager, isIdle: () => idle, intervalMs: 10, settleMs: 10, onChanged: value => changes.push(value) }); scheduler.start(); return scheduler; };
  const f = { directory, calls, changes, manager, start, get scheduler() { return scheduler; }, idle(value) { idle = value; }, hold(value) { hold = value; }, fail(value) { failure = value; } }; fixtures.push(f); start(); return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.scheduler.shutdown(); const directory = await fs.realpath(f.directory), temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(directory).toLowerCase() !== temporary.toLowerCase() || !path.basename(directory).startsWith('xuzuo-backup-scheduler-')) throw Error('Unowned scheduler fixture');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('自动备份仅在空闲时捕获成功保存的范围', () => {
  it('忙碌时不开始，合并多次变更并在空闲后只完成一次快照', async () => {
    const f = await fixture(), s = f.scheduler;
    await s.sync({ workspaceId: 'one', meta: meta() }); await s.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    for (let i = 0; i < 8; i++) s.markDirty('one'); await delay(35); expect(f.calls).toHaveLength(0);
    f.idle(true); const result = await until(() => s.status({ workspaceId: 'one' }), value => Boolean(value.lastSuccess) && !value.running);
    expect(f.calls).toHaveLength(1); expect(result.files).toBe(3); expect(result.pending).toBe(false);
    const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'incremental-backup-settings-v1.json'), 'utf8'));
    expect(persisted.workspaces[0].lastSuccess).toBe(result.lastSuccess); expect(JSON.stringify(persisted)).not.toContain('Saved state');
  }, 10000);
  it('暂停与取消不会重启当前本地任务，已有成功时间不回退', async () => {
    const f = await fixture(), s = f.scheduler; f.idle(true);
    await s.sync({ workspaceId: 'one', meta: meta() }); await s.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    const previous = await until(() => s.status({ workspaceId: 'one' }), value => Boolean(value.lastSuccess) && !value.running);
    f.hold(true); await s.run({ workspaceId: 'one' }); await until(() => s.status({ workspaceId: 'one' }), value => value.running);
    await s.run({ workspaceId: 'one' }); expect(f.calls).toHaveLength(2);
    await s.cancel({ workspaceId: 'one' }); await s.flush(); await delay(35);
    expect(f.calls).toHaveLength(2); expect((await s.status({ workspaceId: 'one' })).lastSuccess).toBe(previous.lastSuccess);
    await s.configure({ workspaceId: 'one', enabled: false }); s.markDirty(); await delay(30); expect(f.calls).toHaveLength(2);
  }, 10000);
  it('存储异常阻止旧meta继续备份，重复相同异常不形成状态事件循环', async () => {
    const f = await fixture(), s = f.scheduler; f.hold(true); f.idle(true);
    await s.sync({ workspaceId: 'one', meta: meta() }); await s.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    await until(() => s.status({ workspaceId: 'one' }), value => value.running);
    const issue = 'Synthetic index write failed'; await s.sync({ workspaceId: 'one', issue }); await s.flush();
    const events = f.changes.length; await s.sync({ workspaceId: 'one', issue }); expect(f.changes).toHaveLength(events);
    const invalid = await s.status({ workspaceId: 'one' }); expect(invalid.waitingForMeta).toBe(true); expect(invalid.lastSuccess).toBeUndefined(); expect(invalid.error).toBe(issue);
    f.hold(false); await s.sync({ workspaceId: 'one', meta: meta('one', 'New successfully persisted state') });
    const result = await until(() => s.status({ workspaceId: 'one' }), value => Boolean(value.lastSuccess) && !value.running);
    expect(result.error).toBeUndefined(); expect(f.calls).toHaveLength(2);
  }, 10000);
  it('重启后保留目标与成功信息，但拿到新的已保存meta前不自动读取旧稿', async () => {
    const f = await fixture(), first = f.scheduler; f.idle(true);
    await first.sync({ workspaceId: 'one', meta: meta() }); await first.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    const saved = await until(() => first.status({ workspaceId: 'one' }), value => Boolean(value.lastSuccess) && !value.running); await first.shutdown();
    const restarted = f.start(); await delay(35); const result = await restarted.status({ workspaceId: 'one' });
    expect(result.repository).toBe(saved.repository); expect(result.lastSuccess).toBe(saved.lastSuccess); expect(result.waitingForMeta).toBe(true); expect(f.calls).toHaveLength(1);
  }, 10000);
  it('未启用或没有新meta的范围不因全局dirty而开始，失败仍显示且关闭可收敛', async () => {
    const f = await fixture(), s = f.scheduler;
    await s.sync({ workspaceId: 'one', meta: meta() }); await s.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    await s.configure({ workspaceId: 'two', enabled: true, directory: f.directory }); s.markDirty();
    expect((await s.status({ workspaceId: 'one' })).enabledWorkspaceIds).toEqual(['one', 'two']); f.fail(true); f.idle(true);
    await until(() => s.status({ workspaceId: 'one' }), value => Boolean(value.error));
    await s.sync({ workspaceId: 'one', meta: meta() }); expect((await s.status({ workspaceId: 'one' })).error).toBe('Synthetic owned disk failure');
    expect(f.calls).toHaveLength(1); expect(f.calls[0].workspaceIds).toEqual(['one']); await s.shutdown(); await s.flush();
  }, 10000);
  it('前台恢复预览让后台快照让出，保留dirty并在空闲后重做，不取消其他显式任务', async () => {
    const f = await fixture(), s = f.scheduler; f.idle(true); f.hold(true);
    await s.sync({ workspaceId: 'one', meta: meta() }); await s.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    await until(() => s.status({ workspaceId: 'one' }), value => value.running); f.idle(false);
    await s.yieldToForeground(); const paused = await s.status({ workspaceId: 'one' }); expect(paused.running).toBe(false); expect(paused.pending).toBe(true); expect(paused.lastSuccess).toBeUndefined();
    await delay(30); expect(f.calls).toHaveLength(1); f.hold(false); f.idle(true); s.wake();
    const resumed = await until(() => s.status({ workspaceId: 'one' }), value => Boolean(value.lastSuccess) && !value.running); expect(resumed.pending).toBe(false); expect(f.calls).toHaveLength(2);
  }, 10000);
  it('系统中止后台快照后取消退出，可重新恢复调度而不丢失待备份内容', async () => {
    const f = await fixture(), s = f.scheduler; f.idle(true); f.hold(true);
    await s.sync({ workspaceId: 'one', meta: meta() }); await s.configure({ workspaceId: 'one', enabled: true, directory: f.directory });
    await until(() => s.status({ workspaceId: 'one' }), value => value.running); await s.shutdown();
    expect((await s.status({ workspaceId: 'one' })).pending).toBe(true); f.hold(false); s.resume();
    const restored = await until(() => s.status({ workspaceId: 'one' }), value => Boolean(value.lastSuccess) && !value.running); expect(restored.pending).toBe(false); expect(f.calls).toHaveLength(2);
  }, 10000);
  it('设置数量达到读取边界时不写入下次无法读取的新配置，也不接管新目录', async () => {
    const f = await fixture(); await f.scheduler.shutdown();
    const filename = path.join(f.directory, 'incremental-backup-settings-v1.json'), value = { kind: 'xuzuo-backup-scheduler', version: 1, ownerId: 'bounded-owner', workspaces: Array.from({ length: 1000 }, (_, index) => ({ workspaceId: 'saved-' + index, enabled: false, repository: path.join(f.directory, 'old-' + index) })) };
    await fs.writeFile(filename, JSON.stringify(value) + '\n'); const before = await fs.readFile(filename), names = await fs.readdir(f.directory), restarted = f.start();
    await expect(restarted.configure({ workspaceId: 'new', enabled: true, directory: f.directory })).rejects.toThrow('1000');
    expect((await fs.readFile(filename)).equals(before)).toBe(true); expect(await fs.readdir(f.directory)).toEqual(names);
  }, 10000);
});
