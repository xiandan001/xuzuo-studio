import { useEffect, useRef, useState } from 'react';
import type { StudioAsset } from '../asset-types';
import type { ArtifactPreview } from '../live-types';

export function useAssetThumbnail<T extends HTMLElement>(asset: StudioAsset, workspaceId: string) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.assets;
  const thumbnail = bridge?.thumbnail;
  const available = !asset.archivedAt && !asset.unavailable && (!bridge?.probe || asset.unavailable === false);
  const eligible = available && asset.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType);
  const availability = asset.unavailable === undefined ? 'unknown' : asset.unavailable ? 'missing' : 'available';
  const key = `${workspaceId}/${asset.id}/${asset.archivedAt || ''}/${availability}/${asset.bytes}`;
  const element = useRef<T>(null), [visibleKey, setVisibleKey] = useState(''), [retryCount, setRetryCount] = useState(0);
  const [value, setValue] = useState<{ key: string; preview?: ArtifactPreview; error?: string; loading?: boolean }>();
  useEffect(() => {
    if (!eligible || !element.current || !thumbnail) return;
    if (typeof IntersectionObserver === 'undefined') { setVisibleKey(key); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisibleKey(key); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(element.current); return () => observer.disconnect();
  }, [eligible, key, thumbnail]);
  useEffect(() => {
    if (!eligible || visibleKey !== key || !thumbnail) return;
    let disposed = false; setValue({ key, loading: true });
    void thumbnail({ workspaceId, id: asset.id }).then(preview => {
      if (!preview.dataUrl || !/^data:image\/png;base64,/.test(preview.dataUrl)) throw Error('invalid thumbnail');
      if (!disposed) setValue({ key, preview });
    }).catch(() => { if (!disposed) setValue({ key, error: '缩略图未能读取' }); });
    return () => { disposed = true; };
  }, [eligible, visibleKey, key, thumbnail, retryCount, workspaceId, asset.id]);
  const current = eligible && value?.key === key ? value : undefined;
  return { element, preview: current?.preview, loading: !!current?.loading, error: current?.error, retry: () => setRetryCount(value => value + 1) };
}
