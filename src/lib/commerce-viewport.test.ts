import { describe, expect, it } from 'vitest';
import { commerceFitScale, commercePreviewPlans, commerceStageGeometry, commerceVisibleRegion, commerceZoom, commerceZoomAnchor } from './commerce-viewport';
import type { CommerceImageDocument } from '../commerce-image-types';

describe('清晰编辑视口的缩放和裁片坐标', () => {
  it('首次适应视口并完整保留边距，100%按源图坐标展示而不修改文档', () => {
    const viewport = { width: 848, height: 600 }, scale = commerceFitScale(viewport, 3840, 2160), geometry = commerceStageGeometry(viewport, 3840, 2160, scale);
    expect(scale).toBeCloseTo(800 / 3840); expect(geometry.width).toBeCloseTo(800); expect(geometry.height).toBeLessThan(552); expect(geometry.scrollWidth).toBe(848);
    expect(commerceStageGeometry(viewport, 3840, 2160, 1).width).toBe(3840); expect(commerceZoom(Infinity)).toBe(1); expect(commerceZoom(.0001)).toBe(.02); expect(commerceZoom(100)).toBe(8);
  });
  it('放大与缩小保持鼠标指向的原图位置，不以左上角跳转', () => {
    const viewport = { width: 800, height: 600 }, point = { x: 380, y: 260 }, scroll = { left: 440, top: 160 }, from = .5, to = 1.25;
    const a = commerceStageGeometry(viewport, 3840, 2160, from), moved = commerceZoomAnchor(viewport, 3840, 2160, from, to, scroll, point), b = commerceStageGeometry(viewport, 3840, 2160, to);
    expect((point.x + moved.left - b.left) / to).toBeCloseTo((point.x + scroll.left - a.left) / from);
    expect((point.y + moved.top - b.top) / to).toBeCloseTo((point.y + scroll.top - a.top) / from);
  });
  it('只规划可见区域、按DPR选有限清晰档位，最多八张并优先选中图层', () => {
    const viewport = { width: 800, height: 600 }, geometry = commerceStageGeometry(viewport, 3840, 2160, 1), scroll = { left: 1100, top: 500 };
    const region = commerceVisibleRegion(viewport, geometry, scroll, { x: 0, y: 0, width: 3840, height: 2160 }, 1)!;
    expect(region.x).toBeGreaterThan(0); expect(region.width).toBeLessThan(.3); expect(region.height).toBeLessThan(.4);
    const document = { width: 3840, height: 2160, layers: Array.from({ length: 12 }, (_, index) => ({ id: 'layer-' + index, type: 'image', artifactId: 'image-' + index, x: 0, y: 0, width: 3840, height: 2160, visible: true, opacity: 1 })) } as unknown as CommerceImageDocument;
    const before = JSON.stringify(document), plans = commercePreviewPlans(document, viewport, 1, scroll, 2, 'layer-11');
    expect(plans).toHaveLength(8); expect(plans[0].artifactId).toBe('image-11'); expect(plans.every(plan => plan.maxSide <= 2048 && plan.region.width < 1)).toBe(true); expect(JSON.stringify(document)).toBe(before);
  });
  it('视口外的小图层不会触发后台图片请求', () => {
    const document = { width: 3840, height: 2160, layers: [{ id: 'far', type: 'image', artifactId: 'logo', x: 3600, y: 1800, width: 100, height: 100, visible: true, opacity: 1 }] } as unknown as CommerceImageDocument;
    expect(commercePreviewPlans(document, { width: 800, height: 600 }, 1, { left: 0, top: 0 }, 2, '')).toEqual([]);
  });
  it('画布外的图层即使落在视口空白区，也不会触发裁片请求', () => {
    const document = { width: 200, height: 200, layers: [{ id: 'outside', type: 'image', artifactId: 'logo', x: 220, y: 0, width: 100, height: 100, visible: true, opacity: 1 }] } as unknown as CommerceImageDocument;
    expect(commercePreviewPlans(document, { width: 800, height: 600 }, 1, { left: 0, top: 0 }, 2, '')).toEqual([]);
  });
  it('同一素材用作小角标和4K背景时，各自保留区域和清晰度，不被角标768px档位覆盖', () => {
    const common = { type: 'image', artifactId: 'same-original', visible: true, opacity: 1 };
    const document = { width: 3840, height: 2160, layers: [{ ...common, id: 'background', x: 0, y: 0, width: 3840, height: 2160 }, { ...common, id: 'badge', x: 100, y: 100, width: 300, height: 170 }] } as unknown as CommerceImageDocument;
    const plans = commercePreviewPlans(document, { width: 800, height: 600 }, 1, { left: 0, top: 0 }, 2, 'badge');
    expect(plans).toHaveLength(2); expect(plans[0]).toMatchObject({ tileId: 'layer:badge', artifactId: 'same-original', maxSide: 768 });
    expect(plans[1]).toMatchObject({ tileId: 'layer:background', artifactId: 'same-original', maxSide: 2048 }); expect(plans[1].region.width).toBeLessThan(plans[0].region.width);
  });
});
