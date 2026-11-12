// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import type { ChatTarget } from '../chat-types';
import { useChatRefinement } from './useChatRefinement';

const model = { id: 'model', modelId: 'fixture-edit', name: '测试模型', enabled: true, connectionId: 'connection', capabilities: ['image-editing'], pricing: { unit: 'image', currency: 'USD', input: '0', output: '0' } };
vi.mock('../components/NaturalAutomationModels', () => ({ naturalModelSelection: () => ({ model, credentialId: 'credential' }) }));
const target: ChatTarget = { projectId: 'project', artifactId: 'source', sha256: 'a'.repeat(64), kind: 'image' };
let root: Root | undefined, host: HTMLDivElement, value: ReturnType<typeof useChatRefinement>;
let props: PageProps, link: ReturnType<typeof vi.fn>, start: ReturnType<typeof vi.fn>, lookup: ReturnType<typeof vi.fn>;
function Harness() { value = useChatRefinement(props, 'conversation', () => undefined); return <span>{value.busy ? 'busy' : value.unknown ? 'unknown' : 'ready'}</span>; }
async function mount() { host = document.createElement('div'); document.body.append(host); await act(async () => { root = createRoot(host); root.render(<Harness />); }); }
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  link = vi.fn(async () => ({})); start = vi.fn(async () => ({ status: 'started', runId: 'exact-run' })); lookup = vi.fn(async () => ({ status: 'rejected', code: 'NO_PENDING_START', error: '没有待确认记录' }));
  props = { workspaceId: 'workspace', projects: [{ id: 'project', workspaceId: 'workspace', kind: 'image', name: '原项目' }], configuration: { connections: [] }, workflowRunner: { runs: [], preflight: vi.fn(async () => ({ ok: true, errors: [] })), startLive: start, readStartResult: lookup } } as unknown as PageProps;
  Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { inspectTarget: vi.fn(async () => ({ sha256: target.sha256, artifact: { id: 'source', projectId: 'project', mimeType: 'image/png' } })), linkProduction: link }, runtime: { snapshot: vi.fn(async () => ({ runs: [], ledger: [] })) } } });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.unstubAllGlobals(); });

it('retries only the confirmed run link after a lost local association, including a page remount', async () => {
  link.mockRejectedValueOnce(Error('local association unavailable'));
  await mount(); await act(async () => { expect(await value.start(target, '只修改文字', {})).toBe(false); });
  expect(value.unknown?.runId).toBe('exact-run'); expect(start).toHaveBeenCalledOnce();
  await act(async () => root!.unmount()); root = undefined; host.remove(); await mount();
  await act(async () => value.readUnknown());
  expect(link).toHaveBeenLastCalledWith(expect.objectContaining({ runId: 'exact-run', target }));
  expect(start).toHaveBeenCalledOnce(); expect(lookup).not.toHaveBeenCalled(); expect(value.unknown).toBeUndefined();
});

it('retains an unresolved dispatch and does not submit twice; a confirmed absent task unlocks retry', async () => {
  start.mockResolvedValueOnce({ status: 'unknown', dispatchKey: 'b'.repeat(64), error: 'unknown' });
  await mount(); await act(async () => { await value.start(target, '第一次修改', {}); });
  await act(async () => { expect(await value.start(target, '再次点击', {})).toBe(false); }); expect(start).toHaveBeenCalledOnce();
  await act(async () => value.readUnknown()); expect(value.unknown).toBeUndefined();
  await act(async () => { await value.start(target, '重新提交', {}); }); expect(start).toHaveBeenCalledTimes(2);
});

it('recovers a confirmed admission from the exact workflow ID if acknowledgement persistence failed', async () => {
  start.mockImplementationOnce(async (workflow: { id: string }) => { localStorage.setItem('saved-workflow', workflow.id); throw Error('renderer lost ACK'); });
  await mount(); await act(async () => { await value.start(target, '保留细节', {}); });
  const workflowId = localStorage.getItem('saved-workflow');
  vi.mocked(window.desktop!.runtime!.snapshot).mockResolvedValue({ runs: [{ id: 'found-run', projectId: 'project', workspaceId: 'workspace', workflowId }] } as never);
  await act(async () => value.readUnknown()); expect(link).toHaveBeenLastCalledWith(expect.objectContaining({ runId: 'found-run' })); expect(start).toHaveBeenCalledOnce();
});
