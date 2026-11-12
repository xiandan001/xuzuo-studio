import { expect, it } from 'vitest';
import { appendChatTextBlocks } from './chat-text-blocks';
it('keeps completed paragraphs stable and only reparses the streaming tail', () => {
  const first = appendChatTextBlocks(undefined, '第一段\n\n正在');
  const next = appendChatTextBlocks(first, '第一段\n\n正在继续\n\n最后');
  expect(next.blocks).toEqual(['第一段\n\n', '正在继续\n\n']);
  expect(next.blocks[0]).toBe(first.blocks[0]); expect(next.tail).toBe('最后');
  expect(next.blocks.join('') + next.tail).toBe(next.text);
});
it('does not split blank lines inside fenced code and resets on a replacement reply', () => {
  const text = '介绍\n\n```js\nfirst();\n\nsecond();\n```\n\n结论';
  const next = appendChatTextBlocks(appendChatTextBlocks(undefined, text.slice(0, 23)), text);
  expect(next.blocks).toHaveLength(2); expect(next.blocks[1]).toContain('first();\n\nsecond();');
  expect(appendChatTextBlocks(next, '更正后的回复')).toMatchObject({ blocks: [], tail: '更正后的回复', boundary: 0 });
});
it.each(['~~~python\n> literal\n\n**literal**\n~~~', '  ````text\n```\n\n> **literal**\n  ````', '    x > 0\n\n    value = 2 ** 3'])('never commits the inside of a code block while characters stream in: %s', code => {
  let state;
  for (let end = 1; end <= code.length; end++) {
    state = appendChatTextBlocks(state, code.slice(0, end));
    expect(state.blocks).toEqual([]); expect(state.blocks.join('') + state.tail).toBe(code.slice(0, end));
  }
});
