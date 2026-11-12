import type { ChatTargetInspection } from '../chat-types';
import type { ArtifactMetadata } from '../live-types';

export interface DocumentRevisionContext {
  version: 1;
  workspaceId: string;
  projectId: string;
  orderId: string;
  feedbackId: string;
  kind: 'word' | 'ppt' | 'excel';
  sourceArtifactId: string;
  sourceSha256: string;
  sourceRevision?: number;
}
const key = (workspaceId: string, projectId: string) => `xuzuo-document-revision-v1:${workspaceId}:${projectId}`;
export function saveDocumentRevisionContext(storage: Pick<Storage, 'setItem'>, value: DocumentRevisionContext) {
  if (!/^[a-f\d]{64}$/i.test(value.sourceSha256)) throw Error('原成品校验未完成，请重新打开返修单。');
  storage.setItem(key(value.workspaceId, value.projectId), JSON.stringify(value));
}
export function readDocumentRevisionContext(storage: Pick<Storage, 'getItem'>, workspaceId: string, projectId: string): DocumentRevisionContext | undefined {
  const raw = storage.getItem(key(workspaceId, projectId)); if (!raw) return;
  if (raw.length > 12000) throw Error('返修上下文过长，请从制作单重新进入。');
  const value = JSON.parse(raw) as DocumentRevisionContext;
  if (value.version !== 1 || value.workspaceId !== workspaceId || value.projectId !== projectId || !['word', 'ppt', 'excel'].includes(value.kind) || ![value.orderId, value.feedbackId, value.sourceArtifactId].every(item => typeof item === 'string' && item.length > 0 && item.length <= 500) || !/^[a-f\d]{64}$/i.test(value.sourceSha256) || value.sourceRevision !== undefined && (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1)) throw Error('返修资料与当前项目不匹配，请从制作单重新进入。');
  return value;
}
export function clearDocumentRevisionContext(storage: Pick<Storage, 'removeItem'>, workspaceId: string, projectId: string) { storage.removeItem(key(workspaceId, projectId)); }
export function assertRevisionSource(context: DocumentRevisionContext, inspection: ChatTargetInspection) {
  if (inspection.artifact.id !== context.sourceArtifactId || inspection.artifact.projectId !== context.projectId || inspection.sha256 !== context.sourceSha256 || context.sourceRevision !== undefined && inspection.sourceRevision !== context.sourceRevision || !inspection.documentSource) throw Error('返修原文件或其保存版本已变化，请返回制作单重新选择；当前草稿保留。');
}
export function revisionExportFiles(kind: DocumentRevisionContext['kind'], artifacts: ArtifactMetadata[]) {
  const suffix = kind === 'word' ? '.docx' : kind === 'ppt' ? '.pptx' : '.xlsx';
  return artifacts.filter(file => !file.unavailable && !file.trashedAt && file.name.toLowerCase().endsWith(suffix) && /officedocument/.test(file.mimeType));
}
