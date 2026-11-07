import { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, ImagePlus, LoaderCircle, Maximize2, WandSparkles } from 'lucide-react';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import { StudioDrawer } from './StudioDrawer';

export interface NativeImagePreviewMetadata { width: number; height: number; transparency: 'present' | 'unknown'; }
interface ImagePreviewState { id?: string; url?: string; loading: boolean; error: boolean; thumbnail?: boolean; metadata?: NativeImagePreviewMetadata; }

const imageUrl = (value?: string) => value && /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/.test(value) ? value : undefined;
async function staticThumbnail(url: string): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Error('图片缩略图无法读取。')); image.src = url; });
  const ratio = Math.min(1, 320 / image.naturalWidth, 320 / image.naturalHeight), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d'); if (!context) throw Error('无法创建图片缩略图。'); context.drawImage(image, 0, 0, canvas.width, canvas.height); image.src = ''; return canvas.toDataURL('image/png');
}

function useImagePreview(artifactId: string | undefined, runner: WorkflowRunner, enabled = true, thumbnail = false, sourceMimeType?: string) {
  const runnerRef = useRef(runner); runnerRef.current = runner;
  const [preview, setPreview] = useState<ImagePreviewState>({ loading: false, error: false });
  useEffect(() => {
    if (!artifactId || !enabled) { setPreview({ loading: false, error: false }); return; }
    let current = true;
    setPreview({ id: artifactId, loading: true, error: false });
    const currentRunner = runnerRef.current;
    void (async () => {
      let usedThumbnail = false;
      const canFallback = !thumbnail && ['image/png', 'image/jpeg', 'image/webp'].includes(sourceMimeType || '') && currentRunner.thumbnailArtifact;
      const read = thumbnail && currentRunner.thumbnailArtifact ? currentRunner.thumbnailArtifact : currentRunner.previewArtifact;
      let result: ArtifactPreview;
      try { result = await read(artifactId); }
      catch (error) {
        if (!current) return;
        if (thumbnail) result = await currentRunner.previewArtifact(artifactId);
        else if (canFallback) { usedThumbnail = true; result = await canFallback(artifactId); }
        else throw error;
      }
      if (!current) return;
      if (!imageUrl(result.dataUrl) && canFallback && !usedThumbnail) { usedThumbnail = true; result = await canFallback(artifactId); }
      if (!current) return;
      let url = imageUrl(result.dataUrl);
      if (usedThumbnail && (result.mimeType !== 'image/png' || !url?.startsWith('data:image/png;base64,'))) throw Error('缩略预览暂不可用。');
      if (thumbnail && url && /^data:image\/(?:gif|svg\+xml);/.test(url)) url = await staticThumbnail(url);
      if (!current) return;
      const width = result.originalWidth, height = result.originalHeight;
      const metadata = Number.isSafeInteger(width) && Number.isSafeInteger(height) && width! > 0 && height! > 0 && width! * height! <= 67_108_864 ? { width: width!, height: height!, transparency: result.transparency === 'present' ? 'present' as const : 'unknown' as const } : undefined;
      setPreview({ id: artifactId, url, loading: false, error: !url, thumbnail: usedThumbnail || result.thumbnail, metadata });
    })().catch(() => { if (current) setPreview({ id: artifactId, loading: false, error: true }); });
    return () => { current = false; };
  }, [artifactId, enabled, thumbnail, sourceMimeType]);
  return preview.id === artifactId ? preview : { loading: Boolean(artifactId && enabled), error: false } as ImagePreviewState;
}

function ImageThumbnail({ artifact, selected, runner, onSelect, index }: { artifact: ArtifactMetadata; selected: boolean; runner: WorkflowRunner; onSelect: () => void; index: number }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const preview = useImagePreview(artifact.id, runner, visible || selected, true);
  useEffect(() => {
    if (!buttonRef.current) return;
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '120px' });
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, []);
  return <button ref={buttonRef} type="button" className={`ig-thumbnail ${selected ? 'is-selected' : ''}`} aria-pressed={selected} aria-label={`选择图片 ${index + 1}：${artifact.name}`} onClick={onSelect}>
    {preview.url ? <img src={preview.url} alt={artifact.name} /> : <ImageIcon size={24} />}
    <span><strong>图片 {index + 1}</strong><small title={artifact.name}>{artifact.name}</small></span>
  </button>;
}

