// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import { saveDocumentRevisionContext, readDocumentRevisionContext } from '../lib/document-revision-context';
import { DocumentRevisionPanel } from './DocumentRevisionPanel';

let root: Root | undefined, host: HTMLDivElement;
const original = { id: 'old', projectId: 'p', name: '原版.docx', kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100 } as ArtifactMetadata;
const exported = { ...original, id: 'new', name: '成品-2026-11-12.docx' };
const context = { version: 1 as const, workspaceId: 'w', projectId: 'p', orderId: 'o', feedbackId: 'f', kind: 'word' as const, sourceArtifactId: 'old', sourceSha256: 'a'.repeat(64), sourceRevision: 2 };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); sessionStorage.clear(); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); });
async function fixture(options: { dirty?: boolean; linked?: boolean; revision?: number; exportedRevision?: number; artifacts?: ArtifactMetadata[] } = {}) {
  const order = { id: 'o', name: '制作单', recipe: 'documents', outputIds: ['old'] }, feedback = { id: 'f', orderId: 'o', status: 'approved', target: { projectId: 'p', artifactId: 'old' } };
  const snapshot = vi.fn(async () => ({ orders: [order], feedback: [feedback] }));
  const adoptRevision = vi.fn(async () => ({ state: { orders: [{ ...order, outputIds: ['new'] }], feedback: [{ ...feedback, status: 'confirmed' }] }, projects: [{ id: 'p', name: '已修订' }] }));
  const inspectTarget = vi.fn(async () => ({ artifact: original, sha256: context.sourceSha256, sourceRevision: 2, documentSource: '{}' }));
  const notify = vi.fn(), onOpenBusiness = vi.fn(), onUpdateProject = vi.fn(), onLoadSource = vi.fn();
  Object.defineProperty(window, 'desktop', { configurable: true, value: { business: { snapshot, adoptRevision }, chat: { inspectTarget } } });
  saveDocumentRevisionContext(sessionStorage, context);
  const props = { workspaceId: 'w', activeProject: { id: 'p', kind: 'word' }, notify, onOpenBusiness, onUpdateProject } as unknown as PageProps;
  root = createRoot(host);
  const render = async (next = options) => { await act(async () => root!.render(<DocumentRevisionPanel props={props} ready busy={false} dirty={next.dirty || false} revision={next.revision ?? 4} sourceArtifactIds={next.linked === false ? [] : ['old']} exportedRevision={next.exportedRevision ?? 4} exportedArtifacts={next.artifacts || [exported]} onLoadSource={onLoadSource} />)); };
  await render(); return { adoptRevision, inspectTarget, onLoadSource, notify, onOpenBusiness, onUpdateProject, render };
}
const adoptButton = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('采用并完成本轮'))!;
describe('文档返修导出与真实采用闭环', () => {
  it('不自动采用；当前稿未保存、缺原稿关联或导出不是当前版时不能完成本轮', async () => {
    const f = await fixture({ dirty: true }); expect(adoptButton().disabled).toBe(true); expect(f.adoptRevision).not.toHaveBeenCalled();
    await f.render({ linked: false }); expect(adoptButton().disabled).toBe(true);
    await f.render({ exportedRevision: 3 }); expect(adoptButton().disabled).toBe(true);
    await f.render({ artifacts: [{ ...exported, name: 'result.txt', mimeType: 'text/plain' }] }); expect(adoptButton().disabled).toBe(true);
  });
  it('核对后调用原子采用，传原SHA和两个版本，后台确认后才返回反馈', async () => {
    const f = await fixture(); await act(async () => adoptButton().click());
    expect(f.adoptRevision).toHaveBeenCalledWith({ workspaceId: 'w', orderId: 'o', feedbackId: 'f', sourceArtifactId: 'old', sourceSha256: 'a'.repeat(64), sourceRevision: 2, exportRevision: 4, artifactIds: ['new'] });
    expect(f.onOpenBusiness).toHaveBeenCalledWith('documents', 'o');
    expect(readDocumentRevisionContext(sessionStorage, 'w', 'p')).toBeUndefined();
  });
  it('采用失败保留上下文和正式导出，重试不重新生成或导出', async () => {
    const f = await fixture(); f.adoptRevision.mockRejectedValueOnce(Error('确认超时'));
    await act(async () => adoptButton().click());
    expect(host.textContent).toContain('确认超时'); expect(readDocumentRevisionContext(sessionStorage, 'w', 'p')).toEqual(context); expect(f.onOpenBusiness).not.toHaveBeenCalled();
    await act(async () => adoptButton().click()); expect(f.adoptRevision).toHaveBeenCalledTimes(2); expect(f.inspectTarget).not.toHaveBeenCalled(); expect(f.onOpenBusiness).toHaveBeenCalledTimes(1);
  });
  it('明确载入时先验证原文件SHA，不匹配时不触碰编辑草稿', async () => {
    const f = await fixture({ linked: false }); f.inspectTarget.mockResolvedValueOnce({ artifact: original, sha256: 'b'.repeat(64), sourceRevision: 2, documentSource: '{}' });
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('载入返修原版'))!;
    await act(async () => button.click()); expect(f.onLoadSource).not.toHaveBeenCalled(); expect(host.textContent).toContain('已变化');
  });
});
