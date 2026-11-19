// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HomeQualityRecovery } from './HomeQualityRecovery';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps, Project } from '../types';

it('红包旧质检给出当前标准和可编辑补救动作，展开和编辑免费，点击后绑定原PNG与旧检查', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const sample = { id: 'original', kind: 'image', bytes: 68, mimeType: 'image/png', projectId: 'project', runId: 'run' };
  const run = { id: 'run', projectId: 'project', workspaceId: 'workspace', mode: 'live', status: 'waiting-review', stepIndex: 1,
    snapshot: { outputKind: 'image', imagePreset: '微信红包封面', steps: [
      { id: 'make', kind: 'image-generation', enabled: true, role: 'producer', count: 1 },
      { id: 'check', kind: 'vision', enabled: true, inputSource: 'previous', role: 'reviewer', qualityGate: { minScore: 80 } },
      { id: 'out', kind: 'export', enabled: true, contentSourceStepId: 'make' },
      { id: 'manual', kind: 'manual-review', enabled: true },
    ] }, attempts: [{ stepId: 'make', status: 'complete', artifacts: [sample] }, { stepId: 'check', id: 'failed-check', status: 'complete' }],
    input: '制作一张小熊双爪递红包的封面，保留题字。', qualityReviews: [{ stepId: 'check', attemptId: 'failed-check', passed: false, issues: ['应扩画成9:16，主体太小。'], summary: '金色开按钮醒目' }],
  } as unknown as WorkflowRun;
  const project = { id: run.projectId, workspaceId: run.workspaceId, kind: 'image' } as Project;
  const ctl = vi.fn(async () => undefined), read = vi.fn(async () => run), prior = Object.getOwnPropertyDescriptor(window, 'desktop');
  Object.defineProperty(window, 'desktop', { configurable: true, value: { runtime: { control: ctl, runDetail: read } } });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const cfg = { connections: [{ id: 'c', enabled: true, protocol: 'openai-chat' }], credentials: [{ id: 'k', connectionId: 'c', enabled: true }], models: [{id: 'm', name: '检查模型', connectionId: 'c', enabled: true, capabilities: ['vision', 'image-editing']}] };
  const props = { workspaceId: run.workspaceId, configuration: cfg, workflowRunner: {} } as unknown as PageProps;
  const action = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name)!;
  try {
    await act(async () => root.render(<HomeQualityRecovery props={props} run={run} project={project} onRead={vi.fn()} />));
    expect(host.textContent).toContain('957 × 1278');
    expect(ctl).not.toHaveBeenCalled(); expect(host.textContent).toContain('最多另做 1 次纠正复检');
    await act(async () => action('自动处理并继续').click());
    expect(ctl).toHaveBeenCalledWith(expect.objectContaining({ action: 'auto-quality', reviewAttemptId: 'failed-check' }));
    ctl.mockClear();
    await act(async () => action('按建议精修').click());
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toContain('小熊双爪递红包'); expect(textarea.value).toContain('移除画面中绘入的金色'); expect(textarea.value).not.toContain('9:16');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '只调整纸面及题字，保留双爪');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(ctl).not.toHaveBeenCalled();
    await act(async () => action('开始精修并重新质检').click());
    expect(ctl).toHaveBeenCalledWith(expect.objectContaining({id: 'run', action: 'refine-quality', reviewAttemptId: 'failed-check', refinement: {instruction: '只调整纸面及题字，保留双爪', modelConfigId: 'm', credentialId: 'k', sourceArtifactId: 'original'}}));
    await act(async () => action('按当前标准重新质检').click());
    expect(ctl).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'recheck-quality', reviewAttemptId: 'failed-check', reviewBinding: {modelConfigId: 'm', credentialId: 'k'}}));
  } finally {
    await act(async () => root.unmount()); host.remove();
    if (prior) Object.defineProperty(window, 'desktop', prior); else delete window.desktop;
    vi.unstubAllGlobals();
  }
});
