import { expect, it } from 'vitest';
import { recoverProjectDraft } from './project-recovery';
const selection = { workspaceId: 'new-workspace', projectId: 'new-project', selectionId: 'new-ticket', directory: 'D:/new-workspace/project', name: '新目录' };
it('continues in a new workspace with the fresh native ticket and all entered fields', () => {
  const result = recoverProjectDraft({ kind: 'word', draft: { kind: 'excel', name: '已填名称', description: '完整需求', budget: '19.80' } }, selection);
  expect(result).toEqual({ selection, kind: 'excel', name: '已填名称', description: '完整需求', budget: '19.80', promptIntent: undefined });
  expect(result.selection).toBe(selection);
});
it('starts an unfilled recovery with its original type and the newly selected folder name', () => {
  expect(recoverProjectDraft({ kind: 'ppt' }, selection)).toEqual({ selection, kind: 'ppt', name: '新目录', description: '', budget: '', promptIntent: undefined });
  expect(recoverProjectDraft({ kind: 'word', draft: { kind: 'word', name: '', description: '', budget: '' } }, selection).name).toBe('');
});
