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
  it('retains Windows frameless controls and chooses platform animation binaries', () => {
    expect(applicationMenu({ platform: 'win32' })).toBeNull();
    expect(mainWindowPlatformOptions('win32')).toEqual({ frame: false });
    expect(mainWindowPlatformOptions('darwin').titleBarStyle).toBe('hidden');
    expect(animationToolOptions({ packaged: true, resourcesPath: '/App/Resources', platform: 'darwin' }).executablePath).toBe('/App/Resources/animation-tool/xuzuo-animation');
    expect(animationToolOptions({ packaged: false, platform: 'darwin', env: {} }).developmentPython).toBe('python3');
    expect(animationToolOptions({ packaged: false, platform: 'darwin', env: { XUZUO_ANIMATION_PYTHON: '/test/python' } }).developmentPython).toBe('/test/python');
  });
});
