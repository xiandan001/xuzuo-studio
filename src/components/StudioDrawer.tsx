import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ModalPortal } from './ModalPortal';
import { hasManagedDialog } from '../lib/dialog-stack';
import { X } from 'lucide-react';
import { isSelectInteraction } from './Select';
import './StudioDrawer.css';

export function StudioDrawer({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('textarea:not(:disabled)') || panel.current?.querySelector<HTMLElement>('input:not(:disabled)') || panel.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (isSelectInteraction(event)) return;
      const focusedDialog = document.activeElement instanceof Element ? document.activeElement.closest('[role="dialog"][aria-modal="true"]') : null;
      if (focusedDialog && focusedDialog !== panel.current) return;
      const others = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(dialog => dialog !== panel.current && dialog.getClientRects().length > 0);
      if (others.length) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([aria-hidden="true"]), textarea:not(:disabled), [tabindex="0"]') || []).filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true);
      if (!document.querySelector('[role="dialog"][aria-modal="true"]')) {
        if (previous?.isConnected) previous.focus();
        else requestAnimationFrame(() => { if (!document.querySelector('[role="dialog"][aria-modal="true"]')) document.querySelector<HTMLElement>('.simple-image-composer textarea, .simple-document-composer textarea')?.focus(); });
      }
    };
  }, []);
  return <ModalPortal onClose={onClose} variant="drawer"><div className="simple-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={panel} className="simple-studio-drawer" role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="btn-icon" aria-label={`关闭${title}`} onClick={onClose}><X size={19} /></button></header>{children}</section></div></ModalPortal>;
}
