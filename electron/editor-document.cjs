const { normalizeWordTable } = require('./word-table.cjs');
const ALIGNMENTS = ['left', 'center', 'right'];
const LAYOUTS = ['title-body', 'two-columns', 'image-right', 'image-full'];
const THEMES = {
  paper: { background: 'F7F8FC', text: '243047', accent: '6354CF' },
  violet: { background: 'F0ECFC', text: '30264F', accent: '6D53CE' },
  forest: { background: 'EDF3ED', text: '294934', accent: '547B58' },
  night: { background: '202A3E', text: 'F4F6FC', accent: 'BEB4FF' },
};
function text(value, label, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}需要是长度不超过 ${max} 的文字。`);
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error('编辑内容编号无效。');
  return value;
}
function style(item, minimum, maximum) {
  if (!Number.isInteger(item.fontSize) || item.fontSize < minimum || item.fontSize > maximum || !ALIGNMENTS.includes(item.align)) throw new Error('文字字号或对齐方式无效。');
  return { fontSize: item.fontSize, align: item.align };
}
function validateEditorDocument(input) {
  if (!input || input.schemaVersion !== 1 || !['word', 'ppt'].includes(input.kind)) throw new Error('编辑文档格式无效。');
  const title = text(input.title, '文档标题', 120).trim();
  if (!title) throw new Error('请填写文档标题。');
  const ids = new Set();
  const itemId = item => { const id = identifier(item?.id); if (ids.has(id)) throw new Error('编辑内容编号重复。'); ids.add(id); return id; };
  let document;
  if (input.kind === 'word') {
    if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > 500) throw new Error('Word 需要 1 至 500 个内容段落。');
    document = { schemaVersion: 1, kind: 'word', title, blocks: input.blocks.map(item => {
      const id = itemId(item);
      if (!['paragraph', 'heading', 'bullet', 'image', 'table'].includes(item.type) || typeof item.bold !== 'boolean' || typeof item.italic !== 'boolean') throw new Error('Word 段落格式无效。');
      if (item.type === 'table' ? item.text !== '' : item.table !== undefined) throw new Error('Word 表格的 text 必须为空，普通段落不能附带表格。');
      if (item.type !== 'image' && item.imageId !== undefined) throw new Error('普通段落不能隐藏附带图片。');
      return { id, type: item.type, text: text(item.text, '段落正文', 20000), ...style(item, 9, 32), bold: item.bold, italic: item.italic, ...(item.type === 'image' ? { imageId: identifier(item.imageId) } : {}), ...(item.type === 'table' ? { table: normalizeWordTable(item.table) } : {}) };
    }) };
  } else {
    if (!Array.isArray(input.slides) || !input.slides.length || input.slides.length > 100 || !Object.hasOwn(THEMES, input.theme)) throw new Error('PPT 需要 1 至 100 页并选择有效主题。');
    document = { schemaVersion: 1, kind: 'ppt', title, theme: input.theme, slides: input.slides.map(item => {
      const id = itemId(item);
      if (!LAYOUTS.includes(item.layout)) throw new Error('PPT 页面版式无效。');
      return { id, title: text(item.title, '页面标题', 120), body: text(item.body, '页面正文', 5000), notes: text(item.notes, '页面备注', 10000), layout: item.layout, ...style(item, 14, 32), ...(item.imageId ? { imageId: identifier(item.imageId) } : {}) };
    }) };
  }
  if (JSON.stringify({ editorDocument: document }).length > 200000) throw new Error('编辑内容超过 200000 字符，请拆分项目。');
  if (editorImageIds(document).length > 20) throw new Error('单份文档最多使用 20 张不同插图，请拆分项目。');
  return document;
}
function editorImageIds(document) {
  return [...new Set((document.kind === 'word' ? document.blocks : document.slides).map(item => item.imageId).filter(Boolean))];
}
module.exports = { validateEditorDocument, editorImageIds, THEMES };
