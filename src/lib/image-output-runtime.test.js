import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { PNG: PngCodec } = require('pngjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { imageOptionsError } = require('../../electron/image-output-options.cjs');
const { imageType } = require('../../electron/provider-media.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aq3sAAAAASUVORK5CYII=', 'base64');
const MARKUP = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DQAAAEgQGALFXOsAAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="red" d="M0 0h16v16H0z"/></svg>');
const GIF = Buffer.from('47494638396101000100800000000000ffffff21f90401020000002c000000000100010000020244010021f90401020000002c00000000010001000002024401003b', 'hex');
const usage = { input_tokens: 30, output_tokens: 196, total_tokens: 226 };
function request(kind = 'image-generation', options = {}) {
  return { requestId: 'request-1', runId: 'run-1', projectId: 'project-1', credentialId: 'fixture-key-id', kind, connection: { id: 'connection', providerId: 'openai', protocol: 'openai-responses', enabled: true, baseUrl: 'https://fixture.example/v1' }, model: { id: 'model', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', enabled: true, capabilities: [kind] }, prompt: '隔离测试描述', input: '', attachments: [], options: { count: 1, ...options } };
}
function fixture(bytes = PNG, extra = {}, normalizeRasterReference) {
  const calls = [], writes = [], files = new Map();
  const withSecret = vi.fn(async (_id, _connection, action) => action('fixture-only-secret'));
  const read = vi.fn(async id => { if (!files.has(id)) throw new Error('fixture missing artifact'); return files.get(id); });
  const runtime = createModelRuntime({ credentialStore: { withSecret }, artifactStore: { read, write: async value => { writes.push(value); return { ...value, id: `output-${writes.length}`, bytes: value.buffer.length }; } }, normalizeRasterReference, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }], usage, ...extra }), { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-image-request' } }); } });
  const add = (id, changes = {}) => { const file = { id, projectId: 'project-1', name: `${id}.png`, mimeType: 'image/png', buffer: PNG, ...changes }; files.set(id, file); return file; };
  return { runtime, calls, writes, files, add, withSecret, read };
}

describe('Image output advanced options admission', () => {
  it.each([
    ['gpt-image-2.5-flare', 'image-generation', { outputFormat: 'svg' }],
    ['gpt-image-2.6', 'image-generation', { outputFormat: 'gif' }],
    ['gpt-image-2.6-flare-future', 'image-generation', { outputFormat: 'svg' }],
    ['gpt-image-2.6-flare', 'image-editing', { outputFormat: 'svg' }],
    ['gpt-image-2.5-flare', 'image-editing', { outputFormat: 'gif' }],
    ['gpt-image-2.6-sunburst', 'image-generation', { outputFormat: 'svg', count: 2 }],
    ['gpt-image-2.5-sunburst', 'image-generation', { complexity: 'low' }],
    ['custom-image', 'image-generation', { quality: 'max' }],
    ['gpt-image-2.6-flare', 'image-generation', { complexity: 'auto' }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'gif', frameCount: 1 }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'gif', frameCount: 17 }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'gif', frameDurationMs: 205 }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'gif', frameDurationMs: 2010 }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'gif', size: '1024x1024' }],
    ['gpt-image-2.6-flare', 'image-generation', { frameCount: 9 }],
    ['gpt-image-2.6-flare', 'image-generation', { outputCompression: 90 }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'webp', outputCompression: 101 }],
    ['gpt-image-2.6-flare', 'image-generation', { svgModel: 'gpt-6.1-sol' }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'svg', svgReasoningEffort: 'high' }],
    ['gpt-image-2.6-flare', 'image-generation', { markupArtifactId: 'markup' }],
    ['gpt-image-2.6-flare', 'image-generation', { outputFormat: 'jpeg', background: 'transparent' }],
    ['gpt-6.1-sol', 'text', { outputFormat: 'svg' }],
  ])('rejects incompatible model/operation/options before credentials or network: %s %s %j', async (modelId, kind, options) => {
    expect(imageOptionsError(modelId, kind, options)).toBeTypeOf('string');
    const f = fixture(), input = request(kind, options); input.model.modelId = modelId;
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_OPTIONS', requestStarted: false });
    expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled();
  });
});

