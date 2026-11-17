const path = require('node:path');
const { checkedDirectory } = require('./workspace-paths.cjs');
const { sourceInfo, copySource, fileIdentity, sourceFromPath } = require('./incremental-backup-paths.cjs');

function streamDescriptor(source) {
  const info = sourceInfo(source);
  if (source?.kind !== 'xuzuo-stream-file') throw Error('增量备份资料缺少受控流式来源。');
  return { kind: 'xuzuo-stream-file', ...info, readBytes: source.readBytes, copyTo: source.copyTo };
}
async function cacheSource(fs, source, target, options) {
  const info = sourceInfo(source); await checkedDirectory(fs, path.dirname(target), true);
  try { await copySource(fs, source, target, options); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await fileIdentity(fs, target, options);
    if (existing.bytes !== info.bytes || existing.sha256 !== info.sha256) throw Error('恢复资料缓存与原文件不同，未覆盖它。');
  }
  return { path: target, ...info };
}
async function cachedSource(fs, filename, info, options) {
  const actual = await fileIdentity(fs, filename, options);
  if (actual.bytes !== info.bytes || actual.sha256 !== info.sha256) throw Error('恢复资料缓存已经改变，未登记或覆盖原有内容。');
  return sourceFromPath(fs, filename, info, options);
}
module.exports = { streamDescriptor, cacheSource, cachedSource };
