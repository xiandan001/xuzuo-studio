import { describe, expect, it } from 'vitest';
import type { ModelConfiguration, WorkflowRun, WorkflowStep } from '../configuration-types';
import { latestStudioBinding, studioCredentialChoice, studioProjectCredential, studioProjectModel } from './studio-project-bindings';

const step = (id: string, modelConfigId = id): WorkflowStep => ({ id, modelConfigId, credentialId: id + '-key', kind: 'text', inputSource: 'project', enabled: true, name: id, prompt: '' });
const run = (id: string, steps: WorkflowStep[], overrides: Partial<WorkflowRun> = {}) => ({ id, mode: 'live', workspaceId: 'ws', projectId: 'p', snapshot: { steps }, updatedAt: id, ...overrides }) as WorkflowRun;
const model = (id: string): ModelConfiguration => ({ id, name: id, modelId: id, connectionId: 'c', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } });
describe('工作台沿用本次作品的生产账户', () => {
  it('从本区本项目真实生产快照带入制作步骤，排除付费规划、别区与本地导出空步骤', () => {
    const producer = { ...step('writer'), role: 'producer' as const };
    const runs = [run('2026-11-04', [step('other')], { workspaceId: 'else' }), run('2026-11-05', [step('planner')], { purpose: 'automation-plan' }), run('2026-11-03', []), run('2026-11-02', [producer, { ...step('reviewer'), role: 'reviewer' }])];
    expect(latestStudioBinding(runs, 'ws', 'p', 'text')).toEqual(producer);
  });
  it('明确本地选择优先，继承或本地已失效时不偷换唯一其他模型和Key', () => {
    const inherited = step('saved');
    expect(studioProjectModel([model('saved'), model('local')], 'local', inherited)?.id).toBe('local');
    expect(studioProjectModel([model('other')], '', inherited)).toBeUndefined();
    expect(studioProjectModel([model('other')], 'removed')).toBeUndefined();
    const keys = [{ id: 'other-key', name: '另一账户', connectionId: 'c', enabled: true, lastFour: 'test', updatedAt: '2026-11-04' }];
    expect(studioProjectCredential(keys, model('saved'), '', inherited)).toBeUndefined();
    expect(studioProjectCredential(keys, model('saved'), 'removed', inherited)).toBeUndefined();
    expect(studioProjectCredential(keys, model('new'), '', inherited)).toBe('other-key');
    expect(studioProjectCredential([...keys, { ...keys[0], id: 'saved-key' }], model('new'), studioCredentialChoice('saved-key', model('saved')), step('new'))).toBeUndefined();
    expect(studioProjectCredential([...keys, { ...keys[0], id: 'new-key' }], model('new'), studioCredentialChoice('other-key', model('saved')), step('new'))).toBe('new-key');
  });
  it('同供应商同模型的生成和精修步骤仍分别沿用各自账户', () => {
    const generation = { ...step('generate', 'shared'), kind: 'image-generation' as const, credentialId: 'key-a' };
    const editing = { ...step('edit', 'shared'), kind: 'image-editing' as const, credentialId: 'key-b' };
    const runs = [run('2026-11-04', [generation, editing])];
    const keys = ['key-a', 'key-b'].map(id => ({ id, name: id, connectionId: 'c', enabled: true, lastFour: 'test', updatedAt: '2026-11-04' }));
    expect(studioProjectCredential(keys, model('shared'), '', latestStudioBinding(runs, 'ws', 'p', 'image-generation'))).toBe('key-a');
    expect(studioProjectCredential(keys, model('shared'), '', latestStudioBinding(runs, 'ws', 'p', 'image-editing'))).toBe('key-b');
  });
});
