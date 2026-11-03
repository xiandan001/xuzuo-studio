import { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, ImagePlus, LoaderCircle, Maximize2, WandSparkles } from 'lucide-react';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { StudioDrawer } from './StudioDrawer';

const imageUrl = (value?: string) => value && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(value) ? value : undefined;

function useImagePreview(artifactId: string | undefined, runner: WorkflowRunner, enabled = true) {
  const runnerRef = useRef(runner); runnerRef.current = runner;
  const [preview, setPreview] = useState<{ id?: string; url?: string; loading: boolean; error: boolean }>({ loading: false, error: false });
  useEffect(() => {
    if (!artifactId || !enabled) { setPreview({ loading: false, error: false }); return; }
    let current = true;
    setPreview({ id: artifactId, loading: true, error: false });
    void runnerRef.current.previewArtifact(artifactId).then(result => {
      if (!current) return;
      const url = imageUrl(result.dataUrl);
      setPreview({ id: artifactId, url, loading: false, error: !url });
    }).catch(() => { if (current) setPreview({ id: artifactId, loading: false, error: true }); });
    return () => { current = false; };
  }, [artifactId, enabled]);
  return preview.id === artifactId ? preview : { loading: Boolean(artifactId && enabled), error: false, url: undefined };
}

function ImageThumbnail({ artifact, selected, runner, onSelect, index }: { artifact: ArtifactMetadata; selected: boolean; runner: WorkflowRunner; onSelect: () => void; index: number }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const preview = useImagePreview(artifact.id, runner, visible || selected);
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

export function ImageGallery({ images, selectedId, runner, onSelect, onRefine, onSave, saving, canRefine, onImageReady, reference }: { reference?: { name: string; url?: string; loading?: boolean; error?: string }; images: ArtifactMetadata[]; selectedId?: string; runner: WorkflowRunner; onSelect: (id: string) => void; onRefine: (artifact: ArtifactMetadata) => void; onSave: (artifact: ArtifactMetadata) => void; saving: boolean; canRefine: boolean; onImageReady?: (id: string, image: HTMLImageElement) => void }) {
  const selected = images.find(image => image.id === selectedId) || images[0];
  const preview = useImagePreview(selected?.id, runner);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [selected?.id]);
  if (!selected && reference) return <section className="ig-gallery simple-result-gallery" aria-label="当前参考素材"><header className="ig-gallery-heading"><span><ImagePlus size={18} /><strong>当前参考素材</strong><small>尚未生成新结果</small></span></header><div className="ig-preview ig-preview-checker">{reference.url ? <img className="ig-main-image" style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain' }} src={reference.url} alt={reference.name} /> : <div className="ig-preview-message" role="status">{reference.loading ? <LoaderCircle size={28} className="spin" /> : <ImageIcon size={28} />}<p>{reference.loading ? '正在读取参考素材…' : reference.error || '参考素材暂时无法预览，请重新选择或检查项目文件。'}</p></div>}</div><div className="ig-selected-caption"><div><strong>{reference.name}</strong><span>修改要求后点击开始精修；选择素材本身不调用模型。</span></div></div></section>;
  return <section className="ig-gallery simple-result-gallery" aria-label="真实图片结果">
    <header className="ig-gallery-heading"><span><ImagePlus size={18} /><strong>{selected ? '当前图片结果' : '从一段描述开始'}</strong><small>{images.length ? `${images.length} 张真实图片` : '生成结果会保留在当前项目'}</small></span>{selected && preview.url && <button className="btn btn-ghost" onClick={() => setExpanded(true)}><Maximize2 size={15} />放大查看</button>}</header>
    <div className={`ig-preview ${selected ? 'ig-preview-checker' : ''}`}>
      {!selected ? <div className="ig-empty"><span><ImagePlus size={32} /></span><h2>把想法写在下方，开始第一张图片</h2><p>选择用途和模型，确认后生成。需要参考时可先添加图片。</p></div> : preview.loading ? <div className="ig-preview-message" role="status"><LoaderCircle size={28} className="spin" /><p>正在读取本机图片…</p></div> : preview.url ? <img className="ig-main-image" style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain' }} src={preview.url} alt={selected.name} onLoad={event => onImageReady?.(selected.id, event.currentTarget)} /> : <div className="ig-preview-message"><ImageIcon size={34} /><p>这张图片暂不能内置预览</p><small>可尝试另存，或检查文件与回收站。</small><button className="btn btn-secondary" onClick={() => onSave(selected)}>尝试另存</button></div>}
    </div>
    {selected && <div className="ig-selected-caption"><div><strong title={selected.name}>{selected.name}</strong><span>{selected.mimeType} · {(selected.bytes / 1024).toFixed(0)} KB</span></div><div className="simple-result-actions"><button className="btn btn-primary" disabled={!canRefine} onClick={() => onRefine(selected)}><WandSparkles size={16} />编辑图片</button><button className="btn btn-secondary" disabled={saving} onClick={() => onSave(selected)}>{saving ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}另存图片</button></div></div>}
    {images.length > 0 && <div className="simple-image-history"><h3>最近的结果</h3><div className="ig-thumbnails" aria-label="本项目图片历史">{images.map((artifact, index) => <ImageThumbnail key={artifact.id} artifact={artifact} selected={artifact.id === selected?.id} runner={runner} index={index} onSelect={() => onSelect(artifact.id)} />)}</div></div>}
    {expanded && selected && preview.url && <StudioDrawer title="查看原图" description={selected.name} onClose={() => setExpanded(false)}><div className="simple-image-lightbox"><img src={preview.url} alt={selected.name} style={{ maxWidth: '100%', maxHeight: '75dvh', objectFit: 'contain' }} /><button className="btn btn-secondary" onClick={() => onSave(selected)}><Download size={16} />另存原图</button></div></StudioDrawer>}
  </section>;
}
