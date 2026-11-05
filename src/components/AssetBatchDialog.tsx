import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import type { AssetCategory } from '../asset-types';
export type AssetBatchAction = 'archive' | 'restore' | 'category';
export function AssetBatchDialog({ action, count, categories, busy, onClose, onConfirm }: { action: AssetBatchAction; count: number; categories: AssetCategory[]; busy: boolean; onClose: () => void; onConfirm: (category: string) => void }) {
  const [category, setCategory] = useState('');
  const title = action === 'archive' ? '批量移入素材回收站' : action === 'restore' ? '批量恢复素材' : '批量调整素材分类';
  return <ModalPortal onClose={onClose} busy={busy}><div className="op-modal-overlay"><section className="op-modal asset-batch-dialog" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2><p>将处理所选的 <strong>{count}</strong> 份素材。{action === 'archive' ? '素材可在回收站恢复，已加入项目的独立副本不受影响。' : action === 'restore' ? '恢复后重新出现在使用中的素材列表。' : '只调整素材库归类，不移动文件或修改项目副本。'}历史费用始终保留。</p>{action === 'category' && <label>目标分类<Select aria-label="批量素材目标分类" disabled={busy} value={category} onValueChange={setCategory} options={[{ value: '', label: '未归类' }, ...categories.map(item => ({ value: item.id, label: item.name }))]} /></label>}<footer><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="btn btn-primary" disabled={busy || !count} onClick={() => onConfirm(category)}>{busy && <LoaderCircle size={15} className="spin" />}{busy ? '正在处理…' : `确认处理 ${count} 份`}</button></footer></section></div></ModalPortal>;
}
