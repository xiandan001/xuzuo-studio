import { Brain, Cpu, KeyRound } from 'lucide-react';
import type { StudioConfiguration } from '../configuration-types';
import { studioCredential } from '../lib/studio-run';
import { naturalModelSelection, type NaturalBinding } from './NaturalAutomationModels';
import { Select } from './Select';
import { normalizeReasoningEffort, reasoningOptions } from '../lib/reasoning-options';
import './conversation-model-picker.css';

export function ConversationModelPicker({ configuration, value, disabled, onChange }: { configuration: StudioConfiguration; value: NaturalBinding; disabled: boolean; onChange: (value: NaturalBinding) => void }) {
  const { models, model, credentials, credentialId } = naturalModelSelection(configuration, 'text', value);
  const connection = configuration.connections.find(item => item.id === model?.connectionId), efforts = reasoningOptions(connection, model);
  const effort = normalizeReasoningEffort(connection, model, value.reasoningEffort), credential = credentials.find(item => item.id === credentialId);
  return <div className="conversation-model-picker">
    <div className="conversation-model-field" title={model?.name || '选择本轮使用的对话模型'}><Cpu size={14} aria-hidden="true" /><Select aria-label="对话模型" disabled={disabled} value={model?.id || ''} options={[{ value: '', label: models.length ? '选择对话模型' : '尚未配置可用模型' }, ...models.map(item => ({ value: item.id, label: item.name, description: `${item.modelId} · ${item.capabilities.includes('vision') ? '可看图' : '文字'}` }))]} onValueChange={id => { const selected = models.find(item => item.id === id), selectedConnection = configuration.connections.find(item => item.id === selected?.connectionId); onChange({ modelConfigId: selected?.id, credentialId: studioCredential(configuration.credentials, selected?.connectionId), reasoningEffort: normalizeReasoningEffort(selectedConnection, selected, value.reasoningEffort) }); }} /></div>
    <div className="conversation-reasoning-field" title={efforts.length > 1 ? '思考越深入，通常等待越久、消耗越多' : '此模型尚不支持调整，使用模型默认设置'}><Brain size={14} aria-hidden="true" /><Select aria-label="推理强度" disabled={disabled || !model || efforts.length === 1} value={effort} options={efforts.map(option => ({ ...option, label: `思考：${option.label}` }))} onValueChange={next => onChange({ modelConfigId: model?.id, credentialId, reasoningEffort: normalizeReasoningEffort(connection, model, next) })} /></div>
    {credentials.length === 1 && credential ? <span className="conversation-account-summary" title={`本轮账户：${credential.name} · ••••${credential.lastFour}`}><KeyRound size={13} aria-hidden="true" /><span>{credential.name}</span></span> : <div className="conversation-key-field" title={!model ? '先选择对话模型，再选择对应的 Key' : credential?.name || '本轮使用的 Key'}><KeyRound size={14} aria-hidden="true" /><Select aria-label="对话Key" disabled={disabled || !model} value={credentialId || ''} options={[{ value: '', label: !model ? '先选择对话模型' : credentials.length ? '选择 Key' : '此模型尚无可用 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name, description: `••••${item.lastFour}` }))]} onValueChange={id => onChange({ modelConfigId: model?.id, credentialId: id || undefined, reasoningEffort: effort })} /></div>}
  </div>;
}
