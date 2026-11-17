import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EditorDocument } from '../editor-types';
import type { DocumentPreviewImageContext } from '../document-preview-types';
import { useDocumentImagePreviews } from './useDocumentImagePreviews';

export function useDocumentPreviewImages(document: EditorDocument, root: RefObject<HTMLElement | null>, context?: DocumentPreviewImageContext) {
  const scope = context?.scope || 'unlinked-document-preview', current = useRef(context); current.current = context;
  const ids = document.kind === 'word' ? document.blocks.flatMap(block => block.imageId ? [block.imageId] : []) : document.slides.flatMap(slide => slide.imageId ? [slide.imageId] : []);
  const signature = [...new Set(ids)].sort().join('|'), [retry, setRetry] = useState(0);
  const [index, setIndex] = useState<{ scope: string; ids: string[]; error: string }>({ scope: '', ids: [], error: '' });
  const allowed = useRef(new Set<string>());
  allowed.current = new Set(index.scope === scope ? index.ids : []);
  useEffect(() => {
    let active = true; const value = current.current;
    if (!signature || !value) return;
    if (!value.runner.listProjectArtifacts) { setIndex({ scope, ids: [], error: '当前环境暂不提供项目插图，请进入编辑器检查。' }); return; }
    void value.runner.listProjectArtifacts(value.projectId).then(files => {
      if (active) setIndex({ scope, ids: files.filter(file => file.projectId === value.projectId && file.kind === 'image' && !file.trashedAt && !file.unavailable).map(file => file.id), error: '' });
    }).catch(() => { if (active) setIndex({ scope, ids: [], error: '项目插图清单暂未读取，请重试。' }); });
    return () => { active = false; };
  }, [scope, context?.projectId, signature, retry]);
  const preview = useDocumentImagePreviews({ scope, document, selectedId: '', allowedIds: index.scope === scope ? index.ids : [], enabled: !!context && index.scope === scope, root, observeAllPages: true, read: async id => {
    const value = current.current;
    if (!value || !allowed.current.has(id)) throw Error('此插图未在当前项目登记，未读取其他项目文件。');
    return (value.runner.thumbnailArtifact || value.runner.previewArtifact)(id);
  } });
  return { ...preview, indexError: index.scope === scope ? index.error : '', allowed: allowed.current, indexReady: index.scope === scope, retry: () => { setRetry(value => value + 1); preview.retryPreviews(); } };
}
