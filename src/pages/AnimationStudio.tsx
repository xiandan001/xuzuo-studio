import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, FolderOpen, LoaderCircle, Redo2, RefreshCw, Save, Sparkles, Square, Undo2, WandSparkles } from 'lucide-react';
import type { AnimationBridge, AnimationDocument, AnimationEntry, AnimationMode } from '../animation-types';
import type { PageProps, Project } from '../types';
import { animationStyle, resizeAnimationEntries } from '../lib/animation-document';
import { studioCredential } from '../lib/studio-run';
import { isTextEditingTarget } from '../lib/edit-history';
import { summarizeCosts } from '../lib/cost-display';
import { makeAnimationWorkflow } from '../lib/animation-workflow';
import { Select, isSelectInteraction } from '../components/Select';
import { ImageQuantityField } from '../components/ImageQuantityField';
import { RememberedDetails } from '../components/RememberedDetails';
import { ModalPortal } from '../components/ModalPortal';
import { CostTotal } from '../components/CostAmount';
import { AnimationReferences } from '../components/animation/AnimationReferences';
import { AnimationAdvanced } from '../components/animation/AnimationAdvanced';
import { AnimationEntryEditor } from '../components/animation/AnimationEntryEditor';
import { AnimationImage } from '../components/animation/AnimationImage';
import { AnimationInspection } from '../components/animation/AnimationInspection';
import { AnimationExistingSources } from '../components/animation/AnimationExistingSources';
import { AnimationFramePreview } from '../components/animation/AnimationFramePreview';
import { AnimationPreviewHeader } from '../components/animation/AnimationPreviewHeader';
import { AnimationEmptyPreview, AnimationWorkflowGuide } from '../components/animation/AnimationWorkflowGuide';
import { useAnimationDocument } from '../components/animation/useAnimationDocument';
import { ANIMATION_STYLES, animationError, animationModels, selectedAnimationModel } from '../components/animation/animation-ui';
import '../components/animation/animation-studio.css';

