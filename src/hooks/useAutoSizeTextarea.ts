import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

function resizeTextarea(element: HTMLTextAreaElement, maximum: number) {
  const style = getComputedStyle(element), minimum = parseFloat(style.minHeight) || 56, scroll = element.scrollTop;
  if (element.value === '') {
    element.style.height = `${minimum}px`; element.style.overflowY = 'hidden'; element.scrollTop = 0; return;
  }
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  element.style.height = '0px';
  const natural = element.scrollHeight + border, height = Math.max(minimum, Math.min(maximum, natural));
  element.style.height = `${height}px`;
  element.style.overflowY = natural > height ? 'auto' : 'hidden';
  element.scrollTop = natural > height ? scroll : 0;
}
export function useAutoSizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, maximum = 200) {
  useLayoutEffect(() => { if (ref.current) resizeTextarea(ref.current, maximum); }, [ref, value, maximum]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let frame = 0, width = element.clientWidth;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next === undefined || next === width) return;
      width = next; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => resizeTextarea(element, maximum));
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ref, maximum]);
}
