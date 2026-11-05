const { extractReferenceText } = require('./reference-text.cjs');

async function inspectOfficePreviewInput(source, loadModule = require) {
  // Reuse the bounded OOXML directory/CRC/XML checks before asking an Office process to open a copy.
  await extractReferenceText(source, loadModule);
  const Zip = loadModule('jszip'), { SaxesParser } = loadModule('saxes');
  const zip = await Zip.loadAsync(source.buffer, { checkCRC32: true });
  const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  if (files.some(name => /(?:vbaProject|\/embeddings\/|\/externalLinks\/|ActiveX)/i.test(name))) throw new Error('此文件包含宏、嵌入对象或外部链接，不能进行自动预览；原文件已保留。');
  for (const name of files.filter(name => /(?:\.rels$|(?:document|sheet\d+)\.xml$)/i.test(name))) {
    const xml = await zip.file(name).async('string'); if (xml.length > 4 * 1024 * 1024) throw new Error('Office 预览 XML 内容过大，请拆分文件。');
    const parser = new SaxesParser({ xmlns: true }); let mode = '', text = '';
    parser.on('doctype', () => { throw new Error('Office 预览不接受 DTD。'); });
    parser.on('opentag', tag => {
      if (tag.local === 'Relationship') { const attrs = Object.fromEntries(Object.values(tag.attributes).map(item => [item.local, item.value])); if (attrs.TargetMode === 'External' && !String(attrs.Type).endsWith('/hyperlink')) throw new Error('此文件引用外部资源，请在原编辑器中解除外部链接后再预览。'); }
      if (['f', 'instrText', 'fldSimple'].includes(tag.local)) { mode = tag.local; text = tag.attributes['w:instr']?.value || ''; }
    });
    parser.on('text', value => { if (mode) text += value; });
    parser.on('closetag', tag => { if (mode === tag.local) { if (/(?:WEBSERVICE|DDE|RTD|SQL\.REQUEST|REGISTER\.ID|INCLUDEPICTURE|INCLUDETEXT|\bLINK\b|\bCALL\s*\()/i.test(text)) throw new Error('此文件包含需要外部执行或联网的字段/公式，请使用本机编辑器查看。'); mode = ''; text = ''; } });
    parser.write(xml).close();
  }
}
module.exports = { inspectOfficePreviewInput };
