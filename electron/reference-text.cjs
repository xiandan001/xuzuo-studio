const path = require('node:path');
const { crc32 } = require('node:zlib');

const MAX_TEXT = 100000;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_XML_TOTAL = 16 * 1024 * 1024;
const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const WORD_NAMESPACES = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const DRAW_NAMESPACES = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);

class ReferenceTextError extends Error {}
const fail = message => { throw new ReferenceTextError(message); };
const limited = value => { if (value.length > MAX_TEXT) fail('参考文件提取后超过 10 万字符，请拆分或精简后重新添加。'); return value; };
function strictText(buffer, xml = false) {
  const encoding = xml && buffer[0] === 255 && buffer[1] === 254 ? 'utf-16le' : xml && buffer[0] === 254 && buffer[1] === 255 ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { fail('参考文件不是有效的 UTF-8 文字或受支持的 Office XML 编码，请转换编码后重新添加。'); }
}

function checkZip(buffer) {
  if (buffer.length < 22 || buffer.length > MAX_ZIP_BYTES) fail('Office 参考文件无效或超过 50 MB，请拆分后添加。');
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50 && index + 22 + buffer.readUInt16LE(index + 20) === buffer.length) { end = index; break; }
  }
  if (end < 0) fail('Office 文件不是完整的 OOXML ZIP，可能已损坏或是旧版/加密文件。');
  const count = buffer.readUInt16LE(end + 10), centralSize = buffer.readUInt32LE(end + 12), centralOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || count === 65535 || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('暂不支持分卷、ZIP64 或加密 Office 文件，请另存为普通 DOCX/PPTX/XLSX。');
  if (count > 2000 || centralOffset + centralSize > end) fail('Office 文件结构过大或目录损坏，最多支持 2000 个内部文件。');
  let offset = centralOffset, expanded = 0;
  const sizes = new Map(), checksums = new Map();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) fail('Office ZIP 目录损坏，无法可靠提取文字。');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10), uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    if (flags & 1 || ![0, 8].includes(method) || uncompressed === 0xffffffff || offset + 46 + nameLength + extraLength + commentLength > end) fail('Office ZIP 包含加密、异常压缩或损坏内容，无法提取。');
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES) fail('Office 文件展开后超过 64 MB，请移除大型附件或拆分文件。');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (sizes.has(name)) fail('Office ZIP 包含重复内部文件，无法可靠确定正文。');
    sizes.set(name, uncompressed); checksums.set(name, buffer.readUInt32LE(offset + 16));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) fail('Office ZIP 目录长度不一致，文件可能损坏。');
  return { sizes, checksums };
}

function consumeEntry(entry, onChunk, expectedCrc) {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    let ended = false, checksum = 0;
    const stop = error => { if (ended) return; ended = true; stream.destroy(); reject(error); };
    stream.on('data', chunk => { if (ended) return; try { checksum = crc32(chunk, checksum); onChunk(chunk); } catch (error) { stop(error); } });
    stream.once('error', stop);
    stream.once('end', () => { if (!ended) { ended = true; if (expectedCrc === undefined || checksum !== expectedCrc) reject(new ReferenceTextError('Office 内部文件校验失败，内容可能已损坏。')); else resolve(); } });
  });
}

async function readXml(zip, filename, budget) {
  const entry = zip.file(filename);
  if (!entry) fail('Office 缺少必要的正文或页面文件，无法提取文字。');
  const chunks = [];
  let bytes = 0;
  await consumeEntry(entry, chunk => {
    bytes += chunk.length; budget.bytes += chunk.length;
    if (bytes > MAX_XML_BYTES || budget.bytes > MAX_XML_TOTAL) fail('Office XML 展开内容过大，请拆分文件后提取。');
    chunks.push(chunk);
  }, budget.checksums.get(filename));
  return strictText(Buffer.concat(chunks, bytes), true);
}

function parseXml(xml, loadModule, handlers) {
  const { SaxesParser } = loadModule('saxes');
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => fail('Office XML 含 DTD 或自定义实体，暂不支持提取。'));
  parser.on('error', () => fail('Office XML 损坏或包含无效实体，无法可靠提取文字。'));
  for (const [name, handler] of Object.entries(handlers)) parser.on(name, handler);
  parser.write(xml).close();
}

