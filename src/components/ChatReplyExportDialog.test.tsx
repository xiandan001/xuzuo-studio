// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatReplyExportDialog } from './ChatReplyExportDialog';
import type { PageProps } from '../types';
import type { ChatTurn } from '../chat-types';
import type { LiveStartResult } from '../live-types';

let root: Root | undefined, host: HTMLDivElement;
const turn = { id: 'turn', text: '# 项目说明\n\n完整正文\n\n| 编号 | 金额 |\n|---|---|\n| 001 | =SUM(1,2) |', userText: '整理项目说明', status: 'complete' } as ChatTurn;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); });
async function click(text: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); expect(button).toBeTruthy(); await act(async () => { button!.click(); await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function fixture(failLink = false, startResults: LiveStartResult[] = [], readResults: LiveStartResult[] = []) {
  const startLive = vi.fn(async (): Promise<LiveStartResult> => startResults.shift() || ({ status: 'started', runId: 'exported-run' })), readStartResult = vi.fn(async (): Promise<LiveStartResult> => readResults.shift() || ({ status: 'unknown', dispatchKey: 'same-request', error: '原任务仍未确认' })), onCreateProject = vi.fn((_kind, options) => options.onCreated({ id: 'new-project', workspaceId: 'workspace', kind: 'word' })), onSaved = vi.fn(), onClose = vi.fn();
  const linkExport = vi.fn(async () => { if (failLink) { failLink = false; throw Error('关联暂未保存'); } return {}; });
  vi.stubGlobal('desktop', undefined); Object.defineProperty(window, 'desktop', { value: { chat: { linkExport } }, configurable: true });
  const props = { workspaceId: 'workspace', projects: [], workflowRunner: { startLive, readStartResult, runtimeStatus: { available: true } }, onCreateProject, notify: vi.fn() } as unknown as PageProps;
  await act(async () => { root = createRoot(host); root.render(<ChatReplyExportDialog props={props} conversationId="conversation" turn={turn} onClose={onClose} onSaved={onSaved} />); });
  return { startLive, readStartResult, onCreateProject, linkExport, onSaved, onClose };
}
it('仅点击保存才创建目标项目和提交纯本地导出，保留已填标题/格式，不写编辑草稿', async () => {
  const f = await fixture(); expect(f.startLive).not.toHaveBeenCalled(); expect(f.onCreateProject).not.toHaveBeenCalled();
  await click('保存文件'); expect(f.onCreateProject).toHaveBeenCalledTimes(1); expect(f.startLive).toHaveBeenCalledTimes(1);
  expect(f.onCreateProject).toHaveBeenCalledWith('word', expect.objectContaining({ quick: true, initial: { name: '项目说明', description: '来自对话回复的本地Word 文档' } }));
  const [workflow, projectId, input, variables, attachments] = f.startLive.mock.calls[0] as unknown as [Record<string, unknown>, string, string, object, string[]];
  expect(workflow).toMatchObject({ outputKind: 'word', sourceChat: { conversationId: 'conversation', turnId: 'turn' }, steps: [{ kind: 'export', inputSource: 'project', referenceArtifactIds: [] }] });
  expect(projectId).toBe('new-project'); expect(variables).toEqual({}); expect(attachments).toEqual([]); expect(JSON.parse(input)).toMatchObject({ kind: 'word', title: '项目说明' });
  expect(input).toContain('完整正文'); expect(f.linkExport).toHaveBeenCalledWith(expect.objectContaining({ runId: 'exported-run', turnId: 'turn' })); expect(f.onSaved).toHaveBeenCalledTimes(1);
});
it('回执关联失败仅重试关联同一文件，不再新建项目或导出', async () => {
  const f = await fixture(true); await click('保存文件'); expect(document.body.textContent).toContain('关联暂未保存');
  await click('重试关联已有文件'); expect(f.startLive).toHaveBeenCalledTimes(1); expect(f.onCreateProject).toHaveBeenCalledTimes(1); expect(f.linkExport).toHaveBeenCalledTimes(2); expect(f.onClose).toHaveBeenCalledTimes(1);
});
it('提交未知后只允许免费读状态，找到原任务仅关联，不重复创建或调用startLive', async () => {
  const unknown = { status: 'unknown', dispatchKey: 'same-request', error: '保存回执未确认' } as const;
  const f = await fixture(false, [unknown], [unknown, { status: 'started', runId: 'original-run', recovered: true }]);
  await click('保存文件'); expect(f.startLive).toHaveBeenCalledOnce(); expect(f.onCreateProject).toHaveBeenCalledOnce(); expect(document.querySelector('input')?.disabled).toBe(true);
  await click('读取保存结果'); expect(f.readStartResult).toHaveBeenCalledWith('new-project'); expect(f.startLive).toHaveBeenCalledOnce(); expect(f.linkExport).not.toHaveBeenCalled();
  await click('读取保存结果'); expect(f.readStartResult).toHaveBeenCalledTimes(2); expect(f.startLive).toHaveBeenCalledOnce(); expect(f.onCreateProject).toHaveBeenCalledOnce(); expect(f.linkExport).toHaveBeenCalledWith(expect.objectContaining({ runId: 'original-run' })); expect(f.onClose).toHaveBeenCalledOnce();
});
it('明确查无任务也不自动重发，用户再次保存沿用已创建项目与原内容', async () => {
  const f = await fixture(false, [{ status: 'unknown', dispatchKey: 'same-request', error: '保存未确认' }], [{ status: 'rejected', code: 'START_NOT_FOUND', error: '本次尚未开始' }]);
  await click('保存文件'); await click('读取保存结果'); expect(f.startLive).toHaveBeenCalledOnce(); expect(f.onCreateProject).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain('再点击保存文件'); expect(document.querySelector('input')?.value).toBe('项目说明');
  await click('保存文件'); expect(f.startLive).toHaveBeenCalledTimes(2); expect(f.onCreateProject).toHaveBeenCalledOnce(); expect(f.startLive.mock.calls[1]).toEqual(expect.arrayContaining(['new-project'])); expect(f.linkExport).toHaveBeenCalledWith(expect.objectContaining({ runId: 'exported-run' }));
});
