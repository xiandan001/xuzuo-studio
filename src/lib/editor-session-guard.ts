export interface EditorSession {
  id: string;
  projectId: string;
  label: string;
  kind?: 'preferences';
  getState: () => { dirty: boolean; pending: boolean; persistenceError?: string };
  save: () => Promise<boolean>;
  exportRecovery: () => boolean | Promise<boolean>;
  flushRecovery?: () => boolean;
}
const sessions = new Map<string, EditorSession>();
export function registerEditorSession(session: EditorSession): () => void {
  sessions.set(session.id, session);
  return () => { if (sessions.get(session.id) === session) sessions.delete(session.id); };
}
export function guardedEditorSessions(options?: { includeDirty?: boolean }): EditorSession[] {
  return [...sessions.values()].filter(session => { const state = session.getState(); return state.pending || Boolean(state.persistenceError) || Boolean(options?.includeDirty && state.dirty); });
}
export function flushEditorRecovery(): boolean {
  let saved = true;
  for (const session of sessions.values()) if (session.getState().dirty && session.flushRecovery && !session.flushRecovery()) saved = false;
  return saved;
}
