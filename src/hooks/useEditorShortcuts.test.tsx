// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorShortcuts } from './useEditorShortcuts';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('Command shortcuts in desktop editors', () => {
  it('saves and dispatches custom undo/redo while preserving native input undo and modal ownership', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const actions = { save: vi.fn(async () => true), undo: vi.fn(), redo: vi.fn() };
    function Fixture() {
      const root = useRef<HTMLElement>(null);
      useEditorShortcuts(root, true, actions);
      return <section ref={root}><button>画布</button><textarea aria-label="本机文本" /></section>;
    }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(<Fixture />); });
      const canvas = host.querySelector('button')!, input = host.querySelector('textarea')!;
      const key = (target: Element, key: string, shiftKey = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, shiftKey, bubbles: true, cancelable: true }));
      expect(key(canvas, 'z')).toBe(false); expect(actions.undo).toHaveBeenCalledTimes(1);
      expect(key(canvas, 'z', true)).toBe(false); expect(actions.redo).toHaveBeenCalledTimes(1);
      input.focus(); expect(key(input, 's')).toBe(false); expect(actions.save).toHaveBeenCalledTimes(1); expect(document.activeElement).not.toBe(input);
      expect(key(input, 'z')).toBe(true); expect(actions.undo).toHaveBeenCalledTimes(1);
      const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal);
      expect(key(canvas, 'z')).toBe(true); expect(actions.undo).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });
});
