import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StudioConfiguration, WorkflowRun, WorkflowStep } from '../configuration-types';
import type { LiveStartRequest } from '../live-types';
import { DOCUMENT_IMAGE_LIMIT, illustratedDocumentSteps, validDocumentImageCount } from './document-illustrations';
import { readDocumentStudioForm } from './document-studio-state';
import { replaceDocumentImage, selectedDocumentImage } from './document-image-edit';
import { editorFromText, editorMissingInputs } from './editor-generated';
import { quickWorkflowTail } from './quick-workflow';
const require = createRequire(import.meta.url);
const { composeDocumentImages, illustrationAssets } = require('../../electron/document-illustrations.cjs');
const pictures = [1, 2].map(index => ({ id: `image-${index}`, kind: 'image', mimeType: 'image/png', projectId: 'project' }));
const rawWord = JSON.stringify({ title: '完整图文', sections: [{ heading: '目标', paragraphs: ['完整第一段', '完整第二段'] }, { heading: '执行', paragraphs: ['执行说明-END'] }] });
const rawPpt = JSON.stringify({ title: '完整图文', slides: [{ title: '封面', bullets: ['完整开场'], notes: '开场备注' }, { title: '方案', bullets: ['完整方案-END'], notes: '备注-END' }] });
const technicalImageGap = '原创产品插图需由本地排版器生成或提供；当前交付不包含图片文件。';
const businessImageGaps = ['图片版权及使用授权尚未确认。', '客户尚未提供品牌参考图。', '活动价格与事实需要客户核实。', technicalImageGap + '客户仍需确认版权授权。'];

