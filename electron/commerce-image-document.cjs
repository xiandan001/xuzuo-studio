const { createHash } = require('node:crypto');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const fonts = ['Microsoft YaHei', 'Arial', 'SimSun', 'sans-serif'];
const hex = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
function checkedSize(value) {
  if (!value || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 8 || value.height < 8 || value.width > 8192 || value.height > 8192 || value.width * value.height > 16000000) throw Error('画布每边需要8–8192像素，合计不超过1600万像素。');
  return { width: value.width, height: value.height };
}
function checkedCommerceDocument(input) {
  if (!input || input.type !== 'xuzuo-commerce-image' || input.version !== 1 || !['id', 'projectId', 'sourceArtifactId'].every(key => validId(input[key])) || !/^[a-f0-9]{64}$/.test(input.sourceSha256 || '') || !Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || typeof input.updatedAt !== 'string' || input.updatedAt.length > 80 || !hex(input.background) && input.background !== 'transparent' || !Array.isArray(input.layers) || input.layers.length > 32 || input.protectedMaskArtifactId !== undefined && !validId(input.protectedMaskArtifactId) || input.protectionSourceArtifactId !== undefined && !validId(input.protectionSourceArtifactId)) throw Error('图层工程格式无效，原工程仍保留。');
  const size = checkedSize(input), seen = new Set(); let textCount = 0;
  const layers = input.layers.map(layer => {
    if (!layer || !validId(layer.id) || seen.has(layer.id) || typeof layer.name !== 'string' || layer.name.length > 80 || !['x', 'y', 'width', 'height', 'opacity'].every(key => number(layer[key])) || layer.width < 1 || layer.height < 1 || layer.width > 16384 || layer.height > 16384 || Math.abs(layer.x) > 16384 || Math.abs(layer.y) > 16384 || layer.opacity < 0 || layer.opacity > 1 || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw Error('图层位置、尺寸、透明度或编号无效。');
    seen.add(layer.id);
    const base = { id: layer.id, name: layer.name, x: layer.x, y: layer.y, width: layer.width, height: layer.height, opacity: layer.opacity, visible: layer.visible, locked: layer.locked };
    if (layer.type === 'image') {
      if (!validId(layer.artifactId) || !['product', 'background', 'logo'].includes(layer.role)) throw Error('请为图片图层选择本项目的实际图片。');
      return { ...base, type: 'image', role: layer.role, artifactId: layer.artifactId };
    }
    if (layer.type !== 'text' || typeof layer.text !== 'string' || layer.text.length > 2000 || !number(layer.fontSize) || layer.fontSize < 6 || layer.fontSize > 512 || !hex(layer.color) || !fonts.includes(layer.fontFamily) || !['normal', 'bold'].includes(layer.fontWeight) || !['left', 'center', 'right'].includes(layer.align)) throw Error('文字、字体、字号或颜色无效，每个文字层最多2000字。');
    textCount += layer.text.length;
    return { ...base, type: 'text', text: layer.text, fontSize: layer.fontSize, color: layer.color.toUpperCase(), fontFamily: layer.fontFamily, fontWeight: layer.fontWeight, align: layer.align };
  });
  if (textCount > 12000) throw Error('图层文字合计最多12000字，请拆分制作单。');
  return { type: 'xuzuo-commerce-image', version: 1, id: input.id, projectId: input.projectId, sourceArtifactId: input.sourceArtifactId, sourceSha256: input.sourceSha256, revision: input.revision, title: input.title.trim(), ...size, background: input.background === 'transparent' ? 'transparent' : input.background.toUpperCase(), layers, ...(input.protectedMaskArtifactId ? { protectedMaskArtifactId: input.protectedMaskArtifactId } : {}), ...(input.protectionSourceArtifactId ? { protectionSourceArtifactId: input.protectionSourceArtifactId } : {}), updatedAt: input.updatedAt };
}
const commerceDocumentHash = input => createHash('sha256').update(JSON.stringify(checkedCommerceDocument(input))).digest('hex');
module.exports = { validId, checkedSize, checkedCommerceDocument, commerceDocumentHash, fonts };
