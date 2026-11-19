import { useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, WandSparkles } from 'lucide-react';
import type { WorkflowRun } from '../configuration-types';
import type { Project, PageProps } from '../types';
import { hasLegacyCoverAspectReview, qualityRepairSource, recoverableQualityAttempt } from '../lib/workflow-review';
import { coverCreativeText, isRedPacketCoverWorkflow } from '../lib/wechat-red-packet-cover';
import { readProductionPreferences, rememberProductionBinding } from '../lib/natural-model-bindings';
import { workflowPublicError } from '../lib/studio-run';
import { NaturalAutomationModels, naturalModelSelection, type NaturalBinding } from './NaturalAutomationModels';

export function HomeQualityRecovery({ run, project, props, onRead }: { run: WorkflowRun; project: Project; props: PageProps; onRead: (value: WorkflowRun) => void }) {
  const step = run.snapshot.steps[run.stepIndex], attempt = recoverableQualityAttempt(run);
  const verdict = run.qualityReviews?.filter(item => item.attemptId === attempt?.id).at(-1);
  const cover = isRedPacketCoverWorkflow(run.snapshot, project.id), source = verdict && qualityRepairSource(run);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [instruction, setInstruction] = useState(() => {
    const notes = (verdict?.issues || []).map(item => cover ? coverCreativeText(item) : item).filter(Boolean).join('\n');
    if (cover) {
      const objective = coverCreativeText(run.snapshot.goalBrief?.objective || run.input || '').split('\n').find(line => line.trim());
      return [objective && objective.length <= 400 ? '保留已确认的创作方向：' + objective : '保留原方案中的角色、动作、题字和配色。',
        '移除画面中绘入的金色“开”按钮、头像昵称及系统界面元素，交给微信叠加。按 957 × 1278 的上传成品标准重新质检。', notes].filter(Boolean).join('\n');
    }
    return notes || '保留主体和已确认的内容，改善当前样稿的构图与细节。';
  });
  const [review, setReview] = useState<NaturalBinding>({ modelConfigId: step.modelConfigId, credentialId: step.credentialId, reasoningEffort: step.reasoningEffort });
  const [edit, setEdit] = useState<NaturalBinding>(() => {
    const prior = run.snapshot.steps.slice(0, run.stepIndex).filter(item => item.enabled && item.kind === 'image-editing').at(-1);
    if (prior?.modelConfigId) return { modelConfigId: prior.modelConfigId, credentialId: prior.credentialId };
    try { return readProductionPreferences(props.workspaceId, localStorage)['image-editing'] || {}; } catch { return {}; }
  });
  const reviewKind = step.kind === 'vision' ? 'vision' : 'text';
  const reviewer = naturalModelSelection(props.configuration, reviewKind, review), editor = naturalModelSelection(props.configuration, 'image-editing', edit);
  const ready = !!reviewer.model && !!reviewer.credentialId, pending = useRef(false);
  if (!attempt || run.contentTruncated || run.referenceIssue || run.hiddenAt || run.trashedAt || run.supersededByRunId) return null;
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.runtime, read = bridge?.runDetail || props.workflowRunner.loadRunDetail;
  async function recover(refine: boolean) {
    if (pending.current || !bridge || !attempt || !reviewer.model || !reviewer.credentialId) return;
    if (refine && (!source || !editor.model || !editor.credentialId || !instruction.trim())) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await bridge.control({ id: run.id, action: refine ? 'refine-quality' : 'recheck-quality', reviewAttemptId: attempt.id,
        reviewBinding: { modelConfigId: reviewer.model.id, credentialId: reviewer.credentialId },
        ...(refine && source && editor.model && editor.credentialId ? { refinement: { sourceArtifactId: source.file.id, instruction: instruction.trim(), modelConfigId: editor.model.id, credentialId: editor.credentialId } } : {}),
        project, models: props.configuration.models, connections: props.configuration.connections });
      if (read) onRead(await read(run.id));
    } catch (cause) {
      setError(workflowPublicError(cause, '暂未确认新尝试，请重新读取任务状态。'));
      try { if (read) onRead(await read(run.id)); } catch { /* The task card still links to the saved run. */ }
    } finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="处理质检未通过" className="home-result-recovery">
    <p>{cover && '红包源图约为 3:4，上传成品为 957 × 1278 JPG。'}{hasLegacyCoverAspectReview(run) && '保留角色动作和题字；若画面里已绘入金色“开”按钮，请移除并让微信叠加。'}重检当前样稿按实际用量计费，通过后继续原流程。</p>
    <button type="button" className="btn btn-primary" disabled={!bridge || busy || !ready} onClick={() => { void recover(false); }}><RefreshCw size={14} />按当前标准重新质检</button>
    {source && <button type="button" className="btn btn-secondary" aria-expanded={editing} disabled={busy} onClick={() => setEditing(open => !open)}><WandSparkles size={14} />按建议精修</button>}
    <details open={!ready || undefined}><summary>质检模型与账户</summary>
      <NaturalAutomationModels configuration={props.configuration} capability={reviewKind} value={review} disabled={busy} onChange={value => { setReview(value); rememberProductionBinding(props.workspaceId, reviewKind, value); }} />
    </details>
    {editing && source && <div className="natural-model-list">
      <label>修改要求<textarea className="field" rows={3} maxLength={10000} value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
      <NaturalAutomationModels configuration={props.configuration} capability="image-editing" value={edit} disabled={busy} onChange={value => { setEdit(value); rememberProductionBinding(props.workspaceId, 'image-editing', value); }} />
      <p>将精修当前样稿一次，再检查新版本。两次模型调用分别计费，原图和历史费用保留。</p>
      <button type="button" className="btn btn-primary" disabled={!bridge || busy || !ready || !editor.model || !editor.credentialId || !instruction.trim()} onClick={() => { void recover(true); }}>{busy ? <LoaderCircle size={14} className="spin" /> : <WandSparkles size={14} />}开始精修并重新质检</button>
    </div>}
    {error && <p role="alert" className="home-plan-error">{error}</p>}
  </section>;
}