describe('Image API advanced request and exact bytes', () => {
  it('keeps default PNG body unchanged and reuses the Images endpoint on an existing Responses connection', async () => {
    const f = fixture(); await f.runtime.execute(request());
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ model: 'gpt-image-2.6-sunburst', prompt: '隔离测试描述', n: 1, output_format: 'png' });
    expect(f.calls[0].url).toBe('https://fixture.example/v1/images/generations');
    expect(imageType(PNG)).toMatchObject({ mimeType: 'image/png', extension: 'png' });
  });
  it('sends quality, complexity and WebP compression as separate real API fields', async () => {
    const f = fixture(WEBP); const result = await f.runtime.execute(request('image-generation', { outputFormat: 'webp', quality: 'xhigh', complexity: 'low', outputCompression: 75 }));
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({ output_format: 'webp', quality: 'xhigh', complexity: 'low', output_compression: 75 });
    expect(result.usage.imageOutputFormat).toBe('webp'); expect(f.writes[0]).toMatchObject({ name: 'image-1.webp', mimeType: 'image/webp' }); expect(f.writes[0].buffer).toEqual(WEBP);
  });
  it('saves raw static SVG, preserves both usages, and omits optional author configuration by default', async () => {
    const f = fixture(SVG, { svg_usage: { model: 'gpt-6.1-sol', input_tokens: 100, output_tokens: 200, reasoning_tokens: 150, total_tokens: 300 } });
    const result = await f.runtime.execute(request('image-generation', { outputFormat: 'svg', complexity: 'high' }));
    const body = JSON.parse(f.calls[0].init.body); expect(body.svg).toBeUndefined();
    expect(result.usage).toMatchObject({ imageOutputFormat: 'svg', inputTokens: 30, outputTokens: 196, svgUsage: { model: 'gpt-6.1-sol', inputTokens: 100, outputTokens: 200, reasoningTokens: 150 } });
    expect(f.writes[0]).toMatchObject({ name: 'image-1.svg', mimeType: 'image/svg+xml' }); expect(f.writes[0].buffer).toEqual(SVG);
  });
  it('sends an explicit SVG author and its reasoning only in the nested SVG object', async () => {
    const f = fixture(SVG); await f.runtime.execute(request('image-generation', { outputFormat: 'svg', complexity: 'low', svgModel: 'gpt-6.1-sol', svgReasoningEffort: 'high' }));
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({ complexity: 'low', svg: { model: 'gpt-6.1-sol', reasoning: { effort: 'high' } } });
  });
  it('preserves actual animated GIF bytes and counts one animation rather than multiplying fees by frames', async () => {
    const f = fixture(GIF); const result = await f.runtime.execute(request('image-generation', { outputFormat: 'gif', frameCount: 2, frameDurationMs: 200 }));
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({ output_format: 'gif', frame_count: 2, frame_duration_ms: 200, size: 'auto' });
    expect(result.usage).toMatchObject({ imageOutputFormat: 'gif', images: 1, outputTokens: 196 });
    expect(f.writes[0]).toMatchObject({ name: 'image-1.gif', mimeType: 'image/gif' }); expect(f.writes[0].buffer).toEqual(GIF);
  });
  it.each(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'])('edits static references into a real stored GIF through multipart without stream, partial images or mask: %s', async modelId => {
    const temporary = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporary, 'xuzuo-gif-edit-protocol-'));
    const store = createArtifactStore({ directory });
    const animation = Buffer.from(GIF.toString('hex').replaceAll('21f9040102000000', '21f9040114000000'), 'hex');
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://fixture.example/v1/images/edits');
      expect(init.body).toBeInstanceOf(FormData);
      const body = init.body;
      expect(body.get('model')).toBe(modelId); expect(body.get('output_format')).toBe('gif');
      expect(body.get('frame_count')).toBe('2'); expect(body.get('frame_duration_ms')).toBe('200'); expect(body.get('size')).toBe('auto'); expect(body.get('n')).toBe('1');
      for (const name of ['stream', 'partial_images', 'mask', 'output_compression']) expect(body.has(name)).toBe(false);
      const references = body.getAll('image[]');
      expect(references.map(file => [file.name, file.type])).toEqual([['source.png', 'image/png'], ['detail.webp', 'image/webp']]);
      expect(Buffer.from(await references[0].arrayBuffer())).toEqual(PNG); expect(Buffer.from(await references[1].arrayBuffer())).toEqual(WEBP);
      return new Response(JSON.stringify({ data: [{ b64_json: animation.toString('base64') }], usage }), { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-gif-edit' } });
    });
    try {
      const source = await store.write({ projectId: 'project-1', name: 'source.png', mimeType: 'image/png', buffer: PNG, preserveOriginalName: true });
      const detail = await store.write({ projectId: 'project-1', name: 'detail.webp', mimeType: 'image/webp', buffer: WEBP, preserveOriginalName: true });
      const withSecret = vi.fn(async (_id, _connection, action) => action('fixture-only-secret'));
      const runtime = createModelRuntime({ artifactStore: store, credentialStore: { withSecret }, fetchImpl });
      const input = request('image-editing', { outputFormat: 'gif', frameCount: 2, frameDurationMs: 200, size: 'auto' });
      input.model.modelId = modelId; input.attachments = [source, detail];
      const result = await runtime.execute(input), saved = result.artifacts[0];
      expect(fetchImpl).toHaveBeenCalledTimes(1); expect(result.providerRequestId).toBe('fixture-gif-edit');
      expect(result.usage).toMatchObject({ images: 1, imageOutputFormat: 'gif', inputTokens: 30, outputTokens: 196 });
      expect(saved.mimeType).toBe('image/gif'); expect(saved.name).toMatch(/\.gif$/); expect(imageType((await store.read(saved.id)).buffer)).toMatchObject({ mimeType: 'image/gif', frames: 2 });
      expect(await fs.readFile(saved.path)).toEqual(animation); expect((await store.read(source.id)).buffer).toEqual(PNG); expect((await store.read(detail.id)).buffer).toEqual(WEBP);
    } finally {
      await store.drain();
      expect(path.dirname(directory)).toBe(temporary); expect(path.basename(directory)).toMatch(/^xuzuo-gif-edit-protocol-/); expect((await fs.lstat(directory)).isSymbolicLink()).toBe(false);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('keeps an optimized animation with a clear actual-frame warning and no automatic paid retry', async () => {
    const f = fixture(GIF); const result = await f.runtime.execute(request('image-generation', { outputFormat: 'gif', frameCount: 9 }));
    expect(result.text).toContain('请求9帧，返回2帧'); expect(result.text).toContain('未自动重发');
    expect(f.calls).toHaveLength(1); expect(f.writes[0].buffer).toEqual(GIF);
  });
  it('rejects mismatched or unsafe output while retaining the paid receipt without retry', async () => {
    for (const bytes of [PNG, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]) {
      const f = fixture(bytes);
      await expect(f.runtime.execute(request('image-generation', { outputFormat: 'svg' }))).rejects.toMatchObject({ requestStarted: true, usage: { imageOutputFormat: 'svg', inputTokens: 30, outputTokens: 196 } });
      expect(f.calls).toHaveLength(1); expect(f.writes).toHaveLength(0);
    }
  });
});

