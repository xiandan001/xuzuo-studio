import { describe, expect, it } from 'vitest';
import { copyWorkflow } from './workflow-copy';
import { createRequire } from 'node:module';
import type { WorkflowDefinition } from '../configuration-types';
const require = createRequire(import.meta.url);
const { preflight } = require('../../electron/live-validation.cjs');
const source: WorkflowDefinition = { id: 'flow', workspaceId: 'w', name: '图文提案', description: '原流程', updatedAt: '2026-11-02', outputKind: 'word', steps: [
  { id: 'image-a', name: '插图一', kind: 'image-generation', prompt: '原插图描述', inputSource: 'project', enabled: true, modelConfigId: 'image-model', credentialId: 'key', count: 1, imageSize: '1024x1024', imageBackground: 'opaque' },
  { id: 'image-b', name: '插图二', kind: 'image-generation', prompt: '原插图描述二', inputSource: 'project', enabled: true, modelConfigId: 'image-model', credentialId: 'key', count: 1, imageSize: '1024x1024', imageBackground: 'opaque' },
  { id: 'body', name: '完整正文', kind: 'text', prompt: '保留事实', inputSource: 'project', enabled: true, modelConfigId: 'text-model', credentialId: 'key', documentImageSource: 'previous', documentImageStepIds: ['image-a', 'image-b'] },
  { id: 'office', name: '导出Word', kind: 'export', prompt: '', inputSource: 'previous', enabled: true, contentSourceStepId: 'body' },
] };
const copied = () => { let index = 0; return copyWorkflow(source, () => `new-${++index}`); };
describe('复制工作流保留内部步骤引用', () => {
  it('重绑导出正文与全部图源，原提示词、凭证、顺序和源流程都保留', () => {
    const before = JSON.stringify(source), result = copied();
    expect(result.id).toBe('new-5'); expect(result.workspaceId).toBe('w'); expect(result.name).toBe('图文提案（副本）');
    expect(result.steps.map(step => step.id)).toEqual(['new-1', 'new-2', 'new-3', 'new-4']);
    expect(result.steps[2].documentImageStepIds).toEqual(['new-1', 'new-2']); expect(result.steps[3].contentSourceStepId).toBe('new-3');
    expect(result.steps[0]).toMatchObject({ prompt: source.steps[0].prompt, credentialId: 'key', modelConfigId: 'image-model', count: 1 });
    result.steps[2].documentImageStepIds!.push('isolated'); expect(JSON.stringify(source)).toBe(before);
  });
  it('未知外部引用不被静默丢弃，重复源步骤明确拒绝', () => {
    const result = copyWorkflow({ ...source, steps: source.steps.map(step => step.id === 'body' ? { ...step, documentImageStepIds: ['external'] } : step.id === 'office' ? { ...step, contentSourceStepId: 'external-body' } : step) });
    expect(result.steps[2].documentImageStepIds).toEqual(['external']); expect(result.steps[3].contentSourceStepId).toBe('external-body');
    expect(() => copyWorkflow({ ...source, steps: [source.steps[0], source.steps[0]] })).toThrow('重复步骤');
  });
  it('复制的图文流程通过真实本地预检，不会引用源流程旧编号或发送模型请求', async () => {
    const workflow = copied(), models = ['image', 'text'].map(kind => ({ id: `${kind}-model`, name: kind, modelId: `fixture-${kind}`, connectionId: 'connection', capabilities: [kind === 'image' ? 'image-generation' : 'text'], enabled: true, pricing: { unit: kind === 'image' ? 'image' : 'million-tokens', currency: 'CNY', input: '1', output: '1', perUnit: '1' } }));
    const credentials = { has: async () => true, list: async () => [{ id: 'key', connectionId: 'connection', enabled: true, name: '元数据' }] };
    const result = await preflight({ workflow, project: { id: 'project', workspaceId: 'w', kind: 'word', name: '提案', costCents: 0 }, models, connections: [{ id: 'connection', name: '本地替身', enabled: true, providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1' }], input: '完整用户需求', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true }, { credentials, modelRuntime: { supports: () => true }, artifactStore: { list: async () => [] } });
    expect(result.errors).toEqual([]); expect(result.ok).toBe(true);
  });
});
