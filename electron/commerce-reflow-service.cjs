const { randomUUID } = require('node:crypto');
const { commerceDocumentHash, validId } = require('./commerce-image-document.cjs');
const { reflowCommerceDocument, checkedReflowTargets } = require('./commerce-reflow.cjs');
const { active } = require('./commerce-image-store.cjs');
function createCommerceReflow({ store, reader, artifactStore, cpuTasks, renderText, saveDocument, renderDocument }) {
  const previews = new Map();
  const clearExpired = () => { for (const [id, value] of previews) if (Date.now() - value.createdAt > 10 * 60 * 1000) previews.delete(id); };
  async function current(input) {
    const scope = await store.resolveScope(input), document = await store.read(scope);
    if (!document || document.revision !== input.expectedRevision || !document.layers.length) throw Error('请先保存真实图层工程，再按比例重排；平面图片可先建立文字与主体图层。');
    if (document.layers.filter(layer => layer.visible && layer.opacity > 0).length < 2) throw Error('当前只有一张平面图片，请先加入独立文字、Logo或背景图层；内部画面不会自动拆层。只改像素尺寸可使用原导出选项。');
    if (document.layers.some(layer => layer.type === 'image' && layer.visible && layer.opacity > 0 && layer.templatePlaceholder)) throw Error('请先替换模板中的透明占位图片，再预览成品版式。');
    return { scope, document, hash: commerceDocumentHash(document) };
  }
  async function preview(input, signal) {
    if (!validId(input.requestId)) throw Error('重排预览编号无效。');
    const original = await current(input), targets = checkedReflowTargets(input.targets), images = new Map(), fingerprints = new Map(); let pixels = 0;
    const used = new Set([original.document.sourceArtifactId, ...original.document.layers.filter(layer => layer.type === 'image' && layer.visible && layer.opacity > 0).map(layer => layer.artifactId)]);
    for (const id of used) { const info = await reader.info(input.projectId, id, signal); if ((pixels += info.width * info.height) > 32000000) throw Error('重排输入合计超过3200万像素，请减少可见图片后重试。'); const file = await reader.read(input.projectId, id, signal); images.set(id, file); fingerprints.set(id, file.sha256); }
    if (images.get(original.document.sourceArtifactId).sha256 !== original.document.sourceSha256) throw Error('原图已改变，未生成不一致预览。');
    const results = [];
    for (const target of targets) {
      active(signal); const layout = reflowCommerceDocument(original.document, target), scale = Math.min(1, 960 / target.width, 960 / target.height), width = Math.max(8, Math.round(target.width * scale)), height = Math.max(8, Math.round(target.height * scale)), layers = [];
      for (const layer of layout.document.layers) {
        if (!layer.visible || !layer.opacity) continue;
        const scaled = { ...layer, x: layer.x * scale, y: layer.y * scale, width: Math.max(1, layer.width * scale), height: Math.max(1, layer.height * scale), ...(layer.type === 'text' ? { fontSize: layer.fontSize * scale } : {}) };
        if (layer.type === 'image') layers.push({ ...scaled, source: images.get(layer.artifactId).payload });
        else { if (!renderText) throw Error('当前环境尚未接通准确文字预览。'); layers.push({ ...scaled, source: { buffer: Buffer.from(await renderText(scaled, { signal })) } }); }
      }
      const image = await cpuTasks.run('commerce-compose', { width, height, background: layout.document.background, layers }, { signal, priority: 'interactive' }); active(signal);
      const buffer = Buffer.from(image.buffer); if (buffer.length > 4 * 1024 * 1024) throw Error('重排预览过大，请减少图层后重试。');
      results.push({ id: randomUUID(), ...target, document: layout.document, previewDataUrl: 'data:image/png;base64,' + buffer.toString('base64'), warnings: layout.warnings });
    }
    if ((await current(input)).hash !== original.hash) throw Error('预览期间原稿已改变，请重新预览；没有改动原稿。');
    clearExpired(); while (previews.size >= 4) previews.delete(previews.keys().next().value);
    const previewId = randomUUID(); previews.set(previewId, { createdAt: Date.now(), projectId: input.projectId, original, targets: results.map(target => ({ id: target.id, width: target.width, height: target.height, label: target.label, document: structuredClone(target.document), warnings: [...target.warnings] })), fingerprints, completed: new Map() });
    return { previewId, sourceRevision: original.document.revision, targets: results };
  }
  async function exportReviewed(input, signal) {
    clearExpired(); const record = previews.get(input.previewId);
    if (!record || record.projectId !== input.projectId || (await current(input)).hash !== record.original.hash) throw Error('重排预览已过期或原稿改变，请重新预览确认。');
    const approved = input.approvedTargetIds;
    if (!Array.isArray(approved) || approved.length !== record.targets.length || new Set(approved).size !== approved.length || record.targets.some(target => !approved.includes(target.id))) throw Error('请逐一检查并确认全部目标版式后再导出。');
    if (record.running) return record.running;
    const run = async () => {
      for (const [id, expected] of record.fingerprints) if ((await reader.read(input.projectId, id, signal)).sha256 !== expected) throw Error('预览后配图已改变，请重新预览确认，未改动原稿。');
      for (const completed of record.completed.values()) for (const artifact of completed.artifacts) { const file = await artifactStore.read(artifact.id); if (file.projectId !== input.projectId || file.trashedAt || file.unavailable) throw Error('已导出的目标文件不再可用，请恢复文件或重新预览，不会自动补写。'); }
      for (const target of record.targets) {
        if (record.completed.has(target.id)) continue;
        active(signal); if ((await current(input)).hash !== record.original.hash) throw Error('导出期间原稿改变，已完成的新版本保留。');
        const scope = { projectId: input.projectId, sourceArtifactId: target.document.sourceArtifactId, documentId: target.document.id }, previous = await store.read(scope);
        if (previous && commerceDocumentHash({ ...previous, revision: 0, updatedAt: target.document.updatedAt }) !== commerceDocumentHash(target.document)) throw Error('目标版式已有人工修改，未覆盖当前稿。');
        const saved = previous || await saveDocument({ ...scope, expectedRevision: 0, document: target.document }, signal);
        const result = await renderDocument(saved, [{ width: target.width, height: target.height, label: target.label }], signal, { expectedAssets: record.fingerprints, ensureCurrent: async () => { if ((await current(input)).hash !== record.original.hash) throw Error('导出期间原稿改变，之前文件保留。'); } });
        record.completed.set(target.id, { targetId: target.id, width: target.width, height: target.height, ...result });
      }
      const results = record.targets.map(target => record.completed.get(target.id)), artifacts = results.flatMap(result => result.artifacts);
      return { artifacts, sourceRevision: record.original.document.revision, documentId: results[0].documentId, runId: results[0].runId, variants: results.map(result => ({ targetId: result.targetId, documentId: result.documentId, width: result.width, height: result.height, artifactIds: result.artifacts.map(file => file.id) })) };
    };
    record.running = run(); try { return await record.running; } finally { delete record.running; }
  }
  return { preview, exportReviewed, clear: () => previews.clear() };
}
module.exports = { createCommerceReflow };