describe('Markup-guided image editing', () => {
  it.each(['gpt-image-2.5-flare', 'gpt-image-2.6-sunburst'])('uploads separate PNG markup and the same original references on repeated edits: %s', async modelId => {
    const f = fixture(), source = f.add('source'), second = f.add('reference'), markup = f.add('markup', { buffer: MARKUP });
    const input = request('image-editing', { markupArtifactId: markup.id, quality: 'medium' }); input.model.modelId = modelId; input.attachments = [source, markup, second];
    await f.runtime.execute(input); await f.runtime.execute(input);
    expect(f.calls).toHaveLength(2);
    for (const call of f.calls) {
      expect(call.url).toBe('https://fixture.example/v1/images/edits');
      const body = call.init.body; expect(body).toBeInstanceOf(FormData); expect(body.getAll('image[]').map(file => file.name)).toEqual(['source.png', 'reference.png']);
      expect(Buffer.from(await body.get('markup').arrayBuffer())).toEqual(MARKUP);
      expect(Buffer.from(await body.getAll('image[]')[0].arrayBuffer())).toEqual(PNG);
      expect(body.get('quality')).toBe('medium'); expect(body.get('mask')).toBeNull();
    }
  });
  it('rejects foreign, missing, opaque, oversized or mismatched markup before credentials/network', async () => {
    for (const mode of ['foreign-source', 'foreign-markup', 'missing-markup', 'opaque-markup', 'opaque-rgba-markup', 'oversized-markup', 'mismatched-markup']) {
      const f = fixture(), source = f.add('source'), markup = f.add('markup', { buffer: MARKUP });
      if (mode === 'foreign-source') source.projectId = 'other-project';
      if (mode === 'foreign-markup') markup.projectId = 'other-project';
      if (mode === 'missing-markup') f.files.delete(markup.id);
      if (mode === 'opaque-markup') markup.buffer = PNG;
      if (mode === 'opaque-rgba-markup') markup.buffer = PngCodec.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) });
      if (mode === 'oversized-markup') markup.buffer = Buffer.alloc(32 * 1024 * 1024 + 1);
      if (mode === 'mismatched-markup') { markup.buffer = Buffer.from(PNG); markup.buffer.writeUInt32BE(2, 16); }
      const input = request('image-editing', { markupArtifactId: markup.id }); input.attachments = [source];
      await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_MARKUP', requestStarted: false });
      expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled();
    }
  });
  it.each(['image/gif', 'image/svg+xml'])('blocks %s as an ordinary edit input before credentials/network', async mimeType => {
    const f = fixture(), image = f.add('source', { mimeType, buffer: mimeType === 'image/gif' ? GIF : SVG });
    const input = request('image-editing'); input.attachments = [image];
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_IMAGE_INPUT', requestStarted: false });
    expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled();
  });
  it('does not treat SVG or GIF bytes as a raster source because metadata says PNG', async () => {
    for (const bytes of [SVG, GIF]) {
      const f = fixture(), source = f.add('source', { buffer: bytes });
      const input = request('image-editing'); input.attachments = [source];
      await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_IMAGE_INPUT', requestStarted: false });
      expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled();
    }
  });
});

