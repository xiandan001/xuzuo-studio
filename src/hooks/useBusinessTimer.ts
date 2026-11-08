import { useEffect, useRef, useState } from 'react';

export function useBusinessTimer(key: string) {
  const [seconds, setSeconds] = useState(() => { try { const saved = Number(sessionStorage.getItem(key)); return Number.isFinite(saved) && saved >= 0 && saved <= 864000 ? saved : 0; } catch { return 0; } });
  const [running, setRunning] = useState(false), elapsed = useRef(seconds), anchor = useRef<number | undefined>(undefined);
  const read = () => elapsed.current + (anchor.current === undefined ? 0 : Math.max(0, Date.now() - anchor.current) / 1000);
  const persist = (value: number) => { try { sessionStorage.setItem(key, String(value)); } catch { /* The visible timer can still be recorded manually. */ } };
  const pause = () => { const next = read(); anchor.current = undefined; elapsed.current = next; setSeconds(next); setRunning(false); persist(next); return next; };
  useEffect(() => {
    if (!running) return;
    const tick = () => { if (document.visibilityState === 'hidden' || !document.hasFocus()) pause(); else { const next = read(); setSeconds(next); persist(next); } };
    const timer = setInterval(tick, 1000); document.addEventListener('visibilitychange', tick); window.addEventListener('blur', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('blur', tick); };
  }, [running, key]);
  useEffect(() => () => persist(read()), [key]);
  return { seconds, running, start: () => { if (anchor.current === undefined) anchor.current = Date.now(); setRunning(true); }, pause, reset: () => { anchor.current = undefined; elapsed.current = 0; setSeconds(0); setRunning(false); persist(0); } };
}
