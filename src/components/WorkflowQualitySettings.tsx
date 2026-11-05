import type { WorkflowStep } from '../configuration-types';
import { Select } from './Select';
export function WorkflowQualitySettings({ step, priorSteps, onChange }: { step: WorkflowStep; priorSteps: WorkflowStep[]; onChange: (changes: Partial<WorkflowStep>) => void }) {
  if (!['text', 'vision'].includes(step.kind)) return null;
  const sources = priorSteps.filter(source => source.enabled && !['planner', 'reviewer'].includes(source.role || '') && ['text', 'image-generation', 'image-editing'].includes(source.kind));
  return <>
    <label className="wf-field"><span>步骤职责</span><Select aria-label="步骤职责" value={step.role || ''} onValueChange={value => onChange({ role: value ? value as WorkflowStep['role'] : undefined, qualityGate: value === 'reviewer' ? step.qualityGate || { maxRepairs: 0, minScore: 80 } : undefined })} options={[{ value: '', label: '普通执行' }, { value: 'planner', label: '规划 · 整理目标和资料' }, { value: 'producer', label: '制作 · 交付完整结果' }, { value: 'reviewer', label: '独立检查 · 验收后再继续' }]} /></label>
    {step.role === 'reviewer' && <>
      <p className="wf-settings-help">检查需返回 JSON：passed 布尔值、score（0–100）、issues 数组、summary。未通过时可修订，超过上限交给你决定；每次模型尝试单独计费。</p>
      <label className="wf-field"><span>修订哪一步的结果</span><Select aria-label="自动修订来源" value={step.qualityGate?.repairStepId || ''} onValueChange={value => onChange({ qualityGate: { ...step.qualityGate, repairStepId: value || undefined, maxRepairs: value ? step.qualityGate?.maxRepairs || 1 : 0 } })} options={[{ value: '', label: '不自动修订，未通过时交给我' }, ...sources.map(source => ({ value: source.id, label: source.name }))]} /></label>
      <label className="wf-field"><span>最多自动修订</span><Select aria-label="自动修订次数" disabled={!step.qualityGate?.repairStepId} value={String(step.qualityGate?.maxRepairs || 0)} onValueChange={value => onChange({ qualityGate: { ...step.qualityGate, maxRepairs: Number(value) } })} options={[0, 1, 2, 3].map(value => ({ value: String(value), label: value === 0 ? '不自动修订' : '最多 ' + value + ' 轮' }))} /></label>
      <label className="wf-field"><span>自动通过的最低检查分数</span><Select aria-label="独立检查最低分" value={String(step.qualityGate?.minScore ?? 80)} onValueChange={value => onChange({ qualityGate: { ...step.qualityGate, maxRepairs: step.qualityGate?.maxRepairs || 0, minScore: Number(value) } })} options={[60, 70, 80, 90, 100].map(value => ({ value: String(value), label: value + ' 分' }))} /></label>
    </>}
  </>;
}
