import { useEffect, useRef } from 'react';
import { STUDIO_TOOL_EVENT, studioToolRequest } from '../lib/studio-commands';
import type { StudioTool } from '../lib/studio-commands';

export function useStudioToolRequests(workspaceId: string, projectId: string, onTool: (tool: StudioTool) => void) {
  const current = useRef({ workspaceId, projectId, onTool }); current.current = { workspaceId, projectId, onTool };
  useEffect(() => {
    const open = (event: Event) => { const value = current.current, tool = studioToolRequest((event as CustomEvent).detail, value.workspaceId, value.projectId); if (tool) value.onTool(tool); };
    window.addEventListener(STUDIO_TOOL_EVENT, open);
    return () => window.removeEventListener(STUDIO_TOOL_EVENT, open);
  }, []);
}
