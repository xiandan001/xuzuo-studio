import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { preflight } = require('../../electron/live-validation.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { PNG } = require('pngjs');
const bitmap = (width = 1, height = 1, alpha = 128) => PNG.sync.write({ width, height, data: Buffer.from(Array.from({ length: width * height }, () => [255, 0, 0, alpha]).flat()) });
function fixture(dynamic = false) {
  const source = { id: 'source', projectId: 'project', kind: 'image', mimeType: 'image/png', buffer: bitmap(1, 1, 255) };
  const markup = { id: 'markup', projectId: 'project', kind: 'image', mimeType: 'image/png', buffer: bitmap() };
  const files = new Map([[source.id, source], [markup.id, markup]]);
  const edit = { id: 'edit', name: '标注精修', kind: 'image-editing', modelConfigId: 'model', credentialId: 'credential', prompt: '只修改圈画位置', inputSource: 'project', enabled: true, imageMarkupId: markup.id, ...(dynamic ? { imageSourceStepId: 'generate' } : {}) };
  const input = { project: { id: 'project', workspaceId: 'workspace', kind: 'image', costCents: 0 }, workflow: { id: 'workflow', workspaceId: 'workspace', outputKind: 'image', steps: dynamic ? [{ ...edit, id: 'generate', name: '生成原图', kind: 'image-generation', imageMarkupId: undefined, imageSourceStepId: undefined }, edit] : [edit] }, models: [{ id: 'model', name: '隔离2.6', modelId: 'gpt-image-2.6-flare', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }], connections: [{ id: 'connection', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true }], input: '隔离预检，不调用模型', variables: {}, attachmentIds: dynamic ? [] : [source.id], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
  const read = vi.fn(async id => { if (!files.has(id)) throw new Error('fixture missing'); return files.get(id); });
  const dependencies = { credentials: { list: async () => [{ id: 'credential', connectionId: 'connection', enabled: true }] }, artifactStore: { read }, modelRuntime: { supports: () => true } };
  return { input, dependencies, source, markup, files, read, edit };
}
describe('Markup preflight without generation calls', () => {
  it('actual engine admission rejects an Office SVG source before producer calls, run creation or fees', async () => {
    const f = fixture(true), ownedRoot = path.resolve('work'), directory = await fs.mkdtemp(path.join(ownedRoot, 'office-vector-preflight-')), execute = vi.fn();
    f.input.project.kind = f.input.workflow.outputKind = 'word'; f.input.models[0].capabilities.push('text');
    f.input.workflow.steps = [{ ...f.input.workflow.steps[0], imageOutputFormat: 'svg' }, { ...f.edit, id: 'document', kind: 'text', imageMarkupId: undefined, imageSourceStepId: undefined, documentImageSource: 'previous', inputSource: 'previous' }];
    const engine = createLiveWorkflowEngine({ directory, ...f.dependencies, modelRuntime: { ...f.dependencies.modelRuntime, execute } });
    try {
      await expect(engine.start(f.input)).rejects.toMatchObject({ code: 'WORKFLOW_PREFLIGHT', message: expect.stringContaining('Office配图请使用PNG/JPEG/WebP') });
      expect(execute).not.toHaveBeenCalled(); const snapshot = await engine.snapshot(); expect(snapshot.runs).toHaveLength(0); expect(snapshot.ledger).toHaveLength(0);
    } finally { await engine.shutdown(); if (path.dirname(directory) !== ownedRoot) throw Error('Non-owned preflight test cleanup'); await fs.rm(directory, { recursive: true, force: true }); }
  });
  it.each(['word', 'ppt'])('blocks SVG/GIF feeding %s illustration steps before any paid producer can run', async kind => {
    for (const format of ['svg', 'gif']) for (const explicit of [false, true]) {
      const f = fixture(true), execute = vi.fn(); f.dependencies.modelRuntime.execute = execute;
      f.input.project.kind = f.input.workflow.outputKind = kind;
      f.input.models[0].capabilities.push('text');
      const producer = { ...f.input.workflow.steps[0], imageOutputFormat: format };
      const document = { ...f.edit, id: 'document', name: 'Office配图文稿', kind: 'text', imageMarkupId: undefined, imageSourceStepId: undefined, documentImageSource: 'previous', inputSource: 'project', ...(explicit ? { documentImageStepIds: ['generate'] } : {}) };
      f.input.workflow.steps = [producer, document];
      const result = await preflight(f.input, f.dependencies);
      expect(result.ok).toBe(false); expect(result.issues).toContainEqual({ message: '“Office配图文稿”：Office配图请使用PNG/JPEG/WebP；SVG/GIF可在图片工作台单独生成下载。', stepId: 'document', field: 'inputSource' });
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it.each(['word', 'ppt'])('retains PNG illustrated %s and standalone SVG/GIF generation without Office feeding', async kind => {
    const f = fixture(true); f.input.project.kind = f.input.workflow.outputKind = kind; f.input.models[0].capabilities.push('text');
    const producer = { ...f.input.workflow.steps[0], imageOutputFormat: 'png' };
    const document = { ...f.edit, id: 'document', kind: 'text', imageMarkupId: undefined, imageSourceStepId: undefined, documentImageSource: 'previous', inputSource: 'previous' };
    f.input.workflow.steps = [producer, document]; expect((await preflight(f.input, f.dependencies)).ok).toBe(true);
    for (const format of ['svg', 'gif']) { f.input.workflow.steps = [{ ...producer, imageOutputFormat: format }]; expect((await preflight(f.input, f.dependencies)).ok).toBe(true); }
  });
  it('validates a same-project transparent overlay against the first known raster original', async () => {
    const f = fixture(); expect((await preflight(f.input, f.dependencies)).ok).toBe(true);
    expect(f.read.mock.calls.map(call => call[0])).toEqual(['source', 'markup']);
  });
  it.each(['missing', 'foreign-markup', 'foreign-source', 'opaque', 'mismatch', 'wrong-mime', 'only-markup'])('rejects known invalid markup/reference before starting work: %s', async mode => {
    const f = fixture();
    if (mode === 'missing') f.files.delete('markup');
    if (mode === 'foreign-markup') f.markup.projectId = 'other';
    if (mode === 'foreign-source') f.source.projectId = 'other';
    if (mode === 'opaque') f.markup.buffer = bitmap(1, 1, 255);
    if (mode === 'mismatch') f.markup.buffer = bitmap(2, 1);
    if (mode === 'wrong-mime') f.markup.mimeType = 'image/jpeg';
    if (mode === 'only-markup') f.input.attachmentIds = ['markup'];
    const result = await preflight(f.input, f.dependencies);
    expect(result.ok).toBe(false); expect(result.issues).toContainEqual(expect.objectContaining({ stepId: 'edit', field: 'attachments' }));
  });
  it('accepts a valid overlay before an explicit dynamic source exists, deferring only the base-size comparison', async () => {
    const f = fixture(true); f.markup.buffer = bitmap(2, 1);
    const result = await preflight(f.input, f.dependencies);
    expect(result.ok).toBe(true); expect(f.read.mock.calls.map(call => call[0])).toEqual(['markup']);
    expect(result.warnings.some(text => text.includes('原图生成后会再次核对尺寸'))).toBe(true);
  });
  it('applies the same deferred check to the previous image output and still rejects a foreign overlay', async () => {
    const f = fixture(true); delete f.edit.imageSourceStepId; f.edit.inputSource = 'previous';
    expect((await preflight(f.input, f.dependencies)).ok).toBe(true);
    f.markup.projectId = 'other'; expect((await preflight(f.input, f.dependencies)).ok).toBe(false);
  });
  it.each(['image/svg+xml', 'image/gif'])('rejects %s as a known static edit reference', async mimeType => {
    const f = fixture(); delete f.edit.imageMarkupId; f.source.mimeType = mimeType;
    const result = await preflight(f.input, f.dependencies);
    expect(result.ok).toBe(false); expect(result.errors.some(text => text.includes('请先转换SVG或GIF'))).toBe(true);
  });
  it('keeps SVG count admission explicit without silently changing the workflow', async () => {
    const f = fixture(true); f.input.workflow.steps = [{ ...f.edit, kind: 'image-generation', imageSourceStepId: undefined, imageMarkupId: undefined, imageOutputFormat: 'svg', count: 2 }];
    const result = await preflight(f.input, f.dependencies);
    expect(result.ok).toBe(false); expect(result.errors.some(text => text.includes('SVG生成仅支持1张'))).toBe(true);
    expect(f.input.workflow.steps[0].count).toBe(2);
  });
});
