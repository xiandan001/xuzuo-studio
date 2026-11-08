import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiProtocol, ModelCapability, ModelConfiguration, ModelConnection } from '../configuration-types';
import type { ArtifactMetadata, ModelUsage } from '../live-types';

interface StoredFile extends ArtifactMetadata { buffer: Buffer; }
interface ArtifactInput { runId: string; projectId: string; name: string; mimeType: string; buffer?: Buffer; text?: string; }
interface ArtifactStore { read: (id: string) => Promise<StoredFile>; write: (input: ArtifactInput) => Promise<ArtifactMetadata>; }
interface RuntimeRequest { requestId: string; runId: string; projectId: string; connection: ModelConnection; model: ModelConfiguration; credentialId: string; kind: ModelCapability; prompt: string; input: string; attachments: ArtifactMetadata[]; options: { maxOutputTokens?: number; size?: string; background?: string; voice?: string; count?: number; existingTaskId?: string }; }
interface RuntimeResult { text: string; artifacts: ArtifactMetadata[]; usage: ModelUsage; providerRequestId?: string; resumedTask?: boolean; }
interface Runtime { execute: (input: RuntimeRequest, options?: { signal?: AbortSignal; onProgress?: (event: { phase: string; message: string }) => void }) => Promise<RuntimeResult>; supports: (connection: ModelConnection, kind: ModelCapability) => boolean; }
type FetchMock = (url: string, init: RequestInit) => Promise<Response>;
interface RuntimeOptions { credentialStore: { withSecret: (id: string, connectionId: string, action: (secret: string) => Promise<RuntimeResult>) => Promise<RuntimeResult> }; artifactStore: ArtifactStore; fetchImpl: FetchMock; }
const require = createRequire(import.meta.url);
const { createModelRuntime } = require('../../electron/model-runtime.cjs') as { createModelRuntime: (options: RuntimeOptions) => Runtime };
const { CredentialStoreError, credentialErrorMessage } = require('../../electron/credential-errors.cjs');
const FAKE_KEY = 'fixture-only-credential-4729';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aq3sAAAAASUVORK5CYII=', 'base64');

