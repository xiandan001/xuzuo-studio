import MarkdownIt from 'markdown-it';
import { cjkFriendly } from '@mdit/plugin-cjk-friendly';

export type ChatMarkdownTag = 'p' | 'blockquote' | 'strong' | 'em' | 's' | 'code' | 'pre' | 'ul' | 'ol' | 'li' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'table' | 'thead' | 'tbody' | 'tr' | 'th' | 'td' | 'a' | 'br' | 'hr' | 'span';
export interface ChatMarkdownElement {
  type: 'element'; tag: ChatMarkdownTag; children: ChatMarkdownNode[];
  href?: string; title?: string; start?: number; align?: 'left' | 'center' | 'right'; image?: boolean; imageUrl?: string; taskChecked?: boolean;
}
export type ChatMarkdownNode = { type: 'text'; value: string } | ChatMarkdownElement;
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false, maxNesting: 20 }).use(cjkFriendly);
type MarkdownToken = ReturnType<typeof markdown.parse>[number];
const tags = new Set<string>(['p', 'blockquote', 'strong', 'em', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a']);
const inlineTags = new Set<ChatMarkdownTag>(['strong', 'em', 's', 'code', 'a', 'br', 'span']);
const text = (value: string): ChatMarkdownNode => ({ type: 'text', value });
const element = (tag: ChatMarkdownTag, children: ChatMarkdownNode[] = []): ChatMarkdownElement => ({ type: 'element', tag, children });

function safeUrl(value: string | number | null): string | undefined {
  if (typeof value !== 'string' || !value) return;
  try { const url = new URL(value); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : undefined; } catch { return; }
}
function tokenElement(token: MarkdownToken): ChatMarkdownElement {
  const node = element(token.tag as ChatMarkdownTag);
  if (node.tag === 'a') {
    node.href = safeUrl(token.attrGet('href')); if (!node.href) node.tag = 'span';
    const title = token.attrGet('title'); if (title !== null) node.title = String(title);
  }
  if (node.tag === 'ol' && token.attrGet('start') !== null) { const start = Number(token.attrGet('start')); if (Number.isSafeInteger(start) && start >= 0) node.start = start; }
  const align = /^text-align:\s*(left|center|right);?$/.exec(String(token.attrGet('style') || ''))?.[1];
  if (align) node.align = align as ChatMarkdownElement['align'];
  return node;
}
function nodesFromTokens(tokens: MarkdownToken[], environment: Record<string, unknown>): ChatMarkdownNode[] {
  const result: ChatMarkdownNode[] = [], stack: ChatMarkdownElement[] = [];
  const append = (node: ChatMarkdownNode) => (stack.at(-1)?.children || result).push(node);
  for (const token of tokens) {
    if (token.hidden) continue;
    if (token.type === 'inline') {
      let item: ChatMarkdownElement | undefined;
      for (let index = stack.length - 1; index >= 0; index--) if (stack[index].tag === 'li') { item = stack[index]; break; }
      const parent = stack.at(-1);
      const first = item && (!item.children.length || item.children.length === 1 && item.children[0] === parent && parent?.tag === 'p' && !parent.children.length);
      const task = item && first ? /^\[([ xX])\][ \t]+/.exec(token.content) : null;
      if (item && task) {
        item.taskChecked = task[1].toLowerCase() === 'x';
        for (const child of nodesFromTokens(markdown.parseInline(token.content.slice(task[0].length), environment), environment)) append(child);
      } else for (const child of nodesFromTokens(token.children || [], environment)) append(child);
    }
    else if (token.type === 'fence' || token.type === 'code_block') append(element('pre', [element('code', [text(token.content)])]));
    else if (token.type === 'code_inline') append(element('code', [text(token.content)]));
    else if (token.type === 'softbreak' || token.type === 'hardbreak') append(element('br'));
    else if (token.type === 'hr') append(element('hr'));
    else if (token.type === 'image') append({ ...element('span', token.children?.length ? nodesFromTokens(token.children, environment) : [text(token.content || '图片')]), image: true, imageUrl: safeUrl(token.attrGet('src')) });
    else if (token.nesting === 1 && tags.has(token.tag)) { const node = tokenElement(token); append(node); stack.push(node); }
    else if (token.nesting === -1 && tags.has(token.tag)) stack.pop();
    else if (token.content) append(text(token.content));
  }
  return result;
}
export function parseChatMarkdown(value: string): ChatMarkdownNode[] { const environment = {}; return nodesFromTokens(markdown.parse(value, environment), environment); }

function inlineText(nodes: ChatMarkdownNode[]): string {
  return nodes.map(node => {
    if (node.type === 'text') return node.value;
    if (node.tag === 'br') return '\n';
    const label = inlineText(node.children);
    if (node.tag !== 'a' || !node.href || label === node.href || label === node.href.replace(/^mailto:/, '')) return label;
    return `${label}（${node.href}）`;
  }).join('');
}
function listText(node: ChatMarkdownElement, depth: number): string {
  let number = node.start ?? 1;
  return node.children.filter((child): child is ChatMarkdownElement => child.type === 'element' && child.tag === 'li').map(item => {
    const marker = item.taskChecked === undefined ? undefined : item.taskChecked ? '☑ ' : '☐ ';
    const prefix = node.tag === 'ol' ? `${number++}. ${marker || ''}` : marker || '• ';
    const content = blockText(item.children, depth + 1), indentation = '  '.repeat(depth);
    return indentation + prefix + content.replace(/\n/g, '\n' + indentation + ' '.repeat(prefix.length));
  }).join('\n');
}
function tableText(node: ChatMarkdownElement): string {
  const rows: string[] = [];
  const visit = (parent: ChatMarkdownElement) => {
    if (parent.tag === 'tr') rows.push(parent.children.filter((child): child is ChatMarkdownElement => child.type === 'element' && ['th', 'td'].includes(child.tag)).map(cell => inlineText(cell.children).replace(/\n/g, ' ')).join('\t'));
    else for (const child of parent.children) if (child.type === 'element') visit(child);
  };
  visit(node); return rows.join('\n');
}
function blockText(nodes: ChatMarkdownNode[], depth = 0): string {
  const blocks: string[] = []; let current: ChatMarkdownNode[] = [];
  const flush = () => { if (current.length) { blocks.push(inlineText(current)); current = []; } };
  for (const node of nodes) {
    if (node.type === 'text' || inlineTags.has(node.tag)) { current.push(node); continue; }
    flush();
    if (node.tag === 'hr') continue;
    if (node.tag === 'pre') blocks.push(inlineText(node.children));
    else if (node.tag === 'ul' || node.tag === 'ol') blocks.push(listText(node, depth));
    else if (node.tag === 'table') blocks.push(tableText(node));
    else if (node.tag === 'blockquote') blocks.push(blockText(node.children, depth));
    else blocks.push(inlineText(node.children));
  }
  flush(); return blocks.filter(value => value.length > 0).join('\n\n');
}
export function chatReplyPlainText(value: string): string { return blockText(parseChatMarkdown(value)); }
