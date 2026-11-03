import type { EditorDocument } from '../editor-types';

export interface DocumentImageTarget { id: string; imageId: string; }
export function selectedDocumentImage(document: EditorDocument, selectedId: string): DocumentImageTarget | undefined {
  const item = document.kind === 'word' ? document.blocks.find(block => block.id === selectedId && block.type === 'image') : document.slides.find(slide => slide.id === selectedId && ['image-right', 'image-full'].includes(slide.layout));
  return item?.imageId ? { id: item.id, imageId: item.imageId } : undefined;
}
export function replaceDocumentImage(document: EditorDocument, target: DocumentImageTarget, imageId: string): EditorDocument {
  const current = selectedDocumentImage(document, target.id);
  if (!current || current.imageId !== target.imageId) throw new Error('原图片位置已更改，未自动替换。请选择需要修改的图片后再应用。');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(imageId)) throw new Error('替换图片编号无效。');
  return document.kind === 'word'
    ? { ...document, blocks: document.blocks.map(block => block.id === target.id ? { ...block, imageId } : block) }
    : { ...document, slides: document.slides.map(slide => slide.id === target.id ? { ...slide, imageId } : slide) };
}
