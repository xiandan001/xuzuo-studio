import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { applicationMenu, mainWindowPlatformOptions, animationToolOptions } = createRequire(import.meta.url)('../../electron/desktop-platform.cjs');

describe('macOS desktop integration', () => {
  it('routes Command-Q through the saving coordinator and Command-W through the focused window', () => {
    const requestExit = vi.fn(), close = vi.fn(), send = vi.fn();
    const window = { close, webContents: { send } };
    const menu = applicationMenu({ app: { name: '序作工作台' }, platform: 'darwin', getWindow: () => window, requestExit });
    menu[0].submenu.at(-1).click(); expect(requestExit).toHaveBeenCalledOnce();
    menu.at(-1).submenu.find(item => item.accelerator === 'Command+W').click(); expect(close).toHaveBeenCalledOnce();
    menu[1].submenu[0].click(); expect(send).toHaveBeenCalledWith('window:edit-command', 'undo');
  });
  it('preserves native text undo in child file dialogs', () => {
    const undo = vi.fn(), send = vi.fn();
    const window = { getParentWindow: () => ({}), webContents: { undo, send } };
    const menu = applicationMenu({ app: {}, platform: 'darwin', getWindow: () => window });
    menu[1].submenu[0].click(); expect(undo).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
  });
  it('edits the focused embedded browser rather than its parent toolbar', () => {
    const undo = vi.fn(), parentUndo = vi.fn(), main = { send: vi.fn() };
    const menu = applicationMenu({ app: {}, platform: 'darwin', getWindow: () => ({ webContents: { undo: parentUndo } }), getMainWebContents: () => main, getFocusedWebContents: () => ({ undo }) });
    menu[1].submenu[0].click(); expect(undo).toHaveBeenCalledOnce(); expect(parentUndo).not.toHaveBeenCalled(); expect(main.send).not.toHaveBeenCalled();
  });
  it('uses the native menu window when global focused contents is temporarily absent', () => {
    const main = { send: vi.fn() }, other = { webContents: { undo: vi.fn(), send: vi.fn() } }, window = { webContents: main };
    const menu = applicationMenu({ app: {}, platform: 'darwin', getWindow: () => other, getMainWebContents: () => main, getFocusedWebContents: () => null });
    menu[1].submenu[0].click(undefined, window); menu[1].submenu[1].click(undefined, window);
    expect(main.send.mock.calls).toEqual([['window:edit-command', 'undo'], ['window:edit-command', 'redo']]);
    expect(other.webContents.undo).not.toHaveBeenCalled(); expect(other.webContents.send).not.toHaveBeenCalled();
  });
  it('preserves an embedded focused contents owned by the actual menu window', () => {
    const main = { send: vi.fn() }, embedded = { undo: vi.fn() }, window = { webContents: main };
    const menu = applicationMenu({ app: {}, platform: 'darwin', getWindow: () => window, getMainWebContents: () => main, getFocusedWebContents: () => embedded, getWindowForWebContents: () => window });
    menu[1].submenu[0].click(undefined, window);
    expect(embedded.undo).toHaveBeenCalledOnce(); expect(main.send).not.toHaveBeenCalled();
  });
  it('does not edit a different focused window when the native menu belongs to a dialog', () => {
    const main = { send: vi.fn(), undo: vi.fn() }, mainWindow = { webContents: main }, undo = vi.fn(), popup = { getParentWindow: () => mainWindow, webContents: { undo, send: vi.fn() } };
    const menu = applicationMenu({ app: {}, platform: 'darwin', getWindow: () => mainWindow, getMainWebContents: () => main, getFocusedWebContents: () => main, getWindowForWebContents: () => mainWindow });
    menu[1].submenu[0].click(undefined, popup);
    expect(undo).toHaveBeenCalledOnce(); expect(main.send).not.toHaveBeenCalled(); expect(main.undo).not.toHaveBeenCalled(); expect(popup.webContents.send).not.toHaveBeenCalled();
  });
  it('falls back through a live focused window and then the validated main contents', () => {
    const main = { send: vi.fn() }, window = { webContents: main };
    const options = { app: {}, platform: 'darwin', getMainWebContents: () => main, getFocusedWebContents: () => null };
    applicationMenu({ ...options, getWindow: () => window })[1].submenu[0].click();
    applicationMenu({ ...options, getWindow: () => null })[1].submenu[1].click();
    expect(main.send.mock.calls).toEqual([['window:edit-command', 'undo'], ['window:edit-command', 'redo']]);
  });
  it('never falls back from a destroyed menu window or targets destroyed contents', () => {
    const main = { send: vi.fn() }, window = { webContents: main }, options = { app: {}, platform: 'darwin', getWindow: () => window, getMainWebContents: () => main, getFocusedWebContents: () => null };
    applicationMenu(options)[1].submenu[0].click(undefined, { isDestroyed: () => true });
    applicationMenu({ ...options, getWindow: () => null, getMainWebContents: () => ({ ...main, isDestroyed: () => true }) })[1].submenu[0].click();
    expect(main.send).not.toHaveBeenCalled();
  });
  it('retains Windows frameless controls and chooses platform animation binaries', () => {
    expect(applicationMenu({ platform: 'win32' })).toBeNull();
    expect(mainWindowPlatformOptions('win32')).toEqual({ frame: false });
    expect(mainWindowPlatformOptions('darwin').titleBarStyle).toBe('hidden');
    expect(animationToolOptions({ packaged: true, resourcesPath: '/App/Resources', platform: 'darwin' }).executablePath).toBe('/App/Resources/animation-tool/xuzuo-animation');
    expect(animationToolOptions({ packaged: true, resourcesPath: '/App/Resources', platform: 'linux' }).executablePath).toBe('/App/Resources/animation-tool/xuzuo-animation');
    expect(animationToolOptions({ packaged: true, resourcesPath: 'C:\\App\\Resources', platform: 'win32' }).executablePath).toBe('C:\\App\\Resources\\animation-tool\\xuzuo-animation.exe');
    expect(animationToolOptions({ packaged: false, platform: 'darwin', env: {} }).developmentPython).toBe('python3');
    expect(animationToolOptions({ packaged: false, platform: 'darwin', env: { XUZUO_ANIMATION_PYTHON: '/test/python' } }).developmentPython).toBe('/test/python');
  });
});
