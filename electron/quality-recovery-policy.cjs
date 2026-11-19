const { isRedPacketCoverWorkflow, coverReviewFindings } = require('./wechat-red-packet-cover.cjs');

// Technical discrepancies in old saved checks can be resolved without changing the
// artwork. A second identical discrepancy must return to the user, not keep billing.
function qualityRecoveryDecision(run, step, attempt, verdict) {
  const gate = step.qualityGate, count = run.repairCounts?.[step.id] || 0;
  if (run.retryStepOnly || !gate || !Number.isInteger(gate.maxRepairs) || gate.maxRepairs < 1 || gate.maxRepairs > 3 || !Number.isSafeInteger(count) || count < 0) return;
  const cover = isRedPacketCoverWorkflow(run.snapshot, run.projectId);
  const findings = verdict?.issues?.length ? verdict.issues : [verdict?.summary || ''];
  if (findings.some(text => /(?:缺少|未提供|需要补充|无法核实).{0,16}(?:授权|版权许可|原始数据|证明材料)|(?:请|需)(?:客户|用户)提供/.test(text))) return { stop: '需要补充真实资料或授权，请先处理检查意见。' };
  const cleaned = cover ? coverReviewFindings(findings) : undefined;
  if (!verdict || cleaned?.recalibrate) {
    if (run.qualityRecheckAttempts?.[step.id]) return { stop: '这一步已重新质检过一次，仍未得到可用的当前标准结论。请核对模型或手动处理。' };
    return { action: 'recheck', sourceAttemptId: attempt.id };
  }
  if (count >= gate.maxRepairs) return { stop: '本步授权的自动修订次数已用完。' };
  const issues = cleaned?.instructions || findings.filter(Boolean);
  if (!issues.length) return { stop: '检查未给出可执行的修改建议，请人工核对。' };
  return { action: 'repair', number: count + 1, sourceAttemptId: attempt.id, instruction: ['保留原样稿中的角色、动作、题字和已确认的内容。', ...issues].join('\n').slice(0, 10000) };
}
module.exports = { qualityRecoveryDecision };
