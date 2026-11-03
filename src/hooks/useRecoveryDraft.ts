import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile } from '../lib/files';
import { RECOVERY_SAVE_ERROR, writeRecoveryDraft } from '../lib/recovery-draft';
import { serializeImmutableSnapshot } from '../lib/snapshot-serialization';

export function useRecoveryDraft(key: string, payload: unknown, enabled: boolean, filename: string, getPayload?: () => unknown) {
  const serialized = useMemo(() => serializeImmutableSnapshot(payload), [payload]);
  const current = useRef({ key, serialized, enabled, filename, getPayload }); current.current = { key, serialized, enabled, filename, getPayload };
  const [error, setError] = useState('');
  const retry = useCallback(() => {
    const value = current.current;
    if (!value.enabled) return false;
    let issue: string;
    try { issue = writeRecoveryDraft(localStorage, value.key, value.getPayload ? JSON.stringify(value.getPayload()) : value.serialized); }
    catch { issue = RECOVERY_SAVE_ERROR; }
    setError(issue); return !issue;
  }, []);
  const exportDraft = useCallback(async () => {
    const value = current.current;
    if (!value.enabled) return false;
    try { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); return await downloadFile(value.filename, value.getPayload ? JSON.stringify(value.getPayload()) : value.serialized); } catch { return false; }
  }, []);
  useEffect(() => {
    if (!enabled) { setError(''); return; }
    try { setError(writeRecoveryDraft(localStorage, key, serialized)); }
    catch { setError(RECOVERY_SAVE_ERROR); }
  }, [key, serialized, enabled]);
  return { error, retry, exportDraft };
}
