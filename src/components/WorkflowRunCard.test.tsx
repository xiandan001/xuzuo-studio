// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAttempt, WorkflowRun, WorkflowStep } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { WorkflowRunCard } from './WorkflowRunCard';

const project = { id: 'project', workspaceId: 'workspace', kind: 'image', name: '样稿项目', status: 'processing' } as Project;
const time = '2026-11-18T02:00:00Z';
const step = (id: string, name: string, kind: WorkflowStep['kind'], extras?: Partial<WorkflowStep>): WorkflowStep =>
  ({ id, name, kind, enabled: true, inputSource: 'previous', prompt: '', ...extras });
const attempt = (id: string, stepId: string, extras?: Partial<WorkflowAttempt>): WorkflowAttempt =>
  ({ id, stepId, stepName: stepId, modelLabel: '', status: 'complete', costCents: 0, summary: '', input: '', prompt: '', action: '初次生成', ...extras });
function fixture() {
  const run: WorkflowRun = {
    id: 'run', projectId: project.id, workspaceId: project.workspaceId, workflowId: 'workflow', workflowName: '验收图片流程',
    mode: 'live', createdAt: time, updatedAt: time, status: 'waiting-review', stepIndex: 1, variables: {}, input: '',
    error: '独立检查未通过，尺寸应为 512 × 512。',
    snapshot: {
      id: 'workflow', name: '验收图片流程', description: '', workspaceId: project.workspaceId, outputKind: 'image', updatedAt: time,
      steps: [
        step('generate', '生成样稿', 'image-generation'),
        step('review', '独立质检', 'vision', { role: 'reviewer', qualityGate: { maxRepairs: 0 } }),
        step('export', '导出图片', 'export', { contentSourceStepId: 'generate' }),
        step('accept', '人工验收', 'manual-review'),
      ],
    },
    attempts: [
      attempt('original', 'generate', { artifacts: [{ id: 'png', projectId: project.id, runId: 'run', name: '原样稿.png', kind: 'image', mimeType: 'image/png', bytes: 80, path: '', createdAt: time }] }),
      attempt('check', 'review'),
    ],
    qualityReviews: [{ stepId: 'review', attemptId: 'check', passed: false, issues: ['尺寸应为 512 × 512。'], summary: '', reviewedAt: time }],
  };
  const resumeResizedImage = vi.fn(async (_id: string, _size: { width: number; height: number }) => undefined);
  const resume = vi.fn();
  const props = {
    workspaceId: project.workspaceId, projects: [project], activeProject: project, ledger: [], preferences: { confirmGeneration: false },
    navigate: vi.fn(), notify: vi.fn(), workflowRunner: { runs: [run], resume, resumeResizedImage },
  } as unknown as PageProps;
  return { run, props, resume, resumeResizedImage };
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(run: WorkflowRun, props: PageProps) {
  await act(async () => root.render(<WorkflowRunCard run={run} props={props} embedded />));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
async function click(label: string) {
  const element = button(label);
  expect(element).toBeDefined();
  await act(async () => { element?.click(); });
}
async function fill(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function acknowledge() {
  await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')?.click());
}

describe('工作流质量检查与人工验收', () => {
  it('抽屉首屏不读取完整日志，打开对应步骤后才显示尝试结果', async () => {
    const f = fixture();
    const detail = { ...f.run, attempts: f.run.attempts.map(item => item.stepId === 'review' ? { ...item, summary: '独立检查的原始结果' } : item) };
    const load = vi.fn(async () => detail);
    f.props.workflowRunner.loadRunDetail = load;
    await render({ ...f.run, contentTruncated: true }, f.props);
    expect(load).not.toHaveBeenCalled();
    expect(host.querySelector('.wf-run-steps')).toBeNull();
    await click('查看步骤与结果');
    expect(load).toHaveBeenCalledExactlyOnceWith('run');
    expect(host.textContent).toContain('独立质检');
    expect(host.textContent).not.toContain('独立检查的原始结果');
    await act(async () => host.querySelector<HTMLButtonElement>('#workflow-source-run-review .wf-drawer-attempt-toggle')?.click());
    expect(host.textContent).toContain('独立检查的原始结果');
    expect(host.querySelector('#workflow-source-run-generate .wf-attempt-details')).toBeNull();
  });

  it('截断步骤在确认继续时建议提高上限，并传给同一任务', async () => {
    const f = fixture();
    f.props.preferences.confirmGeneration = true;
    const run: WorkflowRun = {
      ...f.run,
      status: 'failed',
      attempts: [f.run.attempts[0], attempt('truncated', 'review', { status: 'failed', errorCode: 'INCOMPLETE_OUTPUT', incompleteReason: 'output-limit' })],
    };
    await render(run, f.props);
    await click('从当前位置继续');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('提高到 4096 Token');
    expect(f.resume).not.toHaveBeenCalled();
    await acknowledge();
    await click('确认，接受可能再次收费');
    expect(f.resume).toHaveBeenCalledExactlyOnceWith('run', null, 4096);
  });

  it('先核对失败原因，确认后才提交两项有效 PNG 交付尺寸', async () => {
    const f = fixture();
    await render(f.run, f.props);
    expect(host.textContent).toContain('尺寸应为 512 × 512');
    expect(button('确认通过，继续')).toBeUndefined();
    await click('核对后继续或调整尺寸…');
    expect(button('确认继续后续步骤')?.disabled).toBe(true);
    await fill('交付宽度（像素）', '512');
    await acknowledge();
    await click('确认继续后续步骤');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('宽度和高度均须填写');
    expect(f.resumeResizedImage).not.toHaveBeenCalled();

    await fill('交付高度（像素）', '512');
    await click('确认继续后续步骤');
    expect(f.resumeResizedImage).toHaveBeenCalledExactlyOnceWith('run', { width: 512, height: 512 });
    expect(f.resume).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('历史质检失败不会覆盖当前真正的人工验收', async () => {
    const f = fixture();
    const run: WorkflowRun = { ...f.run, stepIndex: 3, error: undefined, attempts: [...f.run.attempts, attempt('manual', 'accept', { status: 'waiting-review' })] };
    await render(run, f.props);
    expect(button('核对后继续或调整尺寸…')).toBeUndefined();
    await click('确认通过，继续');
    expect(f.resume).toHaveBeenCalledExactlyOnceWith('run');
    expect(f.resumeResizedImage).not.toHaveBeenCalled();
  });

  it('当前质检未读取原图时不提供 PNG 调整', async () => {
    const f = fixture();
    const steps = f.run.snapshot.steps.map(item => item.id === 'review' ? { ...item, referenceArtifactIds: ['different-image'] } : item);
    await render({ ...f.run, snapshot: { ...f.run.snapshot, steps } }, f.props);
    await click('人工确认后继续…');
    expect(document.querySelector('[aria-label="交付宽度（像素）"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('后续模型调用可能产生费用');
    expect(f.resume).not.toHaveBeenCalled();
  });
});
