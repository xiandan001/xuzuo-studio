import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ArtifactMetadata, ArtifactPreview } from '../../live-types';
import type { WorkflowRunner } from '../../configuration-types';
import { ModalPortal } from '../ModalPortal';
export function BusinessSamplePreview({ file, runner, onClose }: { file: ArtifactMetadata; runner: WorkflowRunner; onClose: () => void }) {
  const [result, setResult] = useState<{ id: string; preview?: ArtifactPreview; error?: string }>();
  const current = result?.id === file.id ? result : undefined, preview = current?.preview, error = current?.error;
  useEffect(() => { let active = true; void Promise.resolve().then(() => runner.previewArtifact(file.id)).then(value => { if (!value.dataUrl?.startsWith('data:image/')) throw Error('样稿未返回可显示的图片，请在项目文件中检查原文件。'); if (active) setResult({ id: file.id, preview: value }); }).catch(cause => { if (active) setResult({ id: file.id, error: cause instanceof Error ? cause.message : '图片暂时无法读取，请在项目文件中检查。' }); }); return () => { active = false; }; }, [file.id, runner.previewArtifact]);
  return <ModalPortal onClose={onClose} busy={false}><div className="bs-modal-overlay"><section className="bs-import-dialog bs-sample-dialog" role="dialog" aria-modal="true" aria-label="样稿原尺寸预览"><header><div><h2>{file.name}</h2><p>原尺寸预览，可滚动检查文字与商品细节。</p></div><button type="button" className="btn-icon" aria-label="关闭样稿预览" onClick={onClose}><X size={20} /></button></header><div className="bs-sample-original">{error ? <p role="alert" className="bs-error">{error}</p> : preview?.dataUrl ? <img src={preview.dataUrl} alt={file.name} /> : <p role="status">正在读取样稿…</p>}</div><footer><button type="button" className="btn btn-secondary" onClick={() => { void runner.saveArtifact(file.id); }}>另存样稿</button><button type="button" className="btn btn-primary" onClick={onClose}>返回样稿检查</button></footer></section></div></ModalPortal>;
}
