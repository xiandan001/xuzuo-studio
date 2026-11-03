import type { EditorDocument } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
import type { Project } from '../types';
import type { ImageDraft } from './image-studio';
import { newEditorSlide, newWordBlock, withSlideLayout } from './editor-document';
import { updateImageDraft } from './image-studio';
import { DOCUMENT_IMAGE_LIMIT } from './document-illustrations';

export function assetApplicationTarget(projects: Project[], workspaceId: string, projectId: string, file: ArtifactMetadata): Project {
  const project = projects.find(item => item.id === projectId && item.workspaceId === workspaceId && !item.trashedAt);
  if (!project || !file || file.projectId !== projectId || !/^[A-Za-z0-9-]{1,100}$/.test(file.id) || file.trashedAt || file.unavailable || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 100 * 1024 * 1024) throw new Error('素材不属于当前工作区项目或文件不可用，未改变工作台内容。');
  return project;
}
export function assertAssetImage(projectId: string, file: ArtifactMetadata, office = false) {
  if (!file || file.projectId !== projectId || file.kind !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || file.trashedAt || file.unavailable || !/^[A-Za-z0-9-]{1,100}$/.test(file.id) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('请选择当前项目中可读取的 PNG、JPEG 或 WebP 图片。');
  if (file.bytes > (office ? 20 : 100) * 1024 * 1024) throw new Error(office ? 'Office 单张插图最多 20 MB。素材副本已保留，请压缩后再插入。' : '图片超过 100 MB，请压缩后再使用。');
}
export function insertDocumentAsset(document: EditorDocument, selectedId: string, file: ArtifactMetadata): { document: EditorDocument; selectedId: string } {
  assertAssetImage(file.projectId || '', file, true);
  const imageIds = new Set((document.kind === 'word' ? document.blocks : document.slides).map(item => item.imageId).filter(Boolean));
  if (!imageIds.has(file.id) && imageIds.size >= DOCUMENT_IMAGE_LIMIT) throw new Error(`文稿已包含 ${DOCUMENT_IMAGE_LIMIT} 张独立图片，请替换现有插图或拆分文档。素材副本与原文保留。`);
  if (document.kind === 'word') {
    if (document.blocks.length >= 500) throw new Error('文档已达 500 个内容块，请先合并内容。素材副本与原文保留。');
    const block = { ...newWordBlock('image'), imageId: file.id, align: 'center' as const };
    const index = document.blocks.findIndex(item => item.id === selectedId), blocks = [...document.blocks];
    blocks.splice(index < 0 ? blocks.length : index + 1, 0, block);
    return { document: { ...document, blocks }, selectedId: block.id };
  }
  if (document.slides.length >= 100) throw new Error('演示已达 100 页，请先合并页面。素材副本与原页面保留。');
  const title = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || '素材插图';
  const slide = { ...newEditorSlide(title), imageId: file.id, layout: 'image-full' as const }, slides = [...document.slides];
  const index = slides.findIndex(item => item.id === selectedId); slides.splice(index < 0 ? slides.length : index + 1, 0, slide);
  return { document: { ...document, slides }, selectedId: slide.id };
}
export function insertWorkbenchAsset(document: EditorDocument, selectedId: string, file: ArtifactMetadata): { document: EditorDocument; selectedId: string } {
  if (document.kind !== 'ppt') return insertDocumentAsset(document, selectedId, file);
  const slide = document.slides.find(item => item.id === selectedId);
  if (!slide) throw new Error('原页面已更改，请重新选择插入位置；素材副本仍保留。');
  if (slide.imageId) return insertDocumentAsset(document, selectedId, file);
  assertAssetImage(file.projectId || '', file, true);
  const ids = new Set(document.slides.map(item => item.imageId).filter(Boolean));
  if (!ids.has(file.id) && ids.size >= DOCUMENT_IMAGE_LIMIT) throw new Error(`演示已包含 ${DOCUMENT_IMAGE_LIMIT} 张独立图片，请替换现有插图或拆分文档。`);
  const layout = ['image-right', 'image-full'].includes(slide.layout) ? slide.layout : 'image-right';
  return { document: { ...document, slides: document.slides.map(item => item.id === selectedId ? { ...withSlideLayout(item, layout as typeof item.layout), imageId: file.id } : item) }, selectedId };
}
export function imageDraftWithAsset(draft: ImageDraft, projectId: string, file: ArtifactMetadata): ImageDraft {
  assertAssetImage(projectId, file);
  return updateImageDraft(draft, { mode: 'refine', references: [{ id: file.id, name: file.name }], galleryBaseId: undefined });
}
