import { useEffect, useState } from 'react';
import { shanghaiMonth } from '../lib/studio-time';

export function useStudioMonthClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const check = () => { const next = Date.now(); setNow(current => shanghaiMonth(current) === shanghaiMonth(next) ? current : next); };
    const visible = () => { if (!document.hidden) check(); };
    const timer = window.setInterval(visible, 60000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return now;
}
