import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { finishEditedReview } = require('../../electron/edited-delivery.cjs');
function fixture() {
  const run = { id: 'run', projectId: 'project', status: 'waiting-review', stepIndex: 1, snapshot: { outputKind: 'word', steps: [{ id: 'text', kind: 'text', enabled: true }, { id: 'review', kind: 'manual-review', enabled: true }, { id: 'deliver', name: '交付', kind: 'export', inputSource: 'previous', enabled: true }] }, attempts: [{ id: 'text-attempt', stepId: 'text', status: 'complete', summary: '模型原稿 A', costCents: 10, artifacts: [{ id: 'source' }] }, { id: 'review-attempt', stepId: 'review', status: 'waiting-review' }] };
  const delivery = { projectId: 'project', kind: 'word', sourceRevision: 3, sourceArtifactIds: ['source'], artifacts: [{ id: 'edited-file-B', projectId: 'project' }], exportRunId: 'edited-export', completedAt: '2026-10-30T08:00:00Z' };
  return { run, delivery };
}
function exportedFixture(kind = 'word') {
  const { run, delivery } = fixture();
  run.snapshot.outputKind = kind; delivery.kind = kind;
  const [text, review, exported] = run.snapshot.steps;
  run.workflowId = `quick-${run.projectId}-text-create`;
  Object.assign(exported, { name: '生成实际交付文件', prompt: '' });
  Object.assign(review, { name: '人工检查实际结果', prompt: '', inputSource: 'previous' });
  run.snapshot.steps = [text, exported, review]; run.stepIndex = 2;
  const mimeType = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[kind];
  run.attempts.splice(1, 0, { id: 'original-export', stepId: 'deliver', status: 'complete', input: run.attempts[0].summary, costCents: 0, costState: 'not-incurred', artifacts: [{ id: 'original-office', kind: 'office', mimeType, projectId: run.projectId }] });
  return { run, delivery };
}
describe('人工编辑交付闭环', () => {
  it('保存并导出B后仅完成本地检查/交付尾段，保留A及原费用', () => {
    const { run, delivery } = fixture(), next = finishEditedReview(run, delivery);
    expect(next.status).toBe('complete'); expect(next.completedByEditor.sourceRevision).toBe(3); expect(next.attempts.at(-1).artifacts[0].id).toBe('edited-file-B');
    expect(next.attempts[0]).toEqual(run.attempts[0]); expect(run.status).toBe('waiting-review'); expect(next.attempts.at(-1).costState).toBe('not-incurred');
  });
  it('含后续模型步骤、指定原文、其他来源或其他项目时绝不自动完成或运行', () => {
    for (const kind of ['later-model', 'explicit-source', 'different-source', 'different-project']) {
      const { run, delivery } = fixture();
      if (kind === 'later-model') run.snapshot.steps.push({ id: 'ai-later', kind: 'text', enabled: true });
      if (kind === 'explicit-source') run.snapshot.steps[2].contentSourceStepId = 'text';
      if (kind === 'different-source') delivery.sourceArtifactIds = ['older-run-source'];
      if (kind === 'different-project') delivery.projectId = 'another';
      expect(finishEditedReview(run, delivery)).toBeUndefined(); expect(run.status).toBe('waiting-review');
    }
  });
  it('重开或重复导出不能重复完成同一次检查', () => {
    const { run, delivery } = fixture(), next = finishEditedReview(run, delivery);
    expect(finishEditedReview(JSON.parse(JSON.stringify(next)), delivery)).toBeUndefined();
  });
  it.each(['word', 'ppt', 'excel'])('%s先有正式文件再检查，用户编辑导出后结束检查，不伪造第二次export尝试', kind => {
    const { run, delivery } = exportedFixture(kind), before = structuredClone(run), next = finishEditedReview(run, delivery);
    expect(next.status).toBe('complete'); expect(next.stepIndex).toBe(3); expect(next.completedByEditor).toMatchObject({ sourceRevision: 3, exportRunId: 'edited-export', sourceArtifactIds: ['source'] });
    expect(next.attempts).toHaveLength(3); expect(next.attempts[0]).toEqual(before.attempts[0]); expect(next.attempts[1]).toEqual(before.attempts[1]);
    expect(next.attempts[2]).toMatchObject({ status: 'complete', reviewedEditorRevision: 3 });
    expect(run).toEqual(before); expect(finishEditedReview(next, delivery)).toBeUndefined();
  });
  it('末尾检查没有匹配成功导出、来源变化或复杂自定义链时不自动结束', () => {
    for (const mode of ['failed-export', 'later-failed-export', 'missing-export', 'different-source', 'different-input', 'different-kind', 'hidden', 'trashed', 'foreign-office', 'trashed-office', 'explicit-source', 'project-source', 'extra-model', 'extra-tail']) {
      const { run, delivery } = exportedFixture();
      if (mode === 'failed-export') run.attempts[1].status = 'failed';
      if (mode === 'later-failed-export') run.attempts.splice(2, 0, { ...run.attempts[1], id: 'later-export', status: 'failed' });
      if (mode === 'missing-export') run.attempts[1].artifacts = [];
      if (mode === 'different-source') delivery.sourceArtifactIds = ['unrelated-source'];
      if (mode === 'different-input') run.attempts[1].input = '另一份原稿';
      if (mode === 'different-kind') delivery.kind = 'excel';
      if (mode === 'hidden') run.hiddenAt = 'hidden';
      if (mode === 'trashed') run.trashedAt = 'trashed';
      if (mode === 'foreign-office') run.attempts[1].artifacts[0].projectId = 'foreign-project';
      if (mode === 'trashed-office') run.attempts[1].artifacts[0].trashedAt = 'trashed';
      if (mode === 'explicit-source') run.snapshot.steps[1].contentSourceStepId = 'text';
      if (mode === 'project-source') run.snapshot.steps[1].inputSource = 'project';
      if (mode === 'extra-model') { run.snapshot.steps.unshift({ id: 'extra', kind: 'vision', enabled: true }); run.stepIndex++; }
      if (mode === 'extra-tail') run.snapshot.steps.push({ id: 'extra', kind: 'manual-review', enabled: true });
      expect(finishEditedReview(run, delivery), mode).toBeUndefined(); expect(run.status).toBe('waiting-review');
    }
  });
  it('自定义流程和用户修改过的快捷检查不会因保存文件而被自动验收', () => {
    for (const change of [
      run => { run.workflowId = 'custom-business-approval'; },
      run => { run.snapshot.steps[2].prompt = '必须由客户验收后才能完成'; },
      run => { run.snapshot.steps[2].name = '客户终审'; },
      run => { run.snapshot.steps[2].budgetCents = 0; },
      run => { run.snapshot.steps[1].prompt = '自定义导出说明'; },
      run => { run.snapshot.steps[1].contentSourceStepId = 'text'; },
    ]) {
      const { run, delivery } = exportedFixture(); change(run);
      const original = structuredClone(run);
      expect(finishEditedReview(run, delivery)).toBeUndefined();
      expect(run).toEqual(original);
    }
  });
});