function metadata(id: string, name: string, mimeType: string, buffer: Buffer): StoredFile {
  return { id, name, mimeType, bytes: buffer.length, path: `test-memory/${name}`, kind: mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'text', createdAt: '2026-10-29T12:00:00Z', buffer };
}
function mp4Box(type: string, payload: Buffer) {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4, 4, 'ascii'); return Buffer.concat([header, payload]);
}
function mp4Fixture(duration = 2000, mediaBytes = 24) {
  const movieHeader = Buffer.alloc(100); movieHeader.writeUInt32BE(1000, 12); movieHeader.writeUInt32BE(duration, 16);
  return Buffer.concat([mp4Box('ftyp', Buffer.from('isom\0\0\0\0isomiso2')), mp4Box('moov', mp4Box('mvhd', movieHeader)), mp4Box('mdat', Buffer.alloc(mediaBytes))]);
}
function request(protocol: ApiProtocol = 'openai-chat', kind: ModelCapability = 'text'): RuntimeRequest {
  const connection: ModelConnection = { id: 'test-connection', name: '测试服务', providerId: 'openai', protocol, baseUrl: protocol === 'anthropic' ? 'https://api.example.test' : protocol === 'gemini' ? 'https://api.example.test/v1beta' : 'https://api.example.test/v1', enabled: true, status: 'configured' };
  const model: ModelConfiguration = { id: 'test-model', name: '测试模型', modelId: 'user-configured-model-id', connectionId: connection.id, capabilities: [kind], pricing: { unit: 'million-tokens', currency: 'CNY', input: '', output: '' }, enabled: true };
  return { requestId: 'request-1', runId: 'run-1', projectId: 'project-1', connection, model, credentialId: 'test-credential', kind, prompt: '请整理重点。', input: '测试输入资料', attachments: [], options: { maxOutputTokens: 512 } };
}
function jsonResponse(data: object, status = 200, headers: Record<string, string> = {}) {
  // Positive fixtures include the terminal fields required by their real protocols.
  const value = structuredClone(data) as Record<string, unknown>;
  if (Array.isArray(value.choices)) value.choices = value.choices.map(choice => ({ finish_reason: 'stop', ...choice }));
  if (('output_text' in value || 'output' in value) && !('status' in value)) value.status = 'completed';
  if (Array.isArray(value.candidates)) value.candidates = value.candidates.map(candidate => ({ finishReason: 'STOP', ...candidate }));
  if (Array.isArray(value.content) && !('stop_reason' in value)) value.stop_reason = 'end_turn';
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function fixture(fetcher: FetchMock = async () => jsonResponse({ choices: [{ message: { content: '真实接口返回的测试文字' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } })) {
  const files = new Map<string, StoredFile>();
  const writes: ArtifactInput[] = [];
  const artifactStore: ArtifactStore = {
    read: async id => { const file = files.get(id); if (!file) throw new Error('missing test artifact'); return file; },
    write: async input => { writes.push(input); const buffer = input.buffer || Buffer.from(input.text || ''); const file = { ...metadata(`output-${writes.length}`, input.name, input.mimeType, buffer), runId: input.runId, projectId: input.projectId }; files.set(file.id, file); const { buffer: _buffer, ...result } = file; return result; },
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return fetcher(url, init); });
  const withSecret = vi.fn(async (_id: string, _connectionId: string, action: (secret: string) => Promise<RuntimeResult>) => action(FAKE_KEY));
  const options: RuntimeOptions = { credentialStore: { withSecret }, artifactStore, fetchImpl };
  return { ...options, files, writes, calls, withSecret, runtime: createModelRuntime(options) };
}

afterEach(() => { vi.useRealTimers(); });

describe('真实模型协议适配（只用 fake fetch 和假凭证）', () => {
  it.each(['CREDENTIAL_DECRYPT_FAILED', 'CREDENTIAL_STORE_UNREADABLE', 'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_INVALID'])('保留可信凭证错误 %s，并在发请求前停止', async code => {
    const f = fixture();
    f.withSecret.mockImplementation(async () => { throw new CredentialStoreError(code); });
    let error: unknown;
    try { await f.runtime.execute(request()); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ name: 'ModelRuntimeError', code, message: credentialErrorMessage(code), requestStarted: false });
    expect(f.calls).toHaveLength(0); expect(f.writes).toHaveLength(0);
    expect(String(error)).not.toContain(FAKE_KEY);
  });

  it('不把任意凭证错误原文或伪造code透传到界面', async () => {
    const f = fixture();
    f.withSecret.mockImplementation(async () => { throw Object.assign(new Error(FAKE_KEY), { code: 'CREDENTIAL_DECRYPT_FAILED' }); });
    let error: unknown;
    try { await f.runtime.execute(request()); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'EXECUTION_FAILED', requestStarted: false });
    expect(String(error)).not.toContain(FAKE_KEY); expect(f.calls).toHaveLength(0);
  });

  it.each([
    ['openai-chat', { choices: [{ message: { content: '第一段\n第二段' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }],
    ['openai-responses', { id: 'resp-test', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: '第一段' }] }, { type: 'message', content: [{ type: 'output_text', text: '第二段' }] }], usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } }],
    ['anthropic', { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 5 } }],
    ['gemini', { candidates: [{ content: { parts: [{ text: '内部思考', thought: true }, { text: '第一段' }, { text: '第二段' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 } }],
  ] as const)('%s 使用自己的请求体与返回结构，并保存真正的文字文件内容', async (protocol, data) => {
    const f = fixture(async () => jsonResponse(data, 200, { 'x-request-id': 'provider-test-17' }));
    const result = await f.runtime.execute(request(protocol));
    const call = f.calls[0]; const body = JSON.parse(String(call.init.body));
    expect(result.text).toBe('第一段\n第二段');
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 5, providerRequestId: 'provider-test-17' });
    expect(result.providerRequestId).toBe('provider-test-17');
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({ text: result.text, mimeType: 'text/plain', runId: 'run-1', projectId: 'project-1' });
    expect(call.init.redirect).toBe('manual');
    expect(body.model || 'user-configured-model-id').toBe('user-configured-model-id');
    if (protocol === 'openai-chat') { expect(body.messages[0].content).toContain('测试输入资料'); expect(body.max_completion_tokens).toBe(512); expect(body.input).toBeUndefined(); }
    if (protocol === 'openai-responses') { expect(body.input[0].content[0].type).toBe('input_text'); expect(body.max_output_tokens).toBe(512); expect(body.store).toBe(false); expect(body.messages).toBeUndefined(); }
    if (protocol === 'anthropic') { expect(call.url.endsWith('/v1/messages')).toBe(true); expect(call.init.headers).toMatchObject({ 'x-api-key': FAKE_KEY, 'anthropic-version': '2023-06-01' }); expect(body.max_tokens).toBe(512); }
    if (protocol === 'gemini') { expect(call.url.endsWith('/v1beta/models/user-configured-model-id:generateContent')).toBe(true); expect(call.init.headers).toMatchObject({ 'x-goog-api-key': FAKE_KEY }); expect(body.contents[0].parts[0].text).toContain('测试输入资料'); expect(body.generationConfig.maxOutputTokens).toBe(512); expect(call.url).not.toContain(FAKE_KEY); }
  });

  it('通用 Chat 兼容接口使用 max_tokens，不假定所有供应商支持 OpenAI 新字段', async () => {
    const f = fixture(); const input = request(); input.connection.providerId = 'deepseek';
    await f.runtime.execute(input);
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.max_tokens).toBe(512); expect(body.max_completion_tokens).toBeUndefined();
  });

  it('MiniMax按官方格式分离思考内容，只把最终正文写入产物', async () => {
    const f = fixture(async () => jsonResponse({ choices: [{ message: { content: '可交付正文', reasoning_content: 'fixture-only-thinking' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
    const input = request(); input.connection.providerId = 'minimax'; input.model.modelId = 'MiniMax-M3.1-Flash';
    const result = await f.runtime.execute(input);
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toMatchObject({ reasoning_split: true, max_tokens: 512 });
    expect(result.text).toBe('可交付正文'); expect(f.writes[0].text).not.toContain('fixture-only-thinking');
    expect(result.usage.outputTokens).toBe(30);
  });

  it.each(['openai-chat', 'openai-responses', 'anthropic', 'gemini'] as const)('%s 图像理解发送本地图片，普通文字步骤不发送图片', async protocol => {
    const responses = { 'openai-chat': { choices: [{ message: { content: '看到了图片' } }] }, 'openai-responses': { output: [{ type: 'message', content: [{ type: 'output_text', text: '看到了图片' }] }] }, anthropic: { content: [{ type: 'text', text: '看到了图片' }] }, gemini: { candidates: [{ content: { parts: [{ text: '看到了图片' }] } }] } };
    const f = fixture(async () => jsonResponse(responses[protocol]));
    const image = metadata('image-1', 'reference.png', 'image/png', PNG); f.files.set(image.id, image);
    const input = request(protocol, 'vision'); input.attachments = [image];
    await f.runtime.execute(input);
    const expected = { 'openai-chat': 'image_url', 'openai-responses': 'input_image', anthropic: 'media_type', gemini: 'inlineData' }[protocol];
    expect(String(f.calls[0].init.body)).toContain(expected); expect(String(f.calls[0].init.body)).toContain(PNG.toString('base64'));
    const textInput = request(protocol); textInput.attachments = [image];
    await f.runtime.execute(textInput);
    expect(String(f.calls[1].init.body)).not.toContain(PNG.toString('base64'));
  });

  it('Responses 图像理解可以使用本地 PDF，不把 Office 文件伪装成图片', async () => {
    const f = fixture(async () => jsonResponse({ output_text: '文档摘要', usage: {} }));
    const file = metadata('pdf-1', 'brief.pdf', 'application/pdf', Buffer.from('%PDF-test')); f.files.set(file.id, file);
    const input = request('openai-responses', 'vision'); input.attachments = [file];
    await f.runtime.execute(input);
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.input[0].content[1]).toMatchObject({ type: 'input_file', filename: 'brief.pdf', file_data: expect.stringContaining('data:application/pdf;base64,') });
  });

  it('图片生成保存供应商返回的真实 PNG 字节到本机文件，而非示例 SVG', async () => {
    const f = fixture(async () => jsonResponse({ data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 11, output_tokens: 9, total_tokens: 20 } }));
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xuzuo-model-runtime-'));
    f.artifactStore.write = async input => {
      const filename = path.join(directory, input.name);
      const buffer = input.buffer || Buffer.from(input.text || '');
      await writeFile(filename, buffer);
      const { buffer: _buffer, ...file } = metadata('real-png', input.name, input.mimeType, buffer);
      return { ...file, path: filename, runId: input.runId, projectId: input.projectId };
    };
    const runtime = createModelRuntime(f);
    const input = request('image', 'image-generation'); input.options = { count: 1, background: 'transparent', size: '1024x1024' };
    const result = await runtime.execute(input);
    expect(await readFile(result.artifacts[0].path)).toEqual(PNG);
    expect(result.artifacts[0].mimeType).toBe('image/png'); expect(result.usage).toMatchObject({ images: 1, totalTokens: 20 });
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toMatchObject({ model: 'user-configured-model-id', output_format: 'png', n: 1, background: 'transparent', size: '1024x1024' });
    expect(f.calls[0].url.endsWith('/images/generations')).toBe(true);
  });

  it('图片编辑使用 multipart 原图文件，重复执行形成两次请求', async () => {
    const f = fixture(async () => jsonResponse({ data: [{ b64_json: PNG.toString('base64') }] }));
    const image = metadata('image-1', 'reference.png', 'image/png', PNG); f.files.set(image.id, image);
    const input = request('image', 'image-editing'); input.attachments = [image];
    await f.runtime.execute(input); await f.runtime.execute(input);
    expect(f.calls).toHaveLength(2); expect(f.writes).toHaveLength(2);
    const body = f.calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData); expect(body.get('model')).toBe('user-configured-model-id');
    const file = body.getAll('image[]')[0] as File;
    expect(file.name).toBe('reference.png'); expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
    expect(f.calls[0].init.headers).not.toHaveProperty('content-type'); expect(f.calls[0].url.endsWith('/images/edits')).toBe(true);
  });

  it('请求多图但返回较少时明确数量不足，不自动补发收费调用', async () => {
    const f = fixture(async () => jsonResponse({ data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }] }));
    const input = request('image', 'image-generation'); input.options = { count: 4 };
    const result = await f.runtime.execute(input);
    expect(result.text).toContain('请求 4 张，实际保存 2 张'); expect(result.text).toContain('数量不足'); expect(result.text).toContain('人工决定'); expect(result.text).toContain('另计费用');
    expect(result.artifacts).toHaveLength(2); expect(result.usage.images).toBe(2); expect(f.calls).toHaveLength(1);
  });

  it('第二张保存失败时保留第一张真实产物与整次已知用量，错误不泄露Key', async () => {
    const f = fixture(async () => jsonResponse({ data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }], usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 } }, 200, { 'x-request-id': 'paid-images-request' }));
    const originalWrite = f.artifactStore.write; let attemptedWrites = 0;
    f.artifactStore.write = async input => { if (++attemptedWrites === 2) throw new Error(FAKE_KEY); return originalWrite(input); };
    const input = request('image', 'image-generation'); input.options = { count: 2 };
    let error: unknown; try { await f.runtime.execute(input); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ name: 'ModelRuntimeError', requestStarted: true, providerRequestId: 'paid-images-request', artifacts: [expect.objectContaining({ id: 'output-1', mimeType: 'image/png' })], usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12, images: 2 } });
    expect(f.files.get('output-1')?.buffer).toEqual(PNG); expect(f.writes).toHaveLength(1); expect(f.calls).toHaveLength(1); expect(JSON.stringify(error)).not.toContain(FAKE_KEY); expect(String(error)).not.toContain(FAKE_KEY);
  });

  it('付费文字结果落盘失败时保留完整脱敏文字和用量，不把费用当零', async () => {
    const f = fixture(async () => jsonResponse({ output_text: `完整付费结果 ${FAKE_KEY}`, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }, 200, { 'x-request-id': 'paid-text-request' }));
    f.artifactStore.write = async () => { throw new Error(FAKE_KEY); };
    let error: unknown; try { await f.runtime.execute(request('openai-responses')); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'EXECUTION_FAILED', requestStarted: true, providerRequestId: 'paid-text-request', partialText: '完整付费结果 [已隐藏凭证]', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    expect(JSON.stringify(error)).not.toContain(FAKE_KEY); expect(String(error)).not.toContain(FAKE_KEY); expect(f.calls).toHaveLength(1);
  });

  it('下载供应商图片 URL 时不携带 API Key，下载字节受上限约束', async () => {
    let count = 0;
    const f = fixture(async () => ++count === 1 ? jsonResponse({ data: [{ url: 'https://assets.example.test/result.png?temporary=1' }] }) : new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } }));
    const result = await f.runtime.execute(request('image', 'image-generation'));
    expect(result.artifacts).toHaveLength(1); expect(f.calls).toHaveLength(2);
    expect(JSON.stringify(f.calls[1].init.headers)).not.toContain(FAKE_KEY);
    expect(f.calls[1].init.headers).not.toHaveProperty('authorization'); expect(f.calls[1].init.redirect).toBe('manual');
  });

  it('图片下载超过32MB或重定向时停止，不写入假图片或转发Key', async () => {
    for (const response of [new Response(new Uint8Array(PNG), { headers: { 'content-length': String(33 * 1024 * 1024) } }), new Response('', { status: 302, headers: { location: 'https://other.example.test/image' } })]) {
      let count = 0;
      const f = fixture(async () => ++count === 1 ? jsonResponse({ data: [{ url: 'https://assets.example.test/result.png' }] }) : response);
      await expect(f.runtime.execute(request('image', 'image-generation'))).rejects.toMatchObject({ requestStarted: true });
      expect(f.calls).toHaveLength(2); expect(f.writes).toHaveLength(0); expect(JSON.stringify(f.calls[1].init.headers)).not.toContain(FAKE_KEY);
    }
  });

  it('只有PNG签名的残缺图片不能标记生成成功', async () => {
    const f = fixture(async () => jsonResponse({ data: [{ b64_json: PNG.subarray(0, 8).toString('base64') }] }));
    await expect(f.runtime.execute(request('image', 'image-generation'))).rejects.toMatchObject({ code: 'INVALID_IMAGE', requestStarted: true });
    expect(f.writes).toHaveLength(0);
  });

  it('计入Gemini思考输出与Anthropic分列缓存输入，不把缺失用量当零', async () => {
    const gemini = fixture(async () => jsonResponse({ candidates: [{ content: { parts: [{ text: '结果' }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 20 } }));
    expect((await gemini.runtime.execute(request('gemini'))).usage).toMatchObject({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
    const claude = fixture(async () => jsonResponse({ content: [{ type: 'text', text: '结果' }], usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 } }));
    expect((await claude.runtime.execute(request('anthropic'))).usage).toMatchObject({ inputTokens: 60, outputTokens: 5 });
    const missing = fixture(async () => jsonResponse({ choices: [{ message: { content: '结果' } }] }));
    const usage = (await missing.runtime.execute(request())).usage;
    expect(usage.inputTokens).toBeUndefined(); expect(usage.outputTokens).toBeUndefined(); expect(usage.totalTokens).toBeUndefined();
  });

  it('语音合成保存接口返回的音频文件，文本转写使用 multipart 音频', async () => {
    const mp3 = Buffer.from('ID3fixture-test-audio');
    const f = fixture(async url => url.endsWith('/audio/speech') ? new Response(new Uint8Array(mp3), { headers: { 'content-type': 'audio/mpeg', 'x-request-id': 'speech-request' } }) : jsonResponse({ text: '转写结果', duration: 1.2 }));
    const speech = request('audio', 'speech'); speech.options = { voice: 'alloy' };
    const generated = await f.runtime.execute(speech);
    expect(generated.artifacts[0].mimeType).toBe('audio/mpeg'); expect(f.writes[0].buffer).toEqual(mp3);
    const file = metadata('audio-1', 'sample.mp3', 'audio/mpeg', mp3); f.files.set(file.id, file);
    const transcribe = request('audio', 'transcription'); transcribe.attachments = [file];
    const transcript = await f.runtime.execute(transcribe);
    expect(transcript.text).toBe('转写结果'); expect(transcript.usage.seconds).toBe(1.2); expect(f.writes[1]).toMatchObject({ mimeType: 'text/plain', text: '转写结果' });
    expect((f.calls[1].init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(f.calls[1].url.endsWith('/audio/transcriptions')).toBe(true);
  });

  it('不支持的视频、自定义协议与缺少编辑原图，在付费请求前阻止', async () => {
    const f = fixture(); const video = request('video', 'video-generation');
    expect(f.runtime.supports(video.connection, video.kind)).toBe(false);
    await expect(f.runtime.execute(video)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL', requestStarted: false });
    await expect(f.runtime.execute(request('custom'))).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL', requestStarted: false });
    await expect(f.runtime.execute(request('image', 'image-editing'))).rejects.toMatchObject({ code: 'MISSING_IMAGE', requestStarted: false });
    expect(f.calls).toHaveLength(0);
  });

  it('硅基流动视频只提交一次，查询完成后保存真实MP4并记录实际容器时长', async () => {
    const mp4 = mp4Fixture();
    const f = fixture(async url => url.endsWith('/video/submit') ? jsonResponse({ requestId: 'video-job-001' }) : url.endsWith('/video/status') ? jsonResponse({ status: 'Succeed', results: { videos: [{ url: 'https://assets.example.test/video.mp4' }], timings: { inference: 999 } } }, 200, { 'x-request-id': 'status-request-not-job-id' }) : new Response(new Uint8Array(mp4), { headers: { 'content-type': 'video/mp4' } }));
    const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.options = { size: '1280x720' };
    const events: object[] = [];
    const result = await f.runtime.execute(input, { onProgress: event => events.push(event) });
    expect(f.calls.filter(call => call.url.endsWith('/video/submit'))).toHaveLength(1);
    expect(JSON.parse(String(f.calls[0].init.body))).toMatchObject({ model: 'user-configured-model-id', image_size: '1280x720' });
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ requestId: 'video-job-001' });
    expect(result.providerRequestId).toBe('video-job-001'); expect(result.usage).toEqual({ providerRequestId: 'video-job-001', seconds: 2 });
    expect(events).toContainEqual(expect.objectContaining({ providerRequestId: 'video-job-001' }));
    expect(f.writes[0]).toMatchObject({ name: 'video.mp4', mimeType: 'video/mp4', buffer: mp4 });
    expect(result.artifacts[0].kind).toBe('video'); expect(f.calls[2].init.headers).not.toHaveProperty('authorization'); expect(JSON.stringify(f.calls[2].init.headers)).not.toContain(FAKE_KEY);
  });

  it('硅基流动图生视频提交本机参考图，排队仅查询状态，不重复付费提交', async () => {
    vi.useFakeTimers(); let polls = 0;
    const f = fixture(async url => url.endsWith('/video/submit') ? jsonResponse({ requestId: 'video-job-queued' }) : url.endsWith('/video/status') ? jsonResponse(++polls === 1 ? { status: 'InQueue' } : { status: 'Succeed', results: { videos: [{ url: 'https://assets.example.test/video.mp4' }] } }) : new Response(new Uint8Array(mp4Fixture())));
    const image = metadata('input-image', 'reference.png', 'image/png', PNG); f.files.set(image.id, image);
    const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.model.modelId = 'Wan-AI/Wan2.2-I2V-A14B'; input.options = { size: '960x960' }; input.attachments = [image];
    const promise = f.runtime.execute(input); await vi.advanceTimersByTimeAsync(5001); const result = await promise;
    expect(f.calls.filter(call => call.url.endsWith('/video/submit'))).toHaveLength(1); expect(polls).toBe(2);
    expect(JSON.parse(String(f.calls[0].init.body)).image).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(result.artifacts[0].mimeType).toBe('video/mp4');
  });

  it('已有硅基流动任务只恢复查询和下载，不需要原图且绝不再次submit', async () => {
    const f = fixture(async url => url.endsWith('/video/status') ? jsonResponse({ status: 'Succeed', results: { videos: [{ url: 'https://assets.example.test/resumed.mp4' }] } }) : new Response(new Uint8Array(mp4Fixture())));
    const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.model.modelId = 'Wan-AI/Wan2.2-I2V-A14B'; input.options = { existingTaskId: 'original-paid-video-job' };
    const result = await f.runtime.execute(input);
    expect(f.calls.filter(call => call.url.endsWith('/video/submit'))).toHaveLength(0);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ requestId: 'original-paid-video-job' });
    expect(result).toMatchObject({ resumedTask: true, providerRequestId: 'original-paid-video-job', usage: { providerRequestId: 'original-paid-video-job', seconds: 2 } });
    expect(result.artifacts[0].mimeType).toBe('video/mp4');
  });

  it('取消视频查询保留已经提交的任务编号，不能表示供应商已经免费取消', async () => {
    const controller = new AbortController();
    const f = fixture(async url => url.endsWith('/video/submit') ? jsonResponse({ requestId: 'video-job-cancelled' }) : jsonResponse({ status: 'InProgress' }));
    const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.options = {};
    const promise = f.runtime.execute(input, { signal: controller.signal, onProgress: event => { if (event.message.includes('生成中')) controller.abort(); } });
    await expect(promise).rejects.toMatchObject({ code: 'CANCELLED', requestStarted: true, providerRequestId: 'video-job-cancelled', usage: { providerRequestId: 'video-job-cancelled' } });
    expect(f.calls).toHaveLength(2); expect(f.writes).toHaveLength(0);
  });

  it('视频十分钟上限会停止轮询，已提交任务不重新生成', async () => {
    vi.useFakeTimers();
    const f = fixture(async url => jsonResponse(url.endsWith('/video/submit') ? { requestId: 'video-job-timeout' } : { status: 'InProgress' }));
    const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.options = {};
    const assertion = expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'TIMEOUT', requestStarted: true, providerRequestId: 'video-job-timeout' });
    await vi.advanceTimersByTimeAsync(600_001); await assertion;
    expect(f.calls.filter(call => call.url.endsWith('/video/submit'))).toHaveLength(1); expect(f.calls.length).toBeLessThanOrEqual(122); expect(f.writes).toHaveLength(0);
  });

  it('供应商视频失败、假MP4和过大下载都不会标成功，并保留可能计费的任务编号', async () => {
    for (const state of ['failed', 'not-mp4', 'too-large'] as const) {
      const f = fixture(async url => url.endsWith('/video/submit') ? jsonResponse({ requestId: `video-job-${state}` }) : url.endsWith('/video/status') ? jsonResponse(state === 'failed' ? { status: 'Failed', reason: FAKE_KEY } : { status: 'Succeed', results: { videos: [{ url: 'https://assets.example.test/output.mp4' }], timings: { inference: 999 } } }) : new Response(state === 'not-mp4' ? 'this is not a video' : new Uint8Array(mp4Fixture()), { headers: state === 'too-large' ? { 'content-length': String(101 * 1024 * 1024) } : {} }));
      const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.options = {};
      let error: unknown; try { await f.runtime.execute(input); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ requestStarted: true, providerRequestId: `video-job-${state}`, usage: { providerRequestId: `video-job-${state}` } });
      expect(String(error)).not.toContain(FAKE_KEY); expect(f.writes).toHaveLength(0); expect(f.calls.filter(call => call.url.endsWith('/video/submit'))).toHaveLength(1);
    }
  });

  it('视频尺寸、图生视频缺原图和已关闭的OpenAI Videos API在付费提交前阻止', async () => {
    const f = fixture(); const input = request('video', 'video-generation'); input.connection.providerId = 'siliconflow'; input.options = { size: '1024x1024' };
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_VIDEO_SIZE', requestStarted: false });
    input.options = {}; input.model.modelId = 'Wan-AI/Wan2.2-I2V-A14B';
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'MISSING_IMAGE', requestStarted: false });
    input.connection.providerId = 'openai'; expect(f.runtime.supports(input.connection, input.kind)).toBe(false);
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL', requestStarted: false }); expect(f.calls).toHaveLength(0);
  });

  it('Gemini原生视频理解发送本地MP4 inlineData，真实文字结果落入TXT', async () => {
    const f = fixture(async () => jsonResponse({ candidates: [{ content: { parts: [{ text: '视频中出现的场景说明' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } }));
    const video = metadata('video-1', 'sample.mp4', 'video/mp4', mp4Fixture()); f.files.set(video.id, video);
    const input = request('gemini', 'video-understanding'); input.attachments = [video];
    expect(f.runtime.supports(input.connection, input.kind)).toBe(true);
    const result = await f.runtime.execute(input); const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.contents[0].parts).toContainEqual({ inlineData: { mimeType: 'video/mp4', data: video.buffer.toString('base64') } });
    expect(result.text).toBe('视频中出现的场景说明'); expect(f.writes[0]).toMatchObject({ name: 'result.txt', mimeType: 'text/plain', text: '视频中出现的场景说明' });
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  });

  it('Gemini完整内联请求超过20MB或没有MP4时不发送收费请求，普通vision不偷偷理解视频', async () => {
    const f = fixture(); const video = metadata('large-video', 'large.mp4', 'video/mp4', mp4Fixture(2000, 16 * 1024 * 1024)); f.files.set(video.id, video);
    const input = request('gemini', 'video-understanding'); input.attachments = [video];
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'VIDEO_TOO_LARGE', requestStarted: false });
    input.attachments = []; await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'MISSING_VIDEO', requestStarted: false });
    const ordinaryVision = request('gemini', 'vision'); ordinaryVision.attachments = [video];
    await expect(f.runtime.execute(ordinaryVision)).rejects.toMatchObject({ code: 'VIDEO_REQUIRES_VIDEO_STEP', requestStarted: false });
    const unsupported = request('openai-chat', 'video-understanding'); expect(f.runtime.supports(unsupported.connection, unsupported.kind)).toBe(false); expect(f.calls).toHaveLength(0);
  });

  it('拒绝远程 HTTP 和地址内的认证参数，允许本机 HTTP 测试服务', async () => {
    const f = fixture(); const input = request(); input.connection.baseUrl = 'http://api.example.test/v1';
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_ENDPOINT', requestStarted: false });
    input.connection.baseUrl = 'https://api.example.test/v1?api_key=not-a-real-key';
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_ENDPOINT', requestStarted: false });
    expect(f.withSecret).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
    input.connection.baseUrl = 'http://127.0.0.1:9876/v1'; await f.runtime.execute(input); expect(f.calls[0].url).toBe('http://127.0.0.1:9876/v1/chat/completions');
  });

  it.each([400, 401, 403, 429, 500])('HTTP %i 不泄露供应商错误中的 Key，也不会自动重试', async status => {
    const f = fixture(async () => jsonResponse({ error: { message: `error with secret ${FAKE_KEY}` } }, status, { 'x-request-id': 'rejected-test-request' }));
    let error: unknown;
    try { await f.runtime.execute(request()); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'HTTP_ERROR', requestStarted: true, httpStatus: status, providerRequestId: 'rejected-test-request' });
    expect(String(error)).not.toContain(FAKE_KEY); expect(String(error).length).toBeLessThan(250); expect(f.calls).toHaveLength(1); expect(f.writes).toHaveLength(0);
  });

  it('重定向不会把认证 Header 发送给第二个地址', async () => {
    const f = fixture(async () => new Response('', { status: 302, headers: { location: 'https://other.example.test/collect' } }));
    await expect(f.runtime.execute(request())).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED', requestStarted: true, httpStatus: 302 });
    expect(f.calls).toHaveLength(1); expect(f.calls[0].init.redirect).toBe('manual');
  });

  it('取消已经发送的请求时保留 requestStarted，取消前不发请求', async () => {
    const fetcher: FetchMock = async (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    const f = fixture(fetcher); const controller = new AbortController();
    const assertion = expect(f.runtime.execute(request(), { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED', requestStarted: true });
    await vi.waitFor(() => expect(f.calls).toHaveLength(1)); controller.abort(); await assertion;
    const alreadyCancelled = new AbortController(); alreadyCancelled.abort();
    await expect(f.runtime.execute(request(), { signal: alreadyCancelled.signal })).rejects.toMatchObject({ code: 'CANCELLED', requestStarted: false });
    expect(f.calls).toHaveLength(1); expect(f.writes).toHaveLength(0);
  });

  it('超时会中止网络请求且不自动重试', async () => {
    vi.useFakeTimers();
    const f = fixture(async (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error(FAKE_KEY)), { once: true })));
    const assertion = expect(f.runtime.execute(request())).rejects.toMatchObject({ code: 'TIMEOUT', requestStarted: true });
    await vi.advanceTimersByTimeAsync(180_001); await assertion;
    expect(f.calls).toHaveLength(1); expect(f.writes).toHaveLength(0);
  });

  it('空内容、JSON伪音频与过大响应都不标记成功', async () => {
    const empty = fixture(async () => jsonResponse({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 9, completion_tokens: 1 } }));
    await expect(empty.runtime.execute(request())).rejects.toMatchObject({ code: 'EMPTY_OUTPUT', requestStarted: true, usage: { inputTokens: 9, outputTokens: 1 } });
    const wrongAudio = fixture(async () => jsonResponse({ error: FAKE_KEY }));
    await expect(wrongAudio.runtime.execute(request('audio', 'speech'))).rejects.toMatchObject({ code: 'INVALID_AUDIO', requestStarted: true });
    const large = fixture(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(129 * 1024 * 1024) } }));
    await expect(large.runtime.execute(request())).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', requestStarted: true });
    expect(empty.writes.length + wrongAudio.writes.length + large.writes.length).toBe(0);
  });

  it('输出被截断时抛出错误并保留用量，不能按完整成功继续', async () => {
    const f = fixture(async () => jsonResponse({ status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: '未完成' }] }], usage: { input_tokens: 8, output_tokens: 512, total_tokens: 520 } }));
    await expect(f.runtime.execute(request('openai-responses'))).rejects.toMatchObject({ code: 'INCOMPLETE_OUTPUT', requestStarted: true, usage: { inputTokens: 8, outputTokens: 512, totalTokens: 520 } });
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({ name: '未完成结果.txt', text: '未完成' });
  });

  it('异常及成功正文都不会向界面返回已保存的完整 Key', async () => {
    const badNetwork = fixture(async () => { throw new Error(`network ${FAKE_KEY}`); });
    await expect(badNetwork.runtime.execute(request())).rejects.not.toThrow(FAKE_KEY);
    const echoed = fixture(async () => jsonResponse({ choices: [{ message: { content: `result ${FAKE_KEY}` } }] }, 200, { 'x-request-id': FAKE_KEY }));
    const result = await echoed.runtime.execute(request());
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY); expect(echoed.writes[0].text).not.toContain(FAKE_KEY);
    const diskFailure = fixture(); diskFailure.artifactStore.write = async () => { throw new Error(FAKE_KEY); };
    await expect(createModelRuntime(diskFailure).execute(request())).rejects.toMatchObject({ code: 'EXECUTION_FAILED', requestStarted: true });
    expect(diskFailure.calls).toHaveLength(1);
  });
});
