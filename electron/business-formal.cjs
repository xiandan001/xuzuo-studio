const path = require('node:path');
const { crc32 } = require('node:zlib');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const LIMIT = 100 * 1024 * 1024;
const OFFICE = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', csv: 'text/csv', json: 'application/json', zip: 'application/zip', docx: Object.keys(OFFICE)[0], pptx: Object.keys(OFFICE)[1], xlsx: Object.keys(OFFICE)[2] };
function noPrivateFields(value, depth = 0) {
  if (depth > 20) throw Error('工程JSON嵌套过深，请重新导出正式工程。');
  if (!value || typeof value !== 'object') return;
  for (const [name, child] of Object.entries(value)) { if (/^(?:api[_-]?key|secret|credentials?|authorization|prompt|ledger|billing|access[_-]?token)$/i.test(name)) throw Error('正式工程含内部凭据、提示词或费用字段，请使用专用正式导出。'); noPrivateFields(child, depth + 1); }
}
async function boundedEntry(entry, maximum) {
  return new Promise((resolve, reject) => {
    let size = 0, checksum = 0, stopped = false; const chunks = [], stream = entry.internalStream('nodebuffer');
    const fail = error => { if (stopped) return; stopped = true; stream.pause(); reject(error); };
    stream.on('data', chunk => { if (stopped) return; size += chunk.length; if (size > maximum) return fail(Error('正式ZIP展开内容超过100MB，请拆分后再交付。')); checksum = crc32(chunk, checksum); chunks.push(chunk); });
    stream.on('error', fail); stream.on('end', () => { if (stopped) return; if (Number.isInteger(entry._data?.crc32) && checksum !== (entry._data.crc32 >>> 0)) return fail(Error('正式文件包条目校验失败，请重新导出。')); stopped = true; resolve(Buffer.concat(chunks, size)); }); stream.resume();
  });
}
function validateOfficeParts(parts, mime, loadModule) {
  const { SaxesParser } = loadModule('saxes'), main = OFFICE[mime], kind = main.split('/')[0], namespaces = { word: ['document', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'], ppt: ['presentation', 'http://schemas.openxmlformats.org/presentationml/2006/main'], xl: ['workbook', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'] };
  const expected = { '[Content_Types].xml': ['Types', 'http://schemas.openxmlformats.org/package/2006/content-types'], '_rels/.rels': ['Relationships', 'http://schemas.openxmlformats.org/package/2006/relationships'], [main]: namespaces[kind] };
  for (const [name, [root, namespace]] of Object.entries(expected)) {
    const bytes = parts.get(name); if (!bytes?.length || bytes.length > 4 * 1024 * 1024) throw Error('Office缺少完整的类型、关系或正文XML，请重新导出。');
    const parser = new SaxesParser({ xmlns: true }); let first = true, override = name !== '[Content_Types].xml';
    parser.on('doctype', () => { throw Error('Office XML不能包含自定义实体。'); }); parser.on('error', () => { throw Error('Office正文XML不完整，请重新导出。'); });
    parser.on('opentag', node => { if (first) { first = false; const strict = 'http://purl.oclc.org/ooxml/' + { word: 'wordprocessingml', ppt: 'presentationml', xl: 'spreadsheetml' }[kind] + '/main'; if (node.local !== root || node.uri !== namespace && (name !== main || node.uri !== strict)) throw Error('Office正文或包类型与文件格式不一致。'); } if (name === '[Content_Types].xml' && node.local === 'Override' && node.attributes.PartName?.value === '/' + main && node.attributes.ContentType?.value === mime.replace(/\.document$|\.presentation$|\.sheet$/, '') + (kind === 'word' ? '.document.main+xml' : kind === 'ppt' ? '.presentation.main+xml' : '.sheet.main+xml')) override = true; });
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    parser.write(new TextDecoder(encoding, { fatal: true }).decode(bytes)).close(); if (first || !override) throw Error('Office缺少对应的正文类型声明。');
  }
}
async function validateBusinessFormalArtifact(file, { loadModule = require, depth = 0, budget = { remaining: LIMIT } } = {}) {
  if (!file || !(file.buffer instanceof Uint8Array) || !file.buffer.length || file.buffer.length > LIMIT || file.trashedAt || file.unavailable) throw Error('正式文件为空、不可用或超过100MB，请重新选择。');
  const bytes = Buffer.from(file.buffer), mime = String(file.mimeType || '').split(';')[0].trim().toLowerCase();
  if (/^image\//.test(mime)) { if (imageType(bytes).mimeType !== mime) throw Error('正式图片实际格式与登记不符。'); const size = rasterDimensions(bytes); if (!size.width || !size.height || size.width > 8192 || size.height > 8192 || size.width * size.height > 16000000) throw Error('正式图片超过8192单边或1600万像素，请先适配尺寸。'); return; }
  if (mime === 'application/pdf') { if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-' || !bytes.subarray(-4096).includes(Buffer.from('%%EOF'))) throw Error('PDF文件不完整，请重新导出。'); return; }
  if (mime === 'text/csv') { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return; }
  if (mime === 'application/json') {
    if (bytes.length > 8 * 1024 * 1024) throw Error('正式工程JSON超过8MB。');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); noPrivateFields(value);
    if (value?.type === 'xuzuo-bead-document') require('./bead-document.cjs').checkedBeadDocument(value);
    else if (value?.type === 'xuzuo-bead-pattern') { const issue = require('./bead-pattern.runtime.cjs').beadPatternIssue(value); if (issue) throw Error(issue); }
    else throw Error('这里只接受自包含的拼豆正式工程JSON；图层内部快照、模型配置与原稿不能进入客户包。');
    return;
  }
  if (!(mime in OFFICE) && mime !== 'application/zip') throw Error('请选择图片、PDF、CSV、Office或正式拼豆工程／套件。');
  if (depth > 2) throw Error('正式ZIP套嵌过多，请先整理成一套文件。');
  require('./backup-format.cjs').inspectZip(bytes);
  const zip = await loadModule('jszip').loadAsync(bytes), entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (!entries.length || entries.length > (mime in OFFICE ? 2000 : 128)) throw Error('正式文件包为空或条目过多。');
  if (mime in OFFICE) { if (!zip.file(OFFICE[mime]) || entries.some(entry => /(?:vbaProject|oleObject|ActiveX)/i.test(entry.name))) throw Error('Office文件类型不符或含活动组件，请导出标准DOCX/PPTX/XLSX。'); }
  const officeParts = new Map();
  for (const entry of entries) {
    const data = await boundedEntry(entry, budget.remaining); budget.remaining -= data.length;
    if (mime in OFFICE) { if (['[Content_Types].xml', '_rels/.rels', OFFICE[mime]].includes(entry.name)) officeParts.set(entry.name, data); continue; }
    if (entry.name.split('/').some(part => part.startsWith('.'))) throw Error('客户ZIP不能包含隐藏工程目录。');
    const extension = path.posix.extname(entry.name).slice(1).toLowerCase();
    if (['txt', 'md'].includes(extension)) { if (!/^(?:readme|licen[cs]e|使用说明|授权|文件说明|说明)/i.test(path.posix.basename(entry.name))) throw Error('ZIP包含未识别的文本原稿，请选择正式套件。'); new TextDecoder('utf-8', { fatal: true }).decode(data); continue; }
    if (!MIME[extension]) throw Error('ZIP包含不支持的程序或内部文件，请选择正式素材套件。');
    await validateBusinessFormalArtifact({ buffer: data, mimeType: MIME[extension], name: entry.name }, { loadModule, depth: depth + 1, budget });
  }
  if (mime in OFFICE) validateOfficeParts(officeParts, mime, loadModule);
}
module.exports = { validateBusinessFormalArtifact, boundedEntry };
