import { useEffect, useRef, useState } from 'react';
import type { StudioAsset } from '../asset-types';
import { workflowPublicError } from '../lib/studio-run';

export function useGlobalAssetSearch(workspaceId: string, query: string, limit: number) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.assets;
  const desired = useRef({ workspaceId, query, limit, bridge }); desired.current = { workspaceId, query, limit, bridge };
  const mounted = useRef(false), pending = useRef(false), lastStarted = useRef(''), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<{ key: string; items: StudioAsset[]; total: number; error: string; loading: boolean }>({ key: '', items: [], total: 0, error: '', loading: false });
  const key = `${workspaceId}\0${query}\0${limit}`;
  const currentKey = () => `${desired.current.workspaceId}\0${desired.current.query}\0${desired.current.limit}`;
  function schedule() { clearTimeout(timer.current); timer.current = setTimeout(() => { void read(); }, 180); }
  async function read() {
    const request = desired.current, identity = currentKey();
    if (!mounted.current || pending.current || !request.bridge?.search || lastStarted.current === identity) return;
    pending.current = true; lastStarted.current = identity;
    setState({ key: identity, items: [], total: 0, loading: true, error: '' });
    try {
      const result = await request.bridge.search({ workspaceId: request.workspaceId, query: request.query, limit: request.limit });
      if (mounted.current && currentKey() === identity) setState({ key: identity, items: result.items.filter(item => item.workspaceId === request.workspaceId && !item.archivedAt), total: result.total, error: '', loading: false });
    } catch (cause) { if (mounted.current && currentKey() === identity) setState({ key: identity, items: [], total: 0, error: workflowPublicError(cause, '我的素材索引暂时无法读取，其他搜索结果仍可使用。'), loading: false }); }
    finally { pending.current = false; if (mounted.current && currentKey() !== identity) schedule(); }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { schedule(); return () => clearTimeout(timer.current); }, [workspaceId, query, limit, bridge]);
  return { supported: !!bridge?.search, items: state.key === key ? state.items : [], total: state.key === key ? state.total : 0, loading: !!bridge?.search && (state.key !== key || state.loading), error: state.key === key ? state.error : '', retry: () => { lastStarted.current = ''; schedule(); } };
}
