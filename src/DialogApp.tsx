import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, X } from 'lucide-react';
import type { CustomDialogRequest, DialogAppearance, FileDialogSeed } from './dialog-types';
import { FileDialog } from './components/FileDialog';
import { MessageDialog } from './components/MessageDialog';
import { dialogError } from './lib/dialog-paths';
import './dialog-app.css';

function applyDialogAppearance(appearance: DialogAppearance) {
  document.documentElement.dataset.appTheme = appearance.mode;
  document.documentElement.dataset.appPalette = appearance.palette;
  document.documentElement.style.colorScheme = appearance.mode;
}
export default function DialogApp() {
  const [config, setConfig] = useState<CustomDialogRequest>(), [error, setError] = useState('');
  const bridge = window.studioDialog;
  useEffect(() => {
    let active = true;
    if (!bridge) { setError('本地文件窗口需要 Windows 桌面应用。当前浏览器没有读取或创建本地目录。'); return; }
    const remove = bridge.onAppearance?.(applyDialogAppearance);
    void bridge.request().then(value => { if (active) { applyDialogAppearance(value.appearance); setConfig(value); } }, cause => { if (active) setError(dialogError(cause)); });
    return () => { active = false; remove?.(); };
  }, [bridge]);
  function cancel() { if (bridge) void bridge.cancel().catch(() => window.close()); else window.close(); }
  return <div role={config?.kind === 'message' ? undefined : 'dialog'} aria-modal={config?.kind === 'message' ? undefined : true} aria-label={config?.title || '序作文件窗口'} className={`studio-dialog-app ${config?.kind === 'message' ? 'is-message' : 'is-explorer'}`}><header className="sd-titlebar"><span><FolderOpen size={17} /><b>{config?.title || '序作工作台'}</b></span><button className="sd-icon-button sd-window-close" aria-label="关闭对话框" title="关闭" onClick={cancel}><X size={18} /></button></header>{!config || !bridge ? <main className="sd-startup">{error ? <><FolderOpen size={35} /><h1>文件窗口暂不可用</h1><p role="alert">{error}</p><button className="sd-button sd-button-secondary" onClick={cancel}>关闭窗口</button></> : <><LoaderCircle size={30} className="spin" /><p>正在准备窗口…</p></>}</main> : config.kind === 'message' ? <MessageDialog config={config} bridge={bridge} /> : config.seed ? <FileDialog config={config as CustomDialogRequest & { seed: FileDialogSeed }} bridge={bridge} onCancel={cancel} /> : <main className="sd-startup"><p role="alert">未取得文件浏览信息，请关闭后重新打开。</p><button className="sd-button sd-button-secondary" onClick={cancel}>关闭窗口</button></main>}</div>;
}
