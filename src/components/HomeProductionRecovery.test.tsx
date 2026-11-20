// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { HomeProductionRecovery } from './HomeProductionRecovery';

let root: Root | undefined, host: HTMLDivElement, desktop: PropertyDescriptor | undefined;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); desktop = Object.getOwnPropertyDescriptor(window, 'desktop'); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); if (desktop) Object.defineProperty(window, 'desktop', desktop); else delete window.desktop; vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(label)); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function render(status: WorkflowRun['status'], changes: Partial<WorkflowRun> = {}) {
  const run = { id: 'run', workspaceId: 'workspace', projectId: 'project', status, ...changes } as WorkflowRun;
  const project = { id: 'project', workspaceId: 'workspace', kind: 'image' } as Project;
  const fresh = { ...run, status: 'complete' as const }, read = vi.fn(async () => fresh), control = vi.fn(async (_input: Parameters<NonNullable<typeof window.desktop>['runtime']['control']>[0]) => undefined), onRead = vi.fn(), navigate = vi.fn();
  const props = { workspaceId: 'workspace', configuration: { connections: [], models: [] }, workflowRunner: {}, navigate } as unknown as PageProps;
  Object.defineProperty(window, 'desktop', { configurable: true, value: { runtime: { control, runDetail: read } } });
  await act(async () => { root = createRoot(host); root.render(<HomeProductionRecovery run={run} project={project} props={props} onRead={onRead} />); });
  return { control, read, onRead, navigate, fresh };
}
describe('首页异常任务就地处理', () => {
  it('重新读取只读状态，不重试或重新调用模型', async () => {
    const f = await render('failed'); await click('重新读取状态');
    expect(f.control).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledWith('run'); expect(f.onRead).toHaveBeenCalledWith(f.fresh);
  });
  it('暂停使用resume，失败使用continue，保留新增调用费用说明', async () => {
    const f = await render('paused'); expect(host.textContent).toContain('会新增费用'); await click('继续制作');
    expect(f.control).toHaveBeenCalledWith(expect.objectContaining({ id: 'run', action: 'resume', project: expect.objectContaining({ id: 'project' }) }));
    expect(f.onRead).toHaveBeenCalledWith(f.fresh);
  });
  it('任务有来源缺失时直接定位参考资料，不提供盲目继续', async () => {
    const f = await render('failed', { referenceIssue: { sourceStepId: 'source', reason: 'missing' } });
    expect(host.textContent).not.toContain('继续制作'); await click('修复参考资料'); expect(f.navigate).toHaveBeenCalledWith('images', 'project'); expect(f.control).not.toHaveBeenCalled();
  });
  it('账户或Key异常定位模型设置，已取消任务不会误给继续按钮', async () => {
    const f = await render('failed', { error: '凭证无效 HTTP 401' }); await click('修复模型设置'); expect(f.navigate).toHaveBeenCalledWith('models', 'project'); expect(f.control).not.toHaveBeenCalled();
  });
  it.each([2048, 1600])('旧记录输出 %i Token 后未完整返回时，继续原任务并只在达到上限时提高本步骤上限', async outputTokens => {
    const error = '模型未完整生成结果，可能达到上限或仍需继续处理；已保留返回片段与用量，未自动重试。';
    const f = await render('failed', {
      error,
      stepIndex: 1,
      snapshot: { steps: [{ id: 'plan' }, { id: 'check', kind: 'vision', enabled: true }] } as WorkflowRun['snapshot'],
      attempts: [{ stepId: 'plan', status: 'complete' }, { stepId: 'check', status: 'failed', error, usage: { outputTokens } }] as WorkflowRun['attempts'],
    });
    expect(host.textContent).not.toContain('修复模型设置');
    expect(host.textContent?.includes('从 2048 提高到 4096 Token')).toBe(outputTokens === 2048);
    expect(f.control).not.toHaveBeenCalled();
    await click(outputTokens === 2048 ? '继续当前步骤' : '继续制作');
    const request = f.control.mock.calls[0][0];
    expect(request).toMatchObject({ id: 'run', action: 'continue' });
    expect(request.stepMaxOutputTokens).toBe(outputTokens === 2048 ? 4096 : undefined);
  });
  it('明确的输出截断给新核对预算预选小步提高，仍等用户点击后才发送', async () => {
    const f = await render('failed', {
      stepIndex: 0,
      snapshot: { steps: [{ id: 'review', name: '检查图片', kind: 'vision', enabled: true, maxOutputTokens: 4096 }] } as WorkflowRun['snapshot'],
      attempts: [{ stepId: 'review', status: 'failed', errorCode: 'INCOMPLETE_OUTPUT', incompleteReason: 'output-limit', usage: { outputTokens: 3000 } }] as WorkflowRun['attempts'],
    });
    expect(host.textContent).toContain('从 4096 提高到 6144 Token');
    expect(f.control).not.toHaveBeenCalled();
    await click('重新读取状态'); expect(f.control).not.toHaveBeenCalled();
    await click('继续当前步骤'); expect(f.control).toHaveBeenCalledOnce();
    expect(f.control.mock.calls[0][0]).toMatchObject({ id: 'run', action: 'continue', stepMaxOutputTokens: 6144 });
  });
  it.each([
    ['COVER_LAYOUT_REJECTED', '请将猫脸和题字错开排布'],
    [undefined, '完整保留这张图会把主体缩得过小。'],
  ])('红包封面本地检查失败时提供构图恢复（%s）', async (errorCode, error) => {
    const f = await render('failed', {
      mode: 'live', stepIndex: 0, error,
      snapshot: { outputKind: 'image', imagePreset: '微信红包封面', steps: [{ id: 'export', kind: 'export', enabled: true }] } as WorkflowRun['snapshot'],
      attempts: [{ stepId: 'export', status: 'failed', errorCode, error }] as WorkflowRun['attempts'],
    });
    expect(host.textContent).toContain(errorCode ? '精修一次' : '先用现有样稿在本地重新排版');
    expect(host.textContent).toContain('会新增费用');
    expect(host.textContent).not.toContain('从当前步骤继续');
    await click('打开图片工作台');
    expect(f.navigate).toHaveBeenCalledWith('images', 'project');
    expect(f.control).not.toHaveBeenCalled();
    f.control.mockRejectedValueOnce(Error('已用完自动修正次数'));
    await click('修正构图并继续');
    expect(f.control).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'run', action: 'continue' }));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('已用完自动修正次数');
    expect(f.onRead).not.toHaveBeenCalled();
  });
  it('操作失败不假报完成，解除禁用并显示可读错误', async () => {
    const f = await render('interrupted'); f.control.mockRejectedValueOnce(Error('后台暂不可用')); await click('继续制作');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('后台暂不可用'); expect(f.onRead).not.toHaveBeenCalled(); expect([...host.querySelectorAll('button')].every(button => !button.disabled)).toBe(true);
  });
});
