const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

function createAppMaintenance({ app, executablePath = process.execPath, appId, spawnImpl = spawn }) {
  const root = path.dirname(executablePath), resources = path.join(root, 'resources');
  const maintenance = path.join(resources, 'xuzuo-maintenance.exe');
  async function status() {
    if (!app.isPackaged) return { available: false, reason: '安装版提供自定义卸载入口；当前是开发运行版本。' };
    try {
      const receiptFile = path.join(resources, 'xuzuo-install-manifest.json');
      const receiptStat = await fs.lstat(receiptFile), executableStat = await fs.lstat(maintenance);
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 8 * 1024 * 1024 || !executableStat.isFile() || executableStat.isSymbolicLink()) throw Error('invalid installation files');
      const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
      const expected = receipt.files?.find(file => file.path === 'resources/xuzuo-maintenance.exe');
      if (receipt.format !== 1 || receipt.appId !== appId || !expected || expected.bytes !== executableStat.size) throw Error('invalid installation receipt');
      const hash = createHash('sha256').update(await fs.readFile(maintenance)).digest('hex');
      if (hash !== expected.sha256) return { available: false, reason: '卸载维护程序校验未通过，请使用完整安装包修复后再卸载。' };
      return { available: true };
    } catch { return { available: false, reason: '当前是目录运行版本或安装信息不完整，请使用自定义安装包安装后管理卸载。' }; }
  }
  return {
    status,
    async openUninstall() {
      const current = await status(); if (!current.available) throw new Error(current.reason);
      const child = spawnImpl(maintenance, ['--uninstall', '--root', root], { detached: true, windowsHide: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
      return { opened: true };
    },
  };
}
module.exports = { createAppMaintenance };
