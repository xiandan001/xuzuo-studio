import type { StudioConfiguration, WorkflowStep } from '../configuration-types';
import type { ProjectKind } from '../types';
import { naturalModelSelection } from './NaturalAutomationModels';
import { readProductionPreferences, rememberProductionBinding } from '../lib/natural-model-bindings';
import { Select } from './Select';

interface Props {
  step: WorkflowStep;
  priorSteps: WorkflowStep[];
  configuration: StudioConfiguration;
  workspaceId: string;
  outputKind?: ProjectKind;
  onChange: (changes: Partial<WorkflowStep>) => void;
}
export function WorkflowQualitySettings({ step, priorSteps, configuration, workspaceId, outputKind, onChange }: Props) {
  if (!['text', 'vision'].includes(step.kind)) return null;
  const sources = priorSteps.filter(source => source.enabled && !['planner', 'reviewer'].includes(source.role || '') && ['text', 'image-generation', 'image-editing'].includes(source.kind));
  const gate = step.qualityGate, source = sources.find(row => row.id === gate?.repairStepId);
  const imageRepair = step.role === 'reviewer' && outputKind === 'image' && step.kind === 'vision' && source?.kind.startsWith('image-') && !!gate?.maxRepairs;
  const models = imageRepair ? naturalModelSelection(configuration, 'image-editing').models : [];
  const pairs = models.flatMap(model => configuration.credentials.filter(key => key.enabled && key.connectionId === model.connectionId).map(key => ({
    value: model.id + '/' + key.id, label: model.name + ' · ' + key.name, binding: { modelConfigId: model.id, credentialId: key.id },
  })));
  const binding = gate?.imageRepairBinding;
  const canReuse = pairs.some(pair => pair.binding.modelConfigId === source?.modelConfigId && pair.binding.credentialId === source?.credentialId);
  function rememberedEditor(producer?: WorkflowStep) {
    if (outputKind !== 'image' || step.kind !== 'vision' || !producer?.kind.startsWith('image-')) return;
    const choice = readProductionPreferences(workspaceId, localStorage)['image-editing'];
    if (choice?.modelConfigId && choice.credentialId) return { modelConfigId: choice.modelConfigId, credentialId: choice.credentialId };
  }
  return <>
    <label className="wf-field"><span>步骤职责</span><Select aria-label="步骤职责" value={step.role || ''} onValueChange={value => {
      const producer = sources.at(-1);
      onChange({ role: value ? value as WorkflowStep['role'] : undefined, qualityGate: value === 'reviewer' ? gate || { maxRepairs: producer ? 1 : 0, repairStepId: producer?.id, minScore: 80, imageRepairBinding: rememberedEditor(producer) } : undefined });
    }} options={[{ value: '', label: '普通执行' }, { value: 'planner', label: '规划 · 整理目标和资料' }, { value: 'producer', label: '制作 · 交付完整结果' }, { value: 'reviewer', label: '独立检查 · 验收后再继续' }]} /></label>
    {step.role === 'reviewer' && <>
      <p className="wf-settings-help">检查需返回 passed、score、issues 和 summary 的 JSON。启用自动修订后按建议修改并复检；检查结论无效时最多另做一次复检，每次调用分别计费。</p>
      <label className="wf-field"><span>修订哪一步的结果</span><Select aria-label="自动修订来源" value={gate?.repairStepId || ''} onValueChange={value => {
        const selected = sources.find(item => item.id === value);
        onChange({ qualityGate: { ...gate, repairStepId: selected?.id, maxRepairs: selected ? gate?.maxRepairs || 1 : 0, imageRepairBinding: selected?.kind.startsWith('image-') ? binding || rememberedEditor(selected) : undefined } });
      }} options={[{ value: '', label: '不自动修订，未通过时交给我' }, ...sources.map(row => ({ value: row.id, label: row.name }))]} /></label>
      <label className="wf-field"><span>质检失败后最多修订</span><Select aria-label="自动修订次数" disabled={!source} value={String(gate?.maxRepairs || 0)} onValueChange={value => onChange({ qualityGate: { ...gate, maxRepairs: Number(value), imageRepairBinding: binding || (value !== '0' ? rememberedEditor(source) : undefined) } })} options={[0, 1, 2, 3].map(value => ({ value: String(value), label: value === 0 ? '不自动修订' : '最多 ' + value + ' 轮' }))} /></label>
      {imageRepair && <label className="wf-field"><span>修复样稿使用的模型与账户</span><Select aria-label="失败修复模型与账户" value={binding ? binding.modelConfigId + '/' + binding.credentialId : ''} placeholder="原选择不可用，请重新选择" options={[{ value: '', label: canReuse ? '沿用样稿模型与账户' : '未选定，需修复时提醒' }, ...pairs]} onValueChange={value => {
        const selected = pairs.find(pair => pair.value === value)?.binding;
        onChange({ qualityGate: { ...gate!, imageRepairBinding: selected } });
        if (selected) rememberProductionBinding(workspaceId, 'image-editing', selected);
      }} /></label>}
      <label className="wf-field"><span>自动通过的最低检查分数</span><Select aria-label="独立检查最低分" value={String(gate?.minScore ?? 80)} onValueChange={value => onChange({ qualityGate: { ...gate, maxRepairs: gate?.maxRepairs || 0, minScore: Number(value) } })} options={[60, 70, 80, 90, 100].map(value => ({ value: String(value), label: value + ' 分' }))} /></label>
    </>}
  </>;
}
