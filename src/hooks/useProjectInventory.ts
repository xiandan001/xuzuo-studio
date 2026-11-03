import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { workflowPublicError } from '../lib/studio-run';

export function useProjectInventory(projectId: string | undefined, runner: WorkflowRunner) {
  const method = useRef(runner.listProjectArtifacts); method.current = runner.listProjectArtifacts;
  const project = useRef(projectId); project.current = projectId;
  const [files, setFiles] = useState<ArtifactMetadata[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const request = useRef(0), supported = !!runner.listProjectArtifacts;
  const trashSignature = JSON.stringify(runner.trashedArtifacts?.map(item => [item.id, item.trashedAt]));
  const refresh = useCallback(async () => {
    const id = project.current, load = method.current, generation = ++request.current;
    if (!id || !load) return;
    setLoading(true); setError('');
    try { const result = await load(id); if (project.current === id && request.current === generation) setFiles(result.filter(item => item.projectId === id)); }
    catch (cause) { if (project.current === id && request.current === generation) setError(workflowPublicError(cause, '项目文件登记未能读取，原记录与费用保留。')); }
    finally { if (project.current === id && request.current === generation) setLoading(false); }
  }, []);
  useEffect(() => { request.current++; setFiles([]); setError(''); return () => { request.current++; }; }, [projectId]);
  useEffect(() => { if (projectId && supported) void refresh(); }, [projectId, supported, trashSignature, refresh]);
  return { files, error, loading, supported, refresh };
}
