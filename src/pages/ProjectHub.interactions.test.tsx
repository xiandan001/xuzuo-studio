// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { liveProjectStateSignature } from '../lib/project-status';
import { ProjectHub } from './ProjectHub';

vi.mock('../hooks/useBusinessWorkspace', () => ({ useBusinessWorkspace: () => ({ state: undefined, error: '', refresh: vi.fn() }) }));
vi.mock('../components/CustomerOrderLink', () => ({ CustomerOrderLink: () => null }));
vi.mock('../components/ProjectTemplateActions', () => ({ ProjectTemplateActions: () => null }));
let root: Root | undefined, host: HTMLDivElement;
const project: Project = { id: 'project', workspaceId: 'workspace', name: '状态测试', kind: 'word', status: 'draft', description: '', updatedAt: '', costCents: 0, version: 0, accent: 'blue' };
const run = (status: WorkflowRun['status'], extra: Partial<WorkflowRun> = {}) => ({ id: 'run', projectId: project.id, workspaceId: project.workspaceId, status, stepIndex: 0, createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z', snapshot: { steps: [] }, attempts: [], ...extra } as WorkflowRun);
const file: ArtifactMetadata = { id: 'current', projectId: project.id, name: '当前成品.docx', kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100, createdAt: '2026-11-16T00:00:00Z', path: '' };
const confirmed = (value: WorkflowRun): Project['confirmedDelivery'] => ({ id: 'delivery', fingerprint: 'a'.repeat(64), runStateSignature: liveProjectStateSignature(value) });
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('UI test must remain local'); })); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function fixture(runs: WorkflowRun[], changes: Partial<Project> = {}, files: ArtifactMetadata[] = []) {
  const activeProject = { ...project, ...changes }, navigate = vi.fn(), onOpenTask = vi.fn(), resume = vi.fn(), retry = vi.fn();
  const props = { workspaceId: project.workspaceId, workspace: { id: project.workspaceId }, activeProject, projects: [activeProject], ledger: [], navigate, onOpenTask, workflowRunner: { runs, listProjectArtifacts: vi.fn().mockResolvedValue(files), resume, retry, saveArtifact: vi.fn() } } as unknown as PageProps;
  await act(async () => { root = createRoot(host); root.render(<ProjectHub {...props} />); });
  return { navigate, onOpenTask, resume, retry };
}
function nextButton() { return host.querySelector<HTMLButtonElement>('[aria-label="下一步"] button')!; }
describe('项目概览的明确下一步', () => {
  it.each([['running', '查看制作进度'], ['paused', '处理暂停任务'], ['waiting-review', '检查生成结果'], ['failed', '处理失败任务'], ['interrupted', '处理中断任务']] as const)('%s 精确打开对应任务，保持执行与费用不变', async (status, label) => {
    const f = await fixture([run(status)]); expect(nextButton().textContent).toContain(label);
    await act(async () => nextButton().click()); expect(f.onOpenTask).toHaveBeenCalledWith('run', project.id); expect(f.navigate).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled(); expect(f.retry).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.btn-primary')).toHaveLength(1);
  });
  it('外区、隐藏、回收与方案规划记录不占用项目下一步', async () => {
    await fixture([run('failed', { workspaceId: 'other' }), run('paused', { hiddenAt: 'now' }), run('interrupted', { trashedAt: 'now' }), run('failed', { purpose: 'automation-plan' })]);
    expect(nextButton().textContent).toContain('开始制作');
  });
  it('流程结束但没有正式文件时引导检查导出，不假称已交付', async () => {
    const f = await fixture([run('complete')]); expect(nextButton().textContent).toContain('检查并导出成品');
    await act(async () => nextButton().click()); expect(f.navigate).toHaveBeenCalledWith('documents', project.id); expect(f.onOpenTask).not.toHaveBeenCalled();
  });
  it('已交付项目查看正式成品，历史列表按需显示全部', async () => {
    const files = Array.from({ length: 27 }, (_, index) => ({ id: `file-${index}`, projectId: project.id, name: `成品-${index}.docx`, kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100, createdAt: new Date(2026, 10, 16, 0, index).toISOString() } as ArtifactMetadata));
    const complete = run('complete'), f = await fixture([complete], { status: 'complete', confirmedDelivery: confirmed(complete) }, files);
    expect(nextButton().textContent).toContain('查看交付成品'); await act(async () => nextButton().click()); expect(f.navigate).toHaveBeenCalledWith('documents', project.id);
    const more = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('再显示 2 份历史成品')); expect(more).toBeTruthy();
    await act(async () => more!.click()); expect(host.querySelector('.project-hub-details')?.querySelectorAll('li')).toHaveLength(26);
  });
  it('精确签名已确认交付的等待检查任务继续显示交付成品，不重新要求检查', async () => {
    const waiting = run('waiting-review'), before = JSON.stringify(waiting), f = await fixture([waiting], { status: 'complete', confirmedDelivery: confirmed(waiting) }, [file]);
    expect(nextButton().textContent).toContain('查看交付成品'); expect(host.querySelector('[aria-label="下一步"]')?.textContent).toContain('当前版本已完成交付');
    await act(async () => nextButton().click()); expect(f.navigate).toHaveBeenCalledWith('documents', project.id); expect(f.onOpenTask).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled(); expect(f.retry).not.toHaveBeenCalled(); expect(JSON.stringify(waiting)).toBe(before);
  });
  it('已有交付签名不会掩盖更新的制作任务', async () => {
    const waiting = run('waiting-review'), latest = run('running', { id: 'new-run', createdAt: '2026-11-16T01:00:00Z', updatedAt: '2026-11-16T01:00:00Z' });
    const f = await fixture([waiting, latest], { status: 'complete', confirmedDelivery: confirmed(waiting) }, [file]);
    expect(nextButton().textContent).toContain('查看制作进度'); await act(async () => nextButton().click()); expect(f.onOpenTask).toHaveBeenCalledWith('new-run', project.id); expect(f.resume).not.toHaveBeenCalled(); expect(f.retry).not.toHaveBeenCalled();
  });
  it.each(['failed', 'waiting-review'] as const)('旧%s历史不覆盖更新且已确认的完成版本', async status => {
    const old = run(status, { id: 'old-run' }), complete = run('complete', { id: 'export', createdAt: '2026-11-16T01:00:00Z', updatedAt: '2026-11-16T01:00:00Z' });
    const f = await fixture([old, complete], { status: 'complete', confirmedDelivery: confirmed(complete) }, [file]);
    expect(nextButton().textContent).toContain('查看交付成品'); await act(async () => nextButton().click()); expect(f.navigate).toHaveBeenCalledWith('documents', project.id); expect(f.onOpenTask).not.toHaveBeenCalled();
  });
  it('仅项目complete标签不足以把新版本当作已确认交付', async () => {
    const old = run('complete', { id: 'old-run' }), latest = run('complete', { id: 'new-run', createdAt: '2026-11-16T01:00:00Z', updatedAt: '2026-11-16T01:00:00Z' });
    await fixture([old, latest], { status: 'complete', confirmedDelivery: confirmed(old) }, [file]); expect(nextButton().textContent).toContain('检查并编辑成品');
  });
});
