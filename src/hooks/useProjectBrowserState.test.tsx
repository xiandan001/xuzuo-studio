// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectBrowserState } from './useProjectBrowserState';
import { defaultProjectBrowserState, readProjectBrowserState, saveProjectBrowserState } from '../lib/project-browser-state';

let root: Root | undefined, host: HTMLDivElement, frames: Map<number, FrameRequestCallback>, frameId: number;
function Probe({ workspaceId, tick = 0 }: { workspaceId: string; tick?: number }) {
  const browser = useProjectBrowserState(workspaceId, 'active');
  return <div ref={browser.root}><output>{browser.state.layout}/{browser.state.query}/{browser.state.page}/{tick}</output><button onClick={() => browser.setField('query', '新搜索')}>改筛选</button><button onClick={() => browser.setField('layout', 'grid')}>改布局</button></div>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); frames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div'); host.className = 'app-content'; host.scrollTo = vi.fn((options?: ScrollToOptions | number, _y?: number) => { if (typeof options === 'object') host.scrollTop = options.top || 0; }); document.body.append(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); });
async function render(workspaceId: string, tick = 0) { await act(async () => { root ||= createRoot(host); root.render(<Probe workspaceId={workspaceId} tick={tick} />); }); }
async function flushFrames() { await act(async () => { for (let round = 0; round < 3 && frames.size; round++) { const pending = [...frames]; frames.clear(); pending.forEach(([, callback]) => callback(0)); } }); }
describe('项目列表离开返回的真实状态恢复', () => {
  it('等父级置顶后恢复滚动，父级重渲染和改布局不会丢失滚动位置', async () => {
    saveProjectBrowserState(localStorage, { ...defaultProjectBrowserState('a'), layout: 'list', query: '海报', page: 2, scrollTop: 900 });
    await render('a'); host.scrollTop = 0; await flushFrames(); expect(host.scrollTop).toBe(900);
    host.scrollTop = 1200; host.dispatchEvent(new Event('scroll')); await render('a', 1);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '改布局')!.click());
    await act(async () => root!.unmount()); root = undefined;
    expect(readProjectBrowserState(localStorage, 'a')).toMatchObject({ layout: 'grid', query: '海报', page: 2, scrollTop: 1200 });
    await render('a'); await flushFrames(); expect(host.scrollTop).toBe(1200);
  });
  it('工作区切换独立保存位置，用户变更筛选才清零页码与位置', async () => {
    saveProjectBrowserState(localStorage, { ...defaultProjectBrowserState('a'), page: 3, scrollTop: 600 });
    await render('a'); await flushFrames(); host.scrollTop = 800; host.dispatchEvent(new Event('scroll'));
    await render('b'); await flushFrames(); expect(host.scrollTop).toBe(0);
    await render('a'); await flushFrames(); expect(host.scrollTop).toBe(800);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '改筛选')!.click());
    expect(host.querySelector('output')?.textContent).toContain('新搜索/0'); expect(host.scrollTop).toBe(0);
  });
});
