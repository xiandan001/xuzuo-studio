import { DOCUMENT_REFERENCE_IMAGE_LIMIT, validDocumentImageCount } from './document-illustrations';
import type { DocumentImageMode } from './document-illustrations';
export interface DocumentStudioForm { version: 1; brief: string; instruction: string; modelId: string; inspector: 'create' | 'refine' | 'history'; imageMode: DocumentImageMode; imageModelId: string; imageCredentialId: string; imageCount: number; imageIds: string[]; }
export const documentStudioFormKey = (projectId: string) => `xuzuo.document-studio-form.${projectId}`;
export function readDocumentStudioForm(raw: string | null, brief = ''): DocumentStudioForm {
  const fallback: DocumentStudioForm = { version: 1, brief, instruction: '精简表达，保留已经确认的事实与数据。', modelId: '', inspector: 'create', imageMode: 'none', imageModelId: '', imageCredentialId: '', imageCount: 1, imageIds: [] };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1) return fallback;
    return { version: 1, brief: typeof value.brief === 'string' ? value.brief : brief, instruction: typeof value.instruction === 'string' ? value.instruction : fallback.instruction, modelId: typeof value.modelId === 'string' ? value.modelId : '', inspector: ['create', 'refine', 'history'].includes(value.inspector) ? value.inspector : 'create', imageMode: ['references', 'generate'].includes(value.imageMode) ? value.imageMode : 'none', imageModelId: typeof value.imageModelId === 'string' ? value.imageModelId : '', imageCredentialId: typeof value.imageCredentialId === 'string' ? value.imageCredentialId : '', imageCount: validDocumentImageCount(value.imageCount) ? value.imageCount : 1, imageIds: Array.isArray(value.imageIds) ? [...new Set(value.imageIds.filter((id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(id)))].slice(0, DOCUMENT_REFERENCE_IMAGE_LIMIT) as string[] : [] };
  } catch { return fallback; }
}
