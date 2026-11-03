import { useEffect, useRef, useState } from 'react';
import { Image, ImagePlus, Sparkles } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowDefinition } from '../configuration-types';
import type { DocumentImageTarget } from '../lib/document-image-edit';
import { documentImageModels } from '../lib/document-illustrations';
import { creationPrompt } from '../lib/creation-quality';
import { studioCredential, studioModel, workflowPublicError } from '../lib/studio-run';
import { Select } from './Select';
import './document-illustrations.css';

interface Props { props: PageProps; target: DocumentImageTarget; images: ArtifactMetadata[]; preview?: string; disabled: boolean; beforeRun: () => boolean; onReplace: (target: DocumentImageTarget, image: ArtifactMetadata) => void; onImport: () => void; onPickAsset?: () => void; }
interface ImageEditContext { version: 1; targetId: string; sourceImageId: string; }
interface Result { file: ArtifactMetadata; preview: string; target: DocumentImageTarget; }
export function DocumentImageTools({ props, target, images, preview, disabled, beforeRun, onReplace, onImport, onPickAsset }: Props) {
  const [instruction, setInstruction] = useState('保留主体和画面风格，按我的修改要求优化细节。');
  const [modelId, setModelId] = useState(''), [keyId, setKeyId] = useState(''), [workflowId, setWorkflowId] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Result>(), [confirmed, setConfirmed] = useState(false);
  const seen = useRef(''), mounted = useRef(true);
  const projectId = props.activeProject.id, prefix = `document-image-edit-${projectId}-`;
  const models = documentImageModels(props.configuration, 'image-editing'), model = studioModel(models, modelId);
  const credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId);
  const credentialId = studioCredential(credentials, model?.connectionId, keyId);
  const latest = props.workflowRunner.runs.find(run => run.mode === 'live' && run.projectId === projectId && (workflowId ? run.workflowId === workflowId : run.workflowId.startsWith(prefix)));
  const active = props.workflowRunner.runs.some(run => run.projectId === projectId && ['running', 'paused'].includes(run.status));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setConfirmed(false); setError(''); }, [target.id, target.imageId, model?.id, credentialId, instruction]);
  useEffect(() => {
    if (!latest || !['complete', 'failed', 'cancelled', 'interrupted', 'paused'].includes(latest.status)) return;
    setPending(false);
    if (latest.status !== 'complete' || seen.current === latest.id) return;
    let disposed = false; seen.current = latest.id;
    void (async () => {
      try {
        const full = latest.contentTruncated && props.workflowRunner.loadRunDetail ? await props.workflowRunner.loadRunDetail(latest.id) : latest;
        const context = JSON.parse(full.input) as ImageEditContext;
        if (context.version !== 1 || typeof context.targetId !== 'string' || typeof context.sourceImageId !== 'string') throw new Error('本次图片精修缺少原图位置，结果文件仍已保存。');
        const file = full.attempts.filter(attempt => attempt.status === 'complete').at(-1)?.artifacts?.find(item => item.kind === 'image' && !item.trashedAt && !item.unavailable);
        if (!file || file.projectId !== projectId) throw new Error('未找到本项目的精修图片。原图未更改。');
        const image = await props.workflowRunner.previewArtifact(file.id);
        if (!image.dataUrl?.startsWith('data:image/')) throw new Error('精修结果暂时无法预览，原图未更改，可到项目文件查看。');
        if (!disposed) setResult({ file, preview: image.dataUrl, target: { id: context.targetId, imageId: context.sourceImageId } });
      } catch (cause) { if (!disposed) setError(workflowPublicError(cause, '精修图片未能读取，原图保留。')); }
    })();
    return () => { disposed = true; };
  }, [latest?.id, latest?.status]);
  async function start() {
    if (disabled || pending || active || !model || !credentialId || !instruction.trim()) return;
    if (props.preferences.confirmGeneration && !confirmed) { setConfirmed(true); return; }
    if (!beforeRun()) return;
    const reference = images.find(image => image.id === target.imageId && image.projectId === projectId && !image.trashedAt && !image.unavailable);
    if (!reference) { setError('当前原图不可用，请先从项目图片或本地替换。'); return; }
    const waiting = props.workflowRunner.runs.find(run => run.projectId === projectId && run.status === 'waiting-review');
    if (waiting && !waiting.workflowId.startsWith(`quick-${projectId}-`)) { setError('自定义流程正等待人工检查，请先在任务中心处理。'); return; }
    const id = `${prefix}${crypto.randomUUID()}`, context: ImageEditContext = { version: 1, targetId: target.id, sourceImageId: target.imageId };
    const workflow: WorkflowDefinition = { id, workspaceId: props.workspaceId, name: '文档插图 · 独立精修', description: '只精修当前插图，预览后手动替换原位置；原图保留。', updatedAt: new Date().toISOString(), outputKind: props.activeProject.kind, steps: [{ id: crypto.randomUUID(), name: '精修所选插图', kind: 'image-editing', inputSource: 'project', enabled: true, prompt: creationPrompt('image', `${instruction}\n只编辑所附单张插图，不将文档或PPT整体渲染为图片。`, 'image-editing', { hasReferences: true }), modelConfigId: model.id, credentialId, count: 1, imageSize: '1024x1024', imageBackground: 'auto' }] };
    setPending(true); setError(''); setResult(undefined); setWorkflowId(id); setConfirmed(false);
    try {
      const started = await props.workflowRunner.startLive(workflow, projectId, JSON.stringify(context), {}, [reference.id], true, waiting?.id);
      if (mounted.current && !started) { setPending(false); setError('图片精修未开始，请检查模型和凭证或查看提示。'); }
    } catch (cause) { if (mounted.current) { setPending(false); setError(workflowPublicError(cause, '图片精修未开始，原图保留。')); } }
  }
  const running = pending || latest?.status === 'running';
  return <section className="document-image-tools" aria-label="独立编辑文档图片"><header><Image size={18} /><strong>编辑所选插图</strong><span>只替换当前位置，正文与其他图片保留</span></header>
    <label>替换为项目图片<Select disabled={disabled || running} aria-label="替换文档所选图片" value={target.imageId} onValueChange={id => { const file = images.find(item => item.id === id); if (file) { try { onReplace(target, file); setResult(undefined); setError(''); } catch (cause) { setError(workflowPublicError(cause, '图片未替换，原图保留。')); } } }} options={images.map((image, index) => ({ value: image.id, label: `${index + 1} · ${image.name}` }))} /></label>
    <div className="document-image-tools-actions">{onPickAsset && <button className="btn btn-secondary" disabled={disabled || running} onClick={onPickAsset}><Image size={15} />从素材库替换</button>}<button className="btn btn-secondary" disabled={disabled || running} onClick={onImport}><ImagePlus size={15} />从本地替换</button></div>
    <details><summary>用 AI 精修这张图片</summary><p>会调用图片编辑模型并记录本次花费。完成后先看预览，再决定是否替换；原图和已保存版本保留。</p><label>修改要求<textarea aria-label="文档插图修改要求" value={instruction} maxLength={6000} onChange={event => setInstruction(event.target.value)} /></label><label>图片编辑模型<Select aria-label="文档插图精修模型" value={model?.id || ''} onValueChange={setModelId} options={[{ value: '', label: '请选择图片编辑模型' }, ...models.map(item => ({ value: item.id, label: item.name }))]} /></label>{credentials.length > 1 && <label>调用凭证<Select aria-label="文档插图精修凭证" value={credentialId || ''} onValueChange={setKeyId} options={[{ value: '', label: '请选择该连接的 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name }))]} /></label>}{!model || !credentialId ? <p>请在模型中心配置图片编辑模型与启用的 Key。</p> : null}<div className="document-image-tools-actions"><button className="btn btn-primary" disabled={disabled || running || active || !model || !credentialId || !instruction.trim()} onClick={() => { void start(); }}><Sparkles size={15} />{running ? '正在精修…' : confirmed ? '确认开始精修' : '精修当前图片'}</button>{latest && ['failed', 'interrupted', 'cancelled', 'paused'].includes(latest.status) && <button className="btn btn-secondary" onClick={() => props.navigate('activity', projectId)}>查看未完成任务</button>}</div></details>
    {error && <p className="document-image-error" role="alert">{error}</p>}{result && <><div className="document-image-tools-preview"><div><strong>原图</strong>{preview && result.target.imageId === target.imageId ? <img src={preview} alt="文档插图原图" /> : <span>原图仍保留在项目文件中</span>}</div><div><strong>精修结果 · 尚未替换</strong><img src={result.preview} alt="文档插图精修结果" /></div></div><div className="document-image-tools-actions"><button className="btn btn-primary" disabled={disabled || running} onClick={() => { try { onReplace(result.target, result.file); setResult(undefined); setError(''); } catch (cause) { setError(workflowPublicError(cause, '图片位置已改变，原图未替换。')); } }}>用精修图替换原位置</button><button className="btn btn-secondary" onClick={() => setResult(undefined)}>保留原图</button></div></>}
  </section>;
}
