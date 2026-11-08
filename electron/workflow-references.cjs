const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function stepReferenceIssue(step) {
  const ids = step?.referenceArtifactIds;
  if (ids === undefined) return '';
  if (!Array.isArray(ids) || ids.length > 16 || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) return '每步参考文件需要0–16个不重复的有效产物编号。';
  return '';
}
function stepReferenceIds(step, fallback = []) {
  const issue = stepReferenceIssue(step); if (issue) throw Error(issue);
  return step.referenceArtifactIds === undefined ? fallback : step.referenceArtifactIds;
}
async function explicitStepReferences(step, projectId, artifactStore) {
  if (step.referenceArtifactIds === undefined) return undefined;
  const ids = stepReferenceIds(step); let files;
  try { files = await artifactStore.list(ids); }
  catch (cause) { const error = new Error('本步骤的参考文件无法读取，请恢复原文件或重新选择；已发生费用和原产物保留。'); error.referenceIssue = { sourceStepId: step.id, ...(ids[0] ? { artifactId: ids[0] } : {}), reason: 'missing' }; error.cause = cause; throw error; }
  if (files.length !== ids.length || files.some((file, index) => file.id !== ids[index] || file.projectId !== projectId || file.trashedAt || file.unavailable)) throw Error('本步骤的参考文件已不可用或不属于当前项目，请重新选择该商品的原图。');
  if (files.reduce((total, file) => total + file.bytes, 0) > 80 * 1024 * 1024 || files.some(file => !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 32 * 1024 * 1024)) throw Error('每步参考文件单份最多32MB、合计最多80MB，请压缩或减少原图。');
  return files;
}
module.exports = { stepReferenceIssue, stepReferenceIds, explicitStepReferences };
