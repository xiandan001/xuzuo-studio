import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import { applyLiveProjectState } from '../hooks/useLiveWorkflowRunner';
import { latestProjectArtifacts, latestProjectContentArtifact } from '../components/ArtifactResults';
import { projectImageContent } from './image-studio';

const file = (id: string, runId: string, kind: ArtifactMetadata['kind'] = 'text'): ArtifactMetadata => ({ id, projectId: 'project', runId, name: `${id}.txt`, mimeType: 'text/plain', bytes: 30, path: `managed/${id}`, kind, createdAt: '2026-11-03T00:00:00Z' });
function run(id: string, purpose?: 'automation-plan'): WorkflowRun {
  return { id, purpose, projectId: 'project', workspaceId: 'workspace', workflowId: id, workflowName: id, mode: 'live', status: 'complete', input: '', variables: {}, stepIndex: 1, createdAt: purpose ? '2026-11-03T01:00:00Z' : '2026-11-03T00:00:00Z', updatedAt: purpose ? '2026-11-03T01:00:00Z' : '2026-11-03T00:00:00Z', snapshot: { id, workspaceId: 'workspace', name: id, description: '', outputKind: 'word', updatedAt: '', steps: [{ id: 'body', role: purpose ? 'planner' : 'producer', kind: 'text', name: '正文', prompt: '', inputSource: 'project', enabled: true }] }, attempts: [{ id: `${id}-attempt`, stepId: 'body', stepName: '正文', modelLabel: '本地模型', status: 'complete', costCents: 17, summary: purpose ? '{"plan":true}' : '实际成品正文', input: '', prompt: '', action: '初次生成', artifacts: [file(purpose ? 'plan-json' : 'original-body', id)] }] };
}
describe('AI规划费用与既有成品隔离', () => {
  it.each(['running', 'complete', 'cancelled', 'failed', 'interrupted'] as const)('规划状态%s只累计费用，不改变交付/版本/正文状态', status => {
    const confirmedDelivery = { id: 'receipt', fingerprint: 'a'.repeat(64), runStateSignature: 'production:complete:1:1' };
    const project: Project = { id: 'project', workspaceId: 'workspace', name: '已交付', kind: 'word', description: '', status: 'complete', updatedAt: '2026-11-03T00:00:00Z', costCents: 20, liveLedgerBaselineCents: 20, version: 4, accent: 'blue', confirmedDelivery, lastLiveStateSignature: confirmedDelivery.runStateSignature, lastLiveCompletionId: 'production:1' };
    const next = applyLiveProjectState(project, { ...run('planning', 'automation-plan'), status }, 17, 37);
    expect(next).toMatchObject({ status: 'complete', version: 4, costCents: 37, liveLedgerBaselineCents: 37, confirmedDelivery, lastLiveCompletionId: 'production:1', lastLiveStateSignature: confirmedDelivery.runStateSignature, updatedAt: project.updatedAt });
    expect(applyLiveProjectState(next, { ...run('planning', 'automation-plan'), status }, 0, 37)).toBe(next);
  });
  it('规划JSON不会遮住原正文/成品，规划附带内容不冒充图片结果', () => {
    const production = run('production'), planning = run('planning', 'automation-plan');
    planning.attempts[0].artifacts!.push(file('untrusted-planning-picture', planning.id, 'image'));
    expect(latestProjectArtifacts([planning, production], 'project').map(item => item.id)).toEqual(['original-body']);
    expect(latestProjectContentArtifact([planning, production], 'project')?.id).toBe('original-body');
    expect(projectImageContent([planning, production], 'project').artifacts.map(item => item.id)).toEqual(['original-body']);
  });
});
