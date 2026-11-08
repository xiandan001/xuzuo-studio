import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommerceImageDocument, CommerceImageRead, CommerceImageScope, CommerceImagesBridge } from '../commerce-image-types';
import { commerceDocumentIssue, commerceInitialDocument } from '../lib/commerce-image';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from '../lib/edit-history';
import { registerEditorSession } from '../lib/editor-session-guard';

export function useCommerceDocument(projectId: string, sourceArtifactId: string | undefined, bridge: CommerceImagesBridge | undefined, title: string) {
  const [document, setDocument] = useState<CommerceImageDocument>(), [readResult, setReadResult] = useState<CommerceImageRead>(), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [, renderHistory] = useState(0), [reload, setReload] = useState(0);
  const current = useRef<CommerceImageDocument | undefined>(undefined), scope = useRef<CommerceImageScope | undefined>(undefined), revision = useRef(0), changed = useRef(false), epoch = useRef(0), alive = useRef(true), issue = useRef(''), history = useRef(emptyEditHistory<CommerceImageDocument>()), savingTask = useRef<Promise<boolean> | undefined>(undefined);
  const reading = useRef(0), titleRef = useRef(title), snapshotMode = useRef(false), boundSource = useRef(sourceArtifactId); titleRef.current = title;
  const markError = useCallback((text: string) => { issue.current = text; if (alive.current) setError(text); }, []);
  const accept = useCallback((value: CommerceImageDocument, keepHistory = false) => { if (keepHistory && current.current) history.current = recordEdit(history.current, current.current, value); current.current = value; revision.current = value.revision; changed.current = false; epoch.current++; setDocument(value); setDirty(false); renderHistory(count => count + 1); }, []);
  useEffect(() => {
    alive.current = true; const token = ++epoch.current, readToken = ++reading.current; current.current = undefined; scope.current = undefined; changed.current = false; setDocument(undefined); setReadResult(undefined); setDirty(false); history.current = emptyEditHistory(); markError('');
    if (!sourceArtifactId || !bridge) { setLoading(false); return () => { alive.current = false; }; }
    setLoading(true);
    if (boundSource.current !== sourceArtifactId) { snapshotMode.current = false; boundSource.current = sourceArtifactId; }
    void bridge.read({ projectId, sourceArtifactId, ...(snapshotMode.current ? { fromSnapshot: true } : {}) }).then(result => {
      if (!alive.current || epoch.current !== token) return;
      const value = commerceInitialDocument(result, titleRef.current); if (result.projectId !== projectId || value.projectId !== projectId || value.sourceArtifactId !== result.sourceArtifactId) throw Error('读取的图层工程不属于当前项目。');
      scope.current = { projectId, sourceArtifactId: result.sourceArtifactId, documentId: result.documentId }; setReadResult(result); accept(value);
    }).catch(cause => { if (alive.current && epoch.current === token) markError(cause instanceof Error ? cause.message : '图层工程无法读取。'); }).finally(() => { if (alive.current && reading.current === readToken) setLoading(false); });
    return () => { alive.current = false; epoch.current++; reading.current++; };
  }, [projectId, sourceArtifactId, bridge, accept, markError, reload]);
  const change = useCallback((value: CommerceImageDocument, group?: string) => {
    const previous = current.current; if (!previous) return;
    const updated = { ...value, id: previous.id, projectId: previous.projectId, sourceArtifactId: previous.sourceArtifactId, sourceSha256: previous.sourceSha256, revision: revision.current };
    const nextHistory = recordEdit(history.current, previous, updated, group); if (history.current === nextHistory) return;
    history.current = nextHistory; current.current = updated; changed.current = true; epoch.current++; setDocument(updated); setDirty(true); markError(commerceDocumentIssue(updated)); renderHistory(value => value + 1);
  }, [markError]);
  const travel = useCallback((direction: 'undo' | 'redo') => {
    const previous = current.current; if (!previous) return;
    const result = direction === 'undo' ? undoEdit(history.current, previous) : redoEdit(history.current, previous); if (!result.value) return;
    history.current = result.history; const value = { ...result.value, revision: revision.current }; current.current = value; changed.current = true; epoch.current++; setDocument(value); setDirty(true); markError(commerceDocumentIssue(value)); renderHistory(count => count + 1);
  }, [markError]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (savingTask.current) return savingTask.current;
    if (!current.current || !scope.current || !bridge) return false;
    if (commerceDocumentIssue(current.current)) { markError(commerceDocumentIssue(current.current)); return false; }
    if (!changed.current && revision.current > 0) return !issue.current;
    const save = async () => {
      if (alive.current) setSaving(true);
      try {
        do {
          const value = current.current!, activeScope = scope.current!, token = epoch.current, expectedRevision = revision.current;
          const saved = await bridge.save({ ...activeScope, expectedRevision, document: { ...value, revision: expectedRevision } });
          if (!alive.current || !scope.current || scope.current.sourceArtifactId !== activeScope.sourceArtifactId || scope.current.documentId !== activeScope.documentId) return false;
          if (saved.id !== value.id || saved.projectId !== projectId || saved.revision <= expectedRevision) throw Error('图层保存回执无效，当前编辑保留。');
          revision.current = saved.revision;
          if (epoch.current === token) { current.current = saved; changed.current = false; setDocument(saved); setDirty(false); }
          else if (current.current) { current.current = { ...current.current, revision: saved.revision }; setDocument(current.current); }
        } while (changed.current);
        markError(''); return true;
      } catch (cause) { markError(cause instanceof Error ? cause.message : '图层尚未保存，当前内容保留。'); return false; }
      finally { if (alive.current) setSaving(false); }
    };
    const task = save(); savingTask.current = task; void task.finally(() => { if (savingTask.current === task) savingTask.current = undefined; }).catch(() => undefined); return task;
  }, [bridge, projectId, markError]);
  useEffect(() => { if (!dirty || error || loading) return; const timer = setTimeout(() => { void flush(); }, 700); return () => clearTimeout(timer); }, [document, dirty, error, loading, flush]);
  const recover = useCallback(async () => { if (!current.current || !bridge?.exportRecovery) return false; try { return (await bridge.exportRecovery({ projectId, document: current.current })).saved; } catch (cause) { markError(cause instanceof Error ? cause.message : '图层恢复文件尚未保存。'); return false; } }, [bridge, projectId, markError]);
  useEffect(() => registerEditorSession({ id: `commerce:${projectId}`, projectId, label: '商品图层', getState: () => ({ dirty: changed.current, pending: !!savingTask.current || changed.current, persistenceError: issue.current || undefined }), save: flush, exportRecovery: recover }), [projectId, flush, recover]);
  return { document, readResult, current, scope, revision, loading, saving, dirty, error, markError, change, flush, accept, recover, reload: async (fromSnapshot = false) => { if (changed.current && !await recover()) return false; snapshotMode.current = fromSnapshot; setReload(value => value + 1); return true; }, undo: () => travel('undo'), redo: () => travel('redo'), canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 };
}
