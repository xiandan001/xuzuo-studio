const { createHash } = require('node:crypto');
const { createDocumentArtifactPreview } = require('./artifact-document-preview.cjs');
const { normalizeOfficeDocument } = require('./office-content.cjs');
const { calculateSpreadsheet } = require('./spreadsheet-engine.cjs');
const { editorDeliveryChecks, imageDeliveryChecks } = require('./delivery-quality.cjs');
const { spreadsheetDeliveryChecks } = require('./spreadsheet-delivery.cjs');
const { wallpaperTargetError } = require('./wallpaper-export.cjs');
const { engineeringSourceError, readEngineeringSource } = require('./engineering-export.cjs');
const MIME = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
function checkedSelection(input) {
  if (!input || !validId(input.projectId) || !['word', 'ppt', 'excel', 'image'].includes(input.kind) || !Array.isArray(input.artifactIds) || input.artifactIds.length > 20 || input.artifactIds.some(id => !validId(id))) throw new Error('交付项目、类型或成品编号无效。');
  return { ...input, artifactIds: [...new Set(input.artifactIds)] };
}
function currentAdaptedOutput(run, step, attempt) {
  const engineering = step.engineeringReferenceId !== undefined;
  if (engineering ? step.wallpaperTarget !== undefined || engineeringSourceError(attempt.engineeringSource) || attempt.engineeringSource.referenceId !== step.engineeringReferenceId || run.attachmentIds?.[0] !== step.engineeringReferenceId : wallpaperTargetError(step.wallpaperTarget)) return false;
  if (!Array.isArray(step.contentSourceStepIds) || !step.contentSourceStepIds.length || step.contentSourceStepIds.length > 20 || new Set(step.contentSourceStepIds).size !== step.contentSourceStepIds.length) return false;
  const sourceIds = [];
  for (const id of step.contentSourceStepIds) {
    const producer = run.snapshot.steps.find(item => item.id === id), source = run.attempts.findLast(item => item.stepId === id && item.status === 'complete');
    if (!producer || !['image-generation', 'image-editing'].includes(producer.kind) || run.snapshot.steps.indexOf(producer) >= run.snapshot.steps.indexOf(step) || (producer.imageOutputFormat ?? 'png') !== 'png') return false;
    if (engineering && (producer.kind !== 'image-editing' || producer.inputSource !== 'project' || producer.imageSourceStepId !== undefined || producer.imageMarkupId === step.engineeringReferenceId)) return false;
    const images = (source?.artifacts || []).filter(file => file.kind === 'image');
    if (images.length !== (producer.count || 1) || images.some(file => file.projectId !== run.projectId || file.runId !== run.id || file.mimeType !== 'image/png')) return false;
    sourceIds.push(...images.map(file => file.id));
  }
  const originals = new Set(sourceIds), bound = attempt.sourceArtifactIds, outputs = (attempt.artifacts || []).filter(file => file.kind === 'image');
  return originals.size === sourceIds.length && sourceIds.length <= 20 && Array.isArray(bound) && bound.length === sourceIds.length && new Set(bound).size === bound.length && bound.every(id => originals.has(id)) && outputs.length === sourceIds.length && new Set(outputs.map(file => file.id)).size === outputs.length && outputs.every(file => !originals.has(file.id) && file.projectId === run.projectId && file.runId === run.id && file.mimeType === 'image/png');
}
function completedOutputs(runs, projectId, kind) {
  return runs.filter(run => run.mode === 'live' && run.projectId === projectId && run.purpose !== 'automation-plan').flatMap(run => run.attempts.flatMap(attempt => {
    const step = run.snapshot.steps.find(item => item.id === attempt.stepId);
    const exporter = run.snapshot.steps.findLast(item => item.enabled && item.kind === 'export');
    const imageSources = Array.isArray(exporter?.contentSourceStepIds) ? exporter.contentSourceStepIds : exporter?.contentSourceStepId ? [exporter.contentSourceStepId] : undefined;
    const currentImageAttempt = !Array.isArray(exporter?.contentSourceStepIds) || attempt === run.attempts.findLast(item => item.stepId === attempt.stepId && item.status === 'complete');
    const adapted = exporter?.wallpaperTarget !== undefined || exporter?.engineeringReferenceId !== undefined;
    const accepted = kind === 'image' ? adapted ? step === exporter && currentImageAttempt && currentAdaptedOutput(run, step, attempt) : ['image-generation', 'image-editing'].includes(step?.kind) && (!imageSources || imageSources.includes(step.id)) && currentImageAttempt : step?.kind === 'export';
    if (!accepted || attempt.status !== 'complete') return [];
    const artifacts = (attempt.artifacts || []).filter(file => kind === 'image' ? file.kind === 'image' : file.mimeType === MIME[kind]);
    return artifacts.length ? [{ run, attempt, step, artifacts }] : [];
  }));
}
function createDeliverySource({ workspaceStorage, artifactStore, liveEngine, editorStore, spreadsheetStore, inspectImage, readBeadDocument }) {
  const previewSource = createDocumentArtifactPreview({ liveEngine, editorStore, spreadsheetStore });
  return async raw => {
    const input = checkedSelection(raw); await workspaceStorage.projectDirectory(input.projectId);
    const { runs } = await liveEngine.snapshot(undefined, { summaryOnly: true });
    if (input.kind === 'image') {
      const localRuns = runs.filter(run => run.mode === 'live' && run.projectId === input.projectId && run.localImageProof && run.status === 'complete').sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0));
      const owner = input.artifactIds.length ? localRuns.find(run => input.artifactIds.every(id => run.localImageProof.files?.some(file => file.id === id))) : runs.filter(run => run.projectId === input.projectId && ['complete', 'waiting-review'].includes(run.status)).sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))[0];
      if (owner?.localImageProof) return require('./local-image-proof.cjs').createLocalImageProof({ artifactStore, readBeadDocument }).inspect(owner, input.artifactIds);
    }
    const candidates = completedOutputs(runs, input.projectId, input.kind);
    const record = input.kind === 'excel' ? await spreadsheetStore.load({ projectId: input.projectId }) : input.kind === 'image' ? null : await editorStore.load({ projectId: input.projectId, kind: input.kind });
    let outputs = candidates;
    if (record) outputs = outputs.filter(item => item.run.sourceRevision === record.revision || item.attempt.sourceRevision === record.revision);
    let selected = input.artifactIds;
    if (!selected.length) selected = outputs[0]?.artifacts.map(file => file.id) || [];
    const selectedOutputs = outputs.filter(item => selected.some(id => item.artifacts.some(file => file.id === id)));
    const errors = [];
    for (const output of selectedOutputs.filter(item => item.step.engineeringReferenceId !== undefined)) {
      try {
        const actual = await readEngineeringSource(id => artifactStore.read(id), { projectId: input.projectId, referenceId: output.step.engineeringReferenceId, attachmentIds: output.run.attachmentIds });
        if (['referenceId', 'width', 'height', 'sha256'].some(key => actual[key] !== output.attempt.engineeringSource[key])) errors.push('工程主原图与本次编辑的来源或原尺寸不一致，请恢复原图或重新制作；已有成品与费用保留。');
      } catch { errors.push('工程主原图已不可读取，请先从项目文件恢复原图，再继续交付检查；不需要重新调用模型。'); }
    }
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
        const target = owner?.step.engineeringReferenceId !== undefined ? owner.attempt.engineeringSource : owner?.step.wallpaperTarget;
        if (target && (file.mimeType !== 'image/png' || file.runId !== owner.run.id)) throw Error('本地适配成品类型或来源发生变化，请重新读取本次导出。');
        const checks = imageDeliveryChecks({ ...dimensions, mimeType: file.mimeType, artifactAvailable: true, expectedSize: target ? `${target.width}x${target.height}` : owner?.step.imageSize, requiresTransparency: !target && owner?.step.imageBackground === 'transparent' });
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
