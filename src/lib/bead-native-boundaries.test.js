import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { fixture, image, pdfFixture, dependencies } = require('./bead-native-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { createBeadPdfPrinter } = require('../../electron/bead-pdf-printer.cjs');
const active = [];
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }
describe('拼豆缓存、不可见恢复点与并发边界', () => {
  it('bounds source previews and the two-entry cache, rereading real managed SHA before using any cached pixels', async () => {
    const f = await setup(), decode = vi.spyOn(f.nativeImage, 'createFromBuffer'), references = [];
    for (const channel of [255, 180, 100]) references.push(await f.artifactStore.write({ projectId: 'project-a', name: '大底图.png', mimeType: 'image/png', buffer: PNG.sync.write(image(768, 768, [channel, 0, 0, 255])) }));
    for (const reference of references) { const source = await f.service.source({ projectId: 'project-a', referenceId: reference.id }); const preview = PNG.sync.read(Buffer.from(source.dataUrl.split(',')[1], 'base64')); expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(512); }
    expect(f.service.sourceStats()).toMatchObject({ maxEntries: 2, maxBytes: 8 * 1024 * 1024 }); expect(f.service.sourceStats().entries).toBeLessThanOrEqual(2); expect(f.service.sourceStats().bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    const count = decode.mock.calls.length; await f.service.source({ projectId: 'project-a', referenceId: references[2].id }); expect(decode).toHaveBeenCalledTimes(count);
    expect(references[2].path.startsWith(f.directory + path.sep)).toBe(true); await fs.appendFile(references[2].path, 'changed'); await expect(f.service.source({ projectId: 'project-a', referenceId: references[2].id })).rejects.toThrow(); expect(decode).toHaveBeenCalledTimes(count);
  });
  it('passes premultiplied BGRA through the real worker without darkening a half-transparent red source', async () => {
    const f = await setup(), reference = await f.artifactStore.write({ projectId: 'project-a', name: '红色透明底图.png', mimeType: 'image/png', buffer: PNG.sync.write(image(8, 8, [255, 0, 0, 128])) });
    const document = await f.service.generate({ ...f.input(), referenceId: reference.id }); expect(document.pattern.cells.every(cell => cell === 1)).toBe(true); const raster = f.calls.find(call => call.task === 'bead').input.raster; expect([...raster.pixels.subarray(0, 4)]).toEqual([0, 0, 128, 128]);
  });
  it.each(['prepared', 'unverified'])('exposes a %s independent recovery point instead of creating a blank document', async state => {
    const f = await setup(), document = await f.service.generate(f.input()), place = await f.workspaceStorage.projectDirectory('project-a'), control = path.join(place, '.xuzuo'), index = path.join(control, 'bead-revisions-v1', 'index-v1.json');
    expect(control.startsWith(f.directory + path.sep)).toBe(true); await fs.unlink(path.join(control, 'bead-v1.json'));
    if (state === 'prepared') { const content = JSON.parse(await fs.readFile(index, 'utf8')); content.entries.forEach(entry => { entry.committed = false; }); await fs.writeFile(index, JSON.stringify(content)); } else await fs.writeFile(index, 'BROKEN-INDEX');
    await expect(f.service.read({ projectId: 'project-a' })).rejects.toThrow('恢复点'); await expect(f.service.generate(f.input())).rejects.toThrow('恢复点');
    const history = await f.service.history({ projectId: 'project-a' }); expect(history[0]).toMatchObject({ revision: document.revision, recoveryState: state }); expect(history[0]).not.toHaveProperty('pattern');
    const restored = await f.service.restore({ projectId: 'project-a', revision: document.revision }); expect(restored.pattern.cells).toEqual(document.pattern.cells); expect(restored.revision).toBeGreaterThan(document.revision); expect(restored.id).toBe(document.id);
  });
  it('does not let a late generation overwrite a manual save made against its earlier revision', async () => {
    const f = await setup(), document = await f.service.generate(f.input()); let enter, release;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { enter = resolve; }); f.setTaskHook(async (task, _input, _options, execute) => { if (task === 'bead') { enter(); await gate; } return execute(); });
    const pending = f.service.generate({ ...f.input('project-a', document.revision), title: '迟到的新制图' }).catch(error => error); await started;
    const saved = await f.service.save({ projectId: 'project-a', document: { ...document, title: '手工保存优先' }, expectedRevision: document.revision }); release(); expect(await pending).toBeInstanceOf(Error); expect((await f.service.read({ projectId: 'project-a' })).revision).toBe(saved.revision); expect((await f.service.read({ projectId: 'project-a' })).title).toBe('手工保存优先');
  });
  it('cancels a queued export before writing any new artifact and remains usable after close preparation is cancelled', async () => {
    const f = await setup(), document = await f.service.generate(f.input()), before = await f.artifactStore.listProject('project-a'); let enter, release;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { enter = resolve; }); f.setTaskHook(async (task, _input, _options, execute) => { if (task === 'bead-export') { enter(); await gate; } return execute(); });
    const pending = f.service.export({ projectId: 'project-a', format: 'png', expectedRevision: document.revision }).catch(error => error); await started; await f.service.cancel({ projectId: 'project-a' }); release(); expect(await pending).toMatchObject({ name: 'AbortError' }); expect(await f.artifactStore.listProject('project-a')).toEqual(before);
    f.setTaskHook(undefined); await f.service.prepareClose(); expect((await f.service.read({ projectId: 'project-a' })).id).toBe(document.id);
  });
  it('never writes recovery JSON into internal state folders or another project scope', async () => {
    const f = await setup(), document = await f.service.generate(f.input()), place = await f.workspaceStorage.projectDirectory('project-a'); f.dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(place, '.xuzuo', 'bead-v1.json') });
    await expect(f.service.exportRecovery({ projectId: 'project-a', document })).rejects.toThrow('内部状态'); await expect(f.service.exportRecovery({ projectId: 'project-b', document })).rejects.toThrow('不属于'); expect((await f.service.read({ projectId: 'project-a' })).revision).toBe(document.revision);
  });
});
describe('拼豆PDF安全打印生命周期（窗口API契约；真实Skia另验）', () => {
  function windows(handler) {
    const created = [];
    class FakeWindow {
      constructor(options) { this.options = options; this.destroyed = false; this.webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), session: { webRequest: { onBeforeRequest: vi.fn() } }, loadURL: vi.fn(async url => { this.url = url; }), printToPDF: vi.fn(async settings => handler(this, settings)) }; created.push(this); }
      isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
    }
    return { created, BrowserWindow: FakeWindow };
  }
  it('uses a hidden isolated sandbox, denies all network/file resources and destroys the window on successful output', async () => {
    const f = windows(() => pdfFixture(2)), printer = createBeadPdfPrinter(f); const buffer = await printer.print({ html: '<html><body>printed fixture</body></html>', pages: 2 });
    expect(buffer.toString('ascii', 0, 5)).toBe('%PDF-'); expect(f.created[0].options).toMatchObject({ show: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } }); expect(f.created[0].options.webPreferences.partition).toMatch(/^bead-print-/); expect(decodeURIComponent(f.created[0].url)).toContain("connect-src 'none'"); expect(f.created[0].destroyed).toBe(true);
    const callback = f.created[0].webContents.session.webRequest.onBeforeRequest.mock.calls[0][1], done = vi.fn(); callback({}, done); expect(done).toHaveBeenCalledWith({ cancel: true }); await printer.shutdown();
  });
  it('rejects page count drift, more than 100 pages or oversized HTML without accepting a false completed PDF', async () => {
    const f = windows(() => pdfFixture(2)), printer = createBeadPdfPrinter(f); await expect(printer.print({ html: '<div/>', pages: 1 })).rejects.toThrow('实际2页'); expect(f.created[0].destroyed).toBe(true);
    await expect(printer.print({ html: '<div/>', pages: 101 })).rejects.toThrow('100页'); await expect(printer.print({ html: 'x'.repeat(16 * 1024 * 1024 + 1), pages: 1 })).rejects.toThrow('16MB'); expect(f.created).toHaveLength(1); await printer.shutdown();
  });
  it('cancels active hidden printing, skips a cancelled queued window and releases all handles on drain', async () => {
    let finish; const held = new Promise(resolve => { finish = resolve; }), f = windows(async () => held), printer = createBeadPdfPrinter(f), first = new AbortController(), second = new AbortController();
    const activePrint = printer.print({ html: '<div/>', pages: 1 }, { signal: first.signal }).catch(error => error); await vi.waitFor(() => expect(f.created).toHaveLength(1)); const queued = printer.print({ html: '<div/>', pages: 1 }, { signal: second.signal }).catch(error => error); second.abort(); first.abort();
    expect(await activePrint).toMatchObject({ name: 'AbortError' }); expect(await queued).toMatchObject({ name: 'AbortError' }); finish(pdfFixture()); await printer.shutdown(); expect(f.created).toHaveLength(1); expect(f.created[0].destroyed).toBe(true);
  });
});
