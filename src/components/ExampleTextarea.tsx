import { useId } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import './example-textarea.css';

type ExampleTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  example?: string;
  onValueChange: (value: string) => void;
};

export function ExampleTextarea({ value, example, onValueChange, onKeyDown, ...props }: ExampleTextareaProps) {
  const hintId = useId();
  const canFill = !!example && !value.trim() && !props.disabled && !props.readOnly && (props.maxLength === undefined || example.length <= props.maxLength);
  return <div className="example-textarea">
    <textarea {...props} data-tab-example={canFill ? "true" : undefined} value={value} aria-describedby={[props['aria-describedby'], canFill ? hintId : ''].filter(Boolean).join(' ') || undefined} onChange={event => onValueChange(event.target.value)} onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !canFill || event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      onValueChange(example!);
    }} />
    {canFill && <span id={hintId} className="example-textarea-hint"><kbd>Tab</kbd> 填入示例，再按一次跳到下一项</span>}
  </div>;
}
