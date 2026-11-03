import { describe, expect, it } from 'vitest';
import type { StudioConfiguration, WorkflowDefinition } from '../configuration-types';
import { workflowConfigurationSummary } from './workflow-library';

const flow: WorkflowDefinition = { id: 'flow', workspaceId: 'w', name: '提案制作', description: '', outputKind: 'ppt', updatedAt: '', steps: [{ id: 'write', name: '撰写正文', kind: 'text', prompt: '根据用户提供的事实整理内容', inputSource: 'project', enabled: true }, { id: 'review', name: '检查内容', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }] };
const config: Pick<StudioConfiguration, 'models' | 'connections' | 'credentials'> = {
  connections: [{ id: 'connection', name: '测试连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }],
  models: [{ id: 'model', name: '文本模型', modelId: 'fixture-text', connectionId: 'connection', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } }],
  credentials: [{ id: 'key', name: '本机凭证', connectionId: 'connection', enabled: true, lastFour: 'TEST', updatedAt: '' }],
};
describe('工作流库本地配置摘要', () => {
  it('自动带入唯一匹配模型与凭证，不修改保存中的流程', () => {
    const summary = workflowConfigurationSummary(flow, config);
    expect(summary.ready).toBe(true);
    expect(summary.workflow.steps[0]).toMatchObject({ modelConfigId: 'model', credentialId: 'key' });
    expect(flow.steps[0].modelConfigId).toBeUndefined();
  });
  it('多个模型不替用户猜测；禁用连接和凭证会显示明确的待设置项', () => {
    expect(workflowConfigurationSummary(flow, { ...config, models: [...config.models, { ...config.models[0], id: 'other' }] }).issues[0].message).toContain('选择模型');
    expect(workflowConfigurationSummary(flow, { ...config, connections: [{ ...config.connections[0], enabled: false }] }).ready).toBe(false);
    expect(workflowConfigurationSummary(flow, { ...config, credentials: [{ ...config.credentials[0], enabled: false }] }).issues[0].message).toContain('API Key');
  });
  it('停用步骤不阻塞，模拟模型不冒充真实配置，纯本地步骤无需Key', () => {
    const disabled = { ...flow, steps: [{ ...flow.steps[0], enabled: false }, flow.steps[1]] };
    expect(workflowConfigurationSummary(disabled, { models: [], connections: [], credentials: [] }).ready).toBe(true);
    expect(workflowConfigurationSummary({ ...flow, steps: [{ ...flow.steps[0], modelConfigId: 'model' }] }, { ...config, models: [{ ...config.models[0], demo: true }] }).issues[0].message).toContain('模拟模型');
    expect(workflowConfigurationSummary({ ...flow, steps: [] }, config).ready).toBe(false);
  });
});
