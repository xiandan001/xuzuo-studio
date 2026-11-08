import type { CommerceImageDocument, CommerceImageLayer, CommerceImageRead, CommerceRasterLayer, CommerceTextLayer } from '../commerce-image-types';
const id = () => crypto.randomUUID();
export const commerceFonts = ['Microsoft YaHei', 'Arial', 'SimSun', 'sans-serif'];
export function commerceImageLayer(artifactId: string, name: string, width: number, height: number, role: CommerceRasterLayer['role'] = 'logo'): CommerceRasterLayer {
  return { id: id(), type: 'image', role, artifactId, name, x: 0, y: 0, width, height, opacity: 1, visible: true, locked: false };
}
export function commerceTextLayer(width: number, height: number, text = '输入准确的卖点或价格'): CommerceTextLayer {
  return { id: id(), name: '文字与价格', type: 'text', text, x: width * .05, y: height * .75, width: width * .9, height: height * .2, opacity: 1, visible: true, locked: false, fontSize: Math.min(512, Math.max(12, Math.round(width * .035))), color: '#17212B', fontFamily: 'Microsoft YaHei', fontWeight: 'bold', align: 'center' };
}
export function commerceInitialDocument(result: CommerceImageRead, title: string): CommerceImageDocument {
  if (result.document) return result.document;
  const width = Math.max(8, result.source.width), height = Math.max(8, result.source.height);
  return { type: 'xuzuo-commerce-image', version: 1, id: result.documentId, projectId: result.projectId, sourceArtifactId: result.sourceArtifactId, sourceSha256: result.source.sha256, revision: 0, title: title.trim().slice(0, 120) || '商品图片', width, height, background: '#FFFFFF', layers: [commerceImageLayer(result.source.id, '原图主体', result.source.width, result.source.height, 'product')], updatedAt: new Date().toISOString() };
}
export function changeCommerceLayer(document: CommerceImageDocument, layerId: string, changes: Partial<CommerceImageLayer>, force = false): CommerceImageDocument {
  const current = document.layers.find(layer => layer.id === layerId); if (!current || current.locked && !force) return document;
  return { ...document, layers: document.layers.map(layer => layer.id === layerId ? { ...layer, ...changes, id: layer.id, type: layer.type } as CommerceImageLayer : layer) };
}
export function moveCommerceLayer(document: CommerceImageDocument, layerId: string, direction: -1 | 1): CommerceImageDocument {
  const index = document.layers.findIndex(layer => layer.id === layerId), next = index + direction;
  if (index < 0 || next < 0 || next >= document.layers.length || document.layers[index].locked) return document;
  const layers = [...document.layers]; [layers[index], layers[next]] = [layers[next], layers[index]]; return { ...document, layers };
}
export function commerceDocumentIssue(document: CommerceImageDocument): string {
  if (!document.title.trim()) return '请填写图片名称。';
  if (document.layers.length > 32) return '最多32个独立图层。';
  for (const layer of document.layers) {
    if (![layer.x, layer.y, layer.width, layer.height, layer.opacity].every(Number.isFinite) || layer.width < 1 || layer.height < 1 || layer.width > 16384 || layer.height > 16384 || Math.abs(layer.x) > 16384 || Math.abs(layer.y) > 16384 || layer.opacity < 0 || layer.opacity > 1) return '图层位置、尺寸或透明度无效。';
    if (layer.type === 'text' && (layer.text.length > 2000 || !Number.isFinite(layer.fontSize) || layer.fontSize < 6 || layer.fontSize > 512 || !/^#[a-f0-9]{6}$/i.test(layer.color))) return '文字最多2000字，字号6–512，颜色需填写#RRGGBB。';
  }
  return '';
}
