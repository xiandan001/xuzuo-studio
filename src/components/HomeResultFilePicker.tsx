import { useEffect, useRef, useState } from 'react';
import { Check, FileText, Image } from 'lucide-react';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRunner } from '../configuration-types';
import { homeCreationPreviewUrl } from '../lib/home-creation';
import { createThumbnailQueue } from '../lib/thumbnail-queue';
import './home-result-picker.css';

const thumbnails = createThumbnailQueue(2);
function ResultFileOption({ file, selected, read, onSelect }: { file: ArtifactMetadata; selected: boolean; read?: WorkflowRunner['thumbnailArtifact']; onSelect: () => void }) {
  const host = useRef<HTMLButtonElement>(null), [visible, setVisible] = useState(false), [url, setUrl] = useState<string>();
  const reader = useRef(read); reader.current = read;
  const readable = !!read;
  useEffect(() => {
    if (!host.current || file.kind !== 'image' || !read) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '80px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [file.id, file.kind, readable]);
  useEffect(() => {
    if (!visible || !reader.current || file.kind !== 'image') return;
    let current = true; setUrl(undefined);
    const task = thumbnails.schedule(() => reader.current!(file.id));
    void task.promise.then(preview => { if (current) setUrl(homeCreationPreviewUrl(preview.dataUrl)); }).catch(() => undefined);
    return () => { current = false; task.cancel(); };
  }, [visible, file.id, file.kind, file.bytes, file.createdAt, readable]);
  return <button ref={host} type="button" className={selected ? 'active' : ''} aria-pressed={selected} aria-label={`查看结果 ${file.name}`} onClick={onSelect} title={file.name}><span className="home-result-thumb">{url ? <img src={url} alt="" loading="lazy" decoding="async" /> : file.kind === 'image' ? <Image size={21} /> : <FileText size={21} />}</span><span className="home-result-file-label"><strong>{file.name}</strong><small>{(file.bytes / 1024).toFixed(0)} KB · {file.mimeType.split('/')[1]?.replace('vnd.openxmlformats-officedocument.', '')}</small></span>{selected && <Check size={15} className="home-result-selected" />}</button>;
}
export function HomeResultFilePicker({ files, selectedId, runner, onSelect }: { files: ArtifactMetadata[]; selectedId: string; runner: WorkflowRunner; onSelect: (id: string) => void }) {
  return <div className="home-result-file-picker" aria-label="选择本次制作结果">{files.map(file => <ResultFileOption key={file.id} file={file} selected={selectedId === file.id} read={runner.thumbnailArtifact} onSelect={() => onSelect(file.id)} />)}</div>;
}
