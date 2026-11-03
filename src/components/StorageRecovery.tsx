import { useState } from 'react';
import { AlertCircle, Download, LoaderCircle, RotateCcw, ShieldCheck, Square, X } from 'lucide-react';
import type { StorageIssue } from '../configuration-types';
import { StudioDrawer } from './StudioDrawer';
import './storage-recovery.css';

interface RecoveryProps {
  title: string; issue: StorageIssue; exportLabel?: string;
  onExport: () => boolean | Promise<boolean>; onReload: () => boolean; onReset: () => boolean | Promise<boolean>;
  onStopTasks?: () => Promise<string>;
}
function RecoveryActions({ title, issue, exportLabel = '导出原始数据', onExport, onReload, onReset, onStopTasks }: RecoveryProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function exportOriginal() {
    if (busy) return;
    setBusy(true); setFeedback('');
    try { setFeedback(await onExport() ? (window.desktop?.fileDialogs ? '本地数据文件已保存。' : '已请求浏览器下载，请确认文件已保存。') : '尚未保存本地文件，原始数据仍保留。'); }
    catch { setFeedback('导出未完成，原始数据仍保留，请重新选择位置保存。'); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (busy) return;
    setBusy(true); setFeedback('');
    try { const restored = await onReset(); if (!restored) setFeedback('尚未重置。请查看数据保护提示，先保留本地副本。'); }
    catch { setFeedback('重置未完成，原始内容仍保留。'); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!onStopTasks || busy) return;
    setBusy(true);
    try { setFeedback(await onStopTasks()); } catch { setFeedback('停止状态尚未确认，请保留窗口并稍后重试。'); } finally { setBusy(false); }
  }
  return <section className="storage-recovery-controls" aria-label={`${title}恢复操作`}><p>{issue.message}</p><div className="storage-recovery-facts"><ShieldCheck size={19} /><span>没有自动重置数据。项目文件和加密 Key 未被删除；此处导出的是应用索引或配置，不是完整项目文件备份。</span></div><div className="storage-recovery-actions"><button className="btn btn-primary" disabled={busy || !issue.canExportOriginal} onClick={() => { void exportOriginal(); }}><Download size={16} />{exportLabel}</button><button className="btn btn-secondary" disabled={busy} onClick={() => { if (!onReload()) setFeedback('数据仍未能读取，原始内容仍保留。'); }}><RotateCcw size={16} />重新读取</button></div>{onStopTasks && <button className="btn btn-ghost" disabled={busy} onClick={() => { void stop(); }}><Square size={14} />停止正在执行的任务</button>}<details className="storage-recovery-reset" open={confirmReset}><summary onClick={event => { event.preventDefault(); setConfirmReset(value => !value); }}>备份后重置</summary>{confirmReset && <><p>仅在希望重新建立空索引或配置时使用。系统会先保留原始副本；备份失败会停止，不会清空原数据。</p><button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmReset(false)}>取消重置</button><button className="btn btn-danger" disabled={busy} onClick={() => { void reset(); }}>{busy ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}保留副本并重置</button></>}</details>{feedback && <p className="storage-recovery-feedback" role="status">{feedback}</p>}</section>;
}
export function StorageRecoveryPage(props: RecoveryProps) {
  return <div className="storage-recovery-page"><div className="storage-recovery-titlebar"><span>序作工作台 · 数据保护</span>{typeof window !== 'undefined' && window.desktop && <button aria-label="关闭应用" onClick={() => window.desktop?.close?.()}><X size={18} /></button>}</div><main><span className="storage-recovery-symbol"><AlertCircle size={30} /></span><h1>{props.title}需要恢复</h1><p>当前已停止自动写入，先保留数据，再继续创作。</p><RecoveryActions {...props} /></main></div>;
}
export function StorageRecoveryBanner(props: RecoveryProps) {
  const [open, setOpen] = useState(false);
  return <><section className="storage-recovery-banner" role="alert" aria-label={`${props.title}数据保护`}><AlertCircle size={19} /><div><strong>{props.title}尚未正常载入或保存</strong><span>{props.issue.message}</span></div><button className="btn btn-secondary" onClick={() => setOpen(true)}>处理数据问题</button></section>{open && <StudioDrawer title={`${props.title}恢复`} description="原始内容保留在本机" onClose={() => setOpen(false)}><RecoveryActions {...props} /></StudioDrawer>}</>;
}