export function ImageGallery({ images, selectedId, runner, onSelect, onRefine, onSave, saving, canRefine, onImageReady, onMetadataReady, reference, hideActions = false, showHistory = true, onCreate }: { reference?: { name: string; url?: string; loading?: boolean; error?: string }; images: ArtifactMetadata[]; selectedId?: string; runner: WorkflowRunner; onSelect: (id: string) => void; onRefine: (artifact: ArtifactMetadata) => void; onSave: (artifact: ArtifactMetadata) => void; saving: boolean; canRefine: boolean; onImageReady?: (id: string, image: HTMLImageElement) => void; onMetadataReady?: (id: string, metadata: NativeImagePreviewMetadata) => void; hideActions?: boolean; showHistory?: boolean; onCreate?: () => void }) {
  const selected = images.find(image => image.id === selectedId) || images[0];
  const preview = useImagePreview(selected?.id, runner, true, false, selected?.mimeType);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [selected?.id]);
  useEffect(() => { if (selected && preview.id === selected.id && preview.thumbnail && preview.metadata && !preview.loading) onMetadataReady?.(selected.id, preview.metadata); }, [selected?.id, preview.id, preview.thumbnail, preview.metadata, preview.loading, onMetadataReady]);
  if (!selected && reference) return <section className="ig-gallery simple-result-gallery" aria-label="当前参考素材"><header className="ig-gallery-heading"><span><ImagePlus size={18} /><strong>当前参考素材</strong><small>尚未生成新结果</small></span></header><div className="ig-preview ig-preview-checker">{reference.url ? <img className="ig-main-image" style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain' }} src={reference.url} alt={reference.name} /> : <div className="ig-preview-message" role="status">{reference.loading ? <LoaderCircle size={28} className="spin" /> : <ImageIcon size={28} />}<p>{reference.loading ? '正在读取参考素材…' : reference.error || '参考素材暂时无法预览，请重新选择或检查项目文件。'}</p></div>}</div><div className="ig-selected-caption"><div><strong>{reference.name}</strong><span>修改要求后点击开始精修；选择素材本身不调用模型。</span></div></div></section>;
  return <section className="ig-gallery simple-result-gallery" aria-label="真实图片结果">
    <header className="ig-gallery-heading"><span><ImagePlus size={18} /><strong>{selected ? '当前图片结果' : '从一段描述开始'}</strong><small>{images.length ? `${images.length} 张真实图片` : '生成结果会保留在当前项目'}</small></span>{selected && preview.url && <button className="btn btn-ghost" onClick={() => setExpanded(true)}><Maximize2 size={15} />{preview.thumbnail ? '放大缩略图' : '放大查看'}</button>}</header>
    <div className={`ig-preview ${selected ? 'ig-preview-checker' : ''}`}>
      {!selected ? <div className="ig-empty"><span><ImagePlus size={32} /></span><h2>从一个想法，开始第一张图片</h2><p>在 AI 创作面板说明用途与画面；需要参考时可先添加素材。</p>{onCreate && <button type="button" className="btn btn-primary" onClick={onCreate}>打开创作输入</button>}</div> : preview.loading ? <div className="ig-preview-message" role="status"><LoaderCircle size={28} className="spin" /><p>正在读取本机图片…</p></div> : preview.url ? <img className="ig-main-image" style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain' }} src={preview.url} alt={selected.name} onLoad={event => { if (!preview.thumbnail) onImageReady?.(selected.id, event.currentTarget); }} /> : <div className="ig-preview-message"><ImageIcon size={34} /><p>这张图片暂不能内置预览</p><small>可尝试另存，或检查文件与回收站。</small><button className="btn btn-secondary" onClick={() => onSave(selected)}>尝试另存</button></div>}
    </div>
    {selected && <div className="ig-selected-caption"><div><strong title={selected.name}>{selected.name}</strong><span>{selected.mimeType} · {(selected.bytes / 1024).toFixed(0)} KB</span>{preview.thumbnail && <span role="status">缩略预览，原尺寸文件仍可另存</span>}</div>{!hideActions && <div className="simple-result-actions"><button className="btn btn-primary" disabled={!canRefine} onClick={() => onRefine(selected)}><WandSparkles size={16} />编辑图片</button><button className="btn btn-secondary" disabled={saving} onClick={() => onSave(selected)}>{saving ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}另存图片</button></div>}</div>}
    {showHistory && images.length > 0 && <div className="simple-image-history"><h3>最近的结果</h3><div className="ig-thumbnails" aria-label="本项目图片历史">{images.map((artifact, index) => <ImageThumbnail key={artifact.id} artifact={artifact} selected={artifact.id === selected?.id} runner={runner} index={index} onSelect={() => onSelect(artifact.id)} />)}</div></div>}
    {expanded && selected && preview.url && <StudioDrawer title={preview.thumbnail ? '查看缩略图' : '查看原图'} description={selected.name} onClose={() => setExpanded(false)}><div className="simple-image-lightbox"><img src={preview.url} alt={selected.name} style={{ maxWidth: '100%', maxHeight: '75dvh', objectFit: 'contain' }} /><button className="btn btn-secondary" onClick={() => onSave(selected)}><Download size={16} />另存原图</button></div></StudioDrawer>}
  </section>;
}

export function ImageHistoryNavigation({ images, selectedId, runner, onSelect }: { images: ArtifactMetadata[]; selectedId?: string; runner: WorkflowRunner; onSelect: (id: string) => void }) {
  return <nav className="sw-content-nav sw-image-navigation" aria-label="本项目图片历史">{images.length ? images.map((artifact, index) => <ImageThumbnail key={artifact.id} artifact={artifact} selected={artifact.id === selectedId} runner={runner} index={index} onSelect={() => onSelect(artifact.id)} />) : <p className="sw-placeholder">还没有生成结果。首张图片完成后会显示在这里。</p>}</nav>;
}
