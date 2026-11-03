import { describe, expect, it } from 'vitest';
import type { ModelConnection } from '../configuration-types';
import { MODEL_CATALOG, catalogConnectionDraft, catalogConnectionMatches, catalogModelDraft, catalogPricing, filterModelCatalog, matchingCatalogConnections } from '../model-catalog';
import type { ModelCatalogEntry } from '../model-catalog';
import { modelError } from './configuration';

const entry: ModelCatalogEntry = { id: 'fixture-text', providerId: 'aliyun', name: '测试模型', modelId: 'fixture-model', capabilities: ['text'], protocols: ['openai-chat'], region: '北京按量', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', allowedHosts: ['dashscope.aliyuncs.com', '*.cn-beijing.maas.aliyuncs.com'], status: 'current', description: '', checkedAt: '2026-10-30', sources: [{ label: '官方价格', url: 'https://help.aliyun.com/zh/model-studio/model-pricing' }], support: { ready: true, note: '账号未实测' }, pricing: { currency: 'CNY', unit: 'million-tokens', input: '1', output: '4', referenceOnly: false, displayLines: ['输入1，输出4'], note: '仅北京标准按量参考价', example: '1000输入加1000输出约0.005元' } };
const connection: ModelConnection = { id: 'cn', name: '北京', providerId: 'aliyun', protocol: 'openai-chat', baseUrl: entry.defaultBaseUrl, enabled: true, status: 'configured' };

describe('官方目录连接与计价范围', () => {
  it('只匹配同供应商、协议、官方地域域名和真实API路径', () => {
    expect(catalogConnectionMatches(entry, connection)).toBe(true);
    expect(catalogConnectionMatches(entry, { ...connection, baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/' })).toBe(true);
    for (const changed of [{ providerId: 'custom' }, { protocol: 'gemini' as const }, { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }, { baseUrl: 'https://dashscope.aliyuncs.com:444/compatible-mode/v1' }, { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/coding' }, { baseUrl: 'https://dashscope.aliyuncs.com.evil.test/compatible-mode/v1' }, { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1?key=secret' }, { enabled: false }, { demo: true }]) expect(catalogConnectionMatches(entry, { ...connection, ...changed })).toBe(false);
    expect(matchingCatalogConnections(entry, [connection, { ...connection, id: 'foreign', baseUrl: 'https://example.com/v1' }]).map(item => item.id)).toEqual(['cn']);
  });
  it('创建配置保留准确ID、价目来源和核对日期，不自动填汇率或修改原目录', () => {
    const draft = catalogModelDraft(entry, connection);
    expect(draft).toMatchObject({ modelId: 'fixture-model', connectionId: 'cn', capabilities: ['text'], pricing: { referenceOnly: false, officialUrl: entry.sources[0].url, verifiedAt: '2026-10-30' } });
    draft.capabilities.push('vision'); expect(entry.capabilities).toEqual(['text']);
    const dollars = { ...entry, pricing: { ...entry.pricing, currency: 'USD' as const, referenceOnly: true } };
    expect(catalogPricing(dollars).exchangeRate).toBeUndefined();
    expect(catalogPricing(dollars, '8')).toMatchObject({ exchangeRate: '8', referenceOnly: true });
  });
  it('不允许需适配型号或不匹配连接悄悄成为可运行配置', () => {
    expect(() => catalogModelDraft({ ...entry, support: { ready: false, note: '专用图片接口尚需适配' } }, connection)).toThrow('尚需适配');
    expect(() => catalogModelDraft(entry, { ...connection, baseUrl: 'https://example.com' })).toThrow('地域');
    expect(catalogConnectionDraft(entry)).toMatchObject({ providerId: 'aliyun', protocol: 'openai-chat', baseUrl: entry.defaultBaseUrl });
    expect(() => catalogConnectionDraft({ ...entry, defaultBaseUrl: 'https://{WorkspaceId}.example.com/v1' })).toThrow('接入配置');
  });
  it('每个可配置目录条目均能通过保存校验，官方语言查询参数不会阻止保存', () => {
    for (const item of MODEL_CATALOG.filter(model => model.support.ready)) {
      const connected = { ...connection, id: item.id, providerId: item.providerId, protocol: item.protocols[0], baseUrl: item.defaultBaseUrl };
      const draft = catalogModelDraft(item, connected);
      expect(modelError(draft, [connected]), item.id).toBe('');
      expect(new URL(draft.pricing.officialUrl!).search).toBe('');
    }
  });
  it('支持中文供应商别名、准确ID和用途筛选，图片理解不会误列成图片生成', () => {
    const matches = filterModelCatalog({ query: '谷歌', capability: 'text' });
    expect(matches.length).toBeGreaterThan(0); expect(matches.every(item => item.providerId === 'google' && item.capabilities.includes('text'))).toBe(true);
    expect(filterModelCatalog({ query: 'gpt-6-luna' }).some(item => item.modelId === 'gpt-6-luna')).toBe(true);
    expect(filterModelCatalog({ providerId: 'openai', capability: 'image-generation' }).every(item => item.capabilities.includes('image-generation'))).toBe(true);
  });
});
