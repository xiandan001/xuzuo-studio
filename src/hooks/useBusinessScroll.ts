import { useLayoutEffect, type RefObject } from 'react';
import { readDisclosure, writeDisclosure } from '../lib/disclosure-state';

export function useBusinessScroll(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    let target: HTMLElement | null = ref.current?.parentElement || null;
    while (target && !/(auto|scroll)/.test(getComputedStyle(target).overflowY)) target = target.parentElement;
    if (!target) return;
    const scroll = target, saved = Number(readDisclosure(key, '0'));
    const frame = requestAnimationFrame(() => { scroll.scrollTop = Number.isFinite(saved) ? Math.max(0, saved) : 0; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => { timer = undefined; writeDisclosure(key, String(Math.round(scroll.scrollTop))); };
    const changed = () => { if (timer === undefined) timer = setTimeout(save, 200); };
    scroll.addEventListener('scroll', changed, { passive: true });
    return () => { cancelAnimationFrame(frame); scroll.removeEventListener('scroll', changed); if (timer !== undefined) clearTimeout(timer); save(); };
  }, [key, ref]);
}
