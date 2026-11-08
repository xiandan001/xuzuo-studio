// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBusinessDraft } from './useBusinessDraft';
import { guardedEditorSessions } from '../lib/editor-session-guard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useBusinessDraft<{ name: string }>>;
const roots: ReturnType<typeof createRoot>[] = [];
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); return { promise, resolve }; };
function Probe({ id, initial, save }: { id: string; initial: { name: string }; save: (value: { name: string }) => Promise<boolean> }) { api = useBusinessDraft(id, 'project', initial, save); return <span>{api.value.name}</span>; }
async function mount(save: (value: { name: string }) => Promise<boolean>) {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host); roots.push(root);
  const show = (id = 'a', name = 'original') => act(async () => root.render(<Probe id={id} initial={{ name }} save={save} />)); await show(); return { show };
}
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('business form durable draft handling', () => {
  it('recovers from a synchronous save throw without getting stuck in saving', async () => {
    const save = vi.fn().mockImplementationOnce(() => { throw Error('目录暂不可写'); }).mockResolvedValue(true); await mount(save);
    await act(async () => api.update({ name: 'edited' }));
    await act(async () => { expect(await api.save()).toBe(false); }); expect(api.saving).toBe(false); expect(api.dirty).toBe(true);
    await act(async () => { expect(await api.save()).toBe(true); }); expect(save).toHaveBeenCalledTimes(2); expect(api.dirty).toBe(false);
  });
  it('waits for edits made during an unfinished save before reporting that leaving is safe', async () => {
    const first = deferred(), save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(true); await mount(save);
    await act(async () => api.update({ name: 'first' })); let pending!: Promise<boolean>;
    await act(async () => { pending = api.save(); }); await act(async () => api.update({ name: 'second' }));
    expect(api.reset()).toBe(false); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(true)); expect(await pending).toBe(true);
    expect(save).toHaveBeenNthCalledWith(2, { name: 'second' }); expect(api.value.name).toBe('second'); expect(api.dirty).toBe(false);
  });
  it('syncs external changes only while clean and supports an explicit reset of failed inputs', async () => {
    const save = vi.fn().mockResolvedValue(false), ui = await mount(save);
    await ui.show('a', 'external'); expect(api.value.name).toBe('external');
    await act(async () => api.update({ name: 'unsaved' })); await ui.show('a', 'new-external'); expect(api.value.name).toBe('unsaved');
    await act(async () => { await api.save(); }); expect(api.error).not.toBe('');
    await act(async () => { expect(api.reset()).toBe(true); }); expect(api.value.name).toBe('new-external'); expect(api.dirty).toBe(false);
  });
  it('keeps failed A input after A to B to A and does not let old A completion alter B', async () => {
    const first = deferred(), save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(false), ui = await mount(save);
    await act(async () => api.update({ name: 'A edited' })); let pending!: Promise<boolean>;
    await act(async () => { pending = api.save(); }); await ui.show('b', 'B original');
    await act(async () => api.update({ name: 'B edited' })); await act(async () => first.resolve(false)); expect(await pending).toBe(false);
    expect(api.value.name).toBe('B edited'); await ui.show('a', 'A server'); expect(api.value.name).toBe('A edited'); expect(api.error).not.toBe('');
    expect(guardedEditorSessions({ includeDirty: true }).some(session => session.id === 'business-form:a')).toBe(true);
  });
  it('debounces automatic saving, retains failed inputs and does not retry idle failures repeatedly', async () => {
    vi.useFakeTimers(); const save = vi.fn().mockResolvedValue(false); await mount(save);
    await act(async () => api.update({ name: 'typing' })); await act(async () => { await vi.advanceTimersByTimeAsync(699); }); expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(save).toHaveBeenCalledTimes(1); expect(api.dirty).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(save).toHaveBeenCalledTimes(1);
  });
});
