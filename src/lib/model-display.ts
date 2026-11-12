import type { ModelConfiguration, ModelConnection } from '../configuration-types';
export function compactModelName(model: Pick<ModelConfiguration, 'name' | 'modelId'>): string {
  const parts = model.name.split(/\s*·\s*/), metadata = parts.findIndex(part => /^(?:官方|全球\s*API|国内\s*API|USD\b|CNY\b|美元\b|人民币\b)/i.test(part));
  return (metadata > 0 ? parts.slice(0, metadata).join(' · ') : model.name).trim() || model.modelId;
}
export function modelDisplayDetails(model: ModelConfiguration, connection?: ModelConnection): string {
  return [model.name, model.modelId, connection?.name, connection?.baseUrl, `计价币种：${model.pricing.currency}`, model.capabilities.includes('vision') ? '支持看图' : '文字模型'].filter(Boolean).join(' · ');
}