describe('Local preparation of mislabelled raster references', () => {
  // Synthetic JPEG; complete native decoding is separately exercised by verify-image-reference-normalization.cjs.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgAtOz/2Q==', 'base64');
  const original = Buffer.concat([jpeg, Buffer.alloc(24, 65)]);
  const prepared = PngCodec.sync.write({ width: 1, height: 1, data: Buffer.from([0, 128, 255, 255]) });
  it('prepares JPEG plus 24 trailing bytes registered as PNG before credentials and sends only the canonical PNG, preserving original bytes/metadata', async () => {
    const normalize = vi.fn(async () => ({ buffer: prepared, mimeType: 'image/png', width: 1, height: 1 }));
    const f = fixture(PNG, {}, normalize), source = f.add('wrong-extension', { name: '错误扩展名.jpg', mimeType: 'image/png', buffer: Buffer.from(original) });
    const before = { ...source, buffer: Buffer.from(source.buffer) }, input = request('image-editing'), onProgress = vi.fn(); input.attachments = [source];
    await f.runtime.execute(input, { onProgress });
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ buffer: original, mimeType: 'image/png' });
    expect(normalize.mock.invocationCallOrder[0]).toBeLessThan(f.withSecret.mock.invocationCallOrder[0]);
    const image = f.calls[0].init.body.getAll('image[]')[0];
    expect(f.calls).toHaveLength(1); expect(f.calls[0].url).toBe('https://fixture.example/v1/images/edits'); expect(image.name).toBe('错误扩展名.png'); expect(image.type).toBe('image/png'); expect(Buffer.from(await image.arrayBuffer())).toEqual(prepared);
    expect(f.files.get(source.id)).toEqual(before); expect(onProgress.mock.calls.some(([event]) => event.phase === 'preparing' && event.message.includes('本地免费') && event.message.includes('不调用模型'))).toBe(true);
  });
  it('keeps already-correct PNG/JPEG/WebP on the direct path without local re-encoding', async () => {
    for (const [mimeType, buffer] of [['image/png', PNG], ['image/jpeg', jpeg], ['image/webp', WEBP]]) {
      const normalize = vi.fn(), f = fixture(PNG, {}, normalize), source = f.add('correct', { mimeType, buffer });
      const input = request('image-editing'); input.attachments = [source]; await f.runtime.execute(input);
      expect(normalize).not.toHaveBeenCalled(); expect(Buffer.from(await f.calls[0].init.body.getAll('image[]')[0].arrayBuffer())).toEqual(buffer);
    }
  });
  it('reports a named reference failure rather than supplier output when the local decoder cannot repair it, without credentials or HTTP', async () => {
    const normalize = vi.fn(async () => { throw Object.assign(Error('参考图无法完整解码。'), { code: 'INVALID_IMAGE_INPUT' }); });
    const f = fixture(PNG, {}, normalize), source = f.add('bad', { name: '有问题的参考.png', buffer: original });
    const input = request('image-editing'); input.attachments = [source];
    await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_IMAGE_INPUT', requestStarted: false, message: expect.stringContaining('参考图“有问题的参考.png”') });
    expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled(); expect(source.buffer).toEqual(original);
  });
  it('does not pass actual GIF or SVG through the raster normalizer merely because metadata says PNG', async () => {
    for (const buffer of [GIF, SVG]) {
      const normalize = vi.fn(), f = fixture(PNG, {}, normalize), source = f.add('not-raster', { buffer });
      const input = request('image-editing'); input.attachments = [source];
      await expect(f.runtime.execute(input)).rejects.toMatchObject({ code: 'INVALID_IMAGE_INPUT', requestStarted: false });
      expect(normalize).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled();
    }
  });
  it('cancelling pending local preparation sends no request and preserves the source', async () => {
    let resolve, enter;
    const entered = new Promise(done => { enter = done; });
    const normalize = vi.fn(() => { enter(); return new Promise(done => { resolve = done; }); });
    const f = fixture(PNG, {}, normalize), source = f.add('pending', { buffer: original }), controller = new AbortController();
    const input = request('image-editing'); input.attachments = [source];
    const execution = f.runtime.execute(input, { signal: controller.signal }); await entered; controller.abort(); resolve({ buffer: prepared, mimeType: 'image/png', width: 1, height: 1 });
    await expect(execution).rejects.toMatchObject({ code: 'CANCELLED', requestStarted: false }); expect(f.calls).toHaveLength(0); expect(f.withSecret).not.toHaveBeenCalled(); expect(source.buffer).toEqual(original);
  });
});
