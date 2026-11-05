import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { workflowPublicError } from '../lib/studio-run';

export function useProjectInventory(projectId: string | undefined, runner: WorkflowRunner) {
  const method = useRef(runner.listProjectArtifacts); method.current = runner.listProjectArtifacts;
  const project = useRef(projectId); project.current = projectId;
  const [files, setFiles] = useState<ArtifactMetadata[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const request = useRef(0), supported = !!runner.listProjectArtifacts;
  const fileSignature = useMemo(() => !supported ? '' : JSON.stringify([runner.runs.filter(run => run.projectId === projectId).flatMap(run => run.attempts.flatMap(attempt => (attempt.artifacts || []).map(item => [item.id, item.path, item.bytes, item.trashedAt, item.unavailable]))), runner.trashedArtifacts?.filter(item => item.projectId === projectId).map(item => [item.id, item.trashedAt])]), [projectId, supported, runner.runs, runner.trashedArtifacts]);
  const loadFiles = useCallback(async (force = false) => {
    const id = project.current, load = method.current, generation = ++request.current;
    if (!id || !load) return;
    setLoading(true); setError('');
    try { const result = await load(id, { refresh: force }); if (project.current === id && request.current === generation) setFiles(previous => { const next = result.filter(item => item.projectId === id); return JSON.stringify(previous) === JSON.stringify(next) ? previous : next; }); }
    catch (cause) { if (project.current === id && request.current === generation) setError(workflowPublicError(cause, '项目文件登记未能读取，原记录与费用保留。')); }
    finally { if (project.current === id && request.current === generation) setLoading(false); }
  }, []);
  const refresh = useCallback(() => loadFiles(true), [loadFiles]);
  useEffect(() => { request.current++; setFiles([]); setError(''); return () => { request.current++; }; }, [projectId]);
  useEffect(() => { if (projectId && supported) void loadFiles(); }, [projectId, supported, fileSignature, runner.inventoryRevision, loadFiles]);
  useEffect(() => { const focus = () => { if (project.current && supported) void loadFiles(true); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [supported, loadFiles]);
  return { files, error, loading, supported, refresh };
}
