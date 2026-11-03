import type { EditorAlignment, EditorDocument, EditorKind, EditorSlide, WordBlock } from '../editor-types';
import { normalizeWordTable } from './word-table';

const APPENDIX = '待补充资料说明（非正文）';
const NOTE_MARKER = '【待补充资料说明（非正文）】';
const themes = ['paper', 'violet', 'forest', 'night'] as const;
const layouts = ['title-body', 'two-columns', 'image-right', 'image-full'] as const;
type Data = Record<string, unknown>;
function object(value: unknown, label: string): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}需要是有效对象，当前文稿未替换。`);
  return value as Data;
}
function text(value: unknown, label: string, max = 20000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}需要是完整文字，最多 ${max} 个字符。`);
  return value;
}
function fields(value: Data, allowed: string[], label: string) {
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra) throw new Error(`${label}包含暂不支持的字段“${extra}”，请保留原结果并调整内容格式。`);
}
function id(value: unknown): string {
  if (value === undefined) return crypto.randomUUID();
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error('生成内容的编号无效。');
  return value;
}
function style(item: Data, kind: EditorKind, heading = false) {
  const fontSize = item.fontSize ?? (kind === 'ppt' ? 20 : heading ? 18 : 12), align = item.align ?? 'left';
  if (!Number.isInteger(fontSize) || Number(fontSize) < (kind === 'ppt' ? 14 : 9) || Number(fontSize) > 32 || !['left', 'center', 'right'].includes(String(align))) throw new Error('生成文字的字号或对齐方式无效。');
  return { fontSize: Number(fontSize), align: align as EditorAlignment };
}
function block(type: WordBlock['type'], content: string): WordBlock {
  return { id: crypto.randomUUID(), type, text: content, ...style({}, 'word', type === 'heading'), bold: type === 'heading', italic: false };
}
function canonicalBlock(value: unknown): WordBlock {
  const item = object(value, 'Word 段落'); fields(item, ['id', 'type', 'text', 'fontSize', 'align', 'bold', 'italic', 'imageId', 'table'], 'Word 段落');
  if (!['paragraph', 'heading', 'bullet', 'image', 'table'].includes(String(item.type)) || typeof item.bold !== 'boolean' || typeof item.italic !== 'boolean') throw new Error('生成的 Word 段落格式无效。');
  if (item.type === 'image' && typeof item.imageId !== 'string' || item.type !== 'image' && item.imageId !== undefined) throw new Error('Word 图片段落需要有效 imageId，普通段落不能隐藏附带图片。');
  if (item.type === 'table' ? item.text !== '' : item.table !== undefined) throw new Error('Word 表格的 text 必须为空，普通段落不能附带表格。');
  return { id: id(item.id), type: item.type as WordBlock['type'], text: text(item.text, '段落正文'), ...style(item, 'word', item.type === 'heading'), bold: item.bold, italic: item.italic, ...(item.imageId !== undefined ? { imageId: id(item.imageId) } : {}), ...(item.type === 'table' ? { table: normalizeWordTable(item.table, true) } : {}) };
}
function slide(value: unknown, index: number): EditorSlide {
  const item = object(value, `第 ${index + 1} 页`); fields(item, ['id', 'title', 'body', 'bullets', 'notes', 'layout', 'fontSize', 'align', 'imageId'], 'PPT 页面');
  if (item.body !== undefined && item.bullets !== undefined) throw new Error(`第 ${index + 1} 页同时提供了 body 和 bullets，请明确使用一种正文格式。`);
  if (item.bullets !== undefined && !Array.isArray(item.bullets)) throw new Error(`第 ${index + 1} 页的 bullets 需要文字数组。`);
  const body = item.body !== undefined ? text(item.body, '页面正文', 5000) : Array.isArray(item.bullets) ? item.bullets.map(value => text(value, '页面要点', 5000)).join('\n') : '';
  if (body.length > 5000) throw new Error(`第 ${index + 1} 页正文超过 5000 字符，请明确拆页，当前页序未改变。`);
  const layout = item.layout ?? 'title-body'; if (!layouts.includes(layout as EditorSlide['layout'])) throw new Error('生成的 PPT 页面版式无效。');
  return { id: id(item.id), title: text(item.title ?? `第 ${index + 1} 页`, '页面标题', 120), body, notes: text(item.notes ?? '', '页面备注', 10000), layout: layout as EditorSlide['layout'], ...style(item, 'ppt'), ...(item.imageId !== undefined ? { imageId: id(item.imageId) } : {}) };
}
function metadata(value: unknown, depth = 0): string[] {
  if (value === undefined) return [];
  const data = object(value, 'meta 资料说明');
  if (depth > 3) throw new Error('meta 资料说明层级过多，请改用简明文字。');
  return Object.entries(data).flatMap(([key, value]) => {
    if (key === 'missingInputs' && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) throw new Error('meta.missingInputs 需要文字数组，不能忽略缺失资料。');
    const label = key === 'missingInputs' ? '待补充' : key === 'sources' ? '资料依据' : key === 'notes' ? '说明' : key;
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap(item => item && typeof item === 'object' ? metadata(item, depth + 1).map(line => `${label} · ${line}`) : item === null ? [`${label}：未提供`] : ['string', 'number', 'boolean'].includes(typeof item) ? [`${label}：${String(item)}`] : []);
  });
}
function parsedJson(raw: string): Data | undefined {
  const fenced = [...raw.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if (fenced.length > 1) throw new Error('生成结果含多段结构，请明确一份完整文稿后载入。');
  const candidate = fenced.length ? fenced[0][1].trim() : raw;
  if (!/^[{[]/.test(candidate)) { if (/```json/i.test(raw)) throw new Error('生成 JSON 不完整，当前文稿未替换。'); return undefined; }
  try { return object(JSON.parse(candidate), '生成文档'); }
  catch (cause) { if (cause instanceof SyntaxError) throw new Error('生成 JSON 不完整或格式错误，请检查原结果；当前文稿未替换。'); throw cause; }
}
function markdownBlocks(raw: string): WordBlock[] {
  const blocks: WordBlock[] = [], paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push(block('paragraph', paragraph.join('\n'))); paragraph.length = 0; } };
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s+(.+)/), bullet = line.match(/^\s*[-*+]\s+(.+)/);
    if (!line.trim() || heading || bullet) { flush(); if (heading || bullet) blocks.push(block(heading ? 'heading' : 'bullet', (heading || bullet)![1])); }
    else paragraph.push(line);
  }
  flush(); return blocks;
}
function appendMetadata(document: EditorDocument, notes: string[]): EditorDocument {
  if (!notes.length) return document;
  if (document.kind === 'word') {
    const existing = editorMissingInputs(document);
    if (notes.every(note => existing.includes(note))) return document;
    return { ...document, blocks: [...document.blocks, block('heading', APPENDIX), ...notes.filter(note => !existing.includes(note)).map(note => block('paragraph', note))] };
  }
  const last = document.slides.at(-1)!, appendix = `${NOTE_MARKER}\n${notes.join('\n')}`;
  if (last.notes.includes(appendix)) return document;
  return { ...document, slides: document.slides.map(item => item === last ? { ...item, notes: `${item.notes}${item.notes ? '\n\n' : ''}${appendix}` } : item) };
}
export function editorMissingInputs(document: EditorDocument): string[] {
  if (document.kind === 'ppt') return document.slides.flatMap(item => { const position = item.notes.indexOf(NOTE_MARKER); return position < 0 ? [] : item.notes.slice(position + NOTE_MARKER.length).trim().split('\n').filter(Boolean); });
  const start = document.blocks.findIndex(item => item.type === 'heading' && item.text === APPENDIX);
  if (start < 0) return [];
  const result: string[] = [];
  for (const item of document.blocks.slice(start + 1)) { if (item.type === 'heading') break; result.push(item.text); }
  return result;
}
export function editorFromText(kind: EditorKind, title: string, textInput: string): EditorDocument {
  const raw = text(textInput, '生成正文', 200000).trim(); if (!raw) throw new Error('生成结果没有正文，当前文稿未替换。');
  const outer = parsedJson(raw), data = outer?.editorDocument !== undefined ? object(outer.editorDocument, 'editorDocument') : outer;
  if (outer?.editorDocument !== undefined) fields(outer, ['editorDocument', 'meta'], '生成文档外层');
  const actualTitle = data?.title !== undefined ? text(data.title, '文档标题', 120) : title;
  if (!actualTitle.trim()) throw new Error('生成文档缺少有效标题。');
  if (data?.kind !== undefined && data.kind !== kind || data?.schemaVersion !== undefined && data.schemaVersion !== 1) throw new Error('生成内容与当前文档类型或版本不匹配。');
  let document: EditorDocument;
  if (kind === 'word') {
    let blocks: WordBlock[];
    if (data) {
      fields(data, ['schemaVersion', 'kind', 'title', 'blocks', 'sections', 'body', 'meta'], 'Word 文档');
      if (['blocks', 'sections', 'body'].filter(key => data[key] !== undefined).length > 1) throw new Error('Word 同时提供多种正文结构，请明确一份文稿，避免遗漏内容。');
      if (Array.isArray(data.blocks)) blocks = data.blocks.map(canonicalBlock);
      else if (Array.isArray(data.sections)) blocks = data.sections.flatMap(value => { const section = object(value, 'Word 章节'); fields(section, ['heading', 'paragraphs'], 'Word 章节'); if (!Array.isArray(section.paragraphs)) throw new Error('Word 章节需要完整 paragraphs 文字数组。'); return [...(section.heading !== undefined && text(section.heading, '章节标题', 200) ? [block('heading', section.heading as string)] : []), ...section.paragraphs.map(value => block('paragraph', text(value, '段落正文')))]; });
      else if (typeof data.body === 'string') blocks = markdownBlocks(data.body);
      else throw new Error('Word 结果需要 sections 或完整 blocks 内容，不能把其它 JSON 当正文。');
    } else blocks = markdownBlocks(raw);
    if (!blocks.length || blocks.length > 500) throw new Error('Word 结果需要 1 至 500 个完整内容段落。');
    document = { schemaVersion: 1, kind, title: actualTitle, blocks };
  } else {
    if (data) fields(data, ['schemaVersion', 'kind', 'title', 'theme', 'slides', 'meta'], 'PPT 文档');
    const source = data ? Array.isArray(data.slides) ? data.slides : undefined : raw.split(/(?=^#{1,3}\s+)/m).filter(value => value.trim()).map((section, index) => { const lines = section.trim().split('\n'), heading = lines[0].match(/^#{1,3}\s+(.+)/); return { title: heading ? heading[1] : index ? `第 ${index + 1} 页` : actualTitle, body: (heading ? lines.slice(1) : lines).join('\n').trim() }; });
    if (!source?.length) throw new Error('PPT 结果需要完整 slides 页面数组，不能把其它 JSON 当正文。');
    if (source.length > 100) throw new Error('生成正文超过 100 页，请拆分内容后载入，当前编辑源未改动。');
    const theme = data?.theme ?? 'paper'; if (!themes.includes(theme as typeof themes[number])) throw new Error('生成的 PPT 主题无效。');
    document = { schemaVersion: 1, kind, title: actualTitle, theme: theme as typeof themes[number], slides: source.map(slide) };
  }
  document = appendMetadata(document, [...new Set([...metadata(data?.meta), ...(outer !== data ? metadata(outer?.meta) : [])])]);
  const items = document.kind === 'word' ? document.blocks : document.slides;
  if (document.kind === 'word' && document.blocks.some(item => item.text.length > 20000) || document.kind === 'ppt' && document.slides.some(item => item.notes.length > 10000)) throw new Error('完整正文或资料附录超过单段 20000 字符／页面备注 10000 字符上限，请拆分后载入。');
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('生成内容编号重复，当前文稿未替换。');
  if (document.kind === 'word' && document.blocks.length > 500 || JSON.stringify({ editorDocument: document }).length > 200000) throw new Error('生成内容超过编辑文档上限，请拆分后载入。');
  return document;
}
