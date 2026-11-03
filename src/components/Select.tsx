import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import './Select.css';

export interface SelectOption { value: string; label: string; disabled?: boolean; group?: string; description?: string; }
export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/** Parent dialog capture handlers must let the open select handle Escape and Tab first. */
export function isSelectInteraction(event: Pick<KeyboardEvent, 'target'>): boolean {
  return event.target instanceof Element && Boolean(event.target.closest('[data-select-open="true"], [data-select-popup]'));
}

export function filterSelectOptions(options: SelectOption[], query: string): SelectOption[] {
  const term = query.trim().toLocaleLowerCase();
  return term ? options.filter(option => `${option.label} ${option.description || ''} ${option.group || ''} ${option.value}`.toLocaleLowerCase().includes(term)) : options;
}

export function nextSelectIndex(options: SelectOption[], current: number, direction: 1 | -1): number {
  for (let offset = 1; offset <= options.length; offset++) {
    const index = (current + direction * offset + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function selectPopupPosition(rect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>, viewportWidth: number, viewportHeight: number, desiredHeight = 360): CSSProperties {
  const gap = 6, margin = 8;
  const width = Math.max(0, Math.min(Math.max(rect.width, 260), viewportWidth - margin * 2));
  const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
  const below = viewportHeight - rect.bottom - gap - margin, above = rect.top - gap - margin;
  const openAbove = below < desiredHeight && above > below;
  const maxHeight = Math.max(60, Math.min(360, openAbove ? above : below));
  return { position: 'fixed', left, width, maxHeight, ...(openAbove ? { bottom: viewportHeight - rect.top + gap } : { top: rect.bottom + gap }) };
}

function anchorIsVisible(anchor: HTMLElement, rect: DOMRect): boolean {
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.width === 0) return false;
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const bounds = parent.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.right <= bounds.left || rect.left >= bounds.right) return false;
  }
  return true;
}

function moveDialogFocus(anchor: HTMLButtonElement, backwards: boolean): boolean {
  const dialog = anchor.closest('[role="dialog"][aria-modal="true"]');
  if (!dialog) return false;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], summary, [tabindex]')).filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && !control.closest('[aria-hidden="true"], [hidden], [inert]') && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden');
  const index = controls.indexOf(anchor);
  if (index < 0 || !controls.length) return false;
  controls[(index + (backwards ? -1 : 1) + controls.length) % controls.length].focus();
  return true;
}

