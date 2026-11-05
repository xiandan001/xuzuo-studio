const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assetProvenance } = require('./asset-provenance.cjs');
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
function createBuiltinAssets({ directory = path.join(__dirname, '..', 'assets', 'library'), workspaceStorage, artifactStore, assetLibrary, fileSystem = fsDefault, loadModule = require }) {
  const fs = fileSystem, root = path.resolve(directory);
  let pendingCatalog;
  async function checked(relative, maximum = 4 * 1024 * 1024) {
    if (typeof relative !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('内置素材路径无效。');
    // Traverse only the trusted pack root; app.asar is a file to the OS and a directory to Electron.
    let current = root;
    const parts = relative.split('/');
    for (const part of ['', ...parts.slice(0, -1)]) {
      if (part) current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('内置素材目录不可安全读取。');
    }
    const filename = path.join(root, ...parts), stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) throw new Error('内置素材文件无效或过大。');
    const buffer = await fs.readFile(filename);
    if (buffer.length !== stat.size) throw new Error('内置素材读取期间发生变化，请重新打开应用。');
    return buffer;
  }
  async function catalog() {
    if (!pendingCatalog) pendingCatalog = (async () => {
      const value = JSON.parse((await checked('catalog.json', 512 * 1024)).toString('utf8'));
      if (value.version !== 1 || !/^[A-Za-z0-9-]{1,100}$/.test(value.packId) || !Array.isArray(value.assets) || value.assets.length > 100 || !Array.isArray(value.licenses) || new Set(value.assets.map(item => item.id)).size !== value.assets.length) throw new Error('内置素材目录信息无效。');
      for (const item of value.assets) {
        const license = value.licenses.find(entry => entry.id === item.licenseId);
        if (!license || item.mimeType !== 'image/png' || item.kind !== 'image' || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('内置素材缺少文件或授权信息。');
        provenance(item, license, value.packId);
      }
      return value;
    })().catch(error => { pendingCatalog = undefined; throw error; });
    return pendingCatalog;
  }
  function provenance(item, license, packId) {
    return assetProvenance({ builtinId: item.id, packId, origin: item.origin, author: item.author, licenseId: license.id, licenseName: license.name, licenseUrl: license.url, sourceUrl: item.sourceUrl, usageNote: item.usageNote, licenseNotice: license.notice });
  }
  async function selected(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(id)) throw new Error('请选择有效的内置素材。');
    const data = await catalog(), item = data.assets.find(entry => entry.id === id);
    if (!item) throw new Error('这份内置素材不存在，请刷新素材库。');
    return { item, license: data.licenses.find(entry => entry.id === item.licenseId), packId: data.packId };
  }
  async function verified(relative, bytes, digest) {
    const buffer = await checked(relative);
    if (buffer.length !== bytes || sha256(buffer) !== digest) throw new Error('内置素材完整性检查失败，未复制不一致文件。请重新安装当前版本。');
    return buffer;
  }
  async function read({ id }) {
    const { item, license, packId } = await selected(id), buffer = await verified(item.path, item.bytes, item.sha256);
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('内置图片不是有效 PNG。');
    return { name: `${item.name}.png`, mimeType: item.mimeType, buffer, provenance: provenance(item, license, packId) };
  }
  return {
    read,
    async validateId(id) { await selected(id); },
    async import({ workspaceId, id }) { await workspaceStorage.validateWorkspace(workspaceId); return assetLibrary.importBuiltin({ workspaceId, file: await read({ id }) }); },
    async attach({ workspaceId, id, projectId }) { await workspaceStorage.assertProject(projectId, workspaceId); return artifactStore.write({ ...await read({ id }), projectId, preserveOriginalName: true }); },
    async bundle({ id }) {
      const { item, license, packId } = await selected(id), file = await read({ id });
      const vector = await verified(item.vectorPath, item.vectorBytes, item.vectorSha256), notice = await checked(license.path, 40000);
      if (notice.toString('utf8').trim() !== license.notice.trim()) throw new Error('素材许可原文不一致，未导出缺少授权的素材包。');
      const Zip = loadModule('jszip'), zip = new Zip();
      zip.file(`${item.id}.png`, file.buffer); zip.file(`${item.id}.svg`, vector); zip.file('LICENSE.txt', notice);
      zip.file('素材说明.txt', `${item.name}\n${item.description}\n\n作者：${item.author}\n许可证：${license.name}\n许可来源：${license.url}\n素材来源：${item.sourceUrl || `序作原创素材包 ${packId}，原始 SVG 随包提供`}\n\n${item.usageNote}\n`);
      return { name: `${item.name}-素材包.zip`, mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
    },
    async link({ id, kind }) {
      const { item, license } = await selected(id);
      if (!['source', 'license'].includes(kind)) throw new Error('素材链接类型无效。');
      const address = kind === 'license' ? license.url : item.sourceUrl;
      if (!address) throw new Error('此素材为内置原创作品，SVG 原稿和授权随素材包提供。');
      const url = new URL(address);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('素材来源链接无效。');
      return url.href;
    },
  };
}
module.exports = { createBuiltinAssets };
