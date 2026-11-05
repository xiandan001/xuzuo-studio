import { RememberedDetails } from './RememberedDetails';
import { useEffect, useRef, useState } from 'react';
import { Image, ImagePlus, RefreshCw, Sparkles } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowDefinition } from '../configuration-types';
import type { DocumentImageTarget } from '../lib/document-image-edit';
import { documentImageModels } from '../lib/document-illustrations';
import { DOCUMENT_IMAGE_SIZES, documentImageSizePrompt } from '../lib/document-image-size';
import type { ImageDimensions } from '../lib/document-image-size';
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
  const [size, setSize] = useState('auto'), [dimensions, setDimensions] = useState<ImageDimensions>();
  const [readFailed, setReadFailed] = useState(false), [readVersion, setReadVersion] = useState(0), [reading, setReading] = useState(false);
  const seen = useRef(''), mounted = useRef(true), starting = useRef(false), startRequest = useRef(0), operation = useRef(0);
  const thumbnailReader = useRef(props.workflowRunner.thumbnailArtifact); thumbnailReader.current = props.workflowRunner.thumbnailArtifact;
  const projectId = props.activeProject.id, prefix = `document-image-edit-${projectId}-`, scope = `${props.workspaceId}/${projectId}/${target.id}/${target.imageId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const models = documentImageModels(props.configuration, 'image-editing'), model = studioModel(models, modelId);
  const credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId);
  const credentialId = studioCredential(credentials, model?.connectionId, keyId);
  const latest = props.workflowRunner.runs.find(run => run.mode === 'live' && run.workspaceId === props.workspaceId && run.projectId === projectId && (workflowId ? run.workflowId === workflowId : run.workflowId.startsWith(prefix)));
  const active = props.workflowRunner.runs.some(run => run.workspaceId === props.workspaceId && run.projectId === projectId && ['running', 'paused'].includes(run.status));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);
  useEffect(() => { operation.current++; startRequest.current = operation.current; starting.current = false; setPending(false); setError(''); setResult(undefined); setWorkflowId(''); setReadFailed(false); setReading(false); setSize('auto'); seen.current = ''; }, [scope]);
  useEffect(() => { setKeyId(''); }, [scope, model?.id]);
  useEffect(() => { setConfirmed(false); setError(''); }, [scope, model?.id, credentialId, instruction, size]);
  useEffect(() => {
    setDimensions(undefined);
    let disposed = false;
    if (thumbnailReader.current) {
      void thumbnailReader.current(target.imageId).then(image => {
        const width = image.originalWidth, height = image.originalHeight;
        if (!disposed && typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) setDimensions({ width, height });
      }).catch(() => { /* Dimensions are optional; the actual source image still defines the edit ratio. */ });
      return () => { disposed = true; };
    }
    if (!preview) return;
    const image = new window.Image();
    image.onload = () => { if (!disposed && image.naturalWidth && image.naturalHeight) setDimensions({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.src = preview; return () => { disposed = true; image.onload = null; };
  }, [preview, scope]);
  useEffect(() => {
    if (!latest || !['complete', 'failed', 'cancelled', 'interrupted', 'paused'].includes(latest.status)) return;
    setPending(false);
    if (latest.status !== 'complete' || seen.current === latest.id) return;
    let disposed = false; const identity = scope, request = ++operation.current; seen.current = latest.id; setReading(true); setReadFailed(false);
    const valid = () => !disposed && mounted.current && currentScope.current === identity && operation.current === request;
    void (async () => {
      try {
        const full = latest.contentTruncated && props.workflowRunner.loadRunDetail ? await props.workflowRunner.loadRunDetail(latest.id) : latest;
        const context = JSON.parse(full.input) as ImageEditContext;
        if (context.version !== 1 || context.targetId !== target.id || context.sourceImageId !== target.imageId) return;
        const file = full.attempts.filter(attempt => attempt.status === 'complete').at(-1)?.artifacts?.find(item => item.kind === 'image' && !item.trashedAt && !item.unavailable);
        if (!file || file.projectId !== projectId) throw new Error('未找到本项目的精修图片。原图未更改。');
        const image = await props.workflowRunner.previewArtifact(file.id);
        if (!image.dataUrl?.startsWith('data:image/')) throw new Error('精修结果暂时无法预览，原图未更改。');
        if (valid()) { setResult({ file, preview: image.dataUrl, target: { id: context.targetId, imageId: context.sourceImageId } }); setError(''); }
      } catch (cause) { if (valid()) { setReadFailed(true); setError(workflowPublicError(cause, '精修图片未能读取，原图保留。')); } }
      finally { if (valid()) setReading(false); }
    })();
    return () => { disposed = true; };
  }, [latest?.id, latest?.status, scope, readVersion]);
  async function start() {
    if (disabled || pending || active || starting.current || reading || !model || !credentialId || !instruction.trim()) return;
    if (props.preferences.confirmGeneration && !confirmed) { setConfirmed(true); return; }
    if (!beforeRun()) return;
    const reference = images.find(image => image.id === target.imageId && image.projectId === projectId && !image.trashedAt && !image.unavailable);
    if (!reference) { setError('当前原图不可用，请先从项目图片或本地替换。'); return; }
    const waiting = props.workflowRunner.runs.find(run => run.workspaceId === props.workspaceId && run.projectId === projectId && run.status === 'waiting-review');
    if (waiting && !waiting.workflowId.startsWith(`quick-${projectId}-`)) { setError('自定义流程正等待人工检查，请先在任务中心处理。'); return; }
    const id = `${prefix}${crypto.randomUUID()}`, context: ImageEditContext = { version: 1, targetId: target.id, sourceImageId: target.imageId };
    const workflow: WorkflowDefinition = { id, workspaceId: props.workspaceId, name: '文档插图 · 独立精修', description: '只精修当前插图，预览后手动替换原位置；原图保留。', updatedAt: new Date().toISOString(), outputKind: props.activeProject.kind, steps: [{ id: crypto.randomUUID(), name: '精修所选插图', kind: 'image-editing', inputSource: 'project', enabled: true, prompt: creationPrompt('image', `${instruction}\n${documentImageSizePrompt(size, dimensions)}\n只编辑所附单张插图，不将文档或PPT整体渲染为图片。`, 'image-editing', { hasReferences: true }), modelConfigId: model.id, credentialId, count: 1, imageSize: size, imageBackground: 'auto' }] };
    const identity = scope, request = ++operation.current; starting.current = true; startRequest.current = request;
    setPending(true); setError(''); setResult(undefined); setWorkflowId(id); setConfirmed(false); setReadFailed(false);
    try {
      const started = await props.workflowRunner.startLive(workflow, projectId, JSON.stringify(context), {}, [reference.id], true, waiting?.id);
      if (mounted.current && currentScope.current === identity && operation.current === request && started.status !== 'started') { setPending(false); setError(started.error); }
    } catch (cause) { if (mounted.current && currentScope.current === identity && operation.current === request) { setPending(false); setError(workflowPublicError(cause, '图片精修未开始，原图保留。')); } }
    finally { if (startRequest.current === request) starting.current = false; }
  }
  const running = pending || latest?.status === 'running';
  return <section className="document-image-tools" aria-label="独立编辑文档图片"><header><Image size={18} /><strong>编辑所选插图</strong><span>只替换当前位置，正文与其他图片保留</span></header>
    <label>替换为项目图片<Select disabled={disabled || running} aria-label="替换文档所选图片" value={target.imageId} onValueChange={id => { const file = images.find(item => item.id === id); if (file) { try { onReplace(target, file); setResult(undefined); setError(''); } catch (cause) { setError(workflowPublicError(cause, '图片未替换，原图保留。')); } } }} options={images.map((image, index) => ({ value: image.id, label: `${index + 1} · ${image.name}` }))} /></label>
    <div className="document-image-tools-actions">{onPickAsset && <button className="btn btn-secondary" disabled={disabled || running} onClick={onPickAsset}><Image size={15} />从素材库替换</button>}<button className="btn btn-secondary" disabled={disabled || running} onClick={onImport}><ImagePlus size={15} />从本地替换</button></div>
    <RememberedDetails rememberKey={`project:${projectId}:document-image-refinement`}><summary>用 AI 精修这张图片</summary><p>生成会调用模型并累计费用；重新读取已有结果不调用模型。预览后再决定是否替换，原图与历史版本保留。</p>
      <label>输出比例与尺寸<Select disabled={running || reading} aria-label="文档插图输出尺寸" value={size} onValueChange={setSize} options={DOCUMENT_IMAGE_SIZES} /></label><small>{dimensions ? `原图 ${dimensions.width} × ${dimensions.height}。` : ''}自动尺寸由模型决定，预览时请核对比例；具体支持的尺寸会在执行前检查。</small>
      <label>修改要求<textarea disabled={running} aria-label="文档插图修改要求" value={instruction} maxLength={6000} onChange={event => setInstruction(event.target.value)} /></label><label>图片编辑模型<Select disabled={running} aria-label="文档插图精修模型" value={model?.id || ''} onValueChange={setModelId} options={[{ value: '', label: '请选择图片编辑模型' }, ...models.map(item => ({ value: item.id, label: item.name }))]} /></label>{credentials.length > 1 && <label>调用凭证<Select disabled={running} aria-label="文档插图精修凭证" value={credentialId || ''} onValueChange={setKeyId} options={[{ value: '', label: '请选择该连接的 Key' }, ...credentials.map(item => ({ value: item.id, label: item.name }))]} /></label>}{!model || !credentialId ? <p>请在模型中心配置图片编辑模型与启用的 Key。</p> : null}
      <div className="document-image-tools-actions"><button className="btn btn-primary" disabled={disabled || running || active || reading || !model || !credentialId || !instruction.trim()} onClick={() => { void start(); }}><Sparkles size={15} />{running ? '正在精修…' : confirmed ? '确认开始精修' : '精修当前图片'}</button>{latest && ['failed', 'interrupted', 'cancelled', 'paused'].includes(latest.status) && <button className="btn btn-secondary" onClick={() => props.navigate('activity', projectId)}>查看未完成任务</button>}</div>
    </RememberedDetails>
    {error && <p className="document-image-error" role="alert">{error}</p>}{readFailed && latest?.status === 'complete' && <div className="document-image-tools-actions"><button className="btn btn-secondary" disabled={reading || running} onClick={() => { seen.current = ''; setReadFailed(false); setError(''); setReadVersion(value => value + 1); }}><RefreshCw size={15} />重新读取精修结果</button><small>只读取已保存文件，0 新增模型调用费。</small></div>}{reading && <p role="status">正在读取已保存的精修结果…</p>}
    {result && <><div className="document-image-tools-preview"><div><strong>原图</strong>{preview && result.target.imageId === target.imageId ? <img src={preview} alt="文档插图原图" /> : <span>原图仍保留在项目文件中</span>}</div><div><strong>精修结果 · 尚未替换</strong><img src={result.preview} alt="文档插图精修结果" /></div></div><div className="document-image-tools-actions"><button className="btn btn-primary" disabled={disabled || running || reading} onClick={() => { try { onReplace(result.target, result.file); setResult(undefined); setError(''); } catch (cause) { setError(workflowPublicError(cause, '图片位置已改变，原图未替换。')); } }}>用精修图替换原位置</button><button className="btn btn-secondary" onClick={() => setResult(undefined)}>保留原图</button></div></>}
  </section>;
}
