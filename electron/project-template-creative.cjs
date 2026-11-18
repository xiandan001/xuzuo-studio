const { randomUUID, createHash } = require('node:crypto');
const { checkedCommerceDocument } = require('./commerce-image-document.cjs');
const { defaultDocumentId } = require('./commerce-image-store.cjs');
const animation = require('./animation-document.runtime.cjs');
const { imageType } = require('./image-output-formats.cjs');
const { TEMPLATE_PLACEHOLDER_NAME } = require('./template-material.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_CREATIVE_MATERIALS = 200;
function placeholder(loadModule) { const { PNG } = loadModule('pngjs'), image = new PNG({ width: 1, height: 1 }); image.data.fill(0); return PNG.sync.write(image); }
function references(creative) {
  const doc = creative.document;
  return [...new Set(creative.kind === 'commerce' ? [doc.sourceArtifactId, ...doc.layers.filter(layer => layer.type === 'image').flatMap(layer => [layer.artifactId, ...(layer.originalArtifactId ? [layer.originalArtifactId] : [])]), ...(doc.protectedMaskArtifactId ? [doc.protectedMaskArtifactId] : []), ...(doc.protectionSourceArtifactId ? [doc.protectionSourceArtifactId] : [])] : [...doc.referenceArtifactIds, ...doc.entries.flatMap(entry => entry.frames.map(frame => frame.atlasArtifactId))])];
}
function checkedCreative(value, materialIds) {
  if (!value || value.version !== 1 || !['commerce', 'animation'].includes(value.kind) || Object.keys(value).some(key => !['version', 'kind', 'document'].includes(key))) throw Error('可编辑模板工程无效。');
  const document = value.kind === 'commerce' ? checkedCommerceDocument(value.document) : animation.checkedAnimationDocument(value.document);
  if (document.projectId !== 'template-project' || document.revision !== 0 || value.kind === 'animation' && (document.modelConfigId || document.credentialId || document.acceptedSampleId || document.entries.some(entry => entry.outputArtifactId || entry.coverArtifactId || entry.sourceHash || entry.renderedHash || entry.inspection || entry.error))) throw Error('模板不能带入原工程的账户、产物回执或历史状态。');
  const result = { version: 1, kind: value.kind, document };
  if (materialIds && references(result).some(id => !materialIds.has(id))) throw Error('可编辑模板有未登记的配图引用。');
  return result;
}
function remapCreative(value, ids, { projectId = 'template-project', name, freshIds = false, revision = 0 } = {}) {
  const doc = structuredClone(value.document), map = id => { const next = ids.get(id); if (!next) throw Error('可编辑模板的配图未复制完成。'); return next; };
  doc.projectId = projectId; doc.revision = revision; if (name) doc.title = name.slice(0, value.kind === 'commerce' ? 120 : 160); doc.updatedAt = new Date().toISOString();
  if (value.kind === 'commerce') {
    if (freshIds) doc.id = randomUUID();
    doc.sourceArtifactId = map(doc.sourceArtifactId);
    doc.layers = doc.layers.map(layer => ({ ...layer, ...(freshIds ? { id: randomUUID() } : {}), ...(layer.type === 'image' ? { artifactId: map(layer.artifactId), ...(layer.originalArtifactId ? { originalArtifactId: map(layer.originalArtifactId) } : {}) } : {}) }));
    if (doc.protectedMaskArtifactId) doc.protectedMaskArtifactId = map(doc.protectedMaskArtifactId);
    if (doc.protectionSourceArtifactId) doc.protectionSourceArtifactId = map(doc.protectionSourceArtifactId);
    return { version: 1, kind: value.kind, document: checkedCommerceDocument(doc) };
  }
  doc.referenceArtifactIds = doc.referenceArtifactIds.map(map); doc.modelConfigId = ''; doc.credentialId = ''; delete doc.acceptedSampleId;
  doc.entries = doc.entries.map(entry => ({ id: freshIds ? randomUUID() : entry.id, caption: entry.caption, description: entry.description, motion: entry.motion, frames: entry.frames.map(frame => ({ ...frame, ...(freshIds ? { id: randomUUID() } : {}), atlasArtifactId: map(frame.atlasArtifactId) })), status: entry.frames.length ? 'stale' : 'draft' }));
  return { version: 1, kind: value.kind, document: animation.checkedAnimationDocument(doc, projectId) };
}
async function prepareCreative(input, retain, { artifactStore, commerceImages, animationStore, loadModule = require }) {
  const selected = input.creativeSource;
  if (!selected || !['commerce', 'animation'].includes(selected.kind) || input.kind !== 'image' || Object.keys(selected).some(key => !['kind', 'documentId'].includes(key))) throw Error('请选择有效的可编辑模板来源。');
  let document;
  if (selected.kind === 'commerce') {
    const service = typeof commerceImages === 'function' ? commerceImages() : commerceImages;
    if (!service?.templateSource || !input.sourceArtifactId) throw Error('请选择已保存过图层的图片，再存为可编辑海报模板。');
    document = await service.templateSource({ projectId: input.sourceProjectId, sourceArtifactId: input.sourceArtifactId, ...(selected.documentId ? { documentId: selected.documentId } : {}) });
    if (!document) throw Error('这张图片没有已保存的图层工程，不能把平面图冒充可编辑模板。');
    document = checkedCommerceDocument(document);
  } else {
    if (!animationStore?.read) throw Error('请更新桌面应用后保存角色动画模板。');
    document = animation.checkedAnimationDocument(await animationStore.read({ projectId: input.sourceProjectId }), input.sourceProjectId);
    if (document.revision < 1) throw Error('请先保存角色图集或动画工程。');
  }
  const sourceRevision = Math.max(1, document.revision), original = { version: 1, kind: selected.kind, document }, needed = references(original);
  if (needed.length > MAX_CREATIVE_MATERIALS) throw Error('一份可编辑模板最多200张配图，请分成较小的模板。');
  const ids = new Map(), materials = [], blank = retain.assets ? undefined : placeholder(loadModule); let total = 0;
  for (const oldId of needed) {
    const file = await artifactStore.read(oldId);
    if (file.projectId !== input.sourceProjectId || file.trashedAt || file.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || !file.buffer?.length || file.buffer.length > 32 * 1024 * 1024) throw Error('可编辑模板配图必须是当前项目32MB以内的静态图片。');
    if (imageType(file.buffer).mimeType !== file.mimeType) throw Error('模板配图的真实格式与记录不一致。');
    const id = 'material-' + digest(oldId).slice(0, 32), buffer = retain.assets ? file.buffer : blank;
    if ((total += buffer.length) > 80 * 1024 * 1024) throw Error('可编辑模板配图合计最多80MB。');
    const mimeType = retain.assets ? file.mimeType : 'image/png', extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
    ids.set(oldId, id); materials.push({ id, name: `${retain.assets ? '模板配图-' : TEMPLATE_PLACEHOLDER_NAME}${materials.length + 1}.${extension}`, mimeType, bytes: buffer.length, sha256: digest(buffer), ...(retain.assets && file.provenance ? { provenance: file.provenance } : {}), buffer });
    if (selected.kind === 'commerce' && oldId === document.sourceArtifactId && retain.assets && digest(file.buffer) !== document.sourceSha256) throw Error('海报原图已改变，未保存不一致的模板。');
  }
  document.title = input.name; document.projectId = 'template-project'; document.revision = 0; document.updatedAt = '2000-01-01T00:00:00.000Z';
  if (selected.kind === 'commerce') {
    document.id = 'template-layout';
    document.sourceSha256 = materials.find(file => file.id === ids.get(document.sourceArtifactId)).sha256;
    document.layers = document.layers.map((layer, index) => ({ ...layer, id: `layer-${index + 1}`, name: retain.content ? layer.name : layer.type === 'text' ? `文案 ${index + 1}` : layer.role === 'product' ? '商品主体' : layer.role === 'logo' ? 'Logo' : `背景 ${index + 1}`, ...(layer.type === 'image' && !retain.assets ? { templatePlaceholder: true } : {}), ...(layer.type === 'text' && !retain.content ? { text: '填写本次文案' } : {}) }));
    if (!retain.assets) { delete document.protectedMaskArtifactId; delete document.protectionSourceArtifactId; }
  } else {
    document.prompt = retain.content ? document.prompt : ''; document.modelConfigId = ''; document.credentialId = ''; delete document.acceptedSampleId;
    document.entries = document.entries.map((entry, index) => ({ id: `entry-${index + 1}`, caption: retain.content ? entry.caption : '', description: retain.content ? entry.description : '', motion: entry.motion, frames: entry.frames.map((frame, frameIndex) => ({ id: `frame-${frameIndex + 1}`, atlasArtifactId: frame.atlasArtifactId, durationMs: frame.durationMs, cell: frame.cell, grid: frame.grid, ...(frame.crop ? { crop: frame.crop } : {}), ...(frame.templatePlaceholder || !retain.assets ? { templatePlaceholder: true } : {}) })), status: entry.frames.length ? 'stale' : 'draft' }));
    if (!retain.assets) document.referenceArtifactIds = [];
  }
  const creative = remapCreative({ version: 1, kind: selected.kind, document }, ids, { name: input.name }); creative.document.updatedAt = '2000-01-01T00:00:00.000Z';
  const used = new Set(references(creative)), selectedMaterials = materials.filter(file => used.has(file.id));
  return { creative: checkedCreative(creative, new Set(selectedMaterials.map(file => file.id))), materials: selectedMaterials, sourceRevision, imageSettings: { width: document.width, height: document.height, mimeType: 'image/png' } };
}
function creativeInfo(value) { return value?.creative ? { creativeKind: value.creative.kind, ...(value.creative.kind === 'animation' ? { animationMode: value.creative.document.mode } : {}) } : {}; }
function withoutSaveMetadata(document) { const value = structuredClone(document); delete value.revision; delete value.updatedAt; return JSON.stringify(value); }
async function instantiateCreative(prepared, receipt, ids, input, { commerceImages, animationStore, saveReceipt }) {
  let creative = receipt.creative || remapCreative(prepared.creative, ids, { projectId: input.targetProjectId, name: input.name, freshIds: true });
  if (!receipt.creative && creative.kind === 'commerce') creative.document.id = defaultDocumentId(creative.document.sourceArtifactId);
  if (!receipt.creative) { receipt.creative = creative; await saveReceipt(); }
  const document = creative.kind === 'commerce' ? checkedCommerceDocument(creative.document) : animation.checkedAnimationDocument(creative.document, input.targetProjectId);
  if (document.projectId !== input.targetProjectId || references(creative).some(id => ![...ids.values()].includes(id)) || creative.kind === 'animation' && (document.modelConfigId || document.credentialId)) throw Error('新模板工程来源不一致，当前项目保留。');
  let existing;
  if (creative.kind === 'commerce') {
    const service = typeof commerceImages === 'function' ? commerceImages() : commerceImages;
    if (!service?.templateSource || !service.save) throw Error('图层模板保存服务尚未就绪。');
    const scope = { projectId: input.targetProjectId, sourceArtifactId: document.sourceArtifactId, documentId: document.id };
    existing = await service.templateSource(scope);
    if (existing && withoutSaveMetadata(existing) !== withoutSaveMetadata(document)) throw Error('新海报已有修改，未用模板覆盖当前稿。');
    creative = { ...creative, document: existing || await service.save({ ...scope, expectedRevision: 0, document }) };
  } else {
    if (!animationStore?.read || !animationStore.save) throw Error('角色模板保存服务尚未就绪。');
    existing = await animationStore.read({ projectId: input.targetProjectId });
    if (existing.revision > 0 && withoutSaveMetadata(existing) !== withoutSaveMetadata(document)) throw Error('新动画已有修改，未用模板覆盖当前稿。');
    creative = { ...creative, document: existing.revision > 0 ? existing : await animationStore.save({ projectId: input.targetProjectId, expectedRevision: 0, document, label: '从可编辑模板创建' }) };
  }
  receipt.creative = creative; await saveReceipt();
  return creative.kind === 'commerce' ? { kind: 'commerce', sourceArtifactId: creative.document.sourceArtifactId, documentId: creative.document.id } : { kind: 'animation', mode: creative.document.mode };
}
module.exports = { MAX_CREATIVE_MATERIALS, references, checkedCreative, remapCreative, prepareCreative, creativeInfo, instantiateCreative };
