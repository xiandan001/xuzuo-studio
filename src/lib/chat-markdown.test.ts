import { describe, expect, it } from 'vitest';
import { chatReplyPlainText, parseChatMarkdown } from './chat-markdown';

describe('readable chat text and clean clipboard content', () => {
  it('copies the screenshot-style multi-paragraph quote as normal text', () => {
    const source = '### 可以直接使用的提示词\n\n> 生成一张手机壁纸展示图。\n>\n> **主体：** 手机竖直摆放，屏幕内容清晰。\n>\n> **背景：** 保持海边、晚霞和夏日氛围。';
    const plain = chatReplyPlainText(source);
    expect(plain).toBe('可以直接使用的提示词\n\n生成一张手机壁纸展示图。\n\n主体： 手机竖直摆放，屏幕内容清晰。\n\n背景： 保持海边、晚霞和夏日氛围。');
    expect(source).toContain('> **主体：**');
  });
  it('decodes entities once in prose without reinterpreting them as Markdown syntax', () => {
    expect(chatReplyPlainText('这&#x79CD; &amp; &#128512; &gt; **正文**')).toBe('这种 & 😀 > 正文');
    expect(chatReplyPlainText('&gt; 字面比较符')).toBe('> 字面比较符');
    expect(parseChatMarkdown('&gt; 字面比较符')[0]).toMatchObject({ type: 'element', tag: 'p' });
    expect(chatReplyPlainText('&amp;gt;')).toBe('&gt;');
  });
  it('recognizes emphasis adjacent to Chinese punctuation without changing literal code or operators', () => {
    expect(chatReplyPlainText('**主体：**手机竖直摆放。')).toBe('主体：手机竖直摆放。');
    expect(chatReplyPlainText('这是**重点。**后续继续。')).toBe('这是重点。后续继续。');
    expect(chatReplyPlainText('`2 ** 3` 和 x > 0')).toBe('2 ** 3 和 x > 0');
  });
  it('preserves real comparison operators, escaped markers and code contents', () => {
    expect(chatReplyPlainText('x > 0，2 ** 3，a*b，\\*字面星号\\*。')).toBe('x > 0，2 ** 3，a*b，*字面星号*。');
    expect(chatReplyPlainText('`&gt; **原样**`')).toBe('&gt; **原样**');
    const code = 'if x > 0:\n    result = 2 ** 3\n\n    print("&gt; **保留**")\n';
    expect(chatReplyPlainText('~~~python\n' + code + '~~~')).toBe(code);
  });
  it('produces readable list numbers, TSV table cells and usable link destinations', () => {
    expect(chatReplyPlainText('3. **第一项**\n4. _第二项_')).toBe('3. 第一项\n4. 第二项');
    expect(chatReplyPlainText('| 名称 | 数量 | 备注 |\n|---|---:|---|\n| A\\|B | 2 | |')).toBe('名称\t数量\t备注\nA|B\t2\t');
    expect(chatReplyPlainText('[查看文档](https://example.com/docs)')).toBe('查看文档（https://example.com/docs）');
  });
  it('does not create executable HTML, remote-image nodes or javascript links', () => {
    const nodes = parseChatMarkdown('<script>alert(1)</script>\n\n![参考图](https://example.com/private.png)\n\n[危险](javascript:alert(1))');
    const json = JSON.stringify(nodes);
    expect(json).not.toContain('"tag":"script"'); expect(json).not.toContain('"tag":"img"'); expect(json).not.toContain('"href":"javascript:');
    expect(chatReplyPlainText('![参考图](https://example.com/private.png)')).toBe('参考图');
  });
  it('supports read-only GFM task states and automatic web links without losing their copy semantics', () => {
    expect(chatReplyPlainText('- [x] 已检查\n- [ ] 待导出')).toBe('☑ 已检查\n☐ 待导出');
    expect(chatReplyPlainText('网址 https://example.com/path')).toBe('网址 https://example.com/path');
    const list = parseChatMarkdown('- [ ] 待导出')[0];
    expect(list).toMatchObject({ type: 'element', tag: 'ul', children: [{ type: 'element', tag: 'li', taskChecked: false }] });
    expect(chatReplyPlainText('- \\[x] 字面任务\n- &#91;x] 字面实体')).toBe('• [x] 字面任务\n• [x] 字面实体');
  });
  it('gives task prefixes priority over equally named link references', () => {
    expect(chatReplyPlainText('- [x] 完成\n\n[x]: https://example.test')).toBe('☑ 完成');
    expect(chatReplyPlainText('- [x] 阅读[规范][guide]\n\n[guide]: https://example.test/guide')).toBe('☑ 阅读规范（https://example.test/guide）');
  });
});
