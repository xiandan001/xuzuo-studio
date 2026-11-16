import { describe, expect, it } from 'vitest';
import type { CommerceImageDocument, CommerceImageLayer, CommerceTextLayer } from '../commerce-image-types';
import { commerceDocumentIssue } from './commerce-image';
import { resizeCommerceLayer, type CommerceResizeHandle } from './commerce-layer-transform';

const base = Object.freeze({ x: 10, y: 20, width: 200, height: 100 });

describe('图层八向拖动缩放', () => {
  it.each([
    ['se', { x: 40, y: 30 }, { x: 10, y: 20, width: 240, height: 130 }],
    ['nw', { x: 30, y: 20 }, { x: 40, y: 40, width: 170, height: 80 }],
    ['ne', { x: 40, y: -20 }, { x: 10, y: 0, width: 240, height: 120 }],
    ['sw', { x: -30, y: 20 }, { x: -20, y: 20, width: 230, height: 120 }],
    ['n', { x: 90, y: -20 }, { x: 10, y: 0, width: 200, height: 120 }],
    ['e', { x: -40, y: 90 }, { x: 10, y: 20, width: 160, height: 100 }],
    ['s', { x: 90, y: 20 }, { x: 10, y: 20, width: 200, height: 120 }],
    ['w', { x: 30, y: 90 }, { x: 40, y: 20, width: 170, height: 100 }],
  ] as const)('%s 自由缩放固定相对边，边框拖动忽略另一方向', (handle, delta, expected) => {
    expect(resizeCommerceLayer(base, handle, delta, false)).toEqual(expected);
  });

  it('图片角点锁定比例，由变化更大的轴驱动并固定对角', () => {
    expect(resizeCommerceLayer(base, 'se', { x: 100, y: 10 }, true)).toEqual({ x: 10, y: 20, width: 300, height: 150 });
    expect(resizeCommerceLayer(base, 'nw', { x: 50, y: 25 }, true)).toEqual({ x: 60, y: 45, width: 150, height: 75 });
    expect(resizeCommerceLayer(base, 'se', { x: 10, y: 100 }, true)).toEqual({ x: 10, y: 20, width: 400, height: 200 });
  });

  it('图片边框锁定比例，固定相对边且另一方向围绕中心缩放', () => {
    expect(resizeCommerceLayer(base, 'e', { x: 100, y: 0 }, true)).toEqual({ x: 10, y: -5, width: 300, height: 150 });
    expect(resizeCommerceLayer(base, 'n', { x: 0, y: 50 }, true)).toEqual({ x: 60, y: 70, width: 100, height: 50 });
  });

  it('拖过对边时保留最小尺寸，不翻转图层', () => {
    expect(resizeCommerceLayer(base, 'nw', { x: 1000, y: 1000 }, false)).toEqual({ x: 209, y: 119, width: 1, height: 1 });
    expect(resizeCommerceLayer(base, 'nw', { x: 1000, y: 1000 }, true)).toEqual({ x: 208, y: 119, width: 2, height: 1 });
  });

  it('零移动保留原始小数，文本框尺寸变化不修改文字或字号', () => {
    const layer: CommerceTextLayer = { id: 'text', name: '文字', type: 'text', x: 330.67, y: 240.13, width: 200.1, height: 100.3, opacity: 1, visible: true, locked: false, text: '保留内容', fontSize: 24, fontFamily: 'Arial', fontWeight: 'normal', align: 'left', color: '#000000' };
    expect(resizeCommerceLayer(layer, 'nw', { x: 0, y: 0 }, false)).toEqual({ x: layer.x, y: layer.y, width: layer.width, height: layer.height });
    const changed = { ...layer, ...resizeCommerceLayer(layer, 'se', { x: 50, y: 20 }, false) };
    expect(changed).toMatchObject({ width: 250.1, height: 120.3, fontSize: 24, text: '保留内容' });
    expect(base).toEqual({ x: 10, y: 20, width: 200, height: 100 });
  });

  it('到达坐标边界时同时限制尺寸并保留相对锚点', () => {
    expect(resizeCommerceLayer({ x: 0, y: -16380, width: 200, height: 100 }, 'n', { x: 0, y: -500 }, false)).toEqual({ x: 0, y: -16384, width: 200, height: 104 });
    expect(resizeCommerceLayer({ x: 16384, y: 0, width: 16384, height: 100 }, 'w', { x: 500, y: 0 }, false)).toEqual({ x: 16384, y: 0, width: 16384, height: 100 });
  });

  it('各方向极端拖动仍符合已有文档尺寸及坐标约束', () => {
    const handles: CommerceResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const handle of handles) for (const preserveRatio of [true, false]) for (const amount of [-100000, 100000]) {
      const layer: CommerceImageLayer = { id: 'image', name: '图片', type: 'image', role: 'logo', artifactId: 'source', ...base, opacity: 1, visible: true, locked: false };
      const bounds = resizeCommerceLayer(layer, handle, { x: amount, y: amount }, preserveRatio);
      const document = { title: '尺寸校验', layers: [{ ...layer, ...bounds }] } as CommerceImageDocument;
      expect(commerceDocumentIssue(document)).toBe('');
      if (preserveRatio) expect(bounds.width / bounds.height).toBeCloseTo(base.width / base.height);
    }
  });
});
