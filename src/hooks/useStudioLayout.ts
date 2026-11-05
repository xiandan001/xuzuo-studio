import { useCallback, useEffect, useState } from 'react';
import { useAppearance } from './useAppearance';
import { useRememberedBoolean } from './useRememberedBoolean';
import { useRememberedString } from './useRememberedString';
import { readDisclosure } from '../lib/disclosure-state';
import { STUDIO_TOOLS } from '../lib/studio-commands';
import type { StudioTool } from '../lib/studio-commands';

export function useStudioLayout(scope = 'documents') {
  const { layout } = useAppearance();
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 1280px)').matches || false));
  const [initial] = useState(() => ({ left: readDisclosure(`${scope}:files-visible`, !narrow), right: readDisclosure(`${scope}:tools-visible`, layout === 'professional') }));
  const [leftOpen, setLeftOpen] = useRememberedBoolean(`studio:${scope}:navigation`, initial.left);
  const [rightOpen, setRightOpen] = useRememberedBoolean(`studio:${scope}:panel-open`, initial.right);
  const [focus, setFocus] = useRememberedBoolean(`studio:${scope}:focus`, false);
  const [storedTool, setStoredTool] = useRememberedString(`studio:${scope}:tool`, 'ai');
  const tool: StudioTool = STUDIO_TOOLS.includes(storedTool as StudioTool) ? storedTool as StudioTool : 'ai';
  const openPanel = useCallback((next: StudioTool) => { setStoredTool(next); setRightOpen(true); setFocus(false); }, [setStoredTool, setRightOpen, setFocus]);
  const togglePanel = useCallback((next: StudioTool) => { if (next === tool && rightOpen && !focus) setRightOpen(false); else openPanel(next); }, [tool, rightOpen, focus, openPanel, setRightOpen]);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1280px)');
    if (!media) return;
    const change = () => setNarrow(media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return { tool, leftOpen, rightOpen, focus, narrow, openPanel, togglePanel, closePanel: () => setRightOpen(false), toggleLeft: () => setLeftOpen(value => !value), toggleFocus: () => setFocus(value => !value) };
}
