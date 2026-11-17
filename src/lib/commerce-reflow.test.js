import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { reflowCommerceDocument, checkedReflowTargets } = require('../../electron/commerce-reflow.cjs');
const base = (id, x, y, width, height) => ({ id, name: id, x, y, width, height, opacity: 1, visible: true, locked: false });
function document() { return { type: 'xuzuo-commerce-image', version: 1, id: 'original-layout', projectId: 'project', sourceArtifactId: 'original-image', sourceSha256: 'a'.repeat(64), revision: 3, title: '商用品宣', width: 400, height: 400, background: 'transparent', updatedAt: '2026-11-17T00:00:00Z', layers: [
  { ...base('background', -20, -10, 440, 420), type: 'image', role: 'background', artifactId: 'background' },
  { ...base('product', 100, 100, 160, 220), type: 'image', role: 'product', artifactId: 'original-image' },
  { ...base('logo', 20, 12, 60, 30), type: 'image', role: 'logo', artifactId: 'logo' },
  { ...base('title', 20, 48, 360, 40), type: 'text', text: '真实商品与明确标题', fontSize: 24, fontFamily: 'Microsoft YaHei', fontWeight: 'bold', color: '#17212B', align: 'center' },
  { ...base('price', 20, 350, 360, 36), type: 'text', text: '准确售价 99 元', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', color: '#17212B', align: 'left' },
] }; }
describe('真实图层多比例重排', () => {
  it.each([[320, 320], [240, 320], [256, 320], [180, 320], [320, 180], [300, 200]])('%ix%i 保留主体比例并把文字/Logo放进安全区，而非整图缩放留边', (width, height) => {
    const original = document(), before = structuredClone(original), result = reflowCommerceDocument(original, { width, height, label: '目标' });
    expect(original).toEqual(before); expect([result.document.width, result.document.height]).toEqual([width, height]); expect(result.document.id).not.toBe(original.id);
    const product = result.document.layers.find(layer => layer.type === 'image' && layer.role === 'product'), logo = result.document.layers.find(layer => layer.type === 'image' && layer.role === 'logo'), title = result.document.layers.find(layer => layer.type === 'text' && layer.text.includes('标题'));
    expect(product.width / product.height).toBeCloseTo(160 / 220, 3); expect(logo.width / logo.height).toBeCloseTo(2, 3); expect(title.y).toBeGreaterThanOrEqual(logo.y + logo.height);
    for (const layer of result.document.layers.filter(layer => layer.type === 'text' || layer.role !== 'background')) { expect(layer.x).toBeGreaterThanOrEqual(result.safeMargin - .01); expect(layer.y).toBeGreaterThanOrEqual(result.safeMargin - .01); expect(layer.x + layer.width).toBeLessThanOrEqual(width - result.safeMargin + .01); expect(layer.y + layer.height).toBeLessThanOrEqual(height - result.safeMargin + .01); }
    expect(result.document.layers.some(layer => original.layers.some(old => old.id === layer.id))).toBe(false); expect(result.warnings.join('')).toContain('越出画布');
  });
  it('长文本保持完整并换行/缩字号，无法容纳时明确拒绝，不截断内容', () => {
    const original = document(); original.layers = original.layers.filter(layer => layer.id !== 'title'); original.layers.find(layer => layer.id === 'price').text = '真实明确的完整说明'.repeat(25);
    const result = reflowCommerceDocument(original, { width: 640, height: 960 }); expect(result.document.layers.find(layer => layer.type === 'text').text).toBe(original.layers.find(layer => layer.type === 'text').text);
    expect(() => reflowCommerceDocument(original, { width: 8, height: 8 })).toThrow(/尺寸|文字|文案/);
  });
  it('保留原稿保护区，派生版明确提示不沿用旧坐标蒙版', () => { const original = { ...document(), protectedMaskArtifactId: 'mask', protectionSourceArtifactId: 'baseline' }, result = reflowCommerceDocument(original, { width: 320, height: 180 }); expect(original.protectedMaskArtifactId).toBe('mask'); expect(result.document.protectedMaskArtifactId).toBeUndefined(); expect(result.warnings.join('')).toContain('像素保护区'); });
  it('限制重复、像素和目标数量，接受六种独立尺寸', () => { expect(checkedReflowTargets([[320, 320], [240, 320], [256, 320], [180, 320], [320, 180], [300, 200]].map(([width, height]) => ({ width, height })))).toHaveLength(6); expect(() => checkedReflowTargets([{ width: 100, height: 100 }, { width: 100, height: 100 }])).toThrow('重复'); expect(() => checkedReflowTargets(Array.from({ length: 7 }, (_, i) => ({ width: 100 + i, height: 100 })))).toThrow('1–6'); expect(() => checkedReflowTargets([{ width: 8192, height: 8192 }])).toThrow('1600万'); });
});
