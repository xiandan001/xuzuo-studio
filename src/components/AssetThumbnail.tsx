import { FileText, Image, LoaderCircle, RotateCcw } from 'lucide-react';
import type { StudioAsset } from '../asset-types';
import { useAssetThumbnail } from '../hooks/useAssetThumbnail';
import './asset-thumbnail.css';

export function AssetThumbnail({ asset, workspaceId, onOpen }: { asset: StudioAsset; workspaceId: string; onOpen: () => void }) {
  const { element, preview, loading, error, retry } = useAssetThumbnail<HTMLDivElement>(asset, workspaceId);
  const url = preview?.dataUrl;
  const width = preview?.originalWidth, height = preview?.originalHeight;
  return <div ref={element} className={`asset-own-thumbnail ${preview?.transparency === 'present' ? 'is-transparent' : ''}`}><button type="button" className="asset-thumbnail-open" aria-label={`预览素材 ${asset.name}`} disabled={!!asset.archivedAt || asset.unavailable} onClick={onOpen}>{url ? <img src={url} width={preview?.width} height={preview?.height} alt={asset.name} decoding="async" loading="lazy" /> : loading ? <LoaderCircle size={25} className="spin" /> : asset.kind === 'image' ? <Image size={30} /> : <FileText size={30} />}</button>{asset.archivedAt ? <span>已归档，恢复后预览</span> : asset.unavailable ? <span>文件不可用</span> : error ? <button type="button" className="asset-thumbnail-retry" onClick={retry}><RotateCcw size={13} />重新读取缩略图</button> : <span>{width && height ? `${width} × ${height}` : asset.mimeType.split('/').at(-1)?.toUpperCase()}{preview?.transparency === 'present' ? ' · 含透明区域' : ''}</span>}</div>;
}
