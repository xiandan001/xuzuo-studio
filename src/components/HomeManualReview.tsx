import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { WorkflowRun } from '../configuration-types';
import { workflowPublicError } from '../lib/studio-run';
import type { PageProps, Project } from '../types';

export function HomeManualReview({ run, attemptId, artifactId, ready, project, props, onRead }: {
  run: WorkflowRun;
  attemptId: string;
  artifactId: string;
  ready: boolean;
  project: Project;
  props: PageProps;
  onRead: (run: WorkflowRun) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function approve() {
    if (!ready || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const bridge = window.desktop?.runtime, read = bridge?.runDetail || props.workflowRunner.loadRunDetail;
    try {
      if (!bridge || !read) throw Error('请在新版桌面应用中确认验收。');
      await bridge.control({ id: run.id, action: 'resume', manualReviewAttemptId: attemptId, reviewedArtifactId: artifactId, project,
        connections: props.configuration.connections, models: props.configuration.models });
      const fresh = await read(run.id);
      if (active.current && fresh.id === run.id && fresh.projectId === project.id && fresh.workspaceId === props.workspaceId) onRead(fresh);
    } catch (cause) {
      if (active.current) setError(workflowPublicError(cause, '验收尚未确认，请重新读取任务状态。'));
    } finally {
      pending.current = false; if (active.current) setBusy(false);
    }
  }

  return <div className="home-inline-review">
    <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => { void approve(); }}>
      {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}确认验收
    </button>
    {error && <p className="home-plan-error" role="alert">{error}</p>}
  </div>;
}
