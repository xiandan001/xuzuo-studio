const { randomUUID, createHash } = require('node:crypto');
const planner = require('./business-production.runtime.cjs');
const { normalizeOfficeDocument } = require('./office-content.cjs');
const { composeDocumentImages } = require('./document-illustrations.cjs');
const { extractReferenceText } = require('./reference-text.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const MIME = { ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const raster = new Set(['image/png', 'image/jpeg', 'image/webp']);
function nativeBusinessProjects({ workspaceStorage, artifactStore, getContext, editorStore, spreadsheetStore, commerceImages }) {
  async function context(workspaceId, order) {
    const value = await getContext({ workspaceId, projectId: order.sourceProjectId });
    if (!value?.project || value.project.id !== order.sourceProjectId || value.project.workspaceId !== workspaceId || value.project.trashedAt || value.project.purgedAt) throw Error('制作单的源项目不可用，请恢复当前工作区中的项目。');
    await workspaceStorage.assertProject(order.sourceProjectId, workspaceId);
    return value;
  }
  function binding(order, context, capability) {
    const chosen = order.bindings[capability] || {}, models = context.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(capability) && context.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
    const model = chosen.modelConfigId ? models.find(model => model.id === chosen.modelConfigId) : models.length === 1 ? models[0] : undefined;
    const title = { text: '文档制作', 'image-editing': '商品抠图', 'image-generation': '场景生成' }[capability] || capability;
    if (!model) throw Error(`请先选择${title}模型。`);
    const keys = (context.credentials || []).filter(key => key.connectionId === model.connectionId && key.enabled), credential = chosen.credentialId ? keys.find(key => key.id === chosen.credentialId) : keys.length === 1 ? keys[0] : undefined;
    if (!credential) throw Error(`请为${title}选择该模型连接下启用的Key。`);
    return { model, credential, connection: context.connections.find(connection => connection.id === model.connectionId) };
  }
  async function referenceFiles(workspaceId, ids, imagesOnly = false) {
    const registered = new Set((await workspaceStorage.list()).projects.filter(project => project.workspaceId === workspaceId).map(project => project.projectId)), result = [];
    let bytes = 0;
    for (const id of ids) {
      const file = await artifactStore.read(id);
      bytes += file.buffer.length;
      if (!registered.has(file.projectId) || file.trashedAt || file.unavailable || imagesOnly && (file.kind !== 'image' || !raster.has(file.mimeType)) || file.buffer.length > 32 * 1024 * 1024 || bytes > 80 * 1024 * 1024) throw Error(imagesOnly ? '商品与Logo原图必须是本工作区可读取的PNG、JPEG或WebP静态图片，单份32MB、合计80MB以内。' : '共用资料必须属于本工作区，单份32MB、合计80MB以内。');
      result.push({ ...file, sha256: sha(file.buffer) });
    }
    return result;
  }
  const sourceFiles = (workspaceId, ids) => referenceFiles(workspaceId, ids, true);
  async function copyReferences(workspaceId, ids, projectId, imagesOnly = true) {
    const files = await referenceFiles(workspaceId, ids, imagesOnly), result = [];
    for (const file of files) result.push(file.projectId === projectId ? file.id : (await artifactStore.write({ projectId, name: file.name, mimeType: file.mimeType, buffer: file.buffer, preserveOriginalName: true, ...(file.provenance ? { provenance: file.provenance } : {}) })).id);
    return result;
  }
  function documentReferenceIds(order, state) { return [...new Set([...(order.referenceArtifactIds || []), ...planner.businessOrderProducts(order, state).flatMap(product => product.referenceArtifactIds.slice(0, 1))])].slice(0, 20); }
  async function approvedBackgrounds(state, order) {
    const brand = state.brands.find(item => item.id === order.brandId), targetCount = Math.min(16, Math.max(0, order.imageCount - 1));
    if (!brand?.approvedSampleIds.length || order.facts.newScene === 'true' || !targetCount) return [];
    const result = [], seen = new Set();
    for (const sampleId of brand.approvedSampleIds) {
      try {
        const sample = (await sourceFiles(state.workspaceId, [sampleId]))[0];
        if (!sample.runId) continue;
        let documents;
        if (typeof commerceImages?.snapshot === 'function') { const value = await commerceImages.snapshot({ projectId: sample.projectId, sourceArtifactId: sampleId }); documents = value?.document ? [value.document] : []; }
        else {
          documents = [];
          for (const metadata of (await artifactStore.listProject(sample.projectId)).filter(file => file.runId === sample.runId && file.mimeType === 'application/json' && file.bytes <= 2 * 1024 * 1024)) {
            const file = await artifactStore.read(metadata.id), value = JSON.parse(file.buffer.toString('utf8'));
            if (value.type === 'xuzuo-commerce-image' && value.projectId === sample.projectId) documents.push(require('./commerce-image-document.cjs').checkedCommerceDocument(value));
          }
        }
        for (const document of documents) for (const layer of document.layers.filter(layer => layer.type === 'image' && layer.role === 'background' && layer.visible && layer.opacity > 0)) {
          const file = (await sourceFiles(state.workspaceId, [layer.artifactId]))[0]; if (seen.has(file.sha256)) continue;
          seen.add(file.sha256); result.push((await copyReferences(state.workspaceId, [file.id], order.sourceProjectId))[0]);
          if (result.length >= targetCount) return result;
        }
      } catch { /* An unavailable or flat sample cannot silently become a different product reference. */ }
    }
    return result;
  }
  async function createProject(workspaceId, order, task) {
    const projectId = randomUUID(), name = `${order.name.slice(0, 65)} · ${task.kind.toUpperCase()} · v${order.factsRevision}`;
    const location = await workspaceStorage.ensureProject({ projectId, workspaceId, name });
    return { id: projectId, workspaceId, name, kind: task.kind, directory: location.directory, description: order.brief, status: 'draft', costCents: 0, version: 0, accent: task.kind === 'ppt' ? 'orange' : task.kind === 'excel' ? 'green' : 'blue', updatedAt: new Date().toISOString() };
  }
  async function projectMetadata(workspaceId, order, task) {
    const registry = (await workspaceStorage.list()).projects.find(project => project.projectId === task.projectId && project.workspaceId === workspaceId);
    if (!registry) throw Error('制作子项目已不可用，请恢复原文件夹后再继续。');
    return { id: task.projectId, workspaceId, name: registry.name || `${order.name.slice(0, 70)} · ${task.kind.toUpperCase()}`, kind: task.kind, directory: registry.directory, description: order.brief, status: 'draft', costCents: 0, version: 0, accent: task.kind === 'ppt' ? 'orange' : task.kind === 'excel' ? 'green' : 'blue', updatedAt: new Date().toISOString() };
  }
  async function request(order, state, task, context, project) {
    const capability = task.operation === 'cutout' ? 'image-editing' : task.operation === 'background' || task.kind === 'image' ? 'image-generation' : 'text', selected = binding(order, context, capability);
    const count = task.operation === 'background' ? Math.max(1, order.imageCount - 1 - (task.referenceArtifactIds?.length || 0)) : 1, prompt = planner.businessTaskPrompt(order, state, task);
    const sceneNames = ['简洁影棚台面', '自然光窗边', '生活方式场景', '温暖室内环境', '中性质感背景'];
    const steps = Array.from({ length: count }, (_, index) => ({ id: `${task.id}-${index + 1}`, name: `${task.label}${count > 1 ? ` ${index + 1}/${count}` : ''}`.slice(0, 100), kind: capability, role: 'producer', prompt: task.operation === 'background' ? `${prompt}\n若用户未指定具体场景，本张采用：${sceneNames[index % sceneNames.length]}。` : prompt, modelConfigId: selected.model.id, credentialId: selected.credential.id, enabled: true, inputSource: 'project', referenceArtifactIds: task.operation === 'cutout' ? task.referenceArtifactIds : [], maxOutputTokens: capability === 'text' ? 8192 : 2048, ...(capability !== 'text' ? { imageSize: task.operation === 'cutout' && selected.model.modelId.startsWith('gpt-image') ? 'auto' : '1024x1024', imageBackground: task.operation === 'cutout' ? 'transparent' : 'opaque', imageOutputFormat: 'png', count: 1 } : {}) }));
    let input = planner.businessTaskInput(order, state, task);
    if (capability === 'text') for (const id of task.referenceArtifactIds || []) {
      const file = await artifactStore.read(id);
      if (['text', 'office'].includes(file.kind)) input += `\n\n【用户明确选择的共用资料：${file.name}】\n${await extractReferenceText(file)}`;
      else if (file.mimeType === 'application/pdf') input += `\n【资料说明】所选PDF《${file.name}》未自动提取正文，不能从文件名推测正文事实；只使用用户确认的要点。`;
      if (input.length > 80000) throw Error('共用资料与确认事实合计超过8万字，请拆分制作单；未开始模型调用。');
    }
    return { workflow: { id: `business-${task.id}`, workspaceId: state.workspaceId, name: task.label, description: '业务制作单内的受控生产，不自动确认客户交付。', outputKind: task.kind, steps, updatedAt: new Date().toISOString() }, project, models: context.models, connections: context.connections, input, variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true, dispatchKey: task.dispatchKey };
  }
  async function saveDocument(order, task, run) {
    const generated = run.attempts.findLast(attempt => attempt.status === 'complete' && run.snapshot.steps.some(step => step.id === attempt.stepId && step.kind === 'text'));
    if (!generated?.summary) throw Error('模型没有返回完整文稿，原费用与已有产物保留。');
    let document = normalizeOfficeDocument(task.kind, generated.summary, `${order.name.slice(0, 85)} · ${task.kind.toUpperCase()}`);
    const illustrations = (await artifactStore.list(task.referenceArtifactIds || [])).filter(file => raster.has(file.mimeType));
    if (task.kind !== 'excel' && illustrations.length) document = composeDocumentImages(task.kind, document.title, JSON.stringify({ editorDocument: document }), illustrations);
    const store = task.kind === 'excel' ? spreadsheetStore : editorStore;
    if (!store) throw Error('当前桌面环境缺少对应的文档编辑模块。');
    const current = await store.load({ projectId: task.projectId, kind: task.kind, title: document.title });
    if (current && JSON.stringify(current.document) !== JSON.stringify(document)) throw Error('该子项目已有独立编辑内容，未覆盖人工稿；请采用已有导出文件，或重新准备独立的新稿。');
    const result = await store.export({ projectId: task.projectId, expectedRevision: current?.revision || 0, document, sourceArtifactIds: generated.artifacts?.map(file => file.id) || [] });
    return { artifacts: result.artifacts.filter(file => file.mimeType === MIME[task.kind]), record: result.record };
  }
  async function savePoster(order, state, task, run) {
    const background = run.attempts.filter(attempt => attempt.status === 'complete').flatMap(attempt => attempt.artifacts || []).find(file => file.kind === 'image');
    if (!background) throw Error('宣传图背景没有实际图片，未用文字稿冒充PNG。');
    const source = await artifactStore.read(background.id), { rasterDimensions } = require('./image-output-formats.cjs'), dimensions = rasterDimensions(source.buffer), target = order.sizes[0] || { width: 1024, height: 1024, label: '宣传图' };
    const scale = Math.max(target.width / dimensions.width, target.height / dimensions.height), make = (name, x, y, width, height) => ({ id: randomUUID(), name, x, y, width, height, opacity: 1, visible: true, locked: false });
    const layers = [{ ...make('AI概念背景', (target.width - dimensions.width * scale) / 2, (target.height - dimensions.height * scale) / 2, dimensions.width * scale, dimensions.height * scale), type: 'image', role: 'background', artifactId: background.id }];
    const photo = (await artifactStore.list(task.referenceArtifactIds || [])).find(file => raster.has(file.mimeType));
    if (photo) { const size = rasterDimensions((await artifactStore.read(photo.id)).buffer), ratio = Math.min(target.width * 0.72 / size.width, target.height * 0.64 / size.height); layers.push({ ...make('用户提供的真实图片', (target.width - size.width * ratio) / 2, target.height * 0.12, size.width * ratio, size.height * ratio), type: 'image', role: 'product', artifactId: photo.id }); }
    const brand = state.brands.find(item => item.id === order.brandId), text = [order.name, ...Object.entries(order.facts).slice(0, 3).map(([key, value]) => `${key}：${value}`)].join('\n');
    if (text.length > 250) throw Error('宣传图公开文字超过250字，请精简确认资料后本地排版，原背景已保存。');
    layers.push({ ...make('准确公开资料', target.width * 0.06, target.height * 0.77, target.width * 0.88, target.height * 0.20), type: 'text', text, fontSize: Math.max(12, Math.min(36, Math.floor(target.height * 0.032))), color: '#182230', fontFamily: brand?.font || 'Microsoft YaHei', fontWeight: 'bold', align: 'left' });
    if (brand?.logoArtifactId) { const logoId = (await copyReferences(state.workspaceId, [brand.logoArtifactId], task.projectId))[0], size = rasterDimensions((await artifactStore.read(logoId)).buffer), ratio = Math.min(target.width * 0.18 / size.width, target.height * 0.08 / size.height); layers.push({ ...make('客户Logo', target.width * 0.06, target.height * 0.03, size.width * ratio, size.height * ratio), type: 'image', role: 'logo', artifactId: logoId }); }
    return commerceImages.compose({ projectId: task.projectId, sourceArtifactId: background.id, layers, title: `${order.name.slice(0, 85)} · 配套宣传图`, sizes: order.sizes });
  }
  return { context, binding, sourceFiles, referenceFiles, copyReferences, documentReferenceIds, approvedBackgrounds, createProject, projectMetadata, request, saveDocument, savePoster };
}
module.exports = { nativeBusinessProjects, BUSINESS_OFFICE_MIME: MIME };
