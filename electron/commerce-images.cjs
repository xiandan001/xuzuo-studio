const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedCommerceDocument, commerceDocumentHash, checkedSize, validId, fonts } = require('./commerce-image-document.cjs');
const { createCommerceImageStore, active } = require('./commerce-image-store.cjs');
const { createCommerceRasterReader } = require('./commerce-image-raster.cjs');
const { createCommerceTextRenderer } = require('./commerce-text-renderer.cjs');
function createCommerceImages({ workspaceStorage, artifactStore, nativeImage, cpuTasks, BrowserWindow, renderTextLayer, onExport, onChanged, dialog, getWindow = () => undefined, store: providedStore }) {
  const store = providedStore || createCommerceImageStore({ workspaceStorage }), reader = createCommerceRasterReader({ artifactStore, nativeImage, cpuTasks });
  const textRenderer = !renderTextLayer && BrowserWindow ? createCommerceTextRenderer({ BrowserWindow }) : undefined;
  const renderText = renderTextLayer || (textRenderer && ((layer, options) => textRenderer.render(layer, options)));
  const jobs = new Set(); let closing = false, quiescing = false;
  function operation(input, callback) {
    if (!validId(input?.projectId) || closing || quiescing) return Promise.reject(Error('图层工作台正在关闭或项目无效。'));
    const controller = new AbortController(), job = { projectId: input.projectId, controller };
    const external = input.signal, forward = () => controller.abort(); if (external?.aborted) controller.abort(); else if (typeof external?.addEventListener === 'function') external.addEventListener('abort', forward, { once: true });
    const task = Promise.resolve().then(async () => { await workspaceStorage.projectDirectory(input.projectId); active(controller.signal); return callback(controller.signal); });
    job.task = task; jobs.add(job); void task.finally(() => { jobs.delete(job); external?.removeEventListener?.('abort', forward); }).catch(() => undefined); return task;
  }
  async function resolve(input, signal) {
    if (!validId(input?.sourceArtifactId)) throw Error('请先选择要编辑的本项目图片。');
    const link = await store.linked(input.projectId, input.sourceArtifactId); active(signal);
    if (!link || input.documentId) return { scope: await store.resolveScope(input) };
    const [snapshot, output] = await Promise.all([artifactStore.read(link.snapshotId), artifactStore.read(input.sourceArtifactId)]); active(signal);
    if (snapshot.projectId !== input.projectId || snapshot.mimeType !== 'application/json' || snapshot.buffer.length > 2 * 1024 * 1024 || output.projectId !== input.projectId || output.runId !== snapshot.runId) throw Error('这份成品的可编辑图层来源不一致，原成品保留。');
    let document; try { document = checkedCommerceDocument(JSON.parse(snapshot.buffer.toString('utf8'))); } catch { throw Error('可编辑图层快照不可读取，未将成品当作平面图覆盖。'); }
    if (document.projectId !== input.projectId) throw Error('图层快照不属于当前项目。');
    const workingId = input.fromSnapshot === true ? randomUUID() : link.workingDocumentId;
    return { scope: { projectId: input.projectId, sourceArtifactId: document.sourceArtifactId, documentId: workingId }, snapshot: { ...document, id: workingId, revision: 0 } };
  }
  async function read(input, signal) {
    const resolved = await resolve(input, signal), document = await store.read(resolved.scope) || resolved.snapshot, source = await reader.preview(input.projectId, resolved.scope.sourceArtifactId, signal), previews = { [source.id]: source.previewDataUrl };
    if (document && document.sourceSha256 !== source.sha256) throw Error('原图已经改变，当前工程保留，请将新图作为新原图导入。');
    const ids = [...new Set((document?.layers || []).filter(layer => layer.type === 'image').map(layer => layer.artifactId).concat(document?.protectedMaskArtifactId || [], document?.protectionSourceArtifactId || []))];
    for (const id of ids) if (!previews[id]) { try { previews[id] = (await reader.preview(input.projectId, id, signal)).previewDataUrl; } catch (error) { if (error.name === 'AbortError') throw error; } }
    const layout = value => JSON.stringify({ ...value, id: '', revision: 0, updatedAt: '' });
    const workingDiffersFromExport = Boolean(document && resolved.snapshot && layout(document) !== layout(resolved.snapshot));
    active(signal); return { ...resolved.scope, document, source, previews, ...(workingDiffersFromExport ? { workingDiffersFromExport: true } : {}) };
  }
  async function save(input, signal) {
    const document = checkedCommerceDocument(input.document), scope = await store.resolveScope(input), source = await reader.info(input.projectId, document.sourceArtifactId, signal);
    if (document.sourceArtifactId !== scope.sourceArtifactId || document.id !== scope.documentId || document.sourceSha256 !== source.sha256) throw Error('图层原图、工程或保存版本不匹配。');
    for (const layer of document.layers) if (layer.type === 'image') await reader.info(input.projectId, layer.artifactId, signal);
    if (document.protectedMaskArtifactId) { const baseline = document.protectionSourceArtifactId ? await reader.info(input.projectId, document.protectionSourceArtifactId, signal) : source; if (document.width !== baseline.width || document.height !== baseline.height) throw Error('使用精确保护区时，需要保持保护基准画布尺寸。'); await reader.info(input.projectId, document.protectedMaskArtifactId, signal); }
    active(signal); return store.save({ ...scope, expectedRevision: input.expectedRevision, document }, signal);
  }
  async function applyAlpha(input, signal) {
    const [source, alpha] = await Promise.all([reader.read(input.projectId, input.sourceArtifactId, signal), reader.read(input.projectId, input.alphaArtifactId, signal)]);
    const result = await cpuTasks.run('commerce-alpha', { source: source.payload, alpha: alpha.payload }, { signal }); active(signal);
    const current = await reader.read(input.projectId, input.sourceArtifactId, signal); if (current.sha256 !== source.sha256) throw Error('原图已变化，未保存迟到的主体结果。');
    const artifact = await artifactStore.write({ projectId: input.projectId, name: '保真主体-原图RGB.png', mimeType: 'image/png', buffer: Buffer.from(result.buffer), signal }); onChanged?.(input.projectId);
    return { artifact, width: result.width, height: result.height, sourceSha256: source.sha256 };
  }
  async function protect(input, signal) {
    const source = await reader.read(input.projectId, input.sourceArtifactId, signal), edited = await reader.read(input.projectId, input.editedArtifactId, signal), mask = await reader.read(input.projectId, input.maskArtifactId, signal);
    const result = await cpuTasks.run('commerce-protect', { source: source.payload, edited: edited.payload, mask: mask.payload }, { signal }); active(signal);
    if ((await reader.read(input.projectId, input.sourceArtifactId, signal)).sha256 !== source.sha256) throw Error('原图已变化，未保存迟到的保护结果。');
    const artifact = await artifactStore.write({ projectId: input.projectId, name: '保护区合成-未修改区原像素.png', mimeType: 'image/png', buffer: Buffer.from(result.buffer), signal }); onChanged?.(input.projectId);
    return { artifact, width: result.width, height: result.height, protectedPixelsVerified: true };
  }
  async function renderDocument(document, sizes, signal, { ensureCurrent, runId = randomUUID() } = {}) {
    document = checkedCommerceDocument(document); if (document.revision < 1) throw Error('请先保存图层工程后导出。');
    if (typeof onExport !== 'function') throw Error('当前后台尚未接通图层成果登记，请更新桌面应用。');
    sizes = sizes?.length ? sizes : [{ width: document.width, height: document.height, label: '原尺寸' }];
    if (!Array.isArray(sizes) || sizes.length > 10 || sizes.reduce((sum, value) => { const size = checkedSize(value); return sum + size.width * size.height; }, 0) > 48000000) throw Error('一次最多导出10个尺寸，合计不超过4800万像素。');
    const source = await reader.read(document.projectId, document.sourceArtifactId, signal); if (source.sha256 !== document.sourceSha256) throw Error('原图已改变，请重新读取工程。');
    const layers = []; let pixels = 0;
    for (const layer of document.layers) {
      if (!layer.visible || !layer.opacity) continue;
      let payload;
      if (layer.type === 'image') { const image = await reader.read(document.projectId, layer.artifactId, signal); pixels += image.width * image.height; payload = image.payload; }
      else { if (!renderText) throw Error('当前环境不支持准确文字排版，请使用新版桌面应用。'); const png = await renderText(layer, { signal }); payload = { buffer: Buffer.from(png) }; pixels += Math.ceil(layer.width) * Math.ceil(layer.height); }
      if (pixels > 32000000) throw Error('图层图片合计超过3200万像素，请缩小或减少图层。');
      layers.push({ ...layer, source: payload });
    }
    const protection = document.protectedMaskArtifactId ? { source: document.protectionSourceArtifactId ? (await reader.read(document.projectId, document.protectionSourceArtifactId, signal)).payload : source.payload, mask: (await reader.read(document.projectId, document.protectedMaskArtifactId, signal)).payload } : undefined;
    const artifacts = [], sourceHash = commerceDocumentHash(document);
    const current = async () => { active(signal); if (ensureCurrent) await ensureCurrent(); if ((await reader.read(document.projectId, document.sourceArtifactId, signal)).sha256 !== source.sha256) throw Error('制作期间原图已变化，已生成文件保留。'); };
    try {
      await current(); const json = await artifactStore.write({ projectId: document.projectId, runId, name: `${document.title}-可编辑图层.json`, mimeType: 'application/json', text: JSON.stringify(document, null, 2) + '\n', signal }); artifacts.push(json);
      let protectedPixelsVerified = false;
      for (const size of sizes) {
        await current(); const output = await cpuTasks.run('commerce-compose', { width: document.width, height: document.height, background: document.background, layers, protection, target: checkedSize(size) }, { signal }); await current();
        const artifact = await artifactStore.write({ projectId: document.projectId, runId, name: `${document.title}-${String(size.label || '成品').slice(0, 30)}-${size.width}x${size.height}.png`, mimeType: 'image/png', buffer: Buffer.from(output.buffer), signal }); artifacts.push(artifact);
        await store.link(document.projectId, artifact.id, json.id); protectedPixelsVerified ||= Boolean(output.protectedPixelsVerified); onChanged?.(document.projectId);
      }
      await current(); const commerceExport = { documentId: document.id, revision: document.revision, sourceArtifactId: json.id, documentSha256: sourceHash, originalSourceArtifactId: document.sourceArtifactId, originalSourceSha256: source.sha256, protectedPixelsVerified, sizes: sizes.map(size => ({ ...checkedSize(size) })) };
      await onExport({ projectId: document.projectId, runId, document, artifacts, commerceExport }); return { artifacts, sourceRevision: document.revision, documentId: document.id, runId };
    } catch (error) { error.artifacts = artifacts; throw error; }
  }
  async function render(input, signal) {
    const scope = await store.resolveScope(input), document = await store.read(scope); if (!document || document.revision !== input.expectedRevision) throw Error('请先保存当前工程后导出，未用旧版本覆盖。');
    const captured = commerceDocumentHash(document); return renderDocument(document, input.sizes, signal, { ensureCurrent: async () => { const latest = await store.read(scope); if (!latest || commerceDocumentHash(latest) !== captured) throw Error('导出时工程已变化，之前文件保留，请重新导出。'); } });
  }
  async function compose(input, signal) {
    const source = await reader.read(input.projectId, input.sourceArtifactId, signal), target = checkedSize(input.sizes?.[0] || { width: 1024, height: 1024 }), id = randomUUID();
    const layers = [], base = (name, x, y, width, height) => ({ id: randomUUID(), name, x, y, width, height, opacity: 1, visible: true, locked: false });
    if (input.backgroundArtifactId) { const background = await reader.read(input.projectId, input.backgroundArtifactId, signal), scale = Math.max(target.width / background.width, target.height / background.height); layers.push({ ...base('背景', (target.width - background.width * scale) / 2, (target.height - background.height * scale) / 2, background.width * scale, background.height * scale), type: 'image', role: 'background', artifactId: background.id }); }
    const product = input.alphaArtifactId ? (await applyAlpha(input, signal)).artifact : { id: source.id };
    const scale = Math.min(target.width * .82 / source.width, target.height * (input.text ? .7 : .86) / source.height), width = source.width * scale, height = source.height * scale;
    layers.push({ ...base('原图商品主体', (target.width - width) / 2, Math.max(target.height * .08, (target.height * .82 - height) / 2), width, height), type: 'image', role: 'product', artifactId: product.id });
    if (input.logoArtifactId) { const logo = await reader.read(input.projectId, input.logoArtifactId, signal), scale = Math.min(target.width * .2 / logo.width, target.height * .12 / logo.height); layers.push({ ...base('品牌Logo', target.width * .04, target.height * .04, logo.width * scale, logo.height * scale), type: 'image', role: 'logo', artifactId: logo.id }); }
    const aliases = { '微软雅黑': 'Microsoft YaHei', '宋体': 'SimSun', '无衬线字体': 'sans-serif' }, fontFamily = aliases[input.fontFamily] || input.fontFamily || 'Microsoft YaHei';
    if (!fonts.includes(fontFamily) || input.textColor && !/^#[a-f0-9]{6}$/i.test(input.textColor)) throw Error('请选择可用的微软雅黑、宋体、Arial或无衬线字体，以及#RRGGBB品牌色。');
    if (input.text) {
      const text = String(input.text), boxWidth = target.width * .9, boxHeight = target.height * .14;
      let fontSize = Math.max(6, Math.round(target.width * .032));
      const estimatedLines = size => text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).reduce((weight, character) => weight + (character.codePointAt(0) >= 0x2e80 ? 1.05 : .68), 0) * size / (boxWidth * .94))), 0);
      while (fontSize > 6 && estimatedLines(fontSize) * fontSize * 1.25 > boxHeight * .94) fontSize--;
      layers.push({ ...base('卖点与价格', target.width * .05, target.height * .83, boxWidth, boxHeight), type: 'text', text, fontSize, fontFamily, fontWeight: 'bold', color: input.textColor || '#17212B', align: 'center' });
    }
    const document = checkedCommerceDocument({ type: 'xuzuo-commerce-image', version: 1, id, projectId: input.projectId, sourceArtifactId: source.id, sourceSha256: source.sha256, revision: 1, title: String(input.title || '商品上新成品').slice(0, 120), ...target, background: input.background || '#FFFFFF', layers: input.layers || layers, updatedAt: new Date().toISOString() });
    return renderDocument(document, input.sizes, signal, { runId: input.runId || randomUUID() });
  }
  async function mask(input, signal) {
    await reader.read(input.projectId, input.sourceArtifactId, signal);
    if (typeof input.dataUrl !== 'string' || input.dataUrl.length > 3 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)) throw Error('请选择有效的本地PNG蒙版。');
    const buffer = Buffer.from(input.dataUrl.split(',')[1], 'base64'), size = require('./image-reference-normalization.cjs').readRasterReferenceSize(buffer);
    if (size.width > 1024 || size.height > 1024) throw Error('手工蒙版代理图每边最多1024像素。');
    await cpuTasks.run('commerce-preview', { buffer }, { signal }); active(signal); const artifact = await artifactStore.write({ projectId: input.projectId, name: '商品编辑区域蒙版.png', mimeType: 'image/png', buffer, signal }); onChanged?.(input.projectId); return artifact;
  }
  async function exportRecovery(input) {
    const document = checkedCommerceDocument(input.document); if (document.projectId !== input.projectId || !dialog) throw Error('当前环境无法选择恢复位置。');
    const result = await dialog.showSaveDialog(getWindow(), { title: '保存图层恢复JSON', defaultPath: `图层恢复-${Date.now()}.json`, filters: [{ name: 'JSON工程', extensions: ['json'] }] }); if (result.canceled || !result.filePath) return { saved: false };
    const filename = path.resolve(result.filePath); if (!path.isAbsolute(result.filePath) || filename.split(/[\\/]/).some(part => part === '.xuzuo') || path.extname(filename).toLowerCase() !== '.json') throw Error('请选择普通目录中的JSON文件。');
    const handle = await fs.open(filename, 'wx'); try { await handle.writeFile(JSON.stringify(document, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); } return { saved: true };
  }
  const service = {
    read: input => operation(input, signal => read(input, signal)), save: input => operation(input, signal => save(input, signal)), render: input => operation(input, signal => render(input, signal)),
    applyAlpha: input => operation(input, signal => applyAlpha(input, signal)), protect: input => operation(input, signal => protect(input, signal)), mask: input => operation(input, signal => mask(input, signal)),
    compose: input => operation(input, signal => compose(input, signal)),
    rasterPreview: input => operation(input, async signal => {
      const file = await artifactStore.read(input.artifactId); active(signal);
      if (file.projectId !== input.projectId || file.kind !== 'image' || file.trashedAt || file.unavailable) throw Error('上架预览图片不属于当前项目。');
      if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) { const source = await reader.read(input.projectId, file.id, signal), output = await cpuTasks.run('commerce-preview', { ...source.payload, maxSide: 1280 }, { signal }); active(signal); return { buffer: Buffer.from(output.buffer), width: source.width, height: source.height }; }
      if (!['image/gif', 'image/svg+xml'].includes(file.mimeType) || !textRenderer) throw Error('当前环境不能生成该图片的静态样张。');
      require('./image-output-formats.cjs').imageType(file.buffer); const size = require('./image-output-formats.cjs').rasterDimensions(file.buffer), scale = Math.min(1, 1280 / size.width, 1280 / size.height), width = Math.max(8, Math.round(size.width * scale)), height = Math.max(8, Math.round(size.height * scale));
      const buffer = await textRenderer.renderImage({ width, height, imageDataUrl: `data:${file.mimeType};base64,${file.buffer.toString('base64')}` }, { signal }); active(signal); return { buffer, width: size.width, height: size.height };
    }),
    history: input => operation(input, () => store.history(input)), restore: input => operation(input, signal => store.restore(input, signal)), exportRecovery,
    async cancel(input) { if (!validId(input?.projectId)) throw Error('项目编号无效。'); const selected = [...jobs].filter(job => job.projectId === input.projectId); for (const job of selected) job.controller.abort(); await Promise.allSettled(selected.map(job => job.task)); },
    async drain() { while (jobs.size) await Promise.allSettled([...jobs].map(job => job.task)); await store.drain(); await textRenderer?.drain(); },
    async prepareClose() { quiescing = true; try { for (const job of jobs) job.controller.abort(); await service.drain(); } finally { quiescing = false; } },
    async shutdown() { closing = true; for (const job of jobs) job.controller.abort(); await service.drain(); await textRenderer?.shutdown(); },
  };
  return service;
}
module.exports = { createCommerceImages };
