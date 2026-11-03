import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { mergeProjectInventory, projectInventoryFiles } from './project-inventory';
const file = (id: string, projectId = 'project'): ArtifactMetadata => ({ id, projectId, name: `${id}.docx`, kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 40, createdAt: '2026-11-01T00:00:00Z', path: `managed/${id}`, runId: 'editor-project-99' });
const run = (artifact: ArtifactMetadata): WorkflowRun & { sourceRevision: number } => ({ id: 'saved-run', projectId: 'project', workspaceId: 'workspace', mode: 'live', sourceRevision: 2, workflowId: 'saved-export', workflowName: '已保存导出', snapshot: { id: 'saved-export', workspaceId: 'workspace', name: '', description: '', outputKind: 'word', steps: [{ id: 'export', name: '导出', kind: 'export', prompt: '', inputSource: 'project', enabled: true }], updatedAt: '' }, status: 'complete', stepIndex: 1, attempts: [{ id: 'attempt', stepId: 'export', stepName: '', modelLabel: '', status: 'complete', costCents: 0, costState: 'not-incurred', summary: '', input: '', prompt: '', action: 'AI 精修', artifacts: [artifact] }], createdAt: '', updatedAt: '', variables: {}, input: '' });

describe('本地登记文件不依赖工作流成功提交', () => {
  it('无run的真实Office登记可发现，但不能从runId猜编辑版本', () => {
    const orphan = file('orphan');
    const result = projectInventoryFiles([], 'project', [orphan]);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ artifact: orphan, group: 'office', description: '未关联编辑版本，请打开实际文件核对。' }); expect(result[0].sourceRevision).toBeUndefined();
  });
  it('同ID按实际inventory更新可用性、保留已证明revision，foreign项目不混入', () => {
    const saved = file('saved'), missing = { ...saved, unavailable: true, unavailableReason: '原文件不在原位置' };
    const result = projectInventoryFiles([run(saved)], 'project', [missing, file('foreign', 'other')]);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ sourceRevision: 2, artifact: { unavailable: true }, description: '原文件不在原位置' });
  });
  it('新global tombstone覆盖旧active inventory，不因刷新/缺run误还原', () => {
    const current = file('current'), trashed = { ...current, trashedAt: '2026-11-01T01:00:00Z' };
    const result = projectInventoryFiles([], 'project', [current], [trashed]);
    expect(result[0]).toMatchObject({ group: 'trash', artifact: { trashedAt: trashed.trashedAt } });
    expect(mergeProjectInventory('project', [current], [trashed], [])[0].trashedAt).toBe(trashed.trashedAt);
  });
  it('明确恢复后的fresh inventory和已知空回收登记可以清旧flag，unknown不能清', () => {
    const current = file('current'), stale = { ...current, trashedAt: '2026-11-01T01:00:00Z', unavailable: true };
    expect(mergeProjectInventory('project', [stale], [current], [])[0].trashedAt).toBeUndefined();
    expect(mergeProjectInventory('project', [stale], [current], undefined)[0].trashedAt).toBe(stale.trashedAt);
    expect(mergeProjectInventory('project', [stale], [current], [])[0].unavailable).toBeUndefined();
  });
});
