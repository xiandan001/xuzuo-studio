import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { overlayArtifactMetadata } from '../hooks/useLiveWorkflowRunner';

const require = createRequire(import.meta.url);
const { artifactTrashError, artifactRequestError } = require('../../electron/artifact-lifecycle.cjs') as {
  artifactTrashError: (artifact: ArtifactMetadata, runs: WorkflowRun[]) => string;
  artifactRequestError: (request: { project?: { id: string }; attachmentIds?: string[] }, moving: ArtifactMetadata[]) => string;
};
const file: ArtifactMetadata = { id: 'file-1', name: 'result.txt', mimeType: 'text/plain', bytes: 7, path: 'files/file-1.txt', kind: 'text', createdAt: 'now', projectId: 'project-1' };
const run = (status: WorkflowRun['status'] = 'complete'): WorkflowRun => ({ id: 'run-1', workspaceId: 'workspace-1', projectId: 'project-1', workflowId: 'flow-1', workflowName: '测试流程', snapshot: { id: 'flow-1', workspaceId: 'workspace-1', name: '流程', description: '', outputKind: 'word', steps: [], updatedAt: 'now' }, status, stepIndex: 0, attempts: [{ id: 'attempt-1', stepId: 'step-1', stepName: '步骤', modelLabel: '模型', status: 'complete', costCents: 28, summary: '结果', input: '输入', prompt: '提示词', action: '初次生成', artifacts: [file] }], variables: {}, input: '输入', createdAt: 'now', updatedAt: 'now' });

describe('产物回收与任务隔离', () => {
  it.each(['running', 'paused', 'waiting-review'] as const)('%s流程的项目产物、跨项目参考和无owner导入附件均不能被挪走', status => {
    const active = run(status);
    expect(artifactTrashError(file, [active])).not.toBe('');
    expect(artifactTrashError({ ...file, projectId: 'another-project' }, [active])).not.toBe('');
    active.attachmentIds = ['reference-1'];
    expect(artifactTrashError({ ...file, id: 'reference-1', projectId: undefined }, [active])).not.toBe('');
    expect(artifactTrashError({ ...file, id: 'unused', projectId: 'other-project' }, [active])).toBe('');
  });
  it('已结束任务允许回收；挪动中的同项目或参考文件阻止新任务开始', () => {
    expect(artifactTrashError(file, [run('complete'), run('failed')])).toBe('');
    expect(artifactRequestError({ project: { id: file.projectId! } }, [file])).not.toBe('');
    expect(artifactRequestError({ attachmentIds: [file.id] }, [file])).not.toBe('');
    expect(artifactRequestError({ project: { id: 'other-project' }, attachmentIds: [] }, [file])).toBe('');
  });
  it('删除只覆盖产物metadata，不删运行历史和费用；恢复更新path并清掉旧trashedAt', () => {
    const history = [run()]; const original = JSON.stringify(history);
    const recycled = { ...file, path: 'trash/file-1.txt', trashedAt: '2026-10-30T01:00:00Z' };
    const marked = overlayArtifactMetadata(history, [recycled], {});
    expect(marked[0].attempts[0].artifacts).toEqual([recycled]);
    expect(marked[0].attempts[0].costCents).toBe(28);
    const restored = { ...file, path: 'files/new-conflict-safe-name.txt' };
    const active = overlayArtifactMetadata(marked, [], { [file.id]: restored });
    expect(active[0].attempts[0].artifacts?.[0]).toMatchObject({ id: file.id, path: restored.path, trashedAt: undefined });
    expect(JSON.stringify(history)).toBe(original);
    expect(active[0].attempts[0].costCents).toBe(28);
  });
});
