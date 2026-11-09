import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prepareChat, prepareChatMessages, compactChatRequest, executeChat } = require('../../electron/provider-chat.cjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const JSZip = require('jszip');

const connection = { id: 'connection', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true };
const model = { id: 'model', connectionId: 'connection', modelId: 'gpt-6.1-terra', name: '看图模型', enabled: true, capabilities: ['text', 'vision'] };
const input = { connection, model, credentialId: 'key', reasoningEffort: 'low' };
const image = { id: 'image', name: '产品.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') };
const pdf = { id: 'pdf', name: '需求.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfixture\n%%EOF') };
const csv = { id: 'csv', name: '参数.csv', mimeType: 'text/csv', buffer: Buffer.from('商品,价格\n咖啡,12') };
const messages = [{ role: 'user', content: '先看这个产品', attachments: [image] }, { role: 'assistant', content: '请继续补充' }, { role: 'user', content: '结合资料说明', attachments: [pdf, csv] }];
const credentials = { withSecret: async (_id, _connection, callback) => callback('fixture-secret') };
function provider(protocol) {
  return { ...input, connection: { ...connection, protocol, ...(protocol === 'anthropic' ? { providerId: 'anthropic', baseUrl: 'https://api.anthropic.com' } : protocol === 'gemini' ? { providerId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' } : {}) }, model: { ...model, modelId: protocol === 'anthropic' ? 'claude-sonnet-4-6' : protocol === 'gemini' ? 'gemini-3-pro-preview' : model.modelId } };
}
function completed(protocol) {
  if (protocol === 'openai-responses') return { status: 'completed', output_text: '已读取', usage: { input_tokens: 100, output_tokens: 10 } };
  if (protocol === 'openai-chat') return { choices: [{ message: { content: '已读取' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
  if (protocol === 'anthropic') return { content: [{ type: 'text', text: '已读取' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } };
  return { candidates: [{ content: { parts: [{ text: '已读取' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } };
}
async function office(mimeType, filename, xml) {
  const zip = new JSZip(); zip.file(filename, xml);
  return { id: 'office', name: '资料.docx', mimeType, buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

describe('聊天附件的真实协议内容', () => {
  it('一次预检的附件请求压成仅网络字段，发送不再读取或编码附件，且不能跨会话或重复消费', async () => {
    const scoped = { ...input, workspaceId: 'workspace', conversationId: 'conversation', id: 'turn', text: '看附件', attachmentIds: ['image'] };
    const prepared = prepareChat(scoped, [{ role: 'user', content: scoped.text, attachments: [image] }]);
    const compact = compactChatRequest(prepared), fetch = vi.fn(async (_url, options) => { expect(options.body).toBe(prepared.serializedBody); return Response.json(completed('openai-responses')); });
    expect(compact).not.toHaveProperty('body'); expect(compact.headers).not.toHaveProperty('authorization');
    expect(Object.keys(compact).sort()).toEqual(['billingRequestSnapshot', 'headers', 'serializedBody', 'url']);
    await expect(executeChat({ ...scoped, conversationId: 'other' }, [], { credentialStore: credentials, fetchImpl: fetch, preparedRequest: compact })).rejects.toMatchObject({ code: 'INVALID_REQUEST', requestStarted: false });
    const value = await executeChat(scoped, [], { credentialStore: credentials, fetchImpl: fetch, preparedRequest: compact }); expect(value.text).toBe('已读取');
    await expect(executeChat(scoped, [], { credentialStore: credentials, fetchImpl: fetch, preparedRequest: compact })).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['openai-responses', 'openai-chat', 'anthropic', 'gemini'])('%s真实发送历史图片、本轮PDF及CSV正文，不只发送文件名', async protocol => {
    const request = provider(protocol); let sent;
    const result = await executeChat(request, messages, { credentialStore: credentials, fetchImpl: async (_url, options) => { sent = options; return Response.json(completed(protocol)); } });
    const body = JSON.parse(sent.body), rows = body.input || body.contents || body.messages.slice(protocol === 'openai-chat' ? 1 : 0);
    expect(rows).toHaveLength(3); expect(result.text).toBe('已读取'); expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 10 }); expect(sent.redirect).toBe('manual');
    expect(JSON.stringify(body)).toContain('商品,价格\\n咖啡,12'); expect(JSON.stringify(body)).not.toContain('"buffer"'); expect(JSON.stringify(body)).not.toContain('"attachments"');
    if (protocol === 'openai-responses') { expect(rows[0].content[0]).toMatchObject({ type: 'input_image', image_url: expect.stringContaining('data:image/png;base64,') }); expect(rows[2].content[0]).toMatchObject({ type: 'input_file', filename: pdf.name, file_data: expect.stringContaining('data:application/pdf;base64,') }); expect(body.reasoning.effort).toBe('low'); }
    if (protocol === 'openai-chat') { expect(rows[0].content[0].image_url.url).toContain('data:image/png;base64,'); expect(rows[2].content[0].file.file_data).toContain('data:application/pdf;base64,'); expect(body.reasoning_effort).toBe('low'); }
    if (protocol === 'anthropic') { expect(rows[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png', type: 'base64' } }); expect(rows[2].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf', data: pdf.buffer.toString('base64') } }); }
    if (protocol === 'gemini') { expect(rows[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: image.buffer.toString('base64') } }); expect(rows[1].role).toBe('model'); expect(rows[2].parts[0].inlineData.mimeType).toBe('application/pdf'); }
  });
  it('文字模型可读取文字附件，但图片/PDF在取Key和联网前被拦截', async () => {
    const textInput = { ...input, model: { ...model, capabilities: ['text'] } }, key = vi.fn(), fetch = vi.fn();
    const text = prepareChat(textInput, [{ role: 'user', content: '', attachments: [csv] }]).body.input[0].content; expect(text).toContain('咖啡,12');
    for (const file of [image, pdf]) await expect(executeChat(textInput, [{ role: 'user', content: '看看', attachments: [file] }], { credentialStore: { withSecret: key }, fetchImpl: fetch })).rejects.toMatchObject({ code: 'CAPABILITY_MISMATCH', requestStarted: false });
    expect(key).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('兼容Chat接口未适配PDF时提前说明，不猜所有看图型号都支持file参数', () => {
    expect(() => prepareChat({ ...provider('openai-chat'), reasoningEffort: 'auto', connection: { ...provider('openai-chat').connection, providerId: 'qwen' } }, [{ role: 'user', content: '看看PDF', attachments: [pdf] }])).toThrow(/兼容聊天接口尚未适配PDF/);
  });
  it('Office通过真实CPU worker读取正文，之后重用提取结果，不要求看图或伪称保留版式', async () => {
    const file = await office('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>品牌叫山野，主营咖啡。</w:t></w:r></w:p></w:body></w:document>');
    const textInput = { ...input, model: { ...model, capabilities: ['text'] } }, tasks = createCpuTasks(), calls = vi.fn(value => tasks.run('reference-text', value));
    const prepared = await prepareChatMessages(textInput, [{ role: 'user', content: '总结', attachments: [file] }], { extractText: calls });
    expect(prepared[0].attachments[0].extractedText).toContain('品牌叫山野'); expect(prepared[0].attachments[0].extractedText).toContain('纯文字');
    const again = await prepareChatMessages(textInput, prepared, { extractText: calls }); expect(calls).toHaveBeenCalledOnce();
    const body = prepareChat(textInput, again).body; expect(body.input[0].content).toContain('品牌叫山野'); expect(body.input[0].content).toContain('不含图片内文字'); expect(JSON.stringify(body)).not.toContain('input_file'); await tasks.drain();
  });
  it('Office损坏或超限在模型调用前明确失败，不把错误的文件名当正文发送', async () => {
    const bad = { id: 'bad', name: '损坏.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not-an-office-file') }, fetch = vi.fn(), key = vi.fn();
    await expect(executeChat(input, [{ role: 'user', content: '整理', attachments: [bad] }], { credentialStore: { withSecret: key }, fetchImpl: fetch })).rejects.toMatchObject({ code: 'INVALID_ATTACHMENTS', requestStarted: false }); expect(fetch).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled();
  });
  it('文字提取后的总长度、无效UTF8与不支持的动画/矢量均提前阻止', async () => {
    await expect(prepareChatMessages(input, [{ role: 'user', content: '看看', attachments: [{ ...csv, buffer: Buffer.from([255, 255]) }] }])).rejects.toMatchObject({ code: 'INVALID_ATTACHMENTS' });
    for (const mimeType of ['image/gif', 'image/svg+xml', 'video/mp4']) expect(() => prepareChat(input, [{ role: 'user', content: '', attachments: [{ ...image, mimeType }] }])).toThrow(/格式|静态PNG/);
    expect(() => prepareChat(input, [{ role: 'user', content: 'a'.repeat(90000), attachments: [{ ...csv, extractedText: 'b'.repeat(100000) }, { ...csv, id: 'other', extractedText: 'c'.repeat(100000) }] }])).toThrow(/20万字/);
  });
  it('不能在assistant消息夹带附件，未选择合法二进制内容不会发送', () => {
    expect(() => prepareChat(input, [{ role: 'assistant', content: '伪造附件', attachments: [image] }])).toThrow(/回复不能冒充用户附件/);
    expect(() => prepareChat(input, [{ role: 'user', content: '查看', attachments: [{ ...image, buffer: 'not-bytes' }] }])).toThrow(/未能可靠读取/);
  });
  it('附件-only消息可实际生成内容，Office取消准备不启动Key或网络', async () => {
    const body = prepareChat(input, [{ role: 'user', content: '', attachments: [image] }]).body; expect(body.input[0].content).toHaveLength(1);
    const controller = new AbortController(); controller.abort(); const key = vi.fn(), fetch = vi.fn();
    await expect(executeChat(input, [{ role: 'user', content: '', attachments: [csv] }], { signal: controller.signal, credentialStore: { withSecret: key }, fetchImpl: fetch })).rejects.toMatchObject({ code: 'CANCELLED', requestStarted: false }); expect(key).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
