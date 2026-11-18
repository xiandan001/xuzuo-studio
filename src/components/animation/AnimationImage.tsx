import { useEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import type { WorkflowRunner } from '../../configuration-types';
import './animation-image.css';

export function AnimationImage({ artifactId, runner, projectId = '', animated = false, alt = '' }: { artifactId?: string; runner: WorkflowRunner; projectId?: string; animated?: boolean; alt?: string }) {
  const host = useRef<HTMLSpanElement>(null), key = `${projectId}/${artifactId || ''}/${animated ? 'animated' : 'thumbnail'}`;
  const [visibleKey, setVisibleKey] = useState(''), [preview, setPreview] = useState<{ key: string; source?: string; issue?: string }>();
  useEffect(() => {
    if (!artifactId || !host.current) return;
    if (animated || typeof IntersectionObserver === 'undefined') { setVisibleKey(key); return; }
    let disposed = false;
    const observer = new IntersectionObserver(entries => { if (!disposed && entries.some(entry => entry.isIntersecting)) { setVisibleKey(key); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(host.current); return () => { disposed = true; observer.disconnect(); };
  }, [artifactId, animated, key]);
  useEffect(() => {
    if (!artifactId || visibleKey !== key) return;
    let alive = true; setPreview({ key });
    const read = animated ? runner.previewArtifact : runner.thumbnailArtifact || runner.previewArtifact;
    void read(artifactId).then(value => { if (alive) { if (!animated && value.mimeType === 'image/gif') { setPreview({ key, issue: '动态素材需选中后播放。' }); return; } if (value.dataUrl?.startsWith('data:image/')) setPreview({ key, source: value.dataUrl }); else setPreview({ key, issue: '暂时无法预览，可导出后查看。' }); } }, () => { if (alive) setPreview({ key, issue: '源文件不可读，请刷新项目文件。' }); });
    return () => { alive = false; };
  }, [artifactId, animated, key, visibleKey, runner.previewArtifact, runner.thumbnailArtifact]);
  const current = preview?.key === key ? preview : undefined;
  const note = current?.issue || (!artifactId ? '等待生成' : visibleKey === key ? '正在读取图片…' : '');
  return <span ref={host} className="animation-image" data-animation-preview={artifactId}>{current?.source ? <img src={current.source} alt={alt} loading={animated ? 'eager' : 'lazy'} draggable={false} /> : <span className="animation-image-empty"><ImageIcon size={24} />{note && <small>{note}</small>}</span>}</span>;
}
