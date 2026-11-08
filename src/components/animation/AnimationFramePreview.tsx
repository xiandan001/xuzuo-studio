import { useEffect, useRef, useState } from 'react';
import type { AnimationFrame } from '../../animation-types';
import type { WorkflowRunner } from '../../configuration-types';
import type { ArtifactPreview } from '../../live-types';
import { animationError } from './animation-ui';
import './animation-frame-preview.css';

export function AnimationFramePreview({ frame, index, runner, hidden = false }: { frame: AnimationFrame; index: number; runner: WorkflowRunner; hidden?: boolean }) {
  const [source, setSource] = useState<{ id: string; value: ArtifactPreview }>(), [dimensions, setDimensions] = useState({ id: '', width: 0, height: 0 }), [issue, setIssue] = useState(''), [reload, setReload] = useState(0);
  const epoch = useRef(0), request = useRef<{ id: string; promise: Promise<ArtifactPreview> } | undefined>(undefined), currentId = useRef(frame.atlasArtifactId); currentId.current = frame.atlasArtifactId;
  useEffect(() => {
    const ticket = ++epoch.current, id = frame.atlasArtifactId; setIssue(''); setDimensions({ id: '', width: 0, height: 0 });
    if (request.current?.id !== id) request.current = { id, promise: runner.previewArtifact(id) };
    void request.current.promise.then(value => { if (ticket !== epoch.current) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType) || !value.dataUrl?.startsWith('data:image/')) throw Error('源画面需要可读取的 PNG、JPEG 或 WebP 静态图片。'); setSource({ id, value }); }).catch(cause => { if (ticket === epoch.current) { request.current = undefined; setIssue(animationError(cause)); } });
    return () => { epoch.current++; };
  }, [frame.atlasArtifactId, runner.previewArtifact, reload]);
  const loaded = source?.id === frame.atlasArtifactId, natural = dimensions.id === frame.atlasArtifactId && dimensions.width > 0 && dimensions.height > 0;
  const cellNumber = frame.cell[1] * frame.grid[0] + frame.cell[0] + 1;
  const box = frame.crop && natural ? { left: frame.crop[0] / dimensions.width * 100, top: frame.crop[1] / dimensions.height * 100, width: (frame.crop[2] - frame.crop[0]) / dimensions.width * 100, height: (frame.crop[3] - frame.crop[1]) / dimensions.height * 100 } : { left: frame.cell[0] / frame.grid[0] * 100, top: frame.cell[1] / frame.grid[1] * 100, width: 100 / frame.grid[0], height: 100 / frame.grid[1] };
  const outside = !!frame.crop && natural && (frame.crop[2] > dimensions.width || frame.crop[3] > dimensions.height);
  return <section className="animation-frame-source" hidden={hidden} aria-label="选中关键帧源图定位"><header><strong>当前源关键画面 · 第 {index + 1} 帧</strong><small>{frame.grid[0]} × {frame.grid[1]} 图集，第 {cellNumber} 格。AI 局部修复只改此选中帧。</small></header>{issue ? <div><p role="alert">{issue}请刷新工程或重新选择可用源稿。</p><button type="button" className="text-button" onClick={() => { request.current = undefined; setReload(value => value + 1); }}>重新读取这一张源图</button></div> : loaded ? <div className="animation-source-atlas"><img key={frame.atlasArtifactId} data-source-id={frame.atlasArtifactId} src={source?.value.dataUrl} alt="当前源图集，框内为选中关键画面" draggable={false} onLoad={event => { const image = event.currentTarget; if (image.dataset.sourceId === currentId.current) setDimensions({ id: currentId.current, width: image.naturalWidth, height: image.naturalHeight }); }} />{(!frame.crop || natural) && <span className="animation-source-highlight" role="img" aria-label={frame.crop ? '选中原图集绝对裁切区域' : `选中图集第 ${cellNumber} 格`} style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }} />}</div> : <p role="status">正在读取当前这一张源图…</p>}{outside && <p role="alert">裁切框超出原图范围，请调整原图集的右、下边界。</p>}<small>高亮框用于定位。播放合成 GIF 不会清除当前选帧；裁切应用后框会更新。</small></section>;
}
