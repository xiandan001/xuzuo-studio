import { useCallback, useEffect, useRef, useState } from 'react';
import type { BeadMarketBridge, BeadMarketSnapshot, BeadMarketState } from '../bead-market-types';
import { registerEditorSession } from '../lib/editor-session-guard';
import { downloadFile } from '../lib/files';

type Change = (value: BeadMarketState) => BeadMarketState;
interface Recovery { state: BeadMarketState; changes: Change[]; }
const text = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '材料报价暂未保存，输入已保留。';
const conflict = (cause: unknown) => /BEAD_MARKET_CONFLICT|材料报价已更新|报价版本/.test(text(cause));
export function useBeadMarket(projectId: string, bridge: BeadMarketBridge | undefined = typeof window === 'undefined' ? undefined : window.desktop?.beadMarket) {
  const [snapshot, setSnapshot] = useState<BeadMarketSnapshot>(), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const active = useRef({ projectId, epoch: 0 }), current = useRef<BeadMarketSnapshot | undefined>(undefined), alive = useRef(true), readEpoch = useRef(0), queues = useRef(new Map<string, Promise<void>>());
  const pending = useRef(new Map<Promise<unknown>, string>()), recovery = useRef(new Map<string, Recovery>()), live = useRef({ projectId, bridge }); live.current = { projectId, bridge };
  if (active.current.projectId !== projectId) { active.current = { projectId, epoch: active.current.epoch + 1 }; current.current = undefined; readEpoch.current++; }
  const showError = useCallback((cause: unknown, scope: string, epoch: number) => { if (alive.current && active.current.projectId === scope && active.current.epoch === epoch) setError(text(cause)); }, []);
  const acceptScoped = useCallback((value: BeadMarketSnapshot, scope: string, epoch: number) => {
    if (value.state.projectId !== scope || !Number.isSafeInteger(value.state.revision)) throw Error('返回的报价不属于当前项目。');
    if (!alive.current || active.current.projectId !== scope || active.current.epoch !== epoch) return;
    if (!current.current || value.state.revision >= current.current.state.revision) { current.current = value; setSnapshot(value); }
    if (!recovery.current.has(scope)) setError(''); setLoading(false); return current.current;
  }, []);
  const accept = useCallback((value: BeadMarketSnapshot) => acceptScoped(value, projectId, active.current.epoch), [projectId, acceptScoped]);
  const refresh = useCallback(async () => {
    const scope = projectId, epoch = active.current.epoch, request = ++readEpoch.current;
    if (!bridge) { showError(Error('请在新版桌面应用中使用材料比价。'), scope, epoch); setLoading(false); return; }
    await Promise.allSettled([...pending.current].filter(([, scope]) => scope === projectId).map(([task]) => task));
    if (request !== readEpoch.current || epoch !== active.current.epoch || scope !== active.current.projectId || recovery.current.has(scope)) return;
    try { const value = await bridge.read({ projectId: scope }); if (request === readEpoch.current) return acceptScoped(value, scope, epoch); }
    catch (cause) { showError(cause, scope, epoch); }
    finally { if (alive.current && active.current.projectId === scope && active.current.epoch === epoch) setLoading(false); }
  }, [projectId, bridge, acceptScoped, showError]);
  useEffect(() => { alive.current = true; void refresh(); return () => { readEpoch.current++; }; }, [refresh]);
  useEffect(() => () => { alive.current = false; }, []);
  const commit = useCallback((change: Change): Promise<BeadMarketSnapshot | undefined> => {
    const scope = projectId, epoch = active.current.epoch, target = bridge; readEpoch.current++;
    const task = (queues.current.get(scope) || Promise.resolve()).then(async () => {
      if (!target) { showError(Error('材料报价后台尚未连接，请更新桌面应用。'), scope, epoch); return; }
      if (alive.current && active.current.projectId === scope && active.current.epoch === epoch) setSaving(true);
      try {
        const changes = [...(recovery.current.get(scope)?.changes || []), change];
        let base = current.current?.state.projectId === scope && active.current.epoch === epoch ? current.current.state : (await target.read({ projectId: scope })).state;
        for (let attempt = 0; attempt < 2; attempt++) {
          const candidate = changes.reduce((value, apply) => apply(value), structuredClone(base)); if (candidate.projectId !== scope) throw Error('修改不能跨项目保存。'); candidate.revision = base.revision; const draft = { state: candidate, changes }; recovery.current.set(scope, draft);
          try { const result = await target.save({ projectId: scope, expectedRevision: base.revision, state: candidate }); if (recovery.current.get(scope) === draft) recovery.current.delete(scope); return acceptScoped(result, scope, epoch); }
          catch (cause) { if (!attempt && conflict(cause)) { base = (await target.read({ projectId: scope })).state; continue; } throw cause; }
        }
      } catch (cause) { showError(cause, scope, epoch); }
      finally { if (alive.current && active.current.projectId === scope && active.current.epoch === epoch) setSaving(false); }
    });
    const tail = task.then(() => undefined, () => undefined); queues.current.set(scope, tail); pending.current.set(task, scope); void task.finally(() => { pending.current.delete(task); if (queues.current.get(scope) === tail) queues.current.delete(scope); }).catch(() => undefined); return task;
  }, [projectId, bridge, acceptScoped, showError]);
  const flush = useCallback(async () => {
    await Promise.allSettled([...pending.current.keys()]); const target = live.current.bridge; if (!target && recovery.current.size) return false;
    for (const [scope, draft] of recovery.current) { try { const fresh = await target!.read({ projectId: scope }); if (fresh.state.revision < draft.state.revision) throw Error('报价版本发生回退，请保留恢复资料后检查项目目录。'); const candidate = draft.changes.reduce((value, apply) => apply(value), structuredClone(fresh.state)); const result = await target!.save({ projectId: scope, expectedRevision: fresh.state.revision, state: candidate }); if (recovery.current.get(scope) === draft) recovery.current.delete(scope); acceptScoped(result, scope, active.current.epoch); } catch (cause) { showError(cause, live.current.projectId, active.current.epoch); return false; } } return true;
  }, [acceptScoped, showError]);
  useEffect(() => registerEditorSession({ id: `bead-market:${projectId}`, projectId, label: '材料报价', getState: () => ({ dirty: recovery.current.size > 0, pending: pending.current.size > 0 }), save: flush, exportRecovery: () => downloadFile('材料报价恢复.json', JSON.stringify({ version: 1, drafts: [...recovery.current.values()].map(draft => draft.state) }, null, 2)) }), [projectId, flush]);
  useEffect(() => {
    if (!bridge?.onChanged) return;
    let revision = -1, timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
    const schedule = () => { if (disposed || document.hidden || timer !== undefined) return; timer = setTimeout(() => { timer = undefined; void (async () => { await Promise.allSettled([...pending.current].filter(([, scope]) => scope === projectId).map(([task]) => task)); if (!disposed && !document.hidden && revision > (current.current?.state.revision ?? -1)) await refresh(); })(); }, 250); };
    const remove = bridge.onChanged(event => { if (event.projectId !== projectId || event.revision <= (current.current?.state.revision ?? -1)) return; revision = Math.max(revision, event.revision); schedule(); });
    const visible = () => { if (!document.hidden && revision > (current.current?.state.revision ?? -1)) schedule(); }; document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); remove(); document.removeEventListener('visibilitychange', visible); };
  }, [projectId, bridge, refresh]);
  return { snapshot: snapshot?.state.projectId === projectId ? snapshot : undefined, current, loading, saving, error, refresh, commit, accept, flush };
}
