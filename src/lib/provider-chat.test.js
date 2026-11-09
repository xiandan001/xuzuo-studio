import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { executeChat, prepareChat } = require('../../electron/provider-chat.cjs');
const { createCredentialStore } = require('../../electron/credential-store.cjs');
const { CredentialStoreError, credentialErrorMessage } = require('../../electron/credential-errors.cjs');

const connection = { id: 'connection', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true };
const model = { id: 'model', modelId: 'gpt-6.1-terra', name: 'Fixture', connectionId: 'connection', enabled: true, capabilities: ['text'] };
const input = { connection, model, credentialId: 'key' };
const messages = [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好，有什么想讨论的？' }, { role: 'user', content: '请解释上一句' }];
const credentials = { withSecret: async (_id, _connection, run) => run('fixture-secret-123') };
const encode = value => `data: ${JSON.stringify(value)}\n\n`;
function sse(events, split = 7) {
  const data = new TextEncoder().encode(events.map(event => typeof event === 'string' ? event : encode(event)).join(''));
  return new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < data.length; offset += split) controller.enqueue(data.slice(offset, offset + split)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-fixture' } });
}
const finalResponse = text => ({ type: 'response.completed', response: { id: 'resp-fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 12, output_tokens_details: { reasoning_tokens: 3 } } } });
function macCredentials(decryptStringAsync) {
  return createCredentialStore({
    directory: '/mock-chat-credentials', platform: 'darwin', safeStorage: { decryptStringAsync },
    fileSystem: { readFile: async () => JSON.stringify({ version: 1, entries: [{ id: 'key', name: 'Fixture', connectionId: connection.id, lastFour: '123', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z', ciphertext: Buffer.from('mock-ciphertext').toString('base64') }] }) },
  });
}
describe('普通聊天的真实供应商传输', () => {
  it('Responses保留原生多轮角色，发送强度并流式解码跨字节中文与用量', async () => {
    let sent; const chunks = [];
    const result = await executeChat({ ...input, reasoningEffort: 'low' }, messages, { credentialStore: credentials, onText: text => chunks.push(text), fetchImpl: async (_url, options) => { sent = options; return sse([{ type: 'response.output_text.delta', delta: '你好，' }, { type: 'response.output_text.delta', delta: '世界' }, finalResponse('你好，世界')], 1); } });
    const body = JSON.parse(sent.body); expect(body.input).toEqual(messages); expect(body.reasoning).toEqual({ effort: 'low' }); expect(body.stream).toBe(true); expect(body.store).toBe(false); expect(sent.redirect).toBe('manual');
    expect(result.text).toBe('你好，世界'); expect(chunks).toContain('你好，'); expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 12, reasoningTokens: 3 }); expect(result.billingRequestSnapshot.source).toBe('adapter-request');
  });
  it('自动强度不强行发送模型不支持的参数', () => {
    const body = prepareChat({ ...input, model: { ...model, modelId: 'custom-text-model' }, reasoningEffort: 'auto' }, messages).body;
    expect(body).not.toHaveProperty('reasoning'); expect(() => prepareChat({ ...input, model: { ...model, modelId: 'custom-text-model' }, reasoningEffort: 'high' }, messages)).toThrow(/推理强度/);
  });
  it('MiniMax保留独立reasoning_split，防止把供应商思考字段混入普通回答', async () => {
    let body;
    const result = await executeChat({ ...input, connection: { ...connection, providerId: 'minimax', protocol: 'openai-chat', baseUrl: 'https://api.minimax.io/v1' }, model: { ...model, modelId: 'MiniMax-M2.1' } }, messages, { credentialStore: credentials, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return sse([{ choices: [{ delta: { reasoning_details: [{ text: 'private' }], content: '正常回答' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }, 'data: [DONE]\n\n']); } });
    expect(body.reasoning_split).toBe(true); expect(result.text).toBe('正常回答');
  });
  it('ChatCompletions读取独立usage终块，未混入推理正文', async () => {
    let body;
    const result = await executeChat({ ...input, connection: { ...connection, protocol: 'openai-chat' }, reasoningEffort: 'medium' }, messages, { credentialStore: credentials, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return sse([{ choices: [{ delta: { reasoning_content: 'private', content: '回答' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 11, completion_tokens: 13, completion_tokens_details: { reasoning_tokens: 4 } } }, 'data: [DONE]\n\n']); } });
    expect(result.text).toBe('回答'); expect(body.reasoning_effort).toBe('medium'); expect(body.messages.slice(1)).toEqual(messages); expect(result.usage.outputTokens).toBe(13); expect(result.usage.reasoningTokens).toBe(4);
  });
  it('Anthropic区分思考与回答，合并开始和结束用量及缓存', async () => {
    let sent;
    const result = await executeChat({ ...input, connection: { ...connection, providerId: 'anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }, model: { ...model, modelId: 'claude-sonnet-4-6' }, reasoningEffort: 'high' }, messages, { credentialStore: credentials, fetchImpl: async (url, options) => { sent = { url, ...options }; return sse([{ type: 'message_start', message: { id: 'msg-fixture', usage: { input_tokens: 10, cache_read_input_tokens: 5 } } }, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: '普通回答' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }]); } });
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages'); expect(sent.headers['x-api-key']).toBe('fixture-secret-123'); expect(JSON.parse(sent.body)).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }); expect(result.text).toBe('普通回答'); expect(result.usage).toMatchObject({ inputTokens: 15, cachedInputTokens: 5, outputTokens: 9 });
  });
  it('Gemini使用SSE接口并映射角色和thinkingLevel，用量包含thought tokens', async () => {
    let sent;
    const result = await executeChat({ ...input, connection: { ...connection, providerId: 'google', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }, model: { ...model, modelId: 'gemini-3-pro-preview' }, reasoningEffort: 'high' }, messages, { credentialStore: credentials, fetchImpl: async (url, options) => { sent = { url, ...options }; return sse([{ candidates: [{ content: { parts: [{ text: '私有', thought: true }, { text: '你好' }] } }] }, { candidates: [{ content: { parts: [{ text: '呀' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, thoughtsTokenCount: 6 } }]); } });
    expect(sent.url).toContain(':streamGenerateContent?alt=sse'); const body = JSON.parse(sent.body); expect(body.contents[1].role).toBe('model'); expect(body.generationConfig).toMatchObject({ maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'high' } }); expect(result.text).toBe('你好呀'); expect(result.usage).toMatchObject({ inputTokens: 8, outputTokens: 10, reasoningTokens: 6 });
  });
  it('兼容返回普通JSON的服务，但仍验证终态与用量', async () => {
    const result = await executeChat(input, messages, { credentialStore: credentials, fetchImpl: async () => Response.json(finalResponse('JSON回答').response) });
    expect(result.text).toBe('JSON回答'); expect(result.usage.outputTokens).toBe(12);
  });
  it('断流没有完整结束信号时保留片段，绝不冒充完整答案', async () => {
    await expect(executeChat(input, messages, { credentialStore: credentials, fetchImpl: async () => sse([{ type: 'response.output_text.delta', delta: '部分回答' }]) })).rejects.toMatchObject({ code: 'INCOMPLETE_OUTPUT', partialText: '部分回答', requestStarted: true });
  });
  it('Chat的DONE不能替代stop信号，也不把max_tokens截断算作成功', async () => {
    const options = { credentialStore: credentials, fetchImpl: async () => sse([{ choices: [{ delta: { content: '片段' }, finish_reason: 'length' }], usage: { prompt_tokens: 3, completion_tokens: 8 } }, 'data: [DONE]\n\n']) };
    await expect(executeChat({ ...input, connection: { ...connection, protocol: 'openai-chat' } }, messages, options)).rejects.toMatchObject({ code: 'INCOMPLETE_OUTPUT', partialText: '片段', usage: { outputTokens: 8 } });
  });
  it('收到usage后取消仍保留已发生用量和回答', async () => {
    const abort = new AbortController(); let controller;
    const source = new ReadableStream({ start(value) { controller = value; } });
    const task = executeChat({ ...input, connection: { ...connection, protocol: 'openai-chat' } }, messages, { credentialStore: credentials, signal: abort.signal, onText: () => queueMicrotask(() => abort.abort()), fetchImpl: async () => { controller.enqueue(new TextEncoder().encode(encode({ choices: [{ delta: { content: '已返回' } }], usage: { prompt_tokens: 6, completion_tokens: 4 } }))); return new Response(source, { headers: { 'content-type': 'text/event-stream' } }); } });
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED', partialText: '已返回', requestStarted: true, usage: { inputTokens: 6, outputTokens: 4 } });
  });
  it('认证重定向被阻止，凭证不转发给第二个地址', async () => {
    let calls = 0;
    await expect(executeChat(input, messages, { credentialStore: credentials, fetchImpl: async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://elsewhere.invalid' } }); } })).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' }); expect(calls).toBe(1);
  });
  it('凭证读取失败无请求发生，不把它记作已调用', async () => {
    let calls = 0;
    await expect(executeChat(input, messages, { credentialStore: { withSecret: async () => { throw Error('credential unavailable'); } }, fetchImpl: async () => { calls++; } })).rejects.toMatchObject({ requestStarted: false }); expect(calls).toBe(0);
  });
  it('macOS拒绝钥匙串授权时保留安全的凭证分类，聊天请求未发送', async () => {
    let calls = 0, decrypts = 0;
    const store = macCredentials(async () => { decrypts++; throw Error('Keychain denied: fixture-secret-123 /mock-ciphertext'); });
    const error = await executeChat(input, messages, { credentialStore: store, fetchImpl: async () => { calls++; } }).catch(value => value);
    expect(error).toMatchObject({ name: 'ModelRuntimeError', code: 'CREDENTIAL_DECRYPT_FAILED', requestStarted: false, message: credentialErrorMessage('CREDENTIAL_DECRYPT_FAILED') });
    expect(error.message).toContain('Mac 登录密码'); expect(error).not.toHaveProperty('providerRequestId'); expect(error).not.toHaveProperty('cause');
    expect(`${error.message}\n${JSON.stringify(error)}`).not.toMatch(/fixture-secret-123|mock-ciphertext|Keychain denied/);
    expect(decrypts).toBe(1); expect(calls).toBe(0);
  });
  it.each(['CREDENTIAL_STORE_UNREADABLE', 'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_INVALID'])('保留真实凭证错误%s的固定文案，不回显异常的原始消息', async code => {
    const cause = new CredentialStoreError(code); cause.message = 'private fixture-secret-123'; let calls = 0;
    const error = await executeChat(input, messages, { credentialStore: { withSecret: async () => { throw cause; } }, fetchImpl: async () => { calls++; } }).catch(value => value);
    expect(error).toMatchObject({ code, requestStarted: false, message: credentialErrorMessage(code) }); expect(error.message).not.toContain('fixture-secret-123'); expect(calls).toBe(0);
  });
  it('普通异常不能伪造凭证错误分类或泄漏私密消息', async () => {
    const cause = Object.assign(Error('private fixture-secret-123'), { code: 'CREDENTIAL_DECRYPT_FAILED' });
    const error = await executeChat(input, messages, { credentialStore: { withSecret: async () => { throw cause; } } }).catch(value => value);
    expect(error).toMatchObject({ code: 'INVALID_CREDENTIAL', requestStarted: false }); expect(error.message).not.toMatch(/fixture-secret-123|Mac 登录密码/);
  });
  it('成功解密后供应商回调失败保留HTTP状态和已发送状态，不误报为凭证解密失败', async () => {
    let calls = 0;
    const store = macCredentials(async () => ({ result: 'fixture-secret-123' }));
    const error = await executeChat(input, messages, { credentialStore: store, fetchImpl: async () => { calls++; return Response.json({ error: { message: 'private fixture-secret-123' } }, { status: 429 }); } }).catch(value => value);
    expect(error).toMatchObject({ code: 'HTTP_ERROR', httpStatus: 429, requestStarted: true }); expect(error.message).not.toContain('fixture-secret-123'); expect(calls).toBe(1);
  });
  it('回答中回显的凭证被隐藏，正文和流式片段不出现明文', async () => {
    const chunks = [], answer = '凭证是fixture-secret-123';
    const result = await executeChat(input, messages, { credentialStore: credentials, onText: value => chunks.push(value), fetchImpl: async () => sse([{ type: 'response.output_text.delta', delta: answer }, finalResponse(answer)]) });
    expect(result.text).toContain('[密钥已隐藏]'); expect(chunks.every(value => !value.includes('fixture-secret-123'))).toBe(true);
  });
  it('供应商拒绝和业务错误保留用量但不自动重试', async () => {
    await expect(executeChat(input, messages, { credentialStore: credentials, fetchImpl: async () => sse([{ type: 'response.refusal.delta', delta: 'refused' }, finalResponse('')]) })).rejects.toMatchObject({ code: 'PROVIDER_REFUSAL', usage: { outputTokens: 12 } });
  });
});
