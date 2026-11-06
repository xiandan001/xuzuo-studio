import { Cpu, KeyRound } from 'lucide-react';
import type { StudioConfiguration } from '../configuration-types';
import { studioCredential } from '../lib/studio-run';
import { naturalModelSelection, type NaturalBinding } from './NaturalAutomationModels';
import { Select } from './Select';

export function ConversationModelPicker({ configuration, value, disabled, onChange }: { configuration: StudioConfiguration; value: NaturalBinding; disabled: boolean; onChange: (value: NaturalBinding) => void }) {
  const { models, model, credentials, credentialId } = naturalModelSelection(configuration, 'text', value);
  return <div className="conversation-model-picker">
    <div className="conversation-model-field" title={model?.name || '对话模型，用于理解和调整方案'}><Cpu size={14} aria-hidden="true" /><Select aria-label="对话模型" disabled={disabled} value={model?.id || ''} options={[{ value: '', label: models.length ? '选择对话模型' : '尚未配置可用模型' }, ...models.map(item => ({ value: item.id, label: item.name, description: item.modelId }))]} onValueChange={id => { const selected = models.find(item => item.id === id); onChange({ modelConfigId: selected?.id, credentialId: studioCredential(configuration.credentials, selected?.connectionId) }); }} /></div>
    <div className="conversation-key-field" title={!model ? '先选择对话模型，再选择对应的 Key' : credentials.find(item => item.id === credentialId)?.name || '本轮使用的 Key'}><KeyRound size={14} aria-hidden="true" /><Select aria-label="对话Key" disabled={disabled || !model} value={credentialId || ''} options={[{ value: '', label: !model ? '先选择对话模型' : credentials.length ? '选择 Key' : '此模型尚无可用 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name, description: `••••${item.lastFour}` }))]} onValueChange={id => onChange({ modelConfigId: model?.id, credentialId: id || undefined })} /></div>
  </div>;
}
