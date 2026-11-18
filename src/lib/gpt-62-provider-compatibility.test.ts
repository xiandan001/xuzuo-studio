import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const load = createRequire(import.meta.url);
const { executeChat } = load('../../electron/provider-chat.cjs'), { executeText } = load('../../electron/provider-text.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const image = { name: 'actual.png', mimeType: 'image/png', buffer: png };
const models = ['gpt-6.2-astra', 'gpt-6.2-sol'];
const protocols = ['openai-responses', 'openai-chat'];
const usages = { responses: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10, cache_write_tokens_details: { ttl_30m_tokens: 10 } }, output_tokens_details: { reasoning_tokens: 40 } }, chat: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10, cache_write_tokens_details: { ttl_30m_tokens: 10 } }, completion_tokens_details: { reasoning_tokens: 40 } } };
const forbidden = ['temperature', 'top_p', 'logprobs', 'top_logprobs', 'prompt_cache_retention', 'tools', 'tool_choice'];
const requestFor = (modelId: string, protocol: string) => ({ id: 'turn', workspaceId: 'workspace', conversationId: 'conversation', text: '看图或正常交流', credentialId: 'metadata-only', connection: { id: 'connection', enabled: true, providerId: 'openai', protocol, baseUrl: 'https://provider.invalid/v1' }, model: { id: 'model', modelId, enabled: true, connectionId: 'connection', name: modelId, capabilities: ['text', 'vision'] }, reasoningEffort: 'max' });
function responsePayload(protocol: string) { return protocol === 'openai-responses' ? { id: 'resp_fixture', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', phase: 'final_answer', content: [{ type: 'output_text', text: '最终正文' }] }], usage: usages.responses } : { id: 'chat_fixture', choices: [{ message: { content: '最终正文' }, finish_reason: 'stop' }], usage: usages.chat }; }
function stream(protocol: string) {
  const events = protocol === 'openai-responses' ? [{ type: 'response.reasoning_summary_text.delta', delta: '不应混入正文的推理' }, { type: 'response.output_text.delta', delta: '最终正文' }, { type: 'response.completed', response: responsePayload(protocol) }] : [{ id: 'chat_fixture', choices: [{ delta: { reasoning_content: '不应混入正文的推理' } }] }, { id: 'chat_fixture', choices: [{ delta: { content: '最终正文' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: usages.chat }];
  return new Response(events.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
function verifyBody(body: Record<string, any>, protocol: string, modelId: string, vision: boolean, effort: string) {
  expect(body.model).toBe(modelId); expect(body.store).toBe(false); for (const key of forbidden) expect(body).not.toHaveProperty(key);
  if (protocol === 'openai-responses') { expect(body.reasoning).toEqual({ effort }); expect(body).not.toHaveProperty('reasoning_effort'); }
  else { expect(body.reasoning_effort).toBe(effort); expect(body).not.toHaveProperty('reasoning'); }
  const content = (protocol === 'openai-responses' ? body.input : body.messages).at(-1).content;
  if (vision) { const part = content.find((item: { type: string }) => item.type === (protocol === 'openai-responses' ? 'input_image' : 'image_url')); expect(protocol === 'openai-responses' ? part.image_url : part.image_url.url).toBe('data:image/png;base64,' + png.toString('base64')); }
}
describe('官方6.2普通聊天与看图协议兼容：仅本地合成HTTP/SSE', () => {
  it.each(models.flatMap(model => protocols.flatMap(protocol => [false, true].map(vision => [model, protocol, vision] as const))))('%s %s vision=%s真实构造并解码流式正文，保留用量而不引入采样或工具', async (modelId, protocol, vision) => {
    const sent: { url: string; body: Record<string, any> }[] = [], chunks: string[] = [];
    const fetch = vi.fn(async (url: string, options: RequestInit) => { sent.push({ url, body: JSON.parse(String(options.body)) }); return stream(protocol); });
    const store = { withSecret: vi.fn(async (_id: string, _connection: string, action: (key: string) => Promise<unknown>) => action('NON_ACCOUNT_FIXTURE_VALUE')) };
    const input = requestFor(modelId, protocol), result = await executeChat(input, [{ role: 'user', content: '描述实际输入', ...(vision ? { attachments: [image] } : {}) }], { credentialStore: store, fetchImpl: fetch, onText: (text: string) => chunks.push(text) });
    expect(fetch).toHaveBeenCalledTimes(1); expect(store.withSecret).toHaveBeenCalledTimes(1); expect(sent[0].url).toBe('https://provider.invalid/v1/' + (protocol === 'openai-responses' ? 'responses' : 'chat/completions')); verifyBody(sent[0].body, protocol, modelId, vision, 'max');
    expect(sent[0].body[protocol === 'openai-responses' ? 'max_output_tokens' : 'max_completion_tokens']).toBe(8192); expect(result.text).toBe('最终正文'); expect(chunks.at(-1)).toBe('最终正文'); expect(chunks.join('')).not.toContain('推理'); expect(result.requestStarted).toBe(true); expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, reasoningTokens: 40, cachedInputTokens: 20, cacheWrite30mTokens: 10 });
  });
  it.each(models.flatMap(model => protocols.map(protocol => [model, protocol] as const)))('%s %s的工作流vision请求仍用正确端点/图片/推理字段', async (modelId, protocol) => {
    const calls: { url: string; body: Record<string, any> }[] = [], fetch = vi.fn(async (url: string, options: RequestInit) => { calls.push({ url, body: JSON.parse(String(options.body)) }); return new Response(JSON.stringify(responsePayload(protocol)), { headers: { 'content-type': 'application/json' } }); });
    const input = requestFor(modelId, protocol), request = { kind: 'vision', connection: input.connection, model: input.model, prompt: '查看图片', input: '', options: { reasoningEffort: 'low', maxOutputTokens: 1024 } }, context = { secret: 'NON_ACCOUNT_FIXTURE_VALUE', signal: new AbortController().signal, requestStarted: false };
    const result = await executeText(request, [image], context, fetch); expect(fetch).toHaveBeenCalledTimes(1); expect(calls[0].url).toBe('https://provider.invalid/v1/' + (protocol === 'openai-responses' ? 'responses' : 'chat/completions')); verifyBody(calls[0].body, protocol, modelId, true, 'low'); expect(result.text).toBe('最终正文'); expect(result.usage.reasoningTokens).toBe(40);
  });
  it.each(models)('%s显式none/minimal在取Key和HTTP前拒绝，auto不强制附加推理字段', async modelId => {
    for (const protocol of protocols) for (const effort of ['none', 'minimal']) {
      const fetch = vi.fn(), withSecret = vi.fn(), input = { ...requestFor(modelId, protocol), reasoningEffort: effort };
      await expect(executeChat(input, [{ role: 'user', content: '正常提问' }], { credentialStore: { withSecret }, fetchImpl: fetch })).rejects.toThrow('不支持'); expect(withSecret).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    }
    for (const protocol of protocols) { const { prepareChat } = load('../../electron/provider-chat.cjs'), value = prepareChat({ ...requestFor(modelId, protocol), reasoningEffort: 'auto' }, [{ role: 'user', content: '正常提问' }]); expect(value.body).not.toHaveProperty('reasoning'); expect(value.body).not.toHaveProperty('reasoning_effort'); }
  });
});
