import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../electron/dialog-preload.cjs', import.meta.url), 'utf8');

function fixture(args, initiallyParsed = true) {
  const handlers = new Map(), exposed = {}, observers = [];
  const document = { documentElement: initiallyParsed ? { dataset: {}, style: {} } : null };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const calls = [];
  const electron = { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { on: (name, value) => handlers.set(name, value), invoke: async (channel, input) => { calls.push({ channel, input }); } } };
  vm.runInNewContext(source, { require: name => { if (name !== 'electron') throw Error('Unexpected capability'); return electron; }, process: { argv: ['renderer', '--studio-dialog-id=fixture-id', ...args] }, document, MutationObserver: Observer, Set });
  return { document, handlers, bridge: exposed.studioDialog, observers, exposed, calls };
}
describe('dialog preload early appearance', () => {
  it('refreshes locations through the restricted dialog session channel', async () => {
    const f = fixture([]); await f.bridge.refreshLocations();
    expect(JSON.parse(JSON.stringify(f.calls))).toEqual([{ channel: 'studio-dialog:locations', input: { id: 'fixture-id', force: false } }]);
    await f.bridge.refreshLocations({ force: true, path: 'renderer-supplied' });
    expect(JSON.parse(JSON.stringify(f.calls[1]))).toEqual({ channel: 'studio-dialog:locations', input: { id: 'fixture-id', force: true } });
  });
  it('applies known dark settings and replays them before the filesystem request completes', () => {
    const f = fixture(['--studio-dialog-mode=dark', '--studio-dialog-palette=blue']); let current;
    f.bridge.onAppearance(value => { current = value; });
    expect(f.document.documentElement.dataset).toEqual({ appTheme: 'dark', appPalette: 'blue' }); expect(f.document.documentElement.style.colorScheme).toBe('dark');
    expect(JSON.parse(JSON.stringify(current))).toEqual({ mode: 'dark', palette: 'blue' }); expect(Object.keys(f.exposed)).toEqual(['studioDialog']);
  });
  it('waits once for documentElement and rejects arbitrary argument and event values', () => {
    const f = fixture(['--studio-dialog-mode=invalid', '--studio-dialog-palette=unsafe'], false);
    expect(f.observers).toHaveLength(1); f.document.documentElement = { dataset: {}, style: {} }; f.observers[0].callback();
    expect(f.observers[0].disconnected).toBe(true); expect(f.document.documentElement.dataset).toEqual({ appTheme: 'light', appPalette: 'violet' });
    const update = f.handlers.get('studio-dialog:appearance'); update({}, { mode: 'invalid', palette: 'warm' }); expect(f.document.documentElement.dataset.appPalette).toBe('violet');
    update({}, { mode: 'dark', palette: 'warm', secret: 'not-forwarded' }); let current; f.bridge.onAppearance(value => { current = value; });
    expect(JSON.parse(JSON.stringify(current))).toEqual({ mode: 'dark', palette: 'warm' }); expect(f.document.documentElement.style.colorScheme).toBe('dark');
  });
});
