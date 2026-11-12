export interface StreamTextBlocks { text: string; blocks: string[]; tail: string; boundary: number; }
export function appendChatTextBlocks(previous: StreamTextBlocks | undefined, text: string): StreamTextBlocks {
  const extending = previous && text.startsWith(previous.text), start = extending ? previous.boundary : 0, blocks = extending ? [...previous.blocks] : [];
  const tail = text.slice(start); let fenced = false, boundary = 0;
  const lines = tail.match(/[^\n]*(?:\n|$)/g) || [];
  let offset = 0;
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    offset += line.length;
    if (!fenced && /^\s*\n$/.test(line) && offset > boundary && tail.slice(boundary, offset).trim()) { blocks.push(tail.slice(boundary, offset)); boundary = offset; }
  }
  return { text, blocks, boundary: start + boundary, tail: tail.slice(boundary) };
}
