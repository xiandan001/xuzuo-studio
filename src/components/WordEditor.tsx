import { useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, Bold, ImagePlus, Italic, Plus, Table2, Trash2 } from 'lucide-react';
import type { WordBlock, WordEditorDocument, WordTable } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
import { newWordBlock } from '../lib/editor-document';
import { Select } from './Select';
import { WordBlockView } from './WordBlockView';

interface WordEditorProps { document: WordEditorDocument; onChange: (document: WordEditorDocument) => void; selectedId: string; onSelect: (id: string) => void; images: ArtifactMetadata[]; previews: Record<string, string>; onImportImage: () => void; onEditImage?: (id: string) => void; disabled?: boolean; onSelectTableCell?: (blockId: string, cellId: string) => void; }
export function WordEditor({ document, onChange, selectedId, onSelect, images, previews, onImportImage, disabled, onSelectTableCell, onEditImage }: WordEditorProps) {
  const latest = useRef({ document, onChange, onSelect, onSelectTableCell });
  latest.current = { document, onChange, onSelect, onSelectTableCell };
  const updateBlock = useCallback((id: string, changes: Partial<WordBlock>) => {
    const current = latest.current;
    current.onChange({ ...current.document, blocks: current.document.blocks.map(item => item.id === id ? { ...item, ...changes } : item) });
  }, []);
  const selectBlock = useCallback((id: string) => latest.current.onSelect(id), []);
  const selectTableCell = useCallback((blockId: string, cellId: string) => { latest.current.onSelect(blockId); latest.current.onSelectTableCell?.(blockId, cellId); }, []);
  const updateTable = useCallback((id: string, table: WordTable) => updateBlock(id, { table }), [updateBlock]);
  const selected = document.blocks.find(item => item.id === selectedId) || document.blocks[0];
  const index = document.blocks.findIndex(item => item.id === selected.id);
  const update = (changes: Partial<WordBlock>) => updateBlock(selected.id, changes);
  function add(type: WordBlock['type']) { const block = newWordBlock(type); const blocks = [...document.blocks]; blocks.splice(index + 1, 0, block); onChange({ ...document, blocks }); onSelect(block.id); }
  function move(direction: number) { const next = index + direction; if (next < 0 || next >= document.blocks.length) return; const blocks = [...document.blocks]; [blocks[index], blocks[next]] = [blocks[next], blocks[index]]; onChange({ ...document, blocks }); }
  return <section className="ed-word-editor" aria-label="Word 内容编辑器" onCompositionStartCapture={() => onChange(document)}><fieldset disabled={disabled} className="ed-toolbar">
    <Select disabled={disabled} aria-label="段落格式" value={selected.type} onValueChange={value => { if (value === 'image' && !selected.imageId || selected.type === 'table') return; update({ type: value as WordBlock['type'], imageId: value === 'image' ? selected.imageId : undefined }); }} options={selected.type === 'table' ? [{ value: 'table', label: '表格' }] : [{ value: 'paragraph', label: '正文' }, { value: 'heading', label: '标题' }, { value: 'bullet', label: '项目列表' }, ...(selected.type === 'image' ? [{ value: 'image', label: '图片' }] : [])]} />
    <Select disabled={disabled} aria-label="Word 字号" value={String(selected.fontSize)} onValueChange={value => update({ fontSize: Number(value) })} options={[9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map(value => ({ value: String(value), label: `${value} 磅` }))} />
    <button type="button" className={selected.bold ? 'active' : ''} aria-label="段落加粗" aria-pressed={selected.bold} onClick={() => update({ bold: !selected.bold })}><Bold size={16} /></button><button type="button" className={selected.italic ? 'active' : ''} aria-label="段落斜体" aria-pressed={selected.italic} onClick={() => update({ italic: !selected.italic })}><Italic size={16} /></button>
    <Select disabled={disabled} aria-label="Word 段落对齐" value={selected.align} onValueChange={value => update({ align: value as WordBlock['align'] })} options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} />
    <button type="button" disabled={index === 0} onClick={() => move(-1)} aria-label="段落上移"><ArrowUp size={15} /></button><button type="button" disabled={index === document.blocks.length - 1} onClick={() => move(1)} aria-label="段落下移"><ArrowDown size={15} /></button><button type="button" disabled={document.blocks.length <= 1} aria-label="删除当前段落" onClick={() => { const blocks = document.blocks.filter(item => item.id !== selected.id); onChange({ ...document, blocks }); onSelect(blocks[Math.min(index, blocks.length - 1)].id); }}><Trash2 size={15} /></button>
  </fieldset>
    <article className="ed-word-paper"><input disabled={disabled} className="ed-word-title" data-edit-field={JSON.stringify(['title'])} aria-label="文档标题" value={document.title} maxLength={120} onChange={event => onChange({ ...document, title: event.target.value })} />{document.blocks.map((block, blockIndex) => <WordBlockView key={block.id} block={block} blockIndex={blockIndex} selected={selected.id === block.id} disabled={disabled} images={block.type === 'image' ? images : undefined} preview={block.imageId ? previews[block.imageId] : undefined} onSelect={selectBlock} onUpdate={updateBlock} onTableChange={updateTable} onEditImage={block.type === 'image' ? onEditImage : undefined} onSelectTableCell={block.type === 'table' ? selectTableCell : undefined} />)}</article>
    <div className="ed-add-controls"><button disabled={disabled || document.blocks.length >= 500} className="btn btn-secondary" onClick={() => add('paragraph')}><Plus size={15} />添加段落</button><button disabled={disabled || document.blocks.length >= 500} className="btn btn-secondary" onClick={() => add('heading')}>添加标题</button><button disabled={disabled || document.blocks.length >= 500} className="btn btn-secondary" onClick={() => add('table')}><Table2 size={15} />插入表格</button><button disabled={disabled || document.blocks.length >= 500} className="btn btn-secondary" onClick={onImportImage}><ImagePlus size={15} />插入图片</button></div>
  </section>;
}
