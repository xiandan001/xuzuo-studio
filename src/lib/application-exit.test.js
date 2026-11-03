import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { createApplicationExit } = createRequire(import.meta.url)('../../electron/application-exit.cjs');
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => {
  if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'xuzuo-exit-update-'))) throw Error('Unexpected fixture path');
  return fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
})); });

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function fixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-exit-update-')); roots.push(root);
  const app = Object.assign(new EventEmitter(), { getPath: () => root, exit: vi.fn() });
  const options = { app, ipcMain: new EventEmitter(), getWindow: () => null, trustedSender: () => true, getTaskState: async () => ({ running: 0 }), drain: vi.fn(async () => {}), onStatus: vi.fn(), dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) }, ...overrides };
  return { ...options, root, exit: createApplicationExit(options) };
}

describe('safe exit update handoff', () => {
  it('waits for data drain, then installer handoff, before exiting', async () => {
    const saving = deferred(), handingOff = deferred();
    const beforeExit = vi.fn(() => handingOff.promise);
    const f = await fixture({ drain: () => saving.promise, beforeExit });
    const request = f.exit.request();
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(beforeExit).not.toHaveBeenCalled(); expect(f.app.exit).not.toHaveBeenCalled();
    saving.resolve(); await request;
    await vi.waitFor(() => expect(beforeExit).toHaveBeenCalledOnce());
    expect(f.app.exit).not.toHaveBeenCalled();
    handingOff.resolve(); await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalledWith(0));
  });
  it('does not hand off an update when the user cancels exit', async () => {
    const beforeExit = vi.fn();
    const f = await fixture({ getTaskState: async () => ({ running: 1 }), beforeExit });
    expect(await f.exit.request()).toEqual({ cancelled: true });
    expect(beforeExit).not.toHaveBeenCalled(); expect(f.app.exit).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await fs.readFile(path.join(f.root, 'diagnostics/exit-events.jsonl'), 'utf8')).toContain('cancelled'));
  });
  it('does not install on a forced exit', async () => {
    const beforeExit = vi.fn();
    const f = await fixture({ getTaskState: async () => { throw Error('unavailable'); }, dialog: { showMessageBox: async () => ({ response: 3 }) }, beforeExit });
    await f.exit.request(); await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalledWith(0));
    expect(beforeExit).not.toHaveBeenCalled(); expect(f.drain).not.toHaveBeenCalled();
  });
  it('still exits and records a failed handoff without leaking private errors', async () => {
    const f = await fixture({ beforeExit: async () => { throw Error('private filesystem details'); } });
    await f.exit.request(); await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalledWith(0));
    const log = await fs.readFile(path.join(f.root, 'diagnostics/exit-events.jsonl'), 'utf8');
    expect(log).toContain('update-handoff-error'); expect(log).not.toContain('private filesystem details');
  });
});