type Props = { props: PageProps; project: Project; initialMode: AnimationMode; initialReferenceIds?: string[]; initialPrompt?: string; onClose?: () => void };
type AnimationAiRequest = { kind: 'generate'; entryId: string; sampleOnly: boolean; retry: boolean } | { kind: 'refine'; entryId: string; frameId?: string; instruction: string } | { kind: 'control'; action: 'continue' | 'retry' };
export function AnimationStudio(input: Props) { return <AnimationWorkspace key={input.project.id} {...input} />; }
function AnimationWorkspace({ props, project, initialMode, initialReferenceIds, initialPrompt, onClose }: Props) {
  const bridge = typeof window === 'undefined' ? undefined : (window.desktop as (typeof window.desktop & { animation?: AnimationBridge }))?.animation;
  const editor = useAnimationDocument(project.id, initialMode, props.configuration, bridge, { referenceIds: initialReferenceIds, prompt: initialPrompt, title: project.name }), document = editor.document;
  const modelSettings = useRef<HTMLDetailsElement>(null);
  const referencePending = useRef(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(''), [selectedFrameId, setSelectedFrameId] = useState<string>(), [quantity, setQuantity] = useState(1), [playing, setPlaying] = useState(false), [instruction, setInstruction] = useState(''), [versionId, setVersionId] = useState(''), [pendingAi, setPendingAi] = useState<AnimationAiRequest>();
  const models = animationModels(props.configuration);
  const selected = document?.entries.find(entry => entry.id === selectedId) || document?.entries[0], job = editor.snapshot?.job, ownRunning = job?.status === 'running';
  const externalRun = (props.workflowRunner.runs || []).find(run => run.projectId === project.id && run.mode === 'live' && run.status === 'running' && !job?.runIds.includes(run.id)), running = ownRunning || !!externalRun, locked = !!editor.busy || running || referenceBusy;
  const model = models.find(item => item.id === document?.modelConfigId), needsEditing = !!document && (!!document.referenceArtifactIds.length || !!document.acceptedSampleId), modelReady = !!model?.capabilities.includes(needsEditing ? 'image-editing' : 'image-generation'), credentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === model?.connectionId), credentialReady = credentials.some(item => item.id === document?.credentialId);
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 100, ready = !!bridge && !!document && !!editor.snapshot, hasFrames = !!selected?.frames.length, hasAnyFrames = !!document?.entries.some(entry => entry.frames.length);
  const hasDescription = !!document?.prompt.trim() || !!document?.referenceArtifactIds.length || !!selected?.description.trim();
  const helper = editor.snapshot?.helper, canGenerate = ready && !locked && modelReady && credentialReady && quantityValid && helper?.available && (hasFrames || hasDescription);
  const canUpdate = ready && !locked && quantityValid && helper?.available && (hasFrames || modelReady && credentialReady && hasDescription);
  const costSummary = useMemo(() => summarizeCosts(props.ledger.filter(entry => entry.projectId === project.id && entry.billingMode !== 'simulation')), [props.ledger, project.id]);
  useEffect(() => { if (document) setQuantity(document.entries.length); }, [document?.entries.length]);
  useEffect(() => { setPlaying(false); setSelectedFrameId(undefined); setInstruction(''); }, [selected?.id]);
  useEffect(() => { const changed = () => { if (window.document.hidden) setPlaying(false); }; window.document.addEventListener('visibilitychange', changed); changed(); return () => window.document.removeEventListener('visibilitychange', changed); }, []);
  useEffect(() => { if (!document || locked) return; const value = selectedAnimationModel(document, props.configuration); if (value.modelConfigId !== document.modelConfigId || value.credentialId !== document.credentialId) editor.edit(value); }, [document?.modelConfigId, document?.credentialId, props.configuration.models, props.configuration.credentials, props.configuration.connections, locked]);
  function change(changes: Partial<AnimationDocument>, group?: string) { if (!document) return; const art = ['prompt', 'style', 'referenceArtifactIds', 'modelConfigId', 'credentialId', 'mode'].some(key => key in changes); editor.edit({ ...document, ...changes, ...(art ? { acceptedSampleId: undefined, entries: document.entries.map(entry => ({ ...entry, status: entry.frames.length ? 'stale' : 'draft' })) } : {}) }, group); }
  function changeEntry(entry: AnimationEntry, group?: string) { if (document) { const previous = document.entries.find(item => item.id === entry.id); editor.edit({ ...document, ...(previous?.description !== entry.description ? { acceptedSampleId: undefined } : {}), entries: document.entries.map(item => item.id === entry.id ? entry : item) }, group); } }
  function count(value: number) { setQuantity(value); if (document && Number.isInteger(value) && value >= 1 && value <= 100) { try { editor.edit(resizeAnimationEntries(document, value), 'entry-count'); } catch (cause) { editor.setIssue(animationError(cause)); } } }
  function performAi(request: AnimationAiRequest) {
    setPendingAi(undefined); if (!bridge || !document) return;
    if (request.kind !== 'control' && !document.entries.some(entry => entry.id === request.entryId)) { editor.setIssue('所选条目已变化，请重新选择后制作。'); return; }
    setPlaying(false);
    if (request.kind === 'generate') void editor.run(request.sampleOnly ? '正在制作样片' : '正在扩展制作', () => bridge.generate({ projectId: project.id, sampleOnly: request.sampleOnly, ...(request.sampleOnly ? { entryIds: [request.entryId] } : {}), ...(request.retry ? { retry: true } : {}) }));
    else if (request.kind === 'refine') void editor.run('正在局部修复', () => bridge.refine({ projectId: project.id, entryId: request.entryId, frameId: request.frameId, instruction: request.instruction }));
    else void editor.run(request.action === 'continue' ? '正在继续' : '正在重试', () => bridge.control({ projectId: project.id, action: request.action }));
  }
  function requestAi(request: AnimationAiRequest) { if (referencePending.current) { props.notify('参考图正在导入，准备好后再开始制作。'); return; } const paid = request.kind !== 'control' || job?.stage === 'generating'; if (paid && (!modelReady || !credentialReady)) { editor.setIssue('这次修改需要图片模型和对应 Key，请在制图设置中补齐；未开始模型调用。'); return; } if (props.preferences?.confirmGeneration && paid) setPendingAi(request); else performAi(request); }
  function generate(sampleOnly: boolean, retry = false) {
    if (!selected || !bridge) return;
    requestAi({ kind: 'generate', entryId: selected.id, sampleOnly, retry });
  }
  function refine() { if (selected && instruction.trim()) requestAi({ kind: 'refine', entryId: selected.id, frameId: selectedFrameId, instruction: instruction.trim() }); }
  function approve() { if (!document || !selected) return; editor.edit({ ...document, acceptedSampleId: selected.id }); void editor.run('正在认可样片'); }
  function compose() { if (bridge && selected) { setPlaying(false); void editor.run('正在本地合成', () => bridge.compose({ projectId: project.id, entryIds: [selected.id] })); } }
  function exportFile(format: 'png' | 'atlas' | 'frames' | 'gif' | 'zip' | 'project') {
    if (!bridge || !selected) return;
    void editor.run('正在导出文件', async value => {
      const entryIds = ['png', 'gif', 'frames', 'atlas'].includes(format) ? [selected.id] : undefined;
      const prepared = ['png', 'gif', 'frames', 'zip'].includes(format) ? await bridge.compose({ projectId: project.id, entryIds }) : value;
      let artifactId: string;
      if (format === 'png') {
        const entry = prepared.document.entries.find(item => item.id === selected.id);
        const output = prepared.artifacts.find(file => file.id === entry?.outputArtifactId);
        if (prepared.document.mode !== 'atlas' || entry?.status !== 'ready' || !output || output.mimeType !== 'image/png') throw Error('当前角色图片尚未准备好，请更新预览后再导出。');
        artifactId = output.id;
      } else artifactId = (await bridge.export({ projectId: project.id, format, entryIds })).artifact.id;
      const result = await props.workflowRunner.saveArtifact(artifactId);
      props.notify(result.saved ? '已导出所选成品。' : '导出文件已保留在项目内，另存已取消。');
      return prepared;
    });
  }
  function importProject() {
    const importAnimation = bridge?.importProject;
    if (!importAnimation) return;
    void editor.run('正在导入工程', async value => {
      const files = await props.workflowRunner.importFiles(project.id);
      if (!files.length) return;
      const archives = files.filter(file => file.projectId === project.id && file.mimeType === 'application/zip' && !file.trashedAt && !file.unavailable);
      if (archives.length !== 1 || files.length !== 1) throw Error('一次请选择一个可编辑动画工程 ZIP；已导入的文件仍保留在项目内。');
      const imported = await importAnimation({ projectId: project.id, artifactId: archives[0].id, expectedRevision: value.document.revision });
      const first = imported.document.entries.find(entry => entry.frames.length);
      if (!first || !imported.helper?.available) return imported;
      try { return await bridge.compose({ projectId: project.id, entryIds: [first.id] }); }
      catch (cause) {
        editor.setIssue(`工程已导入，预览暂未完成：${animationError(cause)}。源稿已保留，可点击“更新预览”继续本地处理。`);
        return bridge.read({ projectId: project.id }).catch(() => imported);
      }
    });
  }
  function saveWorkflow() {
    if (!selected) return;
    void editor.run('正在保存样片流程', async value => {
      const entry = value.document.entries.find(item => item.id === selected.id); if (!entry) throw Error('所选条目已经变化，请重新选择后保存流程。');
      const workflow = makeAnimationWorkflow({ ...value.document, entries: [entry], acceptedSampleId: undefined }, props.configuration);
      if (!props.configuration.saveWorkflow(workflow)) throw Error('流程尚未保存，请查看工作区配置。');
      props.notify('已保存到自动化流程，尚未调用模型。');
    });
  }
  function adoptSources(value: AnimationDocument, entryIds: string[]) { if (!bridge) return; setPlaying(false); editor.edit(value); void editor.run('正在本地合成已有素材', () => bridge.compose({ projectId: project.id, entryIds })); }
  function referenceWork(busy: boolean) { referencePending.current = busy; setReferenceBusy(busy); }
  function showModelSettings() { const panel = modelSettings.current; if (!panel) return; panel.open = true; panel.scrollIntoView({ block: 'nearest' }); panel.querySelector<HTMLElement>('[role="combobox"]')?.focus(); }
  function fillExample() {
    if (!document || document.prompt.trim() || document.referenceArtifactIds.length || hasAnyFrames) return;
    change({ prompt: document.mode === 'gif' ? '制作一只戴蓝色小围巾的原创橘猫，微笑挥手，动作连贯，首尾自然衔接。全身完整，透明背景，不加文字。' : '制作一只戴蓝色小围巾的原创橘猫，开心挥手，圆脸小短腿，表情清楚。全身完整，透明背景，不加文字。' });
  }
  const style = document && animationStyle(document.style), frame = selected?.frames.find(item => item.id === selectedFrameId), selectedOutput = editor.snapshot?.artifacts.find(file => file.id === selected?.outputArtifactId), canPlay = document?.mode === 'gif' && selectedOutput?.mimeType === 'image/gif' && selected?.status === 'ready';
  useEffect(() => { if (!canPlay) setPlaying(false); }, [canPlay]);
  const statusNames = { draft: '待制图', ready: '已就绪', stale: '需更新', failed: '需处理' }, pending = document?.entries.filter(entry => entry.id !== document.acceptedSampleId && entry.status !== 'ready').length || 0;
  const frameHistoryControls = selected && selectedFrameId && <div className="animation-button-row"><button type="button" className="btn btn-secondary" disabled={locked || !editor.canUndoFrame(selected.id, selectedFrameId)} onClick={() => { setPlaying(false); editor.undoFrame(selected.id, selectedFrameId); }}><Undo2 size={14} />撤销此帧画面</button><button type="button" className="btn btn-secondary" disabled={locked || !editor.canRedoFrame(selected.id, selectedFrameId)} onClick={() => { setPlaying(false); editor.redoFrame(selected.id, selectedFrameId); }}><Redo2 size={14} />重做此帧画面</button><small>只回退所选源画面；其它条目、时长和已发生费用保留，可免费更新 GIF 预览。</small></div>;
  return <section className="animation-studio" aria-label="角色图集与GIF动画工坊" onKeyDown={event => { if (locked || !(event.ctrlKey || event.metaKey) || event.altKey || isTextEditingTarget(event.target) || isSelectInteraction(event.nativeEvent) || event.target instanceof Element && event.target.closest('[role="dialog"]')) return; const key = event.key.toLowerCase(); if (key !== 'z' && key !== 'y') return; event.preventDefault(); event.stopPropagation(); if (key === 'y' || event.shiftKey) editor.redo(); else editor.undo(); }}><header className="animation-page-heading"><div>{onClose && <button type="button" className="text-button" disabled={!!editor.busy} onClick={() => { if (!editor.dirty || editor.retainDraft()) onClose(); else void editor.save().then(saved => { if (saved) onClose(); }); }}><ArrowLeft size={15} />返回图片工作台</button>}<h1>{(document?.mode ?? initialMode) === 'atlas' ? '角色图集' : 'GIF 动画工坊'}</h1><p>描述想法，先做一份看看效果；满意后可直接导出或继续制作。</p></div><div className="animation-cost"><small>本项目已知调用成本</small><strong><CostTotal summary={costSummary} /></strong><span>本地编辑与导出不调用模型，撤销不退回已发生费用。</span></div></header>
    <div className="animation-topbar"><div className="animation-mode-tabs" role="tablist" aria-label="动画用途">{([{ value: 'gif', label: 'GIF 动画工坊' }, { value: 'atlas', label: '角色图集' }] as const).map(item => <button type="button" role="tab" aria-selected={document?.mode === item.value} key={item.value} disabled={!ready || locked} onClick={() => { change({ mode: item.value, acceptedSampleId: undefined }); setPlaying(false); }}>{item.label}</button>)}</div><div className="animation-button-row"><button type="button" className="btn btn-secondary" disabled={!editor.canUndo || locked} aria-label="撤销动画编辑" onClick={editor.undo}><Undo2 size={15} />撤销</button><button type="button" className="btn btn-secondary" disabled={!editor.canRedo || locked} aria-label="重做动画编辑" onClick={editor.redo}><Redo2 size={15} />重做</button><button type="button" className="btn btn-secondary" disabled={!ready || locked || !quantityValid || !editor.dirty} onClick={() => { void editor.save(); }}><Save size={15} />保存编辑</button><button type="button" className="text-button" aria-label="刷新动画工程" disabled={!ready || !!editor.busy} onClick={() => { void editor.refresh(); }}><RefreshCw size={14} />刷新</button><span className="animation-save-status">{editor.busy || (editor.dirty ? '有未保存修改' : ready ? '已保存到项目' : '等待桌面后台')}</span></div></div>
    {editor.issue && <div className="animation-notice is-error" role="alert"><span>{editor.issue}</span><button type="button" className="text-button" disabled={!!editor.busy} onClick={() => { void editor.refresh(); }}>重新读取项目</button></div>}{editor.incoming && <div className="animation-notice"><span>后台有新版本，当前草稿已保留，未自动覆盖。</span><button type="button" className="btn btn-secondary" disabled={!!editor.busy} onClick={editor.loadIncoming}>保留草稿并载入新结果</button></div>}{editor.hasRecovery && <div className="animation-button-row"><button type="button" className="text-button" disabled={locked} onClick={editor.recover}>恢复上次本地草稿供继续编辑</button><button type="button" className="text-button" disabled={locked} onClick={() => { void editor.exportRetained(); }}>导出保留的本地草稿</button></div>}
    {editor.loading && <div className="animation-loading" role="status"><LoaderCircle className="spin" size={22} />正在读取动画工程…</div>}    {ready && document && <>
      <AnimationWorkflowGuide mode={document.mode} hasFrames={hasFrames} ready={selected?.status === 'ready' && !editor.dirty} multiple={document.entries.length > 1} accepted={!!document.acceptedSampleId} />
      <div className="animation-workspace">
        <aside className="animation-creation">
          <section className="animation-panel">
            <div className="animation-section-heading"><strong>{document.mode === 'gif' ? '描述你的动画' : '描述你的角色图片'}</strong></div>
            <div className="animation-form-grid">
              <label className="animation-full">描述你的想法<textarea className="field" aria-label="动画创作需求" rows={4} value={document.prompt} maxLength={20000} disabled={locked} placeholder={document.mode === 'gif' ? '例如：一只戴蓝围巾的小橘猫，微笑挥手，透明背景' : '例如：原创小橘猫表情包，开心挥手，透明背景'} onChange={event => change({ prompt: event.target.value }, 'prompt')} /></label>
              <label>视觉风格<Select aria-label="动画视觉风格" disabled={locked} value={document.style} onValueChange={styleId => { const chosen = ANIMATION_STYLES.find(item => item.value === styleId); if (chosen) { const defaults = animationStyle(chosen.value); change({ style: chosen.value, ...(!document.entries.some(entry => entry.frames.length) ? { ...defaults.defaults, columns: defaults.grid[0], rows: defaults.grid[1] } : {}) }); } }} options={ANIMATION_STYLES} /></label>
              <ImageQuantityField value={quantity} max={100} label={document.mode === 'gif' ? 'GIF 份数' : '角色图片张数'} unit={document.mode === 'gif' ? '份' : '张'} ariaLabel="角色作品数量" onChange={count} disabled={locked} />
            </div>
            <p className="animation-hint">{document.mode === 'gif' ? `${style?.description || ''}份数是独立 GIF 的数量，不是动画帧数。` : '每份是一张独立角色图片；先制作一张查看效果，再扩展其余图片。'}</p>
            <AnimationReferences props={props} projectId={project.id} ids={document.referenceArtifactIds} artifacts={editor.snapshot!.artifacts} disabled={locked} onChange={referenceArtifactIds => change({ referenceArtifactIds })} onIssue={editor.setIssue} onBusyChange={referenceWork} />
            <div className="animation-primary-actions">
              <button type="button" className="btn btn-primary" disabled={!canUpdate} onClick={() => hasFrames ? selected?.status === 'ready' && !editor.dirty ? exportFile(document.mode === 'gif' ? 'gif' : 'png') : compose() : generate(true)}>
                {hasFrames ? selected?.status === 'ready' && !editor.dirty ? <Download size={16} /> : <RefreshCw size={16} /> : <Sparkles size={16} />}{hasFrames ? selected?.status === 'ready' && !editor.dirty ? document.mode === 'gif' ? '导出此 GIF' : '导出当前 PNG' : '更新预览' : '制作第一份'}
              </button>
              {hasFrames && <button type="button" className="btn btn-secondary" disabled={!canGenerate} onClick={() => generate(true, true)}><WandSparkles size={16} />AI 重新制作</button>}
              {document.entries.length > 1 && pending > 0 && <button type="button" className="btn btn-secondary" disabled={!canGenerate || !document.acceptedSampleId} onClick={() => generate(false)}><WandSparkles size={16} />按样片扩展 {pending} 份</button>}
              {document.entries.length > 1 && !pending && <span className="animation-complete-label"><Check size={15} />全部 {document.entries.length} 份已就绪</span>}
              <small>{hasFrames ? '更新预览、改字、改速和导出免费。更改角色外观或动作，请用“AI 重新制作”，会新增模型费用。' : '先制作一份看看效果；AI 制图按实际调用计费。已有图片或工程也可直接导入。'}</small>
              {!hasFrames && !hasDescription && <small>先写一句描述，或上传一张参考图；也可以点击右侧“填入示例”。</small>}
              {referenceBusy && <small role="status">正在导入参考图，准备好后即可开始制作。</small>}
              {(!modelReady || !credentialReady) && <button type="button" className="text-button" onClick={showModelSettings}>选择制图模型和账号</button>}
              {!hasFrames && bridge?.importProject && <button type="button" className="text-button" disabled={locked || !quantityValid} onClick={importProject}><FolderOpen size={14} />导入已有工程</button>}
            </div>
            <RememberedDetails ref={modelSettings} className="animation-advanced" rememberKey="animation:model-settings" defaultOpen={!model || !credentialReady}>
              <summary>制图模型与 Key <small>{model?.name || '待选择'} · {credentialReady ? '已就绪' : '待补齐'}</small></summary>
              <div className="animation-form-grid">
                <label className="animation-full">图片模型<Select aria-label="动画制图模型" disabled={locked} value={document.modelConfigId} onValueChange={modelConfigId => { const next = models.find(item => item.id === modelConfigId); change({ modelConfigId, credentialId: studioCredential(props.configuration.credentials, next?.connectionId) || '' }); }} options={[{ value: '', label: '选择已配置的图片模型' }, ...models.map(item => ({ value: item.id, label: item.name, description: item.modelId, disabled: !item.capabilities.includes(needsEditing ? 'image-editing' : 'image-generation') }))]} /></label>
                <label className="animation-full">对应凭证<Select aria-label="动画制图Key" disabled={locked || !model} value={document.credentialId} onValueChange={credentialId => change({ credentialId })} options={[{ value: '', label: '选择本机加密凭证' }, ...credentials.map(item => ({ value: item.id, label: item.name, description: `尾号 ${item.lastFour}` }))]} /></label>
              </div>
              <p>AI 制图使用所选模型和账号；已有源稿的本地编辑、预览与导出无需模型或 Key。</p>
              {(!models.length || !credentials.length) && <button type="button" className="text-button" onClick={() => props.navigate('models')}>前往模型中心补全设置</button>}
            </RememberedDetails>
            {model && !modelReady && <p className="animation-notice">{needsEditing ? '新的 AI 制图需要支持图片编辑的模型，请在上方更换制图模型；已有源稿仍可本地合成。' : '当前没有静态参考，请选择支持图片生成的模型，或先上传角色参考图。'}</p>}
            <RememberedDetails className="animation-advanced" rememberKey="animation:project-name"><summary>作品名称 <small>{document.title}</small></summary><label>作品名称<input className="field" aria-label="动画作品名称" value={document.title} maxLength={160} disabled={locked} onChange={event => change({ title: event.target.value }, 'title')} /></label></RememberedDetails>
            <AnimationAdvanced document={document} disabled={locked} onChange={editor.edit} />
            <AnimationExistingSources document={document} selectedId={selected?.id} disabled={locked || !helper?.available || !quantityValid} onAdopt={adoptSources} onIssue={editor.setIssue} />
            {!helper?.available && <p className="animation-notice is-error">{helper?.reason || '本地动画工具暂不可用，请更新桌面应用。'}</p>}
          </section>
        </aside>
        <main className="animation-results">
          <section className="animation-panel animation-preview">
            <AnimationPreviewHeader entry={selected} index={Math.max(0, document.entries.findIndex(entry => entry.id === selected?.id))} mode={document.mode} status={selected ? statusNames[selected.status] : '尚无作品'} metadata={document.mode === 'gif' ? `${document.width} × ${document.height} px · ${(document.loopMs / 1000).toFixed(2)} 秒循环` : 'PNG 图片 · 保留源图实际像素'} canPlay={!!canPlay} playing={playing} disabled={false} composeDisabled={locked || !hasFrames || !helper?.available || !quantityValid} onTogglePlaying={() => setPlaying(value => !value)} onCompose={compose} />
            {hasFrames ? <div className={`animation-preview-canvas${frame && !(playing && canPlay) ? ' has-source-frame' : ''}`} data-playing={playing && canPlay ? 'true' : undefined}>
              {frame && <AnimationFramePreview frame={frame} index={selected!.frames.indexOf(frame)} runner={props.workflowRunner} hidden={playing && !!canPlay} />}
              {(!frame || playing && canPlay) && <AnimationImage key={`${project.id}:${selected?.id}:${playing}`} artifactId={playing && canPlay ? selected?.outputArtifactId : selected?.coverArtifactId || selected?.frames[0]?.atlasArtifactId} runner={props.workflowRunner} animated={playing && !!canPlay} alt={selected?.caption || '当前角色预览'} />}
            </div> : <AnimationEmptyPreview mode={document.mode} onExample={fillExample} onImport={bridge?.importProject ? importProject : undefined} disabled={locked || !quantityValid} canFillExample={!document.prompt.trim() && !document.referenceArtifactIds.length && !hasAnyFrames} />}
            {selected && hasFrames && <AnimationInspection entry={selected} artifact={selectedOutput} changed={editor.dirty} />}
            {selected?.error && <p className="animation-notice is-error">{selected.error}</p>}
            {hasFrames && <div className="animation-preview-footer">
              {document.entries.length > 1 && <button type="button" className="btn btn-secondary" disabled={locked || !selected || selected.status !== 'ready' || document.mode === 'gif' && !canPlay || document.acceptedSampleId === selected.id || editor.dirty} onClick={approve}><Check size={15} />{document.acceptedSampleId === selected?.id ? editor.dirty || selected?.status === 'stale' ? '角色身份已认可' : '已认可此样片' : '认可样片'}</button>}
              <div className="animation-button-row"><button type="button" className="text-button" disabled={locked || !helper?.available} title="导出包含全部源格的原始图集" onClick={() => exportFile('atlas')}><Download size={14} />图集原稿</button><button type="button" className="btn btn-primary" disabled={locked || !helper?.available || !quantityValid} onClick={() => exportFile(document.mode === 'gif' ? 'gif' : 'png')}><Download size={15} />{document.mode === 'gif' ? '导出此 GIF' : '导出当前 PNG'}</button></div>
            </div>}
          </section>
          {document.entries.length > 1 && <section className="animation-panel"><div className="animation-section-heading"><strong>作品列表 <small>{document.entries.length} 份 · 点击选择</small></strong><small>仅选中的 GIF 可以播放。</small></div><div className="animation-entry-grid">{document.entries.map((entry, index) => <button type="button" className={`animation-entry-card${selected?.id === entry.id ? ' is-selected' : ''}`} key={entry.id} aria-label={`选择角色条目 ${index + 1}`} aria-pressed={selected?.id === entry.id} onClick={() => { setSelectedId(entry.id); setPlaying(false); }}><div><AnimationImage artifactId={entry.coverArtifactId || entry.frames[0]?.atlasArtifactId} runner={props.workflowRunner} alt={entry.caption || `条目 ${index + 1}`} /></div><strong>{entry.caption || `第 ${index + 1} 份`}</strong><span>{statusNames[entry.status]}{document.acceptedSampleId === entry.id ? ' · 样片' : ''}</span></button>)}</div></section>}
          {selected && <RememberedDetails className="animation-panel animation-entry-tools" rememberKey="animation:entry-edit"><summary>修改当前作品 <small>文字、动作、逐帧编辑与 AI 修复</small></summary><div className="animation-entry-tools-body">
            {frameHistoryControls}
            <AnimationEntryEditor document={document} entry={selected} disabled={locked} selectedFrameId={selectedFrameId} onFrame={id => { setSelectedFrameId(id); setPlaying(false); }} onChange={changeEntry} onIssue={editor.setIssue} />
            <RememberedDetails className="animation-advanced" rememberKey="animation:ai-refine"><summary>AI 局部修复 <small>{selectedFrameId ? '仅选中关键帧' : '仅当前条目'}</small></summary><label>希望改哪里？<textarea className="field" aria-label="动画局部修改要求" rows={3} maxLength={4000} disabled={locked} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：只修复举手这一帧的手指，保留其余画面和角色特征" /></label><div className="animation-button-row"><button type="button" className="btn btn-primary" disabled={!canGenerate || !hasFrames || !instruction.trim()} onClick={refine}><WandSparkles size={15} />{selectedFrameId ? '只修选中帧' : '只修当前条目'}</button><small>AI 修复会新增费用；未选中的画面保留。</small></div></RememberedDetails>
          </div></RememberedDetails>}
          <section className="animation-panel animation-export">
            <div><strong>保存与交付</strong><p>成品和工程保存在当前项目。需要拆分图、整套交付或继续编辑时，再选择下方格式。</p></div>
            <div className="animation-button-row"><button type="button" className="btn btn-secondary" disabled={locked || !hasFrames || !helper?.available} onClick={() => exportFile('frames')}><FolderOpen size={15} />拆分图片 ZIP</button><button type="button" className="btn btn-primary" disabled={locked || !document.entries.some(entry => entry.frames.length) || !helper?.available || !quantityValid} onClick={() => exportFile('zip')}><Download size={15} />导出整套 ZIP</button><button type="button" className="text-button" disabled={locked || !quantityValid} onClick={() => exportFile('project')}>可编辑工程 ZIP</button><button type="button" className="text-button" disabled={locked || !quantityValid} onClick={saveWorkflow}>保存当前样片流程</button></div>
            <RememberedDetails className="animation-advanced" rememberKey="animation:versions"><summary>保存版本与导入 <small>{editor.snapshot?.history.length || 0} 个</small></summary><div className="animation-button-row"><Select aria-label="动画保存版本" disabled={locked} value={versionId} onValueChange={setVersionId} options={[{ value: '', label: '选择要恢复的保存版本' }, ...(editor.snapshot?.history || []).map(item => ({ value: item.id, label: `v${item.revision} · ${item.label}` }))]} /><button type="button" className="btn btn-secondary" disabled={locked || !versionId} onClick={() => { if (bridge) void editor.run('正在恢复版本', value => bridge.restore({ projectId: project.id, versionId, expectedRevision: value.document.revision })); }}>恢复为新版本</button></div><div className="animation-button-row"><button type="button" className="btn btn-secondary" aria-label="导入可编辑动画工程" disabled={locked || !bridge?.importProject || !quantityValid} onClick={importProject}><FolderOpen size={15} />导入工程 ZIP</button></div><p>{bridge?.importProject ? '导入前先保存草稿，导入后自动恢复第一份预览；整套导出时处理其余条目。' : '导入可编辑工程 ZIP 需要新版桌面后台。'}本地恢复与导出不调用模型，已发生费用保留。</p></RememberedDetails>
          </section>
        </main>
      </div>
    </>}
    {(running || !!editor.busy || job && ['failed', 'interrupted', 'cancelled'].includes(job.status)) && <section className="animation-job" aria-live="polite"><div><strong>{editor.busy || (externalRun && !ownRunning ? `其它真实任务正在运行：${externalRun.workflowName}` : ownRunning ? { generating: 'AI 正在制图', composing: '正在本地合成', checking: '正在检查成品', complete: '制作完成' }[job!.stage] : { failed: '制作未完成', interrupted: '制作已中断', cancelled: '制作已取消', complete: '制作完成', running: '正在制作' }[job!.status])}</strong><small>{externalRun && !ownRunning ? '该项目的任务完成或取消后可继续编辑。' : job ? `已完成 ${job.completedEntryIds.length} / ${job.entryIds.length} 份。` : ''}已保存源稿和已发生费用保留。</small>{job?.error && <p>{job.error}</p>}</div><div className="animation-button-row">{running || !!editor.busy ? <button type="button" className="btn btn-secondary" onClick={() => { if (externalRun && !ownRunning) props.workflowRunner.cancel(externalRun.id); else void editor.cancel(); }}><Square size={14} />取消当前任务</button> : <><button type="button" className="btn btn-secondary" disabled={!bridge} onClick={() => requestAi({ kind: 'control', action: 'continue' })}>继续未完成项</button><button type="button" className="text-button" disabled={!canGenerate} onClick={() => requestAi({ kind: 'control', action: 'retry' })}>明确重试未完成项</button></>}</div></section>}
    {pendingAi && <ModalPortal onClose={() => setPendingAi(undefined)} busy={!!editor.busy}><div className="animation-modal-overlay"><section className="animation-asset-dialog" role="dialog" aria-modal="true" aria-label="确认本次动画模型调用"><header><h2>开始这次制作？</h2><button type="button" className="btn-icon" aria-label="关闭模型调用确认" onClick={() => setPendingAi(undefined)}>×</button></header><div style={{ padding: '0 24px 20px' }}><p>{pendingAi.kind === 'refine' ? pendingAi.frameId ? '仅修复已选关键帧' : '仅修复当前条目' : pendingAi.kind === 'generate' && pendingAi.sampleOnly ? '制作一份选中样片' : pendingAi.kind === 'generate' ? `按认可样片扩展 ${pending} 份` : '继续处理未完成项'}</p><p><strong>{model?.name || '所选图片模型'}</strong> · {credentials.find(item => item.id === document?.credentialId)?.name || '本机加密凭证'}</p><p>实际费用完成后自动计入项目账本。取消任务、撤销或恢复内容，不减少已经发生的模型费用。</p><small>此窗口来自你开启的“生成前逐次确认”偏好，一次确认覆盖这次操作的全部条目。</small></div><footer><button type="button" className="btn btn-secondary" onClick={() => setPendingAi(undefined)}>返回继续编辑</button><button type="button" className="btn btn-primary" disabled={!!editor.busy || pendingAi.kind !== 'control' && !canGenerate} onClick={() => performAi(pendingAi)}>确认并开始</button></footer></section></div></ModalPortal>}
  </section>;
}
