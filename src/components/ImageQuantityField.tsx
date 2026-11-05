import { useId } from 'react';
import { MAX_IMAGE_QUANTITY, validImageQuantity } from '../lib/image-quantity';
import './image-quantity-field.css';

export function ImageQuantityField({ value, onChange, disabled = false }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  const hintId = useId();
  const valid = validImageQuantity(value);
  return <label className="image-quantity-field">
    <span>图片数量</span>
    <span className="image-quantity-input" data-invalid={!valid || undefined}>
      <input aria-label="图像生成数量" aria-describedby={hintId} aria-invalid={!valid} inputMode="numeric" autoComplete="off" disabled={disabled} value={Number.isNaN(value) ? '' : String(value)} placeholder="输入张数" onChange={event => onChange(event.target.value.trim() ? Number(event.target.value) : Number.NaN)} />
      <span aria-hidden="true">张</span>
    </span>
    <small id={hintId}>{valid ? `1–${MAX_IMAGE_QUANTITY} 张，可直接输入` : `请输入 1–${MAX_IMAGE_QUANTITY} 的整数`}</small>
  </label>;
}
