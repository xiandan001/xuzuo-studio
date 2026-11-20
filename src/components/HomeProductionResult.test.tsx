// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps, ProjectKind } from '../types';
import { HomeProductionResult } from './HomeProductionResult';

function fixture(kind: ProjectKind, changes: Partial<WorkflowRun> = {}) {
  const file = { id: 'body', projectId: 'project', runId: 'run', name: 'result.txt', kind: 'text', mimeType: 'text/plain', bytes: 200 };
  const run = {
    id: 'run', workspaceId: 'workspace', projectId: 'project', mode: 'live', status: 'waiting-review', stepIndex: 1,
    snapshot: { outputKind: kind, steps: [{ id: 'make', kind: 'text', role: 'producer', enabled: true }, { id: 'accept', kind: 'manual-review', enabled: true }] },
    attempts: [{ stepId: 'make', status: 'complete', artifacts: [file] }, { stepId: 'accept', status: 'waiting-review' }],
    ...changes,
  } as WorkflowRun;
  const props = { workspaceId: 'workspace', projects: [{ id: 'project', workspaceId: 'workspace', name: '说明书' }], ledger: [], configuration: { models: [], connections: [], credentials: [] }, workflowRunner: { runs: [run], trashedArtifacts: [] } } as unknown as PageProps;
  return { props, run };
}

describe('首页可直接进入尚未导出的生成文稿', () => {
  it.each(['word', 'ppt', 'excel'] as const)('%s 正文提供预览和编辑入口，不把文本下载冒充Office导出', kind => {
    const data = fixture(kind), html = renderToStaticMarkup(<HomeProductionResult {...data} kind={kind} />);
    expect(html).toContain('文稿已生成 · 尚未导出');
    expect(html).toContain('打开编辑器');
    expect(html).toContain('实际生成结果预览');
    expect(html).not.toContain('作品已生成');
    expect(html).not.toContain('>导出');
    expect(html).not.toContain('暂无可用');
  });
  it('只有检查报告时仍提供步骤，不将报告当正文，也不展示回收、跨区和规划结果', () => {
    const data = fixture('word');
    data.run.snapshot.steps[0].role = 'reviewer';
    const report = renderToStaticMarkup(<HomeProductionResult {...data} kind="word" />);
    expect(report).toContain('查看结果与步骤'); expect(report).not.toContain('打开编辑器');
    for (const change of [{ workspaceId: 'other' }, { purpose: 'automation-plan' as const }]) {
      const hidden = fixture('word', change);
      expect(renderToStaticMarkup(<HomeProductionResult {...hidden} kind="word" />)).toBe('');
    }
    const trash = fixture('word'); trash.props.workflowRunner.trashedArtifacts = [trash.run.attempts[0].artifacts![0]];
    expect(renderToStaticMarkup(<HomeProductionResult {...trash} kind="word" />)).not.toContain('打开编辑器');
  });
  it('红包封面交付检查失败时保留样稿、展示原因及修正入口', () => {
    const data = fixture('image', { status: 'failed', error: '请将猫脸和题字错开排布' });
    data.run.snapshot.imagePreset = '微信红包封面';
    Object.assign(data.run.snapshot.steps[1], { kind: 'export' });
    Object.assign(data.run.attempts[0].artifacts![0], { kind: 'image', mimeType: 'image/png' });
    Object.assign(data.run.attempts[1], { status: 'failed', errorCode: 'COVER_LAYOUT_REJECTED' });
    const html = renderToStaticMarkup(<HomeProductionResult {...data} kind="image" />);
    expect(html).toContain('封面构图需要调整');
    expect(html).toContain('请将猫脸和题字错开排布');
    expect(html).toContain('修正构图并继续');
    expect(html).toContain('当前样稿');
    expect(html).not.toContain('导出微信封面 JPG');
  });
  it('未通过质检时显示原因和样稿，保留进度与进入任务的入口', () => {
    const data = fixture('word', { error: '原稿未满足范围', qualityReviews: [{ passed: false, issues: ['范围缺失'], summary: '未通过', stepId: 'accept', attemptId: 'check', reviewedAt: '' }] });
    Object.assign(data.run.snapshot.steps[1], { kind: 'text', role: 'reviewer', qualityGate: {} });
    Object.assign(data.run.attempts[1], { id: 'check', status: 'complete' });
    const html = renderToStaticMarkup(<HomeProductionResult {...data} kind="word" />);
    expect(html).toContain('质检未通过');
    expect(html).toContain('原稿未满足范围');
    expect(html).toContain('查看质检原因');
    expect(html).toContain('按当前标准重新质检');
    expect(html).toContain('当前样稿');
    expect(html).not.toContain('检查并交付');
    expect(html).not.toContain('文稿已生成 · 尚未导出');
  });
  it('从实际成品预览确认最后验收，连续点击只提交原尝试和原文件一次', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const data = fixture('image'), file = data.run.attempts[0].artifacts![0];
    Object.assign(data.run.snapshot.steps[0], { kind: 'export' });
    Object.assign(data.run.attempts[1], { id: 'manual-1' });
    Object.assign(file, { name: 'cover.png', kind: 'image', mimeType: 'image/png' });
    data.props.workflowRunner.previewArtifact = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,aQ==' }));
    data.props.onOpenTask = vi.fn();
    const complete = { ...data.run, status: 'complete', updatedAt: '2026-11-20T00:00:01.000Z' };
    data.run.updatedAt = '2026-11-20T00:00:00.000Z';
    let submit: (() => void) | undefined;
    const control = vi.fn(() => new Promise<void>(resolve => { submit = resolve; }));
    const runDetail = vi.fn(async () => complete);
    const previous = Object.getOwnPropertyDescriptor(window, 'desktop');
    const host = document.createElement('div'), root = createRoot(host);
    document.body.append(host);
    Object.defineProperty(window, 'desktop', { configurable: true, value: { runtime: { control, runDetail } } });
    try {
      await act(async () => root.render(<HomeProductionResult {...data} kind="image" />));
      const confirm = [...host.querySelectorAll('button')].find(button => button.textContent === '确认验收')!;
      expect(confirm.disabled).toBe(false);
      expect(host.querySelector('.creation-result-preview img')?.getAttribute('alt')).toBe('cover.png');
      await act(async () => { confirm.click(); confirm.click(); });
      expect(control).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'run', action: 'resume', manualReviewAttemptId: 'manual-1', reviewedArtifactId: 'body' }));
      expect(data.props.onOpenTask).not.toHaveBeenCalled();
      expect(host.textContent).toContain('待人工验收');
      await act(async () => { submit!(); });
      expect(host.textContent).not.toContain('待人工验收');
      expect(host.textContent).toContain('导出图片');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      if (previous) Object.defineProperty(window, 'desktop', previous); else delete window.desktop;
      vi.unstubAllGlobals();
    }
  });
});
