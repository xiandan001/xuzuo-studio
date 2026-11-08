import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, request, until } = require('./production-test-fixtures.cjs');
const { createBusinessProduction } = require('../../electron/business-production.cjs');
const { createBusinessStore } = require('../../electron/business-store.cjs');
const { PNG } = require('./production-test-fixtures.cjs').dependencies('pngjs');
const owned = [], now = '2026-11-08T00:00:00.000Z', hash = value => createHash('sha256').update(value).digest('hex');
function image(color = [200, 60, 40, 255], width = 8, height = 12) { const value = new PNG({ width, height }); for (let at = 0; at < value.data.length; at += 4) value.data.set(color, at); return PNG.sync.write(value); }
function memoryStore(initial) {
  let data = structuredClone(initial), queue = Promise.resolve();
  return { snapshot: async () => { await queue; return structuredClone(data); }, mutate(workspaceId, transform) { const task = queue.then(async () => { expect(workspaceId).toBe(data.workspaceId); const next = await transform(structuredClone(data)); next.revision = data.revision + 1; data = structuredClone(next); return structuredClone(data); }); queue = task.catch(() => undefined); return task; } };
}
async function businessFixture(recipe = 'merchant', count = 3, persisted = false) {
  const f = await fixture(); owned.push(f); f.composes = []; f.masks = []; f.alphaFailures = 0; f.hold = undefined;
  const project = { ...request().project, id: 'business-source', kind: 'image', name: '商品制作源', description: '实际输入', updatedAt: now };
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  const products = [];
  for (let index = 0; index < count; index++) { const artifact = await f.artifactStore.write({ projectId: project.id, name: `商品${index}.png`, mimeType: 'image/png', buffer: image([100 + index * 40, 40, 50, 255]) }); products.push({ id: `product-${index}`, sku: `SKU-${index}`, name: `真实商品${index}`, projectId: project.id, referenceArtifactIds: [artifact.id], facts: { 售价: '29.90', 材质: '用户确认材质' }, factsConfirmedAt: now, updatedAt: now }); }
  const order = { id: 'order', name: '客户上新包', recipe, sourceProjectId: project.id, brief: '自然光简洁背景', productIds: products.map(item => item.id), projectIds: [project.id], runIds: [], outputIds: [], includedRevisions: 2, status: 'draft', factsRevision: 1, facts: { 公司: '客户已确认公司' }, factsConfirmedAt: now, outputKinds: recipe === 'documents' ? ['ppt', 'word', 'excel'] : ['image'], imageCount: 3, sizes: [{ width: 64, height: 96, label: '测试交付尺寸' }], tasks: [], bindings: { text: { modelConfigId: 'text-model', credentialId: 'metadata-only' }, 'image-generation': { modelConfigId: 'image-model', credentialId: 'metadata-only' }, 'image-editing': { modelConfigId: 'image-model', credentialId: 'metadata-only' } }, createdAt: now, updatedAt: now };
  const initial = { version: 1, workspaceId: project.workspaceId, revision: 0, brands: [], products, orders: [order], feedback: [], transactions: [], metrics: [] };
  const store = persisted ? createBusinessStore({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore }) : memoryStore(initial);
  if (persisted) await store.save({ workspaceId: project.workspaceId, expectedRevision: 0, state: initial });
  const context = { project, credentials: [{ id: 'metadata-only', connectionId: 'connection', enabled: true }], connections: [{ ...request().connections[0], protocol: 'image' }, { ...request().connections[0], id: 'text-connection', protocol: 'openai-chat' }], models: [{ id: 'image-model', name: '图片fixture', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', enabled: true, capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }, { ...request().models[0], id: 'text-model', connectionId: 'text-connection' }] };
  context.credentials.push({ id: 'text-key', connectionId: 'text-connection', enabled: true }); order.bindings.text.credentialId = 'text-key'; await store.mutate(project.workspaceId, state => { state.orders[0].bindings.text.credentialId = 'text-key'; return state; });
  f.engineOptions.credentials.list = async () => context.credentials;
  f.engineOptions.modelRuntime.execute = async input => {
    if (f.hold) await f.hold;
    f.calls.push(input);
    if (input.kind === 'text') {
      const doc = input.prompt.includes('PPT JSON') ? { schemaVersion: 1, kind: 'ppt', title: '完整提案', theme: 'paper', slides: Array.from({ length: 8 }, (_, index) => ({ id: `slide-${index}`, title: `方案${index + 1}`, body: input.input, notes: '已确认事实', layout: 'title-body', fontSize: 22, align: 'left' })) } : input.prompt.includes('Excel工作簿JSON') ? { schemaVersion: 1, kind: 'excel', title: '资料与预算', sheets: [{ id: 'sheet', name: '预算', rowCount: 4, columnCount: 3, cells: { A1: { value: '名称' }, B1: { value: '金额' }, A2: { value: '实际输入' }, B2: { value: 29.9 }, B3: { value: 2 }, C3: { value: null, formula: '=B2*B3' } } }] } : { schemaVersion: 1, kind: 'word', title: '完整方案', blocks: [{ id: 'heading', type: 'heading', text: '客户资料', fontSize: 18, bold: true, italic: false, align: 'left' }, { id: 'body', type: 'paragraph', text: input.input + '这是明确的可执行方案。'.repeat(130), fontSize: 12, bold: false, italic: false, align: 'left' }] };
      const text = JSON.stringify(doc); return { text, usage: { inputTokens: 100, outputTokens: 200 }, artifacts: [await f.artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '模型正文.txt', mimeType: 'text/plain', text })] };
    }
    return { text: '', usage: { images: 1 }, artifacts: [await f.artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '模型图.png', mimeType: 'image/png', buffer: image([220, 120, 60, input.kind === 'image-editing' ? 128 : 255]) })] };
  };
  const commerceImages = {
    async applyAlpha(input) { f.masks.push(input); if (f.alphaFailures > 0) { f.alphaFailures--; throw Error('模型图没有实际透明Alpha，不能假报抠图成功'); } const source = await f.artifactStore.read(input.sourceArtifactId); return { artifact: await f.artifactStore.write({ projectId: input.projectId, name: '原RGB与Alpha.png', mimeType: 'image/png', buffer: source.buffer }), width: 8, height: 12, sourceSha256: hash(source.buffer) }; },
    async compose(input) {
      if (f.composeHold) await f.composeHold;
      f.composes.push(input); const runId = randomUUID(), id = randomUUID(), size = input.sizes[0], source = await f.artifactStore.read(input.sourceArtifactId), layer = (artifactId, role) => ({ id: randomUUID(), name: role, type: 'image', role, artifactId, x: 0, y: 0, width: size.width, height: size.height, opacity: 1, visible: true, locked: false });
      const document = { type: 'xuzuo-commerce-image', version: 1, id, projectId: input.projectId, sourceArtifactId: input.sourceArtifactId, sourceSha256: hash(source.buffer), revision: 1, title: input.title, width: size.width, height: size.height, background: '#FFFFFF', layers: input.layers || [...(input.backgroundArtifactId ? [layer(input.backgroundArtifactId, 'background')] : []), layer(input.sourceArtifactId, 'product')], updatedAt: now };
      const artifacts = [await f.artifactStore.write({ projectId: input.projectId, runId, name: `${input.title}-图层.json`, mimeType: 'application/json', text: JSON.stringify(document) })];
      for (const size of input.sizes) artifacts.push(await f.artifactStore.write({ projectId: input.projectId, runId, name: `${input.title}.png`, mimeType: 'image/png', buffer: image([180, 50, 50, 255], size.width, size.height) })); return { artifacts, sourceRevision: 1, documentId: id, runId };
    }, async cancel() {},
  };
  const service = createBusinessProduction({ businessStore: store, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, getContext: async () => structuredClone(context), commerceImages, editorStore: f.editorStore, spreadsheetStore: f.spreadsheetStore, loadModule: f.loadModule });
  return Object.assign(f, { service, businessStore: store, context, project, order, products, input: { workspaceId: project.workspaceId, orderId: order.id }, state: () => store.snapshot(project.workspaceId), untilStatus: status => until(() => store.snapshot(project.workspaceId), value => value.orders[0].status === status) });
}
afterEach(async () => { for (const f of owned.splice(0)) { await f.service?.shutdown(); await f.engine.shutdown(); await Promise.all([f.businessStore?.drain?.(), f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); expect(path.dirname(await fs.realpath(f.directory))).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(f.directory)).toMatch(/^xuzuo-production-/); await fs.rm(f.directory, { recursive: true, force: true }); } });
describe('业务原生生产、费用与真实文件', () => {
  it('真实持久化严格校验兼容完整制作、交付和重启重读，不依赖内存元数据替身', async () => {
    const f = await businessFixture('merchant', 1, true); await f.service.start({ ...f.input, sampleOnly: false }); await f.untilStatus('review');
    const delivered = await f.service.deliver({ ...f.input, checks: { content: true, rights: true, format: true } });
    const fresh = createBusinessStore({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore });
    try { const saved = await fresh.snapshot(f.project.workspaceId); expect(saved).toEqual(delivered.state); expect(saved.orders[0].runIds).toHaveLength(2); expect(saved.orders[0].deliveries[0].files).toHaveLength(3); expect(saved.orders[0].tasks.every(task => task.inputHash?.length === 64)).toBe(true); }
    finally { await fresh.drain(); }
  });
  it('三SKU只先做完整首款，确认后串行其余、原图与SKU隔离且背景可复用', async () => {
    const f = await businessFixture(); await f.service.start(f.input); let state = await f.untilStatus('sample-review');
    expect(f.calls).toHaveLength(3); expect(state.orders[0].outputIds).toHaveLength(3); expect(state.orders[0].tasks.filter(task => task.productId !== 'product-0').every(task => task.status === 'pending')).toBe(true);
    await f.service.control({ ...f.input, action: 'continue' }); state = await f.untilStatus('review');
    expect(f.calls.filter(call => call.kind === 'image-editing').map(call => call.attachments.map(file => file.id))).toEqual(f.products.map(product => product.referenceArtifactIds));
    expect(f.calls.filter(call => call.kind === 'image-generation').every(call => call.attachments.length === 0 && !call.input.includes('29.90'))).toBe(true);
    expect(state.orders[0].outputIds).toHaveLength(9); expect(f.calls).toHaveLength(5); expect((await f.engine.snapshot()).ledger).toHaveLength(5);
  });
  it('改价只重排本地，禁用Key也不妨碍复用已完成结果，费用原样保留', async () => {
    const f = await businessFixture('merchant', 1); await f.service.start({ ...f.input, sampleOnly: false }); await f.untilStatus('review'); const calls = f.calls.length, ledger = structuredClone((await f.engine.snapshot()).ledger), first = (await f.state()).orders[0].outputIds;
    await f.businessStore.mutate(f.project.workspaceId, state => { state.products[0].facts.售价 = '35.00'; state.orders[0].factsRevision++; return state; }); f.context.credentials = [];
    await f.service.start(f.input); const state = await f.untilStatus('review'); expect(f.calls).toHaveLength(calls); expect((await f.engine.snapshot()).ledger).toEqual(ledger); expect(state.orders[0].outputIds).not.toEqual(first); expect(f.composes.at(-1).text).toContain('35.00'); expect(state.orders[0].tasks.every(task => task.factsRevision === 2)).toBe(true);
  });
  it('抠图结果不透明即停止，不支付背景生成；明确重试只重做失败商品并保留首笔费用', async () => {
    const f = await businessFixture('merchant', 2); f.alphaFailures = 1; await f.service.start(f.input); const failed = await f.untilStatus('failed'); expect(f.calls).toHaveLength(1); expect(f.calls[0].kind).toBe('image-editing');
    await f.service.control({ ...f.input, action: 'retry', taskId: failed.orders[0].tasks[0].id }); const state = await until(f.state, value => value.orders[0].status === 'ready' || value.orders[0].status === 'sample-review');
    expect(state.orders[0].tasks.filter(task => task.productId === 'product-0').every(task => task.status === 'complete')).toBe(true); expect(state.orders[0].tasks.filter(task => task.productId === 'product-1').every(task => task.status === 'pending')).toBe(true); expect((await f.engine.snapshot()).ledger).toHaveLength(4); expect(state.orders[0].runIds).toHaveLength(3);
  });
  it('实际生成三类OOXML与可编辑源，Excel公式已重算、Word/PPT嵌入真实图片', async () => {
    const f = await businessFixture('documents', 2), result = await f.service.start(f.input); expect(result.projects.map(project => project.kind)).toEqual(['ppt', 'word', 'excel']); const state = await f.untilStatus('review');
    expect(state.orders[0].outputIds).toHaveLength(3); const zip = f.loadModule('jszip');
    for (const task of state.orders[0].tasks) { const file = await f.artifactStore.read(task.artifactIds[0]); expect(file.buffer.subarray(0, 2).toString()).toBe('PK'); const archive = await zip.loadAsync(file.buffer); if (task.kind === 'ppt') { expect(archive.file('ppt/presentation.xml')).toBeTruthy(); expect(Object.keys(archive.files).some(name => name.startsWith('ppt/media/'))).toBe(true); expect((await f.editorStore.load({ projectId: task.projectId, kind: 'ppt' })).document.slides).toHaveLength(8); } else if (task.kind === 'word') { expect(archive.file('word/document.xml')).toBeTruthy(); expect(Object.keys(archive.files).some(name => name.startsWith('word/media/'))).toBe(true); } else { expect(archive.file('xl/workbook.xml')).toBeTruthy(); const record = await f.spreadsheetStore.load({ projectId: task.projectId }); expect(record.calculation.cells.sheet.C3.value).toBe(59.8); } }
    expect(f.calls).toHaveLength(3);
  });
  it('事实改变生成独立子项目，不覆盖旧人工Word，旧模型费用关联不减少', async () => {
    const f = await businessFixture('documents', 1); await f.service.start(f.input); const old = await f.untilStatus('review'), word = old.orders[0].tasks.find(task => task.kind === 'word'), current = await f.editorStore.load({ projectId: word.projectId, kind: 'word' }); current.document.blocks[0].text = '人工已确认的新标题'; await f.editorStore.save({ projectId: word.projectId, expectedRevision: current.revision, document: current.document });
    await f.businessStore.mutate(f.project.workspaceId, state => { state.orders[0].facts.公司 = '客户新确认的公司'; state.orders[0].factsRevision++; return state; }); await f.service.start(f.input); const state = await f.untilStatus('review');
    expect(state.orders[0].tasks.find(task => task.kind === 'word').projectId).not.toBe(word.projectId); expect((await f.editorStore.load({ projectId: word.projectId, kind: 'word' })).document.blocks[0].text).toBe('人工已确认的新标题'); expect(old.orders[0].runIds.every(id => state.orders[0].runIds.includes(id))).toBe(true); expect(f.calls).toHaveLength(6);
  });
  it('交付绑定真实文件SHA和当前资料，采用新导出不改旧回执或费用', async () => {
    const f = await businessFixture('merchant', 1); await f.service.start({ ...f.input, sampleOnly: false }); const state = await f.untilStatus('review'), file = await f.artifactStore.read(state.orders[0].outputIds[0]), checks = { content: true, rights: true, format: true };
    await fs.writeFile(file.path, Buffer.from('changed')); await expect(f.service.deliver({ ...f.input, checks })).rejects.toThrow('改变'); await fs.writeFile(file.path, file.buffer);
    const delivered = await f.service.deliver({ ...f.input, checks }); expect(delivered.state.orders[0].status).toBe('complete'); expect(delivered.state.orders[0].deliveries[0].files[0].sha256).toBe(hash(file.buffer)); const ledger = structuredClone((await f.engine.snapshot()).ledger);
    const newer = await f.artifactStore.write({ projectId: f.project.id, name: '人工更新正式图.png', mimeType: 'image/png', buffer: image([10, 150, 180, 255]) }); const adopted = await f.service.adopt({ ...f.input, artifactIds: [newer.id] }); expect(adopted.state.orders[0].outputIds).toEqual([newer.id]); expect(adopted.state.orders[0].deliveries).toEqual(delivered.state.orders[0].deliveries); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
  });
  it('数字商品主动采用已有作品，无模型、Key或先制作任务也能正式交付', async () => {
    const f = await businessFixture('digital', 0); f.context.models = []; f.context.credentials = []; await f.businessStore.mutate(f.project.workspaceId, state => { delete state.orders[0].factsConfirmedAt; state.orders[0].factsRevision = 0; return state; });
    const formal = await f.artifactStore.write({ projectId: f.project.id, name: '自有原创壁纸.png', mimeType: 'image/png', buffer: image() }); const adopted = await f.service.adopt({ ...f.input, artifactIds: [formal.id] });
    expect(adopted.state.orders[0].tasks[0].status).toBe('complete'); const delivered = await f.service.deliver({ ...f.input, checks: { content: true, rights: true, format: true } }); expect(delivered.state.orders[0].status).toBe('complete'); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toHaveLength(0);
  });
  it('明确选择共用Word与插图才提取/复制/嵌入，宣传图有真正image调用，本地改价复用原背景', async () => {
    const f = await businessFixture('documents', 0), reference = await f.artifactStore.write({ projectId: f.project.id, name: '用户确认资料.txt', mimeType: 'text/plain', text: '唯一明确的真实型号ABC-123，不得替换为其他型号。' }), illustration = await f.artifactStore.write({ projectId: f.project.id, name: '明确选择的真实配图.png', mimeType: 'image/png', buffer: image() });
    await f.businessStore.mutate(f.project.workspaceId, state => { state.orders[0].referenceArtifactIds = [reference.id, illustration.id]; state.orders[0].outputKinds = ['word', 'image']; return state; });
    await f.service.start(f.input); let state = await f.untilStatus('review'); expect(f.calls.filter(call => call.kind === 'text')[0].input).toContain('ABC-123'); expect(f.calls.filter(call => call.kind === 'text')[0].attachments).toEqual([]); expect(f.calls.filter(call => call.kind === 'image-generation')).toHaveLength(1);
    const word = state.orders[0].tasks.find(task => task.kind === 'word'), record = await f.editorStore.load({ projectId: word.projectId, kind: 'word' }); expect(record.document.blocks.some(block => block.type === 'image')).toBe(true); expect(f.composes.at(-1).layers.some(layer => layer.role === 'product')).toBe(true);
    await f.businessStore.mutate(f.project.workspaceId, state => { state.orders[0].facts.售价 = '88.00'; state.orders[0].factsRevision++; state.orders[0].outputKinds = ['image']; return state; }); f.context.credentials = [];
    await f.service.start(f.input); state = await f.untilStatus('review'); expect(f.calls.filter(call => call.kind === 'image-generation')).toHaveLength(1); expect(f.composes.at(-1).layers.find(layer => layer.type === 'text').text).toContain('88.00'); expect(state.orders[0].tasks.map(task => task.kind)).toEqual(['image']);
  });
  it('品牌已确认成品的背景实际复用，换新场景才要求新的生成能力，私人联系记录不传播', async () => {
    const f = await businessFixture('merchant', 1); await f.service.start({ ...f.input, sampleOnly: false }); const first = await f.untilStatus('review'), beforeCalls = f.calls.length;
    await f.businessStore.mutate(f.project.workspaceId, state => { state.brands.push({ id: 'brand', name: '真实客户', contact: '仅本地私密联系电话', colors: ['#224466'], font: 'Microsoft YaHei', voice: '自然简洁', forbiddenClaims: [], approvedSampleIds: [first.orders[0].outputIds[1]], updatedAt: now }); const next = { ...structuredClone(state.orders[0]), id: 'repeat-order', name: '同客户下次上新', brandId: 'brand', imageCount: 2, tasks: [], runIds: [], outputIds: [], status: 'draft' }; delete next.preparedHash; state.orders.push(next); return state; });
    f.context.models[0].capabilities = ['image-editing']; const input = { ...f.input, orderId: 'repeat-order' }; await f.service.start({ ...input, sampleOnly: false }); const state = await until(f.state, value => value.orders[1].status === 'review');
    expect(f.calls.length - beforeCalls).toBe(1); expect(f.calls.at(-1).kind).toBe('image-editing'); expect(f.calls.at(-1).input).not.toContain('私密联系电话'); expect(state.orders[1].tasks.find(task => task.operation === 'background').label).toContain('沿用品牌');
    await f.businessStore.mutate(f.project.workspaceId, state => { state.orders[1].facts.newScene = 'true'; state.orders[1].factsRevision++; return state; }); const blocked = await f.service.start(input); expect(blocked.state.orders[1].status).toBe('failed'); expect(blocked.state.orders[1].error).toContain('场景生成模型'); expect(f.calls.length - beforeCalls).toBe(1);
  });
  it('采用本地衍生成品只认领可追溯且未分配的两笔制作费，不混入同项目无关运行', async () => {
    const f = await businessFixture('digital', 0);
    const makeRequest = (id, references = []) => ({ ...request(), project: f.project, input: '费用归属真实图像', workflow: { ...request().workflow, id, outputKind: 'image', steps: [{ id: id + '-image', name: '真实图像', kind: references.length ? 'image-editing' : 'image-generation', prompt: '只做这一张图', inputSource: 'project', enabled: true, referenceArtifactIds: references, modelConfigId: 'image-model', credentialId: 'metadata-only', count: 1 }] }, models: f.context.models, connections: f.context.connections, attachmentIds: [] });
    const a = await f.engine.start(makeRequest('ancestor-a')); let snapshot = await until(() => f.engine.snapshot(), value => value.runs.find(run => run.id === a.id)?.status === 'complete'); const imageA = snapshot.runs.find(run => run.id === a.id).attempts[0].artifacts[0];
    const b = await f.engine.start(makeRequest('ancestor-b', [imageA.id])); snapshot = await until(() => f.engine.snapshot(), value => value.runs.find(run => run.id === b.id)?.status === 'complete'); const imageB = snapshot.runs.find(run => run.id === b.id).attempts[0].artifacts[0];
    const unrelated = await f.engine.start(makeRequest('unrelated')); await until(() => f.engine.snapshot(), value => value.runs.find(run => run.id === unrelated.id)?.status === 'complete');
    const source = await f.artifactStore.read(imageB.id), output = await f.artifactStore.write({ projectId: f.project.id, runId: 'derived-local', name: '本地4K.png', mimeType: 'image/png', buffer: image([210, 80, 40, 255], 2160, 3840) });
    await f.engine.recordLocalExport({ projectId: f.project.id, workspaceId: f.project.workspaceId, name: '费用来源可追溯4K', kind: 'image', artifacts: [output], wallpaperExport: { sourceArtifactId: imageB.id, sourceSha256: hash(source.buffer), target: { width: 2160, height: 3840, fit: 'cover' } } });
    let adopted = await f.service.adopt({ ...f.input, artifactIds: [output.id] }); expect(new Set(adopted.state.orders[0].runIds)).toEqual(new Set([a.id, b.id]));
    adopted = await f.service.adopt({ ...f.input, artifactIds: [output.id] }); expect(adopted.state.orders[0].runIds).toHaveLength(2); expect((await f.engine.snapshot()).ledger).toHaveLength(3);
  });
  it('双击开始共享派单，取消晚回执不会触发背景或本地成品，已发生费用保留', async () => {
    const f = await businessFixture('merchant', 1); let release; f.hold = new Promise(resolve => { release = resolve; });
    try {
      await Promise.all([f.service.start(f.input), f.service.start(f.input)]); await until(() => f.engine.snapshot(), value => value.ledger.length === 1);
      expect(f.service.isProjectBusy(f.project.id)).toBe(true); await f.service.control({ ...f.input, action: 'cancel' }); release(); await f.service.drain(); await until(() => f.engine.snapshot(), value => value.ledger[0]?.status === 'complete');
      expect(f.calls).toHaveLength(1); expect(f.composes).toHaveLength(0); expect((await f.state()).orders[0].outputIds).toEqual([]); expect((await f.engine.snapshot()).ledger[0].costCents).toBe(100); expect(f.service.isWorkspaceBusy(f.project.workspaceId)).toBe(false);
    } finally { release(); }
  });
  it('制作中改资料立即停后续收费，旧结果可按依赖复用，新价格只完成待做项', async () => {
    const f = await businessFixture('merchant', 1); let release; f.hold = new Promise(resolve => { release = resolve; });
    try {
      await f.service.start(f.input); await until(() => f.engine.snapshot(), value => value.ledger.length === 1);
      await f.businessStore.mutate(f.project.workspaceId, state => { state.products[0].facts.售价 = '48.00'; state.orders[0].factsRevision++; return state; }); release(); const failed = await f.untilStatus('failed');
      expect(f.calls).toHaveLength(1); expect(failed.orders[0].tasks[0].status).toBe('stale'); await f.service.start({ ...f.input, sampleOnly: false }); const complete = await f.untilStatus('review');
      expect(f.calls).toHaveLength(3); expect(f.composes.at(-1).text).toContain('48.00'); expect(complete.orders[0].runIds).toHaveLength(2);
    } finally { release(); }
  });
  it('启动回包与查询暂不可读时留未知标记，恢复后只查询旧run并补回费用关联', async () => {
    const f = await businessFixture('merchant', 1); await f.businessStore.mutate(f.project.workspaceId, state => { state.orders[0].imageCount = 1; return state; });
    const originalStart = f.engine.start.bind(f.engine), originalLookup = f.engine.lookupStart.bind(f.engine);
    f.engine.start = async input => { await originalStart(input); throw Error('模拟启动回包丢失'); }; f.engine.lookupStart = async () => { throw Error('模拟查询暂不可读'); };
    await f.service.start(f.input); const failed = await f.untilStatus('failed'); expect(failed.orders[0].tasks[0].submittedAt).toBeTruthy(); expect(failed.orders[0].tasks[0].runId).toBeUndefined();
    await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'complete'); f.engine.start = originalStart; f.engine.lookupStart = originalLookup; f.context.credentials = [];
    await f.service.control({ ...f.input, action: 'retry', taskId: failed.orders[0].tasks[0].id }); const state = await f.untilStatus('review'); expect(f.calls).toHaveLength(1); expect(state.orders[0].tasks[0].runId).toBeTruthy(); expect(state.orders[0].runIds).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('模型均已完成但本地排版仍执行时取消不会再次取消complete模型或卡住退出', async () => {
    const f = await businessFixture('merchant', 1); let release; f.composeHold = new Promise(resolve => { release = resolve; });
    try { await f.service.start({ ...f.input, sampleOnly: false }); await until(f.state, state => state.orders[0].tasks.some(task => task.operation === 'compose' && task.status === 'running')); expect((await f.engine.snapshot()).runs.every(run => run.status === 'complete')).toBe(true); await expect(f.service.control({ ...f.input, action: 'cancel' })).resolves.toBeTruthy(); release(); await f.service.drain(); expect(f.service.isWorkspaceBusy(f.project.workspaceId)).toBe(false); expect((await f.engine.snapshot()).ledger).toHaveLength(3); }
    finally { release(); }
  });
});
