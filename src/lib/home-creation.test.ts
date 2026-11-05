import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { homeCreationArtifacts, homeCreationDocumentSource, homeCreationPlanningInput, homeCreationPreviewUrl, homeCreationProgress, homeCreationRun } from './home-creation';

const image = (id: string, changes: Partial<ArtifactMetadata> = {}): ArtifactMetadata => ({ id, projectId: 'project', name: `${id}.png`, path: '', mimeType: 'image/png', bytes: 150, kind: 'image', createdAt: '2026-11-04T08:00:00Z', ...changes });
const run = (changes: Partial<WorkflowRun> = {}): WorkflowRun => ({ id: 'run', workspaceId: 'workspace', projectId: 'project', workflowId: 'workflow', mode: 'live', dispatchKey: 'dispatch', status: 'running', stepIndex: 0, attempts: [], snapshot: { steps: [{ id: 'make', name: '生成实际图片', enabled: true }, { id: 'check', name: '检查实际图片', enabled: true }] }, ...changes } as WorkflowRun);
const context = { workspaceId: 'workspace', projectId: 'project', workflowId: 'workflow', ruleId: 'rule', job: { ruleId: 'rule', runId: 'run', dispatchKey: 'dispatch' } };

describe('连续创作首页的真实任务与产物边界', () => {
  it('首次规划带上用户选择的格式，续改保留原句，不将旧格式强塞回新要求', () => {
    expect(homeCreationPlanningInput('做新品提案', 'ppt', false)).toContain('交付格式：PPT');
    expect(homeCreationPlanningInput('改成 Word', 'ppt', true)).toBe('改成 Word');
    const retry = homeCreationPlanningInput(homeCreationPlanningInput('做新品提案', 'word', false), 'ppt', false);
    expect(retry).not.toContain('交付格式：Word'); expect(retry.match(/用户在创作界面/g)).toHaveLength(1); expect(retry).toContain('交付格式：PPT');
  });
  it('只有当前规则受理的同区同项目实际制作任务可以出现在方案下，规划任务与旧任务不混入', () => {
    const real = run(); expect(homeCreationRun([real], context)).toBe(real);
    for (const changes of [{ workspaceId: 'other' }, { projectId: 'other' }, { workflowId: 'old' }, { purpose: 'automation-plan' as const }, { mode: 'simulation' as const }, { id: 'old', dispatchKey: 'old' }]) expect(homeCreationRun([run(changes)], context)).toBeUndefined();
    expect(homeCreationRun([real], { ...context, ruleId: 'new-rule' })).toBeUndefined();
    expect(homeCreationRun([real], { ...context, job: undefined })).toBeUndefined();
  });
  it('选最后一个已完成步骤的真实图片，检查报告不覆盖它，已回收、缺失、空文件和别的项目不能冒充结果', () => {
    const actual = image('refined');
    const source = run({ attempts: [{ status: 'complete', artifacts: [image('first')] }, { status: 'complete', artifacts: [actual, actual] }, { status: 'complete', artifacts: [image('report', { kind: 'text', mimeType: 'application/json' })] }] as WorkflowRun['attempts'] });
    expect(homeCreationArtifacts(source, 'image')).toEqual([actual]);
    for (const changes of [{ trashedAt: '2026-11-04' }, { unavailable: true }, { bytes: 0 }, { projectId: 'other' }]) expect(homeCreationArtifacts(run({ attempts: [{ status: 'complete', artifacts: [image('bad', changes)] }] as WorkflowRun['attempts'] }), 'image')).toEqual([]);
  });
  it('Office结果必须对应所选格式，不把 txt、PDF或另一种Office文件当作完成的可编辑成品', () => {
    const word = image('word', { kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const actual = run({ attempts: [{ status: 'complete', artifacts: [word] }] as WorkflowRun['attempts'] });
    expect(homeCreationArtifacts(actual, 'word')).toEqual([word]); expect(homeCreationArtifacts(actual, 'ppt')).toEqual([]);
  });
  it('尚未导出时提供制作正文，排除后续检查报告并优先使用导出指定的正文源', () => {
    const text = (id: string) => image(id, { kind: 'text', mimeType: 'application/json', runId: 'run' });
    const draft = text('body'), repair = text('repair'), report = text('report');
    const actual = run({ snapshot: { outputKind: 'word', steps: [{ id: 'body', kind: 'text', role: 'producer', enabled: true }, { id: 'repair', kind: 'text', role: 'producer', enabled: true }, { id: 'judge', kind: 'text', role: 'reviewer', enabled: true }, { id: 'export', kind: 'export', enabled: true, contentSourceStepId: 'body' }] } as WorkflowRun['snapshot'], attempts: [{ stepId: 'body', status: 'complete', artifacts: [draft] }, { stepId: 'repair', status: 'complete', artifacts: [repair] }, { stepId: 'judge', status: 'complete', artifacts: [report] }] as WorkflowRun['attempts'] });
    expect(homeCreationDocumentSource(actual, 'word')).toEqual(draft);
    expect(homeCreationArtifacts(actual, 'word')).toEqual([]);
    expect(homeCreationDocumentSource(actual, 'image')).toBeUndefined();
    expect(homeCreationDocumentSource(actual, 'ppt')).toBeUndefined();
    expect(homeCreationDocumentSource({ ...actual, purpose: 'automation-plan' }, 'word')).toBeUndefined();
    expect(homeCreationDocumentSource({ ...actual, mode: 'simulation' }, 'word')).toBeUndefined();
  });
  it('只接受当前任务可读取的已完成正文；删除、缺失、空文件、其他任务及项目不能提供文稿入口', () => {
    const source = image('body', { kind: 'text', mimeType: 'text/plain', runId: 'run' });
    const actual = run({ snapshot: { outputKind: 'excel', steps: [{ id: 'body', kind: 'text', enabled: true }] } as WorkflowRun['snapshot'], attempts: [{ stepId: 'body', status: 'complete', artifacts: [source] }] as WorkflowRun['attempts'] });
    expect(homeCreationDocumentSource(actual, 'excel')).toEqual(source);
    expect(homeCreationDocumentSource(actual, 'excel', new Set(['body']))).toBeUndefined();
    for (const changes of [{ trashedAt: 'today' }, { unavailable: true }, { bytes: 0 }, { projectId: 'other' }, { runId: 'other' }]) expect(homeCreationDocumentSource({ ...actual, attempts: [{ ...actual.attempts[0], artifacts: [{ ...source, ...changes }] }] }, 'excel')).toBeUndefined();
    expect(homeCreationDocumentSource({ ...actual, attempts: [{ ...actual.attempts[0], status: 'failed' }] }, 'excel')).toBeUndefined();
    for (const role of ['planner', 'reviewer'] as const) expect(homeCreationDocumentSource({ ...actual, snapshot: { ...actual.snapshot, steps: [{ ...actual.snapshot.steps[0], role }] } }, 'excel')).toBeUndefined();
  });
  it('进度只按实际步骤计算，重试失败不继承早前成功，也不将等待验收宣称100%交付', () => {
    const source = run({ attempts: [{ stepId: 'make', status: 'complete' }, { stepId: 'make', status: 'failed' }] as WorkflowRun['attempts'] });
    expect(homeCreationProgress(source).percent).toBe(0);
    expect(homeCreationProgress(run({ attempts: [{ stepId: 'make', status: 'complete' }] as WorkflowRun['attempts'] })).percent).toBe(50);
    expect(homeCreationProgress(run({ status: 'waiting-review', attempts: [{ stepId: 'make', status: 'complete' }, { stepId: 'check', status: 'complete' }] as WorkflowRun['attempts'] })).percent).toBe(99);
  });
  it('预览只接受本地图片数据，不加载远程URL或HTML/SVG数据', () => {
    expect(homeCreationPreviewUrl('data:image/png;base64,YQ==')).toBe('data:image/png;base64,YQ==');
    for (const url of ['https://example.test/a.png', 'file:///C:/a.png', 'data:image/svg+xml;base64,YQ==', 'javascript:alert(1)']) expect(homeCreationPreviewUrl(url)).toBeUndefined();
  });
});
