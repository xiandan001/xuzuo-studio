import { RotateCcw, X } from 'lucide-react';
import type { PromptTemplate } from '../types';
import { ModalPortal } from './ModalPortal';
export function PromptRecordPreview({ prompt, onClose, onRestore }: { prompt: PromptTemplate; onClose: () => void; onRestore?: () => void }) {
  return <ModalPortal onClose={onClose}><div className="pr-overlay"><section className="pr-dialog pr-record-preview" role="dialog" aria-modal="true" aria-label="已整理模板内容"><header className="pr-dialog-header"><div><h2>{prompt.name}</h2><p>{prompt.trashedAt ? '模板回收站' : '已归档'} · 恢复后可继续应用。历史工作流中的提示词副本保留。</p></div><button type="button" className="btn-icon" aria-label="关闭模板内容" onClick={onClose}><X size={19} /></button></header><pre className="pr-prompt-text">{prompt.content}</pre><footer className="pr-dialog-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button><button type="button" className="btn btn-primary" disabled={!onRestore} onClick={onRestore}><RotateCcw size={15} />恢复模板</button></footer></section></div></ModalPortal>;
}
