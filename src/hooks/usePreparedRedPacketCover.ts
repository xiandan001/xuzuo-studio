import { useEffect, useRef, useState } from 'react';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, PreparedRedPacketCover } from '../live-types';

export function usePreparedRedPacketCover(runner: WorkflowRunner, projectId: string, source?: ArtifactMetadata) {
  const api = useRef(runner);
  api.current = runner;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; file?: PreparedRedPacketCover; error?: string }>();
  const id = source?.id, available = !!runner.prepareRedPacketCover;
  const key = JSON.stringify([projectId, id, source?.bytes, source?.createdAt, attempt, available]);
  useEffect(() => {
    let current = true;
    if (id && available) {
      void api.current.prepareRedPacketCover!({ projectId, sourceArtifactId: id }).then(file => {
        if (current) setResult({ key, file });
      }).catch(error => {
        if (current) setResult({ key, error: error instanceof Error ? error.message : '封面准备失败，请重试。' });
      });
    } else setResult(undefined);
    return () => { current = false; };
  }, [key, projectId, id, available]);
  const active = result?.key === key ? result : undefined;
  return { file: active?.file, error: id && !available ? '请在新版桌面应用中准备上传封面。' : active?.error, retry: () => setAttempt(value => value + 1) };
}
