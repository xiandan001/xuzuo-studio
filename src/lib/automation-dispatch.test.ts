import { describe, expect, it, vi } from 'vitest';
import type { AutomationBridge, AutomationJob } from '../automation-types';
import { automationDispatchKey, dispatchAutomationOnce, readAutomationDispatch } from './automation-dispatch';

const job = (id: string, status: AutomationJob['status'] = 'queued'): AutomationJob => ({ id, ruleId: 'rule', workspaceId: 'workspace', projectId: 'project', eventId: 'event', dispatchKey: id, status, createdAt: '2026-11-04T00:00:00Z', updatedAt: '', attachmentIds: [], input: '' });
function fixture() {
  const values = new Map<string, string>(), jobs: AutomationJob[] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const trigger = vi.fn(async () => { expect(values.get(automationDispatchKey('workspace', 'rule'))).toBeTruthy(); const next = job('new-job'); jobs.push(next); return next; });
  const bridge = { snapshot: vi.fn(async () => ({ jobs: [...jobs] })), trigger } as unknown as AutomationBridge;
  return { values, jobs, storage, trigger, bridge };
}
describe('自动化明确执行与未知受理恢复', () => {
  it('派发前记录只读恢复标记，成功后保留job引用；重复查看不再次触发', async () => {
    const test = fixture(); const first = await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule', { reuseCompleted: true }); expect(first.status).toBe('started');
    expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule', { reuseCompleted: true })).status).toBe('existing'); expect(test.trigger).toHaveBeenCalledTimes(1);
  });
  it('Native已受理但ACK丢失时免费读取同job，不重发', async () => {
    const test = fixture(); test.trigger.mockImplementation(async () => { test.jobs.push(job('accepted-before-error')); throw Error('ACK lost'); });
    const result = await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule'); expect(result).toMatchObject({ status: 'existing', job: { id: 'accepted-before-error' } }); expect(test.trigger).toHaveBeenCalledTimes(1);
  });
  it('未知ACK且暂时查不到任务，重开后仍只读，不把缺失回执当成未收费', async () => {
    const test = fixture(); test.trigger.mockRejectedValue(Error('unknown')); expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule')).status).toBe('unknown');
    expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule')).status).toBe('unknown'); expect(test.trigger).toHaveBeenCalledTimes(1);
    test.jobs.push(job('late-job', 'complete')); expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule', { reuseCompleted: true })).job?.id).toBe('late-job'); expect(test.trigger).toHaveBeenCalledTimes(1);
  });
  it('保存本地提交标记失败时不会触发供应商执行', async () => {
    const test = fixture(); await expect(dispatchAutomationOnce(test.bridge, { ...test.storage, setItem: () => { throw Error('quota'); } }, 'workspace', 'rule')).rejects.toThrow('quota'); expect(test.trigger).not.toHaveBeenCalled();
  });
  it('迟迟不返回的trigger有界结束并保留只读未知回执，不会挂住界面或自动重发', async () => {
    vi.useFakeTimers();
    try { const test = fixture(); test.trigger.mockImplementation(() => new Promise(() => undefined)); const result = dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule'); await vi.advanceTimersByTimeAsync(8000); expect((await result).status).toBe('unknown'); expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule')).status).toBe('unknown'); expect(test.trigger).toHaveBeenCalledTimes(1); }
    finally { vi.useRealTimers(); }
  });
  it('读取旧任务期间切换作用域会取消本次提交，不创建待执行意图', async () => {
    const test = fixture(); expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule', { isCurrent: () => false })).status).toBe('failed'); expect(test.trigger).not.toHaveBeenCalled(); expect(test.values.size).toBe(0);
  });
  it('已完成任务默认可免费查看，只有明确再运行才创建新任务', async () => {
    const test = fixture(); test.jobs.push(job('finished', 'complete')); expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule', { reuseCompleted: true })).job?.id).toBe('finished'); expect(test.trigger).not.toHaveBeenCalled();
    expect((await dispatchAutomationOnce(test.bridge, test.storage, 'workspace', 'rule', { reuseCompleted: false })).status).toBe('started'); expect(test.trigger).toHaveBeenCalledTimes(1);
  });
  it('坏提交记录不被忽略或覆盖，别区任务不能确认本次受理', () => {
    const test = fixture(), key = automationDispatchKey('workspace', 'rule'); test.values.set(key, '{bad'); expect(() => readAutomationDispatch(test.storage, 'workspace', 'rule', [])).toThrow(); expect(test.values.get(key)).toBe('{bad');
    test.values.set(key, JSON.stringify({ version: 1, workspaceId: 'workspace', ruleId: 'rule', beforeJobIds: [] })); expect(readAutomationDispatch(test.storage, 'workspace', 'rule', [{ ...job('other'), workspaceId: 'elsewhere' }]).unknown).toBe(true);
  });
});
