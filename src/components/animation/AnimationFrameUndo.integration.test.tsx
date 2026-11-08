// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationStudio } from '../../pages/AnimationStudio';
import { animationArtifact, animationBackend, animationCleanup, animationDomSetup, animationMount, button, click, fill } from './animation-test-fixtures';
beforeEach(() => { animationDomSetup(); vi.useFakeTimers(); });
afterEach(async () => { await animationCleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('工作台选择单帧撤销的实际界面接线', () => {
  it('AI精修后只撤当前帧源图，保留另条目后改文案、另一帧时长和费用', async () => {
    const b = animationBackend({ ready: true, count: 2 });
    b.document.entries[0].frames[0].crop = [20, 20, 200, 200];
    const original = structuredClone(b.document.entries[0].frames[0]), ledger = structuredClone(b.props.ledger);
    b.bridge.refine = vi.fn(async () => { b.artifacts.push(animationArtifact('repaired-atlas')); b.document = { ...b.document, revision: b.document.revision + 1, entries: b.document.entries.map((entry, index) => index ? entry : { ...entry, frames: entry.frames.map((frame, position) => position ? frame : { ...frame, atlasArtifactId: 'repaired-atlas', cell: [0, 0], grid: [1, 1], crop: undefined }) }) }; return b.snapshot(); });
    Object.defineProperty(window, 'desktop', { configurable: true, value: { animation: b.bridge } });
    const { host } = await animationMount(<AnimationStudio props={b.props} project={b.project} initialMode="gif" />);
    await click([...host.querySelectorAll('summary')].find(item => item.textContent?.includes('关键帧与裁切'))!);
    await click(host.querySelector<HTMLElement>('[aria-label="选择关键帧 1"]')!);
    await click([...host.querySelectorAll('summary')].find(item => item.textContent?.includes('AI 局部修复'))!);
    await fill(host, '动画局部修改要求', '只修复这一帧手部'); await click(button(host, '只修选中帧'));
    expect(b.bridge.refine).toHaveBeenCalledOnce();
    await click(host.querySelector<HTMLElement>('[aria-label="选择关键帧 2"]')!);
    await fill(host, '选中帧时长（毫秒）', '310');
    await act(async () => host.querySelector('[aria-label="选中帧时长（毫秒）"]')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await click(host.querySelector<HTMLElement>('[aria-label="选择角色条目 2"]')!); await fill(host, '当前条目文案', '另一条目后来修改');
    await click(host.querySelector<HTMLElement>('[aria-label="选择角色条目 1"]')!); await click(host.querySelector<HTMLElement>('[aria-label="选择关键帧 1"]')!);
    expect(button(host, '撤销此帧画面').disabled).toBe(false); await click(button(host, '撤销此帧画面')); await click(button(host, '保存编辑'));
    expect(b.document.entries[0].frames[0]).toEqual(original);
    expect(b.document.entries[0].frames[1].durationMs).toBe(310); expect(b.document.entries[1].caption).toBe('另一条目后来修改');
    expect(button(host, '重做此帧画面').disabled).toBe(false); await click(button(host, '重做此帧画面')); await click(button(host, '保存编辑'));
    expect(b.document.entries[0].frames[0]).toMatchObject({ atlasArtifactId: 'repaired-atlas', cell: [0, 0], grid: [1, 1] }); expect(b.document.entries[0].frames[0].crop).toBeUndefined();
    expect(b.document.entries[0].frames[1].durationMs).toBe(310); expect(b.document.entries[1].caption).toBe('另一条目后来修改');
    expect(b.props.ledger).toEqual(ledger); expect(b.bridge.refine).toHaveBeenCalledOnce(); expect(b.bridge.generate).not.toHaveBeenCalled(); expect(b.bridge.compose).not.toHaveBeenCalled();
  });
});
