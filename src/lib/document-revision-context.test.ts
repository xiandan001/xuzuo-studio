// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactMetadata } from '../live-types';
import { assertRevisionSource, clearDocumentRevisionContext, readDocumentRevisionContext, revisionExportFiles, saveDocumentRevisionContext } from './document-revision-context';
import type { DocumentRevisionContext } from './document-revision-context';

const context: DocumentRevisionContext = { version: 1, workspaceId: 'w', projectId: 'p', orderId: 'o', feedbackId: 'f', kind: 'word', sourceArtifactId: 'original', sourceSha256: 'a'.repeat(64), sourceRevision: 2 };
const office = { id: 'original', projectId: 'p', name: '成品.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', bytes: 20, createdAt: '2026-11-12T00:00:00Z' } as ArtifactMetadata;
describe('文档返修锁定真实原版和导出类型', () => {
  beforeEach(() => sessionStorage.clear());
  it('跨项目与工作区隔离，明确采用成功后才清除上下文', () => {
    saveDocumentRevisionContext(sessionStorage, context);
    expect(readDocumentRevisionContext(sessionStorage, 'w', 'p')).toEqual(context);
    expect(readDocumentRevisionContext(sessionStorage, 'another', 'p')).toBeUndefined();
    expect(readDocumentRevisionContext(sessionStorage, 'w', 'another')).toBeUndefined();
    clearDocumentRevisionContext(sessionStorage, 'w', 'p');
    expect(readDocumentRevisionContext(sessionStorage, 'w', 'p')).toBeUndefined();
  });
  it('相同文件名不能替代原SHA或保存版本，缺失绑定源稿不允许载入', () => {
    const inspection = { artifact: office, sha256: context.sourceSha256, sourceRevision: 2, documentSource: '{}' };
    expect(() => assertRevisionSource(context, inspection)).not.toThrow();
    expect(() => assertRevisionSource(context, { ...inspection, sha256: 'b'.repeat(64) })).toThrow('已变化');
    expect(() => assertRevisionSource(context, { ...inspection, sourceRevision: 3 })).toThrow('已变化');
    expect(() => assertRevisionSource(context, { ...inspection, documentSource: undefined })).toThrow('已变化');
    expect(() => assertRevisionSource(context, { ...inspection, artifact: { ...office, projectId: 'other' } })).toThrow('已变化');
  });
  it('不把TXT、丢失文件或另一Office类型当成本轮正式导出', () => {
    const files = [office, { ...office, id: 'txt', name: '成品.txt', mimeType: 'text/plain' }, { ...office, id: 'ppt', name: '成品.pptx' }, { ...office, id: 'lost', unavailable: true }, { ...office, id: 'trash', trashedAt: '2026-11-12' }];
    expect(revisionExportFiles('word', files).map(file => file.id)).toEqual(['original']);
  });
});
