import { useRef, useState } from 'react';
import { readProjectQuote, saveProjectQuote } from '../lib/project-quotes';
import type { ProjectQuote, QuoteFields, QuoteMode, QuoteRead } from '../lib/project-quotes';

interface Session extends QuoteRead { fields: QuoteFields; mode: QuoteMode; saved: boolean; }
export function useProjectQuote(workspaceId: string, projectId: string, defaults: QuoteFields) {
  const sessions = useRef(new Map<string, Session>());
  const [, render] = useState(0);
  const key = `${workspaceId}\0${projectId}`;
  let session = sessions.current.get(key);
  if (!session) {
    const result: QuoteRead = typeof window === 'undefined' || !projectId ? { raw: null } : readProjectQuote(() => localStorage, workspaceId, projectId);
    session = { ...result, fields: { ...(result.draft?.inputs || defaults) }, mode: result.draft?.mode || 'single', saved: false };
    sessions.current.set(key, session);
  }
  const current = session;
  function update(changes: Partial<Session>) { sessions.current.set(key, { ...current, ...changes }); render(value => value + 1); }
  return {
    ...current,
    updateField(name: keyof QuoteFields, value: string) { update({ fields: { ...current.fields, [name]: value }, saved: false }); },
    setMode(mode: QuoteMode) { update({ mode, saved: false }); },
    reset() { update({ fields: { ...defaults }, mode: 'single', saved: false }); },
    markDirty() { if (current.saved) update({ saved: false }); },
    loadFields(fields: QuoteFields, mode: QuoteMode) { update({ fields: { ...fields }, mode, saved: false }); },
    restore() {
      const result = readProjectQuote(() => localStorage, workspaceId, projectId);
      if (result.error) { update({ error: result.error }); throw new Error(result.error); }
      if (!result.draft) return undefined;
      update({ ...result, fields: { ...result.draft.inputs }, mode: result.draft.mode, saved: false, error: undefined });
      return result.draft;
    },
    save(quote: ProjectQuote) {
      const raw = saveProjectQuote(() => localStorage, quote, current.raw);
      update({ raw, draft: quote, saved: true, error: undefined });
    },
  };
}
