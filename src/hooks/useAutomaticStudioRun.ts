import { useEffect, useRef, useState } from 'react';

export function useAutomaticStudioRun({ enabled, ready, blocked, error, onStart }: { enabled: boolean; ready: boolean; blocked: boolean; error: string; onStart: () => Promise<boolean> }) {
  const [active, setActive] = useState(enabled);
  const attempted = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!enabled || blocked || error) { setActive(false); return; }
    if (!active || !ready || attempted.current) return;
    attempted.current = true;
    void onStart().then(started => { if (!started && mounted.current) setActive(false); }).catch(() => { if (mounted.current) setActive(false); });
  }, [enabled, ready, blocked, error, active, onStart]);
  return active && enabled;
}
