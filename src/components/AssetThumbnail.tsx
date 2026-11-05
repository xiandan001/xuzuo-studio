import { useEffect, useRef, useState } from 'react';
import { FileText, Image, LoaderCircle, RotateCcw } from 'lucide-react';
import type { StudioAsset } from '../asset-types';
import type { ArtifactPreview } from '../live-types';
import './asset-thumbnail.css';

export function AssetThumbnail({ asset, workspaceId, onOpen }: { asset: StudioAsset; workspaceId: string; onOpen: () => void }) {
  const element = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [value, setValue] = useState<{ key: string; preview?: ArtifactPreview; error?: string; loading?: boolean }>();
  const key = `${workspaceId}/${asset.id}/${asset.archivedAt || ''}`, thumbnail = typeof window === 'undefined' ? undefined : window.desktop?.assets?.thumbnail;
  useEffect(() => {
    if (!element.current || asset.kind !== 'image' || asset.archivedAt) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(element.current); return () => observer.disconnect();
  }, [key, asset.kind]);
  useEffect(() => {
    if (!visible || asset.kind !== 'image' || asset.archivedAt || !thumbnail) return;
    let disposed = false; setValue({ key, loading: true });
    void thumbnail({ workspaceId, id: asset.id }).then(preview => { if (!preview.dataUrl || !/^data:image\/png;base64,/.test(preview.dataUrl)) throw Error('invalid thumbnail'); if (!disposed) setValue({ key, preview }); }).catch(() => { if (!disposed) setValue({ key, error: '缩略图未能读取' }); });
    return () => { disposed = true; };
  }, [key, visible, thumbnail, retry]);
  const preview = value?.key === key ? value.preview : undefined;
  const url = preview?.dataUrl && /^data:image\/png;base64,/.test(preview.dataUrl) ? preview.dataUrl : undefined;
  const width = preview?.originalWidth, height = preview?.originalHeight;
  return <div ref={element} className={`asset-own-thumbnail ${preview?.transparency === 'present' ? 'is-transparent' : ''}`}><button type="button" className="asset-thumbnail-open" aria-label={`预览素材 ${asset.name}`} disabled={!!asset.archivedAt || asset.unavailable} onClick={onOpen}>{url ? <img src={url} width={preview?.width} height={preview?.height} alt={asset.name} decoding="async" loading="lazy" /> : value?.key === key && value.loading ? <LoaderCircle size={25} className="spin" /> : asset.kind === 'image' ? <Image size={30} /> : <FileText size={30} />}</button>{asset.archivedAt ? <span>已归档，恢复后预览</span> : value?.key === key && value.error ? <button type="button" className="asset-thumbnail-retry" onClick={() => setRetry(current => current + 1)}><RotateCcw size={13} />重新读取缩略图</button> : <span>{width && height ? `${width} × ${height}` : asset.mimeType.split('/').at(-1)?.toUpperCase()}{preview?.transparency === 'present' ? ' · 含透明区域' : ''}</span>}</div>;
}
