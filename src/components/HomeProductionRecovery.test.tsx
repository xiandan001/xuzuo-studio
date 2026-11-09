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
  const fresh = { ...run, status: 'complete' as const }, read = vi.fn(async () => fresh), control = vi.fn(async () => undefined), onRead = vi.fn(), navigate = vi.fn();
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
  it('操作失败不假报完成，解除禁用并显示可读错误', async () => {
    const f = await render('interrupted'); f.control.mockRejectedValueOnce(Error('后台暂不可用')); await click('继续制作');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('后台暂不可用'); expect(f.onRead).not.toHaveBeenCalled(); expect([...host.querySelectorAll('button')].every(button => !button.disabled)).toBe(true);
  });
});
