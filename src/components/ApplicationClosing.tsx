import { LoaderCircle } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import './application-closing.css';
export function ApplicationClosing({ phase, message }: { phase: string; message?: string }) {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const block = (event: KeyboardEvent) => { if (event.altKey && event.key === 'F4') return; event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('keydown', block, true);
    return () => { window.removeEventListener('keydown', block, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  if (phase === 'cancelled') return null;
  return <div className="application-closing-backdrop" data-application-closing="true"><section ref={panel} tabIndex={-1} role="status" aria-live="polite"><LoaderCircle size={27} className="spin" /><h2>{phase === 'checking' ? '正在检查退出状态' : '正在保存并退出'}</h2><p>{message || (phase === 'checking' ? '确认当前编辑和后台任务，避免遗漏保存。' : '正在等待已有写入完成。等待超时后，可在系统提示中选择强制退出。')}</p><small>退出期间暂停接收新的生成和保存操作。</small></section></div>;
}
