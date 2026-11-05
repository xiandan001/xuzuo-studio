import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';

interface Props { side: 'left' | 'right'; expanded: boolean; onToggle: () => void; label: string; }
export function StudioPanelToggle({ side, expanded, onToggle, label }: Props) {
  const Icon = side === 'left' ? expanded ? PanelLeftClose : PanelLeftOpen : expanded ? PanelRightClose : PanelRightOpen;
  const action = `${expanded ? '收起' : '展开'}${label}`;
  return <button type="button" className={`btn btn-ghost studio-panel-toggle studio-panel-toggle-${side} ${expanded ? '' : 'is-collapsed'}`} aria-label={action} title={action} aria-expanded={expanded} onClick={onToggle}><Icon size={16} /><span>{label === '项目文件栏' ? '项目文件' : '创作设置'}</span></button>;
}
