import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, Smartphone, X } from 'lucide-react';
import type { WallpaperTarget } from '../wallpaper-types';
import { wallpaperBrandLabel } from '../data/wallpaper-devices';
import { parseWallpaperTarget, searchWallpaperDevices } from '../lib/wallpaper-target';
import { selectPopupPosition } from './Select';
import './WallpaperTargetPicker.css';

interface Props {
  value?: WallpaperTarget;
  onChange: (value: WallpaperTarget) => void;
  onIssueChange?: (issue: string) => void;
  disabled?: boolean;
  invalid?: string;
}
interface TargetOption { id: string; label: string; group: string; target: WallpaperTarget; }
const targetText = (target?: WallpaperTarget) => !target ? '' : target.deviceId && target.label ? target.label : `${target.width} × ${target.height}`;
const sameTarget = (first: WallpaperTarget | undefined, second: WallpaperTarget) => Boolean(first && first.width === second.width && first.height === second.height && first.deviceId === second.deviceId);
function typedSelection(target: WallpaperTarget, current: WallpaperTarget | undefined, text: string): WallpaperTarget {
  const keepLandscape = target.deviceId && current && current.width > current.height && !/横屏|横向|竖屏|纵向|\b(?:landscape|portrait)\b/i.test(text);
  return { ...target, ...(keepLandscape ? { width: Math.max(target.width, target.height), height: Math.min(target.width, target.height) } : {}), fit: current?.fit || target.fit };
}
function visibleAnchor(anchor: HTMLElement, rect: DOMRect): boolean {
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.width === 0) return false;
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const bounds = parent.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.right <= bounds.left || rect.left >= bounds.right) return false;
  }
  return true;
}

