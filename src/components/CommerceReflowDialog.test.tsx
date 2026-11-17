// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceImagesBridge, CommerceReflowPreview, CommerceReflowResult } from '../commerce-image-types';
import { CommerceReflowDialog } from './CommerceReflowDialog';
let root: Root | undefined, host: HTMLDivElement;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network in local reflow dialog'); })); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function button(text: string) { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text || node.getAttribute('aria-label') === text); if (!result) throw Error('Missing button: ' + text); return result; }
async function click(text: string) { await act(async () => button(text).click()); }
async function check(label: string) { const item = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`); expect(item).toBeTruthy(); await act(async () => item!.click()); }
async function mounted(override: Partial<CommerceImagesBridge> = {}) {
  const preview = vi.fn(async (input: Parameters<NonNullable<CommerceImagesBridge['reflowPreview']>>[0]) => ({ previewId: 'preview', sourceRevision: 3, targets: input.targets.map((target, index) => ({ ...target, id: `target-${index}`, document: {}, previewDataUrl: image, warnings: [] })) } as unknown as CommerceReflowPreview)), exported = vi.fn(async () => ({ documentId: 'derived', sourceRevision: 3, runId: 'local-export', artifacts: [], variants: [0, 1, 2].map(index => ({ targetId: `target-${index}`, documentId: `layout-${index}`, width: 100, height: 100, artifactIds: [] })) } as CommerceReflowResult)), cancel = vi.fn(async () => {}), onExport = vi.fn(), onClose = vi.fn();
  const bridge = { reflowPreview: preview, reflowExport: exported, cancelPreview: cancel, ...override } as CommerceImagesBridge;
  root = createRoot(host); await act(async () => root!.render(<CommerceReflowDialog scope={{ projectId: 'project', sourceArtifactId: 'source', documentId: 'original-layout' }} revision={3} bridge={bridge} onClose={onClose} onExport={onExport} />));
  return { preview, exported, cancel, onExport, onClose };
}
describe('逐目标检查的本地多比例排版', () => {
  it('先只预览，逐版明确确认才可导出，并传原稿scope/revision与全部目标凭据', async () => {
    const ui = await mounted(); expect(button('生成 3 版预览').disabled).toBe(false); await click('生成 3 版预览'); expect(ui.preview).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project', sourceArtifactId: 'source', documentId: 'original-layout', expectedRevision: 3, requestId: expect.any(String) })); expect(ui.exported).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.commerce-reflow-previews article')).toHaveLength(3); expect(button('确认并导出 3 版').disabled).toBe(true);
    await check('确认正方形 · 1:1版式'); await check('确认竖版 · 3:4版式'); expect(button('确认并导出 3 版').disabled).toBe(true); await check('确认横版 · 16:9版式'); await click('确认并导出 3 版');
    expect(ui.exported).toHaveBeenCalledWith({ projectId: 'project', sourceArtifactId: 'source', documentId: 'original-layout', expectedRevision: 3, previewId: 'preview', approvedTargetIds: ['target-0', 'target-1', 'target-2'] }); expect(ui.onExport).toHaveBeenCalledTimes(1); expect(ui.onClose).toHaveBeenCalledTimes(1);
  });
  it('改目标会清除旧预览和旧确认，重复尺寸给出可处理提示', async () => {
    const ui = await mounted(); await click('生成 3 版预览'); await check('确认正方形 · 1:1版式');
    const custom = [...document.querySelectorAll<HTMLLabelElement>('.commerce-reflow-presets label')].find(label => label.textContent?.includes('自定义'))!.querySelector<HTMLInputElement>('input')!; await act(async () => custom.click()); expect(document.querySelector('.commerce-reflow-previews')).toBeNull(); expect(button('生成 4 版预览').disabled).toBe(false);
    for (const label of ['重排自定义宽度', '重排自定义高度']) { const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1080'); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
    expect(document.body.textContent).toContain('重复'); expect(button('生成 4 版预览').disabled).toBe(true); expect(ui.exported).not.toHaveBeenCalled();
  });
  it('取消未完成预览只取消本地request，晚回包不导出或重开窗口', async () => {
    let release!: (value: CommerceReflowPreview) => void; const slow = vi.fn(() => new Promise<CommerceReflowPreview>(resolve => { release = resolve; })); const ui = await mounted({ reflowPreview: slow }); await click('生成 3 版预览'); const input = slow.mock.calls[0] as unknown as [{ requestId: string }]; await click('取消预览'); expect(ui.cancel).toHaveBeenCalledWith({ projectId: 'project', requestId: input[0].requestId }); expect(ui.onClose).toHaveBeenCalledOnce();
    await act(async () => root!.unmount()); root = undefined; await act(async () => release({ previewId: 'late', sourceRevision: 3, targets: [] })); expect(ui.exported).not.toHaveBeenCalled(); expect(ui.onExport).not.toHaveBeenCalled();
  });
});
