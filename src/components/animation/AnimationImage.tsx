import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import type { WorkflowRunner } from '../../configuration-types';

export function AnimationImage({ artifactId, runner, animated = false, alt = '' }: { artifactId?: string; runner: WorkflowRunner; animated?: boolean; alt?: string }) {
  const [source, setSource] = useState(''), [issue, setIssue] = useState('');
  useEffect(() => {
    let alive = true; setSource(''); setIssue('');
    if (!artifactId) return;
    const read = animated ? runner.previewArtifact : runner.thumbnailArtifact || runner.previewArtifact;
    void read(artifactId).then(value => { if (alive) { if (!animated && value.mimeType === 'image/gif') { setIssue('动态素材需选中后播放。'); return; } if (value.dataUrl?.startsWith('data:image/')) setSource(value.dataUrl); else setIssue('暂时无法预览，可导出后查看。'); } }, () => { if (alive) setIssue('源文件不可读，请刷新项目文件。'); });
    return () => { alive = false; };
  }, [artifactId, animated, runner.previewArtifact, runner.thumbnailArtifact]);
  return source ? <img src={source} alt={alt} loading="lazy" draggable={false} /> : <span className="animation-image-empty"><ImageIcon size={24} /><small>{issue || '等待生成'}</small></span>;
}
