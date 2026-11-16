import { useEffect, useRef, useState } from 'react';
import type { PageProps } from '../types';
import type { ChatTarget } from '../chat-types';
import type { NaturalBinding } from '../components/NaturalAutomationModels';
import { naturalModelSelection } from '../components/NaturalAutomationModels';
import { artifactRefinementWorkflow } from '../lib/artifact-refinement';
import { prepareAnimationReference } from '../lib/generated-animation-reference';
import { prepareSvgReference } from '../lib/svg-reference';

interface PendingRefinement { target: ChatTarget; instruction: string; workflowId?: string; runId?: string; }

export function useChatRefinement(props: PageProps, conversationId: string, onLinked: () => void) {
  const key = `xuzuo-chat-refinement-pending-v1:${props.workspaceId}:${conversationId}`;
  const [unknown, setUnknown] = useState<PendingRefinement | undefined>(() => {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value?.target?.projectId && value.target.artifactId && /^[a-f0-9]{64}$/.test(value.target.sha256) && typeof value.instruction === 'string' ? value : undefined; } catch { return undefined; }
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState(() => unknown ? '上次提交结果尚未确认，请先读取任务状态；不会自动重发。' : '');
  const pending = useRef(false), context = useRef({ props, conversationId, onLinked }); context.current = { props, conversationId, onLinked };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function link(target: ChatTarget, instruction: string, runId: string) { await window.desktop!.chat!.linkProduction({ workspaceId: props.workspaceId, conversationId, target, instruction, runId }); localStorage.removeItem(key); if (alive.current) { setUnknown(undefined); context.current.onLinked(); } }
  async function start(target: ChatTarget, instruction: string, binding: NaturalBinding) {
    if (pending.current || unknown) return false;
    const requestedScope = `${props.workspaceId}/${conversationId}`, valid = () => alive.current && requestedScope === `${context.current.props.workspaceId}/${context.current.conversationId}`;
    pending.current = true; setBusy(true); setError('');
    try {
      const project = props.projects.find(project => project.id === target.projectId && project.workspaceId === props.workspaceId && !project.trashedAt && !project.purgedAt); if (!project) throw Error('原项目暂不可用，请恢复项目后再精修。');
      const inspected = await window.desktop!.chat!.inspectTarget({ workspaceId: props.workspaceId, target }); if (!valid()) return false;
      const selected = naturalModelSelection(props.configuration, target.kind === 'image' ? 'image-editing' : 'text', binding); if (!selected.model || !selected.credentialId) throw Error('先选择精修模型与对应账户。');
      let referenceId: string | undefined, animationPrompt: string | undefined;
      const outputGif = inspected.artifact.mimeType === 'image/gif';
      if (outputGif) { const prepared = await prepareAnimationReference(props.workflowRunner, project.id, target.artifactId); if (prepared.sourceSha256 !== target.sha256) throw Error('原动画已变化，请重新选择。'); referenceId = prepared.reference?.id; animationPrompt = prepared.prompt; }
      if (inspected.artifact.mimeType === 'image/svg+xml') { const prepared = await prepareSvgReference(props.workflowRunner, project.id, target.artifactId); if (prepared.sourceSha256 !== target.sha256) throw Error('原SVG已变化，请重新选择。'); referenceId = prepared.reference?.id; }
      if (!valid()) return false;
      const connection = props.configuration.connections.find(connection => connection.id === selected.model!.connectionId);
      const request = artifactRefinementWorkflow(project, target, inspected, selected.model, selected.credentialId, instruction, { referenceId, outputGif, animationPrompt, reasoningEffort: binding.reasoningEffort, connection });
      const check = await props.workflowRunner.preflight(request.workflow, project.id, request.input, {}, request.attachmentIds); if (!check.ok) throw Error(check.errors.join('\n')); if (!valid()) return false;
      const review = props.workflowRunner.runs.find(run => run.projectId === project.id && run.status === 'waiting-review' && run.attempts.some(attempt => attempt.artifacts?.some(file => file.id === target.artifactId)));
      // Persist before dispatch so remounting the page cannot turn a lost acknowledgement into a second paid request.
      const submitted: PendingRefinement = { target, instruction, workflowId: request.workflow.id };
      localStorage.setItem(key, JSON.stringify(submitted));
      setUnknown(submitted);
      const result = await props.workflowRunner.startLive(request.workflow, project.id, request.input, {}, request.attachmentIds, true, review?.id);
      if (result.status === 'unknown') { if (alive.current) setError('提交结果尚未确认，请读取任务状态；不会自动重发。'); return false; }
      if (result.status !== 'started') { localStorage.removeItem(key); if (alive.current) setUnknown(undefined); throw Error(result.error); }
      const confirmed = { ...submitted, runId: result.runId };
      if (alive.current) setUnknown(confirmed);
      try { localStorage.setItem(key, JSON.stringify(confirmed)); await link(target, instruction, result.runId); }
      catch { if (alive.current) setError('修订任务已启动，关联暂未保存；请读取任务状态，避免重复制作。'); return false; }
      return true;
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '精修未能开始，原稿和已有费用保留。'); return false; }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function readUnknown() {
    if (!unknown || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      let runId = unknown.runId;
      if (!runId) {
        const result = await props.workflowRunner.readStartResult(unknown.target.projectId);
        if (result.status === 'started') runId = result.runId;
        else if (result.status === 'rejected' && ['START_NOT_FOUND', 'NO_PENDING_START'].includes(result.code || '')) {
          const snapshot = await window.desktop!.runtime!.snapshot();
          runId = snapshot.runs.find(run => run.workflowId === unknown.workflowId && run.workspaceId === props.workspaceId && run.projectId === unknown.target.projectId)?.id;
          if (!runId) { localStorage.removeItem(key); if (alive.current) { setUnknown(undefined); setError('已确认没有提交这次修订，可以重新点击开始。'); } return; }
        } else throw Error(result.error);
      }
      await link(unknown.target, unknown.instruction, runId);
      if (alive.current) setError('');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '暂时无法确认提交结果。'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return { busy, error, unknown, start, readUnknown };
}
