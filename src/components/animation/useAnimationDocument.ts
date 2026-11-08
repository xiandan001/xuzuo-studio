import { useEffect, useRef, useState } from 'react';
import type { AnimationBridge, AnimationDocument, AnimationMode, AnimationSnapshot } from '../../animation-types';
import type { StudioConfiguration } from '../../configuration-types';
import { useEditHistory } from '../../hooks/useEditHistory';
import { registerEditorSession } from '../../lib/editor-session-guard';
import { downloadFile } from '../../lib/files';
import { animationDraftKey, animationError, animationIssue, selectedAnimationModel } from './animation-ui';
import { checkedAnimationDocument } from '../../lib/animation-document';
import { useAnimationFrameHistory } from './useAnimationFrameHistory';

interface LocalDraft { document: AnimationDocument; baseRevision: number; }
export function useAnimationDocument(projectId: string, initialMode: AnimationMode, configuration: StudioConfiguration, bridge?: AnimationBridge, initialInput?: { referenceIds?: string[]; prompt?: string }) {
  const [snapshot, setSnapshot] = useState<AnimationSnapshot>(), [document, setDocument] = useState<AnimationDocument>(), [dirty, setDirty] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [issue, setIssue] = useState(''), [persistenceError, setPersistenceError] = useState(''), [incoming, setIncoming] = useState<AnimationSnapshot>(), [hasRecovery, setHasRecovery] = useState(false);
  const history = useEditHistory<AnimationDocument>(), alive = useRef(true), epoch = useRef(0), actionEpoch = useRef(0), operation = useRef(false), base = useRef(0), current = useRef<AnimationDocument | undefined>(undefined), saved = useRef<AnimationSnapshot | undefined>(undefined), retained = useRef(''), retainedBackedUp = useRef(false), changed = useRef(false), configurationRef = useRef(configuration), initialInputRef = useRef(initialInput); configurationRef.current = configuration; initialInputRef.current = initialInput;
  const frameHistory = useAnimationFrameHistory(projectId);
  const nativeEdit = useRef<{ baseline?: AnimationDocument; recorded: boolean }>({ recorded: false });
  const nativeGroup = useRef<{ id: string; baseline?: AnimationDocument; recorded: boolean; done: boolean } | undefined>(undefined);
  const remember = (key = animationDraftKey(projectId)) => { if (!current.current || !changed.current) return true; try { const text = JSON.stringify({ document: current.current, baseRevision: base.current }); if (text.length > 512000) throw Error('size'); if (retained.current) { localStorage.setItem(animationDraftKey(projectId) + ':recovery', retained.current); retainedBackedUp.current = true; } localStorage.setItem(key, text); return true; } catch { return false; } };
  function adopt(value: AnimationSnapshot, resetHistory = false) {
    if (!alive.current || value.document.projectId !== projectId || value.document.revision < (saved.current?.document.revision ?? 0)) return;
    const latestJob = saved.current?.job;
    if (latestJob && value.job?.id === latestJob.id && (Date.parse(value.job.updatedAt) < Date.parse(latestJob.updatedAt) || latestJob.status !== 'running' && value.job.status === 'running' && Date.parse(value.job.updatedAt) <= Date.parse(latestJob.updatedAt))) return;
    if (value.job?.status === 'running' && (nativeGroup.current?.id !== value.job.id || nativeGroup.current.done)) nativeGroup.current = { id: value.job.id, baseline: nativeEdit.current.baseline || current.current, recorded: false, done: false };
    const group = nativeGroup.current?.id === value.job?.id && !nativeGroup.current?.done ? nativeGroup.current : undefined;
    if (resetHistory) frameHistory.clear(); else if (!changed.current && current.current) frameHistory.record(current.current, value.document);
    const previous = group?.baseline || (operation.current ? nativeEdit.current.baseline : current.current), media = (document: AnimationDocument) => JSON.stringify(document.entries.map(entry => ({ id: entry.id, frames: entry.frames, output: entry.outputArtifactId, cover: entry.coverArtifactId })));
    if (!resetHistory && !changed.current && previous && !group?.recorded && (!operation.current || !nativeEdit.current.recorded) && media(previous) !== media(value.document)) { history.record(previous, value.document); if (operation.current) nativeEdit.current.recorded = true; if (group) group.recorded = true; }
    if (group && value.job?.status !== 'running') { group.done = true; group.baseline = undefined; }
    epoch.current++; saved.current = value; base.current = value.document.revision; current.current = value.document; changed.current = false;
    setSnapshot(value); setDocument(value.document); setDirty(false); setPersistenceError(''); setIncoming(undefined); try { if (!retained.current || retainedBackedUp.current) localStorage.removeItem(animationDraftKey(projectId)); } catch { /* The project version is already durable. */ } if (resetHistory) history.reset();
  }
  async function refresh(first = false) {
    if (!bridge) { if (alive.current) { setLoading(false); setIssue('此功能需要新版桌面后台，请更新桌面应用后再使用。'); } return; }
    const ticket = ++epoch.current;
    try {
      const value = await bridge.read({ projectId });
      if (!alive.current || ticket !== epoch.current || value.document.projectId !== projectId || value.document.revision < (saved.current?.document.revision ?? 0)) return;
      if (first && !current.current) {
        let draft: LocalDraft | undefined, raw = '';
        try { raw = localStorage.getItem(animationDraftKey(projectId)) || ''; if (raw) { if (raw.length > 512000) throw Error('size'); const parsed = JSON.parse(raw) as LocalDraft; if (!Number.isInteger(parsed.baseRevision)) throw Error('revision'); draft = { ...parsed, document: checkedAnimationDocument(parsed.document, projectId) }; } setHasRecovery(Boolean(localStorage.getItem(animationDraftKey(projectId) + ':recovery'))); } catch { retained.current = raw; setHasRecovery(Boolean(raw)); if (raw) try { localStorage.setItem(animationDraftKey(projectId) + ':recovery', raw); retainedBackedUp.current = true; } catch { /* The original draft key remains untouched. */ } setIssue('本机草稿参数无法读取，原始草稿已保留，可先导出保留的草稿；项目原稿仍可继续使用。'); }
        saved.current = value; setSnapshot(value); base.current = draft?.baseRevision ?? value.document.revision;
        const initial = initialInputRef.current, isNew = value.document.revision === 0 && !raw;
        const selected = selectedAnimationModel(draft?.document || { ...value.document, ...(isNew ? { mode: initialMode, ...(initial?.prompt !== undefined ? { prompt: initial.prompt } : {}), ...(initial?.referenceIds?.length ? { referenceArtifactIds: [...new Set(initial.referenceIds)].slice(0, 12) } : {}) } : {}) }, configurationRef.current);
        current.current = selected; changed.current = value.document.revision === 0 || Boolean(draft) || JSON.stringify(selected) !== JSON.stringify(value.document); setDocument(selected); setDirty(changed.current);
        if (draft && draft.baseRevision !== value.document.revision) { setIncoming(value); setIssue('已保留未保存草稿；项目版本已有变化，请先对照新结果再继续保存。'); }
      } else if (changed.current) { saved.current = value; setSnapshot(value); setIncoming(value); }
      else adopt(value);
    } catch (cause) { if (alive.current && ticket === epoch.current) setIssue(animationError(cause)); }
    finally { if (alive.current) setLoading(false); }
  }
  function edit(next: AnimationDocument, group?: string, skipFrameHistory = false) {
    const previous = current.current; if (!previous || operation.current) return;
    if (!skipFrameHistory) frameHistory.record(previous, next);
    history.record(previous, next, group); current.current = next; changed.current = true; setDocument(next); setDirty(true); setIssue('');
  }
  function undo(redo = false) { if (!current.current || operation.current) return; const previous = current.current, value = redo ? history.redo(previous) : history.undo(previous); if (value) { current.current = { ...value, revision: base.current }; frameHistory.record(previous, current.current); changed.current = true; setDocument(current.current); setDirty(true); setIssue(''); } }
  function moveFrame(entryId: string, frameId: string, redo = false) { if (!current.current || operation.current) return; const next = redo ? frameHistory.redo(current.current, entryId, frameId) : frameHistory.undo(current.current, entryId, frameId); if (!next) return; if (next.acceptedSampleId === entryId) next.acceptedSampleId = undefined; edit(next, `frame-history:${entryId}:${frameId}`, true); }
  async function saveInternal() {
    if (!bridge || !current.current) throw Error('桌面动画后台尚未连接。');
    const invalid = animationIssue(current.current); if (invalid) throw Error(invalid);
    if (!changed.current && saved.current) return saved.current;
    let value: AnimationSnapshot;
    try { value = await bridge.save({ projectId, expectedRevision: base.current, document: current.current, label: '保存动画编辑' }); } catch (cause) { if (alive.current) setPersistenceError(animationError(cause)); throw cause; }
    if (value.document.projectId !== projectId) throw Error('后台返回了其它项目，未覆盖当前草稿。'); adopt(value); return value;
  }
  async function run(label: string, action?: (value: AnimationSnapshot) => Promise<AnimationSnapshot | void>) {
    if (!bridge || operation.current) return false;
    operation.current = true; nativeEdit.current = { recorded: false }; setBusy(label); setIssue(''); epoch.current++; const ticket = ++actionEpoch.current;
    try { const value = await saveInternal(); if (!alive.current || ticket !== actionEpoch.current) return false; nativeEdit.current = { baseline: value.document, recorded: false }; const result = action ? await action(value) : value; if (alive.current && result && ticket === actionEpoch.current) adopt(result); return true; }
    catch (cause) { if (alive.current) { setIssue(animationError(cause)); if (!remember()) setIssue(animationError(cause) + '；本机草稿也未能保存，请导出草稿保留原稿。'); } return false; }
    finally { nativeEdit.current = { recorded: false }; operation.current = false; if (alive.current) setBusy(''); }
  }
  async function cancel() { if (!bridge) return; epoch.current++; actionEpoch.current++; try { const value = await bridge.control({ projectId, action: 'cancel' }); if (alive.current) { if (changed.current) { saved.current = value; setSnapshot(value); setIncoming(value); } else adopt(value); } } catch (cause) { if (alive.current) setIssue(animationError(cause)); } }
  function loadIncoming() { if (!incoming || operation.current) return; if (!remember(animationDraftKey(projectId) + ':recovery')) { setIssue('当前草稿尚未备份，暂不载入新版本；请先保存或导出草稿。'); return; } setHasRecovery(changed.current || hasRecovery); adopt(incoming, true); setIssue('已载入后台版本，上次本地草稿可单独恢复。'); }
  function recover() { try { const value = JSON.parse(localStorage.getItem(animationDraftKey(projectId) + ':recovery') || 'null') as LocalDraft; if (!value?.document || !current.current) throw Error('没有可恢复的本地草稿。'); edit({ ...checkedAnimationDocument(value.document, projectId), revision: base.current }); } catch (cause) { setIssue(animationError(cause)); } }
  async function exportRetained() { try { const raw = retained.current || localStorage.getItem(animationDraftKey(projectId) + ':recovery'); if (!raw) throw Error('没有保留的本地草稿。'); await downloadFile(`${current.current?.title || '角色动画'}-保留草稿.json`, raw); } catch (cause) { setIssue(animationError(cause)); } }
  const state = useRef({ dirty, busy, persistenceError, run, remember, document }); state.current = { dirty, busy, persistenceError, run, remember, document };
  useEffect(() => {
    alive.current = true; void refresh(true); let timer: ReturnType<typeof setTimeout> | undefined, pending = false;
    const schedule = (event?: { projectId: string }) => { if (event && event.projectId !== projectId) return; pending = true; if (documentHidden() || timer !== undefined) return; timer = setTimeout(() => { timer = undefined; if (alive.current && !documentHidden() && pending) { pending = false; void refresh(); } }, 250); };
    const visible = () => { if (!documentHidden() && pending) schedule(); }, remove = bridge?.onChanged?.(schedule); window.document.addEventListener('visibilitychange', visible);
    return () => { state.current.remember(); alive.current = false; epoch.current++; if (timer !== undefined) clearTimeout(timer); remove?.(); window.document.removeEventListener('visibilitychange', visible); };
  }, [projectId, bridge]);
  useEffect(() => { if (!dirty) return; const timer = setTimeout(() => { if (!state.current.remember()) setIssue('本机草稿暂不能保存，请保存到项目或导出草稿。'); }, 250); return () => clearTimeout(timer); }, [dirty, document]);
  useEffect(() => registerEditorSession({ id: `animation:${projectId}`, projectId, label: '动画工坊', getState: () => ({ dirty: state.current.dirty, pending: !!state.current.busy, persistenceError: state.current.persistenceError || undefined }), save: () => state.current.run('正在保存'), flushRecovery: () => state.current.remember(), exportRecovery: () => state.current.document ? downloadFile(`${state.current.document.title}-动画草稿.json`, JSON.stringify(state.current.document, null, 2)) : false }), [projectId]);
  return { snapshot, document, dirty, loading, busy, issue, incoming, hasRecovery, edit, undo: () => undo(), redo: () => undo(true), canUndo: history.canUndo, canRedo: history.canRedo, undoFrame: (entryId: string, frameId: string) => moveFrame(entryId, frameId), redoFrame: (entryId: string, frameId: string) => moveFrame(entryId, frameId, true), canUndoFrame: (entryId: string, frameId: string) => !!document && frameHistory.canUndo(document, entryId, frameId), canRedoFrame: (entryId: string, frameId: string) => !!document && frameHistory.canRedo(document, entryId, frameId), retainDraft: remember, save: () => run('正在保存'), run, cancel, refresh: () => { setIssue(''); return refresh(); }, loadIncoming, recover, exportRetained, setIssue };
}
const documentHidden = () => window.document.hidden;
