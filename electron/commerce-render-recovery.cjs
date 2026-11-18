const { commerceDocumentHash } = require('./commerce-image-document.cjs');
const { active } = require('./commerce-image-store.cjs');
async function recoverCommerceRender({ document, sizes, runId, artifactStore, reader, signal }) {
  if (sizes.length !== 1) throw Error('续存只接受已确认的单个独立版式。');
  const files = (await artifactStore.listProject(document.projectId)).filter(file => file.runId === runId); active(signal);
  if (files.length > 2 || files.some(file => file.projectId !== document.projectId || file.trashedAt || file.unavailable || !['application/json', 'image/png'].includes(file.mimeType)) || new Set(files.map(file => file.mimeType)).size !== files.length) throw Error('这版已有不同或不可用的文件，未覆盖或重新生成，请在项目中检查。');
  const json = files.find(file => file.mimeType === 'application/json'), png = files.find(file => file.mimeType === 'image/png');
  if (png && !json) throw Error('已保存的成品缺少对应图层快照，未自动补写，请检查项目文件。');
  if (json) {
    const file = await artifactStore.read(json.id); let snapshot;
    try { snapshot = JSON.parse(file.buffer.toString('utf8')); } catch { throw Error('这版已保存的图层快照无法读取，未重写原文件。'); }
    if (file.projectId !== document.projectId || file.runId !== runId || commerceDocumentHash(snapshot) !== commerceDocumentHash(document)) throw Error('已保存的目标工程与续存版式不同，未覆盖人工修改。');
  }
  if (png) { const image = await reader.read(document.projectId, png.id, signal); if (image.width !== sizes[0].width || image.height !== sizes[0].height) throw Error('已保存成品的实际尺寸与确认版式不同。'); }
  return { json, png };
}
module.exports = { recoverCommerceRender };
