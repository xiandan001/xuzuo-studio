const { createHash } = require('node:crypto');

async function assertArtifactRefinementTarget(request, artifactStore) {
  const target = request?.workflow?.sourceArtifactTarget;
  if (target === undefined) return;
  const error = message => Object.assign(Error(message), { publicMessage: message, requestStarted: false });
  if (!target || !/^[A-Za-z0-9-]{1,160}$/.test(target.id || '') || !/^[a-f0-9]{64}$/.test(target.sha256 || '')) throw error('成品版本记录无效，尚未调用模型，请重新选择成品。');
  let file;
  try { file = await artifactStore.read(target.id); } catch { throw error('选定成品已不可用，尚未调用模型，请恢复文件或重新选择。'); }
  if (file.projectId !== request.project.id || file.trashedAt || !(file.buffer instanceof Uint8Array) || createHash('sha256').update(file.buffer).digest('hex') !== target.sha256) throw error('选定成品内容或归属已变化，尚未调用模型，请重新选择成品。');
}

module.exports = { assertArtifactRefinementTarget };
