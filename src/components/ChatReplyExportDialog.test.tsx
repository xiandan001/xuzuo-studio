// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatReplyExportDialog } from './ChatReplyExportDialog';
import type { PageProps } from '../types';
import type { ChatTurn } from '../chat-types';

let root: Root | undefined, host: HTMLDivElement;
const turn = { id: 'turn', text: '# 项目说明\n\n完整正文\n\n| 编号 | 金额 |\n|---|---|\n| 001 | =SUM(1,2) |', userText: '整理项目说明', status: 'complete' } as ChatTurn;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); });
async function click(text: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); expect(button).toBeTruthy(); await act(async () => { button!.click(); await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function fixture(failLink = false) {
  const startLive = vi.fn(async () => ({ status: 'started', runId: 'exported-run' })), onCreateProject = vi.fn((_kind, options) => options.onCreated({ id: 'new-project', workspaceId: 'workspace', kind: 'word' })), onSaved = vi.fn(), onClose = vi.fn();
  const linkExport = vi.fn(async () => { if (failLink) { failLink = false; throw Error('关联暂未保存'); } return {}; });
  vi.stubGlobal('desktop', undefined); Object.defineProperty(window, 'desktop', { value: { chat: { linkExport } }, configurable: true });
  const props = { workspaceId: 'workspace', projects: [], workflowRunner: { startLive, runtimeStatus: { available: true } }, onCreateProject, notify: vi.fn() } as unknown as PageProps;
  await act(async () => { root = createRoot(host); root.render(<ChatReplyExportDialog props={props} conversationId="conversation" turn={turn} onClose={onClose} onSaved={onSaved} />); });
  return { startLive, onCreateProject, linkExport, onSaved, onClose };
}
it('仅点击保存才选文件夹和提交纯本地导出，来源完整，不写编辑草稿', async () => {
  const f = await fixture(); expect(f.startLive).not.toHaveBeenCalled(); expect(f.onCreateProject).not.toHaveBeenCalled();
  await click('保存文件'); expect(f.onCreateProject).toHaveBeenCalledTimes(1); expect(f.startLive).toHaveBeenCalledTimes(1);
  const [workflow, projectId, input, variables, attachments] = f.startLive.mock.calls[0] as unknown as [Record<string, unknown>, string, string, object, string[]];
  expect(workflow).toMatchObject({ outputKind: 'word', sourceChat: { conversationId: 'conversation', turnId: 'turn' }, steps: [{ kind: 'export', inputSource: 'project', referenceArtifactIds: [] }] });
  expect(projectId).toBe('new-project'); expect(variables).toEqual({}); expect(attachments).toEqual([]); expect(JSON.parse(input)).toMatchObject({ kind: 'word', title: '项目说明' });
  expect(input).toContain('完整正文'); expect(f.linkExport).toHaveBeenCalledWith(expect.objectContaining({ runId: 'exported-run', turnId: 'turn' })); expect(f.onSaved).toHaveBeenCalledTimes(1);
});
it('回执关联失败仅重试关联同一文件，不再新建项目或导出', async () => {
  const f = await fixture(true); await click('保存文件'); expect(document.body.textContent).toContain('关联暂未保存');
  await click('重试关联已有文件'); expect(f.startLive).toHaveBeenCalledTimes(1); expect(f.onCreateProject).toHaveBeenCalledTimes(1); expect(f.linkExport).toHaveBeenCalledTimes(2); expect(f.onClose).toHaveBeenCalledTimes(1);
});
