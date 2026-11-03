import { useState } from 'react';
import { EyeOff, LoaderCircle, Trash2, Undo2 } from 'lucide-react';
import type { WorkflowRun, WorkflowRunner } from '../configuration-types';
import { canOrganizeRun } from '../lib/task-visibility';
export function TaskRunActions({ run, runner, notify }: { run: WorkflowRun; runner: WorkflowRunner; notify: (message: string, type?: 'success' | 'info' | 'error') => void }) {
  const [busy, setBusy] = useState(false);
  if (!canOrganizeRun(run)) return null;
  const manage = async (action: 'hide' | 'trash' | 'restore') => {
    if (!runner.manageRun) { notify('请使用支持任务整理的新版桌面应用。', 'info'); return; }
    setBusy(true);
    try { await runner.manageRun(run.id, action); notify(action === 'restore' ? '任务记录已恢复，费用和产物保持不变。' : action === 'hide' ? '任务已隐藏，可在任务中心的“已隐藏”中恢复。' : '任务已移入回收站，费用与产物保留，可恢复。'); }
    catch (error) { notify(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '任务记录暂未更新。', 'error'); }
    finally { setBusy(false); }
  };
  return <span className="task-run-actions">{busy && <LoaderCircle size={14} className="spin" />}{run.hiddenAt || run.trashedAt ? <button className="btn btn-ghost" disabled={busy} aria-label={`恢复任务 ${run.id}`} onClick={() => { void manage('restore'); }}><Undo2 size={14} />恢复显示</button> : <button className="btn btn-ghost" disabled={busy} aria-label={`隐藏任务 ${run.id}`} onClick={() => { void manage('hide'); }}><EyeOff size={14} />隐藏任务</button>}{!run.trashedAt && <button className="btn btn-ghost" disabled={busy} aria-label={`删除任务 ${run.id}`} onClick={() => { void manage('trash'); }}><Trash2 size={14} />移入回收站</button>}</span>;
}
