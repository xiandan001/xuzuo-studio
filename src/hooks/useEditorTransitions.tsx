import { hasManagedDialog } from '../lib/dialog-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Save, ShieldAlert } from 'lucide-react';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import { ModalPortal } from '../components/ModalPortal';

export function useEditorTransitions() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const modal = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null);
  function finish(value: boolean) { const done = resolve.current; resolve.current = null; setOpen(false); done?.(value); }
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const timer = window.setInterval(() => { if (resolve.current && !guardedEditorSessions().length) finish(true); }, 100);
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); finish(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(modal.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [open, busy]);
  const confirmTransition = useCallback((): Promise<boolean> => {
    if (!guardedEditorSessions().length) return Promise.resolve(true);
    if (resolve.current) return Promise.resolve(false);
    setError(''); setOpen(true); return new Promise(done => { resolve.current = done; });
  }, []);
  async function saveAndLeave() {
    setBusy(true); setError('');
    try {
      for (const session of guardedEditorSessions()) {
        if (session.getState().pending) throw new Error('当前编辑或保存尚未结束，请等待完成后重试。');
        if (!await session.save()) throw new Error('保存未完成，当前编辑内容仍保留。可重试或下载恢复稿。');
      }
      await new Promise<void>(done => requestAnimationFrame(() => done()));
      if (guardedEditorSessions().length) throw new Error('仍有内容未能可靠保存，请检查编辑器提示。');
      finish(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存未完成。'); }
    finally { setBusy(false); }
  }
  const guarded = guardedEditorSessions(), preferencesOnly = guarded.length > 0 && guarded.every(session => session.kind === 'preferences');
  const transitionDialog = open && <ModalPortal onClose={() => finish(false)} busy={busy}><div className="modal-backdrop" data-editor-transition="true"><div ref={modal} className="modal" role="dialog" aria-modal="true" aria-label={preferencesOnly ? '设置尚未保存' : '保护未保存的编辑'}><h2><ShieldAlert size={21} />{preferencesOnly ? '设置尚未保存' : '先保留当前编辑'}</h2><p>{preferencesOnly ? '保存后继续，或放弃本次设置修改。项目、作品和历史费用会保留。' : '当前内容或文件尚未可靠保存。请等待保存完成，或先保存版本、下载恢复稿，再离开项目。'}</p>{guarded.map(session => <p key={session.id}><strong>{session.label}</strong>：{session.getState().persistenceError || '本地编辑尚未结束'}</p>)}{error && <p role="alert">{error}</p>}<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}><button ref={cancel} className="btn btn-secondary" disabled={busy} onClick={() => finish(false)}>{preferencesOnly ? '返回设置' : '继续编辑'}</button>{(!preferencesOnly || !!error) && <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const sessions = guardedEditorSessions(), saved: boolean[] = []; for (const session of sessions) { const result = await session.exportRecovery(); saved.push(result); if (!result) break; } setError(saved.length > 0 && saved.length === sessions.length && saved.every(Boolean) ? '恢复稿已保存，请确认文件后再选择是否离开。' : '恢复稿未完成保存，请保留当前窗口。'); } catch (error) { setError(error instanceof Error ? error.message : '恢复稿未能保存，请保留当前窗口。'); } finally { setBusy(false); } }}><Download size={15} />{preferencesOnly ? '导出设置草稿' : '下载恢复稿'}</button>}<button className="btn btn-primary" disabled={busy} onClick={() => { void saveAndLeave(); }}><Save size={15} />{busy ? '正在保存' : preferencesOnly ? '保存并继续' : '保存后离开'}</button><button className="btn btn-ghost" disabled={busy} onClick={() => finish(true)}>{preferencesOnly ? '放弃修改并继续' : '仍然离开'}</button></div></div></div></ModalPortal>;
  return { confirmTransition, transitionDialog };
}
