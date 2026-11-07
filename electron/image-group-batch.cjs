const MAX_GROUPS = 500, MAX_GROUP_IMAGES = 20, MAX_TOTAL_IMAGES = 500;
function validateImageGroupCounts(counts, length) {
  if (!Array.isArray(counts) || counts.length !== length || !length || length > MAX_GROUPS || counts.some(count => !Number.isInteger(count) || count < 1 || count > MAX_GROUP_IMAGES) || counts.reduce((sum, count) => sum + count, 0) > MAX_TOTAL_IMAGES) throw new Error('分组数量无效：每组1–20张，最多500组且总计不超过500张。');
}
function validateImageGroupTemplate(request) {
  const steps = request?.workflow?.steps, first = steps?.[0], last = steps?.[1];
  if (request?.project?.kind !== 'image' || request.workflow?.outputKind !== 'image' || steps?.length !== 2 || first?.kind !== 'image-generation' || !first.enabled || (first.count ?? 1) !== 1 || first.inputSource !== 'project' || last?.kind !== 'export' || !last.enabled || last.inputSource !== 'previous' || last.contentSourceStepId || request.attachmentIds?.length) throw new Error('分组图片仅支持无参考图的单张生成模板与实际导出，原队列未改变。');
  if (last.wallpaperTarget !== undefined) {
    const issue = require('./wallpaper-export.cjs').wallpaperTargetError(last.wallpaperTarget);
    if (issue) throw Error(issue);
    if ((first.imageOutputFormat || 'png') !== 'png' || first.imageBackground === 'transparent' || last.contentSourceStepIds?.length !== 1 || last.contentSourceStepIds[0] !== first.id) throw Error('分组壁纸需要不透明PNG原图和明确的本组来源。');
  }
}
function validateImageGroupRecord(record) {
  if (record.kind !== 'image-groups') { if (record.items.some(item => item.imageCount !== undefined)) throw new Error('批次图片分组标志与数量不匹配。'); return; }
  validateImageGroupTemplate(record.request); validateImageGroupCounts(record.items.map(item => item.imageCount), record.items.length);
}
function imageGroupRequest(record, item, request) {
  if (record.kind !== 'image-groups') return request;
  validateImageGroupRecord(record);
  const [first, last] = record.request.workflow.steps, count = item.imageCount;
  const steps = Array.from({ length: count }, (_, index) => ({ ...first, id: `group-image-${index + 1}`, name: `制作第${index + 1}/${count}张`, count: 1, prompt: `${first.prompt}\n\n本组共${count}张，本次制作第${index + 1}张。按本组需求从不同画面角度构图，本次只输出一张独立图片，不拼成多宫格。` }));
  return { ...request, workflow: { ...request.workflow, id: `image-group-${item.id}`, name: `分组生成 · ${item.project.name}`, steps: [...steps, { ...last, id: 'group-export', ...(last.wallpaperTarget ? { contentSourceStepIds: steps.map(step => step.id) } : {}) }] } };
}
function imageGroupOutputError(record, item, run) {
  if (record.kind !== 'image-groups' || run.status !== 'complete') return undefined;
  const steps = run.snapshot.steps.filter(step => step.enabled && step.kind === 'image-generation');
  const counts = steps.map(step => run.attempts.filter(attempt => attempt.stepId === step.id && attempt.status === 'complete').at(-1)?.artifacts?.filter(file => file.kind === 'image').length || 0);
  if (steps.length !== item.imageCount || counts.some(count => count !== 1)) return `本组请求${item.imageCount}张，但实际图片数量不匹配，已暂停；全部已有文件和费用保留，请核对后明确重试。`;
  if (record.request.workflow.steps[1].wallpaperTarget) {
    const exported = run.attempts.filter(attempt => attempt.stepId === 'group-export' && attempt.status === 'complete').at(-1)?.artifacts?.filter(file => file.kind === 'image') || [];
    if (exported.length !== item.imageCount || exported.some(file => file.mimeType !== 'image/png')) return '本组原图已保留，但精确壁纸文件尚未全部完成；请继续本地适配步骤，不要重复生成原图。';
  }
}
module.exports = { MAX_GROUPS, MAX_GROUP_IMAGES, MAX_TOTAL_IMAGES, validateImageGroupCounts, validateImageGroupTemplate, validateImageGroupRecord, imageGroupRequest, imageGroupOutputError };
