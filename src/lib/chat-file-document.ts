import type { EditorDocument, EditorSlide, WordBlock } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { parseChatMarkdown } from './chat-markdown';
import type { ChatMarkdownElement, ChatMarkdownNode } from './chat-markdown';
import { WORD_TABLE_MAX_COLUMNS, WORD_TABLE_MAX_ROWS } from './word-table';

export type ChatFileKind = 'word' | 'ppt' | 'excel';
const id = () => crypto.randomUUID();
const element = (node: ChatMarkdownNode, tag: string): node is ChatMarkdownElement => node.type === 'element' && node.tag === tag;
function textParts(text: string, limit: number): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
export function chatNodeText(node: ChatMarkdownNode): string {
  if (node.type === 'text') return node.value;
  if (node.tag === 'br') return '\n';
  const block = (child: ChatMarkdownNode) => child.type === 'element' && ['p', 'ul', 'ol', 'li', 'blockquote'].includes(child.tag);
  const content = node.children.map((child, index) => `${index && (block(child) || block(node.children[index - 1])) ? '\n' : ''}${chatNodeText(child)}`).join('');
  return node.tag === 'a' && node.href && content !== node.href ? `${content}（${node.href}）` : content;
}
function tableRows(node: ChatMarkdownElement): string[][] {
  const rows: string[][] = [];
  const visit = (current: ChatMarkdownElement) => {
    if (current.tag === 'tr') rows.push(current.children.filter((cell): cell is ChatMarkdownElement => cell.type === 'element' && ['th', 'td'].includes(cell.tag)).map(chatNodeText));
    else for (const child of current.children) if (child.type === 'element') visit(child);
  };
  visit(node); return rows;
}
export function chatReplyTables(nodes: ChatMarkdownNode[]): ChatMarkdownElement[] {
  const tables: ChatMarkdownElement[] = [];
  for (const node of nodes) if (node.type === 'element') { if (node.tag === 'table') tables.push(node); else tables.push(...chatReplyTables(node.children)); }
  return tables;
}
function wordDocument(nodes: ChatMarkdownNode[], title: string): EditorDocument {
  const blocks: WordBlock[] = [], base = { fontSize: 12, bold: false, italic: false, align: 'left' as const };
  const add = (type: WordBlock['type'], text: string, style: Partial<WordBlock> = {}) => {
    if (text.length > 20000) { for (const part of textParts(text, 20000)) blocks.push({ id: id(), type, text: part, ...base, ...style }); }
    else blocks.push({ id: id(), type, text, ...base, ...style });
  };
  const visit = (items: ChatMarkdownNode[], depth = 0) => {
    for (const node of items) {
      if (node.type === 'text') { if (node.value.trim()) add('paragraph', node.value); continue; }
      if (node.tag === 'blockquote') { visit(node.children, depth); continue; }
      if (node.tag === 'ul' || node.tag === 'ol') {
        let number = node.start ?? 1;
        for (const item of node.children.filter(child => element(child, 'li')) as ChatMarkdownElement[]) {
          const inline = item.children.filter(child => !(child.type === 'element' && ['ul', 'ol'].includes(child.tag)));
          const marker = item.taskChecked === undefined ? node.tag === 'ol' ? `${number++}. ` : '' : item.taskChecked ? '☑ ' : '☐ ';
          add(node.tag === 'ul' && item.taskChecked === undefined ? 'bullet' : 'paragraph', '  '.repeat(depth) + marker + inline.map(chatNodeText).join('\n'));
          visit(item.children.filter(child => child.type === 'element' && ['ul', 'ol'].includes(child.tag)), depth + 1);
        }
      } else if (node.tag === 'table') {
        const rows = tableRows(node), count = rows[0]?.length || 0;
        if (!count || count > WORD_TABLE_MAX_COLUMNS || rows.length > WORD_TABLE_MAX_ROWS) throw Error('Word 表格最多30行、12列，请单独保存为 Excel，或拆分后存入 Word。');
        blocks.push({ id: id(), type: 'table', text: '', ...base, table: { header: true, borders: true, columns: Array.from({ length: count }, () => ({ id: id() })), rows: rows.map(row => ({ id: id(), cells: Array.from({ length: count }, (_, index) => ({ id: id(), text: row[index] || '' })) })) } });
      } else if (/^h[1-6]$/.test(node.tag)) add('heading', chatNodeText(node), { bold: true, fontSize: Math.max(14, 26 - Number(node.tag.slice(1)) * 2) });
      else if (node.tag !== 'hr') add('paragraph', chatNodeText(node), node.tag === 'pre' ? { fontSize: 11 } : {});
    }
  };
  visit(nodes); if (!blocks.length || blocks.length > 500) throw Error('请保存1–500个段落的内容，较长回复可拆分保存。');
  return { schemaVersion: 1, kind: 'word', title, blocks };
}
function presentation(nodes: ChatMarkdownNode[], title: string): EditorDocument {
  const groups: { title: string; parts: string[] }[] = []; let current = { title, parts: [] as string[] };
  const add = () => { if (current.parts.length || current.title !== title || !groups.length) groups.push(current); };
  for (const node of nodes) {
    if (node.type === 'element' && /^h[1-6]$/.test(node.tag)) { if (current.parts.length || current.title !== title) add(); current = { title: chatNodeText(node), parts: [] }; }
    else if (node.type === 'element' && node.tag === 'table') current.parts.push(tableRows(node).map(row => row.join('\t')).join('\n'));
    else if (!(node.type === 'element' && node.tag === 'hr')) { const text = chatNodeText(node); if (text.trim()) current.parts.push(text); }
  }
  add(); const slides: EditorSlide[] = [];
  for (const group of groups) {
    const body = [group.title.length > 110 ? group.title : '', ...group.parts].filter(Boolean).join('\n\n'), pieces: string[] = []; let part = '';
    for (const line of body.split('\n')) {
      if (part.length + line.length > 650 && part) { pieces.push(part); part = ''; }
      if (line.length > 650) { if (part) { pieces.push(part); part = ''; } pieces.push(...textParts(line, 650)); }
      else part += (part ? '\n' : '') + line;
    }
    if (part || !pieces.length) pieces.push(part);
    for (const [index, text] of pieces.entries()) slides.push({ id: id(), title: `${textParts(group.title, 110)[0] || ''}${index ? `（续${index + 1}）` : ''}`, body: text, notes: '', layout: 'title-body', fontSize: text.length > 400 ? 18 : 22, align: 'left' });
  }
  if (!slides.length || slides.length > 100) throw Error('这份提纲超过可直接保存的100页，请拆分内容。');
  return { schemaVersion: 1, kind: 'ppt', title, theme: 'paper', slides };
}
function spreadsheet(nodes: ChatMarkdownNode[], title: string): SpreadsheetDocument {
  const tables = chatReplyTables(nodes); if (!tables.length || tables.length > 20) throw Error('请选用包含1–20张表格的回复保存 Excel。');
  return { schemaVersion: 1, kind: 'excel', title, sheets: tables.map((table, index) => {
    const rows = tableRows(table), columnCount = Math.max(...rows.map(row => row.length));
    if (!columnCount || columnCount > 100 || rows.length > 1000) throw Error('单张表格最多100列、1000行，请拆分保存。');
    const address = (column: number) => { let value = column + 1, label = ''; while (value) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); } return label; };
    const cells: SpreadsheetDocument['sheets'][number]['cells'] = {};
    rows.forEach((row, r) => row.forEach((value, c) => { cells[`${address(c)}${r + 1}`] = { value, bold: r === 0, format: 'general', align: 'left' }; }));
    return { id: id(), name: `表格${index + 1}`, rowCount: Math.max(2, rows.length), columnCount, cells, view: { header: true }, columnWidths: Object.fromEntries(Array.from({ length: columnCount }, (_, column) => [address(column), 160])) };
  }) };
}
export function chatFileDocument(source: string, kind: ChatFileKind, title: string): EditorDocument | SpreadsheetDocument {
  if (!source.trim() || source.length > 120000 || !title.trim() || title.length > 120) throw Error('请填写标题，并将较长回复拆分后保存。');
  const nodes = parseChatMarkdown(source), document = kind === 'word' ? wordDocument(nodes, title.trim()) : kind === 'ppt' ? presentation(nodes, title.trim()) : spreadsheet(nodes, title.trim());
  if (JSON.stringify(document).length > 98000) throw Error('这份内容较长，请拆分为多个文件，避免保存不完整。');
  return document;
}
