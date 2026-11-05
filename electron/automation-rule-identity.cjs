const { createHash } = require('node:crypto');
function ruleCreationFingerprint(rule) {
  const payload = { workspaceId: rule.workspaceId, projectId: rule.projectId, workflowId: rule.workflowId, name: rule.name.trim(), trigger: rule.trigger, intervalMinutes: rule.intervalMinutes, sourceWorkflowId: rule.sourceWorkflowId, input: rule.input, variables: Object.fromEntries(Object.entries(rule.variables || {}).sort(([left], [right]) => left.localeCompare(right))), ...(rule.preparation ? { preparation: { questions: rule.preparation.questions, answers: Object.fromEntries(Object.entries(rule.preparation.answers).sort(([left], [right]) => left.localeCompare(right))) } } : {}) };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
module.exports = { ruleCreationFingerprint };
