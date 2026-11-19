const { isRedPacketCoverWorkflow } = require('./wechat-red-packet-cover.cjs');
const COVER_RECIPE = 1;
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function coverProof(run, attempt, file) {
  if (!run || !isRedPacketCoverWorkflow(run.snapshot, run.projectId) || attempt.status !== 'complete' || !file || file.projectId !== run.projectId || file.runId !== run.id || file.mimeType !== 'image/jpeg') return;
  const step = run.snapshot.steps.find(item => item.id === attempt.stepId);
  const proof = attempt.coverFiles?.find(item => item.artifactId === file.id);
  if (step?.kind !== 'export' || proof?.recipe !== COVER_RECIPE || !validHash(proof.sha256) || !validHash(proof.sourceSha256) || !Number.isSafeInteger(proof.bytes) || proof.bytes <= 0 || proof.bytes > 500000 || file.bytes !== proof.bytes || !attempt.sourceArtifactIds?.includes(proof.sourceArtifactId) || !attempt.artifacts?.some(item => item.id === file.id)) return;
  return proof;
}

function sourceStepIds(run, step) {
  const producers = run.snapshot.steps.slice(0, run.snapshot.steps.indexOf(step)).filter(item => item.enabled && ['image-generation', 'image-editing'].includes(item.kind));
  const ids = step.contentSourceStepIds || [step.contentSourceStepId || producers.at(-1)?.id];
  return ids.filter(id => producers.some(item => item.id === id));
}

function coverSources(run, step, results) {
  const ids = sourceStepIds(run, step);
  if (!ids.length || ids.length !== (step.contentSourceStepIds?.length ?? 1)) throw Error('红包交付需要前置的图片制作结果。');
  const files = ids.map(id => {
    const images = results.find(item => item.stepId === id)?.artifacts?.filter(file => file.kind === 'image') || [];
    if (images.length !== 1 || images[0].projectId !== run.projectId || images[0].runId !== run.id || images[0].mimeType !== 'image/png') throw Error('本次红包制作的 PNG 原图不可用，请检查项目文件。');
    return images[0];
  });
  if (!files.length || files.length > 20 || new Set(files.map(file => file.id)).size !== files.length) throw Error('红包交付原图为空、重复或超过单次上限。');
  return files;
}

function currentCoverFiles(run, step, attempt) {
  if (!step || attempt.stepId !== step.id || attempt !== run.attempts.findLast(row => row.status === 'complete' && row.stepId === step.id) || !attempt.coverFiles?.length) return [];
  const latest = run.snapshot.steps.map(row => run.attempts.findLast(item => item.stepId === row.id && item.status === 'complete')).filter(Boolean);
  let sources;
  try { sources = coverSources(run, step, latest); } catch { return []; }
  const files = attempt.artifacts || [];
  return sources.length === files.length && sources.every((source, index) => coverProof(run, attempt, files[index])?.sourceArtifactId === source.id) ? files : [];
}

module.exports = { COVER_RECIPE, coverProof, coverSources, sourceStepIds, currentCoverFiles };
