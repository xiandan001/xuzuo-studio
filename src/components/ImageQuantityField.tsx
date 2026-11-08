import { useId } from 'react';
import { MAX_IMAGE_QUANTITY, validImageQuantity } from '../lib/image-quantity';
import './image-quantity-field.css';

export function ImageQuantityField({ value, onChange, disabled = false, max = MAX_IMAGE_QUANTITY, label = '图片数量', unit = '张', ariaLabel = '图像生成数量' }: { value: number; onChange: (value: number) => void; disabled?: boolean; max?: number; label?: string; unit?: string; ariaLabel?: string }) {
  const hintId = useId();
  const valid = max === MAX_IMAGE_QUANTITY ? validImageQuantity(value) : Number.isInteger(value) && value >= 1 && value <= max;
  return <label className="image-quantity-field">
    <span>{label}</span>
    <span className="image-quantity-input" data-invalid={!valid || undefined}>
      <input aria-label={ariaLabel} aria-describedby={hintId} aria-invalid={!valid} inputMode="numeric" autoComplete="off" disabled={disabled} value={Number.isNaN(value) ? '' : String(value)} placeholder={`输入${unit}数`} onChange={event => onChange(event.target.value.trim() ? Number(event.target.value) : Number.NaN)} />
      <span aria-hidden="true">{unit}</span>
    </span>
    <small id={hintId}>{valid ? `1–${max} ${unit}，可直接输入` : `请输入 1–${max} 的整数`}</small>
  </label>;
}
