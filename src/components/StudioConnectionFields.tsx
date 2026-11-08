import { RememberedDetails } from './RememberedDetails';
import type { WorkflowDefinition } from '../configuration-types';
import type { PageProps } from '../types';
import { studioCredential } from '../lib/studio-run';
import { Select } from './Select';

export function StudioConnectionFields({ props, workflow, disabled, simulation, onChange }: { props: PageProps; workflow: WorkflowDefinition; disabled: boolean; simulation: boolean; onChange: (workflow: WorkflowDefinition) => void }) {
  const steps = workflow.steps.filter(step => step.enabled && !['manual-review', 'export', 'animation-compose'].includes(step.kind));
  if (!steps.length) return null;
  const configured = steps.every(step => {
    const model = props.configuration.models.find(item => item.id === step.modelConfigId && item.enabled && item.capabilities.includes(step.kind as typeof item.capabilities[number]) && (simulation || !item.demo));
    return model && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && (simulation || !connection.demo)) && (simulation || props.configuration.credentials.some(credential => credential.id === step.credentialId && credential.enabled && credential.connectionId === model.connectionId));
  });
  const labels = steps.map(step => props.configuration.models.find(model => model.id === step.modelConfigId)?.name).filter(Boolean);
  return <RememberedDetails rememberKey={`workflow:${workflow.id}:connection-fields`} className="wf-run-configuration-summary" defaultOpen={!configured}><summary>{configured ? `调用设置已就绪 · ${[...new Set(labels)].join('、')}` : '补全本次模型与 Key'}<span>{configured ? '展开调整' : '请选择'}</span></summary><fieldset className="studio-connection-fields" disabled={disabled}><legend>调用设置</legend>{steps.map(step => {
    const models = props.configuration.models.filter(model => model.enabled && model.capabilities.includes(step.kind as typeof model.capabilities[number]) && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && (simulation || !connection.demo)) && (simulation || !model.demo));
    const model = models.find(item => item.id === step.modelConfigId);
    const credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId);
    const update = (changes: Partial<typeof step>) => onChange({ ...workflow, steps: workflow.steps.map(item => item.id === step.id ? { ...item, ...changes } : item) });
    return <div className="studio-connection-step" key={step.id} data-step-id={step.id}>{steps.length > 1 && <h3>{step.name}</h3>}<label className="wf-field"><span>使用模型</span><Select className="field" disabled={disabled} aria-label={`生成确认模型 ${step.name}`} value={model?.id || ''} onValueChange={value => { const selected = models.find(item => item.id === value); update({ modelConfigId: selected?.id, credentialId: studioCredential(props.configuration.credentials, selected?.connectionId, step.credentialId) }); }} options={[{ value: '', label: '请选择模型' }, ...models.map(item => ({ value: item.id, label: item.name, description: item.modelId }))]} /></label>{!simulation && <label className="wf-field"><span>API Key</span><Select className="field" aria-label={`生成确认凭证 ${step.name}`} value={credentials.some(item => item.id === step.credentialId) ? step.credentialId! : ''} disabled={!model || disabled} onValueChange={value => update({ credentialId: value || undefined })} options={[{ value: '', label: credentials.length ? '请选择使用的 Key' : '请先保存此连接的 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name, description: `••••${item.lastFour}` }))]} /></label>}{!models.length && <p className="studio-config-help">还没有支持此操作的模型。</p>}</div>;
  })}<button type="button" className="text-button" disabled={disabled} onClick={() => props.navigate('models')}>前往模型中心配置</button></fieldset></RememberedDetails>;
}
