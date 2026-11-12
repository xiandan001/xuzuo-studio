const { createHash } = require('node:crypto');
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const normalized = value => String(value).replace(/\s+/g, ' ').trim();
function checkedRegion(value) {
  if (!allowed(value, ['x', 'y', 'width', 'height']) || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) || !value.width || !value.height || value.x + value.width > 1.000001 || value.y + value.height > 1.000001) throw Error('反馈圈选区域无效，请从原校样页重新导出。');
  const result = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(value[key] * 1e6) / 1e6]));
  result.width = Math.min(result.width, 1 - result.x); result.height = Math.min(result.height, 1 - result.y); if (!result.width || !result.height) throw Error('反馈圈选区域过小，请重新圈选后导出。'); return result;
}
function validateFeedback(input, record) {
  if (!allowed(input, ['format', 'version', 'packageId', 'fingerprint', 'createdAt', 'annotations']) || input.format !== 'xuzuo-proof-feedback' || input.version !== 1 || input.packageId !== record.packageId || input.fingerprint !== record.fingerprint || typeof input.createdAt !== 'string' || input.createdAt.length > 60 || !Number.isFinite(Date.parse(input.createdAt)) || !Array.isArray(input.annotations) || !input.annotations.length || input.annotations.length > 200) throw Error('反馈文件不属于这份校样或内容无效，请选择原页面导出的JSON。');
  const seen = new Set(), files = new Map(record.files.map(file => [file.key, file]));
  return input.annotations.map(note => {
    if (!allowed(note, ['id', 'pageId', 'text', 'locatorId', 'selectedText', 'region']) || !idValid(note.id) || seen.has(note.id) || !idValid(note.pageId) || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 4000 || note.locatorId !== undefined && !idValid(note.locatorId) || note.selectedText !== undefined && (typeof note.selectedText !== 'string' || !note.selectedText.trim() || note.selectedText.length > 2000)) throw Error('反馈意见或位置格式无效，未写入返修单。');
    seen.add(note.id);
    const page = record.pages.find(page => page.id === note.pageId), file = page && files.get(page.fileKey), locator = note.locatorId && page && Object.hasOwn(page.locators, note.locatorId) ? page.locators[note.locatorId] : undefined;
    if (!page || !file || note.locatorId && !locator) throw Error('反馈页、段落或单元格与原校样不匹配。');
    if (note.selectedText && (!locator || !normalized(locator.text).includes(normalized(note.selectedText)))) throw Error('反馈选中文字与原版本不一致，请在原校样中重新选取。');
    const region = note.region === undefined ? undefined : checkedRegion(note.region);
    const target = { projectId: file.projectId, artifactId: file.artifactId, ...(page.sourcePageId ? { pageId: page.sourcePageId } : {}), ...(locator?.pageId ? { pageId: locator.pageId } : {}), ...(locator?.blockId ? { blockId: locator.blockId } : {}), ...(locator?.sheetId ? { sheetId: locator.sheetId } : {}), ...(locator?.cellAddress ? { cellAddress: locator.cellAddress } : {}), ...(note.selectedText ? { selectedText: note.selectedText } : {}), ...(region ? { region } : {}) };
    const result = { id: note.id, target, text: note.text.trim(), sourceSha256: file.sha256, ...(file.sourceRevision ? { sourceRevision: file.sourceRevision } : {}) };
    return { ...result, fingerprint: hash(Buffer.from(JSON.stringify({ id: note.id, pageId: note.pageId, locatorId: note.locatorId, selectedText: note.selectedText, region, text: result.text, sourceSha256: file.sha256, sourceRevision: file.sourceRevision }))) };
  });
}
module.exports = { idValid, hash, validateFeedback, checkedRegion };
