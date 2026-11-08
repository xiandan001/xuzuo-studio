import { useCallback, useEffect, useRef, useState } from 'react';
import type { BusinessBridge, BusinessState } from '../business-types';
import { checkedBusinessState } from '../lib/business-data';
import { registerEditorSession } from '../lib/editor-session-guard';

type Transform = (state: BusinessState) => BusinessState;
const message = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '业务资料未能保存，当前输入仍保留。';
const isConflict = (cause: unknown) => /BUSINESS_CONFLICT|另一处更新|版本已变化|业务资料已变化/.test(message(cause));
interface Recovery { state: BusinessState; exported: boolean; }
export function useBusinessWorkspace(workspaceId: string, bridge: BusinessBridge | undefined = typeof window === 'undefined' ? undefined : window.desktop?.business) {
  const [stored, setStored] = useState<BusinessState>(), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const current = useRef<BusinessState | undefined>(undefined), alive = useRef(true), generation = useRef(0), owner = useRef(workspaceId), readEpoch = useRef(0);
  const pending = useRef(new Map<Promise<unknown>, string>()), queue = useRef(Promise.resolve()), recovery = useRef(new Map<string, Recovery>()), errorRef = useRef('');
  const live = useRef({ workspaceId, bridge }); live.current = { workspaceId, bridge };
  if (owner.current !== workspaceId) { owner.current = workspaceId; generation.current++; current.current = undefined; queue.current = Promise.resolve(); }
  const showError = useCallback((value: string) => { errorRef.current = value; if (alive.current) setError(value); }, []);
  const accept = useCallback((value: BusinessState, scope: string, epoch: number, savedDraft?: BusinessState) => {
    checkedBusinessState(value, scope);
    const draft = recovery.current.get(scope);
    if (draft && (savedDraft ? draft.state === savedDraft : draft.exported && live.current.workspaceId === scope && generation.current === epoch)) recovery.current.delete(scope);
    if (alive.current && live.current.workspaceId === scope && generation.current === epoch) {
      if (!current.current || current.current.revision <= value.revision) { current.current = value; setStored(value); }
      setError(''); errorRef.current = ''; setLoading(false); return current.current;
    }
    return undefined;
  }, []);
  const refresh = useCallback(async () => {
    const target = bridge, epoch = generation.current, request = ++readEpoch.current;
    if (!target) { showError('请在新版桌面应用中使用业务制作。'); setLoading(false); return undefined; }
    await Promise.allSettled([...pending.current].filter(([, scope]) => scope === workspaceId).map(([task]) => task));
    if (request !== readEpoch.current || epoch !== generation.current || live.current.workspaceId !== workspaceId) return undefined;
    const draft = recovery.current.get(workspaceId); if (draft && !draft.exported) return undefined;
    if (!current.current) setLoading(true);
    try {
      const result = await target.snapshot(workspaceId);
      if (request !== readEpoch.current || epoch !== generation.current || live.current.workspaceId !== workspaceId) return undefined;
      if (recovery.current.get(workspaceId) && !recovery.current.get(workspaceId)!.exported) return undefined;
      return accept(result, workspaceId, epoch);
    } catch (cause) { if (epoch === generation.current && request === readEpoch.current) showError(message(cause)); return undefined; }
    finally { if (alive.current && epoch === generation.current && request === readEpoch.current) setLoading(false); }
  }, [workspaceId, bridge, accept, showError]);
  useEffect(() => { alive.current = true; void refresh(); return () => { readEpoch.current++; }; }, [refresh]);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!bridge?.onChanged) return;
    let timer: ReturnType<typeof setTimeout> | undefined, requestedRevision = -1, disposed = false;
    const schedule = () => {
      if (disposed || document.hidden || timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; void (async () => {
        await Promise.allSettled([...pending.current].filter(([, scope]) => scope === workspaceId).map(([task]) => task));
        if (disposed || document.hidden || requestedRevision <= (current.current?.revision ?? -1)) return;
        const draft = recovery.current.get(workspaceId); if (draft && !draft.exported) return;
        await refresh();
      })(); }, 250);
    };
    const remove = bridge.onChanged(value => { if (value.workspaceId !== workspaceId || !Number.isSafeInteger(value.revision) || value.revision <= (current.current?.revision ?? -1)) return; requestedRevision = Math.max(requestedRevision, value.revision); schedule(); });
    const visible = () => { if (!document.hidden && requestedRevision > (current.current?.revision ?? -1)) schedule(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); remove(); document.removeEventListener('visibilitychange', visible); };
  }, [workspaceId, bridge, refresh]);
  const commit = useCallback((transform: Transform): Promise<BusinessState | undefined> => {
    const target = bridge, scope = workspaceId, epoch = generation.current;
    if (scope === live.current.workspaceId && epoch === generation.current) readEpoch.current++;
    const task = queue.current.then(async () => {
      if (!target) { showError('当前后台不支持业务保存，请更新桌面应用。'); return undefined; }
      if (alive.current && live.current.workspaceId === scope && generation.current === epoch) setSaving(true);
      let base: BusinessState | undefined;
      try {
        const previousDraft = recovery.current.get(scope);
        base = previousDraft && !previousDraft.exported ? previousDraft.state : current.current?.workspaceId === scope && generation.current === epoch ? current.current : await target.snapshot(scope);
        for (let attempt = 0; attempt < 2; attempt++) {
          const candidate = checkedBusinessState(transform(structuredClone(base!)), scope); candidate.revision = base!.revision;
          recovery.current.set(scope, { state: candidate, exported: false });
          try {
            const result = await target.save({ workspaceId: scope, expectedRevision: base!.revision, state: candidate });
            return accept(result, scope, epoch, candidate);
          } catch (cause) { if (!attempt && isConflict(cause)) { const fresh = await target.snapshot(scope); if (fresh.revision < base!.revision) throw Error('源资料版本发生回退，当前输入保留，请核对备份后再保存。'); base = fresh; continue; } throw cause; }
        }
      } catch (cause) { if (generation.current === epoch && live.current.workspaceId === scope) showError(message(cause)); }
      finally { if (alive.current && generation.current === epoch && live.current.workspaceId === scope) setSaving(false); }
      return undefined;
    });
    queue.current = task.then(() => undefined, () => undefined);
    pending.current.set(task, scope); void task.finally(() => pending.current.delete(task)).catch(() => undefined);
    return task;
  }, [workspaceId, bridge, accept, showError]);
  const exportRecovery = useCallback(async () => {
    const unresolved = [...recovery.current.entries()].find(([, value]) => !value.exported);
    const scope = unresolved?.[0] || live.current.workspaceId, target = live.current.bridge, draft = recovery.current.get(scope), state = draft?.state || current.current;
    if (!target || !state) { showError('当前没有可导出的业务资料，请保持页面打开并检查工作区。'); return false; }
    try { const result = await target.exportRecovery({ workspaceId: scope, state: structuredClone(state) }); if (result.saved && recovery.current.get(scope) === draft && draft) draft.exported = true; return result.saved; }
    catch (cause) { showError(message(cause)); return false; }
  }, [showError]);
  const flush = useCallback(async () => {
    await Promise.allSettled([...pending.current.keys()]);
    const target = live.current.bridge;
    for (const [scope, draft] of [...recovery.current]) {
      if (draft.exported) continue;
      if (!target) return false;
      try { const result = await target.save({ workspaceId: scope, expectedRevision: draft.state.revision, state: structuredClone(draft.state) }); accept(result, scope, generation.current, draft.state); }
      catch (cause) { showError(message(cause)); return false; }
    }
    return true;
  }, [accept, showError]);
  useEffect(() => registerEditorSession({ id: 'business-workspace', projectId: '', label: '业务制作资料', getState: () => { const draft = [...recovery.current.values()].find(item => !item.exported); return { dirty: !!draft, pending: pending.current.size > 0, persistenceError: draft ? errorRef.current || undefined : undefined }; }, save: flush, exportRecovery }), [flush, exportRecovery]);
  return { state: stored?.workspaceId === workspaceId ? stored : undefined, current, currentRef: current, loading, saving, error, refresh, reload: refresh, commit, flush, exportRecovery, clearError: () => showError('') };
}
