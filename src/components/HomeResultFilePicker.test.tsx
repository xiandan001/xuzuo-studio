// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { HomeResultFilePicker } from './HomeResultFilePicker';

let root: Root | undefined, host: HTMLDivElement;
const observed = new Map<Element, IntersectionObserverCallback>();
const file = (id: string, name: string): ArtifactMetadata => ({ id, name, projectId: 'project', runId: 'run', path: '', kind: 'image', mimeType: 'image/png', bytes: 150, createdAt: '2026-11-09T00:00:00Z' });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); observed.clear(); vi.stubGlobal('IntersectionObserver', class { callback: IntersectionObserverCallback; constructor(callback: IntersectionObserverCallback) { this.callback = callback; } observe(element: Element) { observed.set(element, this.callback); } disconnect() {} }); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); });
async function reveal() { await act(async () => { for (const [element, callback] of observed) callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); }); }
describe('多张成品的缩略图与直接选择', () => {
  it('显示真实文件名，离屏不读取，选择直接回传当前产物', async () => {
    const files = [file('white', '白底图-第一组.png'), file('poster', '宣传海报-第二组.png')], read = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' })), onSelect = vi.fn();
    await act(async () => { root = createRoot(host); root.render(<HomeResultFilePicker files={files} selectedId="white" runner={{ thumbnailArtifact: read } as unknown as WorkflowRunner} onSelect={onSelect} />); });
    expect(host.textContent).toContain('白底图-第一组.png'); expect(host.textContent).toContain('宣传海报-第二组.png'); expect(read).not.toHaveBeenCalled();
    await reveal(); await vi.waitFor(() => expect(host.querySelectorAll('img')).toHaveLength(2));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看结果 宣传海报-第二组.png"]')!.click()); expect(onSelect).toHaveBeenCalledWith('poster');
  });
  it('普通轮询产生新的runner函数时不重复读取；失败保留可选文件名', async () => {
    const files = [file('one', '细节图.png')], read = vi.fn(async (_id: string) => { throw Error('missing'); });
    const render = async () => { await act(async () => { root ||= createRoot(host); root.render(<HomeResultFilePicker files={files} selectedId="one" runner={{ thumbnailArtifact: (id: string) => read(id) } as unknown as WorkflowRunner} onSelect={vi.fn()} />); }); };
    await render(); await reveal(); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1)); await render();
    expect(read).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('细节图.png'); expect(host.querySelector('button')?.disabled).toBe(false);
  });
});
