import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { ProjectFilesPanel } from './ProjectFilesPanel';
const office: ArtifactMetadata = { id: 'office', projectId: 'project', name: '交付说明.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', path: 'managed/docx', bytes: 100, createdAt: '' };
function run(files: ArtifactMetadata[], sourceRevision?: number): WorkflowRun & { sourceRevision?: number } {
  return { id: 'run', mode: 'live', workspaceId: 'workspace', projectId: 'project', workflowId: 'flow', workflowName: '本地编辑导出', snapshot: { id: 'flow', workspaceId: 'workspace', name: '本地导出', description: '', outputKind: 'word', updatedAt: '', steps: [] }, sourceRevision, status: 'complete', stepIndex: 1, attempts: [{ id: 'attempt', stepId: 'export', stepName: '导出', modelLabel: '本地', status: 'complete', summary: '', input: '', prompt: '', action: 'AI 精修', costCents: 0, costState: 'not-incurred', artifacts: files }], variables: {}, input: '', createdAt: '', updatedAt: '' };
}
describe('专业项目文件树的真实操作入口', () => {
  it('仅有对应已保存源时提供载入，文件按ID操作且渲染不读取文件', () => {
    const preview = vi.fn();
    const runner = { trashedArtifacts: [], previewArtifact: preview } as unknown as WorkflowRunner;
    const html = renderToStaticMarkup(<ProjectFilesPanel projectId="project" projectName="客户交付" runs={[run([office], 2)]} runner={runner} versions={[{ revision: 2 }]} onRestoreVersion={() => undefined} />);
    expect(html).toContain('交付说明.docx'); expect(html).toContain('编辑源 v2'); expect(html).toContain('载入项目文件源版本 2');
    expect(html).toContain('预览项目文件'); expect(html).toContain('打开项目文件'); expect(html).toContain('另存项目文件'); expect(preview).not.toHaveBeenCalled();
    const missing = renderToStaticMarkup(<ProjectFilesPanel projectId="project" projectName="客户交付" runs={[run([office])]} runner={runner} versions={[{ revision: 2 }]} onRestoreVersion={() => undefined} />);
    expect(missing).not.toContain('载入项目文件源版本');
  });
  it('产物已回收时只显示回收状态，旧文件操作入口禁用', () => {
    const runner = { trashedArtifacts: [office] } as unknown as WorkflowRunner;
    const html = renderToStaticMarkup(<ProjectFilesPanel projectId="project" projectName="客户交付" runs={[run([office])]} runner={runner} />);
    expect(html).toContain('已回收文件'); expect(html).toMatch(/aria-label="查看项目文件 [^"]*"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="打开项目文件 [^"]*"[^>]*disabled=""/);
  });
});
