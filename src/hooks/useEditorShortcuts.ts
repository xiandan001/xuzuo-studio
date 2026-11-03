import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { isTextEditingTarget } from '../lib/edit-history';

export function useEditorShortcuts(root: RefObject<HTMLElement | null>, enabled: boolean, actions: { save: () => Promise<boolean>; undo: () => void; redo: () => void }) {
  const current = useRef({ enabled, actions }); current.current = { enabled, actions };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!current.current.enabled || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
      const container = root.current, target = event.target;
      if (!container || !(target instanceof Node) || !container.contains(target) && target !== document.body) return;
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog && !container.contains(dialog)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault(); event.stopPropagation();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        void current.current.actions.save();
      } else if (['z', 'y'].includes(key) && !isTextEditingTarget(target)) {
        event.preventDefault(); event.stopPropagation();
        current.current.actions[event.shiftKey || key === 'y' ? 'redo' : 'undo']();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [root]);
}
