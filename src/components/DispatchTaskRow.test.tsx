// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationBridge, AutomationDecision, AutomationJob } from '../automation-types';
import { buildDispatchTasks } from '../lib/dispatch-tasks';
import { DispatchTaskDetail, DispatchTaskRow } from './DispatchTaskRow';

const time = '2026-11-18T10:00:00Z';
const initialJob: AutomationJob = { id: 'job', ruleId: 'rule', workspaceId: 'workspace', projectId: 'project', eventId: 'event', dispatchKey: 'dispatch', status: 'decision', createdAt: time, updatedAt: time, attachmentIds: [], input: '' };
const initialDecision: AutomationDecision = { id: 'decision', kind: 'uncertain', title: '派工尚未确认', detail: '后台暂未返回运行记录。', projectId: 'project', workspaceId: 'workspace', jobId: 'job', createdAt: time };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function setup(job = initialJob, decisions = [initialDecision]) {
  const [task] = buildDispatchTasks({ revision: 1, available: true, rules: [], events: [], memories: [], jobs: [job], decisions }, [], [{ id: 'project', name: '表情包项目' }], 'workspace');
  const bridge = { resolve: vi.fn(async () => undefined), cancelJob: vi.fn(async () => undefined) };
  const refresh = vi.fn(async () => undefined), open = vi.fn();
  await act(async () => root.render(<><DispatchTaskRow task={task} onOpen={open} /><DispatchTaskDetail task={task} bridge={bridge as unknown as AutomationBridge} refresh={refresh} /></>));
  return { bridge, refresh, open };
}

const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
async function click(text: string) { await act(async () => { const target = button(text); expect(target).toBeTruthy(); target?.click(); }); }

describe('统一调度任务详情的安全操作', () => {
  it('打开摘要与刷新都只读取记录，明确继续需再次确认并保留备注及项目记忆', async () => {
    const { bridge, refresh, open } = await setup(initialJob, [{ ...initialDecision, note: '现有偏好' }]);
    expect(bridge.resolve).not.toHaveBeenCalled();
    await click('处理'); expect(open).toHaveBeenCalledOnce(); expect(bridge.resolve).not.toHaveBeenCalled();
    await click('刷新状态'); expect(bridge.resolve).toHaveBeenCalledWith({ id: initialDecision.id, action: 'refresh' }); expect(refresh).toHaveBeenCalledOnce();
    await act(async () => host.querySelector('summary')?.click());
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await click('明确继续 · 可能新增调用费');
    expect(bridge.resolve).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('可能产生费用');
    await act(async () => { const confirm = button('确认继续任务'); expect(confirm).toBeTruthy(); confirm?.click(); confirm?.click(); });
    expect(bridge.resolve).toHaveBeenCalledTimes(2);
    expect(bridge.resolve).toHaveBeenLastCalledWith({ id: initialDecision.id, action: 'continue', note: '现有偏好', remember: true });
    expect(refresh).toHaveBeenCalledTimes(2); expect(bridge.cancelJob).not.toHaveBeenCalled();
  });

  it('停止排队需明确确认，按钮不会把请求状态当作已取消', async () => {
    const { bridge, refresh } = await setup({ ...initialJob, status: 'queued' }, []);
    await click('停止任务'); expect(bridge.cancelJob).not.toHaveBeenCalled();
    await click('返回'); expect(bridge.cancelJob).not.toHaveBeenCalled();
    await click('停止任务'); await click('确认停止任务');
    expect(bridge.cancelJob).toHaveBeenCalledExactlyOnceWith(initialJob.id); expect(refresh).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('排队中'); expect(host.textContent).not.toContain('已取消');
  });

  it('取消待核对时只能刷新或再次停止，不出现继续入口', async () => {
    const job = { ...initialJob, cancellationPending: true };
    const { bridge, refresh } = await setup(job);
    expect(host.textContent).toContain('正在核对取消'); expect(button('明确继续 · 可能新增调用费')).toBeUndefined();
    bridge.resolve.mockRejectedValueOnce(new Error('取消尚未确认'));
    await click('停止任务'); await click('确认停止任务');
    expect(bridge.resolve).toHaveBeenCalledExactlyOnceWith({ id: initialDecision.id, action: 'reject', note: '', remember: false });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('取消尚未确认'); expect(refresh).toHaveBeenCalledOnce();
  });

  it('状态刷新替换待办后，旧确认不会提交新的待办', async () => {
    const previous = await setup();
    await click('明确继续 · 可能新增调用费'); expect(button('确认继续任务')).toBeTruthy();
    const current = await setup(initialJob, [{ ...initialDecision, id: 'updated-decision' }]);
    expect(button('确认继续任务')).toBeUndefined();
    expect(previous.bridge.resolve).not.toHaveBeenCalled(); expect(current.bridge.resolve).not.toHaveBeenCalled();
  });
});
