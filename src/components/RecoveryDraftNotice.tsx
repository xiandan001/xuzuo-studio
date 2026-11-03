import { useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import './editor-protection.css';

export function RecoveryDraftNotice({ error, onRetry, onDownload }: { error: string; onRetry: () => boolean; onDownload: () => boolean | Promise<boolean> }) {
  const [saving, setSaving] = useState(false), [feedback, setFeedback] = useState('');
  async function download() {
    if (saving) return;
    setSaving(true); setFeedback('');
    try { setFeedback(await onDownload() ? (window.desktop?.fileDialogs ? '当前恢复稿已保存。' : '已请求浏览器下载，请确认恢复稿已保存。') : '尚未保存恢复稿，当前编辑内容仍保留。'); }
    catch { setFeedback('恢复稿未能保存，请重新选择位置。'); }
    finally { setSaving(false); }
  }
  if (!error) return null;
  return <section className="editor-recovery-notice" role="alert"><p>{error}</p><div><button className="btn btn-secondary" disabled={saving} onClick={onRetry}><RotateCcw size={15} />重试保存恢复稿</button><button className="btn btn-secondary" disabled={saving} onClick={() => { void download(); }}><Download size={15} />{saving ? '正在另存…' : '下载当前恢复稿'}</button></div>{feedback && <p role="status">{feedback}</p>}</section>;
}
