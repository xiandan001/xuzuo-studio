// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import type { ContentSearchPage, ContentSearchRequest } from '../content-search-types';
import { GlobalSearch } from './GlobalSearch';

vi.mock('../hooks/useGlobalAssetSearch', () => ({ useGlobalAssetSearch: () => ({ items: [], total: 0, loading: false, error: '', supported: true, retry: vi.fn() }) }));
vi.mock('../hooks/useProjectInventory', () => ({ useProjectInventory: () => ({ files: [], error: '' }) }));
let root: Root, host: HTMLDivElement;
const file = { id: 'document-a', projectId: 'project-a', name: '正式交付.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', bytes: 300, path: 'D:/managed/file.docx', createdAt: '2026-11-17T00:00:00Z' } as const;
const document = { schemaVersion: 1, kind: 'word', title: '实际保存的文稿', blocks: [{ id: 'block-1', type: 'paragraph', text: '这是出货清单的真实预览内容。', fontSize: 12, bold: false, italic: false, align: 'left' }] };
const hit = (name: string = file.name, id: string = file.id): ContentSearchPage => ({ items: [{ id, projectId: file.projectId, projectName: '当前登记项目', artifact: { ...file, id, name }, snippet: '正文命中 ACORN-SEARCH-921', sourceSha256: 'a'.repeat(64), sourceRevision: 1 }], scanned: 1, indexed: 1, cached: 0, skipped: 0 });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Search acceptance must not use network'); }));
  host = window.document.createElement('div'); window.document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(search = vi.fn(async (_input: ContentSearchRequest) => hit())) {
  const content = { search, cancel: vi.fn(async () => ({ cancelled: true })) }, chat = { search: vi.fn(async () => ({ items: [{ id: 'conversation-a', workspaceId: 'workspace', title: '已保存客户沟通', matchSnippet: '聊天正文 ACORN-SEARCH-921', matchTurnId: 'turn-a' }], scanned: 1, total: 1 })), cancelSearch: vi.fn(async () => ({ cancelled: true })) };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { contentSearch: content, chat } });
  const previewArtifact = vi.fn(async () => ({ artifact: file, mimeType: file.mimeType, text: JSON.stringify(document), documentSource: true, sourceRevision: 1 })), startLive = vi.fn(), onNavigate = vi.fn();
  const props = { workspaceId: 'workspace', workspace: { id: 'workspace', name: '当前工作区' }, activeProject: { id: 'project-a', workspaceId: 'workspace' }, projects: [{ id: 'project-a', workspaceId: 'workspace', name: '当前登记项目', kind: 'word', description: '' }], prompts: [], configuration: { workflows: [] }, workflowRunner: { runs: [], previewArtifact, startLive }, notify: vi.fn() } as unknown as PageProps;
  return { content, chat, props, previewArtifact, startLive, onNavigate };
}
async function show(f: ReturnType<typeof setup>) { await act(async () => root.render(<GlobalSearch props={f.props} navigation={[]} onClose={vi.fn()} onNavigate={f.onNavigate} />)); }
async function search(value: string) {
  const input = window.document.querySelector<HTMLInputElement>('[aria-label="搜索项目文件素材提示词和工作流"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
}
async function clickResult(name: string) {
  const button = [...window.document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(value => value.textContent?.includes(name)); expect(button).toBeTruthy(); await act(async () => button!.click());
}
it('统一入口检索聊天和文档正文，聊天携真实轮次，文档打开对应实际文件内容且不调用模型', async () => {
  const f = setup(); await show(f); expect(f.content.search).not.toHaveBeenCalled(); expect(f.chat.search).not.toHaveBeenCalled(); await search('ACORN-SEARCH-921');
  expect(window.document.body.textContent).toContain('已保存客户沟通'); expect(window.document.body.textContent).toContain('正式交付.docx');
  await clickResult('已保存客户沟通'); expect(f.onNavigate).toHaveBeenCalledWith('overview', undefined, expect.objectContaining({ kind: 'chat', workspaceId: 'workspace', conversationId: 'conversation-a', turnId: 'turn-a' }));
  await clickResult('正式交付.docx'); expect(f.previewArtifact).toHaveBeenCalledWith('document-a'); expect(window.document.body.textContent).toContain('这是出货清单的真实预览内容。'); expect(f.startLive).not.toHaveBeenCalled();
});
it('改词会取消原正文扫描，较晚到达的旧查询不会覆盖新命中或文字输入', async () => {
  let release!: (value: ContentSearchPage) => void;
  const backend = vi.fn().mockImplementationOnce(() => new Promise<ContentSearchPage>(resolve => { release = resolve; })).mockResolvedValue(hit('新的命中文档.docx', 'new-result'));
  const f = setup(backend); await show(f); await search('old-key'); const first = f.content.search.mock.calls[0][0];
  await search('new-key'); expect(f.content.cancel).toHaveBeenCalledWith({ workspaceId: 'workspace', requestId: first.requestId }); expect(window.document.body.textContent).toContain('新的命中文档.docx');
  await act(async () => release(hit('过期结果不应显示.docx', 'stale-result')));
  expect(window.document.body.textContent).not.toContain('过期结果不应显示'); expect(window.document.querySelector<HTMLInputElement>('[aria-label="搜索项目文件素材提示词和工作流"]')!.value).toBe('new-key'); expect(f.previewArtifact).not.toHaveBeenCalled();
});
it('拒绝异工作区聊天、已移除项目文件和回收内容，保留未完整检索的明确反馈', async () => {
  const f = setup(vi.fn(async () => ({ ...hit(), skipped: 2, nextCursor: 'next', items: [{ ...hit().items[0], projectId: 'removed-project', artifact: { ...file, projectId: 'removed-project' } }] })));
  f.chat.search.mockResolvedValue({ items: [{ id: 'foreign', workspaceId: 'other', title: '不可显示的客户内容', matchSnippet: 'ACORN-SEARCH-921', matchTurnId: 'turn-a' }], scanned: 1, total: 1 });
  await show(f); await search('ACORN-SEARCH-921'); expect(window.document.body.textContent).not.toContain('不可显示的客户内容'); expect(window.document.body.textContent).not.toContain('正式交付.docx'); expect(window.document.body.textContent).toContain('2 份较长或不可用文件未完整检索'); expect(window.document.body.textContent).toContain('继续查找文档'); expect(f.onNavigate).not.toHaveBeenCalled();
});
