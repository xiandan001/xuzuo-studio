import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { ProjectFilesPanel } from '../components/ProjectFilesPanel';

it('文件树先显示 Office，保留源稿原名并提供用途和生成时间', () => {
  const source: ArtifactMetadata = { id: 'source', projectId: 'project', runId: 'generated', kind: 'text', name: 'result.txt', mimeType: 'text/plain', bytes: 20, path: 'files/source.txt', createdAt: '2026-10-31T00:01:02Z' };
  const office: ArtifactMetadata = { ...source, id: 'office', kind: 'office', name: '工作说明.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const steps: WorkflowRun['snapshot']['steps'] = [
    { id: 'text', name: '完整创作', kind: 'text', prompt: '', inputSource: 'project', enabled: true },
    { id: 'export', name: '导出', kind: 'export', prompt: '', inputSource: 'previous', enabled: true },
  ];
  const attempt = { id: 'a', stepId: 'text', stepName: '完整创作', modelLabel: '', status: 'complete' as const, costCents: 0, summary: '', input: '', prompt: '', action: '初次生成' as const };
  const run: WorkflowRun = { id: 'generated', projectId: 'project', workspaceId: 'workspace', workflowId: 'flow', workflowName: '生成', mode: 'live', status: 'waiting-review', stepIndex: 2, snapshot: { id: 'flow', workspaceId: 'workspace', name: '生成', description: '', outputKind: 'word', updatedAt: '', steps }, attempts: [{ ...attempt, artifacts: [source] }, { ...attempt, id: 'b', stepId: 'export', artifacts: [office] }, { ...attempt, id: 'c', artifacts: [{ ...source, id: 'source-2', createdAt: '2026-10-31T00:04:05Z' }] }], variables: {}, input: '', createdAt: '', updatedAt: '' };
  const html = renderToStaticMarkup(<ProjectFilesPanel projectId="project" projectName="工作说明" runs={[run]} runner={{ trashedArtifacts: [] } as unknown as WorkflowRunner} />);
  expect(html.indexOf('Office 文档')).toBeLessThan(html.indexOf('生成源稿'));
  expect(html).toContain('工作说明.docx');
  expect(html).toContain('result.txt');
  expect(html).toContain('Word 生成源稿 · 中间文件');
  expect(html).toContain('用于编辑与恢复，交付请用 Office 文档');
  expect(html).toContain('dateTime="2026-10-31T00:01:02Z"');
  expect(html).toContain('dateTime="2026-10-31T00:04:05Z"');
});
