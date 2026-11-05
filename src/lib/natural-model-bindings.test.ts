import { describe, expect, it } from 'vitest';
import { normalizeNaturalBinding, normalizeNaturalBindings, replaceNaturalProductionBinding } from './natural-model-bindings';

describe('自然语言自动化制作模型引用', () => {
  it('只复制支持的元数据编号，清理空引用', () => {
    const source = { text: { modelConfigId: 'model-text', credentialId: 'key-text' }, vision: { modelConfigId: '', credentialId: undefined } };
    const next = normalizeNaturalBindings(source); expect(next).toEqual({ text: source.text }); expect(next.text).not.toBe(source.text);
    expect(normalizeNaturalBinding({ modelConfigId: null, credentialId: '' })).toEqual({});
  });
  it('拒绝不支持的能力、危险额外字段、无效ID和原始Key', () => {
    for (const value of [null, [], { speech: {} }, { text: null }, { text: { secret: 'not-metadata' } }, { text: { modelConfigId: '../../path' } }, { text: { credentialId: 'sk-proj-test-dummy' } }]) expect(() => normalizeNaturalBindings(value)).toThrow();
  });
  it('只替换所选用途，取消选择不会修改原对象或其他用途', () => {
    const source = { text: { modelConfigId: 'text-model' }, 'image-generation': { modelConfigId: 'generation-model', credentialId: 'generation-key' } }, selected = { modelConfigId: 'new-model', credentialId: 'new-key' };
    const next = replaceNaturalProductionBinding(source, 'text', selected); expect(next.text).toEqual(selected); expect(next.text).not.toBe(selected); expect(next['image-generation']).toBe(source['image-generation']); expect(source.text.modelConfigId).toBe('text-model');
    expect(replaceNaturalProductionBinding(next, 'text', {})).toEqual({ 'image-generation': source['image-generation'] });
  });
});
