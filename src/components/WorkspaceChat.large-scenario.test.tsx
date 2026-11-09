// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceChat } from './WorkspaceChat';
import type { PageProps } from '../types';
import type { ImageUseTemplate } from '../configuration-types';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Scenario selection must not use a provider'); })); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); Reflect.deleteProperty(window, 'desktop'); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }

describe('超出聊天附件数的自定义用途入口', () => {
  it.each([9, 12])('%d图场景可实际选择，明确进入才请求项目，不调用聊天或制作模型', async count => {
    const workspaceId = crypto.randomUUID(), createProject = vi.fn(), start = vi.fn(), onUsePrompt = vi.fn(), importAttachments = vi.fn();
    const template: ImageUseTemplate = { id: `many-${count}`, workspaceId, name: `${count}图自定义用途`, prompt: '按全部原始参考逐一保留细节', size: '1024x1024', background: 'auto', minReferences: count, enabled: true };
    Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { list: async () => [], read: async ({ conversationId }: { conversationId: string }) => ({ version: 1, id: conversationId, workspaceId, title: '新对话', createdAt: '', updatedAt: '', turnCount: 0, turns: [] }), start, importAttachments, onChanged: () => () => {} } } });
    const props = { workspaceId, projects: [], activeProject: { id: '' }, ledger: [], configuration: { useTemplates: [template], models: [], credentials: [], connections: [], workflows: [], categories: [] }, workflowRunner: { runs: [] }, onCreateProject: createProject, onUsePrompt, notify: vi.fn(), navigate: vi.fn() } as unknown as PageProps;
    await act(async () => { root = createRoot(host); root.render(<WorkspaceChat props={props} onLegacy={vi.fn()} />); });
    await click('选择使用场景'); expect(document.body.textContent).toContain(`补齐${count}份`); await click(`使用场景 ${template.name}`);
    expect(createProject).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(importAttachments).not.toHaveBeenCalled(); expect(host.querySelector('[aria-label="对话模型"]')).toBeNull();
    await click(`进入${template.name}`); expect(createProject).toHaveBeenCalledOnce(); expect(createProject.mock.calls[0][0]).toBe('image'); expect(start).not.toHaveBeenCalled(); expect(onUsePrompt).not.toHaveBeenCalled();
    expect(host.querySelector('[role=alert]')).toBeNull();
  });
});
