import type { ReactNode } from 'react';

interface Props {
  id: string; children: ReactNode; model?: string; account?: string;
  disabled: boolean; onClick: () => void;
}

export function ImageAssistAction({ id, children, model, account, disabled, onClick }: Props) {
  return <div className="image-assist-action">
    <button type="button" className="btn btn-secondary" disabled={disabled} aria-describedby={id} onClick={onClick}>{children}</button>
    <small id={id}>模型：{model || '开始前选择'} · 账户：{account || '开始前选择'}<span>按实际调用计费，费用计入当前项目</span></small>
  </div>;
}
