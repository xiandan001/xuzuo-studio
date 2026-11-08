import { useEffect } from 'react';
import type { PageProps } from '../../types';
import type { ModelCapability } from '../../configuration-types';
import type { NaturalAutomationBindings } from '../../lib/natural-automation-plan';
import { studioCredential, studioModel } from '../../lib/studio-run';
import { Select } from '../Select';
import { RememberedDetails } from '../RememberedDetails';

const labels = { text: '文字与资料', 'image-generation': '图片背景', 'image-editing': '商品抠图', vision: '图片与截图识读' };
export function businessSelectedBindings(props: PageProps, value: NaturalAutomationBindings): NaturalAutomationBindings {
  const next = { ...value };
  for (const kind of Object.keys(labels) as (keyof typeof labels)[]) {
    const models = props.configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(kind) && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
    const model = studioModel(models, value[kind]?.modelConfigId), credentialId = studioCredential(props.configuration.credentials, model?.connectionId, value[kind]?.credentialId);
    if (model) next[kind] = { modelConfigId: model.id, credentialId };
  }
  return next;
}
export function BusinessModelFields({ props, value, onChange, disabled, kinds = ['text', 'image-generation', 'image-editing', 'vision'] }: { props: PageProps; value: NaturalAutomationBindings; onChange: (next: NaturalAutomationBindings) => void; disabled?: boolean; kinds?: ModelCapability[] }) {
  const selected = businessSelectedBindings(props, value), signature = JSON.stringify(selected);
  useEffect(() => { if (!disabled && signature !== JSON.stringify(value)) onChange(selected); }, [signature, disabled]);
  return <RememberedDetails className="bs-models" rememberKey={`workspace:${props.workspaceId}:business-models`} defaultOpen><summary>模型与账户 <small>唯一可用配置自动带入</small></summary><div className="bs-model-grid">{(Object.keys(labels) as (keyof typeof labels)[]).filter(kind => kinds.includes(kind)).map(kind => {
    const models = props.configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(kind) && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo)), model = models.find(model => model.id === selected[kind]?.modelConfigId), credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId);
    return <div key={kind}><label>{labels[kind]}<Select aria-label={`${labels[kind]}模型`} value={selected[kind]?.modelConfigId || ''} disabled={disabled} options={[{ value: '', label: models.length ? '选择模型' : '尚未添加可用模型' }, ...models.map(item => ({ value: item.id, label: item.name }))]} onValueChange={id => { const item = models.find(model => model.id === id); onChange({ ...selected, [kind]: { modelConfigId: id || undefined, credentialId: item ? studioCredential(props.configuration.credentials, item.connectionId) : undefined } }); }} /></label><label>账户<Select aria-label={`${labels[kind]}账户`} value={selected[kind]?.credentialId || ''} disabled={disabled || !model} options={[{ value: '', label: '选择已保存 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name }))]} onValueChange={id => onChange({ ...selected, [kind]: { ...selected[kind], credentialId: id || undefined } })} /></label></div>;
  })}</div><p className="bs-note">本地排版、改价、尺寸适配和打包不调用模型。可在开始前修改配置。<button type="button" className="text-button" onClick={() => props.navigate('models')}>管理模型与 Key</button></p></RememberedDetails>;
}