function bodyText(xml, namespaces, loadModule, word = false) {
  const parts = [];
  let length = 0, textDepth = 0, bodyDepth = word ? 0 : 1;
  const append = value => { length += value.length; if (length > MAX_TEXT) fail('参考正文超过 10 万字符，请拆分后提取。'); parts.push(value); };
  const onText = value => { if (textDepth && bodyDepth) append(value); };
  parseXml(xml, loadModule, {
    opentag: tag => {
      if (!namespaces.has(tag.uri)) return;
      if (word && tag.local === 'body') bodyDepth++;
      if (tag.local === 't') textDepth++;
      if (bodyDepth && ['tab', 'br', 'cr'].includes(tag.local)) append(tag.local === 'tab' ? '\t' : '\n');
    },
    text: onText, cdata: onText,
    closetag: tag => {
      if (!namespaces.has(tag.uri)) return;
      if (bodyDepth && tag.local === 'p') append('\n');
      if (tag.local === 't') textDepth--;
      if (word && tag.local === 'body') bodyDepth--;
    },
  });
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function attribute(tag, name, relationship = false) { return Object.values(tag.attributes).find(item => item.local === name && (!relationship || item.uri.endsWith('/relationships')))?.value; }

async function slidePaths(zip, budget, loadModule) {
  const relationships = new Map(), ids = [];
  parseXml(await readXml(zip, 'ppt/_rels/presentation.xml.rels', budget), loadModule, { opentag: tag => {
    if (tag.local !== 'Relationship' || !attribute(tag, 'Type')?.endsWith('/slide')) return;
    if (attribute(tag, 'TargetMode') === 'External') fail('PPTX 存在外部幻灯片引用，无法作为本机正文提取。');
    const target = attribute(tag, 'Target');
    if (!target || /^[a-z]+:/i.test(target) || target.startsWith('//')) fail('PPTX 幻灯片引用无效。');
    const filename = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('ppt', target));
    if (filename.startsWith('../')) fail('PPTX 幻灯片引用超出文档内部。');
    relationships.set(attribute(tag, 'Id'), filename);
  } });
  parseXml(await readXml(zip, 'ppt/presentation.xml', budget), loadModule, { opentag: tag => { if (tag.local === 'sldId') ids.push(attribute(tag, 'id', true)); } });
  if (!ids.length || ids.length > 500) fail('PPTX 没有可读取的幻灯片，或页数超过 500 页。');
  return ids.map(id => { const filename = relationships.get(id); if (!filename) fail('PPTX 页面顺序引用损坏。'); return filename; });
}

async function extractDocx(zip, loadModule, checksums) {
  const text = bodyText(await readXml(zip, 'word/document.xml', { bytes: 0, checksums }), WORD_NAMESPACES, loadModule, true);
  if (!text) fail('DOCX 没有可提取的正文文字，可能仅含扫描图片；请先做 OCR 或提供文字版。');
  return limited(`【DOCX 正文纯文字，不含图片内文字、页眉页脚及原稿版式】\n${text}`);
}

async function extractPptx(zip, loadModule, checksums) {
  const budget = { bytes: 0, checksums }, result = ['【PPTX 逐页纯文字，不含图片内文字、动画与原稿版式】'];
  const files = await slidePaths(zip, budget, loadModule);
  let anyText = false;
  for (let index = 0; index < files.length; index++) {
    const text = bodyText(await readXml(zip, files[index], budget), DRAW_NAMESPACES, loadModule);
    anyText ||= Boolean(text);
    result.push(`第 ${index + 1} 页\n${text || '（本页无可提取文字，未对图像执行 OCR）'}`);
    limited(result.join('\n\n'));
  }
  if (!anyText) fail('PPTX 没有可提取文字，可能仅含扫描图或图片；请先做 OCR 或提供文字版。');
  return result.join('\n\n');
}

function savedValue(value) {
  if (value === undefined || value === null) return '无';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '无效日期' : value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(item => item.text || '').join('');
    if (value.error) return `错误 ${value.error}`;
    if (typeof value.text === 'string') return value.hyperlink ? `${value.text}（链接 ${value.hyperlink}）` : value.text;
    fail('XLSX 含暂不支持的单元格内容，请先转换为普通值。');
  }
  return String(value);
}

