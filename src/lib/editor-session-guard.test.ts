import { expect, it } from 'vitest';
import { guardedEditorSessions, registerEditorSession } from './editor-session-guard';

it('lets workspace removal include dirty sessions without changing ordinary navigation guards', () => {
  const session = { id: 'remove-guard', projectId: 'p', label: 'word', getState: () => ({ dirty: true, pending: false }), save: async () => true, exportRecovery: () => true };
  const remove = registerEditorSession(session);
  try {
    expect(guardedEditorSessions()).not.toContain(session);
    expect(guardedEditorSessions({ includeDirty: true })).toContain(session);
  } finally { remove(); }
  expect(guardedEditorSessions({ includeDirty: true })).not.toContain(session);
});
