import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createGeneratedAnimationReference } = require('../../electron/generated-animation-reference.cjs');
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const directories = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function gif(width = 1, height = 1, frames = 2) {
  const header = Buffer.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 0, 0, 0, 0, 255]);
  header.writeUInt16LE(width, 6); header.writeUInt16LE(height, 8);
  const frame = Buffer.from([33, 249, 4, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame), Buffer.from([59])]);
}
function png(width = 1, height = 1, alpha = 0) {
  const bitmap = new PNG({ width, height }); bitmap.data.fill(255);
  for (let index = 3; index < bitmap.data.length; index += 4) bitmap.data[index] = alpha;
  return PNG.sync.write(bitmap);
}
async function fixture({ kind = 'image-generation', width = 1, height = 1, generated = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-animation-reference-')); directories.push(directory);
  const artifactStore = createArtifactStore({ directory, loadModule: dependencies });
  const sourceBytes = gif(width, height);
  const source = await artifactStore.write({ projectId: 'project', ...(generated ? { runId: 'run' } : {}), name: '原动图.gif', mimeType: 'image/gif', buffer: sourceBytes });
  const step = { id: 'producer', kind, prompt: '为{{客户}}制作{{动画主题}}', imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 200, imageQuality: 'high', imageComplexity: 'medium', imageMarkupId: 'old-markup', imageCompression: 65, credentialId: 'metadata-only', modelConfigId: 'image-model' };
  const attempt = { id: 'attempt', stepId: 'producer', status: 'complete', prompt: '实际发给模型的完整提示词', input: '已展开的客户需求与上游输入，保留蓝色角色和透明背景', artifacts: [source], costCents: 29, usage: { images: 1 }, calculation: { totalCents: 29 } };
  const run = { id: 'run', projectId: 'project', mode: 'live', status: 'waiting-review', input: '项目原始输入', snapshot: { steps: [step] }, attempts: [attempt] };
  const ledger = [{ id: 'charge', runId: 'run', costCents: 29, usage: attempt.usage, calculation: attempt.calculation }];
  const liveEngine = { runDetail: vi.fn(async () => run), start: vi.fn(async () => { throw Error('不得调用模型'); }) };
  const write = vi.spyOn(artifactStore, 'write');
  const prepare = createGeneratedAnimationReference({ artifactStore, liveEngine, loadModule: dependencies });
  const input = { projectId: 'project', sourceArtifactId: source.id };
  return { directory, artifactStore, source, sourceBytes, step, attempt, run, ledger, liveEngine, write, prepare, input };
}
async function rewriteSource(f, bytes, updateRegistration = false) {
  await fs.writeFile(f.source.path, bytes);
  if (!updateRegistration) return;
  const filename = path.join(f.directory, 'manifest-v1.json'), manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
  Object.assign(manifest.artifacts.find(item => item.id === f.source.id), { sha256: hash(bytes), bytes: bytes.length });
  await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('仅为本项目真实生成GIF准备静态修改参考', () => {
  it.each(['image-generation', 'image-editing'])('%s的完成产物在等待人工检查时可读取，元数据不泄露模型或凭证', async kind => {
    const f = await fixture({ kind }), before = structuredClone({ run: f.run, ledger: f.ledger });
    const result = await f.prepare({ ...f.input, origin: 'renderer-forged', name: '伪造.png' });
    expect(result).toEqual({ sourceArtifactId: f.source.id, sourceSha256: hash(f.sourceBytes), prompt: `${f.attempt.prompt}\n\n${f.attempt.input}`, imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 200, imageQuality: 'high', imageComplexity: 'medium' }, mimeType: 'image/gif', width: 1, height: 1, sourceBytes: Uint8Array.from(f.sourceBytes) });
    expect(result.prompt).not.toContain(f.step.prompt); expect(result.prompt).not.toContain(f.run.input);
    result.sourceBytes[13] ^= 1;
    expect(await fs.readFile(f.source.path)).toEqual(f.sourceBytes);
    expect({ run: f.run, ledger: f.ledger }).toEqual(before);
    expect(f.liveEngine.runDetail).toHaveBeenCalledWith('run'); expect(f.liveEngine.start).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  it.each([0, 255])('透明度%s的完整PNG保持原字节，辅助产物不冒充模型生成产物', async alpha => {
    const f = await fixture(), context = await f.prepare(f.input), bytes = png(1, 1, alpha), before = structuredClone({ run: f.run, ledger: f.ledger });
    const pngBytes = alpha ? Uint8Array.from(bytes).buffer : Uint8Array.from(bytes);
    const result = await f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes });
    expect(result.sourceArtifactId).toBe(f.source.id); expect(result.sourceBytes).toBeUndefined();
    expect(result.reference).toMatchObject({ projectId: 'project', mimeType: 'image/png', kind: 'image' }); expect(result.reference.runId).toBeUndefined();
    expect(f.write).toHaveBeenCalledWith({ projectId: 'project', name: '动画修改参考.png', mimeType: 'image/png', buffer: bytes });
    expect((await f.artifactStore.read(result.reference.id)).buffer).toEqual(bytes);
    expect(await fs.readFile(f.source.path)).toEqual(f.sourceBytes); expect({ run: f.run, ledger: f.ledger }).toEqual(before);
    await expect(f.prepare({ ...f.input, sourceArtifactId: result.reference.id })).rejects.toThrow('实际生成');
    expect(f.write).toHaveBeenCalledTimes(1); expect(f.liveEngine.start).not.toHaveBeenCalled();
  });

  it('只接受GIF逻辑画布的完整尺寸，拒绝320像素缩略图', async () => {
    const f = await fixture({ width: 640, height: 360 }), context = await f.prepare(f.input);
    await expect(f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: png(320, 180) })).rejects.toThrow('完整画布'); expect(f.write).not.toHaveBeenCalled();
    const result = await f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: png(640, 360) });
    expect(result).toMatchObject({ width: 640, height: 360 }); expect(f.write).toHaveBeenCalledTimes(1);
  });

  it('过滤不安全的旧选项，仅在实际提示词和输入均缺少时回退到运行输入', async () => {
    const f = await fixture(); Object.assign(f.step, { imageFrameCount: 50, imageFrameDurationMs: 201, imageQuality: 'invalid', imageComplexity: 'invalid' }); f.attempt.prompt = ''; f.attempt.input = '';
    const result = await f.prepare(f.input);
    expect(result.prompt).toBe(f.run.input); expect(result.imageOptions).toEqual({ imageOutputFormat: 'gif', imageFrameCount: 2 }); expect(f.write).not.toHaveBeenCalled();
  });

  it.each(['prompt', 'input'])('只有实际%s时不额外拼接项目输入', async field => {
    const f = await fixture(), expected = f.attempt[field];
    delete f.attempt[field === 'prompt' ? 'input' : 'prompt'];
    expect((await f.prepare(f.input)).prompt).toBe(expected); expect(f.write).not.toHaveBeenCalled();
  });

  it('实际提示词及展开输入合计200000字符可保留，超限两阶段均拒绝且不截断', async () => {
    const f = await fixture(); f.attempt.prompt = 'p'.repeat(100000); f.attempt.input = 'i'.repeat(99998);
    const context = await f.prepare(f.input); expect(context.prompt).toBe(`${f.attempt.prompt}\n\n${f.attempt.input}`); expect(context.prompt.length).toBe(200000);
    f.attempt.input += 'i'; const before = structuredClone({ run: f.run, ledger: f.ledger });
    for (const input of [f.input, { ...f.input, sourceSha256: context.sourceSha256, pngBytes: png() }]) await expect(f.prepare(input)).rejects.toThrow('超过200000字符');
    expect({ run: f.run, ledger: f.ledger }).toEqual(before); expect(f.write).not.toHaveBeenCalled();
  });

  it('回退上下文超限时不返回源字节或写参考图', async () => {
    const f = await fixture(); delete f.attempt.prompt; delete f.attempt.input; f.run.input = 'x'.repeat(200001);
    await expect(f.prepare(f.input)).rejects.toThrow('超过200000字符'); expect(f.write).not.toHaveBeenCalled();
  });

  it('源GIF超过32MiB或画布超限时在返回二进制前拒绝', async () => {
    const f = await fixture(), padding = Buffer.alloc(32 * 1024 * 1024);
    for (let offset = 0; offset < padding.length; offset += 256) padding[offset] = 255;
    const largeGif = Buffer.concat([f.sourceBytes.subarray(0, -1), Buffer.from([33, 254]), padding, Buffer.from([0, 59])]);
    await rewriteSource(f, largeGif, true); await expect(f.prepare(f.input)).rejects.toThrow('超过32MB');
    await rewriteSource(f, gif(4097, 4097), true); await expect(f.prepare(f.input)).rejects.toThrow('尺寸');
    expect(f.liveEngine.runDetail).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  it('外部导入GIF即使伪造renderer来源也在读取像素前拒绝，零写入和模型调用', async () => {
    const f = await fixture({ generated: false }), manifest = await fs.readFile(path.join(f.directory, 'manifest-v1.json'));
    for (const input of [{ ...f.input, origin: 'generated', runId: 'run' }, { ...f.input, sourceSha256: hash(f.sourceBytes), pngBytes: png() }]) await expect(f.prepare(input)).rejects.toThrow('外部导入');
    expect(f.liveEngine.runDetail).not.toHaveBeenCalled(); expect(f.liveEngine.start).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.directory, 'manifest-v1.json'))).toEqual(manifest); expect(await fs.readFile(f.source.path)).toEqual(f.sourceBytes);
  });

  it.each(['project', 'mode', 'run-id', 'trash', 'incomplete', 'wrong-artifact', 'wrong-kind', 'missing-step'])('拒绝不匹配的真实生成记录：%s', async invalid => {
    const f = await fixture();
    if (invalid === 'project') f.run.projectId = 'foreign';
    if (invalid === 'mode') f.run.mode = 'simulation';
    if (invalid === 'run-id') f.run.id = 'different';
    if (invalid === 'trash') f.run.trashedAt = '2026-11-07';
    if (invalid === 'incomplete') f.attempt.status = 'failed';
    if (invalid === 'wrong-artifact') f.attempt.artifacts = [{ ...f.source, id: 'different' }];
    if (invalid === 'wrong-kind') f.step.kind = 'export';
    if (invalid === 'missing-step') f.run.snapshot.steps = [];
    const before = structuredClone({ run: f.run, ledger: f.ledger });
    await expect(f.prepare(f.input)).rejects.toThrow();
    expect({ run: f.run, ledger: f.ledger }).toEqual(before); expect(f.write).not.toHaveBeenCalled(); expect(f.liveEngine.start).not.toHaveBeenCalled();
  });

  it('拒绝跨项目、回收站和缺失源文件，不创建辅助产物', async () => {
    const f = await fixture();
    await expect(f.prepare({ ...f.input, projectId: 'foreign' })).rejects.toThrow('本项目');
    await f.artifactStore.trash(f.source.id); await expect(f.prepare(f.input)).rejects.toThrow('回收站');
    await f.artifactStore.restore(f.source.id); await fs.unlink(f.source.path); await expect(f.prepare(f.input)).rejects.toThrow();
    await expect(f.prepare({ ...f.input, sourceArtifactId: 'missing' })).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled(); expect(f.liveEngine.runDetail).not.toHaveBeenCalled(); expect(f.liveEngine.start).not.toHaveBeenCalled();
  });

  it('受管源文件同尺寸被外部篡改时拒绝，登记与历史费用保持原样', async () => {
    const f = await fixture(), context = await f.prepare(f.input), changed = Buffer.from(f.sourceBytes), before = structuredClone({ run: f.run, ledger: f.ledger }); changed[13] ^= 1;
    const manifest = await fs.readFile(path.join(f.directory, 'manifest-v1.json')); await rewriteSource(f, changed);
    await expect(f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: png() })).rejects.toThrow('应用外改变');
    expect(await fs.readFile(path.join(f.directory, 'manifest-v1.json'))).toEqual(manifest); expect(await fs.readFile(f.source.path)).toEqual(changed);
    expect({ run: f.run, ledger: f.ledger }).toEqual(before); expect(f.write).not.toHaveBeenCalled();
  });

  it('两阶段源SHA绑定即使新内容与登记校验相符仍拒绝变化', async () => {
    const f = await fixture(), context = await f.prepare(f.input), changed = Buffer.from(f.sourceBytes); changed[13] ^= 1;
    await rewriteSource(f, changed, true);
    await expect(f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: png() })).rejects.toThrow('原动图内容已变化');
    expect(f.write).not.toHaveBeenCalled(); expect((await f.artifactStore.read(f.source.id)).buffer).toEqual(changed);
  });

  it('真实字节不是动画GIF时不能依靠原MIME和文件名通过', async () => {
    const f = await fixture(); await rewriteSource(f, gif(1, 1, 1), true);
    await expect(f.prepare(f.input)).rejects.toThrow('GIF'); expect(f.write).not.toHaveBeenCalled(); expect(f.liveEngine.runDetail).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, [], { projectId: 'project', sourceArtifactId: '../external' }, { projectId: '', sourceArtifactId: 'source' }])('拒绝无效来源选择：%s', async input => {
    const f = await fixture(); await expect(f.prepare(input)).rejects.toThrow('重新选择');
    expect(f.write).not.toHaveBeenCalled(); expect(f.liveEngine.runDetail).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'incorrect'])('第二阶段要求有效源SHA：%s', async sourceSha256 => {
    const f = await fixture(); await expect(f.prepare({ ...f.input, sourceSha256, pngBytes: png() })).rejects.toThrow('校验信息'); expect(f.write).not.toHaveBeenCalled();
  });

  it.each([null, 'data:image/png;base64,AAAA', [], new Uint8Array(), gif()])('拒绝非法、空或非PNG二进制参考：%s', async pngBytes => {
    const f = await fixture(); await expect(f.prepare({ ...f.input, sourceSha256: hash(f.sourceBytes), pngBytes })).rejects.toThrow(); expect(f.write).not.toHaveBeenCalled();
  });

  it('PNG需要实际完整解码，伪装有效的头尾仍不写入', async () => {
    const f = await fixture(), bytes = png(); bytes[bytes.indexOf(Buffer.from('IDAT')) + 4] ^= 1;
    await expect(f.prepare({ ...f.input, sourceSha256: hash(f.sourceBytes), pngBytes: bytes })).rejects.toThrow('完整解码'); expect(f.write).not.toHaveBeenCalled();
  });

  it('超过20MiB或像素上限时在PNG解码前拒绝', async () => {
    const f = await fixture(), loadModule = vi.fn(() => { throw Error('不应解码'); }), prepare = createGeneratedAnimationReference({ artifactStore: f.artifactStore, liveEngine: f.liveEngine, loadModule });
    await expect(prepare({ ...f.input, sourceSha256: hash(f.sourceBytes), pngBytes: new Uint8Array(20 * 1024 * 1024 + 1) })).rejects.toThrow('20MB');
    const bytes = png(); bytes.writeUInt32BE(4097, 16); bytes.writeUInt32BE(4097, 20);
    await expect(prepare({ ...f.input, sourceSha256: hash(f.sourceBytes), pngBytes: bytes })).rejects.toThrow('完整画布'); expect(loadModule).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });
});
