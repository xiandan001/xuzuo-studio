import { useEffect, useRef, useState } from 'react';
import { FileText, Image, LoaderCircle, Paperclip, X } from 'lucide-react';
import type { ChatAttachment } from '../chat-types';
import type { ArtifactPreview } from '../live-types';
import { ModalPortal } from './ModalPortal';
import './chat-attachments.css';

export function ChatAttachments({ files, workspaceId, conversationId, onRemove, disabled = false }: { files: ChatAttachment[]; workspaceId: string; conversationId: string; onRemove?: (id: string) => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<{ file: ChatAttachment; value?: ArtifactPreview; error?: string }>();
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function open(file: ChatAttachment) {
    const request = ++generation.current; setPreview({ file });
    try { if (!window.desktop?.chat?.previewAttachment) throw Error('请在最新版桌面应用中预览本机附件。'); const value = await window.desktop.chat.previewAttachment({ workspaceId, conversationId, attachmentId: file.id }); if (generation.current === request) setPreview({ file, value }); }
    catch (cause) { if (generation.current === request) setPreview({ file, error: cause instanceof Error ? cause.message : '附件暂时无法预览，原文件仍保留。' }); }
  }
  function close() { generation.current++; setPreview(undefined); }
  if (!files.length) return null;
  return <><div className="chat-attachments" aria-label={onRemove ? '本轮附件' : '已发送的附件'}>{files.map(file => <div className="chat-attachment" key={file.id}><button type="button" className="chat-attachment-open" onClick={() => { void open(file); }} title={`预览 ${file.name}`}><span className="chat-attachment-icon">{file.mimeType.startsWith('image/') ? <Image size={18} /> : <FileText size={18} />}</span><span><strong>{file.name}</strong><small>{file.bytes < 1024 * 1024 ? `${Math.ceil(file.bytes / 1024)} KB` : `${(file.bytes / 1024 / 1024).toFixed(1)} MB`}</small></span></button>{onRemove && <button type="button" className="chat-attachment-remove" disabled={disabled} aria-label={`移除附件 ${file.name}`} onClick={() => onRemove(file.id)}><X size={14} /></button>}</div>)}</div>
    {preview && <ModalPortal onClose={close}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="chat-attachment-preview" role="dialog" aria-modal="true" aria-label={`附件预览 ${preview.file.name}`}><header><Paperclip size={18} /><strong>{preview.file.name}</strong><button type="button" className="btn-icon" aria-label="关闭附件预览" onClick={close}><X size={18} /></button></header><div>{preview.error ? <p role="alert">{preview.error}</p> : !preview.value ? <p role="status"><LoaderCircle size={18} className="spin" />正在读取本机附件…</p> : preview.value.dataUrl && /^data:image\/(png|jpeg|webp);base64,/.test(preview.value.dataUrl) ? <img src={preview.value.dataUrl} alt={preview.file.name} /> : preview.value.text ? <pre>{preview.value.text}</pre> : <p>文件已保存在本机会话中，发送后按所选模型能力读取。</p>}</div><footer>预览和移除附件不调用模型；已发送消息的附件和费用仍保留。</footer></section></div></ModalPortal>}
  </>;
}
