import { describe, expect, it } from 'vitest';
import type { StudioConfiguration } from '../configuration-types';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import { naturalModelSelection } from '../components/NaturalAutomationModels';
import { normalizedNaturalDraftPlan } from '../hooks/useNaturalAutomationDraft';

const configuration = { models: [{ id: 'available-model', connectionId: 'connection', enabled: true, name: '已配置模型', modelId: 'local-model', capabilities: ['text'], pricing: { unit: 'request', currency: 'CNY', input: '', output: '0.1' } }], connections: [{ id: 'connection', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1/v1', name: '本地测试', enabled: true, status: 'configured' }], credentials: [{ id: 'available-key', connectionId: 'connection', name: '本地测试凭证', lastFour: 'test', enabled: true, updatedAt: '' }] } as StudioConfiguration;
describe('一句话规划的模型选择不会悄悄切换收费账户', () => {
  it('没有偏好时才自动使用唯一可用模型和凭证', () => {
    const selected = naturalModelSelection(configuration, 'text');
    expect(selected.model?.id).toBe('available-model'); expect(selected.credentialId).toBe('available-key');
  });
  it('明确选择的旧模型失效时保持缺项，不自动换成剩余模型', () => {
    const selected = naturalModelSelection(configuration, 'text', { modelConfigId: 'old-model', credentialId: 'old-key' });
    expect(selected.model).toBeUndefined(); expect(selected.credentialId).toBeUndefined();
  });
  it('明确选择的Key失效时不切换到唯一另一把Key', () => {
    const selected = naturalModelSelection(configuration, 'text', { modelConfigId: 'available-model', credentialId: 'disabled-key' });
    expect(selected.model?.id).toBe('available-model'); expect(selected.credentialId).toBeUndefined();
  });
  it('未适配的接口和停用的模型不会被显示成可调用设置', () => {
    const unsupported = { ...configuration, connections: configuration.connections.map(connection => ({ ...connection, protocol: 'custom' as const })) };
    expect(naturalModelSelection(unsupported, 'text').models).toEqual([]);
    expect(naturalModelSelection({ ...configuration, models: configuration.models.map(model => ({ ...model, enabled: false })) }, 'text').model).toBeUndefined();
  });
});
it('编辑中的验收尾换行或清空边界不改变输入文本，编译时才归一化', () => {
  const plan = { acceptance: [' 保留商品名称 ', '', '清晰可读', ''], constraints: [' ', ''], name: '', objective: '' } as NaturalAutomationPlan;
  const snapshot = JSON.stringify(plan), normalized = normalizedNaturalDraftPlan(plan);
  expect(normalized.acceptance).toEqual(['保留商品名称', '清晰可读']); expect(normalized.constraints).toEqual([]);
  expect(JSON.stringify(plan)).toBe(snapshot); expect(normalized.name).toBe('');
});
