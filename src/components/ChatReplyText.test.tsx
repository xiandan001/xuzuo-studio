// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatReplyText } from './ChatReplyText';
import { StreamingChatReply } from './StreamingChatReply';
import { chatReplyPlainText } from '../lib/chat-markdown';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Reply formatting must not request remote content'); }));
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined; host.remove();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function render(text: string) {
  await act(async () => { root ||= createRoot(host); root.render(<ChatReplyText text={text} />); });
}

describe('AI回复的可读格式与安全正文', () => {
  it('keeps an explicitly loaded image expanded as streaming paragraphs settle and finish', async () => {
    const original = '![示意图](https://example.test/picture.png)';
    await act(async () => { root = createRoot(host); root.render(<StreamingChatReply text={original} streaming />); });
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
    const image = host.querySelector('img'); expect(image).toBeTruthy();
    await act(async () => root!.render(<StreamingChatReply text={original + '\n\n后续说明。\n\n'} streaming />));
    expect(host.querySelector('img')).toBe(image);
    await act(async () => root!.render(<StreamingChatReply text={original + '\n\n后续说明。\n\n'} streaming={false} />));
    expect(host.querySelector('img')).toBe(image);
  });
  it('reuses settled streaming paragraphs while completing code and whole-message link references correctly', async () => {
    await act(async () => { root = createRoot(host); root.render(<StreamingChatReply text={'第一段\n\n正在'} streaming />); });
    const paragraph = host.querySelector('p');
    await act(async () => root!.render(<StreamingChatReply text={'第一段\n\n正在继续'} streaming />));
    expect(host.querySelector('p')).toBe(paragraph);
    const complete = '[查看规范][guide]\n\n[guide]: https://example.test/guide';
    await act(async () => root!.render(<StreamingChatReply text={complete} streaming={false} />));
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.test/guide');
    expect(host.textContent).toBe('查看规范');
  });
  it('renders the screenshot-style multi-paragraph prompt as a quotation without visible quote or emphasis markers', async () => {
    const text = '### 可以直接使用的提示词\n\n> 生成一张精致的手机壁纸展示图。\n>\n> **主体：**手机竖直摆放。\n>\n> **手机屏幕：**保留参考图的构图和细节。';
    await render(text);
    expect(host.querySelector('h3')?.textContent).toBe('可以直接使用的提示词');
    expect(host.querySelectorAll('blockquote')).toHaveLength(1);
    expect(host.querySelectorAll('blockquote p')).toHaveLength(3);
    expect(host.querySelectorAll('blockquote strong')).toHaveLength(2);
    expect(host.textContent).not.toMatch(/[>*]/);
    const copied = chatReplyPlainText(text);
    expect(copied).toContain('主体：手机竖直摆放。'); expect(copied).not.toContain('**'); expect(copied).not.toMatch(/^\s*>/m);
  });

  it('decodes ordinary body entities while preserving code characters, operators and escaped literal markers', async () => {
    const code = 'const result = value > 0 && power ** 2; // &#x79CD; **literal**';
    const text = '这&#x79CD;内容 &amp; 细节。x > 0，2 ** 3。\n\n\\> 这是字面文本，不是引用。\n\n```js\n' + code + '\n```';
    await render(text);
    expect(host.textContent).toContain('这种内容 & 细节。x > 0，2 ** 3。');
    expect(host.textContent).toContain('> 这是字面文本，不是引用。'); expect(host.querySelector('blockquote')).toBeNull();
    expect(host.querySelector('pre code')?.textContent).toContain(code);
    expect(chatReplyPlainText(text)).toContain(code);
  });

  it('renders nested emphasis, ordered lists and a scrollable table as semantic elements', async () => {
    await render('**重点包含 *细节***\n\n1. 准备资料\n2. 保存结果\n\n| 项目 | 内容 |\n| --- | --- |\n| 主题 | 自然 |');
    expect(host.querySelector('strong em')?.textContent).toBe('细节');
    expect(host.querySelectorAll('ol > li')).toHaveLength(2);
    expect(host.querySelector('.chat-reply-table table')).toBeTruthy();
    expect(host.querySelectorAll('th')).toHaveLength(2); expect(host.querySelectorAll('td')).toHaveLength(2);
  });

  it('keeps HTML inert and remote images as text without hidden image requests', async () => {
    await render('<script>window.untrusted = true</script>\n\n![参考图片](https://example.test/track.png)\n\n[危险链接](javascript:alert(1))');
    expect(host.querySelector('script, img, iframe, object, video')).toBeNull();
    expect(host.querySelector('[href^="javascript:"]')).toBeNull();
    expect(host.textContent).toContain('参考图片'); expect(host.textContent).toContain('危险链接');
    expect(host.textContent).toContain('<script>');
  });

  it('renders normal web links with an isolated new-tab target and keeps line breaks and rules readable', async () => {
    await render('[资料](https://example.test/help)\n\n第一行  \n第二行\n\n---');
    const link = host.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.test/help'); expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener'); expect(link.rel).toContain('noreferrer');
    expect(host.querySelector('br')).toBeTruthy(); expect(host.querySelector('hr')).toBeTruthy();
  });

  it('shows task states as read-only checkboxes without duplicating list bullets', async () => {
    const text = '- [x] **完成审核**\n- [ ] 等待反馈'; await render(text);
    const fields = host.querySelectorAll<HTMLInputElement>('li.chat-reply-task-item input[type="checkbox"]');
    expect(fields).toHaveLength(2); expect(fields[0].checked).toBe(true); expect(fields[1].checked).toBe(false);
    expect([...fields].every(field => field.disabled && field.readOnly && field.tabIndex === -1)).toBe(true);
    expect(host.textContent).toBe('完成审核等待反馈');
    expect(chatReplyPlainText(text)).toContain('☑ 完成审核'); expect(chatReplyPlainText(text)).toContain('☐ 等待反馈');
  });

  it('loads only the explicitly requested image URL, then offers retry or collapse without automatic requests for a replacement URL', async () => {
    await render('![海报参考](https://example.test/first.png)'); expect(host.querySelector('img')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-reply-image-load')!.click());
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.test/first.png');
    await render('![另一张参考](https://example.test/second.png)'); expect(host.querySelector('img')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-reply-image-load')!.click());
    const image = host.querySelector('img')!; expect(image.getAttribute('src')).toBe('https://example.test/second.png');
    expect(image.getAttribute('loading')).toBe('lazy'); expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    await act(async () => image.dispatchEvent(new Event('error'))); expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('图片未能加载');
    const link = [...host.querySelectorAll('a')].find(item => item.textContent === '打开图片')!; expect(link.getAttribute('href')).toBe('https://example.test/second.png'); expect(link.rel).toContain('noreferrer');
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-reply-image-load')!.click()); expect(host.querySelector('img')).toBeTruthy();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '收起图片')!.click()); expect(host.querySelector('img')).toBeNull();
  });

  it('keeps a linked image action separate from its destination link', async () => {
    await render('[![封面](https://example.test/image.png)](https://example.test/page)');
    expect(host.querySelector('a button')).toBeNull(); expect(host.querySelector('a[href="https://example.test/page"]')).toBeTruthy(); expect(host.querySelector('img')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-reply-image-load')!.click()); expect(host.querySelector('img')).toBeTruthy(); expect(host.querySelector('a img')).toBeNull();
  });
});
