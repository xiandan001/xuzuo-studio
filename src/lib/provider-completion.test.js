import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const secret = 'fixture-only-not-a-real-key';
const text = `返回片段 ${secret}`;
const cases = [
  ['openai-chat', 'length', { choices: [{ message: { content: text }, finish_reason: 'length' }], usage: { prompt_tokens: 8, completion_tokens: 10 } }, 'INCOMPLETE_OUTPUT'],
  ['openai-chat', 'content_filter', { choices: [{ message: { content: text }, finish_reason: 'content_filter' }], usage: { prompt_tokens: 8, completion_tokens: 10 } }, 'PROVIDER_REFUSAL'],
  ['openai-chat', 'tool_calls', { choices: [{ message: { content: text }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 8, completion_tokens: 10 } }, 'INCOMPLETE_OUTPUT'],
  ['openai-chat', 'missing', { choices: [{ message: { content: text } }], usage: { prompt_tokens: 8, completion_tokens: 10 } }, 'INCOMPLETE_OUTPUT'],
  ['openai-responses', 'incomplete', { status: 'incomplete', output_text: text, usage: { input_tokens: 8, output_tokens: 10 } }, 'INCOMPLETE_OUTPUT'],
  ['openai-responses', 'refusal', { status: 'completed', output_text: text, output: [{ type: 'message', content: [{ type: 'refusal' }] }], usage: { input_tokens: 8, output_tokens: 10 } }, 'PROVIDER_REFUSAL'],
  ['anthropic', 'pause_turn', { content: [{ type: 'text', text }], stop_reason: 'pause_turn', usage: { input_tokens: 8, output_tokens: 10 } }, 'INCOMPLETE_OUTPUT'],
  ['anthropic', 'refusal', { content: [{ type: 'text', text }], stop_reason: 'refusal', usage: { input_tokens: 8, output_tokens: 10 } }, 'PROVIDER_REFUSAL'],
  ['gemini', 'SAFETY', { candidates: [{ content: { parts: [{ text }] }, finishReason: 'SAFETY' }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 10 } }, 'PROVIDER_REFUSAL'],
  ['gemini', 'MAX_TOKENS', { candidates: [{ content: { parts: [{ text }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 10 } }, 'INCOMPLETE_OUTPUT'],
];
describe('生产终止状态与不完整原稿保留', () => {
  it.each(cases)('%s/%s保留片段和用量，不伪装成完整成功或自动重发', async (protocol, _reason, data, code) => {
    const saved = []; let calls = 0;
    const runtime = createModelRuntime({ credentialStore: { withSecret: async (_id, _connection, action) => action(secret) }, artifactStore: { read: async () => { throw new Error('No attachments in fixture'); }, write: async input => { saved.push(input); return { id: 'partial', name: input.name, kind: 'text', projectId: input.projectId }; } }, fetchImpl: async () => { calls++; return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-request' } }); } });
    let error;
    try { await runtime.execute({ runId: 'run', projectId: 'project', kind: 'text', credentialId: 'fixture', connection: { id: 'connection', enabled: true, protocol, providerId: 'custom', baseUrl: 'https://fixture.invalid/v1' }, model: { id: 'fixture', modelId: 'fixture', enabled: true, connectionId: 'connection', capabilities: ['text'] }, prompt: '隔离终止状态验收', input: '', options: {} }); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code, requestStarted: true, partialText: '返回片段 [已隐藏凭证]', usage: { inputTokens: 8, outputTokens: 10 }, artifacts: [{ id: 'partial' }] });
    expect(calls).toBe(1); expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: '未完成结果.txt', text: '返回片段 [已隐藏凭证]', runId: 'run', projectId: 'project' });
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
