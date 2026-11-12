import { createElement, memo } from 'react';
import type { ReactNode } from 'react';
import { parseChatMarkdown, type ChatMarkdownNode } from '../lib/chat-markdown';
import { ChatMarkdownImage } from './ChatMarkdownImage';
import './chat-reply-text.css';

function nodeText(nodes: ChatMarkdownNode[]): string { return nodes.map(node => node.type === 'text' ? node.value : node.tag === 'br' ? '\n' : nodeText(node.children)).join(''); }
function hasImage(nodes: ChatMarkdownNode[]): boolean { return nodes.some(node => node.type === 'element' && (node.image || hasImage(node.children))); }
function renderNode(node: ChatMarkdownNode, key: string): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.image && node.imageUrl) return <ChatMarkdownImage key={key} url={node.imageUrl} alt={nodeText(node.children) || '图片'} title={node.title} />;
  const isTask = node.tag === 'li' && typeof node.taskChecked === 'boolean';
  const className = node.image ? 'chat-reply-image-note' : isTask ? 'chat-reply-task-item' : /^h[1-6]$/.test(node.tag) ? 'chat-reply-heading' : undefined;
  const props = {
    key,
    className,
    ...(node.title ? { title: node.title } : {}),
    ...(node.tag === 'ol' && node.start !== undefined ? { start: node.start } : {}),
    ...(node.align ? { style: { textAlign: node.align } } : {}),
    ...(node.tag === 'a' && node.href ? { href: node.href, target: '_blank', rel: 'noopener noreferrer' } : {}),
  };
  if (node.tag === 'br' || node.tag === 'hr') return createElement(node.tag, props);
  const children = node.children.map((child, index) => renderNode(child, `${key}-${index}`));
  if (isTask) children.unshift(<input key={`${key}-check`} className="chat-reply-task-check" type="checkbox" checked={node.taskChecked} readOnly disabled tabIndex={-1} aria-label={node.taskChecked ? '已完成任务' : '未完成任务'} />);
  if (node.tag === 'a' && node.href && hasImage(node.children)) return <span className="chat-reply-linked-image" key={key}>{children}<a href={node.href} title={node.title} target="_blank" rel="noopener noreferrer">打开链接</a></span>;
  const content = createElement(node.tag, props, ...children);
  return node.tag === 'table' ? <div className="chat-reply-table" key={key}>{content}</div> : content;
}
export const ChatReplyText = memo(function ChatReplyText({ text }: { text: string }) {
  return <div className="chat-reply-text">{parseChatMarkdown(text).map((node, index) => renderNode(node, String(index)))}</div>;
});
