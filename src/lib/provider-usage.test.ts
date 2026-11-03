import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Usage = Record<string, number | string>;
interface Context { signal: AbortSignal; secret: string; requestStarted: boolean; providerRequestId?: string; }
const require = createRequire(import.meta.url);
const { normalizedUsage } = require('../../electron/provider-http.cjs') as { normalizedUsage: (data: unknown, context: Context) => Usage };
const { executeImages } = require('../../electron/provider-media.cjs') as {
  executeImages: (request: unknown, files: unknown[], context: Context, fetchImpl: () => Promise<Response>, saveArtifact: (file: unknown) => Promise<unknown>) => Promise<{ usage: Usage }>;
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aq3sAAAAASUVORK5CYII=', 'base64');
function context(): Context { return { signal: new AbortController().signal, secret: 'fixture-credential-only', requestStarted: false }; }
function normalize(usage: object): Usage { return normalizedUsage({ usage }, context()); }
async function imageResult(usage: object, kind = 'image-generation', saveFails = false) {
  return executeImages({ kind, model: { modelId: 'fixture-image' }, connection: { baseUrl: 'https://fixture.example/v1' }, prompt: 'fixture prompt', input: '', options: { count: 1 } }, kind === 'image-editing' ? [{ mimeType: 'image/png', buffer: PNG, name: 'fixture.png' }] : [], context(), async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }], usage }), { headers: { 'content-type': 'application/json' } }), async () => {
    if (saveFails) throw new Error('fixture save failed');
    return { id: 'fixture-result', name: 'image.png', mimeType: 'image/png' };
  });
}

describe('供应商计费用量明细归一化', () => {
  it('保留 Images 的文字和图片拆分，不把细项再次加入总量，也不保存原始响应', () => {
    const usage = normalize({ input_tokens: 70, output_tokens: 200, total_tokens: 270, input_tokens_details: { text_tokens: 30, image_tokens: 40, cached_tokens: 10, cached_tokens_details: { text_tokens: 3, image_tokens: 7 } }, output_tokens_details: { text_tokens: 2, image_tokens: 198 }, prompt: 'must not retain', api_key: 'must not retain' });
    expect(usage).toMatchObject({ inputTokens: 70, outputTokens: 200, totalTokens: 270, inputTextTokens: 30, inputImageTokens: 40, outputTextTokens: 2, outputImageTokens: 198, cachedInputTokens: 10, cachedInputTextTokens: 3, cachedInputImageTokens: 7, usageSource: 'provider-reported' });
    expect(usage).not.toHaveProperty('prompt'); expect(usage).not.toHaveProperty('api_key'); expect(usage).not.toHaveProperty('input_tokens_details');
  });

  it('OpenAI 缓存写入的30分钟与12小时组件不和父字段重复计数，思考属于输出总量', () => {
    expect(normalize({ input_tokens: 12000, input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 } }, output_tokens: 900, output_tokens_details: { reasoning_tokens: 200 } })).toMatchObject({ inputTokens: 12000, uncachedInputTokens: 1000, cachedInputTokens: 4000, cacheWriteInputTokens: 7000, cacheWrite30mTokens: 3000, cacheWrite12hTokens: 4000, outputTokens: 900, reasoningTokens: 200 });
  });

  it('Anthropic 的原始 input_tokens 是未缓存部分，只在合成输入总量时加入读写缓存一次', () => {
    expect(normalize({ input_tokens: 100, cache_read_input_tokens: 400, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 }, output_tokens: 50 })).toMatchObject({ inputTokens: 800, uncachedInputTokens: 100, cachedInputTokens: 400, cacheWriteInputTokens: 300, cacheWrite5mTokens: 200, cacheWrite1hTokens: 100, outputTokens: 50 });
  });

  it('完整分时缓存写入可恢复缺失的父级合计，不能把缺少的某一时长默认当零', () => {
    const full = normalize({ input_tokens: 10, cache_read_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40 } });
    expect(full).toMatchObject({ inputTokens: 100, cacheWriteInputTokens: 70, cacheWrite5mTokens: 30, cacheWrite1hTokens: 40 });
    const partial = normalize({ input_tokens: 10, cache_read_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 30 } });
    expect(partial).not.toHaveProperty('cacheWriteInputTokens'); expect(partial).not.toHaveProperty('inputTokens');
  });

  it('DeepSeek 命中和未命中是输入的组成，cached_tokens 别名不再相加', () => {
    expect(normalize({ prompt_tokens: 100, prompt_cache_hit_tokens: 30, prompt_cache_miss_tokens: 70, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 }, total_tokens: 150 })).toMatchObject({ inputTokens: 100, cachedInputTokens: 30, uncachedInputTokens: 70, outputTokens: 50, reasoningTokens: 20, totalTokens: 150 });
  });

  it('Gemini prompt 包含缓存，candidates 不含 thoughts，模态计数均只作子项', () => {
    const result = normalizedUsage({ usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 30, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 60 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }], candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'IMAGE', tokenCount: 0 }] } }, context());
    expect(result).toMatchObject({ inputTokens: 100, cachedInputTokens: 30, uncachedInputTokens: 70, inputTextTokens: 40, inputImageTokens: 60, cachedInputTextTokens: 10, cachedInputImageTokens: 20, outputTokens: 25, outputTextTokens: 20, outputImageTokens: 0, reasoningTokens: 5, totalTokens: 125 });
  });

  it('只接受安全非负整数 token，不用错误或缺失字段伪造零值与合计', () => {
    const result = normalize({ input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: -1, total_tokens: 1.5, input_tokens_details: { text_tokens: '3', image_tokens: NaN, cached_tokens: Infinity }, output_tokens_details: { image_tokens: 0, text_tokens: 2.5, reasoning_tokens: -3 } });
    expect(result).toEqual({ outputImageTokens: 0, usageSource: 'provider-reported' });
    expect(normalizedUsage({}, context())).toEqual({});
    const overflow = normalize({ input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 });
    expect(overflow).not.toHaveProperty('inputTokens');
    const unsafeThinking = normalizedUsage({ usageMetadata: { candidatesTokenCount: 10, thoughtsTokenCount: 1.5 } }, context());
    expect(unsafeThinking).not.toHaveProperty('outputTokens');
  });
});

