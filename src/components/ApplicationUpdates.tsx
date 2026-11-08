import { useEffect, useRef, useState } from 'react';
import type { AppUpdateStatus } from '../update-types';
import { APP_VERSION } from '../lib/app-version';
import { isMacDesktop } from '../lib/platform';

const unavailable: AppUpdateStatus = { available: false, enabled: false, phase: 'unavailable', currentVersion: APP_VERSION, message: '请在正式安装版桌面应用中使用自动更新。' };
const phaseLabels: Record<AppUpdateStatus['phase'], string> = {
  unavailable: '当前运行方式不支持自动更新', disabled: '自动更新已关闭', idle: '等待下一次版本检查', checking: '正在检查新版本',
  downloading: '正在下载更新', ready: '更新已下载，退出应用后自动更新', error: '本次更新暂未完成',
};

export function ApplicationUpdates() {
  const mac = isMacDesktop();
  const [status, setStatus] = useState<AppUpdateStatus | undefined>(() => typeof window !== 'undefined' && window.desktop?.updates ? undefined : unavailable);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const active = useRef(false), revision = useRef(0);
  useEffect(() => {
    active.current = true;
    const bridge = window.desktop?.updates, initialRevision = revision.current;
    if (!bridge) { setStatus(unavailable); return () => { active.current = false; }; }
    const unsubscribe = bridge.onStatus(value => { if (active.current) { revision.current++; setStatus(value); } });
    void bridge.status().then(value => {
      if (active.current && revision.current === initialRevision) setStatus(value);
    }, () => {
      if (active.current && revision.current === initialRevision) setStatus({ ...unavailable, message: '更新设置暂时无法读取，请稍后重新打开设置。' });
    });
    return () => { active.current = false; unsubscribe(); };
  }, []);

  async function change(enabled: boolean) {
    const bridge = window.desktop?.updates;
    if (busy || !status?.available || !bridge) return;
    const requestRevision = revision.current;
    setBusy(true); setFeedback('');
    try {
      const saved = await bridge.setEnabled(enabled);
      if (active.current && revision.current === requestRevision) { revision.current++; setStatus(saved); }
    } catch (error) {
      if (active.current) setFeedback(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '自动更新设置尚未保存，请稍后重试。');
    } finally { if (active.current) setBusy(false); }
  }
  async function openDownloads() {
    setBusy(true); setFeedback('');
    try { await window.desktop?.updates?.openDownloads?.(); }
    catch { setFeedback('下载页面未能打开，请在浏览器访问 GitHub 上 xiandan001/xuzuo-studio 的 Releases 页面。'); }
    finally { if (active.current) setBusy(false); }
  }

  const progress = status?.phase === 'downloading' && Number.isFinite(status.progress) ? Math.max(0, Math.min(100, Math.round(status.progress!))) : undefined;
  return <section className="panel op-settings-panel" aria-label="应用更新">
    <header><h2>应用更新</h2><p>{mac ? 'macOS 通过 DMG 安装包手动更新，适用于全部工作区。' : '应用级设置，适用于全部工作区；勾选修改立即生效并自动保存。'}</p></header>
    {mac ? <div><p>从 GitHub Releases 下载适用于本机的 Apple Silicon 或 Intel 安装包。退出序作工作台后，在 Finder 中用新版替换“应用程序”中的应用，工作区、作品和本地资料会保留。</p>{window.desktop?.updates?.openDownloads && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void openDownloads(); }}>打开下载页面</button>}</div> : <div className="op-setting-switch-row"><div><label htmlFor="app-auto-update"><b>自动更新</b></label><p id="app-auto-update-description">默认开启。启动后检查新版本，此后每 2 小时检查；发现新版本后自动下载，正常退出应用后安装。取消勾选会停止自动检查、下载和退出安装。</p></div><input id="app-auto-update" type="checkbox" aria-describedby="app-auto-update-description" checked={status?.enabled ?? true} disabled={busy || !status?.available} onChange={event => { void change(event.currentTarget.checked); }} /></div>}
    <div className="op-readonly-row"><span>当前版本</span><b>v{status?.currentVersion || APP_VERSION}</b></div>
    {status?.version && <div className="op-readonly-row"><span>发现新版本</span><b>v{status.version}</b></div>}
    <p role={status?.phase === 'error' ? 'alert' : 'status'}>{busy ? '正在保存自动更新设置…' : status ? status.message || phaseLabels[status.phase] : '正在读取更新设置…'}{progress !== undefined && ` · ${progress}%`}</p>
    {progress !== undefined && <progress aria-label="更新下载进度" max={100} value={progress} />}
    {feedback && <p className="op-form-error" role="alert">{feedback}</p>}
  </section>;
}
