const { createHash } = require('node:crypto');
const { createDocumentArtifactPreview } = require('./artifact-document-preview.cjs');
const { normalizeOfficeDocument } = require('./office-content.cjs');
const { calculateSpreadsheet } = require('./spreadsheet-engine.cjs');
const { editorDeliveryChecks, imageDeliveryChecks } = require('./delivery-quality.cjs');
const { spreadsheetDeliveryChecks } = require('./spreadsheet-delivery.cjs');
const MIME = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
function checkedSelection(input) {
  if (!input || !validId(input.projectId) || !['word', 'ppt', 'excel', 'image'].includes(input.kind) || !Array.isArray(input.artifactIds) || input.artifactIds.length > 20 || input.artifactIds.some(id => !validId(id))) throw new Error('交付项目、类型或成品编号无效。');
  return { ...input, artifactIds: [...new Set(input.artifactIds)] };
}
function completedOutputs(runs, projectId, kind) {
  return runs.filter(run => run.mode === 'live' && run.projectId === projectId && run.purpose !== 'automation-plan').flatMap(run => run.attempts.flatMap(attempt => {
    const step = run.snapshot.steps.find(item => item.id === attempt.stepId);
    const exporter = run.snapshot.steps.findLast(item => item.enabled && item.kind === 'export');
    const imageSources = Array.isArray(exporter?.contentSourceStepIds) ? exporter.contentSourceStepIds : exporter?.contentSourceStepId ? [exporter.contentSourceStepId] : undefined;
    const currentImageAttempt = !Array.isArray(exporter?.contentSourceStepIds) || attempt === run.attempts.findLast(item => item.stepId === attempt.stepId && item.status === 'complete');
    const accepted = kind === 'image' ? ['image-generation', 'image-editing'].includes(step?.kind) && (!imageSources || imageSources.includes(step.id)) && currentImageAttempt : step?.kind === 'export';
    if (!accepted || attempt.status !== 'complete') return [];
    const artifacts = (attempt.artifacts || []).filter(file => kind === 'image' ? file.kind === 'image' : file.mimeType === MIME[kind]);
    return artifacts.length ? [{ run, attempt, step, artifacts }] : [];
  }));
}
function createDeliverySource({ workspaceStorage, artifactStore, liveEngine, editorStore, spreadsheetStore, inspectImage }) {
  const previewSource = createDocumentArtifactPreview({ liveEngine, editorStore, spreadsheetStore });
  return async raw => {
    const input = checkedSelection(raw); await workspaceStorage.projectDirectory(input.projectId);
    const { runs } = await liveEngine.snapshot(undefined, { summaryOnly: true }), candidates = completedOutputs(runs, input.projectId, input.kind);
    const record = input.kind === 'excel' ? await spreadsheetStore.load({ projectId: input.projectId }) : input.kind === 'image' ? null : await editorStore.load({ projectId: input.projectId, kind: input.kind });
    let outputs = candidates;
    if (record) outputs = outputs.filter(item => item.run.sourceRevision === record.revision || item.attempt.sourceRevision === record.revision);
    let selected = input.artifactIds;
    if (!selected.length) selected = outputs[0]?.artifacts.map(file => file.id) || [];
    const selectedOutputs = outputs.filter(item => selected.some(id => item.artifacts.some(file => file.id === id)));
    const errors = [];
    if (!selected.length) errors.push(record ? '当前编辑版本尚未生成实际交付文件，请保存并导出。' : '请先选择实际生成的成品，导入的原图或参考文件不能直接当作本次交付。');
    if (selected.some(id => !selectedOutputs.some(item => item.artifacts.some(file => file.id === id)))) errors.push('所选文件不是当前版本的成功交付产物；图片参考原图不能混入成品。');
    const sameImageBatch = input.kind === 'image' && selectedOutputs.length > 0 && selectedOutputs.every(item => item.run.id === selectedOutputs[0].run.id && Array.isArray(item.run.snapshot.steps.findLast(step => step.enabled && step.kind === 'export')?.contentSourceStepIds));
    if (selectedOutputs.length > 1 && !sameImageBatch) errors.push('一次交付请选择同一保存版本或同一次生成的成品。');
    if (record && typeof input.sourceRevision === 'number' && input.sourceRevision !== record.revision) errors.push('编辑版本已经变化，请重新读取交付检查。');
    if (input.kind === 'excel' && record && !record.calculation?.allFormulasValid) errors.push('当前工作簿仍有未支持或错误公式，不能自动判定为已验收。');
    const origin = selectedOutputs[0];
    const revision = record ? `editor:${record.revision}` : origin ? `${input.kind === 'image' ? 'image' : 'workflow'}:${origin.run.id}:${sameImageBatch ? hash(selectedOutputs.map(item => item.attempt.id).sort().join('\n')) : origin.attempt.id}` : 'unexported';
    const files = [], imageChecks = []; let total = 0;
    for (const id of selected) {
      const file = await artifactStore.read(id);
      if (file.projectId !== input.projectId || file.trashedAt || (input.kind === 'image' ? file.kind !== 'image' : file.mimeType !== MIME[input.kind])) throw new Error('交付文件不属于当前项目、已被回收或类型不匹配。');
      const bytes = Buffer.from(file.buffer); total += bytes.length;
      if (!bytes.length || total > 100 * 1024 * 1024) throw new Error('交付文件为空或合计超过100MB，请拆分交付。');
      files.push({ id, name: file.name, mimeType: file.mimeType, bytes: bytes.length, sha256: hash(bytes) });
      if (input.kind === 'image') {
        const owner = selectedOutputs.find(item => item.artifacts.some(artifact => artifact.id === id));
        const dimensions = inspectImage ? await inspectImage(bytes, file.mimeType) : {};
        const checks = imageDeliveryChecks({ ...dimensions, mimeType: file.mimeType, artifactAvailable: true, expectedSize: owner?.step.imageSize, requiresTransparency: owner?.step.imageBackground === 'transparent' });
        imageChecks.push(...checks.filter(check => check.status !== 'manual').map(check => ({ ...check, id: `${check.id}-${id.slice(0, 8)}`, label: `${file.name.slice(0, 80)} · ${check.label}` })));
        for (const check of checks.filter(check => check.status === 'manual')) if (!imageChecks.some(item => item.id === check.id)) imageChecks.push(check);
      }
    }
    const title = record?.document.title || (await workspaceStorage.list()).projects.find(item => item.projectId === input.projectId)?.name || '项目成品';
    let document = record?.document, calculation = record?.calculation, sourceHash = record ? hash(JSON.stringify(record.document)) : revision;
    if (!document && origin && input.kind !== 'image') {
      const raw = await previewSource(origin.artifacts[0]);
      if (raw?.documentSource) { sourceHash = hash(raw.text); document = normalizeOfficeDocument(input.kind, raw.text, title); if (input.kind === 'excel') calculation = calculateSpreadsheet(document); }
    }
    const checks = input.kind === 'image' ? imageChecks : !document ? [{ id: 'document-source', label: '当前文档正文可核验', status: 'failed', detail: '尚不能核对成品对应的当前文稿，请先保存并导出当前版本。' }] : input.kind === 'excel' ? spreadsheetDeliveryChecks(document, calculation, { saved: true, exported: !errors.length && !!files.length }) : editorDeliveryChecks(document, { saved: true, exported: !errors.length && !!files.length });
    return { projectId: input.projectId, kind: input.kind, revision, sourceHash, title, files, errors, checks };
  };
}
module.exports = { createDeliverySource, checkedSelection, hash };
