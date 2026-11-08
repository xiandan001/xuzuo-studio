const { imageType } = require('./image-output-formats.cjs');
const { explicitStepReferences } = require('./workflow-references.cjs');

const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DELIVERABLE = new Set([...RASTER, 'image/svg+xml', 'image/gif']);
const label = value => typeof value === 'string' && value.trim() ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200) : '未命名文件';
function referenceError(step, file, reason, detail) {
  const subject = file ? `引用文件“${label(file.name || file.id)}”` : `来源步骤“${label(step.name || step.id)}”`;
  const error = new Error(`${subject}${detail} 已有文件和费用保留，本次未继续调用模型。`);
  error.referenceIssue = { sourceStepId: step.id, ...(file?.id ? { artifactId: file.id } : {}), reason };
  return error;
}
function sourceUses(run, remaining) {
  const uses = new Map();
  const add = (id, purpose) => { if (!uses.has(id)) uses.set(id, new Set()); uses.get(id).add(purpose); };
  for (const step of remaining.filter(item => item.enabled)) {
    for (const id of Array.isArray(step.documentImageStepIds) ? step.documentImageStepIds : []) add(id, 'illustration');
    if (step.imageSourceStepId) add(step.imageSourceStepId, 'editing');
    const position = run.snapshot.steps.findIndex(item => item.id === step.id);
    const before = run.snapshot.steps.slice(0, position).filter(item => item.enabled && !['manual-review', 'export'].includes(item.kind));
    const previous = before.at(-1);
    if (previous && ['image-generation', 'image-editing'].includes(previous.kind)) {
      if (step.kind === 'image-editing' && run.snapshot.steps[position]?.inputSource === 'previous') add(previous.id, 'editing');
      if (step.documentImageSource === 'previous' && !step.documentImageStepIds) add(previous.id, 'illustration');
    }
    if (run.snapshot.outputKind !== 'image' || step.kind !== 'export') continue;
    const ids = Array.isArray(step.contentSourceStepIds) ? step.contentSourceStepIds : step.contentSourceStepIds !== undefined ? [] : step.contentSourceStepId ? [step.contentSourceStepId] : before.filter(item => ['image-generation', 'image-editing'].includes(item.kind)).map(item => item.id);
    for (const id of ids) add(id, step.engineeringReferenceId !== undefined ? 'engineering' : step.wallpaperTarget !== undefined ? 'wallpaper' : 'delivery');
  }
  return uses;
}
async function unreadableReference(store, step, picture, cause) {
  let trashed = picture.trashedAt;
  if (!trashed && typeof store.listTrash === 'function') {
    try { trashed = (await store.listTrash()).some(file => file.id === picture.id); } catch { /* The original read failure remains actionable without a trash listing. */ }
  }
  if (trashed) throw referenceError(step, picture, 'trashed', '已在回收站。请点击“查看来源文件”，在该步骤文件的“回收站”恢复它，再刷新后继续。');
  if (cause?.code === 'ENOENT' || picture.unavailable || typeof cause?.message === 'string' && (cause.message.includes('找不到这份产物') || cause.message.includes('产物文件已不存在'))) throw referenceError(step, picture, 'missing', '在磁盘上找不到。请恢复原文件后刷新；没有副本时，请返回工作台移除当前引用、重新选择或重新制作。');
  if (typeof cause?.message === 'string' && cause.message.includes('内容已在应用外改变')) throw referenceError(step, picture, 'changed', '内容已在应用外改变。请恢复原文件，或返回工作台将新文件重新导入并选择；不要覆盖原记录。');
  if (['EACCES', 'EPERM'].includes(cause?.code)) throw referenceError(step, picture, 'unreadable', '无法读取，可能正被其他程序占用或没有访问权限。请关闭占用程序、确认文件可读取后刷新。');
  throw referenceError(step, picture, 'unreadable', '暂时无法读取。请先刷新文件清单；仍不可用时，请返回工作台重新选择或重新准备引用。');
}
async function validateResumeImageSources(run, remaining, artifactStore) {
  const completed = new Set();
  for (const step of remaining.filter(item => item.enabled)) await explicitStepReferences(step, run.projectId, artifactStore);
  for (const [id, purposes] of sourceUses(run, remaining)) {
    const step = remaining.find(item => item.id === id);
    if (!step || step.enabled) continue;
    const attempt = run.attempts.filter(item => item.stepId === id && item.status === 'complete').at(-1);
    const pictures = attempt?.artifacts?.filter(file => file.kind === 'image') || [];
    if (pictures.length !== (step.count || 1)) throw referenceError(step, undefined, 'incomplete', `结果不完整（需要 ${step.count || 1} 份，当前 ${pictures.length} 份）。请查看该步骤的实际结果，恢复文件或重新制作后再继续。`);
    for (const picture of pictures) {
      let file;
      try { file = await artifactStore.read(picture.id); } catch (cause) { await unreadableReference(artifactStore, step, picture, cause); }
      if (file.projectId !== run.projectId) throw referenceError(step, picture, 'foreign-project', '不属于当前项目。请返回工作台重新选择本项目的文件；如需跨项目使用，请从素材库重新加入。');
      const raster = purposes.has('illustration') || purposes.has('editing');
      const allowed = purposes.has('wallpaper') || purposes.has('engineering') ? new Set(['image/png']) : raster ? RASTER : DELIVERABLE;
      if (purposes.has('engineering') && file.mimeType !== 'image/png') throw referenceError(step, picture, 'unsupported-format', '不能作为工程适配的PNG编辑结果，原图与费用保留；未重新调用模型。');
      if (purposes.has('wallpaper') && file.mimeType !== 'image/png') throw referenceError(step, picture, 'unsupported-format', '不能作为壁纸PNG原图，请重新选择静态PNG制作步骤；未重新调用模型。');
      if (!allowed.has(file.mimeType)) throw referenceError(step, picture, 'unsupported-format', purposes.has('editing') ? '不能直接作为精修原图，接口只接受 PNG/JPEG/WebP。本应用生成的动图请使用“继续修改动画”重新准备；外部 GIF 请先转换为静态图片。' : raster ? '不能作为 Office 配图，请返回文档工作台重新选择 PNG/JPEG/WebP 插图。' : '不是可交付的 PNG/JPEG/WebP/SVG/GIF 图像，请重新选择输出步骤或重新制作。');
      try { if (imageType(file.buffer).mimeType !== file.mimeType) throw Error('mime mismatch'); }
      catch { throw referenceError(step, picture, 'unsupported-format', '实际图片内容与登记格式不一致或已损坏。请恢复原图，或返回工作台重新导入并选择。'); }
    }
    completed.add(id);
  }
  return completed;
}

module.exports = { validateResumeImageSources };
