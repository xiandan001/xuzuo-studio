import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useCommandPaletteKeys(open: boolean, onClose: () => void, previous: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) { if (!document.querySelector('[data-editor-transition]') && previous.current?.isConnected) previous.current.focus(); previous.current = null; return; }
    const keydown = (event: KeyboardEvent) => {
      const panel = document.querySelector<HTMLElement>('.command-palette');
      if (!panel || !(event.target instanceof Element) || !panel.contains(event.target)) return;
      const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('.command-results button:not(:disabled)'));
      const input = panel.querySelector<HTMLInputElement>('input');
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); const next = index < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && document.activeElement === input) { event.preventDefault(); buttons[0]?.click(); }
      else if (index >= 0 && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus(); }
      else if (event.key === 'Tab') {
        const controls: HTMLElement[] = [...(input ? [input] : []), ...buttons];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
  }, [open, onClose, previous]);
}
