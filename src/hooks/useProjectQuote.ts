import { useEffect, useRef, useState } from 'react';
import { readProjectQuote, saveProjectQuote } from '../lib/project-quotes';
import type { ProjectQuote, QuoteFields, QuoteMode, QuoteRead } from '../lib/project-quotes';
import { readQuoteWorkingDraft, saveQuoteWorkingDraft } from '../lib/quote-working-drafts';
import { emptyCustomerQuote, validCustomerQuoteInfo } from '../lib/customer-quote';
import type { CustomerQuoteInfo } from '../lib/customer-quote';
import { registerEditorSession } from '../lib/editor-session-guard';
import { downloadFile } from '../lib/files';

interface Session extends QuoteRead { workspaceId: string; projectId: string; fields: QuoteFields; mode: QuoteMode; scope: 'live' | 'simulation'; customer: CustomerQuoteInfo; saved: boolean; workingRaw: string | null; autosaved: boolean; recoveryError?: string; recovered: boolean; }
function readSession(workspaceId: string, projectId: string, defaults: QuoteFields): Session {
  const saved: QuoteRead = typeof window === 'undefined' || !projectId ? { raw: null } : readProjectQuote(() => localStorage, workspaceId, projectId);
  const working: ReturnType<typeof readQuoteWorkingDraft> = typeof window === 'undefined' || !projectId ? { raw: null } : readQuoteWorkingDraft(() => localStorage, workspaceId, projectId);
  const draft = working.draft;
  return { ...saved, workspaceId, projectId, raw: draft ? draft.baseSavedRaw : saved.raw, fields: { ...(draft?.inputs || saved.draft?.inputs || defaults) }, mode: draft?.mode || saved.draft?.mode || 'single', scope: draft?.scope || saved.draft?.scope || 'live', customer: draft?.customer || (validCustomerQuoteInfo(saved.draft?.customer) ? saved.draft.customer : emptyCustomerQuote()), saved: false, workingRaw: working.raw, autosaved: !working.error, recoveryError: working.error, recovered: !!draft, error: saved.error || (draft && draft.baseSavedRaw !== saved.raw ? '已恢复临时输入，但正式报价已在另一处更新。请先核对已保存报价，当前输入不会覆盖它。' : undefined) };
}
function persistWorking(session: Session): Session {
  if (!session.projectId) return session;
  try {
    const workingRaw = saveQuoteWorkingDraft(() => localStorage, { type: 'xuzuo-quote-working', version: 1, workspaceId: session.workspaceId, projectId: session.projectId, inputs: session.fields, mode: session.mode, scope: session.scope, customer: session.customer, baseSavedRaw: session.raw, updatedAt: new Date().toISOString() }, session.workingRaw);
    return { ...session, workingRaw, autosaved: true, recoveryError: undefined, recovered: false };
  } catch (cause) { const message = cause instanceof Error ? cause.message : ''; return { ...session, autosaved: false, recoveryError: /临时|另一窗口|报价输入/.test(message) ? message : '临时报价输入未能保存，当前内容仍保留。请先导出恢复稿，再检查本机存储空间或权限。' }; }
}
export function useProjectQuote(workspaceId: string, projectId: string, defaults: QuoteFields) {
  const sessions = useRef(new Map<string, Session>()), [, render] = useState(0);
  const key = `${workspaceId}\0${projectId}`;
  if (!sessions.current.has(key)) sessions.current.set(key, readSession(workspaceId, projectId, defaults));
  const current = sessions.current.get(key)!;
  function update(changes: Partial<Session> | ((value: Session) => Partial<Session>), persist = true) {
    const previous = sessions.current.get(key)!, next = { ...previous, ...(typeof changes === 'function' ? changes(previous) : changes) };
    sessions.current.set(key, persist ? persistWorking(next) : next); render(value => value + 1);
  }
  const recovery = useRef({ download: () => Promise.resolve(false) });
  const downloadRecovery = () => downloadFile('序作-报价输入恢复稿.json', JSON.stringify({ type: 'xuzuo-quote-input-recovery', version: 1, drafts: [...sessions.current.values()].map(session => ({ workspaceId: session.workspaceId, projectId: session.projectId, inputs: session.fields, mode: session.mode, customer: session.customer, baseSavedRaw: session.raw })) }, null, 2), 'application/json;charset=utf-8');
  recovery.current.download = downloadRecovery;
  useEffect(() => registerEditorSession({ id: `quote-inputs-${workspaceId}`, projectId: '', label: '尚未可靠保存的报价输入', getState: () => { const failed = [...sessions.current.values()].find(value => !value.saved && value.recoveryError); return { dirty: !!failed, pending: false, persistenceError: failed?.recoveryError }; }, save: async () => { let ok = true; for (const [id, value] of sessions.current) if (!value.saved && value.recoveryError) { const next = persistWorking(value); sessions.current.set(id, next); ok = ok && next.autosaved; } render(value => value + 1); return ok; }, exportRecovery: () => recovery.current.download() }), [workspaceId]);
  return {
    ...current,
    downloadRecovery,
    updateField(name: keyof QuoteFields, value: string) { update(previous => ({ fields: { ...previous.fields, [name]: value }, saved: false })); },
    updateCustomer(name: keyof CustomerQuoteInfo, value: string) { update(previous => ({ customer: { ...previous.customer, [name]: value }, saved: false })); },
    setMode(mode: QuoteMode) { update({ mode, saved: false }); },
    setScope(scope: 'live' | 'simulation') { update({ scope, saved: false }); },
    reset() { update({ fields: { ...defaults }, mode: 'single', saved: false }); },
    markDirty() { if (sessions.current.get(key)?.saved) update({ saved: false }, false); },
    loadFields(fields: QuoteFields, mode: QuoteMode) { update({ fields: { ...fields }, mode, saved: false }); },
    reloadWorking() { sessions.current.set(key, readSession(workspaceId, projectId, defaults)); render(value => value + 1); },
    restore() {
      const result = readProjectQuote(() => localStorage, workspaceId, projectId);
      if (result.error) { update({ error: result.error }, false); throw new Error(result.error); }
      if (!result.draft) return undefined;
      update({ ...result, fields: { ...result.draft.inputs }, mode: result.draft.mode, scope: result.draft.scope, customer: validCustomerQuoteInfo(result.draft.customer) ? result.draft.customer : emptyCustomerQuote(), saved: false, error: undefined });
      return result.draft;
    },
    save(quote: ProjectQuote) {
      const raw = saveProjectQuote(() => localStorage, quote, sessions.current.get(key)!.raw);
      update({ raw, draft: quote, saved: true, error: undefined });
    },
  };
}
