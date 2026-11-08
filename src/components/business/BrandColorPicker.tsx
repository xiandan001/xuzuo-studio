import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { RememberedDetails } from '../RememberedDetails';
import './brand-color-picker.css';

export const BRAND_COLOR_SCHEMES = [
  { name: '清新蓝白', colors: ['#2463eb', '#dbeafe', '#ffffff'] },
  { name: '森野绿意', colors: ['#28634c', '#e5efdf', '#fffdf5'] },
  { name: '暖茶奶咖', colors: ['#805633', '#e7d5bd', '#fff9f0'] },
  { name: '暮光紫韵', colors: ['#7054c9', '#e8e0fa', '#faf7ff'] },
  { name: '珊瑚暖橙', colors: ['#cf5d42', '#f6dfc8', '#fffbf4'] },
  { name: '简约黑白', colors: ['#202124', '#b9bdc4', '#ffffff'] },
];
const extras = [
  ['樱桃红', '#c83e4d'], ['玫瑰粉', '#d76c99'], ['蜜桃粉', '#f2c8c1'], ['明亮橙', '#eb8c37'],
  ['金盏黄', '#e3b83d'], ['奶油黄', '#f5e7ab'], ['橄榄绿', '#859652'], ['薄荷绿', '#92c8b3'],
  ['湖水青', '#3c9ba2'], ['天空蓝', '#7bafe0'], ['深海蓝', '#29476d'], ['薰衣草', '#afa0d8'],
  ['葡萄紫', '#6c437e'], ['陶土棕', '#a16c52'], ['暖灰', '#a39b92'], ['纯白', '#ffffff'],
];
const colorName = (hex: string, at: number) => extras.find(item => item[1] === hex.toLowerCase())?.[0] || (at === 0 ? '主色' : `辅助色${at}`);
function foreground(hex: string) { const parts = hex.match(/[a-f0-9]{2}/gi)?.map(value => parseInt(value, 16)) || [255, 255, 255]; return parts[0] * .299 + parts[1] * .587 + parts[2] * .114 > 155 ? '#182230' : '#ffffff'; }
export function BrandColorPicker({ value, onChange, rememberKey, brandName, disabled }: { value: string; onChange: (value: string) => void; rememberKey: string; brandName?: string; disabled?: boolean }) {
  const [adding, setAdding] = useState(false), colors = value.split(/[,，\s]+/).filter(item => /^#[a-f0-9]{6}$/i.test(item));
  const update = (next: string[]) => onChange(next.join(', ')), selected = BRAND_COLOR_SCHEMES.find(item => item.colors.join(',').toLowerCase() === colors.join(',').toLowerCase());
  return <section className="brand-color-picker bs-full" aria-label="品牌标准色色系选择">
    <header><strong>标准色</strong><span>选一套喜欢的色系，也可自由增减颜色。</span></header>
    <div className="brand-color-schemes">{BRAND_COLOR_SCHEMES.map(scheme => <button type="button" key={scheme.name} disabled={disabled} aria-label={`使用${scheme.name}色系`} aria-pressed={selected?.name === scheme.name} onClick={() => update(scheme.colors)}><span className="brand-color-bars">{scheme.colors.map(color => <i key={color} style={{ background: color }} />)}</span><span>{scheme.name}</span>{selected?.name === scheme.name && <Check size={15} />}</button>)}</div>
    <div className="brand-color-current"><div className="brand-color-selected" aria-label="已选品牌颜色">{colors.map((color, at) => <span key={`${at}:${color}`}><button type="button" className="brand-color-dot" style={{ background: color, color: foreground(color) }} disabled={disabled || at === 0} aria-label={`将${colorName(color, at)}设为主色`} title={at === 0 ? '当前主色' : '点击设为主色'} onClick={() => update([color, ...colors.filter((_, index) => index !== at)])}>{at === 0 && <Check size={13} />}</button><small>{colorName(color, at)}</small><button type="button" className="brand-color-remove" aria-label={`移除${at === 0 ? '主色' : `辅助色${at}`}`} disabled={disabled} onClick={() => update(colors.filter((_, index) => index !== at))}><X size={12} /></button></span>)}</div><button type="button" className="btn btn-secondary" aria-expanded={adding} disabled={disabled || colors.length >= 16} onClick={() => setAdding(old => !old)}><Plus size={15} />添加颜色</button></div>
    {adding && <div className="brand-color-extra" role="group" aria-label="选择要添加的颜色">{extras.map(([name, color]) => <button type="button" key={name} disabled={disabled || colors.some(item => item.toLowerCase() === color) || colors.length >= 16} aria-label={`添加${name}`} onClick={() => { update([...colors, color]); setAdding(false); }}><i style={{ background: color }} /><span>{name}</span></button>)}</div>}
    {!!colors.length && <div className="brand-color-preview" style={{ background: colors[1] || '#f4f5f7', borderColor: colors[0] }} aria-label="品牌配色即时预览"><strong style={{ color: foreground(colors[1] || '#f4f5f7') }}>{brandName || '你的品牌'}</strong><span style={{ background: colors[0], color: foreground(colors[0]) }}>主色效果</span><small style={{ color: foreground(colors[1] || '#f4f5f7') }}>主色用于重点，辅助色用于背景与层次。</small></div>}
    <RememberedDetails rememberKey={rememberKey}><summary>高级：使用已有色值 <small>可选</small></summary><label>颜色代码<input className="field" aria-label="品牌标准色" maxLength={150} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} placeholder="#2463eb, #ffffff" /></label><p>已知客户品牌色时可粘贴，普通使用直接选择上面的色系即可。</p></RememberedDetails>
  </section>;
}
