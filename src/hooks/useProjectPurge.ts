import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { ProjectPurgeItem, ProjectPurgeRequest, ProjectPurgeResult } from '../project-purge-types';
import { nativeProjectPurgeAudits } from '../lib/project-purge';
import { registerEditorSession } from '../lib/editor-session-guard';
import { workflowPublicError } from '../lib/studio-run';

interface Options { workspaceId: string; onAudits: (projects: Project[]) => void; assertReady: (ids: string[], workspaceId: string, retry?: boolean) => void; }
export function useProjectPurge(options: Options) {
  const bridge = window.desktop?.projectPurge;
  const [loading, setLoading] = useState(!!bridge), [error, setError] = useState(''), [pending, setPending] = useState<ProjectPurgeItem[]>([]), [busy, setBusy] = useState(false);
  const current = useRef(options); current.current = options;
  const mounted = useRef(true), count = useRef(0), epoch = useRef(0);
  const activeIds = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => registerEditorSession({ id: 'project-permanent-delete', projectId: '', label: '正在永久删除项目', getState: () => ({ dirty: false, pending: count.current > 0 }), save: async () => false, exportRecovery: () => false }), []);
  const apply = (items: ProjectPurgeItem[]) => { const audits = nativeProjectPurgeAudits(items); if (audits.length) current.current.onAudits(audits); };
  const refresh = useCallback(async () => {
    const workspaceId = current.current.workspaceId, generation = ++epoch.current;
    if (!bridge) { setLoading(false); return; }
    setLoading(true); setError('');
    try { const items = await bridge.tombstones({ workspaceId }); apply(items); if (mounted.current && generation === epoch.current && current.current.workspaceId === workspaceId) setPending(items.filter(item => item.filesPending || item.retryable)); }
    catch (cause) { if (mounted.current && generation === epoch.current) setError(workflowPublicError(cause, '永久删除状态暂时无法读取，请重新读取后再操作。')); }
    finally { if (mounted.current && generation === epoch.current) setLoading(false); }
  }, [bridge]);
  useEffect(() => { void refresh(); }, [options.workspaceId, refresh]);
  async function execute(request: ProjectPurgeRequest): Promise<ProjectPurgeResult> {
    if (!bridge) throw Error('请在新版桌面应用中永久删除项目。');
    if (request.projectIds.some(id => activeIds.current.has(id))) throw Error('项目正在永久删除，请等待当前操作完成。');
    request.projectIds.forEach(id => activeIds.current.add(id));
    count.current++; setBusy(true);
    try {
      const prior = await bridge.status({ id: request.id, workspaceId: request.workspaceId });
      if (prior && (prior.workspaceId !== request.workspaceId || prior.deleteFiles !== request.deleteFiles || prior.projectIds.length !== request.projectIds.length || prior.projectIds.some(id => !request.projectIds.includes(id)))) throw Error('原删除请求的范围已固定，请重新读取状态。');
      current.current.assertReady(request.projectIds, request.workspaceId, !!prior);
      let result: ProjectPurgeResult;
      try { result = await bridge.execute(request); }
      catch (cause) { const saved = await bridge.status({ id: request.id, workspaceId: request.workspaceId }).catch(() => null); if (!saved) throw cause; result = saved; }
      if (result.workspaceId !== request.workspaceId || result.id !== request.id) throw Error('删除结果归属不匹配，未修改当前项目列表。');
      apply(result.items);
      if (mounted.current && current.current.workspaceId === request.workspaceId) await refresh();
      return result;
    } finally { request.projectIds.forEach(id => activeIds.current.delete(id)); count.current--; if (mounted.current) setBusy(count.current > 0); }
  }
  async function retry(requestId: string) {
    if (!bridge) throw Error('请在新版桌面应用中继续清理。');
    const workspaceId = current.current.workspaceId, prior = await bridge.status({ id: requestId, workspaceId });
    if (!prior || prior.workspaceId !== workspaceId) throw Error('未找到当前工作区的删除回执，请重新读取状态。');
    return execute({ id: prior.id, workspaceId, projectIds: prior.projectIds, deleteFiles: prior.deleteFiles, selectionId: '' });
  }
  return { loading, error, pending, busy, busyRef: count, activeIds, refresh, execute, retry };
}
