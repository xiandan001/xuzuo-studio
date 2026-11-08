// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationDocument, AnimationFrame } from '../../animation-types';
import { newAnimationDocument } from '../../lib/animation-document';
import { animationBackend, animationCleanup, animationDomSetup, animationMount } from './animation-test-fixtures';
import { useAnimationFrameHistory } from './useAnimationFrameHistory';

let current: ReturnType<typeof useAnimationFrameHistory>;
function Probe({ projectId }: { projectId: string }) { current = useAnimationFrameHistory(projectId); return <span>frame history only</span>; }
const frame = (id: string, atlasArtifactId = 'old-atlas'): AnimationFrame => ({ id, atlasArtifactId, cell: [1, 0], grid: [2, 1], crop: [100, 0, 200, 100], durationMs: 300 });
function document(projectId = 'project-a'): AnimationDocument { const value = newAnimationDocument(projectId); return { ...value, revision: 7, entries: [{ ...value.entries[0], id: 'first-entry', caption: '第一条', frames: [frame('first-frame'), frame('second-frame')], status: 'ready', outputArtifactId: 'old-output', coverArtifactId: 'old-cover', inspection: { width: 512, height: 512, frames: 6, loopMs: 1800, transparent: true, warnings: [] } }, { ...value.entries[0], id: 'second-entry', caption: '第二条', frames: [frame('first-frame')], status: 'ready' }] }; }
function repaint(value: AnimationDocument, entryId = 'first-entry', frameId = 'first-frame', atlasArtifactId = 'new-atlas'): AnimationDocument { return { ...value, entries: value.entries.map(entry => entry.id !== entryId ? entry : { ...entry, frames: entry.frames.map(item => { if (item.id !== frameId) return item; const next = { ...item, atlasArtifactId, cell: [0, 0] as [number, number], grid: [1, 1] as [number, number] }; delete next.crop; return next; }) }) }; }
beforeEach(animationDomSetup);
afterEach(async () => { await animationCleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('选中单帧的源画面撤销/重做（真实React，不调用模型或原生接口）', () => {
  it('恢复AI前的图集/格位/裁切，保留其它条目后来文案、其它帧时长和当前帧时长', async () => {
    const backend = animationBackend(); Object.defineProperty(window, 'desktop', { configurable: true, value: { animation: backend.bridge } });
    const ledger = Object.freeze([{ id: 'already-paid', costCents: 89 }]), ledgerBefore = JSON.stringify(ledger);
    await animationMount(<Probe projectId="project-a" />); const before = document(), after = repaint(before);
    await act(async () => current.record(before, after));
    const later = { ...after, entries: after.entries.map(entry => entry.id === 'second-entry' ? { ...entry, caption: '后来修改的另一条文案' } : { ...entry, frames: entry.frames.map(item => ({ ...item, durationMs: item.id === 'first-frame' ? 410 : 530 })) }) };
    expect(current.canUndo(later, 'first-entry', 'first-frame')).toBe(true); let undone: AnimationDocument | undefined;
    await act(async () => { undone = current.undo(later, 'first-entry', 'first-frame'); });
    expect(undone?.entries[0].frames[0]).toEqual({ ...before.entries[0].frames[0], durationMs: 410 });
    expect(undone?.entries[0].frames[1]).toBe(later.entries[0].frames[1]); expect(undone?.entries[1]).toBe(later.entries[1]);
    expect(undone?.entries[0]).toMatchObject({ status: 'stale', outputArtifactId: 'old-output', coverArtifactId: 'old-cover' }); expect(undone?.revision).toBe(7);
    expect(current.canRedo(undone!, 'first-entry', 'first-frame')).toBe(true); let redone: AnimationDocument | undefined;
    await act(async () => { redone = current.redo(undone!, 'first-entry', 'first-frame'); });
    expect(redone?.entries[0].frames[0]).toEqual({ ...after.entries[0].frames[0], durationMs: 410 }); expect(redone?.entries[0].frames[0].crop).toBeUndefined(); expect(redone?.entries[1]).toBe(later.entries[1]);
    expect(JSON.stringify(ledger)).toBe(ledgerBefore); expect(backend.bridge.generate).not.toHaveBeenCalled(); expect(backend.bridge.refine).not.toHaveBeenCalled(); expect(backend.bridge.compose).not.toHaveBeenCalled(); expect(backend.bridge.save).not.toHaveBeenCalled();
  });
  it('源画面不变的进度、成品ID和其它文字变化不进入局部历史，新建帧不伪造旧版', async () => {
    await animationMount(<Probe projectId="project-a" />); const before = document(), after = { ...before, revision: 9, entries: before.entries.map(entry => ({ ...entry, caption: '另存文案', outputArtifactId: 'latest-output', frames: [...entry.frames, frame('added-frame')] })) };
    await act(async () => current.record(before, after)); expect(current.canUndo(after, 'first-entry', 'first-frame')).toBe(false); expect(current.canUndo(after, 'first-entry', 'added-frame')).toBe(false);
  });
  it('同名frame ID在不同entry互相隔离，删除/替换帧及外项目文档无法撤销', async () => {
    await animationMount(<Probe projectId="project-a" />); const before = document(), after = repaint(before);
    await act(async () => current.record(before, after)); expect(current.canUndo(after, 'second-entry', 'first-frame')).toBe(false);
    const removed = { ...after, entries: after.entries.map(entry => ({ ...entry, frames: entry.frames.filter(item => item.id !== 'first-frame') })) };
    expect(current.canUndo(removed, 'first-entry', 'first-frame')).toBe(false); expect(current.undo(removed, 'first-entry', 'first-frame')).toBeUndefined();
    expect(current.canUndo({ ...after, projectId: 'foreign' }, 'first-entry', 'first-frame')).toBe(false); expect(current.redo({ ...after, projectId: 'foreign' }, 'first-entry', 'first-frame')).toBeUndefined();
  });
  it('当前源画面与栈顶不一致时拒绝覆盖，并保留原撤销记录', async () => {
    await animationMount(<Probe projectId="project-a" />); const before = document(), after = repaint(before);
    await act(async () => current.record(before, after)); const external = repaint(after, 'first-entry', 'first-frame', 'another-native-source');
    expect(current.canUndo(external, 'first-entry', 'first-frame')).toBe(false); expect(current.undo(external, 'first-entry', 'first-frame')).toBeUndefined();
    expect(current.canUndo(after, 'first-entry', 'first-frame')).toBe(true); let value: AnimationDocument | undefined; await act(async () => { value = current.undo(after, 'first-entry', 'first-frame'); }); expect(value?.entries[0].frames[0].atlasArtifactId).toBe('old-atlas');
  });
  it('局部撤销后新编辑会清除该scope的重做，记录快照不共享可变数组', async () => {
    await animationMount(<Probe projectId="project-a" />); const before = document(), after = repaint(before), expected = structuredClone(after);
    await act(async () => current.record(before, after)); before.entries[0].frames[0].cell[0] = 9; before.entries[0].frames[0].crop![0] = 900;
    let undone: AnimationDocument | undefined; await act(async () => { undone = current.undo(expected, 'first-entry', 'first-frame'); }); expect(undone?.entries[0].frames[0].cell).toEqual([1, 0]); expect(undone?.entries[0].frames[0].crop).toEqual([100, 0, 200, 100]);
    const branch = repaint(undone!, 'first-entry', 'first-frame', 'branch-source'); await act(async () => current.record(undone!, branch)); expect(current.canRedo(branch, 'first-entry', 'first-frame')).toBe(false);
  });
  it('每帧最多保留24步，撤销重做都精确停在边界', async () => {
    await animationMount(<Probe projectId="project-a" />); let value = document();
    await act(async () => { for (let index = 1; index <= 30; index++) { const next = repaint(value, 'first-entry', 'first-frame', `atlas-${index}`); current.record(value, next); value = next; } });
    await act(async () => { for (let index = 0; index < 24; index++) value = current.undo(value, 'first-entry', 'first-frame')!; });
    expect(value.entries[0].frames[0].atlasArtifactId).toBe('atlas-6'); expect(current.canUndo(value, 'first-entry', 'first-frame')).toBe(false);
    await act(async () => { for (let index = 0; index < 24; index++) value = current.redo(value, 'first-entry', 'first-frame')!; }); expect(value.entries[0].frames[0].atlasArtifactId).toBe('atlas-30'); expect(current.canRedo(value, 'first-entry', 'first-frame')).toBe(false);
  });
  it('最多保留64个scope并淘汰最早帧，StrictMode同一变更重复通知不会重复入栈', async () => {
    await animationMount(<StrictMode><Probe projectId="project-a" /></StrictMode>); const before = { ...document(), entries: [{ ...document().entries[0], frames: Array.from({ length: 65 }, (_, index) => ({ ...frame(`frame-${index}`), durationMs: 10 })) }] }, after = { ...before, entries: [{ ...before.entries[0], frames: before.entries[0].frames.map(item => ({ ...item, atlasArtifactId: 'new-atlas' })) }] };
    await act(async () => { current.record(before, after); current.record(before, after); }); expect(current.canUndo(after, 'first-entry', 'frame-0')).toBe(false); expect(current.canUndo(after, 'first-entry', 'frame-64')).toBe(true);
    let undone: AnimationDocument | undefined; await act(async () => { undone = current.undo(after, 'first-entry', 'frame-64'); }); expect(current.canUndo(undone!, 'first-entry', 'frame-64')).toBe(false);
  });
  it('项目切换清历史，旧回调不能清除新项目记录，显式clear可用', async () => {
    const { root } = await animationMount(<Probe projectId="project-a" />); const old = current, before = document(), after = repaint(before); await act(async () => old.record(before, after));
    await act(async () => root.render(<Probe projectId="project-b" />)); expect(current.canUndo(after, 'first-entry', 'first-frame')).toBe(false);
    const b = document('project-b'), next = repaint(b); await act(async () => { current.record(b, next); old.clear(); old.record(before, after); }); expect(current.canUndo(next, 'first-entry', 'first-frame')).toBe(true);
    await act(async () => current.clear()); expect(current.canUndo(next, 'first-entry', 'first-frame')).toBe(false);
  });
  it('卸载后旧异步回调不能恢复历史或更新组件', async () => {
    await animationMount(<Probe projectId="project-a" />); const api = current, before = document(), after = repaint(before);
    await act(async () => api.record(before, after)); expect(api.canUndo(after, 'first-entry', 'first-frame')).toBe(true);
    await animationCleanup(); await act(async () => api.record(before, after)); expect(api.canUndo(after, 'first-entry', 'first-frame')).toBe(false); expect(api.undo(after, 'first-entry', 'first-frame')).toBeUndefined();
  });
});
