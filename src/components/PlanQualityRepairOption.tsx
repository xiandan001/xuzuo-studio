import type { WorkflowDefinition } from '../configuration-types';
import type { NaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import { imagePlanHasQualityGate, repairAfterReviewEnabled } from '../lib/natural-automation-plan';

export function PlanQualityRepairOption({ session, disabled = false, savedWorkflow }: {
  session: NaturalAutomationSession; disabled?: boolean; savedWorkflow?: WorkflowDefinition;
}) {
  const { draft } = session;
  if (!draft.plan) return null;
  const image = draft.plan.outputKind === 'image';
  if (image && !imagePlanHasQualityGate(draft.plan, draft.imagePreset)) return null;
  const saved = !!(draft.workflowSaved || draft.ruleId || draft.chatExecution);
  const gate = saved ? savedWorkflow?.steps.find(step => step.enabled && step.role === 'reviewer' && step.qualityGate)?.qualityGate : undefined;
  if (saved && !gate) return null;
  const rounds = saved ? gate!.maxRepairs : repairAfterReviewEnabled(draft.acceptedInput || draft.input, draft.repairAfterFailedReview) ? image ? 1 : Math.max(1, draft.plan.maxRepairs) : 0;
  return <div className="image-quality-repair-option">
    <label><input type="checkbox" checked={rounds > 0} disabled={disabled || saved} onChange={event => {
      try { session.store.persist({ ...session.store.current.current, repairAfterFailedReview: event.target.checked }); }
      catch (error) { session.setError(error instanceof Error ? error.message : '设置未保存，请重试。'); }
    }} />质检未通过时自动{image ? '精修' : '修订'}</label>
    <small>{rounds ? `最多 ${rounds} 轮，每轮另计一次${image ? '原图精修' : '正文修订'}和一次复检。检查结论异常时可额外重检一次，配置或预算不足时暂停。` : '未通过时暂停，由你决定如何处理。'}</small>
  </div>;
}
