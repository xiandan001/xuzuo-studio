const { createHash } = require('node:crypto');
const { imageType } = require('./image-output-formats.cjs');
const core = require('./animation-document.runtime.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function validateAnimationProof(input, { artifactStore, readAnimationDocument }) {
  const proof = input.animationExport;
  if (!proof || proof.version !== 1 || proof.projectId !== input.projectId || !Array.isArray(proof.entryIds) || !proof.entryIds.length || proof.entryIds.length > 100 || !Array.isArray(proof.sources) || proof.sources.length > 1200 || !readAnimationDocument) throw Error('动画本地导出来源无效，已有文件和费用保留。');
  const document = await readAnimationDocument(input.projectId);
  if (document.mode !== proof.mode || core.animationRenderHash(document, proof.entryIds) !== proof.renderHash) throw Error('动画本地导出与当前保存版本不一致，未更改任务状态。');
  const entries = document.entries.filter(entry => proof.entryIds.includes(entry.id)), sourceIds = new Set(entries.flatMap(entry => entry.frames.map(frame => frame.atlasArtifactId)));
  if (proof.sources.length !== sourceIds.size || new Set(proof.sources.map(row => row.artifactId)).size !== sourceIds.size) throw Error('动画源图集清单不完整。');
  for (const source of proof.sources) { if (!sourceIds.has(source.artifactId)) throw Error('动画源图不属于当前选中条目。'); const file = await artifactStore.read(source.artifactId); if (file.projectId !== input.projectId || file.trashedAt || file.unavailable || hash(file.buffer) !== source.sha256) throw Error('动画源图集已改变或不可用。'); }
  const currentIds = new Set(entries.flatMap(entry => [entry.outputArtifactId, entry.coverArtifactId]).filter(Boolean));
  if (input.artifacts.some(file => !currentIds.has(file.id))) throw Error('动画导出文件没有对应当前条目。');
  for (const artifact of input.artifacts) { const file = await artifactStore.read(artifact.id), type = imageType(file.buffer); if (proof.mode === 'gif' && artifact.id === entries.find(entry => entry.outputArtifactId === artifact.id)?.outputArtifactId && type.mimeType !== 'image/gif') throw Error('动画成品不是实际GIF。'); if (!['image/png', 'image/gif'].includes(type.mimeType)) throw Error('动画本地导出文件类型不受支持。'); }
  return { proof: { version: 1, kind: 'animation', projectId: input.projectId, animationExport: proof, files: input.artifacts.map(file => ({ id: file.id, mimeType: file.mimeType, bytes: file.bytes })) }, sourceRevision: document.revision, summary: `已在本地保存${entries.length}项${proof.mode === 'gif' ? 'GIF动画' : '角色素材'}，不调用模型；请播放检查角色、边缘与循环。` };
}
module.exports = { validateAnimationProof };
