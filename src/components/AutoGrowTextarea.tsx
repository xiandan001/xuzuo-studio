import { useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

export function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const input = useRef<HTMLTextAreaElement>(null);
  const resize = () => { const element = input.current; if (!element) return; element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; };
  useLayoutEffect(resize, [props.value, props.style?.fontSize, props.style?.fontWeight, props.style?.fontStyle]);
  useLayoutEffect(() => {
    const parent = input.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    let width = parent.clientWidth;
    const observer = new ResizeObserver(() => { if (parent.clientWidth !== width) { width = parent.clientWidth; resize(); } });
    observer.observe(parent); return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={input} rows={2} style={{ ...props.style, overflow: 'hidden', resize: 'none', maxHeight: 'none' }} />;
}
