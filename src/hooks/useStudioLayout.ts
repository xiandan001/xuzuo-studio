import { useCallback, useEffect, useState } from 'react';
import { useAppearance } from './useAppearance';
import { useRememberedBoolean } from './useRememberedBoolean';
import { useRememberedString } from './useRememberedString';
import { migrateStudioPreferences, readStudioLayout, studioPreferenceKey } from '../lib/studio-layout-state';
import type { StudioIdentity } from '../lib/studio-layout-state';
import { STUDIO_TOOLS } from '../lib/studio-commands';
import type { StudioTool } from '../lib/studio-commands';

export function useStudioLayout(scope: string, identity: StudioIdentity) {
  const { layout } = useAppearance();
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 1280px)').matches || false));
  const [defaults] = useState(() => ({ leftOpen: !narrow, rightOpen: layout === 'professional' }));
  const initial = readStudioLayout(scope, identity, defaults);
  const key = (name: string) => studioPreferenceKey(scope, identity, name);
  const [leftOpen, setLeftOpen] = useRememberedBoolean(key('navigation'), initial.leftOpen);
  const [rightOpen, setRightOpen] = useRememberedBoolean(key('panel-open'), initial.rightOpen);
  const [focus, setFocus] = useRememberedBoolean(key('focus'), initial.focus);
  const [storedTool, setStoredTool] = useRememberedString(key('tool'), initial.tool);
  const tool: StudioTool = STUDIO_TOOLS.includes(storedTool as StudioTool) ? storedTool as StudioTool : 'ai';
  const { workspaceId, projectId } = identity;
  const rememberKey = useCallback((legacyKey: string) => studioPreferenceKey(scope, { workspaceId, projectId }, `section:${legacyKey}`), [scope, workspaceId, projectId]);
  useEffect(() => { migrateStudioPreferences(scope, { workspaceId, projectId }, defaults); }, [scope, workspaceId, projectId, defaults]);
  const openPanel = useCallback((next: StudioTool) => { setStoredTool(next); setRightOpen(true); setFocus(false); }, [setStoredTool, setRightOpen, setFocus]);
  const togglePanel = useCallback((next: StudioTool) => { if (next === tool && rightOpen && !focus) setRightOpen(false); else openPanel(next); }, [tool, rightOpen, focus, openPanel, setRightOpen]);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1280px)');
    if (!media) return;
    const change = () => setNarrow(media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return { tool, leftOpen, rightOpen, focus, narrow, rememberKey, openPanel, togglePanel, closePanel: () => setRightOpen(false), toggleLeft: () => setLeftOpen(value => !value), toggleFocus: () => setFocus(value => !value) };
}
