import { useEffect, useState } from 'react';
import { Image } from 'lucide-react';
import type { ArtifactMetadata } from '../../live-types';
import type { WorkflowRunner } from '../../configuration-types';

export function BusinessImagePreview({ file, runner }: { file?: ArtifactMetadata; runner: WorkflowRunner }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let alive = true; setUrl(''); if (file?.kind === 'image' && runner.thumbnailArtifact) void runner.thumbnailArtifact(file.id).then(preview => { if (alive && preview.dataUrl?.startsWith('data:image/')) setUrl(preview.dataUrl); }).catch(() => undefined); return () => { alive = false; }; }, [file?.id, runner.thumbnailArtifact]);
  return <div className="bs-image-preview">{url ? <img src={url} alt={file?.name || '选定图片'} loading="lazy" decoding="async" /> : <><Image size={28} /><span>{file?.kind === 'image' ? '缩略图暂未就绪，可打开成品检查' : file?.name || '选择图片后预览'}</span></>}</div>;
}
