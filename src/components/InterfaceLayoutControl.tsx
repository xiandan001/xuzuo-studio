import { LayoutDashboard, MessageSquare, PanelRight } from 'lucide-react';
import { useAppearance } from '../hooks/useAppearance';
import type { InterfaceLayout } from '../lib/appearance';
import { Select } from './Select';
const layouts = [
  { value: 'simple', label: '简洁创作', description: '居中输入与结果，编辑工具按需打开。', icon: MessageSquare },
  { value: 'professional', label: '专业工作台', description: '文件、画布与参数面板集中操作。', icon: PanelRight },
] as const;
type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;
export function InterfaceLayoutControl({ notify }: { notify?: Notify }) {
  const appearance = useAppearance();
  return <div className="interface-layout-control"><LayoutDashboard size={16} /><Select aria-label="界面布局" className="interface-layout-select" value={appearance.layout} onValueChange={value => { if (!appearance.setLayout(value as InterfaceLayout)) notify?.('界面已切换，本机暂未保存此偏好。', 'info'); }} options={layouts.map(({ value, label, description }) => ({ value, label, description }))} /></div>;
}
export function InterfaceLayoutSettings({ notify }: { notify: Notify }) {
  const appearance = useAppearance();
  return <section className="panel appearance-panel interface-layout-panel" aria-label="界面布局设置"><header><h2>界面布局</h2><p>两套界面共享项目、编辑内容、产物、密钥配置和调用记录。</p></header><div className="appearance-options interface-layout-options" role="group" aria-label="选择界面布局">{layouts.map(({ value, label, description, icon: Icon }) => <button type="button" key={value} aria-pressed={appearance.layout === value} className={appearance.layout === value ? 'active' : ''} onClick={() => { if (!appearance.setLayout(value)) notify('界面已切换，本机暂未保存此偏好。', 'info'); }}><Icon size={23} /><strong>{label}</strong><span>{description}</span></button>)}</div></section>;
}
