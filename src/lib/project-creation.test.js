import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { registerProjectCreation } = createRequire(import.meta.url)('../../electron/project-creation.cjs');

function fixture() {
  const handlers = new Map(), showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace/chosen'] }));
  const storage = { list: vi.fn(async () => ({ workspaces: [{ workspaceId: 'workspace', directory: 'C:/workspace' }], projects: [] })), reconnectRoot: vi.fn(async input => ({ ...input, repaired: true, missingProjectIds: ['old'] })), validateWorkspace: vi.fn(async () => 'C:/workspace'), inspectProjectFolder: vi.fn(async input => ({ ...input, folderName: 'chosen' })), claimProjectFolder: vi.fn(async input => input) };
  registerProjectCreation({ handle: (name, action) => handlers.set(name, action), dialog: { showOpenDialog }, getWindow: () => ({}), workspaceStorage: storage, withProjectWrite: (_id, action) => action() });
  return { storage, showOpenDialog, choose: input => handlers.get('workspace-project-folder')(input), create: input => handlers.get('workspace-create-project')(input), reconnect: input => handlers.get('workspace-reconnect')(input) };
}
describe('folder-first native selection authority', () => {
  it('cancel selects no project and an arbitrary renderer path cannot be committed', async () => {
    const f = fixture(); f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await f.choose({ workspaceId: 'workspace' })).toBeNull();
    await expect(f.create({ selectionId: 'forged', name: 'name', directory: 'C:/other' })).rejects.toThrow('先选择');
    expect(f.storage.claimProjectFolder).not.toHaveBeenCalled();
  });
  it('commits exactly the chosen folder and stable native ID, preserving a choice across a canceled replacement', async () => {
    const f = fixture(), selected = await f.choose({ workspaceId: 'workspace' });
    f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await f.choose({ workspaceId: 'workspace' })).toBeNull();
    const input = { selectionId: selected.selectionId, name: '  chosen name  ', directory: 'C:/forged' };
    const first = await f.create(input), second = await f.create(input);
    expect(first).toMatchObject({ projectId: selected.projectId, workspaceId: 'workspace', directory: 'C:/workspace/chosen', name: 'chosen name' });
    expect(second).toEqual(first); expect(f.storage.inspectProjectFolder).toHaveBeenCalledTimes(1);
  });
  it('failed replacement retains previous authority and successful replacement invalidates the old selection', async () => {
    const f = fixture(), first = await f.choose({ workspaceId: 'workspace' });
    f.storage.inspectProjectFolder.mockRejectedValueOnce(new Error('nonempty'));
    await expect(f.choose({ workspaceId: 'workspace' })).rejects.toThrow('nonempty');
    await expect(f.create({ selectionId: first.selectionId, name: 'first' })).resolves.toMatchObject({ projectId: first.projectId });
    const next = await f.choose({ workspaceId: 'workspace' }); expect(next.projectId).not.toBe(first.projectId);
    await expect(f.create({ selectionId: first.selectionId, name: 'first' })).rejects.toThrow('先选择');
  });
  it('allows only one picker and keeps selection checks behind the native directory dialog', async () => {
    const f = fixture(); let resolve;
    f.showOpenDialog.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.choose({ workspaceId: 'workspace' }); await Promise.resolve();
    await expect(f.choose({ workspaceId: 'workspace' })).rejects.toThrow('处理中');
    expect(f.storage.inspectProjectFolder).not.toHaveBeenCalled(); resolve({ canceled: true, filePaths: [] }); await pending;
  });
  it('new projects start at the workspace root after a successful claim while a retry keeps its original ticket', async () => {
    const f = fixture(), selected = await f.choose({ workspaceId: 'workspace' });
    f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] }); await f.choose({ workspaceId: 'workspace' });
    expect(f.showOpenDialog.mock.calls.at(-1)[1].defaultPath).toBe(selected.directory);
    const input = { selectionId: selected.selectionId, name: 'first' }, created = await f.create(input);
    await expect(f.create(input)).resolves.toEqual(created);
    f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] }); await f.choose({ workspaceId: 'workspace' });
    expect(f.showOpenDialog.mock.calls.at(-1)[1].defaultPath).toBe('C:/workspace');
  });
  it('a failed claim does not forget the still-unclaimed folder', async () => {
    const f = fixture(), selected = await f.choose({ workspaceId: 'workspace' });
    f.storage.claimProjectFolder.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await expect(f.create({ selectionId: selected.selectionId, name: 'first' })).rejects.toThrow('temporarily');
    f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] }); await f.choose({ workspaceId: 'workspace' });
    expect(f.showOpenDialog.mock.calls.at(-1)[1].defaultPath).toBe(selected.directory);
    await expect(f.create({ selectionId: selected.selectionId, name: 'first' })).resolves.toMatchObject({ projectId: selected.projectId });
  });
});


describe('explicit workspace reconnection', () => {
  it('cancel does not repair and a successful reconnect takes the native selected path only', async () => {
    const f = fixture(); f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await f.reconnect({ workspaceId: 'workspace', directory: 'C:/forged' })).toBeNull();
    expect(f.storage.reconnectRoot).not.toHaveBeenCalled();
    f.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/workspace'] });
    await expect(f.reconnect({ workspaceId: 'workspace', directory: 'C:/forged' })).resolves.toMatchObject({ repaired: true });
    expect(f.storage.reconnectRoot).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', directory: 'C:/workspace' });
  });
  it('keeps the original project selection ticket valid after reconnecting the same workspace', async () => {
    const f = fixture(), selected = await f.choose({ workspaceId: 'workspace' });
    f.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/workspace'] });
    await f.reconnect({ workspaceId: 'workspace' });
    await expect(f.create({ selectionId: selected.selectionId, name: 'retry' })).resolves.toMatchObject({ projectId: selected.projectId, directory: selected.directory });
  });
});
