import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Copy, FolderOpen, LayoutTemplate, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { ModalPortal } from './ModalPortal';

interface ProjectActionsMenuProps {
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canTrash: boolean;
  onEdit: () => void;
  onOpen: () => void;
  onTrash: () => void;
  onCopy?: () => void;
  onSaveTemplate?: () => void;
}

export function ProjectActionsMenu(props: ProjectActionsMenuProps) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const initialLast = useRef(false);
  const [position, setPosition] = useState<CSSProperties>();
  function close(restoreFocus = false) {
    current.current.onOpenChange(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!props.open || !trigger.current || !popup.current) return;
    const rect = trigger.current.getBoundingClientRect(), margin = 8, gap = 6;
    const width = Math.min(212, window.innerWidth - margin * 2);
    const below = window.innerHeight - rect.bottom - gap - margin, above = rect.top - gap - margin;
    const upwards = below < popup.current.scrollHeight + 2 && above > below;
    setPosition({ position: 'fixed', width, left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)), maxHeight: Math.max(0, upwards ? above : below), ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }) });
    const frame = requestAnimationFrame(() => {
      const items = popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      items?.[initialLast.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
    });
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) current.current.onOpenChange(false);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      const next = trigger.current?.getBoundingClientRect();
      if (!next || next.top !== rect.top || next.left !== rect.left) current.current.onOpenChange(false);
    };
    const resize = () => current.current.onOpenChange(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [props.open]);
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }
  function act(action: () => void) { close(); action(); }
  return <div className="op-more-wrap">
    <button ref={trigger} type="button" className="btn-icon" aria-label={`${props.projectName}更多操作`} aria-haspopup="menu" aria-expanded={props.open} aria-controls={props.open ? id : undefined} onClick={() => { initialLast.current = false; props.onOpenChange(!props.open); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialLast.current = event.key === 'ArrowUp'; props.onOpenChange(true); } }}><MoreHorizontal size={18} /></button>
    {props.open && <ModalPortal><div ref={popup} id={id} className="op-popover op-project-actions-menu" role="menu" aria-label={`${props.projectName}操作菜单`} style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onKeyDown={keydown}>
      <button type="button" role="menuitem" onClick={() => act(props.onEdit)}><Pencil size={14} />编辑名称与预算</button>
      <button type="button" role="menuitem" onClick={() => act(props.onOpen)}><FolderOpen size={14} />打开工作台</button>
      {props.onCopy && <button type="button" role="menuitem" onClick={() => act(props.onCopy!)}><Copy size={14} />从此作品新建</button>}
      {props.onSaveTemplate && <button type="button" role="menuitem" onClick={() => act(props.onSaveTemplate!)}><LayoutTemplate size={14} />存为项目模板</button>}
      <button type="button" role="menuitem" className="op-trash-action" disabled={!props.canTrash} title={props.canTrash ? '可恢复，历史费用保留' : '先完成或取消运行任务'} onClick={() => act(props.onTrash)}><Trash2 size={14} />移入回收站</button>
    </div></ModalPortal>}
  </div>;
}
