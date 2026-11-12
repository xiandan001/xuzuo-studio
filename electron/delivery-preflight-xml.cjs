function xmlTree(source, loadModule = require) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) throw Error('预检 XML 超过4MB，请拆分文件。');
  const { SaxesParser } = loadModule('saxes'), root = { name: '', attrs: {}, children: [], text: '' }, stack = [root]; let nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw Error('预检不接受自定义 XML 实体。'); });
  parser.on('opentag', tag => {
    if (++nodes > 120000 || stack.length > 48) throw Error('预检 XML 结构过大或过深。');
    const node = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(item => [item.name, item.value])), children: [], text: '' };
    stack.at(-1).children.push(node); stack.push(node);
  });
  parser.on('text', text => { stack.at(-1).text += text; });
  parser.on('closetag', () => stack.pop()); parser.write(source).close(); return root;
}
function attr(node, name) { return node?.attrs?.[name] ?? Object.entries(node?.attrs || {}).find(([key]) => key.endsWith(':' + name))?.[1]; }
function all(node, name) { const result = []; const visit = item => { if (item.name === name) result.push(item); for (const child of item.children || []) visit(child); }; visit(node); return result; }
function child(node, name) { return node?.children?.find(item => item.name === name); }
function words(node) { return all(node, 't').map(item => item.text).join(' ').replace(/\s+/g, ' ').trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
module.exports = { xmlTree, attr, all, child, words, number };
