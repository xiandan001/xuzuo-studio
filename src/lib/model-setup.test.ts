import { describe, expect, it } from 'vitest';
import type { CredentialMetadata, ModelConfiguration, ModelConnection } from '../configuration-types';
import { modelSetupSummary, selectedConnectionCredential } from './model-setup';

const connection: ModelConnection = { id: 'connection', name: '自有连接', providerId: 'openai', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
const key = (id: string, connectionId = connection.id, enabled = true): CredentialMetadata => ({ id, connectionId, enabled, name: id, lastFour: '1234', updatedAt: '' });

describe('模型配置缺项引导', () => {
  it('仅带入同连接唯一启用凭证；多把保持明确选择，失效选择不被偷偷换成另一把', () => {
    expect(selectedConnectionCredential([key('off', connection.id, false), key('other', 'other'), key('only')], connection.id)).toBe('only');
    expect(selectedConnectionCredential([key('first'), key('second')], connection.id)).toBe('');
    expect(selectedConnectionCredential([key('first'), key('second')], connection.id, 'second')).toBe('second');
    expect(selectedConnectionCredential([key('first'), key('second')], connection.id, 'removed')).toBe('');
  });
  it('停用连接、模型或凭证均不显示为可直接执行', () => {
    const model = { id: 'model', connectionId: connection.id, enabled: true } as ModelConfiguration;
    expect(modelSetupSummary([connection], [model], [key('ready')]).readyModels).toHaveLength(1);
    expect(modelSetupSummary([{ ...connection, enabled: false }], [model], [key('ready')]).readyModels).toHaveLength(0);
    expect(modelSetupSummary([connection], [{ ...model, enabled: false }], [key('ready')]).readyModels).toHaveLength(0);
    const incomplete = modelSetupSummary([connection], [model], [key('off', connection.id, false)]);
    expect(incomplete.readyModels).toHaveLength(0); expect(incomplete.missingKeyConnectionId).toBe(connection.id);
  });
});
