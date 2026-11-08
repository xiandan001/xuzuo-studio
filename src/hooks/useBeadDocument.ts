import { useCallback, useEffect, useRef, useState } from 'react';
import type { BeadBridge, BeadDocument } from '../bead-types';
import { beadDocumentIssue } from '../lib/bead-pattern';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from '../lib/edit-history';
import { registerEditorSession } from '../lib/editor-session-guard';

interface Options { beforeSave?: () => void; pendingStroke?: () => boolean; }
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;

export function useBeadDocument(projectId: string, bridge: BeadBridge | undefined, options: Options = {}) {
  const [document, setDocument] = useState<BeadDocument>(), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const [historyTick, setHistoryTick] = useState(0);
  const current = useRef<BeadDocument | undefined>(undefined), revision = useRef<number | undefined>(undefined), epoch = useRef(0), dirtyRef = useRef(false), errorRef = useRef('');
  const recoveredEpoch = useRef<number | undefined>(undefined), [, recoveryChanged] = useState(0);
  const alive = useRef(true), saveTask = useRef<Promise<boolean> | undefined>(undefined), reading = useRef(0), history = useRef(emptyEditHistory<BeadDocument>()), optionsRef = useRef(options);
  optionsRef.current = options; errorRef.current = error;
  const markError = useCallback((value: string) => { errorRef.current = value; if (alive.current) setError(value); }, []);
  const checkNative = useCallback((value: BeadDocument) => {
    const issue = beadDocumentIssue(value);
    if (issue || value.projectId !== projectId) throw Error(issue || '工程不属于当前项目，原内容保留。');
  }, [projectId]);
  const accept = useCallback((value: BeadDocument, keepHistory = true) => {
    checkNative(value);
    if (keepHistory && current.current) history.current = recordEdit(history.current, current.current, value);
    else if (!keepHistory) history.current = emptyEditHistory<BeadDocument>();
    current.current = value; revision.current = value.revision; epoch.current++; dirtyRef.current = false; errorRef.current = '';
    if (alive.current) { setDocument(value); setDirty(false); setError(''); setHistoryTick(tick => tick + 1); }
  }, [checkNative]);
  const load = useCallback(async () => {
    if (!bridge) { markError('请在最新版桌面应用中打开拼豆工作台。'); setLoading(false); return; }
    optionsRef.current.beforeSave?.();
    if ((dirtyRef.current || optionsRef.current.pendingStroke?.()) && recoveredEpoch.current !== epoch.current) { markError('当前有未保存修改，请先保存，或导出当前恢复 JSON 后再读取。'); return; }
    const request = ++reading.current, startedEpoch = epoch.current; setLoading(true);
    try {
      const value = await bridge.read({ projectId });
      if (!alive.current || request !== reading.current) return;
      if (epoch.current !== startedEpoch) { markError('你已继续编辑，未用旧读取结果覆盖当前图纸。'); return; }
      if (!value && current.current) { markError('项目中的工程文件暂不可用，当前内存图纸仍保留，可导出恢复 JSON。'); return; }
      if (value) accept(value, false); else { current.current = undefined; revision.current = undefined; setDocument(undefined); }
      markError('');
    } catch (cause) { if (alive.current && request === reading.current) markError(message(cause, '工程读取未完成，原文件保留。')); }
    finally { if (alive.current && request === reading.current) setLoading(false); }
  }, [bridge, projectId, accept, markError]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; reading.current++; }; }, [load]);

  const change = useCallback((next: BeadDocument, group?: string) => {
    const previous = current.current; if (!previous) return;
    const value = { ...next, id: previous.id, projectId, revision: revision.current ?? previous.revision };
    const issue = beadDocumentIssue(value); if (issue) { markError(issue); return; }
    const updated = recordEdit(history.current, previous, value, group); if (updated === history.current) return;
    history.current = updated; current.current = value; epoch.current++; dirtyRef.current = true;
    setDocument(value); setDirty(true); setHistoryTick(tick => tick + 1);
  }, [projectId, markError]);
  const move = useCallback((direction: 'undo' | 'redo') => {
    const previous = current.current; if (!previous) return;
    const result = direction === 'undo' ? undoEdit(history.current, previous) : redoEdit(history.current, previous);
    if (!result.value) return;
    history.current = result.history; const value = { ...result.value, id: previous.id, projectId: previous.projectId, revision: revision.current ?? previous.revision };
    current.current = value; epoch.current++; dirtyRef.current = true; setDocument(value); setDirty(true); setHistoryTick(tick => tick + 1);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    optionsRef.current.beforeSave?.();
    if (saveTask.current) return saveTask.current;
    if (!dirtyRef.current || !current.current) return !errorRef.current;
    if (!bridge || revision.current === undefined) { markError('当前无法保存工程，请保持工作台打开。'); return false; }
    const save = async () => {
      if (alive.current) setSaving(true);
      try {
        while (dirtyRef.current && current.current) {
          const sentEpoch = epoch.current, expectedRevision = revision.current!;
          const snapshot = { ...current.current, revision: expectedRevision };
          const value = await bridge.save({ projectId, document: snapshot, expectedRevision }); checkNative(value);
          if (value.id !== snapshot.id || value.revision <= expectedRevision) throw Error('保存回执版本不一致，当前编辑内容保留。');
          revision.current = value.revision;
          if (epoch.current === sentEpoch) { current.current = value; dirtyRef.current = false; if (alive.current) { setDocument(value); setDirty(false); } }
          else if (current.current) { current.current = { ...current.current, revision: value.revision }; if (alive.current) setDocument(current.current); }
        }
        markError(''); return true;
      } catch (cause) { markError(message(cause, '工程尚未保存，请保留当前工作台并重试。')); return false; }
      finally { if (alive.current) setSaving(false); }
    };
    const task = save(); saveTask.current = task;
    void task.then(() => { if (saveTask.current === task) saveTask.current = undefined; }, () => { if (saveTask.current === task) saveTask.current = undefined; });
    return task;
  }, [bridge, projectId, checkNative, markError]);
  useEffect(() => {
    if (!dirty || error || loading) return;
    const timer = setTimeout(() => { void flush(); }, 700); return () => clearTimeout(timer);
  }, [document, dirty, error, loading, flush]);
  const recover = useCallback(async () => {
    optionsRef.current.beforeSave?.(); const value = current.current;
    if (!value) return false;
    if (!bridge || typeof bridge.exportRecovery !== 'function') { markError('当前后台不支持内存恢复导出，请保持工作台打开并更新应用。'); return false; }
    const savedEpoch = epoch.current;
    try { const result = await bridge.exportRecovery({ projectId, document: structuredClone(value) }); if (result.saved) { recoveredEpoch.current = savedEpoch; if (alive.current) recoveryChanged(tick => tick + 1); } return result.saved; }
    catch (cause) { markError(message(cause, '恢复工程尚未导出，请选择一个可用的本地位置。')); return false; }
  }, [bridge, projectId, markError]);
  useEffect(() => registerEditorSession({ id: `beads:${projectId}`, projectId, label: '拼豆图纸', getState: () => ({ dirty: dirtyRef.current || Boolean(optionsRef.current.pendingStroke?.()), pending: Boolean(saveTask.current) || dirtyRef.current || Boolean(optionsRef.current.pendingStroke?.()), persistenceError: errorRef.current || undefined }), save: flush, exportRecovery: recover }), [projectId, flush, recover]);
  useEffect(() => () => { if (dirtyRef.current) void flush(); }, [flush]);
  void historyTick;
  return { document, current, revision, epoch, loading, saving, dirty, error, recoveryCurrent: recoveredEpoch.current === epoch.current, hasCurrentRecovery: () => recoveredEpoch.current === epoch.current, markError, accept, change, flush, recover, reload: load, undo: () => move('undo'), redo: () => move('redo'), canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 };
}
