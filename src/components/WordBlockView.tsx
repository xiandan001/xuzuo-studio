import { memo, useMemo, useState } from 'react';
import type { WordBlock, WordTable } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
import { Select } from './Select';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { WordTableEditor } from './WordTableEditor';

export interface WordBlockViewProps {
  block: WordBlock; blockIndex: number; selected: boolean; disabled?: boolean;
  images?: ArtifactMetadata[]; preview?: string;
  onSelect: (id: string) => void; onUpdate: (id: string, changes: Partial<WordBlock>) => void; onTableChange: (id: string, table: WordTable) => void;
  onSelectTableCell?: (blockId: string, cellId: string) => void;
  onEditImage?: (blockId: string) => void;
}
export function wordBlockViewPropsEqual(previous: WordBlockViewProps, next: WordBlockViewProps): boolean {
  return previous.block === next.block && previous.blockIndex === next.blockIndex && previous.selected === next.selected && previous.disabled === next.disabled && previous.preview === next.preview && previous.images === next.images && previous.onSelect === next.onSelect && previous.onUpdate === next.onUpdate && previous.onTableChange === next.onTableChange && previous.onSelectTableCell === next.onSelectTableCell && previous.onEditImage === next.onEditImage;
}
export const WordBlockView = memo(function WordBlockView({ block, blockIndex, selected, disabled, images, preview, onSelect, onUpdate, onTableChange, onSelectTableCell, onEditImage }: WordBlockViewProps) {
  const [imageRatio, setImageRatio] = useState<{ id: string; ratio: number }>();
  const style = useMemo(() => ({ fontSize: `${block.fontSize * 4 / 3}px`, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? 'italic' : 'normal', textAlign: block.align }), [block.fontSize, block.bold, block.italic, block.align]);
  return <div data-word-block={block.id} data-artifact-id={block.type === 'image' ? block.imageId : undefined} className={`ed-word-block ${selected ? 'selected' : ''} ed-block-${block.type}`} onFocus={() => onSelect(block.id)}>
    <span className="ed-block-number">{blockIndex + 1}</span>
    {block.type === 'table' && block.table ? <WordTableEditor blockId={block.id} table={block.table} blockIndex={blockIndex} style={style} disabled={disabled} onChange={onTableChange} onSelectCell={onSelectTableCell} /> : <>
      {block.type === 'image' && <><div className="ed-word-image-area" style={{ aspectRatio: imageRatio && imageRatio.id === block.imageId ? imageRatio.ratio : 4 / 3 }}>{preview ? <img loading="lazy" decoding="async" onLoad={event => { const image = event.currentTarget; if (block.imageId && image.naturalWidth && image.naturalHeight) setImageRatio({ id: block.imageId, ratio: image.naturalWidth / image.naturalHeight }); }} src={preview} alt={block.text || '文档插图'} role={onEditImage ? 'button' : undefined} tabIndex={onEditImage && !disabled ? 0 : undefined} aria-label={onEditImage ? `编辑图片 ${blockIndex + 1}` : undefined} onClick={() => { if (!disabled) { onSelect(block.id); onEditImage?.(block.id); } }} onKeyDown={event => { if (!disabled && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(block.id); onEditImage?.(block.id); } }} /> : <div className="ed-image-placeholder"><span>插图进入可视区域后读取</span>{onEditImage && <button type="button" disabled={disabled} onClick={() => { onSelect(block.id); onEditImage(block.id); }}>读取 / 编辑这张图片</button>}</div>}</div><Select disabled={disabled} aria-label={`段落 ${blockIndex + 1} 的图片`} value={block.imageId || ''} onValueChange={value => onUpdate(block.id, { imageId: value })} options={(images || []).map((image, index) => ({ value: image.id, label: `${index + 1} · ${image.name}` }))} />{onEditImage && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => { onSelect(block.id); onEditImage(block.id); }}>编辑 / 替换这张图片</button>}</>}
      {block.type === 'bullet' && <span className="ed-bullet-mark">•</span>}
      <AutoGrowTextarea disabled={disabled} data-edit-field={JSON.stringify(['word', block.id, 'text'])} aria-label={block.type === 'image' ? `图片 ${blockIndex + 1} 说明` : `段落 ${blockIndex + 1} 内容`} placeholder={block.type === 'image' ? '图片说明（可留空）' : '点击输入内容'} style={style} value={block.text} maxLength={20000} onChange={event => onUpdate(block.id, { text: event.target.value })} />
    </>}
  </div>;
}, wordBlockViewPropsEqual);
