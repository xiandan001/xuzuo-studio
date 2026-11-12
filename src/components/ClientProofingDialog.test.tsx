// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactMetadata } from '../live-types';
import { ClientProofingDialog } from './ClientProofingDialog';
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Proofing UI cannot send network'); })); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function fixture() {
  const file = { id: 'image', projectId: 'project', name: '客户成品.png', mimeType: 'image/png', bytes: 1024, kind: 'image', path: '', createdAt: '' } as ArtifactMetadata;
  const create = vi.fn(async () => ({ packageId: 'package', fingerprint: 'a'.repeat(64), title: '校样', createdAt: '', pageCount: 1, artifact: { ...file, id: 'zip', mimeType: 'application/zip', name: '校样.zip' }, files: [] }));
  const importFeedback = vi.fn(async () => ({ packageId: 'package', annotations: 2, duplicate: 1, orderId: 'order', imported: true })), saveArtifact = vi.fn(async () => ({ saved: true })), close = vi.fn(), imported = vi.fn();
  Object.defineProperty(window, 'desktop', { configurable: true, value: { customerProofing: { create, importFeedback }, runtime: { saveArtifact } } });
  await act(async () => { root = createRoot(host); root.render(<ClientProofingDialog workspaceId="workspace" projectId="project" files={[file]} orderId="order" onClose={close} onImported={imported} />); });
  return { file, create, importFeedback, saveArtifact, close, imported };
}
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
describe('客户校样的入口和反馈操作', () => {
  it('明确导出后才创建真实包并另存，导入反馈能回到现有制作单', async () => {
    const f = await fixture(); expect(f.create).not.toHaveBeenCalled(); expect(f.importFeedback).not.toHaveBeenCalled();
    await click('导出校样包'); expect(f.create).toHaveBeenCalledWith({ workspaceId: 'workspace', projectId: 'project', artifactIds: ['image'], title: '作品校样', orderId: 'order' }); expect(f.saveArtifact).toHaveBeenCalledWith('zip'); expect(document.body.textContent).toContain('1 个可定位内容页');
    await click('导入客户反馈'); expect(f.importFeedback).toHaveBeenCalledWith({ workspaceId: 'workspace', projectId: 'project', packageId: 'package' }); expect(f.imported).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order' })); expect(document.body.textContent).toContain('2 条意见'); expect(document.body.textContent).toContain('1 条已导入');
  });
  it('客户取消另存时保留已生成包，后台失败解除禁用并展示可读错误', async () => {
    const f = await fixture(); f.saveArtifact.mockResolvedValueOnce({ saved: false }); await click('导出校样包'); expect(document.body.textContent).toContain('校样包已保存在项目中');
    f.importFeedback.mockRejectedValueOnce(Error('原稿SHA不匹配')); await click('导入客户反馈'); expect(document.querySelector('[role=alert]')?.textContent).toContain('原稿SHA不匹配'); expect(f.imported).not.toHaveBeenCalled();
    expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('导入客户反馈'))!.disabled).toBe(false);
  });
});
