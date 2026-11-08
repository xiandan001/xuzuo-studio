import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { createBeadMarketSessions } = require('../../electron/bead-market-sessions.cjs');
const owned = [], confirmed = '2026-11-08T04:00:00.000Z';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-market-sessions-')), calls = [], events = [];
  const browser = { async open(input) { calls.push(structuredClone(input)); return { opened: true, cookie: 'NEVER_SAVE_BROWSER_COOKIE', apiKey: 'NEVER_SAVE_API_KEY' }; } };
  const session = createBeadMarketSessions({ directory, browser, onChanged: () => events.push('changed'), ...options }), value = { directory, filename: path.join(directory, 'bead-market-sessions-v1.json'), calls, events, browser, session };
  owned.push(value); return value;
}
afterEach(async () => { vi.useRealTimers(); for (const value of owned.splice(0)) { await value.session.drain(); const directory = await fs.realpath(value.directory); expect(path.dirname(directory)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-market-sessions-/); await fs.rm(directory, { recursive: true, force: true }); } });
describe('独立平台登录元数据（真实临时FS，零网络/GUI/模型）', () => {
  it('不要求项目即可读取三平台状态，初次只读不会写出假登录记录', async () => {
    const f = await fixture(); expect(await f.session.sessions()).toEqual([{ platform: '1688', status: 'not-opened' }, { platform: 'taobao', status: 'not-opened' }, { platform: 'pdd', status: 'not-opened' }]); expect(f.calls).toHaveLength(0); await expect(fs.stat(f.filename)).rejects.toHaveProperty('code', 'ENOENT');
  });
  it('三个入口使用固定官方首页、固定登录marker和login模式，而不是任意项目或搜索商品页', async () => {
    const f = await fixture(), expected = { '1688': 'https://www.1688.com/', taobao: 'https://www.taobao.com/', pdd: 'https://mobile.yangkeduo.com/' };
    for (const platform of Object.keys(expected)) { expect((await f.session.login({ platform })).opened).toBe(true); expect(f.calls.at(-1)).toEqual({ projectId: 'bead-market-platform-login', platform, mode: 'login', url: expected[platform] }); }
    expect((await f.session.sessions()).every(row => row.status === 'opened' && !!row.openedAt && !row.userConfirmedAt)).toBe(true);
  });
  it('打开窗口不冒充已登录，只有用户明确确认才标confirmed，重启保留该元数据', async () => {
    const f = await fixture(); await f.session.login({ platform: 'taobao' }); const opened = (await f.session.sessions()).find(row => row.platform === 'taobao'); expect(opened.status).toBe('opened'); expect(opened.userConfirmedAt).toBeUndefined();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(confirmed); await f.session.confirmLogin({ platform: 'taobao' }); const restarted = createBeadMarketSessions({ directory: f.directory, browser: f.browser }); expect((await restarted.sessions()).find(row => row.platform === 'taobao')).toMatchObject({ status: 'confirmed', userConfirmedAt: confirmed, openedAt: opened.openedAt }); expect(f.events).toHaveLength(2); await restarted.drain();
  });
  it('已确认后再次打开平台保留确认状态与时间，只更新打开时间；真正需重新登录时仍需明确确认', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(confirmed); await f.session.login({ platform: 'taobao' }); await f.session.confirmLogin({ platform: 'taobao' });
    vi.setSystemTime('2026-11-08T04:01:00.000Z'); await f.session.login({ platform: 'taobao' }); expect((await f.session.sessions()).find(row => row.platform === 'taobao')).toEqual({ platform: 'taobao', status: 'confirmed', userConfirmedAt: confirmed, openedAt: '2026-11-08T04:01:00.000Z' });
    await f.session.markNeedsLogin('taobao', '2026-11-08T04:02:00.000Z'); vi.setSystemTime('2026-11-08T04:03:00.000Z'); await f.session.login({ platform: 'taobao' }); expect((await f.session.sessions()).find(row => row.platform === 'taobao')).toEqual({ platform: 'taobao', status: 'opened', userConfirmedAt: confirmed, openedAt: '2026-11-08T04:03:00.000Z' });
    vi.setSystemTime('2026-11-08T04:04:00.000Z'); await f.session.confirmLogin({ platform: 'taobao' }); expect((await f.session.sessions()).find(row => row.platform === 'taobao')).toMatchObject({ status: 'confirmed', userConfirmedAt: '2026-11-08T04:04:00.000Z' }); expect(f.calls).toHaveLength(3);
  });
  it('元数据文件仅含平台和时间状态，不含浏览器cookie/API Key/项目号或返回对象', async () => {
    const f = await fixture(); await f.session.login({ platform: '1688' }); await f.session.confirmLogin({ platform: '1688' }); const raw = await fs.readFile(f.filename, 'utf8'), saved = JSON.parse(raw); expect(Object.keys(saved).sort()).toEqual(['platforms', 'version']); for (const row of saved.platforms) expect(Object.keys(row).every(key => ['platform', 'status', 'openedAt', 'userConfirmedAt'].includes(key))).toBe(true); expect(raw).not.toContain('NEVER_SAVE'); expect(raw).not.toContain('projectId'); expect(raw).not.toContain('cookie'); expect(raw).not.toContain('apiKey'); expect(f.calls).toHaveLength(1);
  });
  it('窗口未打开不写opened，事件监听抛错不能把成功保存误报为失败', async () => {
    const first = await fixture({ browser: { open: async () => ({ opened: false }) } }); expect(await first.session.login({ platform: 'pdd' })).toEqual({ opened: false }); expect((await first.session.sessions()).find(row => row.platform === 'pdd').status).toBe('not-opened');
    const second = await fixture({ onChanged: () => { throw Error('Synthetic detached UI observer'); } }); await expect(second.session.confirmLogin({ platform: 'pdd' })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ platform: 'pdd', status: 'confirmed' })])); expect((await second.session.sessions()).find(row => row.platform === 'pdd').status).toBe('confirmed');
  });
  it('未知平台拒绝打开和修改，不落入对象原型或创建任意站点入口', async () => {
    const f = await fixture(); for (const platform of ['other', '__proto__', 'constructor', 'https://evil.test', null]) { await expect(f.session.login({ platform })).rejects.toThrow('请选择'); await expect(Promise.resolve().then(() => f.session.confirmLogin({ platform }))).rejects.toThrow('请选择'); await expect(Promise.resolve().then(() => f.session.markNeedsLogin(platform, confirmed))).rejects.toThrow('请选择'); } expect(f.calls).toHaveLength(0); await expect(fs.stat(f.filename)).rejects.toHaveProperty('code', 'ENOENT');
  });
  it('损坏、重复平台及超限文件保持原字节，确认不会创建空记录覆盖', async () => {
    const f = await fixture(); for (const raw of ['{broken', JSON.stringify({ version: 1, platforms: [{ platform: 'taobao', status: 'confirmed' }, { platform: 'taobao', status: 'opened' }, { platform: 'pdd', status: 'opened' }] }), 'x'.repeat(8193)]) { await fs.writeFile(f.filename, raw); await expect(f.session.sessions()).rejects.toThrow('原文件保留'); await expect(f.session.confirmLogin({ platform: 'taobao' })).rejects.toThrow('原文件保留'); expect(await fs.readFile(f.filename, 'utf8')).toBe(raw); } expect(f.events).toHaveLength(0);
  });
  it('并发三平台更新顺序持久化，不丢掉其它平台状态，重复读取无写入/事件', async () => {
    const f = await fixture(); await Promise.all(['1688', 'taobao', 'pdd'].map(platform => f.session.confirmLogin({ platform }))); const expected = await f.session.sessions(); expect(expected.every(row => row.status === 'confirmed')).toBe(true); expect(f.events).toHaveLength(3); const before = await fs.readFile(f.filename); await Promise.all(Array.from({ length: 8 }, () => f.session.sessions())); expect(await fs.readFile(f.filename)).toEqual(before); expect(f.events).toHaveLength(3);
  });
  it('drain等待已排队原子写入，关闭前不会只等到临时文件而漏掉最终rename', async () => {
    const entered = deferred(), release = deferred(); let held = true; const f = await fixture({ fileSystem: { ...fs, async rename(from, to) { if (held) { held = false; entered.resolve(); await release.promise; } return fs.rename(from, to); } } });
    const first = f.session.confirmLogin({ platform: 'taobao' }); await entered.promise; const second = f.session.confirmLogin({ platform: 'pdd' }); let stopped = false; const draining = f.session.drain().then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false); release.resolve(); await Promise.all([first, second, draining]); expect(stopped).toBe(true); const reloaded = JSON.parse(await fs.readFile(f.filename, 'utf8')); expect(reloaded.platforms.filter(row => row.status === 'confirmed')).toHaveLength(2); expect((await fs.readdir(f.directory)).some(name => name.endsWith('.tmp'))).toBe(false);
  });
  it('旧查询的needs-login观察不会推翻稍后用户确认，较新观察才标为需重新登录', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(confirmed); await f.session.confirmLogin({ platform: 'taobao' });
    await f.session.markNeedsLogin('taobao', '2026-11-08T03:59:59.000Z'); expect((await f.session.sessions()).find(row => row.platform === 'taobao')).toMatchObject({ status: 'confirmed', userConfirmedAt: confirmed });
    await f.session.markNeedsLogin('taobao', '2026-11-08T04:00:01.000Z'); expect((await f.session.sessions()).find(row => row.platform === 'taobao')).toMatchObject({ status: 'needs-login', userConfirmedAt: confirmed });
    vi.setSystemTime('2026-11-08T04:00:02.000Z'); const confirming = f.session.confirmLogin({ platform: 'taobao' }), stale = f.session.markNeedsLogin('taobao', '2026-11-08T04:00:01.500Z'); await Promise.all([confirming, stale]); expect((await f.session.sessions()).find(row => row.platform === 'taobao')).toMatchObject({ status: 'confirmed', userConfirmedAt: '2026-11-08T04:00:02.000Z' });
  });
});
