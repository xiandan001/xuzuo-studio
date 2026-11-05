import { LayoutDashboard, MessageSquare, PanelRight } from 'lucide-react';
import { useAppearance } from '../hooks/useAppearance';
import type { InterfaceLayout } from '../lib/appearance';
import { Select } from './Select';
const layouts = [
  { value: 'simple', label: '专注创作', description: '保留作品与内容导航，辅助工具按需打开。', icon: MessageSquare },
  { value: 'professional', label: '完整工具', description: '同一工作台中显示内容导航与上下文工具。', icon: PanelRight },
] as const;
type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;
export function InterfaceLayoutControl({ notify }: { notify?: Notify }) {
  const appearance = useAppearance();
  return <div className="interface-layout-control"><LayoutDashboard size={16} /><Select aria-label="界面布局" className="interface-layout-select" value={appearance.layout} onValueChange={value => { if (!appearance.setLayout(value as InterfaceLayout)) notify?.('界面已切换，本机暂未保存此偏好。', 'info'); }} options={layouts.map(({ value, label, description }) => ({ value, label, description }))} /></div>;
}
export function InterfaceLayoutSettings({ notify }: { notify: Notify }) {
  const appearance = useAppearance();
  return <section className="panel appearance-panel interface-layout-panel" aria-label="界面布局设置"><header><h2>工作台显示</h2><p>工具位置和编辑方式保持一致。选择初始显示方式，项目内的折叠和工具选择会分别记住。</p></header><div className="appearance-options interface-layout-options" role="group" aria-label="选择界面布局">{layouts.map(({ value, label, description, icon: Icon }) => <button type="button" key={value} aria-pressed={appearance.layout === value} className={appearance.layout === value ? 'active' : ''} onClick={() => { if (!appearance.setLayout(value)) notify('界面已切换，本机暂未保存此偏好。', 'info'); }}><Icon size={23} /><strong>{label}</strong><span>{description}</span></button>)}</div></section>;
}
