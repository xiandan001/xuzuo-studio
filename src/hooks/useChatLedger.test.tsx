// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry } from '../types';
import type { ChatChangedEvent } from '../chat-types';
import { useChatLedger } from './useChatLedger';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); host.remove(); vi.unstubAllGlobals(); });
const entry = (workspaceId: string, costCents: number) => ({ id: workspaceId, projectId: `chat-${workspaceId}`, scope: 'chat', workspaceId, costCents, costState: 'calculated', billingMode: 'live' }) as LedgerEntry;
function View({ workspaceId }: { workspaceId: string }) { const state = useChatLedger(workspaceId); return <div><span>{state.entries.map(item => `${item.workspaceId}:${item.costCents}`).join(',')}</span>{state.error && <p role="alert">{state.error}</p>}</div>; }
describe('工作区聊天费用同步', () => {
  it('流式正文不重读账本，费用变化才刷新；读取失败保留已知费用并明确提示', async () => {
    const listeners = new Set<(event: ChatChangedEvent) => void>(), ledger = vi.fn(async () => [entry('workspace', 2)]);
    Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { ledger, onChanged(callback: (event: ChatChangedEvent) => void) { listeners.add(callback); return () => listeners.delete(callback); } } } });
    await act(async () => { root = createRoot(host); root.render(<View workspaceId="workspace" />); });
    expect(host.textContent).toContain('workspace:2');
    await act(async () => { for (let n = 0; n < 20; n++) for (const listener of listeners) listener({ workspaceId: 'workspace', conversationId: 'conversation', ledgerChanged: false }); });
    expect(ledger).toHaveBeenCalledOnce();
    ledger.mockRejectedValueOnce(Error('temporary read failure'));
    await act(async () => { for (const listener of listeners) listener({ workspaceId: 'workspace', conversationId: 'conversation', ledgerChanged: true }); });
    expect(host.textContent).toContain('workspace:2'); expect(host.querySelector('[role=alert]')?.textContent).toContain('暂未同步');
  });
  it('切换工作区后，上一工作区迟到的费用不能出现在当前总额', async () => {
    let resolveOld!: (items: LedgerEntry[]) => void;
    const ledger = vi.fn((workspaceId: string) => workspaceId === 'old' ? new Promise<LedgerEntry[]>(resolve => { resolveOld = resolve; }) : Promise.resolve([entry('new', 3)]));
    Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { ledger, onChanged: () => () => {} } } });
    await act(async () => { root = createRoot(host); root.render(<View workspaceId="old" />); });
    await act(async () => { root!.render(<View workspaceId="new" />); }); expect(host.textContent).toBe('new:3');
    await act(async () => { resolveOld([entry('old', 99)]); }); expect(host.textContent).toBe('new:3');
  });
});
