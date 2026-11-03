import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { projectFiles } from './project-files';
const file = (id: string, projectId = 'project'): ArtifactMetadata => ({ id, projectId, name: `${id}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', bytes: 30, path: `managed/${id}`, createdAt: '2026-10-30T01:00:00Z' });
function run(id: string, files: ArtifactMetadata[], revision?: number): WorkflowRun & { sourceRevision?: number } {
  return { id, mode: 'live', projectId: 'project', workspaceId: 'workspace', workflowId: id, workflowName: id, sourceRevision: revision, snapshot: { id, workspaceId: 'workspace', name: id, description: '', outputKind: 'word', updatedAt: '', steps: [] }, attempts: [{ id: `${id}-attempt`, stepId: 'export', stepName: '本地导出', modelLabel: '本地', status: 'complete', costCents: 0, costState: 'not-incurred', summary: '', input: '', prompt: '', action: 'AI 精修', artifacts: files }], status: 'complete', stepIndex: 1, input: '', variables: {}, createdAt: '', updatedAt: '2026-10-30T01:00:00Z' };
}
describe('专业文件树只展示当前项目真实产物', () => {
  it('按ID去重、过滤跨项目/回收文件/模拟产物，不依赖名称猜来源', () => {
    const first = file('same'), foreign = file('foreign', 'other'), trashed = { ...file('trashed'), trashedAt: 'today' };
    const simulation = { ...run('simulation', [file('demo')]), mode: 'simulation' as const };
    const runs = [run('a', [first, foreign, trashed, file('deleted')]), run('b', [first]), simulation, { ...run('other-project', [file('other')]), projectId: 'other' }];
    const original = JSON.stringify(runs);
    expect(projectFiles(runs, 'project', [file('deleted')]).map(item => item.artifact.id)).toEqual(['same']);
    expect(JSON.stringify(runs)).toBe(original);
  });
  it('任务隐藏和任务回收不移除真实文件，只有产物自身回收状态生效', () => {
    const hidden = { ...run('hidden', [file('kept')]), hiddenAt: 'today' };
    const recycledTask = { ...run('recycled-task', [file('also-kept')]), trashedAt: 'today' };
    expect(projectFiles([hidden, recycledTask], 'project').map(item => item.artifact.id)).toEqual(['kept', 'also-kept']);
  });
  it('只有实际保存的源版本可关联，重复引用不丢已知revision', () => {
    const artifact = file('document');
    const items = projectFiles([run('referenced', [artifact]), run('actual-export', [artifact], 4), run('editor-project-99', [file('unproven')])], 'project');
    expect(items.find(item => item.artifact.id === 'document')?.sourceRevision).toBe(4);
    expect(items.find(item => item.artifact.id === 'unproven')?.sourceRevision).toBeUndefined();
  });
  it.each(['word', 'ppt', 'excel'] as const)('%s 生成源稿、正式 Office 和本地检查报告按实际步骤分开', kind => {
    const source: ArtifactMetadata = { ...file('source'), name: 'result.txt', mimeType: 'text/plain', kind: 'text', runId: 'generated' };
    const report: ArtifactMetadata = { ...source, id: 'check', name: '成品-检查报告.json', mimeType: 'application/json' };
    const generated = run('generated', []);
    generated.snapshot.outputKind = kind;
    generated.snapshot.steps = [
      { id: 'text', name: '完整创作', kind: 'text', prompt: '', enabled: true, inputSource: 'project' },
      { id: 'export', name: '导出', kind: 'export', prompt: '', enabled: true, inputSource: 'previous' },
    ];
    generated.attempts = [{ ...generated.attempts[0], stepId: 'text', artifacts: [source] }, { ...generated.attempts[0], artifacts: [file('office'), report] }];
    const items = projectFiles([generated], 'project');
    expect(items.find(item => item.artifact.id === 'source')).toMatchObject({ group: 'source', description: `${{ word: 'Word', ppt: 'PPT', excel: 'Excel' }[kind]} 生成源稿 · 中间文件` });
    expect(items.find(item => item.artifact.id === 'office')?.group).toBe('office');
    expect(items.find(item => item.artifact.id === 'check')?.group).toBe('report');
    expect(source.name).toBe('result.txt');
  });
  it('只有指定正文步骤是源稿，参考输入和未知来源文字不会冒充源稿', () => {
    const source = { ...file('source'), kind: 'text' as const, name: 'result.txt', mimeType: 'text/plain', runId: 'generated' };
    const generated = run('generated', []);
    generated.snapshot.steps = [
      { id: 'plan', name: '策划', kind: 'text', prompt: '', enabled: true, inputSource: 'project' },
      { id: 'text', name: '正文', kind: 'text', prompt: '', enabled: true, inputSource: 'previous' },
      { id: 'export', name: '导出', kind: 'export', prompt: '', enabled: true, inputSource: 'previous', contentSourceStepId: 'text' },
    ];
    generated.attempts = [
      { ...generated.attempts[0], stepId: 'plan', artifacts: [{ ...source, id: 'plan' }] },
      { ...generated.attempts[0], stepId: 'text', artifacts: [source, { ...source, id: 'reference', runId: 'other-run' }, { ...source, id: 'unknown', runId: undefined }] },
    ];
    const items = projectFiles([generated], 'project');
    expect(items.filter(item => item.group === 'source').map(item => item.artifact.id)).toEqual(['source']);
    expect(items.filter(item => item.group === 'text').map(item => item.artifact.id)).toEqual(['plan', 'reference', 'unknown']);
  });
  it('模型检查意见不标为正文，历史源稿被较新任务引用后仍保留原有身份', () => {
    const source = { ...file('source'), kind: 'text' as const, name: 'result.txt', mimeType: 'text/plain', runId: 'generated' };
    const generated = run('generated', []), review = run('review', []);
    generated.snapshot.steps = [{ id: 'text', name: '正文', kind: 'text', prompt: '', enabled: true, inputSource: 'project' }];
    generated.attempts = [{ ...generated.attempts[0], stepId: 'text', artifacts: [source] }];
    review.updatedAt = '2026-10-31T00:01:00Z';
    review.snapshot.steps = [{ id: 'check', name: 'AI 复核', kind: 'text', prompt: '', enabled: true, inputSource: 'project' }];
    review.attempts = [{ ...review.attempts[0], stepId: 'check', artifacts: [{ ...source, id: 'review', runId: 'review' }, source] }];
    const items = projectFiles([generated, review], 'project');
    expect(items.find(item => item.artifact.id === 'source')?.group).toBe('source');
    expect(items.find(item => item.artifact.id === 'review')?.group).toBe('report');
  });
});
