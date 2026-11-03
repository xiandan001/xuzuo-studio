const { randomUUID } = require('node:crypto');
function defaultQuickLocalStep(step, kind) {
  const keys = new Set(['id', 'name', 'kind', 'prompt', 'inputSource', 'budgetCents', 'enabled']);
  return step.kind === kind && step.name === (kind === 'export' ? '生成实际交付文件' : '人工检查实际结果') && step.prompt === '' && step.inputSource === 'previous' && step.budgetCents === undefined && step.enabled && Object.keys(step).every(key => keys.has(key));
}
// A user-initiated editor export can finish the original review/delivery tail
// or an unchanged default quick text/delivery/review flow. Custom checks stay unchanged.
function finishEditedReview(run, delivery) {
  if (run.projectId !== delivery.projectId || run.status !== 'waiting-review' || run.hiddenAt || run.trashedAt || !['ppt', 'word', 'excel'].includes(delivery.kind) || run.snapshot.outputKind !== delivery.kind) return undefined;
  const review = run.snapshot.steps[run.stepIndex];
  const tail = run.snapshot.steps.slice(run.stepIndex + 1).filter(step => step.enabled);
  if (review?.kind !== 'manual-review') return undefined;
  const originalTail = tail.length === 1 && tail[0].kind === 'export' && tail[0].inputSource === 'previous' && !tail[0].contentSourceStepId;
  const before = run.snapshot.steps.slice(0, run.stepIndex).filter(step => step.enabled);
  const quick = ['create', 'refine', 'regenerate'].some(action => run.workflowId === `quick-${run.projectId}-text-${action}`);
  const terminalReview = quick && tail.length === 0 && before.length === 2 && before[0].kind === 'text' && defaultQuickLocalStep(before[1], 'export') && defaultQuickLocalStep(review, 'manual-review');
  if (!originalTail && !terminalReview) return undefined;
  const sourceSteps = run.snapshot.steps.slice(0, run.stepIndex).filter(step => step.enabled && ['text', 'transcription'].includes(step.kind));
  const sourceStep = sourceSteps.at(-1);
  const source = sourceStep && run.attempts.findLast(attempt => attempt.stepId === sourceStep.id && attempt.status === 'complete');
  if (!source || !(source.artifacts || []).some(artifact => delivery.sourceArtifactIds.includes(artifact.id))) return undefined;
  if (terminalReview) {
    const exported = run.attempts.findLast(attempt => attempt.stepId === before[1].id);
    const mime = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[delivery.kind];
    if (exported?.status !== 'complete' || exported.input !== source.summary || !(exported.artifacts || []).some(artifact => artifact.kind === 'office' && artifact.mimeType === mime && artifact.projectId === run.projectId && !artifact.trashedAt)) return undefined;
  }
  const pending = run.attempts.findLast(attempt => attempt.stepId === review.id && attempt.status === 'waiting-review');
  if (!pending) return undefined;
  const next = structuredClone(run), timestamp = delivery.completedAt;
  const check = next.attempts.find(attempt => attempt.id === pending.id);
  Object.assign(check, { status: 'complete', completedAt: timestamp, reviewedEditorRevision: delivery.sourceRevision, summary: `已人工保存并交付编辑版本 v${delivery.sourceRevision}，原始模型正文保留。` });
  if (originalTail) next.attempts.push({ id: randomUUID(), stepId: tail[0].id, stepName: tail[0].name, modelLabel: '本地编辑交付', status: 'complete', costCents: 0, costState: 'not-incurred', action: 'AI 精修', input: '', prompt: '', summary: `已交付编辑版本 v${delivery.sourceRevision}；没有重新生成原稿。`, artifacts: structuredClone(delivery.artifacts), sourceRevision: delivery.sourceRevision, completedAt: timestamp });
  Object.assign(next, { status: 'complete', stepIndex: next.snapshot.steps.length, updatedAt: timestamp, error: undefined, completedByEditor: { sourceRevision: delivery.sourceRevision, exportRunId: delivery.exportRunId, sourceArtifactIds: [...delivery.sourceArtifactIds] } });
  return next;
}
module.exports = { finishEditedReview };
