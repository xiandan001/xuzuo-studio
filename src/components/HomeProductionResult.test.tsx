import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { PageProps, ProjectKind } from '../types';
import { HomeProductionResult } from './HomeProductionResult';

function fixture(kind: ProjectKind, changes: Partial<WorkflowRun> = {}) {
  const file = { id: 'body', projectId: 'project', runId: 'run', name: 'result.txt', kind: 'text', mimeType: 'text/plain', bytes: 200 };
  const run = { id: 'run', workspaceId: 'workspace', projectId: 'project', mode: 'live', status: 'waiting-review', snapshot: { outputKind: kind, steps: [{ id: 'make', kind: 'text', role: 'producer', enabled: true }] }, attempts: [{ stepId: 'make', status: 'complete', artifacts: [file] }], ...changes } as WorkflowRun;
  const props = { workspaceId: 'workspace', projects: [{ id: 'project', workspaceId: 'workspace', name: '说明书' }], ledger: [], workflowRunner: { runs: [run], trashedArtifacts: [] } } as unknown as PageProps;
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
});
