import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerDialog } from '../lib/dialog-stack';
import './DialogShell.css';

export function ModalPortal({ children, onClose, busy = false, variant = 'dialog' }: { children: ReactNode; onClose?: () => void; busy?: boolean; variant?: 'dialog' | 'drawer' }) {
  const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));
  const options = useRef({ onClose, busy }); options.current = { onClose, busy };
  const registration = useRef<ReturnType<typeof registerDialog> | undefined>(undefined);
  useLayoutEffect(() => {
    if (!host) return;
    host.className = 'studio-modal-layer'; document.body.append(host);
    const panel = host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"]');
    if (panel && options.current.onClose) registration.current = registerDialog(host, panel, () => options.current.onClose?.(), () => options.current.busy, variant === 'drawer');
    return () => { registration.current?.release(); registration.current = undefined; host.remove(); };
  }, [host, variant]);
  useLayoutEffect(() => { registration.current?.refresh(); }, [busy]);
  return host ? createPortal(<div onMouseDownCapture={event => { if (busy && event.target instanceof Element && !event.target.closest('[role="dialog"],[role="alertdialog"]')) { event.preventDefault(); event.stopPropagation(); } }} onClickCapture={event => { if (busy && event.target instanceof Element && event.target.closest('button[aria-label^="关闭"]')) { event.preventDefault(); event.stopPropagation(); } }}>{children}</div>, host) : <>{children}</>;
}
