const { contextBridge, ipcRenderer } = require('electron');
const id = process.argv.find(value => value.startsWith('--studio-dialog-id='))?.slice('--studio-dialog-id='.length);
const call = (name, input = {}) => ipcRenderer.invoke(`studio-dialog:${name}`, { ...input, id });
const listeners = new Set();
const argument = prefix => process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
const validAppearance = value => value && ['light', 'dark'].includes(value.mode) && ['violet', 'blue', 'warm'].includes(value.palette);
let appearance = { mode: argument('--studio-dialog-mode='), palette: argument('--studio-dialog-palette=') };
if (!validAppearance(appearance)) appearance = { mode: 'light', palette: 'violet' };
function applyAppearance() {
  const root = document.documentElement;
  if (!root) return false;
  root.dataset.appTheme = appearance.mode; root.dataset.appPalette = appearance.palette; root.style.colorScheme = appearance.mode;
  return true;
}
if (!applyAppearance()) {
  const observer = new MutationObserver(() => { if (applyAppearance()) observer.disconnect(); });
  observer.observe(document, { childList: true });
}
ipcRenderer.on('studio-dialog:appearance', (_event, value) => {
  if (!validAppearance(value)) return;
  appearance = { mode: value.mode, palette: value.palette }; applyAppearance();
  for (const listener of listeners) { try { listener({ ...appearance }); } catch { /* A failed subscriber does not grant additional dialog capabilities. */ } }
});
contextBridge.exposeInMainWorld('studioDialog', {
  request: () => call('request'), list: input => call('list', input), refreshLocations: input => call('locations', { force: input?.force === true }), createFolder: input => call('create-folder', input), accept: input => call('accept', input), cancel: () => call('cancel'), respondMessage: index => call('respond-message', { index }),
  onAppearance: listener => { listeners.add(listener); try { listener({ ...appearance }); } catch { /* The native dialog remains operable if a UI subscriber fails. */ } return () => listeners.delete(listener); },
});
if (process.argv.includes('--studio-dialog-fallback')) {
  const render = async () => {
    const config = await call('request'), appearance = config.appearance;
    document.documentElement.style.colorScheme = appearance.mode;
    document.body.style.backgroundColor = appearance.mode === 'dark' ? '#1b1c1f' : '#ffffff';
    document.body.style.color = appearance.mode === 'dark' ? '#f0f1f3' : '#202124';
    const heading = document.createElement('h1'); heading.textContent = config.options.message || config.title;
    const detail = document.createElement('p'); detail.textContent = config.options.detail || '';
    const footer = document.createElement('footer');
    config.options.buttons.forEach((label, index) => { const button = document.createElement('button'); button.textContent = label; button.type = 'button'; button.addEventListener('click', () => { for (const other of footer.querySelectorAll('button')) other.disabled = true; void call('respond-message', { index }); }); footer.append(button); });
    document.body.append(heading, detail, footer); footer.querySelectorAll('button')[config.options.defaultId]?.focus();
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); void call('respond-message', { index: config.options.cancelId }); } });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void render(); }, { once: true }); else void render();
}
