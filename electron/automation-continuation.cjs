const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const validReplacement = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 4 && ['ruleId', 'runId', 'jobId', 'workflowAttemptId'].every(key => validId(value[key]));
function selection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !validId(input.previousRuleId) || !validId(input.previousRunId)) throw Error('上一轮制作引用无效，请重新读取当前对话。');
  return input;
}
function sameContinuation(job, input) {
  selection(input);
  if (!job.replacement || job.replacement.ruleId !== input.previousRuleId || job.replacement.runId !== input.previousRunId) throw Error('这次制作已经提交，不能更换它要接续的上一轮。');
}
async function resolveContinuation(value, rule, input, liveEngine, expected) {
  selection(input);
  const previous = value.rules.find(item => item.id === input.previousRuleId);
  if (rule.trigger !== 'manual' || rule.enabled || !previous || previous.trigger !== 'manual' || previous.enabled || previous.workspaceId !== rule.workspaceId || previous.projectId !== rule.projectId) throw Error('只能接续本工作区、本项目明确选择的手动制作，不能替代自动触发或其他项目。');
  const job = value.jobs.find(item => item.ruleId === previous.id && item.runId === input.previousRunId && item.workspaceId === rule.workspaceId && item.projectId === rule.projectId);
  const event = job && value.events.find(item => item.id === job.eventId);
  if (!job || !['running', 'decision'].includes(job.status) || job.cancelRequestedAt || job.cancellationPending || job.ruleSnapshot?.trigger !== 'manual' || job.ruleSnapshot?.enabled || event?.trigger !== 'manual' || value.decisions.some(card => card.jobId === job.id && !card.resolvedAt && card.kind !== 'review')) throw Error('上一轮制作尚未处于可接续的人工检查阶段，原任务与费用保留。');
  if (typeof liveEngine.runDetail !== 'function') throw Error('无法核对上一轮的实际后台状态，尚未提交新制作。');
  const run = await liveEngine.runDetail(input.previousRunId), step = run.snapshot?.steps?.[run.stepIndex];
  const pending = run.attempts?.findLast(attempt => attempt.stepId === step?.id && attempt.status === 'waiting-review');
  if (run.projectId !== rule.projectId || run.workspaceId !== rule.workspaceId || run.dispatchKey !== job.dispatchKey || run.mode !== 'live' || run.purpose === 'automation-plan' || run.status !== 'waiting-review' || run.hiddenAt || run.trashedAt || step?.kind !== 'manual-review' || !step.enabled || !pending || run.attempts.some(attempt => attempt.status === 'running')) throw Error('上一轮实际制作状态已变化，只能接续空闲的人工检查结果；不会取消运行中或暂停的任务。');
  const result = { ruleId: previous.id, runId: run.id, jobId: job.id, workflowAttemptId: pending.id };
  if (expected && (!validReplacement(expected) || Object.keys(result).some(key => result[key] !== expected[key]))) throw Error('上一轮检查位置已变化，请读取最新结果后重新确认，原任务没有取消。');
  return result;
}
const replacementRequest = replacement => replacement ? { replaceWaitingReviewRunId: replacement.runId, replaceWaitingReviewAttemptId: replacement.workflowAttemptId } : {};
module.exports = { validReplacement, sameContinuation, resolveContinuation, replacementRequest };