describe('Images 请求形状补全', () => {
  it('文生图可以证明输入仅文字、输出图片，明确标注推导来源', async () => {
    expect((await imageResult({ input_tokens: 30, output_tokens: 196, total_tokens: 226 })).usage).toMatchObject({ inputTokens: 30, inputTextTokens: 30, inputImageTokens: 0, outputTokens: 196, outputImageTokens: 196, outputTextTokens: 0, images: 1, usageSource: 'provider-reported+request-shape' });
  });

  it('优先保留供应商真实拆分，不用请求形状覆盖报告的数值', async () => {
    expect((await imageResult({ input_tokens: 30, output_tokens: 196, input_tokens_details: { text_tokens: 28, image_tokens: 2 }, output_tokens_details: { text_tokens: 1, image_tokens: 195 } })).usage).toMatchObject({ inputTextTokens: 28, inputImageTokens: 2, outputTextTokens: 1, outputImageTokens: 195, usageSource: 'provider-reported' });
  });

  it('提供商只报告部分拆分时不把其他部分默认成零', async () => {
    const { usage } = await imageResult({ input_tokens: 30, output_tokens: 196, input_tokens_details: { text_tokens: 28 }, output_tokens_details: { image_tokens: 195 } });
    expect(usage).toMatchObject({ inputTextTokens: 28, outputImageTokens: 195, usageSource: 'provider-reported' });
    expect(usage).not.toHaveProperty('inputImageTokens'); expect(usage).not.toHaveProperty('outputTextTokens');
  });

  it('图片编辑缺少真实拆分时保持未知，不把图片输入全部算成文字', async () => {
    const { usage } = await imageResult({ input_tokens: 30, output_tokens: 196 }, 'image-editing');
    expect(usage).toMatchObject({ inputTokens: 30, outputTokens: 196, usageSource: 'provider-reported' });
    for (const field of ['inputTextTokens', 'inputImageTokens', 'outputTextTokens', 'outputImageTokens']) expect(usage).not.toHaveProperty(field);
  });

  it('图片编辑有真实拆分时完整保留，落盘失败也不能丢失本次用量', async () => {
    await expect(imageResult({ input_tokens: 70, output_tokens: 196, input_tokens_details: { text_tokens: 30, image_tokens: 40 }, output_tokens_details: { image_tokens: 196, text_tokens: 0 } }, 'image-editing', true)).rejects.toMatchObject({ usage: { inputTokens: 70, inputTextTokens: 30, inputImageTokens: 40, outputImageTokens: 196, outputTextTokens: 0, images: 1, usageSource: 'provider-reported' } });
  });
});
