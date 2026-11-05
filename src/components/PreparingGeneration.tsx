import { LoaderCircle } from 'lucide-react';

export function PreparingGeneration({ onCancel }: { onCancel: () => void }) {
  return <section className="preparing-generation" role="status" aria-label="正在准备制作工具"><LoaderCircle size={18} className="spin" /><div><strong>正在准备制作工具…</strong><p>本次制作尚未发起模型请求。</p></div><button type="button" className="btn btn-secondary" onClick={onCancel}>取消此次制作 <kbd>Esc</kbd></button></section>;
}
