import { useEffect, useRef, useState } from 'react';
import type { SpreadsheetCalculation, SpreadsheetDocument } from '../spreadsheet-types';
import { createSpreadsheetWorkerClient } from '../lib/spreadsheet-worker-client';

export function useSpreadsheetCalculation(document: SpreadsheetDocument, scope: string) {
  const client = useRef<ReturnType<typeof createSpreadsheetWorkerClient> | undefined>(undefined);
  const current = useRef({ document, scope }); current.current = { document, scope };
  const [epoch, setEpoch] = useState(0), [restart, setRestart] = useState(0);
  const [state, setState] = useState<{ scope: string; document?: SpreadsheetDocument; calculation?: SpreadsheetCalculation; error: string; pending: boolean }>({ scope, error: '', pending: true });
  useEffect(() => {
    try {
      client.current = createSpreadsheetWorkerClient(new Worker(new URL('../workers/spreadsheet-calculation.worker.ts', import.meta.url), { type: 'module' }));
      setEpoch(value => value + 1);
    } catch { setState({ scope, error: '后台计算未能启动；编辑内容仍保留，可保存并在 Excel/WPS 中重算。', pending: false }); }
    return () => { client.current?.dispose(); client.current = undefined; };
  }, [scope, restart]);
  useEffect(() => {
    if (!client.current) return;
    let disposed = false;
    setState(previous => ({ scope, ...(previous.scope === scope ? { calculation: previous.calculation } : {}), error: '', pending: true }));
    const timer = setTimeout(() => {
      void client.current?.calculate(document).then(calculation => { if (!disposed) setState({ scope, document, calculation, error: '', pending: false }); }).catch(error => { if (!disposed && error.name !== 'AbortError') setState(previous => ({ ...previous, scope, error: error.message, pending: false })); });
    }, 60);
    return () => { disposed = true; clearTimeout(timer); };
  }, [document, scope, epoch]);
  async function flush() {
    const snapshot = current.current, calculator = client.current;
    if (!calculator) return;
    try {
      const calculation = await calculator.calculate(snapshot.document);
      if (current.current.scope === snapshot.scope && current.current.document === snapshot.document) setState({ ...snapshot, calculation, error: '', pending: false });
    } catch (error) {
      if (current.current.scope === snapshot.scope && (error as Error).name !== 'AbortError') setState(previous => ({ ...previous, error: '后台计算未完成，保存时将由桌面后台重新校核当前工作簿。', pending: false }));
    }
  }
  return { calculation: state.scope === scope ? state.calculation : undefined, error: state.scope === scope ? state.error : '', pending: state.scope !== scope || state.pending || state.document !== document && !state.error, flush, restart: () => setRestart(value => value + 1) };
}
