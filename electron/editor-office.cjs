const { validateEditorDocument, THEMES } = require('./editor-document.cjs');
const FONT = 'Microsoft YaHei';
function imageFor(images, id) { const image = images.find(item => item.id === id); if (!image) throw new Error('文档插图不可用，请重新选择后导出。'); return image; }
function fitImage(image, box) {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale, h = image.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
async function writeEditorPresentation(input, images, loadModule, report) {
  const document = validateEditorDocument(input);
  const PptxGenJS = loadModule('pptxgenjs'), pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = '序作工作台'; pptx.title = document.title; pptx.lang = 'zh-CN';
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: 'zh-CN' };
  const theme = THEMES[document.theme];
  for (const [index, item] of document.slides.entries()) {
    const slide = pptx.addSlide(); slide.background = { color: theme.background };
    slide.addText(item.title, { x: 0.65, y: 0.45, w: 12.03, h: 1.05, fontFace: FONT, fontSize: 30, color: theme.text, bold: true, margin: 0, valign: 'mid', breakLine: false, fit: 'shrink' });
    const body = { x: 0.75, y: 1.85, w: 11.83, h: 4.85 };
    const textOptions = box => ({ ...box, fontFace: FONT, fontSize: item.fontSize, color: theme.text, align: item.align, margin: 0.02, valign: 'top', breakLine: false, fit: 'shrink', paraSpaceAfterPt: 8 });
    if (item.layout === 'two-columns') {
      const separator = item.body.indexOf('\n---\n'), lines = item.body.split('\n'), middle = Math.ceil(lines.length / 2);
      const columns = separator < 0 ? [lines.slice(0, middle).join('\n'), lines.slice(middle).join('\n')] : [item.body.slice(0, separator), item.body.slice(separator + 5)];
      slide.addText(columns[0], textOptions({ ...body, w: 5.65 }));
      slide.addText(columns[1], textOptions({ ...body, x: 6.93, w: 5.65 }));
    } else if (item.layout === 'image-right' && item.imageId) {
      slide.addText(item.body, textOptions({ ...body, w: 5.65 }));
      const image = imageFor(images, item.imageId);
      slide.addImage({ data: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`, ...fitImage(image, { x: 6.93, y: 1.85, w: 5.65, h: 4.85 }), altText: image.name });
    } else if (item.layout === 'image-full' && item.imageId) {
      const image = imageFor(images, item.imageId);
      slide.addImage({ data: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`, ...fitImage(image, { x: 0.75, y: 1.65, w: 11.83, h: 4.45 }), altText: image.name });
      slide.addText(item.body, textOptions({ x: 0.75, y: 6.2, w: 11.83, h: 0.55 }));
    } else slide.addText(item.body, textOptions(body));
    if (item.imageId && !['image-right', 'image-full'].includes(item.layout)) report.warnings.push(`第${index + 1}页选择了图片但当前版式未显示；请选择图文或图片版式。`);
    if (item.body.length > 700) report.warnings.push(`第${index + 1}页正文较长，导出已在原页内适配文字，请人工检查字号与可读性。`);
    slide.addText(`${index + 1} / ${document.slides.length}`, { x: 11.65, y: 7.04, w: 1, h: 0.2, fontFace: FONT, fontSize: 10, color: theme.accent, margin: 0, align: 'right' });
    if (item.notes) slide.addNotes(item.notes);
  }
  report.pages = document.slides.length; report.editorSchemaVersion = 1; report.editorLayoutPreserved = true;
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
async function writeEditorDocument(input, images, loadModule, report) {
  const document = validateEditorDocument(input);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = loadModule('docx');
  const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
  const children = [new Paragraph({ text: document.title, heading: HeadingLevel.TITLE })];
  for (const block of document.blocks) {
    if (block.type === 'table') {
      const border = { style: block.table.borders ? BorderStyle.SINGLE : BorderStyle.NONE, size: block.table.borders ? 4 : 0, color: 'B8C0CE' };
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: block.table.rows.map((row, rowIndex) => new TableRow({
          tableHeader: block.table.header && rowIndex === 0,
          children: row.cells.map(cell => new TableCell({
            width: { size: 100 / block.table.columns.length, type: WidthType.PERCENTAGE },
            ...(block.table.header && rowIndex === 0 ? { shading: { fill: 'F0F2F7' } } : {}),
            children: [new Paragraph({ alignment: alignment[block.align], children: cell.text.split('\n').map((line, index) => new TextRun({ text: line, font: FONT, size: block.fontSize * 2, bold: block.bold || block.table.header && rowIndex === 0, italics: block.italic, ...(index ? { break: 1 } : {}) })), spacing: { after: 80, line: 300 } })],
          })),
        })),
      }));
    } else if (block.type === 'image') {
      const image = imageFor(images, block.imageId), factor = Math.min(540 / image.width, 600 / image.height);
      children.push(new Paragraph({ alignment: alignment[block.align], children: [new ImageRun({ type: image.mimeType === 'image/png' ? 'png' : 'jpg', data: image.buffer, transformation: { width: Math.round(image.width * factor), height: Math.round(image.height * factor) }, altText: { title: image.name, description: block.text, name: image.name } })] }));
      if (block.text) children.push(new Paragraph({ alignment: alignment[block.align], children: [new TextRun({ text: block.text, size: block.fontSize * 2, bold: block.bold, italics: block.italic })], spacing: { after: 160 } }));
    } else children.push(new Paragraph({ alignment: alignment[block.align], ...(block.type === 'heading' ? { heading: HeadingLevel.HEADING_1, keepNext: true } : {}), ...(block.type === 'bullet' ? { bullet: { level: 0 } } : {}), children: block.text.split('\n').map((line, index) => new TextRun({ text: line, font: FONT, size: block.fontSize * 2, bold: block.bold, italics: block.italic, ...(index ? { break: 1 } : {}) })), spacing: { after: 160, line: 330 } }));
  }
  report.paragraphs = document.blocks.filter(block => block.type !== 'table').length; report.tables = document.blocks.filter(block => block.type === 'table').length; report.editorSchemaVersion = 1;
  const file = new Document({ creator: '序作工作台', title: document.title, styles: { default: { document: { run: { font: FONT, size: 24, color: '243047' } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } }, children }] });
  return Packer.toBuffer(file);
}
module.exports = { writeEditorPresentation, writeEditorDocument };