async function verifyXlsxExpansion(zip, checksums) {
  let total = 0, xmlTotal = 0;
  for (const entry of Object.values(zip.files).filter(item => !item.dir)) {
    const xml = /^xl\/.+\.xml$/.test(entry.name);
    let size = 0;
    await consumeEntry(entry, chunk => {
      size += chunk.length; total += chunk.length; if (xml) xmlTotal += chunk.length;
      if (total > MAX_EXPANDED_BYTES || xml && (size > MAX_XML_BYTES || xmlTotal > MAX_XML_TOTAL)) fail('XLSX 实际展开内容超过读取上限，请减少行数或大型附件后重试。');
    }, checksums.get(entry.name));
  }
}

async function extractXlsx(buffer, sizes, zip, loadModule, checksums) {
  let xmlBytes = 0;
  for (const [name, size] of sizes) if (/^xl\/.+\.xml$/.test(name)) { if (size > MAX_XML_BYTES) fail('XLSX 单个 XML 内容超过 4 MB，请减少行数或拆分。'); xmlBytes += size; }
  if (xmlBytes > MAX_XML_TOTAL) fail('XLSX XML 总量超过 16 MB，请拆分工作簿。');
  await verifyXlsxExpansion(zip, checksums);
  const ExcelJS = loadModule('exceljs'), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const result = ['【XLSX 已保存的单元格内容与公式；未执行重算，缓存可能过期；不保留原稿版式】'];
  let length = result[0].length, cells = 0;
  const append = value => { length += value.length + 1; if (length > MAX_TEXT) fail('XLSX 提取后超过 10 万字符，请减少工作表或拆分文件。'); result.push(value); };
  if (workbook.worksheets.length > 100) fail('XLSX 超过 100 张工作表，请拆分文件。');
  workbook.eachSheet(sheet => {
    append(`工作表《${sheet.name}》`);
    sheet.eachRow(row => row.eachCell(cell => {
      if (cell.isMerged && cell.master.address !== cell.address || cell.value === null || cell.value === undefined) return;
      if (++cells > 20000) fail('XLSX 超过 20000 个非空单元格，请拆分文件。');
      const formula = cell.formula;
      append(`${cell.address}：${formula ? `公式 =${formula}；已保存缓存 ${savedValue(cell.result)}（未重算）` : savedValue(cell.value)}`);
    }));
  });
  if (!cells) fail('XLSX 没有可提取的单元格文字或数值，请提供有内容的工作表。');
  return result.join('\n');
}

async function extractReferenceText(file, loadModule = require) {
  const mimeType = typeof file?.mimeType === 'string' ? file.mimeType.split(';')[0].trim().toLowerCase() : '';
  if (mimeType === 'application/pdf' || !mimeType.startsWith('text/') && mimeType !== 'application/json' && !Object.values(OFFICE).includes(mimeType)) return null;
  if (!(file.buffer instanceof Uint8Array)) fail('参考文件缺少有效的二进制内容。');
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    if (buffer.length > MAX_TEXT * 4 + 3) fail('参考文字超过 10 万字符，请拆分或精简后重新添加。');
    const text = limited(strictText(buffer));
    if (!text.trim()) fail('参考文件没有可提取的文字，请选择有内容的文字文件。');
    return text;
  }
  try {
    const { sizes, checksums } = checkZip(buffer);
    const JSZip = loadModule('jszip');
    const zip = await JSZip.loadAsync(buffer);
    if (mimeType === OFFICE.docx) return await extractDocx(zip, loadModule, checksums);
    if (mimeType === OFFICE.pptx) return await extractPptx(zip, loadModule, checksums);
    return await extractXlsx(buffer, sizes, zip, loadModule, checksums);
  } catch (error) {
    if (error instanceof ReferenceTextError) throw error;
    throw new ReferenceTextError('Office 文件无法可靠提取文字，可能已损坏、加密或格式不受支持；请另存为普通文字或新版 Office 文件。');
  }
}

module.exports = { extractReferenceText };
