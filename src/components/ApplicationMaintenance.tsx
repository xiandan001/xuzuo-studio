import { useEffect, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';

export function ApplicationMaintenance() {
  const [status, setStatus] = useState<{ available: boolean; reason?: string }>(), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  useEffect(() => {
    let active = true; const bridge = window.desktop?.maintenance;
    if (bridge) void bridge.status().then(value => { if (active) setStatus(value); }, () => { if (active) setStatus({ available: false, reason: '安装状态暂时无法核对，请使用完整安装包管理。' }); });
    else setStatus({ available: false, reason: '请在安装版桌面应用内管理卸载。' });
    return () => { active = false; };
  }, []);
  async function open() {
    if (busy || !status?.available) return;
    setBusy(true); setFeedback('');
    try { await window.desktop!.maintenance!.openUninstall(); setFeedback('自定义卸载窗口已打开，确认卸载前本应用会保留当前状态。'); }
    catch (error) { setFeedback(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '卸载窗口未能打开，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <section className="panel op-settings-panel"><header><h2>应用安装与卸载</h2><p>卸载通过自定义维护窗口完成，保留工作区、作品文件、历史费用和本地加密密钥。</p></header>{status?.reason && <p>{status.reason}</p>}<button type="button" className="btn btn-secondary" disabled={!status?.available || busy} onClick={() => { void open(); }}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}打开自定义卸载窗口</button>{feedback && <p role="status">{feedback}</p>}</section>;
}
