import { Fragment, memo } from 'react';
import type { ReactNode } from 'react';

function inline(value: string): ReactNode {
  return value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>);
}
export const ChatReplyText = memo(function ChatReplyText({ text }: { text: string }) {
  const sections = text.split(/^```[^\n]*\n?/m);
  return <div className="chat-reply-text">{sections.map((section, index) => index % 2 ? <pre key={index}><code>{section.replace(/\n$/, '')}</code></pre> : section.split(/\n\s*\n/).filter(Boolean).map((paragraph, position) => {
    const lines = paragraph.split('\n'), key = `${index}-${position}`;
    if (lines.length >= 2 && /^\|?.+\|.+/.test(lines[0]) && /^\|?[\s:|-]+\|/.test(lines[1])) {
      const cells = (line: string) => line.replace(/^\|\s*|\s*\|$/g, '').split('|').map(cell => cell.trim());
      return <div className="chat-reply-table" key={key}><table><thead><tr>{cells(lines[0]).map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{lines.slice(2).map((line, row) => <tr key={row}>{cells(line).map((cell, i) => <td key={i}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
    }
    return <div key={key}>{lines.map((line, row) => /^#{1,4}\s/.test(line) ? <strong className="chat-reply-heading" key={row}>{inline(line.replace(/^#{1,4}\s+/, ''))}</strong> : /^[-*]\s/.test(line) ? <div className="chat-reply-list" key={row}>• {inline(line.replace(/^[-*]\s+/, ''))}</div> : <p key={row}>{inline(line) || '\u00a0'}</p>)}</div>;
  }))}</div>;
});
