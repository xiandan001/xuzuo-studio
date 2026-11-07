import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { BeadSettings, BeadSourcePreview } from '../bead-types';
import type { WorkflowRun } from '../configuration-types';
import { beadPreparationPrompt } from '../lib/bead-image';
import { latestStudioBinding, readStudioCredentialPreference, saveStudioCredentialPreference, studioCredentialChoice, studioProjectCredential, studioProjectModel } from '../lib/studio-project-bindings';
import { RASTER_IMAGE_TYPES } from '../lib/image-output-options';
import { RememberedDetails } from './RememberedDetails';
import { Select } from './Select';

interface Pending { nonce: string; projectId: string; sourceId: string; sourceSha256: string; context: string; columns: number; rows: number; }
export function BeadAIPreparation({ props, project, source, settings, context, disabled, onUse }: { props: PageProps; project: Project; source?: BeadSourcePreview; settings: BeadSettings; context: string; disabled?: boolean; onUse: (artifact: ArtifactMetadata) => void }) {
  const [preferredModel, setPreferredModel] = useState(''), [keyChoice, setKeyChoice] = useState(() => readStudioCredentialPreference(project.id, 'image-editing')), [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState<Pending>(), [result, setResult] = useState<{ artifact: ArtifactMetadata; request: Pending }>(), [notice, setNotice] = useState('');
  const latest = useRef({ pending, projectId: project.id, props }); latest.current = { pending, projectId: project.id, props };
  const reading = useRef(new Set<string>());
  const models = useMemo(() => props.configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes('image-editing') && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo)), [props.configuration.models, props.configuration.connections]);
  const inherited = latestStudioBinding(props.workflowRunner.runs, project.workspaceId, project.id, 'image-editing'), model = studioProjectModel(models, preferredModel, inherited);
  const keys = props.configuration.credentials.filter(key => key.enabled && key.connectionId === model?.connectionId), credentialId = studioProjectCredential(keys, model, keyChoice, inherited);
  function finish(run: WorkflowRun, request: Pending) {
    if (latest.current.projectId !== request.projectId || latest.current.pending?.nonce !== request.nonce) return;
    const step = run.snapshot.steps.find(item => item.beadBaseRequestId === request.nonce);
    const attempt = step && run.attempts.filter(item => item.stepId === step.id && item.status === 'complete').at(-1);
    const artifact = attempt?.artifacts?.find(item => item.projectId === request.projectId && item.kind === 'image' && RASTER_IMAGE_TYPES.has(item.mimeType) && !item.trashedAt && !item.unavailable);
    if (artifact) { latest.current.pending = undefined; setResult({ artifact, request }); setPending(undefined); setNotice('AI 底图已保存。选择后再本地制图，当前手绘网格不会被自动替换。'); }
    else if (['failed', 'interrupted', 'cancelled', 'complete'].includes(run.status)) { latest.current.pending = undefined; setPending(undefined); setNotice('本次 AI 整理没有可用的新底图，原图纸和已发生费用保留，可查看任务记录。'); }
  }
  useEffect(() => {
    if (!pending) return;
    const run = props.workflowRunner.runs.find(item => item.projectId === project.id && item.workspaceId === project.workspaceId && item.mode === 'live' && item.snapshot.steps.some(step => step.beadBaseRequestId === pending.nonce));
    if (!run) return;
    const matchedStep = run.snapshot.steps.find(step => step.beadBaseRequestId === pending.nonce);
    const hasResult = run.attempts.some(attempt => attempt.stepId === matchedStep?.id && attempt.status === 'complete' && attempt.artifacts?.some(file => file.kind === 'image'));
    if (run.contentTruncated && !hasResult && ['waiting-review', 'complete', 'failed', 'interrupted', 'cancelled'].includes(run.status) && props.workflowRunner.loadRunDetail && !reading.current.has(run.id)) {
      reading.current.add(run.id);
      void props.workflowRunner.loadRunDetail(run.id).then(detail => finish(detail, pending), () => { if (latest.current.pending?.nonce === pending.nonce) { setPending(undefined); setNotice('AI 结果暂未读取，请在任务记录中查看已保存产物。'); } });
    } else finish(run, pending);
  }, [pending, props.workflowRunner.runs, props.workflowRunner.loadRunDetail, project.id, project.workspaceId]);
  useEffect(() => () => { latest.current = { ...latest.current, pending: undefined, projectId: '' }; }, []);
  useEffect(() => { setPending(undefined); setResult(undefined); setNotice(''); setPreferredModel(''); setKeyChoice(readStudioCredentialPreference(project.id, 'image-editing')); setInstruction(''); reading.current.clear(); latest.current.pending = undefined; }, [project.id]);
  function start() {
    if (!source || !model || !credentialId || disabled || pending || latest.current.pending) return;
    const request = { nonce: crypto.randomUUID(), projectId: project.id, sourceId: source.referenceId, sourceSha256: source.sourceSha256, context, columns: settings.columns, rows: settings.rows };
    let prompt: string;
    try { prompt = beadPreparationPrompt(settings, instruction); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '请先填写有效格数。'); return; }
    setResult(undefined); setNotice(''); setPending(request); latest.current.pending = request;
    const accepted = props.onGenerate(project.id, 'AI 精修', 1, undefined, { prompt, capability: 'image-editing', attachmentIds: [source.referenceId], modelConfigId: model.id, credentialId, imageOutputFormat: 'png', imageSize: /^gpt-image-/i.test(model.modelId) ? 'auto' : '1024x1024', imageBackground: 'auto', beadBaseRequestId: request.nonce });
    if (accepted !== true) { latest.current.pending = undefined; setPending(undefined); setNotice('AI 任务尚未创建，请按应用提示补齐设置；当前图纸未改动。'); }
  }
  const currentRun = pending && props.workflowRunner.runs.find(run => run.projectId === project.id && run.snapshot.steps.some(step => step.beadBaseRequestId === pending.nonce));
  const changedSinceRequest = result && (result.request.context !== context || result.request.sourceId !== source?.referenceId || result.request.sourceSha256 !== source?.sourceSha256);
  return <RememberedDetails rememberKey={`beads:${project.id}:ai-preparation`} className="bead-ai-preparation"><summary><Sparkles size={15} />AI 整理底图 <small>可选，按用量计费</small></summary><div><p>只整理轮廓与色块，色号和数量仍由本地程序计算。</p><label>图片编辑模型<Select aria-label="拼豆AI编辑模型" value={model?.id || ''} onValueChange={id => { setPreferredModel(id); setKeyChoice(''); }} options={models.map(item => ({ value: item.id, label: item.name, description: item.modelId }))} placeholder="选择图片编辑模型" disabled={disabled || !!pending} /></label><label>调用账户<Select aria-label="拼豆AI调用账户" value={credentialId || ''} onValueChange={id => { const choice = studioCredentialChoice(id, model); setKeyChoice(choice); saveStudioCredentialPreference(project.id, 'image-editing', choice); }} options={keys.map(key => ({ value: key.id, label: key.name }))} placeholder="选择 Key" disabled={disabled || !!pending} /></label><label>补充要求 <small>选填</small><textarea className="field" aria-label="拼豆AI补充要求" rows={2} value={instruction} maxLength={10000} onChange={event => setInstruction(event.target.value)} placeholder="例如：保留人物的红色发饰，背景简化。" /></label><button type="button" className="btn btn-secondary" disabled={disabled || !!pending || !source || !model || !credentialId} onClick={start}>{pending ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}AI 整理底图 · 按用量计费</button>{(!model || !credentialId) && <button type="button" className="ig-link" onClick={() => props.navigate('models')}>配置图片编辑模型与账户</button>}{pending && <button type="button" className="ig-link" onClick={() => { if (currentRun && ['running', 'paused'].includes(currentRun.status)) props.workflowRunner.cancel(currentRun.id); latest.current.pending = undefined; setPending(undefined); setNotice('已停止等待，已发生的调用费用不会回退。'); }}>停止本次等待</button>}{notice && <p role="status">{notice}</p>}{result && <div className="bead-ai-result"><strong>{result.artifact.name}</strong><p>{changedSinceRequest ? '你已继续编辑，当前网格不会被覆盖。' : `按当时 ${result.request.columns} × ${result.request.rows} 的目标整理。`}</p><button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => { onUse(result.artifact); setResult(undefined); }}>采用为下次制图底图</button></div>}</div></RememberedDetails>;
}