describe('实际PNG交付后的资料说明', () => {
  it.each(['word', 'ppt'] as const)('%s管线提供已就绪图片上下文，保留原始模型源并导出无过期技术声明的真实Office', async kind => {
    const root = fileURLToPath(new URL('../../', import.meta.url)), fixtureRoot = path.join(root, 'work'); await fs.mkdir(fixtureRoot, { recursive: true });
    const directory = await fs.mkdtemp(path.join(fixtureRoot, 'illustration-metadata-')), runtimeManifest = path.join(root, 'work/ui-build/package.json'), dependencies = createRequire(existsSync(runtimeManifest) ? runtimeManifest : path.join(root, 'package.json'));
    const { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
    const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies }), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
    const raw = JSON.stringify({ ...JSON.parse(kind === 'word' ? rawWord : rawPpt), meta: { missingInputs: [technicalImageGap, businessImageGaps[0]] } }), calls: string[] = [];
    const configuration = { connections: [{ id: 'connection', name: '隔离文字连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true, status: 'configured' }], models: [{ id: 'model', name: '隔离文字模型', modelId: 'fixture-text', connectionId: 'connection', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } }], credentials: [{ id: 'key', name: '仅凭证元数据', connectionId: 'connection', enabled: true }] } as unknown as Pick<StudioConfiguration, 'connections' | 'models' | 'credentials'>;
    const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => configuration.credentials }, modelRuntime: { supports: () => true, execute: async (input: { kind: string; input: string; projectId: string; runId: string }) => {
      calls.push(input.kind); expect(input.input).toContain('已有 1 张可读取的真实插图'); expect(input.input).toContain('不属于待补充业务资料'); expect(input.input).toContain('版权');
      return { text: raw, artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: 'result.txt', mimeType: 'text/plain', text: raw })], usage: { inputTokens: 100, outputTokens: 100 } };
    } } });
    try {
      const image = await store.write({ projectId: 'project', name: '实际插图.png', mimeType: 'image/png', buffer: png });
      const project = { id: 'project', workspaceId: 'workspace', name: '图文资料说明', kind, status: 'draft', description: '', costCents: 0, version: 0, updatedAt: '', accent: 'blue' } as const;
      const request: LiveStartRequest = { project, workflow: { id: 'metadata-flow', workspaceId: 'workspace', name: '图文交付', outputKind: kind, description: '', updatedAt: '', steps: [{ id: 'body', name: '完整正文', kind: 'text', inputSource: 'project', prompt: '生成完整正文', enabled: true, modelConfigId: 'model', credentialId: 'key', documentImageSource: 'references' }, ...quickWorkflowTail(kind, 'text', '初次生成')] }, models: configuration.models, connections: configuration.connections, input: '完整图文需求', variables: {}, attachmentIds: [image.id], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
      const started = await engine.start(request); let complete: WorkflowRun | undefined; const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { const snapshot = await engine.snapshot(), run = snapshot.runs.find((item: WorkflowRun) => item.id === started.id); if (run?.status === 'failed') throw Error(run.error); if (run && ['waiting-review', 'complete'].includes(run.status)) { complete = run; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
      expect(complete).toBeDefined(); expect(calls).toEqual(['text']); expect((await engine.snapshot()).ledger).toHaveLength(1);
      const body = complete!.attempts.find(attempt => attempt.stepId === 'body')!, original = body.artifacts!.find(file => file.mimeType === 'text/plain')!, canonical = body.artifacts!.find(file => file.mimeType === 'application/json')!;
      expect((await store.read(original.id)).buffer.toString()).toBe(raw); const document = JSON.parse((await store.read(canonical.id)).buffer.toString()).editorDocument;
      expect(editorMissingInputs(document)).toEqual(['待补充：' + businessImageGaps[0]]);
      const office = complete!.attempts.flatMap(attempt => attempt.artifacts || []).find(file => file.kind === 'office')!, zip = await dependencies('jszip').loadAsync((await store.read(office.id)).buffer);
      const names = Object.keys(zip.files), media = names.filter(name => /^(word|ppt)\/media\/[^/]+$/.test(name)); expect(media).toHaveLength(1); expect((await zip.file(media[0]).async('nodebuffer')).equals(png)).toBe(true);
      const xml = (await Promise.all(names.filter(name => /^(word\/document|ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+))\.xml$/.test(name)).map(name => zip.file(name).async('string')))).join('\n');
      expect(xml).not.toContain('当前交付不包含图片文件'); expect(xml).toContain(businessImageGaps[0]); expect(xml).toContain(kind === 'word' ? '执行说明-END' : '完整方案-END'); expect((await engine.snapshot()).ledger).toHaveLength(1);
    } finally {
      await engine.shutdown(); const relative = path.relative(fixtureRoot, directory); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Refusing cleanup outside owned work fixture'); await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('实际图片确定性图文排版', () => {
  it('成功放入Word图片后仅消除实见技术缺口，正文与版权/品牌/事实缺资料完整保留', () => {
    const source = editorFromText('word', '标题', rawWord); if (source.kind !== 'word') throw Error('Word');
    source.blocks[1].text = '待补充：' + technicalImageGap;
    const raw = JSON.stringify({ ...source, meta: { missingInputs: [technicalImageGap, ...businessImageGaps], sources: ['客户提供资料，仍需核对。'] } });
    const document = composeDocumentImages('word', '标题', raw, pictures), bodyIds = new Set(source.blocks.map(block => block.id));
    expect(document.blocks.filter((block: { id: string }) => bodyIds.has(block.id))).toEqual(source.blocks);
    expect(editorMissingInputs(document)).toEqual([...businessImageGaps.map(note => '待补充：' + note), '资料依据：客户提供资料，仍需核对。']);
    expect(document.blocks.filter((block: { type: string }) => block.type === 'image')).toHaveLength(2);
  });
  it('仅有已兑现技术缺口时移除空Word附录，普通正文中的图片措辞与缺少实图失败仍保留', () => {
    const raw = JSON.stringify({ ...JSON.parse(rawWord), meta: { missingInputs: [technicalImageGap] } });
    const document = composeDocumentImages('word', '标题', raw, pictures);
    expect(document.blocks.some((block: { text: string }) => block.text === '待补充资料说明（非正文）')).toBe(false); expect(editorMissingInputs(document)).toEqual([]);
    expect(() => composeDocumentImages('word', '标题', raw, [])).toThrow('真实插图');
    const bodyOnly = composeDocumentImages('word', '标题', JSON.stringify({ ...JSON.parse(rawWord), meta: { missingInputs: businessImageGaps } }), pictures);
    expect(editorMissingInputs(bodyOnly)).toEqual(businessImageGaps.map(note => '待补充：' + note));
  });
  it('PPT仅清明确附录marker中的技术行，保留原备注、正文、页面与其他缺资料', () => {
    const source = JSON.parse(rawPpt), raw = JSON.stringify({ ...source, meta: { missingInputs: [technicalImageGap, ...businessImageGaps] } });
    const document = composeDocumentImages('ppt', '标题', raw, pictures);
    expect(document.slides.map((slide: { title: string; body: string }) => ({ title: slide.title, body: slide.body }))).toEqual(source.slides.map((slide: { title: string; bullets: string[] }) => ({ title: slide.title, body: slide.bullets.join('\n') })));
    expect(document.slides[0].notes).toBe(source.slides[0].notes); expect(document.slides[1].notes).toBe(source.slides[1].notes + '\n\n【待补充资料说明（非正文）】\n' + businessImageGaps.map(note => '待补充：' + note).join('\n'));
    expect(editorMissingInputs(document)).toEqual(businessImageGaps.map(note => '待补充：' + note));
  });
  it.each(['', '\n', '\r\n'])('PPT技术附录清空后备注还原原文，末尾换行%s和marker以外同样声明安全保留', ending => {
    const source = JSON.parse(rawPpt); source.slides[0].notes += '\n待补充：' + technicalImageGap;
    const document = composeDocumentImages('ppt', '标题', JSON.stringify({ ...source, meta: { missingInputs: [technicalImageGap + ending] } }), pictures);
    expect(document.slides.map((slide: { notes: string }) => slide.notes)).toEqual(source.slides.map((slide: { notes: string }) => slide.notes)); expect(editorMissingInputs(document)).toEqual([]);
    expect(document.slides.map((slide: { imageId: string }) => slide.imageId)).toEqual(pictures.map(picture => picture.id));
  });
  it('Word保留完整文字，插图是独立图片块，复读规范编辑源完全相同', () => {
    const document = composeDocumentImages('word', '标题', rawWord, pictures);
    expect(document.blocks.filter((block: { type: string }) => block.type === 'image').map((block: { imageId: string }) => block.imageId)).toEqual(pictures.map(image => image.id));
    expect(document.blocks.map((block: { text: string }) => block.text).join('\n')).toContain('执行说明-END');
    expect(editorFromText('word', '标题', JSON.stringify({ editorDocument: document }))).toEqual(document);
  });
  it('PPT仅改变所需版式，不增删页或正文及备注；页面不足时报明确错误', () => {
    const document = composeDocumentImages('ppt', '标题', rawPpt, pictures);
    expect(document.slides).toHaveLength(2); expect(document.slides.map((slide: { layout: string }) => slide.layout)).toEqual(['image-right', 'image-right']);
    expect(document.slides[1]).toMatchObject({ title: '方案', body: '完整方案-END', notes: '备注-END', imageId: 'image-2' });
    expect(() => composeDocumentImages('ppt', '标题', JSON.stringify({ title: '单页', slides: [{ title: '单页', bullets: ['内容'] }] }), pictures)).toThrow('减少配图');
  });
  it('拒绝跨项目图、未选择图片编号及没有真实配图的要求', () => {
    expect(() => illustrationAssets({ run: { projectId: 'other' } }, { documentImageSource: 'references' }, undefined, pictures)).toThrow('当前项目');
    expect(() => illustrationAssets({ run: { projectId: 'project' } }, { documentImageSource: 'previous' }, undefined, [])).toThrow('实际图片');
    const document = composeDocumentImages('word', '标题', rawWord, pictures);
    document.blocks.find((block: { type: string }) => block.type === 'image').imageId = 'invented-id';
    expect(() => composeDocumentImages('word', '标题', JSON.stringify(document), pictures)).toThrow('未选择的图片');
  });
  it('替换只影响绑定图片位置，保留后来文字编辑且拒绝已改图片的旧结果', () => {
    const original = composeDocumentImages('word', '标题', rawWord, pictures), source = structuredClone(original);
    const target = selectedDocumentImage(original, original.blocks.find((block: { type: string }) => block.type === 'image').id)!;
    original.blocks.find((block: { type: string }) => block.type === 'paragraph').text = '精修期间手工修改-END';
    const replaced = replaceDocumentImage(original, target, 'new-picture');
    expect(JSON.stringify(replaced)).toContain('精修期间手工修改-END'); expect(JSON.stringify(source)).not.toContain('new-picture');
    expect(() => replaceDocumentImage(replaced, target, 'another-picture')).toThrow('原图片位置已更改');
    if (replaced.kind !== 'word') throw new Error('Expected Word');
    expect(replaced.blocks.filter(block => block.type === 'image').map(block => block.imageId)).toEqual(['new-picture', 'image-2']);
  });
});

describe('图文模式配置', () => {
  const first: WorkflowStep = { id: 'body', kind: 'text', name: '正文', prompt: '完整正文', inputSource: 'project', enabled: true, modelConfigId: 'text' };
  const configuration = { connections: [{ id: 'connection', enabled: true }], models: [{ id: 'image', connectionId: 'connection', capabilities: ['image-generation'], enabled: true }], credentials: [{ id: 'key', connectionId: 'connection', enabled: true }] } as unknown as StudioConfiguration;
  it('参考图只增加本地排版标志，AI配图有独立真实模型调用并支持指定Key', () => {
    expect(illustratedDocumentSteps(first, [], { mode: 'references', count: 1 }, configuration, '需求')).toEqual([{ ...first, documentImageSource: 'references' }]);
    const workflow = illustratedDocumentSteps(first, [], { mode: 'generate', count: 4 }, configuration, '图文需求');
    expect(workflow.map(step => step.kind)).toEqual(['image-generation', 'image-generation', 'image-generation', 'image-generation', 'text']); expect(workflow.slice(0, 4).every(step => step.count === 1)).toBe(true); expect(workflow[0]).toMatchObject({ count: 1, modelConfigId: 'image', credentialId: 'key' }); expect(workflow[0].prompt).toContain('不要把整页文档');
    expect(workflow[4]).toMatchObject({ id: 'body', documentImageSource: 'previous', inputSource: 'project', documentImageStepIds: workflow.slice(0, 4).map(step => step.id) });
  });
  it.each([3, 5, 7, 10, DOCUMENT_IMAGE_LIMIT])('%i张自定义数量拆成独立单张请求，来源有序且所有编号唯一', count => {
    const steps = illustratedDocumentSteps(first, [], { mode: 'generate', count }, configuration, '需求');
    const pictures = steps.slice(0, count), body = steps[count];
    expect(pictures).toHaveLength(count); expect(pictures.every(step => step.count === 1 && step.inputSource === 'project')).toBe(true);
    expect(new Set(pictures.map(step => step.id)).size).toBe(count);
    expect(body.documentImageStepIds).toEqual(pictures.map(step => step.id));
    expect(readDocumentStudioForm(JSON.stringify({ version: 1, imageCount: count })).imageCount).toBe(count);
  });
  it('非法、空白、分数与过大数量不创建任何生成步骤', () => {
    for (const count of [0, -1, 1.5, 21, Number.NaN, Infinity]) {
      expect(validDocumentImageCount(count)).toBe(false);
      expect(() => illustratedDocumentSteps(first, [], { mode: 'generate', count }, configuration, '需求')).toThrow('整数');
    }
  });
  it('从无效AI数量切换到已有图片时不被隐藏的数量字段阻挡', () => {
    expect(illustratedDocumentSteps(first, [], { mode: 'references', count: Number.NaN }, configuration, '需求')).toEqual([{ ...first, documentImageSource: 'references' }]);
  });
  it('只汇总指定步骤最后成功图片，避免重复旧尝试或无关图片', () => {
    const snapshot = { steps: [{ id: 'one', kind: 'image-generation', enabled: true, count: 1 }, { id: 'two', kind: 'image-generation', enabled: true, count: 1 }, { id: 'body', kind: 'text', enabled: true }] };
    const record = { run: { projectId: 'project', snapshot, attempts: [{ stepId: 'one', status: 'complete', artifacts: [pictures[0]] }, { stepId: 'two', status: 'failed', artifacts: [{ ...pictures[1], id: 'failed-image' }] }, { stepId: 'two', status: 'complete', artifacts: [pictures[1]] }] } };
    const step = { id: 'body', documentImageSource: 'previous', documentImageStepIds: ['one', 'two'] };
    expect(illustrationAssets(record, step, { artifacts: [] }, [])).toEqual(pictures);
    record.run.attempts.pop();
    expect(() => illustrationAssets(record, step, undefined, [])).toThrow('约定数量');
  });
  it('旧表单默认为纯文字，自定义配图按项目保存并校验非法数量', () => {
    expect(readDocumentStudioForm('{"version":1,"brief":"保留旧需求"}')).toMatchObject({ brief: '保留旧需求', imageMode: 'none', imageCount: 1 });
    expect(readDocumentStudioForm(JSON.stringify({ version: 1, imageMode: 'generate', imageCount: 99, imageIds: ['abc', 'abc', '../no'] }))).toMatchObject({ imageMode: 'generate', imageCount: 1, imageIds: ['abc'] });
  });
});
