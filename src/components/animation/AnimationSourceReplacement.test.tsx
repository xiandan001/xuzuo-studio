// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRunner } from '../../configuration-types';
import type { ArtifactMetadata } from '../../live-types';
import { newAnimationDocument } from '../../lib/animation-document';
import { AnimationSourceReplacement } from './AnimationSourceReplacement';
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls in local source replacement'); })); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 410, bottom: 60, width: 400, height: 50, toJSON() {} }); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function button(label: string) { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label); if (!result) throw Error('Missing button ' + label); return result; }
async function click(label: string) { await act(async () => button(label).click()); }
async function mounted(width = 64, height = 32) {
  const source = { id: 'old-atlas', name: '已改名的透明图片.png', projectId: 'project', runId: 'local-import', kind: 'image', mimeType: 'image/png', bytes: 68, path: 'managed', createdAt: '' } as ArtifactMetadata, replacement = { ...source, id: 'replacement', name: '新人物动作图集.png', runId: 'local-import' }, document = newAnimationDocument('project'); document.width = 32; document.height = 32; document.loopMs = 400; document.entries[0].frames = [{ id: 'first', atlasArtifactId: source.id, cell: [0, 0], grid: [2, 1], crop: [0, 0, 32, 32], durationMs: 150, templatePlaceholder: true }, { id: 'second', atlasArtifactId: source.id, cell: [1, 0], grid: [2, 1], durationMs: 250, templatePlaceholder: true }];
  const onChange = vi.fn(), onIssue = vi.fn(), onBusyChange = vi.fn(), runner = { importFiles: vi.fn(async () => [replacement]), thumbnailArtifact: vi.fn(async () => ({ mimeType: 'image/png', width, height, originalWidth: width, originalHeight: height })) } as unknown as WorkflowRunner;
  root = createRoot(host); await act(async () => root!.render(<AnimationSourceReplacement document={document} entry={document.entries[0]} frameId="first" artifacts={[source]} runner={runner} disabled={false} onChange={onChange} onIssue={onIssue} onBusyChange={onBusyChange} />));
  await click('上传替换图集／源帧'); await click('新的动画图集或源帧'); const option = [...window.document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes('新人物动作图集'))!; expect(option).toBeTruthy(); await act(async () => option.click()); return { document, onChange, onIssue, onBusyChange, runner };
}
describe('模板角色源替换的明确用途与免费交互', () => {
  it('兼容图集必须明确确认；只本地改引用并保留网格与停顿，不自动生成动作', async () => {
    const ui = await mounted(); expect(host.querySelector('details')?.open).toBe(true); expect(host.textContent).toContain('不会自动补出新动作'); expect(button('替换所有使用此图集的帧').disabled).toBe(true); expect(ui.onChange).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLInputElement>('.animation-source-confirm input')!.click()); await click('替换所有使用此图集的帧'); const changed = ui.onChange.mock.calls[0][0]; expect(changed.entries[0].frames.map((frame: { durationMs: number }) => frame.durationMs)).toEqual([150, 250]); expect(changed.entries[0].frames.every((frame: { atlasArtifactId: string; templatePlaceholder?: boolean }) => frame.atlasArtifactId === 'replacement' && !frame.templatePlaceholder)).toBe(true); expect(changed.entries[0].frames[0].crop).toEqual([0, 0, 32, 32]); expect(ui.onIssue).not.toHaveBeenCalled();
  });
  it('静态图只替换当前源帧时保持其余姿态；尺寸不兼容的图集给出修复提示', async () => {
    const ui = await mounted(16, 16); await act(async () => host.querySelector<HTMLInputElement>('.animation-source-confirm input')!.click()); await click('替换所有使用此图集的帧'); expect(ui.onChange).not.toHaveBeenCalled(); expect(ui.onIssue.mock.calls[0][0]).toContain('不兼容');
    await click('只替换当前选帧为完整图片'); const changed = ui.onChange.mock.calls[0][0]; expect(changed.entries[0].frames).toHaveLength(2); expect(changed.entries[0].frames[0]).toMatchObject({ atlasArtifactId: 'replacement', grid: [1, 1], cell: [0, 0], durationMs: 150 }); expect(changed.entries[0].frames[1]).toEqual(ui.document.entries[0].frames[1]);
  });
});
