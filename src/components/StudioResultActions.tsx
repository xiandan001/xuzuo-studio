import { useState } from 'react';
import { Download, MoreHorizontal, Pencil } from 'lucide-react';
import { StudioDrawer } from './StudioDrawer';
import './studio-result-actions.css';

export interface StudioMoreAction { id: string; label: string; description?: string; disabled?: boolean; onSelect: () => void; }
interface Props { kind: string; disabled?: boolean; exporting?: boolean; modifying?: boolean; canExport: boolean; canModify: boolean; onExport: () => void; onModify: () => void; actions: StudioMoreAction[]; }

export function StudioResultActions({ kind, disabled, exporting, modifying, canExport, canModify, onExport, onModify, actions }: Props) {
  const [more, setMore] = useState(false);
  return <div className="studio-result-actions" aria-label="作品操作">
    <button type="button" className="btn btn-secondary" disabled={disabled || !canModify} aria-expanded={modifying} onClick={onModify}><Pencil size={16} />{modifying ? '收起修改' : '修改'}</button>
    <button type="button" className="btn btn-ghost" aria-label="更多作品操作" aria-expanded={more} onClick={() => setMore(true)}><MoreHorizontal size={18} />更多</button>
    <button type="button" className="btn btn-primary" disabled={disabled || !canExport} onClick={onExport}><Download size={16} />{exporting ? '正在导出…' : `导出${kind}`}</button>
    {more && <StudioDrawer title="更多作品操作" description="保存、查看文件与交付检查都在这里。" onClose={() => setMore(false)}><div className="studio-more-actions">{actions.map(action => <button type="button" key={action.id} disabled={action.disabled} onClick={() => { setMore(false); action.onSelect(); }}><strong>{action.label}</strong>{action.description && <span>{action.description}</span>}</button>)}</div></StudioDrawer>}
  </div>;
}
