const { contextBridge, ipcRenderer } = require('electron');
const argument = process.argv.find(value => value.startsWith('--bead-market-window='));
const id = argument?.slice('--bead-market-window='.length);
if (id && /^[a-f0-9-]{36}$/.test(id)) contextBridge.exposeInMainWorld('marketBrowser', {
  action: action => ipcRenderer.invoke(`bead-market-window:${id}`, action),
  onState: listener => { const handler = (_event, value) => listener(value); ipcRenderer.on(`bead-market-window-state:${id}`, handler); return () => ipcRenderer.removeListener(`bead-market-window-state:${id}`, handler); },
});
