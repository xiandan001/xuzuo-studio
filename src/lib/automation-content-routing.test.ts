import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import { latestProjectContentArtifact } from '../components/ArtifactResults';
import { projectFiles } from './project-files';

describe('自动化规划与检查不能混入正式文档', () => {
  it('自动正文来源与文件树都选最新制作稿，规划和检查保持为报告', () => {
    const steps = [
      { id: 'plan', name: '任务书', role: 'planner', kind: 'text', enabled: true },
      { id: 'body', name: '实际正文', role: 'producer', kind: 'text', enabled: true },
      { id: 'review', name: '独立验收', role: 'reviewer', kind: 'text', enabled: true },
      { id: 'export', name: '交付', kind: 'export', enabled: true },
    ];
    const record = { id: 'run', mode: 'live', projectId: 'project', workflowId: 'flow', updatedAt: '2026-11-03T00:00:00Z', snapshot: { steps, outputKind: 'word' }, attempts: steps.slice(0, 3).map(step => ({ id: `${step.id}-attempt`, stepId: step.id, status: 'complete', artifacts: [{ id: `${step.id}-file`, projectId: 'project', runId: 'run', kind: 'text', name: 'result.txt' }] })) } as unknown as WorkflowRun;
    expect(latestProjectContentArtifact([record], 'project')?.id).toBe('body-file');
    expect(projectFiles([record], 'project').map(item => [item.artifact.id, item.group])).toEqual([['plan-file', 'report'], ['body-file', 'source'], ['review-file', 'report']]);
  });
});
