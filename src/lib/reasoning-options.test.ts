import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { normalizeReasoningEffort, reasoningOptions, reasoningRequestFields } from './reasoning-options';
import { normalizeNaturalBinding, normalizeNaturalBindings } from './natural-model-bindings';

const require = createRequire(import.meta.url);
const native = require('../../electron/reasoning-options.cjs');
const { executeText } = require('../../electron/provider-text.cjs');
const openai = (protocol = 'openai-responses') => ({ providerId: 'openai', protocol });
const values = (modelId: string, protocol = 'openai-responses') => reasoningOptions(openai(protocol), { modelId }).map(option => option.value);

describe('模型专属推理强度', () => {
  it('GPT6各型号区分关闭推理能力，不给Astra/Sol发送不支持的none或minimal', () => {
    expect(values('gpt-6.1-terra')).toEqual(['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max']);
    for (const id of ['gpt-6-astra', 'gpt-6.1-sol']) expect(values(id)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(values('gpt-6-luna')).toContain('none');
    expect(values('gpt-6.1-terra-2026-10-01')).toEqual(values('gpt-6.1-terra'));
  });
  it('旧型号、专用型号、未知兼容服务不根据相似名称乱传参数', () => {
    expect(values('gpt-4.1')).toEqual(['auto']);
    expect(values('gpt-image-2.6')).toEqual(['auto']);
    expect(values('gpt-5.5')).not.toContain('max');
    expect(values('gpt-5')).toContain('minimal');
    expect(reasoningOptions({ providerId: 'deepseek', protocol: 'openai-chat' }, { modelId: 'gpt-6-astra' }).map(option => option.value)).toEqual(['auto']);
    expect(reasoningOptions({ providerId: 'openai', protocol: 'image' }, { modelId: 'gpt-6-astra' }).map(option => option.value)).toEqual(['auto']);
  });
  it('MiniMax只为M3.1-Flash提供已公开的五档强度，不向M3或其他协议猜测发送', () => {
    const connection = { providerId: 'minimax', protocol: 'openai-chat' }, model = { modelId: 'MiniMax-M3.1-Flash' };
    expect(reasoningOptions(connection, model).map(option => option.value)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(reasoningRequestFields(connection, model, 'high')).toEqual({ reasoning_effort: 'high' });
    expect(reasoningRequestFields(connection, model, 'auto')).toEqual({});
    expect(() => reasoningRequestFields(connection, model, 'none')).toThrow('不支持');
    expect(reasoningOptions(connection, { modelId: 'MiniMax-M3' }).map(option => option.value)).toEqual(['auto']);
    expect(reasoningOptions({ ...connection, protocol: 'openai-responses' }, model).map(option => option.value)).toEqual(['auto']);
  });
  it('切换模型后只保留可用强度，原始Key和任意字段无法混入偏好', () => {
    expect(normalizeReasoningEffort(openai(), { modelId: 'gpt-6-astra' }, 'none')).toBe('auto');
    expect(normalizeReasoningEffort(openai(), { modelId: 'gpt-6.1-terra' }, 'high')).toBe('high');
    expect(normalizeNaturalBinding({ modelConfigId: 'text-model', credentialId: 'credential-id', reasoningEffort: 'high' })).toEqual({ modelConfigId: 'text-model', credentialId: 'credential-id', reasoningEffort: 'high' });
    expect(normalizeNaturalBindings({ text: { modelConfigId: 'text-model', reasoningEffort: 'max' } }).text?.reasoningEffort).toBe('max');
    for (const input of [{ reasoningEffort: 'unlimited' }, { reasoningEffort: { effort: 'high' } }, { reasoningEffort: 'high', secret: 'fixture' }, { credentialId: 'sk-test-fixture', reasoningEffort: 'low' }]) expect(() => normalizeNaturalBinding(input)).toThrow();
  });
  it('前后端使用同一能力数据，auto不加入任何供应商推理字段', () => {
    const fixtures = [[openai(), 'gpt-6-astra'], [openai('openai-chat'), 'gpt-6.1-terra'], [{ protocol: 'anthropic' }, 'claude-sonnet-4-6'], [{ protocol: 'anthropic' }, 'claude-opus-5-5'], [{ protocol: 'gemini' }, 'gemini-3-pro-preview'], [{ protocol: 'gemini' }, 'gemini-3.7-flash']] as const;
    for (const [connection, modelId] of fixtures) {
      const model = { modelId };
      expect(native.reasoningOptions(connection, model)).toEqual(reasoningOptions(connection, model));
      expect(native.reasoningRequestFields(connection, model, 'auto')).toEqual({});
      for (const option of reasoningOptions(connection, model)) expect(native.reasoningRequestFields(connection, model, option.value)).toEqual(reasoningRequestFields(connection, model, option.value));
    }
    expect(() => reasoningRequestFields(openai(), { modelId: 'gpt-6-astra' }, 'none')).toThrow('不支持');
    expect(() => reasoningRequestFields({ protocol: 'gemini' }, { modelId: 'gemini-3-pro-preview' }, 'medium')).toThrow('不支持');
  });
});

describe('实际文字协议请求保留推理选择与输出上限', () => {
  it.each([
    ['openai-responses', 'openai', 'gpt-6.1-terra', { status: 'completed', output_text: '最终答复', usage: { input_tokens: 12, output_tokens: 50, output_tokens_details: { reasoning_tokens: 40 } } }, { reasoning: { effort: 'high' }, max_output_tokens: 4096 }],
    ['openai-chat', 'openai', 'gpt-6.1-terra', { choices: [{ message: { content: '最终答复' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 40 } } }, { reasoning_effort: 'high', max_completion_tokens: 4096 }],
    ['anthropic', 'anthropic', 'claude-sonnet-4-6', { content: [{ type: 'text', text: '最终答复' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 50 } }, { thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, max_tokens: 4096 }],
    ['gemini', 'google', 'gemini-3.7-flash', { candidates: [{ content: { parts: [{ text: '最终答复' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 10, thoughtsTokenCount: 40 } }, { generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'high' } } }],
  ])('%s发送原生字段，返回正文不混入内部思考', async (protocol, providerId, modelId, response, expected) => {
    const context = { signal: new AbortController().signal, requestStarted: false, secret: 'fixture-not-a-real-key' }, calls: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string, options: RequestInit) => { calls.push(JSON.parse(String(options.body))); return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }); });
    const request = { kind: 'text', connection: { protocol, providerId, baseUrl: 'https://provider.invalid/v1' }, model: { modelId }, prompt: '回答问题', input: '测试文字', options: { maxOutputTokens: 4096, reasoningEffort: 'high' } };
    const result = await executeText(request, [], context, fetch);
    expect(calls[0]).toMatchObject(expected); expect(result.text).toBe('最终答复'); expect(fetch).toHaveBeenCalledTimes(1);
    if (providerId === 'openai') expect(result.usage.reasoningTokens).toBe(40);
  });
  it('非法强度在联网前拒绝，auto不会悄悄改成收费更高的等级', async () => {
    const context = { signal: new AbortController().signal, requestStarted: false, secret: 'fixture' }, fetch = vi.fn();
    const request = { kind: 'text', connection: { ...openai(), baseUrl: 'https://provider.invalid/v1' }, model: { modelId: 'gpt-6-astra' }, prompt: '回答问题', input: '', options: { reasoningEffort: 'none' } };
    await expect(executeText(request, [], context, fetch)).rejects.toThrow('不支持'); expect(fetch).not.toHaveBeenCalled();
  });
});
