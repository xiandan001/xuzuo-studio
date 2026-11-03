const { editorFromText, editorMissingInputs } = require('./editor-generated.cjs');
const { spreadsheetFromText, spreadsheetMissingInputs } = require('./spreadsheet-generated.cjs');
const MAX_TEXT = 200000;

// Text-only image delivery notes retain their original content. Office documents
// use the exact same generated-content normalizers as the editable workbenches.
function parseContent(text, suppliedTitle) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Office 正文最多支持 200000 个字符，请精简或拆分内容。');
  const raw = text.trim();
  const title = typeof suppliedTitle === 'string' && suppliedTitle.trim() ? suppliedTitle.trim() : '创作结果';
  if (title.length > 120) throw new Error('成品标题最多支持 120 个字符，请缩短标题。');
  return { raw, title };
}
function normalizeOfficeDocument(kind, text, title) {
  if (kind === 'excel') return spreadsheetFromText(text, title || '创作结果');
  if (kind === 'word' || kind === 'ppt') return editorFromText(kind, title || '创作结果', text);
  throw new Error('请选择受支持的文档类型。');
}
function officeMissingInputs(document) {
  return document.kind === 'excel' ? spreadsheetMissingInputs(document) : editorMissingInputs(document);
}

function imageDimensions(buffer, mimeType) {
  let width, height;
  if (mimeType === 'image/png' && buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20); }
  if (mimeType === 'image/jpeg' && buffer.length > 10 && buffer[0] === 255 && buffer[1] === 216) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 255) { offset++; continue; }
      const marker = buffer[offset + 1]; offset += 2;
      if (marker === 255 || marker === 216) continue;
      if (marker === 217 || marker === 218) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  }
  if (!width || !height || width * height > 40000000) throw new Error('Office 图片需要有效的 PNG/JPEG，且像素总数不超过 4000 万。');
  return { width, height };
}

module.exports = { parseContent, normalizeOfficeDocument, officeMissingInputs, imageDimensions };
