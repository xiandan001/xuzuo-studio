import { useEffect, useRef, useState } from 'react';
import type { ProjectTemplateCreativeSource, ProjectTemplatesBridge, ProjectTemplateSourceInfo } from '../project-template-types';

export function useProjectTemplateSources(bridge: ProjectTemplatesBridge | undefined, workspaceId: string, projectId: string | undefined, sourceArtifactId: string, enabled: boolean) {
  const [sources, setSources] = useState<ProjectTemplateSourceInfo[]>([]), [kind, setKind] = useState<'file' | 'commerce' | 'animation'>('file'), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const touched = useRef(false);
  useEffect(() => {
    let current = true;
    if (!enabled || !projectId || !bridge?.sources) { setSources([]); setLoading(false); return; }
    setLoading(true); setError('');
    void bridge.sources({ workspaceId, sourceProjectId: projectId, ...(sourceArtifactId ? { sourceArtifactId } : {}) }).then(values => {
      if (!current) return; setSources(values); setKind(previous => values.some(source => source.kind === previous) ? previous : touched.current ? 'file' : values[0]?.kind || 'file');
    }).catch(cause => { if (current) { setSources([]); setKind('file'); setError(cause instanceof Error ? cause.message : '可编辑工程暂时无法读取，可继续使用图片文件。'); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [bridge, workspaceId, projectId, sourceArtifactId, enabled]);
  const selected = sources.find(source => source.kind === kind);
  const creativeSource: ProjectTemplateCreativeSource | undefined = selected?.kind === 'commerce' ? { kind: 'commerce', ...(selected.documentId ? { documentId: selected.documentId } : {}) } : selected?.kind === 'animation' ? { kind: 'animation' } : undefined;
  return { sources, kind, creativeSource, loading, error, choose: (value: 'file' | 'commerce' | 'animation') => { touched.current = true; setKind(value); } };
}
