const { randomUUID } = require('node:crypto');
const { checkedCommerceDocument, checkedSize } = require('./commerce-image-document.cjs');
const round = value => Math.round(value * 1000) / 1000;
function lineCount(text, width, fontSize) {
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].reduce((total, char) => total + (/\s/.test(char) ? .35 : char.codePointAt(0) >= 0x2e80 || /[MW@#%&]/.test(char) ? 1.1 : .75), 0) * fontSize / Math.max(1, width * .94))), 0);
}
function textRegion(layers, width, budget, scale, gap) {
  let multiplier = 1, values;
  for (;;) {
    values = layers.map(layer => { const fontSize = Math.max(6, Math.min(512, layer.fontSize * scale * multiplier)); return { layer, fontSize, height: Math.ceil(lineCount(layer.text, width, fontSize) * fontSize * 1.3 + 3) }; });
    if (values.reduce((sum, item) => sum + item.height, 0) + Math.max(0, values.length - 1) * gap <= budget) return values;
    if (values.every(item => item.fontSize <= 6)) throw Error('目标尺寸无法完整容纳文案，请增大尺寸或精简文字后重新预览。');
    multiplier *= .9;
  }
}
function bounds(layers) {
  const left = Math.min(...layers.map(layer => layer.x)), top = Math.min(...layers.map(layer => layer.y));
  return { left, top, width: Math.max(...layers.map(layer => layer.x + layer.width)) - left, height: Math.max(...layers.map(layer => layer.y + layer.height)) - top };
}
function reflowCommerceDocument(input, target, { newId = randomUUID, now = () => new Date().toISOString() } = {}) {
  const source = checkedCommerceDocument(input), size = checkedSize(target), margin = Math.max(2, Math.min(128, Math.min(size.width, size.height) * .06));
  const contentWidth = size.width - margin * 2, gap = Math.max(2, margin * .35), scale = Math.min(size.width / source.width, size.height / source.height), warnings = [];
  const logos = source.layers.filter(layer => layer.type === 'image' && layer.role === 'logo' && layer.visible && layer.opacity > 0), logoSizes = new Map(logos.map(layer => { const ratio = Math.min(scale, size.width * .2 / layer.width, size.height * .12 / layer.height); return [layer.id, { width: layer.width * ratio, height: layer.height * ratio, bottom: (layer.y + layer.height / 2) / source.height > .65 }]; }));
  const logoBand = bottom => { const heights = [...logoSizes.values()].filter(value => value.bottom === bottom).map(value => value.height); return heights.length ? Math.max(...heights) + gap : 0; };
  const topLogo = logoBand(false), bottomLogo = logoBand(true);
  const text = source.layers.filter(layer => layer.type === 'text' && layer.visible && layer.opacity > 0).sort((a, b) => a.y - b.y);
  const headings = text.filter(layer => (layer.y + layer.height / 2) / source.height < .4), footers = text.filter(layer => !headings.includes(layer));
  const topText = textRegion(headings, contentWidth, Math.max(0, size.height * .28 - topLogo), scale, gap), bottomText = textRegion(footers, contentWidth, Math.max(0, size.height * .32 - bottomLogo), scale, gap);
  const heightOf = rows => rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * gap;
  const topHeight = heightOf(topText), bottomHeight = heightOf(bottomText), textChanges = new Map();
  let y = margin + topLogo;
  for (const item of topText) { textChanges.set(item.layer.id, { x: margin, y, width: contentWidth, height: item.height, fontSize: item.fontSize }); y += item.height + gap; }
  y = size.height - margin - bottomLogo - bottomHeight;
  for (const item of bottomText) { textChanges.set(item.layer.id, { x: margin, y, width: contentWidth, height: item.height, fontSize: item.fontSize }); y += item.height + gap; }
  const products = source.layers.filter(layer => layer.type === 'image' && layer.role === 'product' && layer.visible && layer.opacity > 0), productBounds = products.length ? bounds(products) : undefined;
  const productTop = margin + topLogo + topHeight + (topHeight ? gap : 0), productHeight = size.height - margin - bottomLogo - bottomHeight - (bottomHeight ? gap : 0) - productTop;
  if (productBounds && productHeight < 2) throw Error('文案占满了目标画布，请减少文字或选择更大尺寸。');
  const productScale = productBounds ? Math.min(contentWidth / productBounds.width, productHeight / productBounds.height) : 1;
  const layers = source.layers.map(layer => {
    let position;
    if (textChanges.has(layer.id)) position = textChanges.get(layer.id);
    else if (productBounds && products.includes(layer)) position = { x: margin + (contentWidth - productBounds.width * productScale) / 2 + (layer.x - productBounds.left) * productScale, y: productTop + (productHeight - productBounds.height * productScale) / 2 + (layer.y - productBounds.top) * productScale, width: layer.width * productScale, height: layer.height * productScale };
    else if (layer.type === 'image' && layer.role === 'background') { const fill = Math.max(size.width / layer.width, size.height / layer.height); if (layer.width * fill > 16384 || layer.height * fill > 16384) throw Error('背景与目标比例差距过大，请先裁剪背景或选择更接近的尺寸。'); position = { x: (size.width - layer.width * fill) / 2, y: (size.height - layer.height * fill) / 2, width: layer.width * fill, height: layer.height * fill }; }
    else if (layer.type === 'image' && layer.role === 'logo') {
      const fit = Math.min(scale, size.width * .2 / layer.width, size.height * .12 / layer.height), width = layer.width * fit, height = layer.height * fit;
      const horizontal = (layer.x + layer.width / 2) / source.width, vertical = (layer.y + layer.height / 2) / source.height;
      position = { x: horizontal < .15 ? margin : horizontal > .85 ? size.width - margin - width : Math.max(margin, Math.min(size.width - margin - width, horizontal * size.width - width / 2)), y: vertical > .65 ? size.height - margin - height : margin, width, height };
    } else position = { x: Math.max(margin, Math.min(size.width - margin - Math.min(layer.width * scale, contentWidth), layer.x / source.width * size.width)), y: Math.max(margin, Math.min(size.height - margin - Math.min(layer.height * scale, size.height - margin * 2), layer.y / source.height * size.height)), width: Math.min(layer.width * scale, contentWidth), height: Math.min(layer.height * scale, size.height - margin * 2), ...(layer.type === 'text' ? { fontSize: Math.max(6, layer.fontSize * scale) } : {}) };
    return { ...layer, id: newId(), ...Object.fromEntries(Object.entries(position).map(([key, value]) => [key, round(value)])) };
  });
  if (source.layers.some(layer => layer.x < 0 || layer.y < 0 || layer.x + layer.width > source.width || layer.y + layer.height > source.height)) warnings.push('原稿有越出画布的图层；主体与文字已重新放入安全区，背景允许裁切铺满。');
  if (source.protectedMaskArtifactId) warnings.push('新布局不沿用原位置的像素保护区；原稿与原保护区保持不变。');
  const document = checkedCommerceDocument({ ...source, id: newId(), revision: 0, title: `${source.title} · ${String(target.label || `${size.width}×${size.height}`).slice(0, 35)}`.slice(0, 120), ...size, layers, protectedMaskArtifactId: undefined, protectionSourceArtifactId: undefined, updatedAt: now() });
  return { document, warnings, safeMargin: margin };
}
function checkedReflowTargets(input) {
  if (!Array.isArray(input) || !input.length || input.length > 6) throw Error('请选择1–6个需要独立重排的尺寸。');
  const values = input.map(value => ({ ...checkedSize(value), label: String(value.label || `${value.width}×${value.height}`).slice(0, 40) }));
  if (new Set(values.map(value => `${value.width}x${value.height}`)).size !== values.length || values.reduce((sum, value) => sum + value.width * value.height, 0) > 48000000) throw Error('尺寸不能重复，合计最多4800万像素，请分批导出。');
  return values;
}
module.exports = { reflowCommerceDocument, checkedReflowTargets, lineCount };
