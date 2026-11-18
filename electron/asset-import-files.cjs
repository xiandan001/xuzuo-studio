const { createHash } = require('node:crypto');
const { checkedFile } = require('./workspace-paths.cjs');
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);

async function readImportFile(fs, filename, onChunk) {
  const before = await checkedFile(fs, filename), handle = await fs.open(filename, 'r');
  const hash = createHash('sha256'), chunk = Buffer.allocUnsafe(256 * 1024); let bytes = 0;
  try {
    if (!sameFile(before, await handle.stat())) throw Error('导入期间文件身份发生变化，请重新选择。');
    while (bytes < before.size) {
      const result = await handle.read(chunk, 0, Math.min(chunk.length, before.size - bytes), bytes);
      if (!result.bytesRead) throw Error('导入期间文件未完整读取，原文件保留。');
      const value = chunk.subarray(0, result.bytesRead); hash.update(value); if (onChunk) await onChunk(value); bytes += result.bytesRead;
    }
    if (!sameFile(before, await handle.stat()) || !sameFile(before, await checkedFile(fs, filename))) throw Error('导入期间原文件发生变化，请重新选择；原文件保留。');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
module.exports = { readImportFile };
