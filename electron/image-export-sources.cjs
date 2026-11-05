function imageExportSourceError(step, workflow, project, completedStepIds) {
  if (step.contentSourceStepIds === undefined) return;
  const ids = step.contentSourceStepIds;
  if (project.kind !== 'image' || step.kind !== 'export' || step.contentSourceStepId || !Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) return '图片交付来源需要1–20个不重复的前置图片步骤，不能同时指定单一来源。';
  const sources = ids.map(id => workflow.steps.find(source => typeof id === 'string' && id.length <= 160 && source.id === id));
  if (sources.some(source => !source || !source.enabled && !completedStepIds.has(source.id) || !['image-generation', 'image-editing'].includes(source.kind) || ['planner', 'reviewer'].includes(source.role) || workflow.steps.indexOf(source) >= workflow.steps.indexOf(step))) return '图片交付来源必须是前面启用的图片制作或精修步骤。';
  if (sources.reduce((sum, source) => sum + (source.count || 1), 0) > 20) return '单次图片交付最多20张实际图片。';
}

function imageExportAssets(run, step, results) {
  if (step.contentSourceStepIds === undefined) return;
  const assets = [];
  for (const id of step.contentSourceStepIds) {
    const source = run.snapshot.steps.find(item => item.id === id), result = results.find(item => item.stepId === id);
    const images = (result?.artifacts || []).filter(file => file.kind === 'image');
    if (!source || images.length !== (source.count || 1) || images.some(file => file.projectId !== run.projectId || file.runId !== run.id)) throw new Error('所选图片步骤实际产物不完整或归属不匹配，未改用参考原图；已有图片和费用保留。');
    assets.push(...images);
  }
  if (new Set(assets.map(file => file.id)).size !== assets.length) throw new Error('所选图片步骤重复返回相同产物，未将重复文件计为多张；已有图片和费用保留。');
  return assets;
}
module.exports = { imageExportSourceError, imageExportAssets };
