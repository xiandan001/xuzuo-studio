import { useEffect, useState } from 'react';
import type { GenerationIntent, WorkflowDefinition } from '../configuration-types';
import type { PageProps } from '../types';
import { RunWorkflowDialog } from './RunWorkflowDialog';
import { WorkflowEditor } from './WorkflowEditor';
import type { RunContext } from './RunWorkflowDialog';
import './studio-run.css';

export function StudioRunDialog({ props, intent, onClose }: { props: PageProps; intent: GenerationIntent; onClose: () => void }) {
  const [editing, setEditing] = useState(Boolean(intent.editFirst));
  const [automatic, setAutomatic] = useState(!props.preferences.confirmGeneration && !intent.editFirst);
  const [context, setContext] = useState<RunContext>({ projectId: intent.projectId, input: intent.input, attachmentIds: intent.attachmentIds, mode: 'live', replaceWaitingReviewRunId: intent.replaceWaitingReviewRunId });
  const workflow = props.configuration.workflows.find(item => item.id === intent.workflowId && item.workspaceId === props.workspaceId);
  const project = props.projects.find(item => item.id === intent.projectId);
  const valid = Boolean(workflow && project && project.kind === workflow.outputKind);
  useEffect(() => { if (!valid) { props.notify('关联流程或项目类型已变化，请重新选择功能。', 'error'); onClose(); } }, [valid, props.notify, onClose]);
  if (!workflow || !project || !valid) return null;
  const saveConfiguration = (next: WorkflowDefinition) => { props.configuration.saveWorkflow(next, workflow.id, { silent: true }); };
  if (editing) return <WorkflowEditor props={props} initial={workflow} workflowId={workflow.id} lockedOutputKind={project.kind} initialStepId={context.focusStepId} initialField={context.focusField} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />;
  return <RunWorkflowDialog props={props} workflow={workflow} initial={context} studio autoStart={automatic} onConfigure={saveConfiguration} onClose={onClose} onStarted={onClose} onEdit={next => { setAutomatic(false); setContext(next); setEditing(true); }} />;
}
