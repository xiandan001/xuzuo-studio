import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { extractReferenceText } = require('../../electron/reference-text.cjs');
const owned = [];
const PDF = Buffer.from('%PDF-1.4\nBrand: Shanye Coffee; Budget: 1200\n%%EOF');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const metadata = [{ id: 'credential', connectionId: 'connection', name: 'Offline credential', enabled: true }];
const connection = (protocol = 'openai-responses') => ({ id: 'connection', name: 'Offline provider', providerId: protocol === 'anthropic' ? 'anthropic' : protocol === 'gemini' ? 'google' : 'openai', protocol, baseUrl: protocol === 'anthropic' ? 'https://api.anthropic.com' : protocol === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1', status: 'configured', enabled: true });
const model = (vision = true) => ({ id: 'model', name: 'Document fixture', modelId: 'fixture-document', connectionId: 'connection', enabled: true, capabilities: vision ? ['text', 'vision'] : ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '3' } });
const textOutput = JSON.stringify({ title: '山野咖啡合作说明', sections: [{ heading: '目标与预算', paragraphs: ['依据PDF资料：品牌为山野咖啡，预算为1200元；按用户资料安排执行，不补造经营数据。'] }] });
function reply(protocol, text = textOutput) {
  if (protocol === 'openai-chat') return { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 50 } };
  if (protocol === 'anthropic') return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 50 } };
  if (protocol === 'gemini') return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 } };
  return { status: 'completed', output_text: text, usage: { input_tokens: 200, output_tokens: 50 } };
}
function pdfFromBody(protocol, body) {
  const content = protocol === 'openai-responses' ? body.input[0].content : protocol === 'gemini' ? body.contents[0].parts : body.messages[0].content;
  if (protocol === 'openai-responses') return Buffer.from(content.find(part => part.type === 'input_file').file_data.split(',')[1], 'base64');
  if (protocol === 'openai-chat') return Buffer.from(content.find(part => part.type === 'file').file.file_data.split(',')[1], 'base64');
  if (protocol === 'anthropic') return Buffer.from(content.find(part => part.type === 'document').source.data, 'base64');
  return Buffer.from(content.find(part => part.inlineData?.mimeType === 'application/pdf').inlineData.data, 'base64');
}
async function fixture(protocol = 'openai-responses', fetchOverride) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-pdf-production-')); owned.push(directory);
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts') }); const pdf = await store.write({ projectId: 'project', name: '品牌需求.pdf', mimeType: 'application/pdf', buffer: PDF });
  const png = await store.write({ projectId: 'project', name: '商品原图.png', mimeType: 'image/png', buffer: PNG });
  const calls = [], credentials = { list: async () => metadata, withSecret: async (_id, _connection, callback) => callback('fixture-secret') };
  const runtime = createModelRuntime({ credentialStore: credentials, artifactStore: store, directory, fetchImpl: async (url, options) => { calls.push({ url, ...options }); return fetchOverride ? fetchOverride(url, options) : Response.json(reply(protocol)); } });
  const readReferenceText = vi.fn(file => extractReferenceText(file));
  const engine = createLiveWorkflowEngine({ directory, credentials, modelRuntime: runtime, artifactStore: store, readReferenceText });
  const project = { id: 'project', workspaceId: 'workspace', name: '山野咖啡资料制作', kind: 'word', status: 'draft', costCents: 0, version: 0, description: '', updatedAt: '', accent: 'blue' };
  const request = { project, workflow: { id: 'workflow', workspaceId: 'workspace', name: 'PDF完整制作', outputKind: 'word', description: '', updatedAt: '', steps: [{ id: 'producer', name: '依据PDF撰写完整文稿', kind: 'text', role: 'producer', inputSource: 'project', modelConfigId: 'model', credentialId: 'credential', prompt: '依据真实PDF资料制作完整合作说明，保留品牌和预算。', enabled: true, maxOutputTokens: 4096 }, { id: 'export', name: '导出Word', kind: 'export', inputSource: 'previous', prompt: '', enabled: true }] }, connections: [connection(protocol)], models: [model()], input: '为山野咖啡制作完整合作说明。', variables: {}, attachmentIds: [pdf.id], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
  return { directory, store, runtime, engine, request, pdf, png, calls, readReferenceText, credentials };
}
async function complete(engine) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const state = await engine.snapshot(); const run = state.runs[0]; if (run && run.status !== 'running') return state; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw Error('PDF production did not finish');
}
afterEach(async () => { for (const directory of owned.splice(0)) { expect(path.dirname(await fs.realpath(directory))).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-pdf-production-/); await fs.rm(directory, { recursive: true }); } });

