// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { LiveStartResult } from '../live-types';
import type { PageProps } from '../types';
import type { NaturalAutomationDraft } from './useNaturalAutomationDraft';
import type { NaturalAutomationSession } from './useNaturalAutomationSession';
import { useChatPlanExecution } from './useChatPlanExecution';

const scope = { workspaceId: 'workspace', workflowId: 'chat-workflow' };
const projectId = 'project';
const unknown: LiveStartResult = { status: 'unknown', dispatchKey: 'a'.repeat(64), error: '等待原任务' };
const draft = { projectId, chatExecution: { workflowId: scope.workflowId } } as NaturalAutomationDraft;
const run = { id: 'original-run', mode: 'live', status: 'running', projectId, ...scope } as WorkflowRun;
let root: Root, host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('desktop', { runtime: {} });
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  const readStartResult = vi.fn<() => Promise<LiveStartResult>>().mockResolvedValue(unknown);
  const startLive = vi.fn(), setError = vi.fn();
  const props = { workspaceId: scope.workspaceId, workflowRunner: { runs: [], startLive, readStartResult } } as unknown as PageProps;
  let api: ReturnType<typeof useChatPlanExecution>, persisted = draft;
  function Harness() {
    const [value, setValue] = useState(draft);
    const current = useRef(value); current.current = value;
    const session = {
      draft: value, setError, store: { current, persist: (data: NaturalAutomationDraft) => { persisted = data; current.current = data; setValue(data); } },
    } as unknown as NaturalAutomationSession;
    api = useChatPlanExecution(props, session);
    return <div>{api.run?.id || (api.pending ? '核对中' : '可以开始')}</div>;
  }
  await act(async () => root.render(<Harness />));
  return { readStartResult, startLive, setError, draft: () => persisted, read: () => api!.read() };
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it('重新进入对话自动找回同一任务，回执写回原方案，无需手点也没有新提交', async () => {
  const f = await mount();
  f.readStartResult.mockResolvedValueOnce({ status: 'started', runId: run.id, run, recovered: true });
  await advance(300);
  expect(f.readStartResult).toHaveBeenCalledExactlyOnceWith(projectId, scope);
  expect(host.textContent).toBe(run.id);
  expect(f.draft().chatExecution).toEqual({ workflowId: scope.workflowId, runId: run.id });
  await advance(10000);
  expect(f.readStartResult).toHaveBeenCalledOnce();
  expect(f.startLive).not.toHaveBeenCalled();
});

it('自动核对次数有界，查到别的方案不解锁，只有明确未开始才让用户再次执行', async () => {
  const f = await mount();
  f.readStartResult.mockResolvedValueOnce({ status: 'started', runId: 'wrong-run', run: { ...run, id: 'wrong-run', workflowId: 'wrong-workflow' } });
  await advance(300); await advance(1500); await advance(2500); await advance(20000);
  expect(f.readStartResult).toHaveBeenCalledTimes(3);
  expect(host.textContent).toBe('核对中');
  expect(f.draft().chatExecution).toEqual({ workflowId: scope.workflowId });
  f.readStartResult.mockResolvedValueOnce({ status: 'rejected', code: 'START_NOT_FOUND', error: '尚未开始' });
  await act(async () => f.read());
  expect(f.draft().chatExecution).toBeUndefined();
  expect(host.textContent).toBe('可以开始');
  expect(f.startLive).not.toHaveBeenCalled();
});
