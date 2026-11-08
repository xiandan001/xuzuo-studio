const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { CONFIG } = require('./bead-market-sources-url.cjs');
const platforms = ['1688', 'taobao', 'pdd'];
function createBeadMarketSessions({ directory, browser, onChanged = () => undefined, fileSystem = fsDefault }) {
  const fs = fileSystem, filename = path.join(path.resolve(directory), 'bead-market-sessions-v1.json'); let tail = Promise.resolve();
  const check = platform => { if (!platforms.includes(platform)) throw Error('请选择1688、淘宝或拼多多。'); };
  async function read() {
    await checkedDirectory(fs, path.dirname(filename), true);
    try {
      const info = await checkedFile(fs, filename); if (info.size > 8192) throw Error('size');
      const value = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (value?.version !== 1 || !Array.isArray(value.platforms) || value.platforms.length !== 3 || new Set(value.platforms.map(row => row.platform)).size !== 3) throw Error('shape');
      return platforms.map(platform => { const row = value.platforms.find(item => item.platform === platform); if (!row || !['not-opened', 'opened', 'confirmed', 'needs-login'].includes(row.status) || ['openedAt', 'userConfirmedAt'].some(key => row[key] !== undefined && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key]))))) throw Error('shape'); return { platform, status: row.status, ...(row.openedAt ? { openedAt: row.openedAt } : {}), ...(row.userConfirmedAt ? { userConfirmedAt: row.userConfirmedAt } : {}) }; });
    } catch (error) { if (error.code === 'ENOENT') return platforms.map(platform => ({ platform, status: 'not-opened' })); throw Error('平台登录记录暂不可读；原文件保留，已登录的会话仍可继续使用。'); }
  }
  function update(platform, changes, observedAt) { check(platform); const task = tail.then(async () => { const records = await read(), current = records.find(row => row.platform === platform); if (observedAt && current.userConfirmedAt && Date.parse(observedAt) <= Date.parse(current.userConfirmedAt)) return records; const patch = typeof changes === 'function' ? changes(current) : changes, values = records.map(row => row.platform === platform ? { ...row, ...patch } : row); if (JSON.stringify(values) === JSON.stringify(records)) return records; await atomicJson(fs, filename, { version: 1, platforms: values }); try { onChanged(); } catch { /* Login metadata is already saved. */ } return values; }); tail = task.catch(() => undefined); return task; }
  return {
    sessions: () => tail.then(read),
    async login({ platform } = {}) { check(platform); const result = await browser.open({ projectId: 'bead-market-platform-login', platform, mode: 'login', url: CONFIG[platform].home }); if (result.opened) await update(platform, row => ({ status: row.status === 'confirmed' ? 'confirmed' : 'opened', openedAt: new Date().toISOString() })).catch(() => undefined); return result; },
    confirmLogin({ platform } = {}) { return update(platform, { status: 'confirmed', userConfirmedAt: new Date().toISOString() }); },
    markNeedsLogin(platform, observedAt) { if (observedAt !== undefined && !Number.isFinite(Date.parse(observedAt))) return Promise.reject(Error('平台登录检查时间无效。')); return update(platform, { status: 'needs-login' }, observedAt); },
    drain: () => tail,
  };
}
module.exports = { createBeadMarketSessions };