describe('PDF作为真实生产资料（真实engine/FS/native请求，网络替身）', () => {
  it.each(['openai-responses', 'openai-chat', 'anthropic', 'gemini'])('%s：文字producer原生发送PDF真实字节并导出含正文的实际Word', async protocol => {
    const f = await fixture(protocol); try {
      const preflight = await f.engine.preflight(f.request); expect(preflight.ok, preflight.errors.join('\n')).toBe(true); expect(preflight.unknownCost).toBe(true); expect(f.readReferenceText).not.toHaveBeenCalled();
      await f.engine.start(f.request); const state = await complete(f.engine); expect(state.runs[0].status, state.runs[0].error).toBe('complete'); expect(f.calls).toHaveLength(1);
      expect(pdfFromBody(protocol, JSON.parse(f.calls[0].body))).toEqual(PDF); expect(f.readReferenceText).not.toHaveBeenCalled();
      const docx = state.runs[0].attempts.flatMap(attempt => attempt.artifacts || []).find(file => file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); expect(docx).toBeTruthy();
      const content = await extractReferenceText(await f.store.read(docx.id)); expect(content).toContain('山野咖啡'); expect(content).toContain('1200'); expect(state.ledger).toHaveLength(1); expect(state.ledger[0].costState).toBe('calculated');
    } finally { await f.engine.shutdown(); await f.store.drain(); }
  });
  it.each(['word', 'ppt', 'excel'])('%s：无vision的文字模型和未适配兼容协议在首个模型调用前拒绝PDF', async kind => {
    const f = await fixture(); try {
      f.request.project.kind = kind; f.request.workflow.outputKind = kind; f.request.models = [model(false)];
      const preflight = await f.engine.preflight(f.request); expect(preflight.ok).toBe(false); expect(preflight.errors.join('\n')).toContain('支持看图和PDF'); await expect(f.engine.start(f.request)).rejects.toThrow(); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toHaveLength(0);
      f.request.models = [model(true)]; f.request.connections = [{ ...connection('openai-chat'), providerId: 'qwen' }]; expect((await f.engine.preflight(f.request)).errors.join('\n')).toContain('兼容聊天接口尚未适配PDF'); expect(f.calls).toHaveLength(0);
    } finally { await f.engine.shutdown(); await f.store.drain(); }
  });
  it('PDF读资料planner提供真实brief，图片精修只发PNG原图而不把PDF混成图片参考', async () => {
    const f = await fixture('openai-responses', async (url, options) => url.includes('/images/') ? Response.json({ data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { text_tokens: 50, image_tokens: 50 }, output_tokens_details: { image_tokens: 50 } } }) : Response.json(reply('openai-responses', '从PDF读到：山野咖啡，预算1200元。保持PNG商品原貌，制作自然清新的海报。')));
    try {
      f.request.project.kind = 'image'; f.request.workflow.outputKind = 'image'; f.request.attachmentIds = [f.pdf.id, f.png.id];
      f.request.connections.push({ ...connection(), id: 'image-connection', protocol: 'image' }); f.request.models.push({ ...model(), id: 'image-model', connectionId: 'image-connection', modelId: 'gpt-image-2.6', capabilities: ['image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '0.1' } });
      f.credentials.list = async () => [...metadata, { ...metadata[0], id: 'image-credential', connectionId: 'image-connection' }];
      f.request.workflow.steps = [{ ...f.request.workflow.steps[0], id: 'planner', role: 'planner', name: '解读PDF与整理制作brief' }, { id: 'image', name: '精修真实商品原图', kind: 'image-editing', inputSource: 'previous', modelConfigId: 'image-model', credentialId: 'image-credential', prompt: '依据上一步真实资料精修原图，保留商品细节。', enabled: true, count: 1 }];
      const preflight = await f.engine.preflight(f.request); expect(preflight.ok, preflight.errors.join('\n')).toBe(true); await f.engine.start(f.request); const state = await complete(f.engine); expect(state.runs[0].status, state.runs[0].error).toBe('complete'); expect(f.calls).toHaveLength(2);
      expect(pdfFromBody('openai-responses', JSON.parse(f.calls[0].body))).toEqual(PDF);
      const form = f.calls[1].body, images = [...form.entries()].filter(([, value]) => typeof value !== 'string'); expect(images).toHaveLength(1); expect(images[0][1].type).toBe('image/png'); expect(Buffer.from(await images[0][1].arrayBuffer())).toEqual(PNG);
      expect(form.get('prompt')).toContain('山野咖啡，预算1200元'); expect([...form.values()].some(value => typeof value !== 'string' && value.type === 'application/pdf')).toBe(false); expect(state.ledger).toHaveLength(2);
    } finally { await f.engine.shutdown(); await f.store.drain(); }
  });
  it('只有图片步骤没有PDF解读时提前阻断，不能用忽略PDF代替支持资料', async () => {
    const f = await fixture(); try {
      f.request.project.kind = 'image'; f.request.workflow.outputKind = 'image'; f.request.connections = [{ ...connection(), protocol: 'image' }]; f.request.models = [{ ...model(), modelId: 'gpt-image-2.6', capabilities: ['image-generation'] }];
      f.request.workflow.steps = [{ id: 'image', name: '直接生成', kind: 'image-generation', inputSource: 'project', modelConfigId: 'model', credentialId: 'credential', prompt: '制作宣传图', enabled: true }];
      const preflight = await f.engine.preflight(f.request); expect(preflight.errors.join('\n')).toContain('PDF不能直接作为绘图参考'); expect(f.calls).toHaveLength(0);
    } finally { await f.engine.shutdown(); await f.store.drain(); }
  });
});
