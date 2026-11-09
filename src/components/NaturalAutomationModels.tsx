import type { ModelCapability, StudioConfiguration } from '../configuration-types';
import { studioCredential, studioModel } from '../lib/studio-run';
import { Select } from './Select';
import { normalizeReasoningEffort, type ReasoningEffort } from '../lib/reasoning-options';

export type NaturalBinding = { modelConfigId?: string; credentialId?: string; reasoningEffort?: ReasoningEffort };
export const naturalCapabilityLabel: Partial<Record<ModelCapability, string>> = { text: '文字理解与写作', vision: '看图检查', 'image-generation': '生成图片', 'image-editing': '精修图片' };
export function naturalModelSelection(configuration: StudioConfiguration, capability: ModelCapability, preferred: NaturalBinding = {}) {
  const protocols = ['text', 'vision'].includes(capability) ? ['openai-chat', 'openai-responses', 'anthropic', 'gemini'] : ['image', 'openai-chat', 'openai-responses'];
  const models = configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(capability) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo && protocols.includes(connection.protocol)));
  const model = preferred.modelConfigId ? models.find(item => item.id === preferred.modelConfigId) : studioModel(models), credentials = configuration.credentials.filter(credential => credential.enabled && credential.connectionId === model?.connectionId);
  const credentialId = preferred.credentialId ? credentials.find(item => item.id === preferred.credentialId)?.id : studioCredential(credentials, model?.connectionId);
  return { models, model, credentials, credentialId };
}
export function NaturalAutomationModels({ configuration, capability, value, onChange, disabled = false, label }: { configuration: StudioConfiguration; capability: ModelCapability; value: NaturalBinding; onChange: (value: NaturalBinding) => void; disabled?: boolean; label?: string }) {
  const { models, model, credentials, credentialId } = naturalModelSelection(configuration, capability, value);
  const title = label || naturalCapabilityLabel[capability] || capability;
  return <div className="natural-model-row"><strong>{title}</strong><label>模型<Select aria-label={`${title}模型`} disabled={disabled} value={model?.id || ''} options={[{ value: '', label: models.length ? '请选择一个模型' : '尚未配置可用模型' }, ...models.map(item => ({ value: item.id, label: item.name, description: item.modelId }))]} onValueChange={id => { const selected = models.find(item => item.id === id); onChange({ modelConfigId: selected?.id, credentialId: studioCredential(configuration.credentials, selected?.connectionId), ...(['text', 'vision'].includes(capability) && value.reasoningEffort !== undefined ? { reasoningEffort: normalizeReasoningEffort(configuration.connections.find(connection => connection.id === selected?.connectionId), selected, value.reasoningEffort) } : {}) }); }} /></label><label>Key<Select aria-label={`${title}Key`} disabled={disabled || !model} value={credentialId || ''} options={[{ value: '', label: credentials.length ? '请选择使用的 Key' : '请先录入此模型的 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name, description: `••••${item.lastFour}` }))]} onValueChange={id => onChange({ ...value, modelConfigId: model?.id, credentialId: id || undefined })} /></label></div>;
}
