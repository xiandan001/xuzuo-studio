const { randomUUID } = require('node:crypto');
const { validateEditorDocument } = require('./editor-document.cjs');
const { validateSpreadsheetDocument, calculateSpreadsheet, columnLabel } = require('./spreadsheet-engine.cjs');
const { imageType, rasterDimensions, validateSvg } = require('./image-output-formats.cjs');

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const MAX_PAGES = 200, MAX_HTML = 16 * 1024 * 1024;
const themes = { paper: ['#F7F8FC', '#243047'], violet: ['#F0ECFC', '#30264F'], forest: ['#EDF3ED', '#294934'], night: ['#202A3E', '#F4F6FC'] };
function imageUrl(file) {
  if (!file?.buffer?.length || file.buffer.length > 20 * 1024 * 1024) throw Error('校样图片为空或超过20MB，请先导出较小预览。');
  const actual = imageType(file.buffer); if (actual.mimeType !== file.mimeType) throw Error('校样图片真实格式与登记不一致。');
  if (file.mimeType === 'image/svg+xml') validateSvg(file.buffer);
  const size = rasterDimensions(file.buffer); if (size.width * size.height > 67108864) throw Error('校样图片像素过大，请先缩小预览。');
  return `data:${file.mimeType};base64,${Buffer.from(file.buffer).toString('base64')}`;
}
async function createProofPages(files, { readDocument, readImage, previewImage }) {
  const pages = [], imageCache = new Map(); let htmlBytes = 0;
  function add(file, title, html, locators = {}, data = {}) {
    if (pages.length >= MAX_PAGES) throw Error('本次校样超过200页，请按文件分批导出。');
    htmlBytes += Buffer.byteLength(html); if (htmlBytes > MAX_HTML) throw Error('校样预览超过16MB，请减少文件或图片尺寸。');
    pages.push({ id: randomUUID(), fileKey: file.key, title, html, locators, ...data });
  }
  async function picture(id, projectId, alt) {
    const key = `${projectId}/${id}`;
    if (!imageCache.has(key)) imageCache.set(key, imageUrl(await readImage(id, projectId)));
    return `<img class="proof-image" alt="${escape(alt)}" src="${imageCache.get(key)}">`;
  }
  for (const file of files) {
    if (file.kind === 'image') { const preview = previewImage ? await previewImage(file) : file; add(file, file.name, `<article class="proof-artwork"><img class="proof-image" alt="${escape(file.name)}" src="${imageUrl(preview)}"></article>`); continue; }
    const source = await readDocument?.(file);
    if (!source?.document) throw Error(`“${file.name}”没有绑定的可编辑校样源，请先在工作台保存并导出当前版本。`);
    const document = source.document.kind === 'excel' ? validateSpreadsheetDocument(source.document) : validateEditorDocument(source.document);
    file.sourceRevision = source.sourceRevision;
    if (document.kind === 'word') {
      for (let index = 0; index < document.blocks.length; index += 20) {
        const locators = {}, body = [];
        for (const block of document.blocks.slice(index, index + 20)) {
          const id = randomUUID(); locators[id] = { blockId: block.id, text: (block.type === 'bullet' ? '• ' : '') + (block.text || (block.table ? block.table.rows.map(row => row.cells.map(cell => cell.text).join(' ')).join(' ') : '')) };
          const style = `font-size:${block.fontSize * 4 / 3}px;font-weight:${block.bold ? 700 : 400};font-style:${block.italic ? 'italic' : 'normal'};text-align:${block.align}`;
          let content;
          if (block.type === 'image' && block.imageId) content = await picture(block.imageId, file.projectId, block.text);
          else if (block.type === 'table' && block.table) content = `<div class="table-scroll"><table>${block.table.rows.map((row, rowIndex) => `<tr>${row.cells.map(cell => `<${block.table.header && rowIndex === 0 ? 'th' : 'td'}>${escape(cell.text)}</${block.table.header && rowIndex === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table></div>`;
          else content = `${block.type === 'bullet' ? '• ' : ''}${escape(block.text)}`;
          body.push(`<${block.type === 'heading' ? 'h2' : 'div'} data-locator="${id}" class="proof-block" style="${style}">${content}</${block.type === 'heading' ? 'h2' : 'div'}>`);
        }
        add(file, `${file.name} · 内容页 ${Math.floor(index / 20) + 1}`, `<article class="proof-word"><h1>${escape(document.title)}</h1>${body.join('')}</article>`, locators, { sourceRevision: source.sourceRevision });
      }
    } else if (document.kind === 'ppt') {
      const theme = themes[document.theme];
      for (const [index, slide] of document.slides.entries()) {
        const titleId = randomUUID(), bodyId = randomUUID(), locators = { [titleId]: { pageId: slide.id, text: slide.title }, [bodyId]: { pageId: slide.id, text: slide.body } };
        const image = slide.imageId ? await picture(slide.imageId, file.projectId, slide.title) : '';
        const html = `<article class="proof-slide layout-${slide.layout}" style="background:${theme[0]};color:${theme[1]}"><h1 data-locator="${titleId}">${escape(slide.title)}</h1><div class="slide-body" data-locator="${bodyId}" style="font-size:${slide.fontSize * 4 / 3}px;text-align:${slide.align}">${escape(slide.body)}</div>${image}<small>${index + 1} / ${document.slides.length}</small></article>`;
        add(file, `${file.name} · 第 ${index + 1} 页`, html, locators, { sourcePageId: slide.id, sourceRevision: source.sourceRevision });
      }
    } else {
      const calculated = calculateSpreadsheet(document);
      for (const sheet of document.sheets) for (let row = 1; row <= sheet.rowCount; row += 25) for (let column = 1; column <= sheet.columnCount; column += 20) {
        const lastRow = Math.min(sheet.rowCount, row + 24), lastColumn = Math.min(sheet.columnCount, column + 19), locators = {}, rows = [];
        rows.push(`<tr><th></th>${Array.from({ length: lastColumn - column + 1 }, (_, offset) => `<th>${columnLabel(column + offset)}</th>`).join('')}</tr>`);
        for (let y = row; y <= lastRow; y++) {
          const cells = [];
          for (let x = column; x <= lastColumn; x++) {
            const address = `${columnLabel(x)}${y}`, cell = sheet.cells[address], result = calculated.cells[sheet.id]?.[address];
            const value = result?.status === 'error' || result?.status === 'unsupported' ? result.error || '公式待检查' : result?.value ?? cell?.value ?? '';
            const id = randomUUID(); locators[id] = { sheetId: sheet.id, cellAddress: address, text: String(value) };
            cells.push(`<td data-locator="${id}" style="font-weight:${cell?.bold ? 700 : 400};text-align:${cell?.align || 'left'}">${escape(value)}</td>`);
          }
          rows.push(`<tr><th>${y}</th>${cells.join('')}</tr>`);
        }
        add(file, `${file.name} · ${sheet.name} ${columnLabel(column)}${row}:${columnLabel(lastColumn)}${lastRow}`, `<article class="proof-sheet"><h1>${escape(document.title)} · ${escape(sheet.name)}</h1><div class="table-scroll"><table>${rows.join('')}</table></div></article>`, locators, { sourceRevision: source.sourceRevision, sheetId: sheet.id });
      }
    }
  }
  if (!pages.length) throw Error('没有可用于校样的已保存内容。');
  return pages;
}
module.exports = { createProofPages, imageUrl, escape };
