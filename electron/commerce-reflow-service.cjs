const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { commerceDocumentHash, validId } = require('./commerce-image-document.cjs');
const { reflowCommerceDocument, checkedReflowTargets } = require('./commerce-reflow.cjs');
const { active } = require('./commerce-image-store.cjs');
const { createReflowJobStore } = require('./commerce-reflow-jobs.cjs');
const runningScopes = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plainLayout = (document, at) => commerceDocumentHash({ ...document, revision: 0, updatedAt: at });
function createCommerceReflow({ store, reader, artifactStore, cpuTasks, renderText, workspaceStorage, saveDocument, renderDocument }) {
  const previews = new Map(), jobs = createReflowJobStore({ workspaceStorage });
  const clearExpired = () => { for (const [id, value] of previews) if (Date.now() - value.createdAt > 10 * 60 * 1000) previews.delete(id); };
  async function current(input) {
    const scope = await store.resolveScope(input), document = await store.read(scope);
    if (!document || document.revision !== input.expectedRevision || !document.layers.length) throw Error('请先保存真实图层工程，再按比例重排；平面图片可先建立文字与主体图层。');
    if (document.layers.filter(layer => layer.visible && layer.opacity > 0).length < 2) throw Error('当前只有一张平面图片，请先加入独立文字、Logo或背景图层；内部画面不会自动拆层。只改像素尺寸可使用原导出选项。');
    if (document.layers.some(layer => layer.type === 'image' && layer.visible && layer.opacity > 0 && layer.templatePlaceholder)) throw Error('请先替换模板中的透明占位图片，再预览成品版式。');
    return { scope, document, hash: commerceDocumentHash(document) };
  }
  async function sourceImages(original, fingerprints, signal, retainPixels = true) {
    const images = retainPixels ? new Map() : undefined; let pixels = 0, originalHash;
    const used = new Set([original.document.sourceArtifactId, ...original.document.layers.filter(layer => layer.type === 'image' && layer.visible && layer.opacity > 0).map(layer => layer.artifactId)]);
    for (const id of used) {
      const info = await reader.info(original.document.projectId, id, signal); if ((pixels += info.width * info.height) > 32000000) throw Error('重排输入合计超过3200万像素，请减少可见图片后重试。');
      const file = await reader.read(original.document.projectId, id, signal); if (fingerprints?.has(id) && fingerprints.get(id) !== file.sha256) throw Error('预览或导出后配图已改变，请重新预览确认；原稿和已完成文件保留。'); images?.set(id, file); if (id === original.document.sourceArtifactId) originalHash = file.sha256;
    }
    if (originalHash !== original.document.sourceSha256) throw Error('原图已改变，未生成不一致预览。');
    return images;
  }
  async function previewTargets(targets, images, signal) {
    const results = [];
    for (const target of targets) {
      active(signal); const scale = Math.min(1, 960 / target.width, 960 / target.height), width = Math.max(8, Math.round(target.width * scale)), height = Math.max(8, Math.round(target.height * scale)), layers = [];
      for (const layer of target.document.layers) {
        if (!layer.visible || !layer.opacity) continue;
        const scaled = { ...layer, x: layer.x * scale, y: layer.y * scale, width: Math.max(1, layer.width * scale), height: Math.max(1, layer.height * scale), ...(layer.type === 'text' ? { fontSize: layer.fontSize * scale } : {}) };
        if (layer.type === 'image') layers.push({ ...scaled, source: images.get(layer.artifactId).payload });
        else { if (!renderText) throw Error('当前环境尚未接通准确文字预览。'); layers.push({ ...scaled, source: { buffer: Buffer.from(await renderText(scaled, { signal })) } }); }
      }
      const image = await cpuTasks.run('commerce-compose', { width, height, background: target.document.background, layers }, { signal, priority: 'interactive' }); active(signal);
      const buffer = Buffer.from(image.buffer); if (buffer.length > 4 * 1024 * 1024) throw Error('重排预览过大，请减少图层后重试。');
      results.push({ id: target.id, width: target.width, height: target.height, label: target.label, document: target.document, previewDataUrl: 'data:image/png;base64,' + buffer.toString('base64'), warnings: target.warnings });
    }
    return results;
  }
  function remember(original, targets, fingerprints, jobId) {
    clearExpired(); while (previews.size >= 4) previews.delete(previews.keys().next().value);
    const previewId = randomUUID(); previews.set(previewId, { createdAt: Date.now(), projectId: original.scope.projectId, original, targets: structuredClone(targets), fingerprints, ...(jobId ? { jobId } : {}) }); return previewId;
  }
  async function preview(input, signal) {
    if (!validId(input.requestId)) throw Error('重排预览编号无效。');
    const original = await current(input), images = await sourceImages(original, undefined, signal), fingerprints = new Map([...images.values()].map(file => [file.id, file.sha256]));
    const targets = checkedReflowTargets(input.targets).map(target => ({ id: randomUUID(), ...target, ...reflowCommerceDocument(original.document, target) }));
    const results = await previewTargets(targets, images, signal);
    if ((await current(input)).hash !== original.hash) throw Error('预览期间原稿已改变，请重新预览；没有改动原稿。');
    return { previewId: remember(original, targets, fingerprints), sourceRevision: original.document.revision, targets: results };
  }
  async function completedFiles(job, signal) {
    const results = new Map();
    for (const target of job.targets) {
      if (!target.completed) continue; const artifacts = [];
      const saved = await store.read({ projectId: job.projectId, sourceArtifactId: job.sourceArtifactId, documentId: target.document.id });
      if (!saved || plainLayout(saved, target.document.updatedAt) !== commerceDocumentHash(target.document)) throw Error('已完成版的可编辑工程已有修改或缺失，请重新预览；没有覆盖当前稿。');
      for (const expected of target.completed.artifacts) {
        const file = await artifactStore.read(expected.id); active(signal);
        if (file.projectId !== job.projectId || file.runId !== target.runId || file.trashedAt || file.unavailable || file.mimeType !== expected.mimeType || file.buffer.length !== expected.bytes || hash(file.buffer) !== expected.sha256) throw Error('已完成成品在应用外改变或不可用，请恢复文件或重新预览；未重写旧文件。');
        const { buffer, ...metadata } = file; artifacts.push(metadata);
      }
      results.set(target.id, { ...target.completed, artifacts });
    }
    return results;
  }
  async function verified(job, input, signal) {
    const original = await current(input);
    if (original.hash !== job.sourceHash || original.document.revision !== job.sourceRevision || original.scope.documentId !== job.documentId) throw Error('原稿版本已变化，请重新预览并逐版确认；已有成品保留。');
    const fingerprints = new Map(job.fingerprints.map(item => [item.artifactId, item.sha256])); await sourceImages(original, fingerprints, signal, false);
    return { original, fingerprints, completed: await completedFiles(job, signal) };
  }
  const summary = (job, actual) => ({ id: job.id, createdAt: job.createdAt, sourceRevision: job.sourceRevision, total: job.targets.length, completed: job.targets.filter(target => target.completed).length, canResume: !!actual && actual.hash === job.sourceHash, ...(actual?.hash !== job.sourceHash ? { reason: '原稿已更新，请重新预览确认。' } : {}), ...(job.error ? { error: job.error } : {}), targets: job.targets.map(target => ({ id: target.id, label: target.label, width: target.width, height: target.height, completed: !!target.completed, artifactIds: target.completed?.artifacts.map(file => file.id) || [] })) });
  async function listJobs(input, signal) {
    const scope = await store.resolveScope(input), listed = await jobs.list(scope); active(signal); let actual;
    try { actual = await current(input); } catch { /* Old receipts remain visible, but cannot start a changed draft. */ }
    return { jobs: listed.jobs.map(job => summary(job, actual)), errors: listed.errors };
  }
  function resultFor(job, completed) {
    const results = job.targets.map(target => completed.get(target.id));
    return { artifacts: results.flatMap(result => result.artifacts), sourceRevision: job.sourceRevision, documentId: results[0].documentId, runId: results[0].runId, jobId: job.id, variants: results.map((result, index) => ({ targetId: job.targets[index].id, documentId: result.documentId, width: job.targets[index].width, height: job.targets[index].height, artifactIds: result.artifacts.map(file => file.id) })) };
  }
  async function exportReviewed(input, signal) {
    clearExpired(); let record;
    if (input.jobId) {
      if (input.previewId) throw Error('请明确选择继续上次导出或提交本次预览。');
      const scope = await store.resolveScope(input), { job } = await jobs.read(scope, input.jobId);
      record = { projectId: job.projectId, original: { scope, document: job.originalDocument, hash: job.sourceHash }, targets: job.targets, fingerprints: new Map(job.fingerprints.map(item => [item.artifactId, item.sha256])), jobId: job.id };
    } else record = previews.get(input.previewId);
    if (!record || record.projectId !== input.projectId || (await current(input)).hash !== record.original.hash) throw Error('重排预览已过期或原稿改变，请重新预览确认。');
    const approved = input.approvedTargetIds;
    if (!Array.isArray(approved) || approved.length !== record.targets.length || new Set(approved).size !== approved.length || record.targets.some(target => !approved.includes(target.id))) throw Error('请逐一检查并确认全部目标版式后再导出。');
    const scope = record.original.scope;
    record.jobId ||= String(Date.now()) + '-' + randomUUID();
    const lock = path.dirname(await jobs.key(scope, record.jobId)), existing = runningScopes.get(lock);
    if (existing) { if (existing.jobId !== record.jobId) throw Error('当前原稿已有本地导出正在进行，请完成后再继续另一项。'); return existing.task; }
    const task = (async () => {
      let receipt;
      try { receipt = await jobs.read(scope, record.jobId); }
      catch (error) {
        if (error.code !== 'ENOENT' && !/续存记录已不在当前项目/.test(error.message)) throw error;
        if (record.targets.some(target => target.runId)) throw Error('已确认的续存记录缺失，未创建新目标替代原计划。');
        const time = new Date().toISOString(), job = { type: 'commerce-reflow-job', version: 1, id: record.jobId, ...scope, sourceRevision: record.original.document.revision, sourceHash: record.original.hash, originalDocument: record.original.document, createdAt: time, updatedAt: time, fingerprints: [...record.fingerprints].map(([artifactId, sha256]) => ({ artifactId, sha256 })), approvedTargetIds: [...approved], targets: record.targets.map(target => ({ id: target.id, width: target.width, height: target.height, label: target.label, document: target.document, warnings: target.warnings, runId: randomUUID() })) };
        const sha256 = await jobs.save(job); receipt = { job, sha256 };
      }
      let { job, sha256 } = receipt;
      try {
        const state = await verified(job, input, signal), completed = state.completed;
        for (const target of job.targets) {
          if (completed.has(target.id)) continue;
          active(signal); if ((await current(input)).hash !== job.sourceHash) throw Error('导出期间原稿改变，已完成的新版本保留。');
          const targetScope = { projectId: job.projectId, sourceArtifactId: job.sourceArtifactId, documentId: target.document.id }, previous = await store.read(targetScope);
          if (previous && plainLayout(previous, target.document.updatedAt) !== commerceDocumentHash(target.document)) throw Error('目标版式已有人工修改，未覆盖当前稿。');
          const saved = previous || await saveDocument({ ...targetScope, expectedRevision: 0, document: target.document }, signal);
          const result = await renderDocument(saved, [{ width: target.width, height: target.height, label: target.label }], signal, { runId: target.runId, recoverRun: true, expectedAssets: state.fingerprints, ensureCurrent: async () => { if ((await current(input)).hash !== job.sourceHash) throw Error('导出期间原稿改变，之前文件保留。'); } });
          const artifacts = []; for (const artifact of result.artifacts) { const file = await artifactStore.read(artifact.id); artifacts.push({ id: artifact.id, mimeType: file.mimeType, bytes: file.buffer.length, sha256: hash(file.buffer) }); }
          target.completed = { documentId: result.documentId, sourceRevision: result.sourceRevision, runId: result.runId, artifacts };
          job.updatedAt = new Date().toISOString(); delete job.error; sha256 = await jobs.save(job, sha256); completed.set(target.id, result);
        }
        return resultFor(job, completed);
      } catch (error) {
        try { const latest = await jobs.read(scope, job.id); job = latest.job; job.error = String(error.message || '本地导出未完成').slice(0, 1000); job.updatedAt = new Date().toISOString(); await jobs.save(job, latest.sha256); } catch { /* Keep the latest committed receipt and all output files when storage is unavailable. */ }
        throw error;
      }
    })();
    runningScopes.set(lock, { jobId: record.jobId, task }); try { return await task; } finally { if (runningScopes.get(lock)?.task === task) runningScopes.delete(lock); }
  }
  return { preview, exportReviewed, jobs: listJobs, clear: () => previews.clear() };
}
module.exports = { createCommerceReflow };
