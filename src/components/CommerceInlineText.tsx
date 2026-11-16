import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CommerceTextLayer } from '../commerce-image-types';

interface Props { layer: CommerceTextLayer; scale: number; onCommit: (text: string) => void; onCancel: () => void; }
export interface CommerceInlineTextHandle { commit: () => void; hasChanges: () => boolean; }

export const CommerceInlineText = forwardRef<CommerceInlineTextHandle, Props>(function CommerceInlineText({ layer, scale, onCommit, onCancel }, ref) {
  const input = useRef<HTMLTextAreaElement>(null), initial = useRef(layer.text), draft = useRef(layer.text), finished = useRef(false), composing = useRef(false);
  const [text, setText] = useState(layer.text);
  function commit() { if (finished.current) return; finished.current = true; onCommit(draft.current); }
  function cancel() { if (finished.current) return; finished.current = true; onCancel(); }
  useImperativeHandle(ref, () => ({ commit, hasChanges: () => !finished.current && draft.current !== initial.current }));
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, []);
  return <textarea ref={input} className="cle-inline-text-editor" aria-label="直接编辑文字" data-dialog-escape="local" maxLength={2000} value={text}
    style={{ fontFamily: layer.fontFamily, fontSize: layer.fontSize * scale, fontWeight: layer.fontWeight, textAlign: layer.align, color: layer.color }}
    onChange={event => { draft.current = event.target.value; setText(event.target.value); }} onBlur={commit}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commit(); }
    }} />;
});
