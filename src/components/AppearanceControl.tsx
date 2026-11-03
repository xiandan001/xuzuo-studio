import { hasManagedDialog } from '../lib/dialog-stack';
import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Monitor, Palette, Sun } from 'lucide-react';
import { useAppearance } from '../hooks/useAppearance';
const modes = [{ value: 'light', label: '白天', description: '明亮背景，深色文字', icon: Sun }, { value: 'dark', label: '黑暗', description: '深色背景，柔和文字', icon: Moon }, { value: 'system', label: '跟随系统', description: '随系统外观自动切换', icon: Monitor }] as const;
const palettes = [{ value: 'violet', label: '鸢尾紫', description: '柔和的鸢尾紫，默认配色' }, { value: 'blue', label: '晴空蓝', description: '干净明亮的蓝色强调' }, { value: 'warm', label: '燕麦白', description: '温和纸色与石墨文字' }] as const;
type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;
export function AppearanceControl({ notify }: { notify?: Notify }) {
  const appearance = useAppearance(), [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const Icon = modes.find(mode => mode.value === appearance.mode)!.icon;
  const change = (saved: boolean) => { if (!saved) notify?.('外观已切换，本机暂未保存此偏好。', 'info'); };
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-current="true"]')?.focus());
    window.addEventListener('pointerdown', pointer); window.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', pointer); window.removeEventListener('keydown', key, true); };
  }, [open]);
  return <div className="appearance-control" ref={root}><button ref={trigger} type="button" className="btn-icon appearance-trigger" aria-label="应用外观" title={`外观：${modes.find(mode => mode.value === appearance.mode)!.label} · ${appearance.resolved === 'dark' ? '曜夜黑' : palettes.find(palette => palette.value === appearance.palette)!.label}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><Icon size={18} /></button>{open && <section className="appearance-menu" role="dialog" aria-label="应用外观"><strong>外观模式</strong><div className="appearance-mode-options">{modes.map(({ value, label, icon: ModeIcon }) => <button type="button" key={value} data-current={appearance.mode === value} className={appearance.mode === value ? 'active' : ''} aria-pressed={appearance.mode === value} onClick={() => change(appearance.setMode(value))}><ModeIcon size={17} />{label}</button>)}</div><strong>白天主题</strong><p className="appearance-night-note">夜间统一采用曜夜黑，选择主题只改变白天配色。</p><div className="appearance-palette-options">{palettes.map(({ value, label }) => <button type="button" key={value} aria-pressed={appearance.palette === value} className={appearance.palette === value ? 'active' : ''} onClick={() => change(appearance.setPalette(value))}><span className={`palette-dot palette-${value}`} />{label}{appearance.palette === value && <Check size={15} />}</button>)}</div></section>}</div>;
}
export function AppearanceSettings({ notify }: { notify: Notify }) {
  const appearance = useAppearance();
  const change = (saved: boolean) => { if (!saved) notify('外观已切换，本机暂未保存此偏好。', 'info'); };
  return <section className="panel appearance-panel" aria-label="应用外观设置"><header><h2>应用外观</h2><p>立即生效并自动保存，适用于全部工作区。</p></header><div className="appearance-options" role="group" aria-label="选择应用外观">{modes.map(({ value, label, description, icon: Icon }) => <button type="button" key={value} aria-pressed={appearance.mode === value} className={appearance.mode === value ? 'active' : ''} onClick={() => change(appearance.setMode(value))}><Icon size={22} /><strong>{label}</strong><span>{description}</span></button>)}</div><div className="appearance-settings-palette"><h3><Palette size={17} />白天主题</h3><p className="appearance-night-note">黑夜模式统一使用曜夜黑，浅色文字与蓝色强调。下列主题用于白天模式。</p><div className="appearance-options" role="group" aria-label="选择应用配色">{palettes.map(({ value, label, description }) => <button type="button" key={value} aria-pressed={appearance.palette === value} className={appearance.palette === value ? 'active' : ''} onClick={() => change(appearance.setPalette(value))}><span className={`palette-dot palette-${value}`} /><strong>{label}</strong><span>{description}</span></button>)}</div></div><p className="appearance-caption">当前为{appearance.resolved === 'dark' ? '黑暗' : '白天'}外观。文档稿纸、幻灯片配色和生成图片保持作品本身的颜色。</p></section>;
}
