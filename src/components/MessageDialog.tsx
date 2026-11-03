import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CircleHelp, Info, ShieldAlert } from 'lucide-react';
import type { CustomDialogRequest, StudioDialogBridge } from '../dialog-types';
import { dialogError } from '../lib/dialog-paths';

export function MessageDialog({ config, bridge }: { config: CustomDialogRequest; bridge: StudioDialogBridge }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const actions = useRef<HTMLDivElement>(null), current = useRef({ busy }); current.current = { busy };
  const buttons = config.options.buttons || ['确定'], selected = config.options.defaultId || 0;
  useEffect(() => {
    actions.current?.querySelectorAll<HTMLButtonElement>('button')[selected]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !current.current.busy) { event.preventDefault(); void respond(config.options.cancelId || 0); }
      if (event.key !== 'Tab') return;
      const list = [...(actions.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])], first = list[0], last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  async function respond(index: number) {
    if (current.current.busy) return;
    current.current.busy = true; setBusy(true); setError('');
    try { await bridge.respondMessage(index); } catch (cause) { setError(dialogError(cause)); current.current.busy = false; setBusy(false); }
  }
  const Icon = config.options.type === 'error' ? ShieldAlert : config.options.type === 'warning' ? AlertTriangle : config.options.type === 'question' ? CircleHelp : Info;
  return <main className="sd-message" role="dialog" aria-modal="true" aria-labelledby="message-heading"><div className={`sd-message-icon ${config.options.type || 'info'}`}><Icon size={27} /></div><h1 id="message-heading">{config.options.message || config.title}</h1>{config.options.detail && <p className="sd-message-detail">{config.options.detail}</p>}{error && <p className="sd-inline-error" role="alert">{error}</p>}<div ref={actions} className="sd-message-actions">{buttons.map((label, index) => <button key={`${index}-${label}`} className={`sd-button ${/强制|删除|覆盖/.test(label) ? 'sd-button-danger' : index === selected ? 'sd-button-primary' : 'sd-button-secondary'}`} disabled={busy} onClick={() => { void respond(index); }}>{label}</button>)}</div></main>;
}