export function Select({ value, onValueChange, options, id, name, required = false, disabled = false, className = '', placeholder = '请选择', 'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy }: SelectProps) {
  const generatedId = useId();
  const triggerId = id || `select-${generatedId}`;
  const listId = `${triggerId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const searchable = options.length > 7;
  const filtered = filterSelectOptions(options, query);
  const selected = options.find(option => option.value === value);
  const activeIndex = filtered.findIndex(option => option.value === activeValue && !option.disabled);
  const activeId = activeIndex < 0 ? undefined : `${listId}-option-${activeIndex}`;
  const optionsSignature = JSON.stringify(options);

  const unavailable = () => disabled || !trigger.current || trigger.current.matches(':disabled');
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus && !unavailable()) trigger.current?.focus(); }
  function show(direction: 1 | -1 = 1) {
    if (unavailable()) return;
    document.dispatchEvent(new CustomEvent('studio-select-open', { detail: triggerId }));
    setQuery('');
    const current = options.find(option => option.value === value && !option.disabled);
    const fallback = nextSelectIndex(options, direction === 1 ? -1 : 0, direction);
    setActiveValue(current?.value ?? options[fallback]?.value ?? null);
    setOpen(true);
  }
  function choose(option: SelectOption) {
    if (unavailable() || option.disabled) { close(); return; }
    onValueChange(option.value); close(true);
  }

  useEffect(() => {
    const otherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== triggerId) setOpen(false); };
    document.addEventListener('studio-select-open', otherOpened);
    return () => document.removeEventListener('studio-select-open', otherOpened);
  }, [triggerId]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    setActiveValue(current => filtered.some(option => option.value === current && !option.disabled) ? current : filtered.find(option => !option.disabled)?.value ?? null);
  // Stable option content avoids resetting navigation when a caller creates a new options array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, optionsSignature]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current;
      if (!anchor || anchor.matches(':disabled')) { setOpen(false); return; }
      const rect = anchor.getBoundingClientRect();
      if (!anchorIsVisible(anchor, rect)) { setOpen(false); return; }
      setPosition(selectPopupPosition(rect, window.innerWidth, window.innerHeight, Math.min(360, Math.max(1, filtered.length) * 44 + (searchable ? 64 : 16))));
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place(); };
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !trigger.current?.parentElement?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    const disabledChanged = new MutationObserver(() => { if (trigger.current?.matches(':disabled')) setOpen(false); });
    for (let ancestor = trigger.current?.parentElement; ancestor; ancestor = ancestor.parentElement) disabledChanged.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
    const resized = new ResizeObserver(place);
    if (trigger.current) resized.observe(trigger.current);
    place();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', place);
    return () => {
      disabledChanged.disconnect(); resized.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', place);
    };
  // Option count affects fitting, but changes in selection do not move the popup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered.length, searchable]);
  useEffect(() => {
    if (!open || !activeId) return;
    const option = document.getElementById(activeId), list = popup.current?.querySelector<HTMLElement>('.select-options');
    if (!option || !list) return;
    const item = option.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [open, activeId]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (unavailable()) { close(); return; }
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const editing = event.target === search.current;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab' && open) {
      if (trigger.current && moveDialogFocus(trigger.current, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
      else if (editing) trigger.current?.focus();
      close(); return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) show(direction);
      else { const index = nextSelectIndex(filtered, activeIndex < 0 && direction === -1 ? 0 : activeIndex, direction); setActiveValue(filtered[index]?.value ?? null); }
      return;
    }
    if ((event.key === 'Home' || event.key === 'End') && open && !editing) {
      event.preventDefault();
      const index = nextSelectIndex(filtered, event.key === 'Home' ? -1 : 0, event.key === 'Home' ? 1 : -1);
      setActiveValue(filtered[index]?.value ?? null); return;
    }
    if (event.key === 'Enter' || event.key === ' ' && !editing) {
      event.preventDefault(); if (!open) show(); else if (activeIndex >= 0) choose(filtered[activeIndex]); return;
    }
    if (!editing && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); if (!open) show();
      const now = Date.now();
      const text = now - typeahead.current.time < 700 ? typeahead.current.text + event.key : event.key;
      typeahead.current = { text, time: now };
      if (searchable) setQuery(text);
      else { const match = options.find(option => !option.disabled && option.label.toLocaleLowerCase().includes(text.toLocaleLowerCase())); if (match) setActiveValue(match.value); }
    }
  }

  return <div className="custom-select" data-select-open={open ? 'true' : undefined}>
    <button ref={trigger} id={triggerId} type="button" className={`select-trigger ${className}`} role="combobox" aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? activeId : undefined} aria-required={required || undefined} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={onKeyDown}>
      <span className={selected ? 'select-value' : 'select-value select-placeholder'}>{selected?.label || (value ? '当前选项不可用，请重新选择' : placeholder)}</span><ChevronDown size={17} aria-hidden="true" />
    </button>
    {(name || required) && <input className="select-form-value" tabIndex={-1} aria-hidden="true" autoComplete="off" name={name} value={value} required={required} disabled={disabled} onChange={() => undefined} onInvalid={event => { event.preventDefault(); show(); trigger.current?.focus(); }} />}
    {open && typeof document !== 'undefined' && createPortal(<div ref={popup} data-select-popup="true" className="select-popup" style={position} onKeyDown={onKeyDown}>
      {searchable && <div className="select-search"><Search size={16} aria-hidden="true" /><input ref={search} aria-label={`搜索${ariaLabel || '选项'}`} value={query} placeholder="输入关键词查找" onChange={event => setQuery(event.target.value)} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId} autoComplete="off" />{query && <button type="button" tabIndex={-1} aria-label="清除选项搜索" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={15} /></button>}</div>}
      <div id={listId} role="listbox" className="select-options" aria-label={ariaLabel || '可选项目'}>{filtered.map((option, index) => <div key={`${option.value}-${index}`}>
        {option.group && option.group !== filtered[index - 1]?.group && <div className="select-group" role="presentation">{option.group}</div>}
        <button type="button" role="option" id={`${listId}-option-${index}`} tabIndex={-1} aria-selected={value === option.value} aria-disabled={option.disabled || undefined} disabled={option.disabled} className={`select-option ${option.value === activeValue ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''}`} onMouseDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }} onClick={() => choose(option)}><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{value === option.value && <Check size={17} aria-hidden="true" />}</button>
      </div>)}{!filtered.length && <p className="select-empty" role="status">{query ? '没有匹配选项，试试其他关键词' : '暂无可用选项'}</p>}</div>
      {required && !value && <div className="select-required-note">请选择一项后继续</div>}
    </div>, document.body)}
  </div>;
}
