import type { CommerceImageLayer } from '../commerce-image-types';

export type CommerceResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type LayerBounds = Pick<CommerceImageLayer, 'x' | 'y' | 'width' | 'height'>;
const MAX = 16384;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function axisBounds(position: number, size: number, direction: number) {
  const fraction = direction < 0 ? 1 : direction > 0 ? 0 : .5;
  const anchor = position + size * fraction;
  return { fraction, anchor, min: fraction ? Math.max(1, (anchor - MAX) / fraction) : 1, max: fraction ? Math.min(MAX, (anchor + MAX) / fraction) : MAX };
}

/** Pointer deltas are measured in original canvas pixels from the initial bounds. */
export function resizeCommerceLayer(layer: LayerBounds, handle: CommerceResizeHandle, delta: { x: number; y: number }, preserveRatio: boolean): LayerBounds {
  const original = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || delta.x === 0 && delta.y === 0) return original;
  const horizontal = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const vertical = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const x = axisBounds(layer.x, layer.width, horizontal), y = axisBounds(layer.y, layer.height, vertical);
  let width = horizontal ? layer.width + delta.x * horizontal : layer.width;
  let height = vertical ? layer.height + delta.y * vertical : layer.height;
  if (preserveRatio) {
    const widthScale = width / layer.width, heightScale = height / layer.height;
    const requested = horizontal && vertical ? Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale : horizontal ? widthScale : heightScale;
    const scale = clamp(requested, Math.max(x.min / layer.width, y.min / layer.height), Math.min(x.max / layer.width, y.max / layer.height));
    width = layer.width * scale; height = layer.height * scale;
  }
  width = clamp(width, x.min, x.max); height = clamp(height, y.min, y.max);
  return { x: width === layer.width ? layer.x : clamp(x.anchor - width * x.fraction, -MAX, MAX), y: height === layer.height ? layer.y : clamp(y.anchor - height * y.fraction, -MAX, MAX), width, height };
}
