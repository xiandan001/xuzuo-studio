import { FileText, Image, X } from 'lucide-react';
import type { ChatAttachment } from '../chat-types';

export function ChatAttachmentList({ files, onRemove, disabled }: { files: ChatAttachment[]; onRemove?: (id: string) => void; disabled?: boolean }) {
  if (!files.length) return null;
  return <ul className="chat-attachment-list" aria-label={onRemove ? '待发送的附件' : '本轮附件'}>{files.map(file => {
    const Icon = file.kind === 'image' ? Image : FileText;
    const size = file.bytes >= 1024 * 1024 ? `${(file.bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.bytes / 1024))} KB`;
    return <li key={file.id} title={`${file.name} · ${size}`}><Icon size={17} aria-hidden="true" /><span><strong>{file.name}</strong><small>{size}</small></span>{onRemove && <button type="button" aria-label={`移除附件：${file.name}`} disabled={disabled} onClick={() => onRemove(file.id)}><X size={14} /></button>}</li>;
  })}</ul>;
}
