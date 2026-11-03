import { useEffect, useState } from 'react';
import { useAppearance } from './useAppearance';

export function useStudioLayout() {
  const { layout } = useAppearance();
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 1280px)').matches || false));
  const [fileChoice, setFileChoice] = useState<boolean>();
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1280px)');
    if (!media) return;
    const change = () => setNarrow(media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const filesVisible = fileChoice ?? !narrow;
  return { professional: layout === 'professional', filesVisible, toggleFiles: () => setFileChoice(!filesVisible), closeNarrowFiles: () => { if (narrow) setFileChoice(false); } };
}
