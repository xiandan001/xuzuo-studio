export interface StreamTextBlocks { text: string; blocks: string[]; tail: string; boundary: number; }
export function appendChatTextBlocks(previous: StreamTextBlocks | undefined, text: string): StreamTextBlocks {
  const extending = previous && text.startsWith(previous.text), start = extending ? previous.boundary : 0, blocks = extending ? [...previous.blocks] : [];
  const tail = text.slice(start); let fence: { marker: string; length: number } | undefined, indented = false, boundary = 0;
  const lines = tail.match(/[^\n]*(?:\n|$)/g) || [];
  let offset = 0;
  for (const line of lines) {
    const content = line.replace(/\n$/, '');
    if (fence) {
      if (new RegExp('^ {0,3}' + fence.marker + '{' + fence.length + ',}[ \\t]*$').test(content)) fence = undefined;
    } else {
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
      if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) { fence = { marker: opening[1][0], length: opening[1].length }; indented = false; }
      else if (content.trim()) indented = /^(?: {4}|\t)/.test(content);
    }
    offset += line.length;
    if (!fence && !indented && /^\s*\n$/.test(line) && offset > boundary && tail.slice(boundary, offset).trim()) { blocks.push(tail.slice(boundary, offset)); boundary = offset; }
  }
  return { text, blocks, boundary: start + boundary, tail: tail.slice(boundary) };
}
