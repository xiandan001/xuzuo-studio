import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import snapshot from './model-catalog-data.json';
import { catalogConnectionMatches } from './model-catalog';
import type { ModelCatalogEntry } from './model-catalog';
import type { ModelConnection } from './configuration-types';

const entries = snapshot.models as unknown as ModelCatalogEntry[];
const cutoff = '2026-11-05';
const model = (providerId: string, modelId: string, currency?: string) => {
  const entry = entries.find(item => item.providerId === providerId && item.modelId === modelId && (!currency || item.pricing.currency === currency));
  if (!entry) throw new Error(`目录缺少 ${providerId}/${modelId}/${currency || ''}`);
  return entry;
};
const connection = (entry: ModelCatalogEntry, baseUrl = entry.defaultBaseUrl): ModelConnection => ({ id: 'fixture-connection', name: '测试连接', providerId: entry.providerId, protocol: entry.protocols[0], baseUrl, enabled: true, status: 'configured' });
const officialSourceHosts = new Set(['developers.openai.com', 'api-docs.deepseek.com', 'help.aliyun.com', 'docs.volcengine.com', 'console.volcengine.com', 'platform.claude.com', 'ai.google.dev', 'docs.bigmodel.cn', 'platform.kimi.com', 'platform.minimax.cn', 'platform.minimax.io', 'www.minimax.io', 'cloud.tencent.com', 'www.siliconflow.cn', 'api-docs.siliconflow.cn', 'docs.siliconflow.cn']);
const capabilities = new Set(['text', 'vision', 'image-generation', 'image-editing', 'transcription', 'speech', 'video-understanding', 'video-generation']);
const protocols = new Set(['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'image', 'audio', 'video', 'custom']);

describe('官方模型目录数据快照', () => {
  it('覆盖11家服务商且ID唯一，核对日固定、未知发布日期不编造', () => {
    expect(snapshot.checkedAt).toBe(cutoff);
    expect(entries.length).toBeGreaterThanOrEqual(40);
    expect(entries.length).toBeLessThanOrEqual(55);
    expect(new Set(entries.map(item => item.id)).size).toBe(entries.length);
    expect(new Set(entries.map(item => item.providerId))).toEqual(new Set(['openai', 'anthropic', 'google', 'deepseek', 'aliyun', 'volcengine', 'tencent', 'zhipu', 'moonshot', 'minimax', 'siliconflow']));
    for (const entry of entries) {
      expect(entry.checkedAt).toBe(/^gpt-image-2\.6-(sunburst|flare)$/.test(entry.modelId) ? cutoff : '2026-10-30');
      expect(entry.modelId.trim()).toBe(entry.modelId);
      expect(entry.name).not.toBe(''); expect(entry.region).not.toBe('');
      expect(['current', 'preview', 'older']).toContain(entry.status);
      expect(entry.capabilities.length).toBeGreaterThan(0); expect(entry.protocols.length).toBeGreaterThan(0);
      for (const capability of entry.capabilities) expect(capabilities.has(capability)).toBe(true);
      for (const protocol of entry.protocols) expect(protocols.has(protocol)).toBe(true);
      expect(['CNY', 'USD']).toContain(entry.pricing.currency);
      expect(['million-tokens', 'image', 'request']).toContain(entry.pricing.unit);
      if (entry.releaseDate) { expect(entry.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(entry.releaseDate <= cutoff).toBe(true); }
    }
    expect(model('openai', 'gpt-6.1-terra').releaseDate).toBeUndefined();
  });

  it('来源为官方HTTPS页面，模型和价格可追溯，默认地址可实际填写', () => {
    for (const entry of entries) {
      expect(entry.sources.length).toBeGreaterThanOrEqual(2);
      expect(entry.sources.some(item => /价格|计费/.test(item.label))).toBe(true);
      for (const source of entry.sources) { const url = new URL(source.url); expect(url.protocol).toBe('https:'); expect(officialSourceHosts.has(url.hostname)).toBe(true); expect(url.username || url.password).toBe(''); }
      const endpoint = new URL(entry.defaultBaseUrl);
      expect(endpoint.protocol).toBe('https:'); expect(endpoint.search || endpoint.hash || endpoint.username || endpoint.password).toBe('');
      expect(entry.defaultBaseUrl).not.toMatch(/[{}]/);
      expect(catalogConnectionMatches(entry, connection(entry))).toBe(true);
    }
  });

  it('新增2.6精确别名与发布日期，使用Images协议且不承诺账户已开通或固定SVG/GIF价格', () => {
    for (const flavor of ['sunburst', 'flare']) {
      const entry = model('openai', `gpt-image-2.6-${flavor}`);
      expect(entry.releaseDate).toBe('2026-11-04');
      expect(entry.protocols).toEqual(['image', 'openai-responses', 'openai-chat']);
      expect(entry.support.note).toContain('图像操作始终使用Images接口');
      expect(catalogConnectionMatches(entry, { ...connection(entry), protocol: 'openai-responses' })).toBe(true);
      expect(entry.capabilities).toEqual(['image-generation', 'image-editing']);
      expect(entry.support.note).toContain('未验证当前账户');
      expect(entry.pricing.displayLines.join(' ')).toContain('SVG另计作者模型Token');
      expect(entry.pricing.note).toContain('不推定');
    }
    expect(entries.some(entry => entry.modelId === 'gpt-image-2.6')).toBe(false);
    expect(model('openai', 'gpt-image-2.5-flare').checkedAt).toBe('2026-10-30');
  });

  it('MiniMax中国站与国际站按同一模型分成不同条目，货币、来源与允许主机不混用', () => {
    const cn = model('minimax', 'MiniMax-M3.1-Flash', 'CNY');
    const io = model('minimax', 'MiniMax-M3.1-Flash', 'USD');
    expect(cn.id).not.toBe(io.id);
    expect(cn.pricing).toMatchObject({ input: '1.00', output: '4.00' });
    expect(io.pricing).toMatchObject({ input: '0.15', output: '0.60' });
    expect(new URL(cn.defaultBaseUrl).hostname).toBe('api.minimax.cn');
    expect(new URL(io.defaultBaseUrl).hostname).toBe('api.minimax.io');
    expect(cn.sources.some(item => /价格/.test(item.label) && new URL(item.url).hostname === 'platform.minimax.cn')).toBe(true);
    expect(io.sources.some(item => /价格/.test(item.label) && new URL(item.url).hostname === 'platform.minimax.io')).toBe(true);
    expect(catalogConnectionMatches(cn, connection(cn, io.defaultBaseUrl))).toBe(false);
    expect(catalogConnectionMatches(io, connection(io, cn.defaultBaseUrl))).toBe(false);
  });

  it('地域绑定阻止北京和广州价格用于海外端点，也不生成WorkspaceId占位地址', () => {
    const qwen = model('aliyun', 'qwen3.8-flash');
    expect(qwen.defaultBaseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(catalogConnectionMatches(qwen, connection(qwen, 'https://my-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'))).toBe(true);
    expect(catalogConnectionMatches(qwen, connection(qwen, 'https://my-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'))).toBe(false);
    expect(catalogConnectionMatches(qwen, connection(qwen, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'))).toBe(false);
    const hy = model('tencent', 'hy3');
    expect(catalogConnectionMatches(hy, connection(hy, 'https://tokenhub-intl.tencentmaas.com/v1'))).toBe(false);
    const deepseek = model('deepseek', 'deepseek-flash');
    expect(catalogConnectionMatches(deepseek, connection(deepseek, 'https://api.deepseek.com/v1'))).toBe(true);
    expect(catalogConnectionMatches(deepseek, connection(deepseek, 'https://api.deepseek.com/anthropic'))).toBe(false);
  });

  it('复合、阶梯、峰谷或即将到期的价格保持参考模式，普通价有清楚的未缓存条件', () => {
    const conditional = ['deepseek-flash', 'deepseek-v4-pro', 'qwen3.7-plus', 'qwen3.7-flash', 'doubao-seed-2-0-mini-260428', 'claude-haiku-5-5', 'gemini-4-argon', 'gemini-3.8-flash', 'MiniMax-M3'];
    for (const entry of entries) {
      if (entry.providerId === 'openai' || conditional.includes(entry.modelId) || entry.capabilities.some(kind => kind === 'image-generation' || kind === 'image-editing')) expect(entry.pricing.referenceOnly).toBe(true);
      for (const amount of [entry.pricing.input, entry.pricing.output]) if (amount) expect(amount).toMatch(/^\d+(?:\.\d{1,6})?$/);
      expect(entry.pricing.displayLines.length).toBeGreaterThan(0);
      expect(entry.pricing.note).not.toBe(''); expect(entry.pricing.example).not.toBe('');
      if (!entry.pricing.referenceOnly) { expect(Number(entry.pricing.input)).toBeGreaterThan(0); expect(Number(entry.pricing.output)).toBeGreaterThan(0); expect(entry.pricing.note).toContain('未命中缓存'); }
    }
    expect(model('google', 'gemini-4-argon').pricing.displayLines.join(' ')).toContain('2026-11-30');
    expect(model('deepseek', 'deepseek-flash').pricing.displayLines.join(' ')).toContain('空闲价');
  });

  it('只把已适配的OpenAI图片接口标记可直接配置，其它图片型号仅供查询', () => {
    for (const entry of entries.filter(item => item.capabilities.some(kind => kind === 'image-generation' || kind === 'image-editing'))) {
      expect(entry.support.ready).toBe(entry.providerId === 'openai');
      expect(entry.support.note).not.toBe('');
      expect(entry.pricing.example).toMatch(/仅输出部分|基础费用/);
    }
    for (const id of ['hy4-preview', 'hy3']) expect(model('tencent', id).capabilities).toEqual(['text']);
    expect(model('zhipu', 'glm-5.3').capabilities).toEqual(['text']);
    expect(model('deepseek', 'deepseek-v4-pro').capabilities).toEqual(['text']);
    expect(model('deepseek', 'deepseek-flash').capabilities).toContain('vision');
  });

  it('停用与仅兼容路由的旧型号不作为新建推荐条目，预览和旧版选择明确标记', () => {
    const excluded = ['gpt-image-1', 'dall-e-2', 'dall-e-3', 'imagen-4.0-generate-001', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'hunyuan-2.0-instruct', 'hunyuan-2.0-thinking', 'hunyuan-t1', 'hunyuan-turbos', 'MiniMax-M2.5', 'MiniMax-M2.7'];
    for (const id of excluded) expect(entries.some(entry => entry.modelId === id)).toBe(false);
    expect(model('tencent', 'hy4-preview').status).toBe('preview');
    expect(model('zhipu', 'cogview-4-250304').status).toBe('older');
    expect(model('moonshot', 'kimi-k3').status).toBe('older');
    expect(model('openai', 'gpt-image-2.5-sunburst').status).toBe('current');
  });

  it('文字费用示例明确输入和输出数量，产品快照不夹带假余额或密钥并使用UTF-8 LF', () => {
    for (const entry of entries.filter(item => item.capabilities.includes('text'))) expect(entry.pricing.example).toContain('1,000 输入 + 1,000 输出 Token');
    const data = readFileSync(new URL('./model-catalog-data.json', import.meta.url));
    expect(data.includes(13)).toBe(false); expect(data.includes(0)).toBe(false);
    const text = data.toString('utf8');
    expect(text).not.toMatch(/"(?:balance|apiKey|secret)"\s*:/);
    expect(text).not.toMatch(/sk-proj-[A-Za-z0-9]{10}/);
    expect(JSON.parse(text).models).toHaveLength(entries.length);
  });
});
