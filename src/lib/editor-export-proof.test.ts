import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { editorExportArtifacts } from './editor-export-proof';
const file: ArtifactMetadata = { id: 'office', projectId: 'project', name: '交付.docx', kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100, path: 'files/office', createdAt: '' };
const run = (): WorkflowRun & { sourceRevision: number } => ({ id: 'run', mode: 'live', projectId: 'project', workspaceId: 'workspace', sourceRevision: 2, workflowId: 'flow', workflowName: '本地导出', snapshot: { id: 'flow', workspaceId: 'workspace', name: '导出', outputKind: 'word', description: '', updatedAt: '', steps: [{ id: 'export', name: '导出', kind: 'export', inputSource: 'project', prompt: '', enabled: true }] }, attempts: [{ id: 'attempt', stepId: 'export', stepName: '导出', modelLabel: '本地', status: 'complete', artifacts: [file], summary: '', input: '', prompt: '', action: 'AI 精修', costCents: 0 }], status: 'complete', stepIndex: 1, createdAt: '', updatedAt: '', variables: {}, input: '' });
describe('当前编辑版本的真实导出证明', () => {
  it('重开从完整成功导出快照按项目、类型与精确revision识别', () => {
    expect(editorExportArtifacts('project', 'word', 2, [run()])).toEqual([file]);
    expect(editorExportArtifacts('project', 'word', 3, [run()])).toEqual([]);
    expect(editorExportArtifacts('other', 'word', 2, [run()])).toEqual([]);
    expect(editorExportArtifacts('project', 'ppt', 2, [run()])).toEqual([]);
    expect(editorExportArtifacts('project', 'word', undefined, [run()])).toEqual([]);
  });
  it('保存源、文本报告、失败尝试和未标源版本均不能冒充成功Office导出', () => {
    const failed = run(); failed.attempts[0].status = 'failed';
    const text = run(); text.attempts[0].artifacts = [{ ...file, kind: 'text', mimeType: 'text/plain' }];
    const noRevision = { ...run(), sourceRevision: undefined };
    const wrongStep = run(); wrongStep.snapshot.steps[0].kind = 'text';
    expect(editorExportArtifacts('project', 'word', 2, [failed, text, noRevision, wrongStep])).toEqual([]);
  });
  it('隐藏任务仍有文件，但产物回收与模拟任务不再提供有效证明', () => {
    expect(editorExportArtifacts('project', 'word', 2, [{ ...run(), hiddenAt: 'now' }])).toEqual([file]);
    expect(editorExportArtifacts('project', 'word', 2, [{ ...run(), mode: 'simulation' }])).toEqual([]);
    expect(editorExportArtifacts('project', 'word', 2, [run()], undefined, [file])).toEqual([]);
    const trashed = run(); trashed.attempts[0].artifacts = [{ ...file, trashedAt: 'now' }];
    expect(editorExportArtifacts('project', 'word', 2, [trashed])).toEqual([]);
  });
  it('成功export回传可立即证明当前版本，后续新版本不能沿用旧证明', () => {
    const local = { projectId: 'project', revision: 2, artifacts: [file] };
    expect(editorExportArtifacts('project', 'word', 2, [], local)).toEqual([file]);
    expect(editorExportArtifacts('project', 'word', 3, [], local)).toEqual([]);
    expect(editorExportArtifacts('project', 'word', 2, [], { ...local, artifacts: [] })).toEqual([]);
    expect(editorExportArtifacts('project', 'word', 2, [], local, [file])).toEqual([]);
  });
  it('Excel重开使用精确XLSX版本证明，回收与错误MIME均不提供证明', () => {
    const excel = run(); excel.snapshot.outputKind = 'excel';
    const xlsx = { ...file, name: '交付.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    excel.attempts[0].artifacts = [xlsx];
    expect(editorExportArtifacts('project', 'excel', 2, [excel])).toEqual([xlsx]);
    expect(editorExportArtifacts('project', 'excel', 3, [excel])).toEqual([]);
    expect(editorExportArtifacts('project', 'excel', 2, [excel], undefined, [xlsx])).toEqual([]);
    expect(editorExportArtifacts('project', 'excel', 2, [], { projectId: 'project', revision: 2, artifacts: [file] })).toEqual([]);
    expect(editorExportArtifacts('project', 'excel', 2, [], { projectId: 'project', revision: 2, artifacts: [{ ...xlsx, kind: 'other' }] })).toEqual([]);
  });
  it('inventory确认文件不可用时，旧的本地export回传不能继续冒充有效成品', () => {
    const saved = run(); saved.attempts[0].artifacts = [{ ...file, unavailable: true }];
    expect(editorExportArtifacts('project', 'word', 2, [saved], { projectId: 'project', revision: 2, artifacts: [file] })).toEqual([]);
  });
});
