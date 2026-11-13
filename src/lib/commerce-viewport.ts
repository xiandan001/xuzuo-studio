import type { CommerceImageDocument } from '../commerce-image-types';

export interface CommerceViewportSize { width: number; height: number; }
export interface CommercePreviewRegion { x: number; y: number; width: number; height: number; }
export interface CommercePreviewPlan { tileId: string; artifactId: string; region: CommercePreviewRegion; maxSide: number; }
export const COMMERCE_ZOOM_MIN = .02, COMMERCE_ZOOM_MAX = 8, COMMERCE_VIEW_PADDING = 24;
export const commerceZoom = (value: number) => Math.min(COMMERCE_ZOOM_MAX, Math.max(COMMERCE_ZOOM_MIN, Number.isFinite(value) ? value : 1));
export function commerceFitScale(viewport: CommerceViewportSize, width: number, height: number) {
  return commerceZoom(Math.min(1, Math.max(1, viewport.width - 48) / width, Math.max(1, viewport.height - 48) / height));
}
export function commerceStageGeometry(viewport: CommerceViewportSize, width: number, height: number, zoom: number) {
  const renderedWidth = width * zoom, renderedHeight = height * zoom;
  return { width: renderedWidth, height: renderedHeight, left: Math.max(COMMERCE_VIEW_PADDING, (viewport.width - renderedWidth) / 2), top: Math.max(COMMERCE_VIEW_PADDING, (viewport.height - renderedHeight) / 2), scrollWidth: Math.max(viewport.width, renderedWidth + 48), scrollHeight: Math.max(viewport.height, renderedHeight + 48) };
}
export function commerceZoomAnchor(viewport: CommerceViewportSize, width: number, height: number, from: number, to: number, scroll: { left: number; top: number }, point: { x: number; y: number }) {
  const old = commerceStageGeometry(viewport, width, height, from), next = commerceStageGeometry(viewport, width, height, to);
  const x = Math.min(width, Math.max(0, (point.x + scroll.left - old.left) / from)), y = Math.min(height, Math.max(0, (point.y + scroll.top - old.top) / from));
  return { left: Math.min(Math.max(0, next.scrollWidth - viewport.width), Math.max(0, next.left + x * to - point.x)), top: Math.min(Math.max(0, next.scrollHeight - viewport.height), Math.max(0, next.top + y * to - point.y)) };
}
export function commerceVisibleRegion(viewport: CommerceViewportSize, geometry: ReturnType<typeof commerceStageGeometry>, scroll: { left: number; top: number }, layer: { x: number; y: number; width: number; height: number }, zoom: number): CommercePreviewRegion | undefined {
  const left = geometry.left + layer.x * zoom, top = geometry.top + layer.y * zoom, width = layer.width * zoom, height = layer.height * zoom;
  const viewLeft = Math.max(scroll.left, geometry.left), viewTop = Math.max(scroll.top, geometry.top), viewRight = Math.min(scroll.left + viewport.width, geometry.left + geometry.width), viewBottom = Math.min(scroll.top + viewport.height, geometry.top + geometry.height);
  if (viewRight <= viewLeft || viewBottom <= viewTop) return undefined;
  const x = Math.max(0, (viewLeft - left) / width), y = Math.max(0, (viewTop - top) / height), right = Math.min(1, (viewRight - left) / width), bottom = Math.min(1, (viewBottom - top) / height);
  if (right <= x || bottom <= y) return undefined;
  // A small overscan avoids requesting new image bytes for every scroll pixel.
  const padX = Math.min(.06, (right - x) * .15), padY = Math.min(.06, (bottom - y) * .15), rx = Math.max(0, x - padX), ry = Math.max(0, y - padY);
  return { x: rx, y: ry, width: Math.min(1, right + padX) - rx, height: Math.min(1, bottom + padY) - ry };
}
export function commercePreviewPlans(document: CommerceImageDocument, viewport: CommerceViewportSize, zoom: number, scroll: { left: number; top: number }, dpr: number, selectedId: string, mask?: { artifactId: string; width: number; height: number }) {
  const geometry = commerceStageGeometry(viewport, mask?.width || document.width, mask?.height || document.height, zoom);
  const items = mask ? [{ artifactId: mask.artifactId, tileId: 'mask:base', id: '', x: 0, y: 0, width: mask.width, height: mask.height }] : document.layers.filter(layer => layer.type === 'image' && layer.visible && layer.opacity > 0).sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)).map(layer => ({ ...layer, tileId: `layer:${layer.id}`, artifactId: layer.type === 'image' ? layer.artifactId : '' }));
  const extra = !mask ? [document.protectionSourceArtifactId].filter((id): id is string => !!id).map(artifactId => ({ artifactId, tileId: 'protected:base', id: '', x: 0, y: 0, width: document.width, height: document.height })) : [];
  const plans: CommercePreviewPlan[] = [];
  for (const layer of [...extra, ...items]) {
    const region = commerceVisibleRegion(viewport, geometry, scroll, layer, zoom); if (!region) continue;
    const side = Math.max(layer.width * region.width, layer.height * region.height) * zoom * Math.min(2, Math.max(1, dpr));
    if (side <= 400 && region.width > .95 && region.height > .95) continue;
    plans.push({ tileId: layer.tileId, artifactId: layer.artifactId, region, maxSide: side > 1280 ? 2048 : side > 768 ? 1280 : 768 });
    if (plans.length >= 8) break;
  }
  return plans;
}
