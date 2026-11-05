function reviewVerdict(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value; try { value = JSON.parse(source); } catch { throw new Error('独立检查未返回有效 JSON；原结果与费用保留，请查看检查记录。'); }
  if (!value || typeof value.passed !== 'boolean' || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 || !Array.isArray(value.issues) || value.issues.some(issue => typeof issue !== 'string') || value.issues.length > 30) throw new Error('检查结论需要 passed 布尔值、0–100 的 score 及 issues 文字数组。');
  return { passed: value.passed, score: Number.isFinite(value.score) ? Math.max(0, Math.min(100, value.score)) : undefined, issues: value.issues.map(issue => issue.slice(0, 1000)), summary: String(value.summary || '').slice(0, 2000) };
}
function evaluateQuality(run, step, attempt) {
  if (step.role !== 'reviewer' || !step.qualityGate) return undefined;
  const verdict = reviewVerdict(attempt.summary), policy = step.qualityGate;
  const minScore = Number.isFinite(policy.minScore) ? Math.max(0, Math.min(100, policy.minScore)) : 80;
  const passed = verdict.passed && (verdict.score === undefined || verdict.score >= minScore);
  const result = { ...verdict, passed, stepId: step.id, attemptId: attempt.id, reviewedAt: attempt.completedAt };
  const targetIndex = run.snapshot.steps.findIndex(candidate => candidate.id === policy.repairStepId && candidate.enabled && ['text', 'image-generation', 'image-editing'].includes(candidate.kind));
  const index = run.snapshot.steps.findIndex(candidate => candidate.id === step.id), count = run.repairCounts?.[step.id] || 0;
  const maxRepairs = Number.isSafeInteger(policy.maxRepairs) ? Math.max(0, Math.min(3, policy.maxRepairs)) : 0;
  const source = targetIndex >= 0 && targetIndex < index ? run.attempts.filter(item => item.stepId === policy.repairStepId && item.status === 'complete').at(-1) : undefined;
  return { result, repair: !passed && !run.retryStepOnly && source && count < maxRepairs ? { stepId: policy.repairStepId, sourceAttemptId: source.id, reviewStepId: step.id, targetIndex, issues: verdict.issues, number: count + 1 } : undefined };
}
function repairInput(run, step, input) {
  const repair = run.repairContext;
  if (!repair || repair.stepId !== step.id) return input;
  const previous = run.attempts.find(attempt => attempt.id === repair.sourceAttemptId);
  if (!previous) throw new Error('自动修订缺少原始版本，已停止后续请求。');
  return `${previous.input || run.input}\n\n【上一版已保存结果】\n${previous.summary.slice(0, 150000)}\n\n【独立检查发现的问题】\n${repair.issues.join('\n')}\n\n请只针对这些问题交付完整修订结果，保留确认事实及其余已完成内容。不要输出检查报告或修改说明代替成品。`;
}
module.exports = { reviewVerdict, evaluateQuality, repairInput };
