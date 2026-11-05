const { validateMarkup } = require('./image-output-formats.cjs');
async function saveImageMarkup(artifactStore, input) {
  if (!input || !/^[A-Za-z0-9-]{1,160}$/.test(input.projectId || '') || !/^[A-Za-z0-9-]{1,160}$/.test(input.sourceArtifactId || '') || typeof input.dataUrl !== 'string' || input.dataUrl.length > 45 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)) throw Error('请保存有效的本项目透明PNG标注。');
  const source = await artifactStore.read(input.sourceArtifactId);
  if (source.projectId !== input.projectId || !['image/png', 'image/jpeg', 'image/webp'].includes(source.mimeType)) throw Error('标注原图需要是本项目的PNG、JPEG或WebP。');
  const buffer = Buffer.from(input.dataUrl.split(',')[1], 'base64');
  validateMarkup({ buffer, mimeType: 'image/png' }, source);
  return artifactStore.write({ projectId: input.projectId, name: '圈画标注.png', mimeType: 'image/png', buffer });
}
module.exports = { saveImageMarkup };