export function WallpaperTargetPicker({ value, onChange, onIssueChange, disabled = false, invalid = '' }: Props) {
  const id = `wallpaper-${useId()}`, listId = `${id}-devices`, messageId = `${id}-message`;
  const anchor = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(() => targetText(value)), [dirty, setDirty] = useState(false), [open, setOpen] = useState(false), [active, setActive] = useState(-1), [error, setError] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const signature = JSON.stringify(value);
  useEffect(() => { setQuery(targetText(value)); setDirty(false); setError(''); setActive(-1); }, [signature]);
  const parsed = useMemo(() => parseWallpaperTarget(query), [query]);
  const options = useMemo<TargetOption[]>(() => {
    const fit = value?.fit || 'cover';
    const devices = searchWallpaperDevices(dirty ? query : '');
    const landscape = Boolean(value && value.width > value.height);
    const rows: TargetOption[] = devices.map(device => ({ id: device.id, label: device.name, group: wallpaperBrandLabel(device.brand), target: { width: landscape ? device.height : device.width, height: landscape ? device.width : device.height, fit, deviceId: device.id, label: device.name } }));
    if (dirty && parsed.status === 'resolved' && parsed.device && !rows.some(row => row.id === parsed.device!.id)) rows.unshift({ id: parsed.device.id, label: parsed.device.name, group: wallpaperBrandLabel(parsed.device.brand), target: typedSelection(parsed.target, value, query) });
    if (dirty && parsed.status === 'resolved' && !parsed.target.deviceId) rows.unshift({ id: 'custom', label: `使用 ${parsed.target.width} × ${parsed.target.height}`, group: '自定义像素', target: { ...parsed.target, fit } });
    return rows;
  }, [dirty, query, parsed, value?.fit, value?.width, value?.height]);
  const optionId = (index: number) => `${listId}-${index}`;
  function close() { setOpen(false); setActive(-1); }
  function show() {
    if (disabled) return;
    document.dispatchEvent(new CustomEvent('studio-select-open', { detail: id }));
    setOpen(true);
  }
  function commit(target: WallpaperTarget) {
    if (disabled) return;
    setQuery(targetText(target)); setDirty(false); setError(''); close(); onIssueChange?.(''); onChange(target);
  }
  function resolveTyped() {
    if (!dirty) return true;
    if (parsed.status === 'resolved') { commit(typedSelection(parsed.target, value, query)); return true; }
    const message = query.trim() ? parsed.message : '请选择设备，或输入宽 × 高像素。';
    setError(message); onIssueChange?.(message); return false;
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); show(); const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActive(index => !options.length ? -1 : index < 0 ? direction === 1 ? 0 : options.length - 1 : (index + direction + options.length) % options.length); return;
    }
    if (event.key === 'Enter') {
      event.preventDefault(); if (open && options[active]) commit(options[active].target); else resolveTyped(); return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setQuery(targetText(value)); setDirty(false); setError(''); onIssueChange?.(''); close(); return;
    }
    if (event.key === 'Tab') { resolveTyped(); close(); return; }
    if (open && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); }
  }
  useEffect(() => {
    const otherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close(); };
    document.addEventListener('studio-select-open', otherOpened);
    return () => document.removeEventListener('studio-select-open', otherOpened);
  }, [id]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' }); }, [open, active]);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect(); if (!rect) return;
      if (!anchor.current || !visibleAnchor(anchor.current, rect)) { close(); return; }
      setPosition(selectPopupPosition(rect, window.innerWidth, window.innerHeight, Math.min(360, Math.max(options.length, 1) * 58 + 16)));
    };
    const outside = (event: Event) => { if (event.target instanceof Node && !anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) close(); };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place(); };
    const resize = new ResizeObserver(place); resize.observe(anchor.current); place();
    document.addEventListener('pointerdown', outside, true); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', place);
    return () => { resize.disconnect(); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', place); };
  }, [open, options.length]);
  const issue = error || invalid;
  const canAdjust = Boolean(value && !disabled && !dirty);
  const orient = (landscape: boolean) => {
    if (!value || !canAdjust) return;
    const low = Math.min(value.width, value.height), high = Math.max(value.width, value.height);
    commit({ ...value, width: landscape ? high : low, height: landscape ? low : high });
  };
  return <section className="wallpaper-target-picker" aria-label="壁纸设备与最终尺寸">
    <label htmlFor={id}>设备或分辨率</label>
    <div ref={anchor} className="wallpaper-device-search" data-select-open={open || undefined}>
      <Search size={16} aria-hidden="true" />
      <input ref={input} id={id} role="combobox" aria-label="壁纸设备或分辨率" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? optionId(active) : undefined} aria-describedby={messageId} aria-invalid={issue ? true : undefined} autoComplete="off" disabled={disabled} value={query} placeholder="搜索机型，或输入 1170×2532" onFocus={event => { show(); event.currentTarget.select(); }} onKeyDown={keyDown} onChange={event => { setQuery(event.target.value); setDirty(true); setError(''); setActive(-1); show(); onIssueChange?.('请应用输入的设备或尺寸后再生成。'); }} />
      {query && !disabled ? <button type="button" className="wallpaper-search-action" aria-label="清空设备搜索" onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(''); setDirty(true); setActive(-1); setError(''); onIssueChange?.('请选择设备，或输入宽 × 高像素。'); input.current?.focus(); show(); }}><X size={15} /></button> : <button type="button" className="wallpaper-search-action" aria-label="展开壁纸设备列表" disabled={disabled} onClick={() => { input.current?.focus(); show(); }}><ChevronDown size={16} /></button>}
    </div>
    {open && createPortal(<div ref={popup} className="wallpaper-device-popup" data-select-popup style={position}><div role="listbox" id={listId} aria-label="壁纸设备候选">{options.length ? options.map((option, index) => <div key={option.id}>{index === 0 || options[index - 1].group !== option.group ? <div className="wallpaper-device-group">{option.group}</div> : null}<button type="button" role="option" id={optionId(index)} aria-selected={sameTarget(value, option.target)} tabIndex={-1} className={`wallpaper-device-option ${active === index ? 'is-active' : ''}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => commit(option.target)}><Smartphone size={17} aria-hidden="true" /><span><strong>{option.label}</strong><small>{option.target.width} × {option.target.height} px</small></span>{sameTarget(value, option.target) && <Check size={16} aria-hidden="true" />}</button></div>) : <p className="wallpaper-device-empty">{query.trim() && parsed.status !== 'resolved' ? parsed.message : '输入机型名称，或直接填写宽 × 高像素。'}</p>}</div></div>, document.body)}
    <div className="wallpaper-target-options"><div role="group" aria-label="壁纸方向"><button type="button" disabled={!canAdjust} aria-pressed={!!value && value.height >= value.width} onClick={() => orient(false)}>竖屏</button><button type="button" disabled={!canAdjust} aria-pressed={!!value && value.width > value.height} onClick={() => orient(true)}>横屏</button></div><div role="group" aria-label="壁纸适配方式"><button type="button" disabled={!canAdjust} aria-pressed={value?.fit === 'cover'} title="等比铺满屏幕，边缘可能裁切" onClick={() => value && commit({ ...value, fit: 'cover' })}>铺满</button><button type="button" disabled={!canAdjust} aria-pressed={value?.fit === 'contain'} title="保留完整画面，不足区域补背景" onClick={() => value && commit({ ...value, fit: 'contain' })}>完整保留</button></div></div>
    <p id={messageId} className={issue ? 'wallpaper-target-issue' : 'wallpaper-target-summary'} role={issue ? 'status' : undefined}>{issue || (value ? `最终尺寸 ${value.width} × ${value.height} px · PNG` : '支持苹果、三星、小米、华为、OPPO、vivo、荣耀及自定义像素。')}</p>
  </section>;
}
