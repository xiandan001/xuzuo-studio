import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createCustomDialogs } = require('../../electron/custom-dialogs.cjs');
const { writeDialogFile } = require('../../electron/dialog-save.cjs');

async function fixture(overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-dialog-broker-')), workspace = path.join(directory, 'workspace'), userData = path.join(directory, 'app-private');
  await fs.mkdir(workspace); await fs.mkdir(userData);
  const windows = [], handlers = new Map();
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.options = options; this.destroyed = false; this.shown = 0; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: '' }; this.webContents.setWindowOpenHandler = value => { this.openHandler = value; }; this.webContents.send = () => undefined; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; queueMicrotask(() => this.emit('ready-to-show')); return Promise.resolve(); }
    show() { this.shown++; }
    focus() {}
    setBackgroundColor(value) { this.color = value; }
  }
  const owner = new Window(); windows.length = 0;
  const broker = createCustomDialogs({ app: { getPath: name => name === 'userData' ? userData : workspace }, BrowserWindow: Window, ipcMain: { handle: (name, action) => handlers.set(name, action), removeHandler: name => handlers.delete(name) }, getWindow: () => owner, trustedSender: event => event.sender === owner.webContents, locationsProvider: async () => ({ locations: [{ name: '测试位置', path: workspace }] }), hidden: true, ...overrides });
  const invoke = (window, name, data = {}, eventChanges = {}) => handlers.get(`studio-dialog:${name}`)({ sender: window.webContents, senderFrame: window.webContents.mainFrame, ...eventChanges }, { ...data, id: window.options.webPreferences.additionalArguments.find(item => item.startsWith('--studio-dialog-id=')).split('=')[1] });
  async function nextWindow(index = 0) { const deadline = Date.now() + 2000; while (Date.now() < deadline) { if (windows[index]) return windows[index]; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('Dialog fixture did not open'); }
  return { directory, workspace, userData, broker, windows, owner, handlers, invoke, nextWindow };
}

