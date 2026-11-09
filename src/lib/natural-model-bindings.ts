import type { NaturalAutomationBindings } from './natural-automation-plan';
import { isReasoningEffort } from './reasoning-options';

export type NaturalProductionCapability = keyof NaturalAutomationBindings;
export type NaturalModelBinding = NonNullable<NaturalAutomationBindings[NaturalProductionCapability]>;
const capabilities: NaturalProductionCapability[] = ['text', 'vision', 'image-generation', 'image-editing'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value) && !/^sk-/i.test(value);

export function normalizeNaturalBinding(value: unknown): NaturalModelBinding {
  if (!object(value) || Object.keys(value).some(key => !['modelConfigId', 'credentialId', 'reasoningEffort'].includes(key))) throw Error('模型设置只能保存模型、Key 的编号引用和推理强度。');
  const result: NaturalModelBinding = {};
  for (const key of ['modelConfigId', 'credentialId'] as const) {
    const id = value[key];
    if (id === undefined || id === null || id === '') continue;
    if (!reference(id)) throw Error('模型或 Key 的编号引用无效，请重新选择；不要填写 Key 原文。');
    result[key] = id;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw Error('推理强度无效，请重新选择。');
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}

export function normalizeNaturalBindings(value: unknown): NaturalAutomationBindings {
  if (!object(value) || Object.keys(value).some(key => !capabilities.includes(key as NaturalProductionCapability))) throw Error('制作模型用途无效，请重新选择。');
  const result: NaturalAutomationBindings = {};
  for (const capability of capabilities) {
    if (value[capability] === undefined) continue;
    const binding = normalizeNaturalBinding(value[capability]);
    if (binding.modelConfigId || binding.credentialId) result[capability] = binding;
  }
  return result;
}

export function replaceNaturalProductionBinding(bindings: NaturalAutomationBindings, capability: NaturalProductionCapability, value: NaturalModelBinding): NaturalAutomationBindings {
  if (!capabilities.includes(capability)) throw Error('当前用途不支持制作模型设置。');
  const binding = normalizeNaturalBinding(value), next = { ...bindings };
  if (binding.modelConfigId || binding.credentialId) next[capability] = binding;
  else delete next[capability];
  return next;
}
