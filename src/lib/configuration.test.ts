import { describe, expect, it } from 'vitest';
import { activeCategories, belongsToCategory, categoryError, categoryMatches, connectionError, modelError, publicConfiguration, publicModelPricing, readConfiguration } from './configuration';
import type { BusinessCategory, ModelConfiguration, ModelConnection, ModelPricing } from '../configuration-types';

const categories: BusinessCategory[] = [
  { id: 'parent', workspaceId: 'a', name: '电商', archived: false },
  { id: 'child', workspaceId: 'a', parentId: 'parent', name: '上新', archived: false },
  { id: 'other', workspaceId: 'b', name: '别区', archived: false },
];
describe('自定义配置隔离与输入约束', () => {
  it('新增独立配置不会塞入旧项目或费用', () => { const state = readConfiguration(null); expect(state.categories).toEqual([]); expect(state.workflows).toEqual([]); expect(state.models.some(model => model.demo)).toBe(true); });
  it('分类不能超过两层，也不能引用其他工作区', () => {
    expect(categoryError(categories, 'a', { name: '另一种内容', parentId: 'parent' })).toBe('');
    expect(categoryError(categories, 'a', { name: '第三层', parentId: 'child' })).not.toBe('');
    expect(categoryError(categories, 'a', { name: '错误父项', parentId: 'other' })).not.toBe('');
    expect(belongsToCategory(categories, 'a', 'other')).toBe(false);
    expect(categoryError(categories, 'a', { name: '上新', parentId: 'parent' })).not.toBe('');
  });
  it('归档父分类隐藏子分类但不修改原对象', () => { const archived = categories.map(item => item.id === 'parent' ? { ...item, archived: true } : item); expect(activeCategories(archived).map(item => item.id)).toEqual(['other']); expect(categories[1].archived).toBe(false); });
  it('筛选大分类包含小分类，未分类单独匹配', () => { expect(categoryMatches(categories, 'parent', 'child')).toBe(true); expect(categoryMatches(categories, '', undefined)).toBe(true); expect(categoryMatches(categories, 'parent', 'other')).toBe(false); });
  it('地址不能夹带Key，允许HTTPS及本机HTTP', () => {
    const draft = { name: '我的连接', protocol: 'openai-chat' as const, baseUrl: 'https://api.example.com/v1' };
    expect(connectionError(draft)).toBe(''); expect(connectionError({ ...draft, baseUrl: 'https://api.example.com?api_key=secret' })).not.toBe('');
    expect(connectionError({ ...draft, baseUrl: 'http://127.0.0.1:8888/v1' })).toBe('');
    expect(connectionError({ ...draft, baseUrl: 'http://api.example.com/v1' })).not.toBe('');
  });
  it('导出配置只保留白名单字段，不带凭证或扩展秘密字段', () => {
    const connection = { id: 'c', name: '连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://example.com', enabled: true, status: 'configured', secret: 'FAKE_SECRET_MUST_NOT_EXPORT', credentials: ['FAKE_SECRET_MUST_NOT_EXPORT'] } as ModelConnection;
    expect(JSON.stringify(publicConfiguration([connection], []))).not.toContain('FAKE_SECRET_MUST_NOT_EXPORT');
  });
  it('参考价导出保留保护标记，官方链接清理认证参数且不带秘密扩展字段', () => {
    const connection = { id: 'c', name: '连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://user:FAKE_AUTH_SECRET@example.com/v1?api_key=FAKE_QUERY_SECRET#FAKE_HASH_SECRET', enabled: true, status: 'configured' } as ModelConnection;
    const pricing = { unit: 'million-tokens', currency: 'CNY', input: '1', output: '2', referenceOnly: true, referenceNote: '长上下文阶梯价，需核对', officialUrl: 'https://reader:FAKE_PRICE_SECRET@official.example/pricing?api_key=FAKE_QUERY_SECRET#FAKE_HASH_SECRET', verifiedAt: '2026-10-30', secret: 'FAKE_PRICING_EXTENSION_SECRET' } as ModelPricing;
    const model = { id: 'm', name: '模型', modelId: 'published-model', connectionId: 'c', capabilities: ['text'], pricing, enabled: true, secret: 'FAKE_MODEL_EXTENSION_SECRET' } as ModelConfiguration;
    const exported = publicConfiguration([connection], [model]);
    expect(exported.models[0].pricing).toMatchObject({ referenceOnly: true, referenceNote: pricing.referenceNote, officialUrl: 'https://official.example/pricing', verifiedAt: '2026-10-30' });
    expect(exported.connections[0].baseUrl).toBe('https://example.com/v1');
    expect(JSON.stringify(exported)).not.toContain('FAKE_');
    expect(pricing.officialUrl).toContain('FAKE_PRICE_SECRET');
  });
  it('非法或不存在的参考元数据不会导出为可直接核算的平价', () => {
    const oldPricing: ModelPricing = { unit: 'image', currency: 'CNY', input: '', output: '0.1' };
    expect(publicModelPricing(oldPricing)).toEqual({ ...oldPricing, exchangeRate: undefined });
    const unsafe = { ...oldPricing, referenceOnly: 'true', officialUrl: 'javascript:alert(1)', referenceNote: { secret: 'FAKE_METADATA_SECRET' }, verifiedAt: '2026-02-31' } as unknown as ModelPricing;
    expect(publicModelPricing(unsafe)).toEqual({ ...oldPricing, exchangeRate: undefined, referenceOnly: true });
    expect(publicModelPricing({ ...oldPricing, referenceOnly: false }).referenceOnly).toBe(false);
  });
  it('价格元数据接受空值及旧手动配置，拒绝非法类型、超长说明和不安全来源', () => {
    const connection = { id: 'c', name: '连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://example.com', enabled: true, status: 'configured' } as ModelConnection;
    const model = { name: '模型', modelId: 'published-model', connectionId: 'c', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '', output: '' } } as Omit<ModelConfiguration, 'id'>;
    expect(modelError(model, [connection])).toBe('');
    expect(modelError({ ...model, pricing: { ...model.pricing, referenceOnly: true, referenceNote: '', officialUrl: '', verifiedAt: '' } }, [connection])).toBe('');
    expect(modelError({ ...model, pricing: { ...model.pricing, referenceOnly: true, referenceNote: '参考范围说明', officialUrl: 'https://official.example/pricing', verifiedAt: '2026-10-30' } }, [connection])).toBe('');
    for (const changes of [{ referenceOnly: 'true' }, { referenceNote: '长'.repeat(2001) }, { verifiedAt: '2026-02-31' }, { officialUrl: 'http://official.example/pricing' }, { officialUrl: 'https://user:FAKE_SOURCE_SECRET@official.example/pricing?key=FAKE_QUERY_SECRET' }]) {
      const error = modelError({ ...model, pricing: { ...model.pricing, ...changes } as ModelPricing }, [connection]);
      expect(error).not.toBe(''); expect(error).not.toContain('FAKE_');
    }
  });
});
