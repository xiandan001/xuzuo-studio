const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function replacementReview(run, fork) {
  if (!run || run.status !== 'waiting-review') return;
  const step = run.snapshot.steps[run.stepIndex];
  if (!fork) {
    const attempt = run.attempts.findLast(item => item.stepId === step?.id && item.status === 'waiting-review');
    return step?.kind === 'manual-review' && attempt ? { attempt, quality: false } : undefined;
  }
  if (!validId(fork.reviewAttemptId) || !validId(fork.sourceArtifactId) || step?.role !== 'reviewer' || !step.qualityGate || !['vision', 'text'].includes(step.kind)) return;
  const attempt = run.attempts.findLast(item => item.stepId === step.id && item.status === 'complete');
  const review = run.qualityReviews?.findLast(item => item.stepId === step.id);
  return attempt?.id === fork.reviewAttemptId && review?.attemptId === attempt.id && review.passed === false ? { attempt, quality: true } : undefined;
}
async function assertRefinementSource(request, run, artifactStore) {
  const fork = request.refinementFork;
  if (!fork) return;
  const models = request.workflow.steps.filter(step => step.enabled && !['manual-review', 'export'].includes(step.kind));
  if (!request.replaceWaitingReviewRunId || request.project.kind !== 'image' || run?.snapshot.outputKind !== 'image' || !models.length || models.some(step => step.kind !== 'image-editing') || !request.attachmentIds.includes(fork.sourceArtifactId)) throw Error('仅可明确精修本项目已选择的图片，不能用检查或重新生图替代未通过的复核。');
  const source = await artifactStore.read(fork.sourceArtifactId);
  if (source.projectId !== request.project.id || source.kind !== 'image' || source.trashedAt || source.unavailable) throw Error('所选精修原图不属于当前项目或已不可用，原检查与费用保留。');
}
module.exports = { replacementReview, assertRefinementSource };
