function isFinalManualReview(run) {
  if (run?.mode !== 'live' || run.status !== 'waiting-review' || run.hiddenAt || run.trashedAt || run.supersededByRunId) return false;
  const steps = run.snapshot?.steps;
  const attempts = run.attempts;
  if (!Array.isArray(steps) || !Array.isArray(attempts) || !Number.isSafeInteger(run.stepIndex) || run.stepIndex < 0) return false;
  const step = steps[run.stepIndex];
  return step?.enabled === true && step.kind === 'manual-review' && typeof step.id === 'string' &&
    !steps.slice(run.stepIndex + 1).some(later => later?.enabled !== false) &&
    !attempts.some(attempt => !attempt || attempt.status === 'running') &&
    attempts.findLast(attempt => attempt.stepId === step.id)?.status === 'waiting-review';
}

module.exports = { isFinalManualReview };
