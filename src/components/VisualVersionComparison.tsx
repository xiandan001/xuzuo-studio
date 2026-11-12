import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Columns2, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import type { ComparableDocument } from '../lib/version-comparison';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRunner } from '../configuration-types';
import { EDITOR_THEMES } from '../lib/editor-document';
import { Select } from './Select';
import { ModalPortal } from './ModalPortal';
import './visual-version-comparison.css';

function useVersionImage(id?: string, read?: WorkflowRunner['previewArtifact']) {
  const [state, setState] = useState<{ id: string; url?: string; error?: string }>();
  useEffect(() => {
    if (!id) return;
    let current = true; setState({ id });
    const reader = read || window.desktop?.runtime?.thumbnailArtifact || window.desktop?.runtime?.previewArtifact;
    if (!reader) { setState({ id, error: '请在桌面应用中读取图片。' }); return; }
    void reader(id).then(value => { if (current) setState({ id, ...(/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(value.dataUrl || '') ? { url: value.dataUrl } : { error: '图片暂无安全预览，请保留原文件。' }) }); }).catch(() => { if (current) setState({ id, error: '图片暂时无法读取，原版本未修改。' }); });
    return () => { current = false; };
  }, [id, read]);
  return state?.id === id ? state : undefined;
}
function ComparisonImage({ id, read, label }: { id?: string; read?: WorkflowRunner['previewArtifact']; label: string }) {
  const state = useVersionImage(id, read);
  return <PreparedComparisonImage id={id} state={state} label={label} />;
}
function PreparedComparisonImage({ id, state, label }: { id?: string; state?: { url?: string; error?: string }; label: string }) {
  return <div className="vvc-picture">{!id ? <span><ImageIcon size={24} />此版本没有插图</span> : state?.url ? <img src={state.url} alt={label} loading="lazy" decoding="async" /> : <span>{state?.error || <><LoaderCircle size={20} className="spin" />正在读取图片…</>}</span>}</div>;
}
export function ImageCompareSurface({ firstId, secondId, read, firstLabel = '当前版本', secondLabel = '对比版本' }: { firstId: string; secondId: string; read?: WorkflowRunner['previewArtifact']; firstLabel?: string; secondLabel?: string }) {
  const first = useVersionImage(firstId, read), second = useVersionImage(secondId, read);
  const [mode, setMode] = useState<'side' | 'slider'>('side'), [position, setPosition] = useState(50);
  return <section className="vvc-image-comparison" aria-label="图片可视化版本比较"><div className="vvc-view-modes" role="group" aria-label="图片对比方式"><button type="button" aria-pressed={mode === 'side'} onClick={() => setMode('side')}><Columns2 size={15} />并排查看</button><button type="button" aria-pressed={mode === 'slider'} onClick={() => setMode('slider')}><ArrowLeftRight size={15} />滑杆对照</button></div>
    {mode === 'side' ? <div className="vvc-pair"><article><strong>{firstLabel}</strong><PreparedComparisonImage id={firstId} state={first} label={firstLabel} /></article><article><strong>{secondLabel}</strong><PreparedComparisonImage id={secondId} state={second} label={secondLabel} /></article></div> : <><div className="vvc-slider-images">{first?.url && <img src={first.url} alt={firstLabel} />}{second?.url && <img className="vvc-slider-top" src={second.url} alt={secondLabel} style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />}<i style={{ left: `${position}%` }} aria-hidden="true" /><span>{secondLabel}</span><span>{firstLabel}</span>{(!first?.url || !second?.url) && <p>{first?.error || second?.error || '正在准备两份图片…'}</p>}</div><label className="vvc-slider-control"><span>拖动分界线 · {position}%</span><input type="range" min="0" max="100" value={position} aria-label="版本分界位置" onChange={event => setPosition(Number(event.target.value))} /></label></>}
    <p className="vvc-note">按原比例显示，不拉伸。只读取两份安全预览，不调用模型；GIF 动效请打开原文件检查，已有费用保留。</p>
  </section>;
}
export function ImageVersionCompare({ images, selectedId, runner, disabled = false }: { images: ArtifactMetadata[]; selectedId?: string; runner: WorkflowRunner; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [firstId, setFirstId] = useState(''), [secondId, setSecondId] = useState('');
  const available = images.filter(file => !file.trashedAt && !file.unavailable);
  const first = available.find(file => file.id === firstId) || available.find(file => file.id === selectedId) || available[0];
  const second = available.find(file => file.id === secondId && file.id !== first?.id) || available.find(file => file.id !== first?.id);
  return <><button type="button" className="btn btn-secondary" disabled={disabled || available.length < 2} onClick={() => setOpen(true)}><Columns2 size={15} />比较图片版本</button>{open && <ModalPortal onClose={() => setOpen(false)}><div className="modal-backdrop"><section className="vvc-dialog" role="dialog" aria-modal="true" aria-label="图片版本对照"><header><div><h2>看清这次改了哪里</h2><p>选择两份真实文件并排或滑杆比较。</p></div><button type="button" className="btn-icon" aria-label="关闭图片对照" onClick={() => setOpen(false)}><X size={18} /></button></header><div className="vvc-selectors"><Select aria-label="当前图片版本" value={first?.id || ''} options={available.map(file => ({ value: file.id, label: file.name }))} onValueChange={setFirstId} /><Select aria-label="对比图片版本" value={second?.id || ''} options={available.filter(file => file.id !== first?.id).map(file => ({ value: file.id, label: file.name }))} onValueChange={setSecondId} /></div>{first && second ? <ImageCompareSurface key={`${first.id}/${second.id}`} firstId={first.id} secondId={second.id} read={runner.thumbnailArtifact || runner.previewArtifact} firstLabel={first.name} secondLabel={second.name} /> : <p>当前可比较的图片不足两份。</p>}</section></div></ModalPortal>}</>;
}
export function DocumentVisualComparison({ current, previous }: { current: ComparableDocument; previous: ComparableDocument }) {
  const [pageId, setPageId] = useState('');
  const pages = useMemo(() => {
    if (current.kind === 'ppt' && previous.kind === 'ppt') return [...new Set([...current.slides.map(slide => slide.id), ...previous.slides.map(slide => slide.id)])].map((id, index) => ({ id, label: `第 ${index + 1} 页`, first: current.slides.find(slide => slide.id === id), second: previous.slides.find(slide => slide.id === id) }));
    return [];
  }, [current, previous]);
  const page = pages.find(page => page.id === pageId) || pages[0];
  if (current.kind === 'word' && previous.kind === 'word') {
    const ids = [...new Set([...current.blocks.filter(block => block.type === 'image').map(block => block.id), ...previous.blocks.filter(block => block.type === 'image').map(block => block.id)])];
    const id = ids.includes(pageId) ? pageId : ids[0];
    if (!id) return null;
    const first = current.blocks.find(block => block.id === id), second = previous.blocks.find(block => block.id === id);
    return <section className="vvc-document" aria-label="Word插图可视化比较"><Select aria-label="选择对比插图" value={id} options={ids.map((value, index) => ({ value, label: `插图 ${index + 1}` }))} onValueChange={setPageId} /><div className="vvc-pair"><article><strong>当前插图</strong><ComparisonImage id={first?.imageId} label="当前插图" /></article><article><strong>历史插图</strong><ComparisonImage id={second?.imageId} label="历史插图" /></article></div></section>;
  }
  if (!page || current.kind !== 'ppt' || previous.kind !== 'ppt') return null;
  const theme = (kind: 'first' | 'second') => EDITOR_THEMES[kind === 'first' ? current.theme : previous.theme];
  const position = pages.findIndex(item => item.id === page.id), start = Math.floor(position / 10) * 10;
  const changed = (item: typeof page) => item.first && item.second ? JSON.stringify(item.first) === JSON.stringify(item.second) ? '相同' : '已修改' : item.first ? '新增' : '已删除';
  return <section className="vvc-document" aria-label="PPT逐页可视化比较"><Select aria-label="选择对比页面" value={page.id} options={pages.map(page => ({ value: page.id, label: page.label, description: changed(page) }))} onValueChange={setPageId} /><nav className="vvc-page-thumbnails" aria-label="页面缩略与差异"><button type="button" className="vvc-page-navigation" disabled={start === 0} aria-label="前十页缩略" onClick={() => setPageId(pages[start - 1].id)}>‹</button>{pages.slice(start, start + 10).map(item => { const slide = item.first || item.second!; return <button type="button" key={item.id} aria-pressed={item.id === page.id} aria-label={`查看${item.label} ${changed(item)}`} onClick={() => setPageId(item.id)}><span className={`vvc-page-mini layout-${slide.layout}`} style={{ background: theme(item.first ? 'first' : 'second').background, color: theme(item.first ? 'first' : 'second').text }}><b>{slide.title}</b><span>{slide.body.slice(0, 100)}</span>{slide.imageId && <ImageIcon size={12} />}</span><small>{item.label} · {changed(item)}</small></button>; })}<button type="button" className="vvc-page-navigation" disabled={start + 10 >= pages.length} aria-label="后十页缩略" onClick={() => setPageId(pages[start + 10].id)}>›</button></nav><div className="vvc-pair">{(['first', 'second'] as const).map(kind => <article key={kind}><strong>{kind === 'first' ? '当前内容' : '历史版本'}</strong>{page[kind] ? <div className="vvc-slide" style={{ background: theme(kind).background, color: theme(kind).text }}><h3>{page[kind]!.title}</h3><p>{page[kind]!.body}</p>{page[kind]!.imageId && <ComparisonImage id={page[kind]!.imageId} label={`${kind === 'first' ? '当前' : '历史'}页面插图`} />}<small>{page[kind]!.layout} · {page[kind]!.fontSize} 磅</small></div> : <div className="vvc-slide-empty">此版本没有该页</div>}</article>)}</div><p className="vvc-note">缩略导航显示版式与内容摘要，插图只在选中页面后读取。复杂动画仍需在 Office 中检查。</p></section>;
}
