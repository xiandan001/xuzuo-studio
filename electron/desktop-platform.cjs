const path = require('node:path');

function mainWindowPlatformOptions(platform = process.platform) {
  return platform === 'darwin'
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 15 } }
    : { frame: false };
}

function applicationMenu({ app, getWindow, getFocusedWebContents = () => getWindow()?.webContents, getMainWebContents = () => getWindow()?.webContents, requestExit, platform = process.platform }) {
  if (platform !== 'darwin') return null;
  const edit = command => {
    const window = getWindow();
    const contents = getFocusedWebContents();
    if (!contents) return;
    if (contents !== getMainWebContents() || window?.getParentWindow?.()) contents[command]();
    else contents.send('window:edit-command', command);
  };
  return [
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { label: '退出序作工作台', accelerator: 'Command+Q', click: () => requestExit() },
    ] },
    { label: '编辑', submenu: [
      { label: '撤销', accelerator: 'Command+Z', click: () => edit('undo') },
      { label: '重做', accelerator: 'Command+Shift+Z', click: () => edit('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
    ] },
    { label: '显示', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [
      { role: 'minimize' }, { role: 'zoom' },
      { label: '关闭窗口', accelerator: 'Command+W', click: () => getWindow()?.close() },
      { type: 'separator' }, { role: 'front' },
    ] },
  ];
}

function animationToolOptions({ packaged, resourcesPath, platform = process.platform, env = process.env }) {
  return packaged
    ? { executablePath: path.join(resourcesPath, 'animation-tool', platform === 'win32' ? 'xuzuo-animation.exe' : 'xuzuo-animation') }
    : { developmentPython: env.XUZUO_ANIMATION_PYTHON || (platform === 'win32' ? 'python' : 'python3') };
}

module.exports = { mainWindowPlatformOptions, applicationMenu, animationToolOptions };