describe('custom native dialog broker', () => {
  it('prepares directory browsing from zero-query locations and cancels background discovery with the picker', async () => {
    let calls = 0, release, canceled = 0;
    const provider = async directory => { calls++; await new Promise(resolve => { release = resolve; }); return { locations: [{ name: 'disk', path: directory }] }; };
    provider.peek = directory => ({ locations: [{ name: '快捷位置', path: directory }], pending: true });
    provider.cancelPending = () => { canceled++; release?.(); };
    const f = await fixture({ locationsProvider: provider }), pending = f.broker.showOpenDialog({ properties: ['openDirectory'] }), window = await f.nextWindow();
    const config = await f.invoke(window, 'request'); expect(config.seed.locationsPending).toBe(true); expect(calls).toBe(0);
    const update = f.invoke(window, 'locations', { force: true }), rejected = expect(update).rejects.toThrow('已取消');
    await new Promise(resolve => setTimeout(resolve, 0)); f.broker.cancelPickers(); await rejected;
    expect((await pending).canceled).toBe(true); expect(canceled).toBe(1); expect(f.broker.stats().active).toBe(0); f.broker.dispose();
  });
  it('never starts a disk query for a workspace-scoped project picker', async () => {
    let calls = 0; const provider = async () => { calls++; throw Error('unexpected disk scan'); };
    provider.peek = directory => ({ locations: [{ name: '工作区', path: directory }], pending: true });
    const f = await fixture({ locationsProvider: provider }), pending = f.broker.showOpenDialog({ properties: ['openDirectory'], allowedRoot: f.workspace, selectEmpty: true }), window = await f.nextWindow();
    expect((await f.invoke(window, 'request')).seed.locationsPending).toBeUndefined();
    expect((await f.invoke(window, 'locations', { force: true })).locations).toHaveLength(1); expect(calls).toBe(0);
    await f.invoke(window, 'cancel'); await pending; f.broker.dispose();
  });
  it('refreshes only native locations and reapplies scope and private-path rules without changing exact selection', async () => {
    let locations = [], warning = '磁盘识别未完成，请刷新重试。';
    const f = await fixture({ locationsProvider: async () => ({ locations, warning }) }), child = path.join(f.workspace, '项目'); await fs.mkdir(child);
    locations = [{ name: '当前工作区', path: f.workspace }, { name: '其它磁盘', path: path.parse(f.workspace).root }];
    const pending = f.broker.showOpenDialog({ properties: ['openDirectory'], allowedRoot: f.workspace, exactPath: child }), window = await f.nextWindow(), config = await f.invoke(window, 'request');
    expect(config.seed.locations).toHaveLength(1); expect(config.seed.locationWarning).toBe(warning);
    warning = undefined; locations = [{ name: '项目', path: child }, { name: '其它磁盘', path: path.parse(f.workspace).root }, { name: '控制目录', path: path.join(f.workspace, '.xuzuo') }];
    const refreshed = await f.invoke(window, 'locations', { locations: [{ name: 'renderer-forged', path: f.directory }] });
    expect(refreshed.locations).toEqual([{ name: '项目', path: child }]); expect(refreshed.warning).toBeUndefined();
    await expect(f.invoke(window, 'locations', {}, { sender: f.owner.webContents })).rejects.toThrow('失效');
    await expect(f.invoke(window, 'accept', { directory: f.workspace })).rejects.toThrow('原位置');
    await f.invoke(window, 'accept', { directory: child }); expect((await pending).filePaths).toEqual([child]); f.broker.dispose();
  });
  it('discards a location refresh completed after its dialog was canceled', async () => {
    let release, calls = 0; const waiting = new Promise(resolve => { release = resolve; });
    const f = await fixture({ locationsProvider: async () => ++calls === 1 ? { locations: [] } : waiting });
    const pending = f.broker.showOpenDialog({ properties: ['openDirectory'] }), window = await f.nextWindow(); await f.invoke(window, 'request');
    const refresh = f.invoke(window, 'locations'), rejected = expect(refresh).rejects.toThrow('已取消');
    await new Promise(resolve => setTimeout(resolve, 0)); await f.invoke(window, 'cancel'); release({ locations: [] });
    await rejected; expect((await pending).canceled).toBe(true); expect(f.broker.stats().active).toBe(0); f.broker.dispose();
  });
  it('shows a loading window before location discovery completes and cancels its caller immediately', async () => {
    let release; const waiting = new Promise(resolve => { release = resolve; });
    const f = await fixture({ locationsProvider: () => waiting, initialAppearance: { mode: 'dark', palette: 'blue' } }), pending = f.broker.showOpenDialog({ properties: ['openDirectory'] });
    expect(f.windows).toHaveLength(1); const window = await f.nextWindow();
    expect(window.options.webPreferences.additionalArguments).toContain('--studio-dialog-mode=dark');
    expect(window.options.webPreferences.additionalArguments).toContain('--studio-dialog-palette=blue');
    f.broker.cancelPickers();
    await expect(pending).resolves.toMatchObject({ canceled: true });
    expect(window.destroyed).toBe(true); expect(f.broker.stats().active).toBe(0);
    release({ locations: [{ name: 'late', path: f.workspace }] }); await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.windows).toHaveLength(1); expect(await fs.readdir(f.workspace)).toEqual([]); f.broker.dispose();
  });
  it('does not make exit wait for an unfinished readonly seed or publish a late prepared window', async () => {
    let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const f = await fixture({ fileSessionFactory: () => ({ seed: async () => { entered(); await gate; return { path: 'late' }; } }) });
    const pending = f.broker.showSaveDialog({ defaultPath: 'result.txt' }), window = await f.nextWindow(); await started;
    f.broker.cancelPickers(); await expect(pending).resolves.toMatchObject({ canceled: true });
    expect(window.destroyed).toBe(true); release(); await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.windows).toHaveLength(1); expect(f.broker.stats().active).toBe(0); f.broker.dispose();
  });
  it('opens an isolated sandbox window with sanitized options and strict child authority', async () => {
    const f = await fixture(), result = f.broker.showOpenDialog(f.owner, { title: '测试选择', properties: ['openDirectory', 'createDirectory', 'unsupported'], secret: 'must-not-be-forwarded' });
    const window = await f.nextWindow(), config = await f.invoke(window, 'request');
    expect(config.options.secret).toBeUndefined(); expect(config.options.properties).not.toContain('unsupported'); expect(config.seed.directoryOnly).toBe(true);
    expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false }); expect(window.options.webPreferences.partition).toMatch(/^studio-dialog-/); expect(window.shown).toBe(0);
    expect(window.options).toMatchObject({ frame: false, roundedCorners: true, thickFrame: true }); expect(window.options.transparent).not.toBe(true); expect(window.options.resizable).not.toBe(false);
    await expect(f.invoke(window, 'request', {}, { sender: f.owner.webContents })).rejects.toThrow('失效');
    await expect(f.invoke(window, 'request', {}, { senderFrame: { url: window.url } })).rejects.toThrow('失效');
    await f.invoke(window, 'cancel'); await expect(result).resolves.toMatchObject({ canceled: true, filePaths: [] }); f.broker.dispose();
  });
  it('rejects the application data root as a destination directory but allows an independent child workspace', async () => {
    const f = await fixture(), child = path.join(f.userData, '独立工作区'); await fs.mkdir(child);
    const pending = f.broker.showOpenDialog({ properties: ['openDirectory'] }), window = await f.nextWindow(); await f.invoke(window, 'request');
    await expect(f.invoke(window, 'accept', { paths: [f.userData] })).rejects.toThrow('应用数据目录'); expect(window.destroyed).toBe(false);
    await f.invoke(window, 'accept', { paths: [child] }); expect((await pending).filePaths).toEqual([child]); f.broker.dispose();
  });
  it('keeps an invalid selected folder open so the user can correct it inline', async () => {
    const f = await fixture(); let allow = false;
    const result = f.broker.showOpenDialog({ properties: ['openDirectory'], validateSelection: () => { if (!allow) throw new Error('请选择项目子目录'); } });
    const window = await f.nextWindow(); await f.invoke(window, 'request');
    await expect(f.invoke(window, 'accept', { paths: [f.workspace] })).rejects.toThrow('项目子目录'); expect(window.destroyed).toBe(false);
    allow = true; await f.invoke(window, 'accept', { paths: [f.workspace] }); expect((await result).filePaths).toEqual([f.workspace]); expect(window.destroyed).toBe(true); f.broker.dispose();
  });
  it('cancels active file requests before exit while leaving a separate message usable', async () => {
    const f = await fixture(), picker = f.broker.showOpenDialog({ properties: ['openDirectory'] });
    const fileWindow = await f.nextWindow(); await f.invoke(fileWindow, 'request');
    const message = f.broker.showMessageBox({ message: '退出？', buttons: ['返回', '安全退出'], cancelId: 0 });
    const messageWindow = await f.nextWindow(1); await f.invoke(messageWindow, 'request');
    expect(messageWindow.options.webPreferences.partition).not.toBe(fileWindow.options.webPreferences.partition);
    f.broker.cancelPickers(); await expect(picker).resolves.toMatchObject({ canceled: true }); expect(f.broker.stats()).toMatchObject({ active: 1, pickers: 0 });
    await f.invoke(messageWindow, 'respond-message', { index: 1 }); await expect(message).resolves.toEqual({ response: 1 }); f.broker.dispose();
  });
  it('cancels messages on AbortSignal without accepting a force action', async () => {
    const f = await fixture(), signal = new AbortController(), pending = f.broker.showMessageBox({ buttons: ['继续等待', '强制退出'], cancelId: 0, signal: signal.signal });
    const window = await f.nextWindow(); signal.abort(); expect(await pending).toEqual({ response: 0 }); expect(window.destroyed).toBe(true); f.broker.dispose();
  });
  it('replaces a crashed message renderer with an independent custom fallback and rejects the old sender', async () => {
    const f = await fixture(), pending = f.broker.showMessageBox({ message: '<img src=unsafe>', buttons: ['返回', '退出'], cancelId: 0 });
    const original = await f.nextWindow(); await f.invoke(original, 'request'); original.webContents.emit('render-process-gone');
    const fallback = await f.nextWindow(1), config = await f.invoke(fallback, 'request');
    expect(original.destroyed).toBe(true); expect(fallback.url).toMatch(/^data:text\/html/); expect(decodeURIComponent(fallback.url)).not.toContain('<img src=unsafe>');
    expect(config.options.message).toBe('<img src=unsafe>'); expect(f.broker.stats().fallbackCount).toBe(1);
    await expect(f.invoke(original, 'respond-message', { index: 1 })).rejects.toThrow('失效');
    await f.invoke(fallback, 'respond-message', { index: 0 }); expect(await pending).toEqual({ response: 0 }); f.broker.dispose();
  });
  it('requires custom overwrite approval and verifies the saved target again after the window closes', async () => {
    const f = await fixture(), target = path.join(f.workspace, '结果.txt'); await fs.writeFile(target, '原文');
    const pending = f.broker.showSaveDialog({ defaultPath: target, filters: [{ name: '文字', extensions: ['txt'] }] });
    const window = await f.nextWindow(); await f.invoke(window, 'request');
    const overwrite = await f.invoke(window, 'accept', { directory: f.workspace, filename: '结果.txt' }); expect(overwrite.overwriteRequired).toBe(true);
    await f.invoke(window, 'accept', { directory: f.workspace, filename: '结果.txt', overwriteToken: overwrite.token });
    const result = await pending; expect(window.destroyed).toBe(true); expect(await writeDialogFile(result, Buffer.from('新内容'))).toMatchObject({ saved: true, path: target }); expect(await fs.readFile(target, 'utf8')).toBe('新内容'); f.broker.dispose();
  });
  it('does not overwrite a target that changed after approval, and cleans its own temporary file', async () => {
    const f = await fixture(), target = path.join(f.workspace, '结果.txt');
    const pending = f.broker.showSaveDialog({ defaultPath: target }); const window = await f.nextWindow(); await f.invoke(window, 'request');
    await f.invoke(window, 'accept', { directory: f.workspace, filename: '结果.txt' }); const result = await pending;
    await fs.writeFile(target, '外部新增的资料'); await expect(writeDialogFile(result, Buffer.from('不能覆盖'))).rejects.toThrow('已变化');
    expect(await fs.readFile(target, 'utf8')).toBe('外部新增的资料'); expect(await fs.readdir(f.workspace)).toEqual(['结果.txt']); f.broker.dispose();
  });
  it('reports a failed file-picker renderer and releases the pending business call', async () => {
    const f = await fixture(), pending = f.broker.showOpenDialog({ properties: ['openDirectory'] });
    const expected = expect(pending).rejects.toThrow('未能打开'); const window = await f.nextWindow(); window.webContents.emit('did-fail-load'); await expected;
    expect(f.broker.stats().active).toBe(0); expect(window.destroyed).toBe(true); f.broker.dispose();
  });
  it('cancels stale file requests on owner navigation and does not start files while closing', async () => {
    const f = await fixture(); f.broker.installOwner(f.owner);
    const pending = f.broker.showOpenDialog({ properties: ['openDirectory'] }); await f.nextWindow();
    f.owner.webContents.emit('did-start-navigation', {}, 'file:///reloaded.html', false, true); await expect(pending).resolves.toMatchObject({ canceled: true }); expect(f.broker.stats().active).toBe(0); f.broker.dispose();
    const closed = await fixture({ canStart: () => false }); await expect(closed.broker.showOpenDialog({ properties: ['openDirectory'] })).resolves.toMatchObject({ canceled: true }); expect(closed.windows).toHaveLength(0); closed.broker.dispose();
  });
});
