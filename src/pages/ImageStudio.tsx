import { DeliveryPanel } from '../components/DeliveryPanel';
import { imageDeliveryChecks, inspectDeliveryImage } from '../lib/delivery-quality';
import type { ImageDeliveryMetadata } from '../lib/delivery-quality';
import { studioModel, workflowPublicError } from '../lib/studio-run';
import { latestStudioBinding, readStudioCredentialPreference, saveStudioCredentialPreference, studioCredentialChoice, studioProjectCredential, studioProjectModel } from '../lib/studio-project-bindings';
import { REVIEW_REPLACEMENT_NOTE, studioActionIssue } from '../lib/studio-action-status';
import type { StudioActionIssue, StudioActionTarget } from '../lib/studio-action-status';
import { StudioActionStatus } from '../components/StudioActionStatus';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Download, BookOpen, Check, ChevronDown, FileText, ImagePlus, Layers3, LoaderCircle, Plus, Save, Settings2, ShieldCheck, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import type { PageProps, Project, PromptDraft } from '../types';
import { isProductionRun } from '../lib/workflow-purpose';
import type { SyntheticEvent } from 'react';
import type { ArtifactMetadata } from '../live-types';
import { budgetLabel } from '../data';
import { CostTotal } from '../components/CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { PromptPicker, PromptEditor } from '../components/PromptDialogs';
import { StudioActions } from '../components/StudioActions';
import { ArtifactResults } from '../components/ArtifactResults';
import { ImageGallery, ImageHistoryNavigation } from '../components/ImageGallery';
import { StudioWorkbench } from '../components/StudioWorkbench';
import { useStudioToolRequests } from '../hooks/useStudioToolRequests';
import type { StudioTool } from '../lib/studio-commands';
import { RememberedDetails } from '../components/RememberedDetails';
import { useStudioLayout } from '../hooks/useStudioLayout';
import { useEditHistory } from '../hooks/useEditHistory';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { useScopedTextHistory } from '../hooks/useScopedTextHistory';
import { SelectionHistoryToolbar } from '../components/SelectionHistoryToolbar';
import { assertAssetImage, imageDraftWithAsset } from '../lib/asset-application';
import { Select } from '../components/Select';
import { ImageQuantityField } from '../components/ImageQuantityField';
import { MAX_IMAGE_QUANTITY, validImageQuantity } from '../lib/image-quantity';
import { PurposeTemplates } from '../components/PurposeTemplates';
import { ProjectReferences } from '../components/ProjectReferences';
import { IMAGE_SIZES, MAX_IMAGE_REFERENCES, followGalleryImage, imageArtifactTarget, imageCreationDescription, imageDraftKey, imageDraftPurpose, imageMissingReferences, imageTaskRequest, isGalleryImageBase, projectImageContent, readImageDraft, selectImageUseTemplate, updateImageDraft } from '../lib/image-studio';
import { availableImageUseTemplates, imageUseTemplateSnapshot } from '../lib/image-use-templates';
import type { ImageDraft } from '../lib/image-studio';
import './studios.css';
import './image-studio.css';
const StudioAssetPicker = lazy(() => import('../components/StudioAssetPicker').then(module => ({ default: module.StudioAssetPicker })));
const ImageGroupBatchPanel = lazy(() => import('../components/ImageGroupBatchPanel').then(module => ({ default: module.ImageGroupBatchPanel })));

interface ImageEditSnapshot { draft: ImageDraft; selectedImageId: string; }

const isImageUrl = (value?: string) => Boolean(value && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(value));

export function ImageStudio(props: PageProps) {
  const project = props.activeProject.kind === 'image' ? props.activeProject : props.projects.find(item => item.kind === 'image') ?? props.activeProject;
  return <ImageProject key={project.id} props={props} project={project} />;
}

function ImageProject({ props, project }: { props: PageProps; project: Project }) {
  const [credentialIds, setCredentialIds] = useState(() => ({ 'image-generation': readStudioCredentialPreference(project.id, 'image-generation'), 'image-editing': readStudioCredentialPreference(project.id, 'image-editing') }));
  const workbench = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState('');
  const layout = useStudioLayout('images');
  const realModels = props.configuration.models.filter(model => model.enabled && !model.demo && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
  const useTemplates = availableImageUseTemplates(props.configuration.useTemplates, props.workspaceId);
  const [draft, setDraft] = useState<ImageDraft>(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(imageDraftKey(project.id)); } catch { /* The form remains usable without browser storage. */ }
    const saved = readImageDraft(raw, project.description);
    const purpose = useTemplates.find(item => item.id === saved.preset);
    return { ...saved, ...(saved.presetSnapshot || !purpose ? {} : { presetSnapshot: imageUseTemplateSnapshot(purpose) }) };
  });
  const imageElement = useRef<{ id: string; image: HTMLImageElement } | undefined>(undefined);
  const [imageMetadata, setImageMetadata] = useState<ImageDeliveryMetadata & { id?: string }>({});
  const [selectedImageId, setSelectedImageId] = useState(() => projectImageContent(props.workflowRunner.runs, project.id, props.workflowRunner.trashedArtifacts).images[0]?.id || draft.references[0]?.id || '');
  const edits = useEditHistory<ImageEditSnapshot>();
  const scopedEdits = useScopedTextHistory();
  const [textSelection, setTextSelection] = useState<{ field: 'prompt' | 'refinePrompt'; start: number; end: number; text: string }>();
  const selectionElement = useRef<HTMLTextAreaElement | null>(null);
  const restoringSelection = useRef(false), selectionFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (selectionFrame.current !== undefined) cancelAnimationFrame(selectionFrame.current); }, []);
  const editSnapshot = useRef({ draft, selectedImageId });
  if (editSnapshot.current.draft !== draft || editSnapshot.current.selectedImageId !== selectedImageId) editSnapshot.current = { draft, selectedImageId };
  const [importing, setImporting] = useState(false);
  const [restoringImage, setRestoringImage] = useState(false);
  const [checkingReferences, setCheckingReferences] = useState(Boolean(draft.references.length));
  const [referenceError, setReferenceError] = useState('');
  const [referencePreview, setReferencePreview] = useState<string>();
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingImage = useRef(false);
  const [readingOptimization, setReadingOptimization] = useState(false);
  const [optimization, setOptimization] = useState<{ id: string; text: string }>();
  const [appliedOptimizationId, setAppliedOptimizationId] = useState('');
  const [templateOffer, setTemplateOffer] = useState<string>();
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [promptEditorDraft, setPromptEditorDraft] = useState<PromptDraft | null>(null);
  const [purposeManager, setPurposeManager] = useState<'create' | 'manage'>();
  const [groupBatchOpen, setGroupBatchOpen] = useState(false);
  const appliedPromptToken = useRef<string | null>(null);
  const appliedAssetToken = useRef<string | undefined>(undefined), pendingAssetToken = useRef<string | undefined>(undefined);
  const assetContext = useRef({ application: props.assetToApply, workspaceId: props.workspaceId, projectId: project.id, acknowledge: props.onAssetApplied });
  assetContext.current = { application: props.assetToApply, workspaceId: props.workspaceId, projectId: project.id, acknowledge: props.onAssetApplied };
  const warnedStorage = useRef(false);
  const alive = useRef(true);
  const runnerRef = useRef(props.workflowRunner); runnerRef.current = props.workflowRunner;
  const { images, artifacts, optimizedPrompt } = useMemo(() => projectImageContent(props.workflowRunner.runs, project.id, props.workflowRunner.trashedArtifacts), [props.workflowRunner.runs, project.id, props.workflowRunner.trashedArtifacts]);
  const knownImageIds = useRef(new Set(images.map(image => image.id)));
  const imageIds = images.map(image => image.id).join('|');
  const selectedImage = images.find(image => image.id === selectedImageId) || images[0];
  const creationPrompt = useMemo(() => {
    for (const run of props.workflowRunner.runs.filter(item => item.projectId === project.id && item.mode === 'live')) {
      const attempt = run.attempts.find(item => item.artifacts?.some(artifact => artifact.id === selectedImage?.id));
      if (attempt?.prompt) return imageCreationDescription(attempt.prompt);
    }
    return undefined;
  }, [props.workflowRunner.runs, selectedImage?.id, project.id]);
  const generationBinding = latestStudioBinding(props.workflowRunner.runs, props.workspaceId, project.id, 'image-generation');
  const editingBinding = latestStudioBinding(props.workflowRunner.runs, props.workspaceId, project.id, 'image-editing');
  const generationModel = studioProjectModel(realModels.filter(model => model.capabilities.includes('image-generation')), draft.generationModelId, generationBinding);
  const editingModel = studioProjectModel(realModels.filter(model => model.capabilities.includes('image-editing')), draft.editingModelId, editingBinding);
  const task = imageTaskRequest({ ...draft, generationModelId: generationModel?.id || '', editingModelId: editingModel?.id || '' }, selectedImage?.id);
  const currentModels = realModels.filter(model => model.capabilities.includes(task.parameters.capability));
  const currentModel = currentModels.find(model => model.id === task.parameters.modelConfigId);
  const imageCapability = task.parameters.capability === 'image-editing' ? 'image-editing' : 'image-generation';
  const imageCredentials = (props.configuration.credentials || []).filter(key => key.enabled && key.connectionId === currentModel?.connectionId);
  const selectedCredential = studioProjectCredential(imageCredentials, currentModel, credentialIds[imageCapability], imageCapability === 'image-editing' ? editingBinding : generationBinding);
  const groupCredential = studioProjectCredential(props.configuration.credentials, generationModel, credentialIds['image-generation'], generationBinding);
  const imageKeyIssue = currentModel && !selectedCredential ? '请选择本次调用的 Key；原选择可能已停用，当前不会换用其他账户。' : '';
  const needsModelSetup = currentModels.length === 0;
  const active = props.workflowRunner.runs.find(run => isProductionRun(run) && run.projectId === project.id && ['running', 'paused'].includes(run.status));
  const reviewing = props.workflowRunner.runs.some(run => run.projectId === project.id && run.status === 'waiting-review');
  const busy = restoringImage || Boolean(active) || project.status === 'processing' && !reviewing;
  const realEntries = props.ledger.filter(entry => entry.projectId === project.id && entry.billingMode === 'live');
  const costSummary = summarizeCosts(realEntries);
  const purpose = imageDraftPurpose(draft);
  const missingReferences = imageMissingReferences(draft, selectedImage?.id);
  const purposeNeedsReferences = draft.mode === 'create' && missingReferences > 0;
  const currentPurposeAvailable = useTemplates.some(item => item.id === draft.preset);
  const refinementNeedsImage = draft.mode === 'refine' && !task.parameters.attachmentIds.length;
  const quantityValid = validImageQuantity(draft.quantity);
  const quantityLabel = quantityValid ? `${draft.quantity} 张` : '数量待填写';
  const generationLabel = `${draft.mode === 'refine' ? '开始精修' : draft.references.length ? '按参考图生成' : '生成图片'}${quantityValid ? ` · ${quantityLabel}` : ''}`;
  const ready = Boolean(quantityValid && currentModel && selectedCredential && task.parameters.prompt.trim() && !busy && !checkingReferences && !referenceError && !importing && !purposeNeedsReferences && !refinementNeedsImage);
  const referenceKey = draft.references.map(reference => reference.id).join('|');
  const trashedReferenceKey = draft.references.filter(reference => props.workflowRunner.trashedArtifacts?.some(artifact => artifact.id === reference.id)).map(reference => reference.id).join('|');
  const runtimeAvailable = props.workflowRunner.runtimeStatus.available;
  const deliveryTarget = imageArtifactTarget(props.workflowRunner.runs, project.id, selectedImage);
  const requiresTransparency = deliveryTarget.background === 'transparent';
  const generationIssue: StudioActionIssue | undefined = studioActionIssue({ ready: true, busy: importing ? 'importing' : checkingReferences ? 'references' : '', taskStatus: active?.status || (busy ? 'running' : undefined), input: task.parameters.prompt, inputLabel: draft.mode === 'refine' ? '修改要求' : '画面描述', modelId: currentModel?.id, modelCount: currentModels.length }) || (!quantityValid ? { message: `请输入 1–${MAX_IMAGE_QUANTITY} 的整数作为图片数量。`, action: '填写图片数量', target: 'quantity' } : referenceError ? { message: referenceError, action: '重新导入参考图', target: 'references' } : purposeNeedsReferences ? { message: `此用途还需要 ${missingReferences} 张参考图。`, action: '导入参考图片', target: 'references' } : refinementNeedsImage ? { message: '请先选择或导入要精修的图片。', action: '导入原图', target: 'references' } : undefined);
  const actionStatusId = `image-action-status-${project.id}`;
  const inspectImageMetadata = (id: string, image: HTMLImageElement) => { imageElement.current = { id, image }; setImageMetadata({ id, ...(requiresTransparency ? inspectDeliveryImage(image) : { width: image.naturalWidth, height: image.naturalHeight, transparency: 'unknown' as const }) }); };
  useEffect(() => { const loaded = imageElement.current; if (loaded && loaded.id === selectedImage?.id) inspectImageMetadata(loaded.id, loaded.image); }, [requiresTransparency, selectedImage?.id]);
  function changeImage(nextDraft: ImageDraft, imageId = editSnapshot.current.selectedImageId, group?: string, recordScoped = true) {
    if (recordScoped) {
      for (const field of ['prompt', 'refinePrompt'] as const) if (editSnapshot.current.draft[field] !== nextDraft[field]) scopedEdits.record(`image:${field}`, editSnapshot.current.draft[field], nextDraft[field]);
      if (imageId && editSnapshot.current.selectedImageId && imageId !== editSnapshot.current.selectedImageId) scopedEdits.record('image:result', editSnapshot.current.selectedImageId, imageId);
    }
    if (nextDraft.mode !== editSnapshot.current.draft.mode) setTextSelection(undefined);
    const next = { draft: nextDraft, selectedImageId: imageId };
    edits.record(editSnapshot.current, next, group); editSnapshot.current = next;
    setDraft(nextDraft); setSelectedImageId(imageId);
  }
  const updateDraft = (changes: Partial<ImageDraft>) => changeImage(updateImageDraft(editSnapshot.current.draft, changes), undefined, Object.keys(changes).length === 1 && ('prompt' in changes || 'refinePrompt' in changes) ? `image-input:${Object.keys(changes)[0]}` : undefined);
  function moveHistory(direction: 'undo' | 'redo') {
    if (busy || importing || saving) return;
    const restored = edits[direction](editSnapshot.current); if (!restored) return;
    scopedEdits.reset(); setTextSelection(undefined);
    const missing = restored.selectedImageId && !images.some(image => image.id === restored.selectedImageId && !image.unavailable && !image.trashedAt);
    const next = missing ? { ...restored, selectedImageId: editSnapshot.current.selectedImageId } : restored;
    editSnapshot.current = next; setDraft(next.draft); setSelectedImageId(next.selectedImageId); setActionError(''); setTemplateOffer(undefined);
    if (missing) props.notify('已恢复编辑参数；历史图片已不在当前列表，请先从文件回收站恢复。已发生费用保留。', 'info');
  }
  function selectPromptText(event: SyntheticEvent<HTMLTextAreaElement>) {
    if (restoringSelection.current) return;
    const element = event.currentTarget;
    const start = element.selectionStart, end = element.selectionEnd;
    selectionElement.current = element;
    const field = draft.mode === 'refine' ? 'refinePrompt' : 'prompt';
    setTextSelection(previous => end > start ? { field, start, end, text: element.value.slice(start, end) } : previous?.field === field && previous.start === start && previous.end === end ? previous : undefined);
  }
  const localField = textSelection ? `image:${textSelection.field}` : 'image:result';
  const localValue = textSelection ? draft[textSelection.field] : selectedImage?.id || '';
  const localStart = textSelection?.start || 0, localEnd = textSelection?.end ?? localValue.length;
  const selectionFresh = !textSelection || localValue.slice(localStart, localEnd) === textSelection.text;
  const staleSelection = { available: false, reason: '选中文字已变化，请重新选择后操作。' };
  const localUndo = selectionFresh ? scopedEdits.inspect('undo', localField, localValue, localStart, localEnd) : staleSelection, localRedo = selectionFresh ? scopedEdits.inspect('redo', localField, localValue, localStart, localEnd) : staleSelection;
  async function moveSelection(direction: 'undo' | 'redo') {
    if (busy || importing || saving || !selectionFresh) return;
    const next = scopedEdits.preview(direction, localField, localValue, localStart, localEnd);
    if (!next.available || next.value === undefined) { if (next.reason) props.notify(next.reason, 'info'); return; }
    if (textSelection) {
      changeImage({ ...editSnapshot.current.draft, [textSelection.field]: next.value }, undefined, undefined, false);
      const start = next.selectionStart ?? localStart, end = next.selectionEnd ?? localEnd;
      setTextSelection({ ...textSelection, start, end, text: next.value.slice(start, end) });
      restoringSelection.current = true;
      if (selectionFrame.current !== undefined) cancelAnimationFrame(selectionFrame.current);
      selectionFrame.current = requestAnimationFrame(() => { const element = selectionElement.current; if (element?.isConnected) { element.focus({ preventScroll: true }); element.setSelectionRange(start, end); } selectionFrame.current = requestAnimationFrame(() => { restoringSelection.current = false; selectionFrame.current = undefined; }); });
    } else {
      const image = images.find(item => item.id === next.value && !item.unavailable && !item.trashedAt);
      if (!image) { props.notify('该历史图片不可用，请先从回收站恢复；当前图片与费用未改动。', 'info'); return; }
      const expected = editSnapshot.current;
      setRestoringImage(true);
      try {
        const files = await runnerRef.current.listProjectArtifacts?.(project.id);
        if (files && !files.some(file => file.id === image.id && !file.unavailable && !file.trashedAt)) throw new Error('历史图片文件已移除，请先恢复文件。');
        const preview = await runnerRef.current.previewArtifact(image.id);
        if (!isImageUrl(preview.dataUrl)) throw new Error('历史图片无法读取，当前图片保留。');
        if (!alive.current || editSnapshot.current !== expected) return;
        changeImage(followGalleryImage(expected.draft, image), image.id, undefined, false);
      } catch (cause) { if (alive.current) props.notify(workflowPublicError(cause, '历史图片未能恢复，当前图片与费用保留。'), 'info'); return; }
      finally { if (alive.current) setRestoringImage(false); }
    }
    scopedEdits[direction](localField, localValue, localStart, localEnd);
  }

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const added = images.find(image => !knownImageIds.current.has(image.id));
    if (added) selectImage(added.id);
    knownImageIds.current = new Set(images.map(image => image.id));
  // A newly returned image becomes visible without replacing the chosen edit source.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds]);
  useEffect(() => {
    try { localStorage.setItem(imageDraftKey(project.id), JSON.stringify(draft)); }
    catch (cause) { if (!warnedStorage.current) { warnedStorage.current = true; setActionError(workflowPublicError(cause, '本次图片草稿无法保存，离开前请复制画面描述。')); } }
  // Each keyed project owns its own non-secret form state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, project.id]);

  useEffect(() => {
    let current = true;
    setReferencePreview(undefined); setReferenceError('');
    if (!draft.references.length) { setCheckingReferences(false); return; }
    if (!runtimeAvailable) { setCheckingReferences(false); setReferenceError('参考图保存在桌面应用中，请打开 EXE 核对，或重新导入、移除参考图。'); return; }
    setCheckingReferences(true);
    void (async () => {
      let firstPreview: string | undefined;
      try {
        for (const [index, reference] of draft.references.entries()) {
          const preview = await runnerRef.current.previewArtifact(reference.id);
          if (!current) return;
          if (!isImageUrl(preview.dataUrl)) throw new Error('image preview unavailable');
          if (!index) firstPreview = preview.dataUrl;
        }
        if (current) setReferencePreview(firstPreview);
      } catch { if (current) setReferenceError('有参考图无法读取，可能已被回收或移动。请重新导入、移除，或先恢复文件后重试；当前参考记录已保留。'); }
      finally { if (current) setCheckingReferences(false); }
    })();
    return () => { current = false; };
  // Names do not change the managed file IDs that must be checked.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceKey, trashedReferenceKey, runtimeAvailable, referenceRevision]);

  useEffect(() => {
    const application = props.promptToApply;
    if (!application || application.projectId !== project.id || appliedPromptToken.current === application.token || !['image', 'general'].includes(application.category)) return;
    appliedPromptToken.current = application.token;
    const template = useTemplates.find(item => item.id === application.imagePreset);
    const current = editSnapshot.current.draft;
    changeImage(application.mode === 'refine' ? { ...current, refinePrompt: application.content, mode: 'refine' } : { ...(template ? selectImageUseTemplate(current, template) : current), prompt: application.content, mode: 'create' });
    setTemplateOffer(undefined); setPromptPickerOpen(false); props.onPromptApplied(application.token);
    revealEditingInput();
  }, [props.promptToApply, props.onPromptApplied, props.configuration.useTemplates, project.id]);

  useEffect(() => {
    const application = props.assetToApply;
    if (!application || application.projectId !== project.id || application.workspaceId !== props.workspaceId || appliedAssetToken.current === application.token || pendingAssetToken.current === application.token || busy || importing || checkingReferences) return;
    let disposed = false; pendingAssetToken.current = application.token;
    void (async () => {
      try {
        assertAssetImage(project.id, application.file);
        const preview = await runnerRef.current.previewArtifact(application.file.id);
        const context = assetContext.current;
        if (disposed || !alive.current || context.workspaceId !== application.workspaceId || context.application?.token !== application.token) return;
        if (!isImageUrl(preview.dataUrl)) throw new Error('素材图片暂不能读取，原参考图与已复制文件保留。');
        changeImage(imageDraftWithAsset(editSnapshot.current.draft, project.id, application.file));
        setTextSelection(undefined); setTemplateOffer(undefined); setActionError(''); appliedAssetToken.current = application.token;
        revealEditingInput();
        context.acknowledge?.(application.token); props.notify('素材已带入精修参考，修改要求和模型可继续调整；点击开始精修前不会收费。');
      } catch (cause) {
        if (!disposed && alive.current && assetContext.current.application?.token === application.token) { appliedAssetToken.current = application.token; setActionError(workflowPublicError(cause, '素材未能带入精修，原参考内容与项目副本保留。')); assetContext.current.acknowledge?.(application.token); }
      } finally { if (pendingAssetToken.current === application.token) pendingAssetToken.current = undefined; }
    })();
    return () => { disposed = true; if (pendingAssetToken.current === application.token) pendingAssetToken.current = undefined; };
  }, [props.assetToApply?.token, props.workspaceId, project.id, busy, importing, checkingReferences]);

  async function useMaterial(file: ArtifactMetadata) {
    if (busy || importing || saving) throw new Error('请等待当前图片操作完成，素材副本保留。');
    assertAssetImage(project.id, file);
    const originalProject = project.id, originalWorkspace = props.workspaceId;
    const preview = await runnerRef.current.previewArtifact(file.id);
    if (!alive.current || assetContext.current.workspaceId !== originalWorkspace || assetContext.current.projectId !== originalProject) throw new Error('当前项目已变化，未修改旧工作台。');
    if (!isImageUrl(preview.dataUrl)) throw new Error('素材图片无法读取，请检查已复制的项目文件。');
    changeImage(imageDraftWithAsset(editSnapshot.current.draft, project.id, file));
    setTextSelection(undefined); setTemplateOffer(undefined); setActionError('');
    revealEditingInput();
    props.notify('素材已带入精修参考，可撤销；点击开始精修才会调用模型。');
  }
  function choosePreset(id: string) {
    const template = useTemplates.find(item => item.id === id);
    if (!template) return;
    changeImage(selectImageUseTemplate(editSnapshot.current.draft, template));
    setTemplateOffer(template.prompt);
  }

  async function importReferences() {
    if (importing || busy) return;
    setImporting(true);
    try {
      const selected = await runnerRef.current.importFiles(project.id);
      if (!alive.current) return;
      const files = selected.filter(file => file.kind === 'image');
      if (!files.length) { if (selected.length) props.notify('请选择图片格式的参考文件。', 'info'); return; }
      if (files.length !== selected.length) props.notify('本次仅使用图片，已忽略其它格式的文件。', 'info');
      if (files.length > MAX_IMAGE_REFERENCES) { props.notify(`每次最多使用 ${MAX_IMAGE_REFERENCES} 张参考图，请重新选择。`, 'error'); return; }
      updateDraft({ references: files.map(({ id, name }) => ({ id, name })) });
    } catch (cause) { if (alive.current) setActionError(workflowPublicError(cause, '参考图导入未完成，请重新选择。')); }
    finally { if (alive.current) setImporting(false); }
  }

  function revealEditingInput() {
    layout.openPanel('ai');
    requestAnimationFrame(() => { if (!alive.current) return; const field = workbench.current?.querySelector<HTMLTextAreaElement>('.ig-prompt'); field?.focus(); field?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); });
  }
  function refineImage(artifact: ArtifactMetadata) {
    setTextSelection(undefined);
    changeImage(updateImageDraft(editSnapshot.current.draft, { mode: 'refine', references: [{ id: artifact.id, name: artifact.name }], galleryBaseId: artifact.id }), artifact.id);
    revealEditingInput();
  }

  function selectImage(id: string) {
    setTextSelection(undefined);
    const image = images.find(item => item.id === id);
    if (image) changeImage(followGalleryImage(editSnapshot.current.draft, image), id);
  }

  async function saveImage(artifact: ArtifactMetadata) {
    if (savingImage.current) return;
    savingImage.current = true;
    setSaving(true);
    try { const result = await runnerRef.current.saveArtifact(artifact.id); if (alive.current && result.saved) props.notify('真实图片已另存，调用费用保持不变。'); }
    catch { if (alive.current) props.notify('图片另存未完成，请检查原文件是否仍存在。', 'error'); }
    finally { savingImage.current = false; if (alive.current) setSaving(false); }
  }

  function generate() {
    if (!ready) return;
    setActionError('');

    props.onGenerate(project.id, draft.mode === 'refine' ? 'AI 精修' : images.length ? '重新生成' : '初次生成', task.count, undefined, { ...task.parameters, credentialId: selectedCredential });
  }
  function chooseImageCredential(value: string) { const choice = studioCredentialChoice(value, currentModel); setCredentialIds(ids => ({ ...ids, [imageCapability]: choice })); if (!saveStudioCredentialPreference(project.id, imageCapability, choice)) props.notify('本次 Key 选择已带入，但偏好暂未保存。', 'info'); }
  function chooseImageModel(value: string) { updateDraft(imageCapability === 'image-editing' ? { editingModelId: value } : { generationModelId: value }); chooseImageCredential(''); }

  function optimizePrompt() {
    const candidates = realModels.filter(item => item.capabilities.includes('text'));
    const model = studioModel(candidates);
    if (!candidates.length) { props.notify('请先添加支持文字生成的模型，再优化描述。', 'info'); props.navigate('models'); return; }

    props.onGenerate(project.id, 'AI 精修', 1, undefined, { prompt: '优化下面的图片创作描述，补清楚主体、构图、风格和需要保留的细节；不要添加未提供的商品参数或身份事实。只输出完整优化后的文本，不生成图片。', input: draft.prompt, capability: 'text', modelConfigId: model?.id });
  }

  async function readOptimization() {
    if (!optimizedPrompt || readingOptimization) return;
    setReadingOptimization(true);
    try {
      const preview = await runnerRef.current.previewArtifact(optimizedPrompt.id);
      if (!preview.text?.trim()) throw new Error('empty text');
      if (alive.current) setOptimization({ id: optimizedPrompt.id, text: preview.text });
    } catch { if (alive.current) props.notify('优化后的描述暂不能读取，请在文件与报告中检查原结果。', 'error'); }
    finally { if (alive.current) setReadingOptimization(false); }
  }

  function savePromptTemplate() {
    const content = draft.mode === 'refine' ? draft.refinePrompt : draft.prompt;
    if (content.trim()) setPromptEditorDraft({ name: `${purpose?.name || '图片'}${draft.mode === 'refine' ? '精修' : '创作'}模板`, description: `来自「${project.name}」的图片指令`, category: 'image', content, mode: draft.mode, imagePreset: draft.preset, businessCategoryId: project.businessCategoryId });
  }

  function inspectImage() {
    const candidates = realModels.filter(item => item.capabilities.includes('vision'));
    const model = studioModel(candidates);
    if (!candidates.length) { props.notify('请先添加支持图像理解的模型。', 'info'); props.navigate('models'); return; }

    props.onGenerate(project.id, 'AI 复核', 1, undefined, { prompt: '检查参考图的文字、人物一致性、主体细节和透明边缘，列出需要人工确认的问题，不声称无法验证的检查已通过。', input: '请检查所选图片。', attachmentIds: selectedImage ? [selectedImage.id] : task.parameters.attachmentIds, modelConfigId: model?.id, capability: 'vision' });
  }
  function fixGeneration(target: StudioActionTarget) {
    if (target === 'models') props.navigate('models');
    else if (target === 'quantity') { layout.openPanel('format'); requestAnimationFrame(() => { const field = workbench.current?.querySelector<HTMLInputElement>('input[aria-label="图像生成数量"]'); field?.focus(); field?.select(); }); }
    else if (target === 'task') props.navigate('activity', project.id);
    else if (target === 'references') { if (runtimeAvailable) void importReferences(); else setActionError('请在 Windows 桌面应用中导入参考图片。'); }
    else { layout.openPanel('ai'); requestAnimationFrame(() => { const field = workbench.current?.querySelector<HTMLElement>(target === 'request' ? '.ig-prompt' : '[role="combobox"][aria-label="图片实际使用模型"]'); field?.focus(); if (target === 'model') field?.click(); }); }
  }
  const actionStatus = <StudioActionStatus id={actionStatusId} issue={generationIssue} error={actionError} note={reviewing ? REVIEW_REPLACEMENT_NOTE : undefined} onFix={fixGeneration} />;

  const imageCredentialControl = <label className="studio-inline-key">调用 Key<Select className="simple-inline-field" aria-label="图片调用Key" value={selectedCredential || ''} onValueChange={chooseImageCredential} options={imageCredentials.map(key => ({ value: key.id, label: key.name }))} placeholder="选择 Key" />{imageKeyIssue && <small role="status">{imageKeyIssue}</small>}</label>;
  const settingsPanel = <>
        <div className="ig-mode-tabs" aria-label="图片操作模式"><button className={draft.mode === 'create' ? 'active' : ''} aria-pressed={draft.mode === 'create'} onClick={() => updateDraft({ mode: 'create' })}><ImagePlus size={17} />生成图片</button><button className={draft.mode === 'refine' ? 'active' : ''} aria-pressed={draft.mode === 'refine'} onClick={() => updateDraft({ mode: 'refine' })}><WandSparkles size={17} />精修图片</button></div>
        <div className="ig-control-body">
          {draft.mode === 'create' && <><label className="ig-field ig-usecase"><span>用途模板 <small>可选</small></span><Select className="field" aria-label="图片用途模板" value={draft.preset} onValueChange={choosePreset} options={[...useTemplates.map(item => ({ value: item.id, label: item.name, group: item.builtin ? '内置用途' : '我的用途' })), ...(!currentPurposeAvailable ? [{ value: draft.preset, label: `${purpose?.name || '原用途'}（已删除或停用）`, disabled: true }] : [])]} /></label><div className="ig-purpose-tools"><button className="ig-link" onClick={() => setPurposeManager('create')}><Plus size={14} />新增用途</button><button className="ig-link" onClick={() => setPurposeManager('manage')}><Settings2 size={14} />管理用途</button></div>{!currentPurposeAvailable && <p className="ig-purpose-missing">此用途已删除或停用，当前项目的描述、设置和参考图仍保留。可继续使用，或选择其它用途。</p>}</>}
          {templateOffer && draft.mode === 'create' && <div className="ig-template-offer"><p>已保留当前描述。确认后才填入用途的默认描述。</p><div><button onClick={() => { updateDraft({ prompt: templateOffer }); setTemplateOffer(undefined); }}>应用用途默认描述</button><button onClick={() => setTemplateOffer(undefined)}>保留原描述</button></div></div>}
          <div className="ig-label-row"><label htmlFor={`image-prompt-${project.id}`}>{draft.mode === 'refine' ? '修改要求' : '画面描述'}</label><button className="ig-link" onClick={() => setPromptPickerOpen(true)}><BookOpen size={14} />提示词模板</button></div>
          <textarea id={`image-prompt-${project.id}`} className="field ig-prompt" onSelect={selectPromptText} value={draft.mode === 'refine' ? draft.refinePrompt : draft.prompt} onChange={event => updateDraft(draft.mode === 'refine' ? { refinePrompt: event.target.value } : { prompt: event.target.value })} placeholder={draft.mode === 'refine' ? '例如：保留人物和构图，清理背景边缘。' : '描述主体、风格、构图，以及需要保留的文字或细节。'} />
          <div className="ig-prompt-actions">{draft.mode === 'create' && <button className="ig-link" disabled={busy || !draft.prompt.trim()} onClick={optimizePrompt}><WandSparkles size={14} />AI 优化描述</button>}<button className="ig-link" disabled={!(draft.mode === 'refine' ? draft.refinePrompt : draft.prompt).trim()} onClick={savePromptTemplate}><Save size={14} />保存提示词</button>{draft.mode === 'create' && <button className="ig-link" disabled={!purpose?.prompt} onClick={() => currentPurposeAvailable ? choosePreset(draft.preset) : setTemplateOffer(purpose?.prompt)}>应用用途模板</button>}</div>
          <ProjectReferences props={{ ...props, activeProject: project }} onUseImages={files => { if (files.length > MAX_IMAGE_REFERENCES) { setActionError(`一次最多使用 ${MAX_IMAGE_REFERENCES} 张参考图，请先移除不需要的引用。`); return; } updateDraft({ mode: 'refine', references: files.map(file => ({ id: file.id, name: file.name })), galleryBaseId: undefined }); }} /><label className="ig-field"><span>{task.parameters.capability === 'image-editing' ? '图片编辑模型' : '图片生成模型'}</span><Select className="field" aria-label="图片实际使用模型" value={currentModel?.id || ''} onValueChange={chooseImageModel} options={currentModels.map(model => ({ value: model.id, label: model.name, description: model.modelId, group: props.configuration.connections.find(connection => connection.id === model.connectionId)?.name }))} placeholder={`选择支持${task.parameters.capability === 'image-editing' ? '图片编辑' : '图片生成'}的模型`} /></label>
          {imageCredentialControl}
          <div className="ig-model-note"><span>{task.parameters.capability === 'image-editing' ? '将发送所列参考图片，使用图片编辑接口。' : '仅发送描述，使用图片生成接口。'}</span><button className="ig-link" onClick={() => props.navigate('models')}><Settings2 size={14} />管理模型与 Key</button></div>
          {!currentModel && <p className="ig-inline-error">请先选择匹配的真实模型。没有可选模型时，前往模型中心配置。</p>}
          {optimizedPrompt && appliedOptimizationId !== optimizedPrompt.id && <section className="ig-optimization"><strong>描述优化结果已返回</strong>{optimization?.id === optimizedPrompt.id ? <><pre>{optimization.text}</pre><button className="btn btn-secondary" onClick={() => { updateDraft({ prompt: optimization.text, mode: 'create' }); setAppliedOptimizationId(optimization.id); setOptimization(undefined); props.notify('已将优化结果应用到画面描述，未调用新模型。'); }}><Check size={15} />应用到画面描述</button></> : <button className="ig-link" disabled={readingOptimization} onClick={() => { void readOptimization(); }}>{readingOptimization ? <LoaderCircle size={14} className="spin" /> : <FileText size={14} />}查看并应用</button>}</section>}
          <button className="btn btn-secondary ig-full-button" disabled={busy || importing || saving} onClick={() => layout.openPanel('assets')}><ImagePlus size={16} />从素材库选择</button><div className="ig-label-row"><span>{draft.mode === 'refine' ? '精修来源' : '参考图片'} <small>{draft.mode === 'create' ? draft.preset === '试衣图' ? '人物与服装至少各一张' : purpose?.minReferences ? `至少 ${purpose.minReferences} 张` : '可选' : ''}</small></span><button className="ig-link" disabled={busy || importing || !runtimeAvailable} onClick={() => { void importReferences(); }}>{importing ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}{draft.references.length ? '重新导入' : '导入图片'}</button></div>
          {draft.references.length ? <div className="ig-reference-group">{referencePreview && <img className="ig-reference-preview" src={referencePreview} alt={`参考图 ${draft.references[0].name}`} />}<div className="ig-reference-list">{draft.references.map((reference, index) => <div key={reference.id}><span title={reference.name}>{index + 1}. {reference.name}</span><button aria-label={`移除参考图 ${reference.name}`} disabled={busy || importing} onClick={() => updateDraft({ references: draft.references.filter(item => item.id !== reference.id) })}><X size={15} /></button></div>)}</div></div> : draft.mode === 'refine' && selectedImage ? <div className="ig-selected-reference"><ImagePlus size={19} /><span><b>使用当前所选图片</b><small>{selectedImage.name}</small></span></div> : <div className="ig-reference-empty"><Upload size={21} /><p>{draft.mode === 'refine' ? '在左侧选择一张生成图，或导入要修改的图片。' : '可导入人物、产品或风格参考图。'}</p></div>}
          {checkingReferences && <p className="ig-inline-note" role="status"><LoaderCircle size={14} className="spin" />正在核对本机参考图…</p>}{referenceError && <div className="ig-inline-error" role="alert"><p>{referenceError}</p>{runtimeAvailable && <button className="ig-link" onClick={() => setReferenceRevision(value => value + 1)}>重新核对</button>}</div>}{!runtimeAvailable && <p className="ig-inline-note">真实参考图请在 Windows EXE 中导入。</p>}
          <RememberedDetails rememberKey="images:advanced" className="ig-advanced"><summary><Settings2 size={16} /><b>更多设置</b><span>{IMAGE_SIZES.find(item => item.value === draft.size)?.label.split(' · ')[0]} · {quantityLabel}{task.parameters.imageBackground === 'transparent' ? ' · 透明' : ''}</span><ChevronDown size={16} /></summary><div><label className="ig-field"><span>画面比例与尺寸</span><Select className="field" aria-label="图像输出尺寸" value={draft.size} onValueChange={value => updateDraft({ size: value })} options={IMAGE_SIZES} /></label><ImageQuantityField value={draft.quantity} onChange={quantity => updateDraft({ quantity })} disabled={busy || importing} /><label className="ig-field"><span>背景</span><Select className="field" aria-label="图像输出背景" disabled={purpose?.background === 'transparent'} value={task.parameters.imageBackground} onValueChange={value => updateDraft({ background: value as ImageDraft['background'] })} options={[{ value: 'auto', label: '自动' }, { value: 'opaque', label: '不透明背景' }, { value: 'transparent', label: '透明背景 PNG' }]} /></label><p className="ig-inline-note">{purpose?.background === 'transparent' ? '该用途要求透明 PNG 背景；尺寸以模型支持范围为准，多张图片会逐张生成。' : '尺寸和透明背景以所选模型支持范围为准，多张图片会逐张生成。'}</p><button className="btn btn-secondary ig-full-button" disabled={busy || checkingReferences || Boolean(referenceError) || !selectedImage && !task.parameters.attachmentIds.length} onClick={inspectImage}><ShieldCheck size={16} />AI 检查图片</button></div></RememberedDetails>
          <RememberedDetails rememberKey="images:custom-actions" className="ig-custom-actions"><summary><Sparkles size={16} />我的自定义功能<ChevronDown size={16} /></summary><StudioActions props={props} studio="images" projectId={project.id} outputKind="image" input={draft.mode === 'refine' ? draft.refinePrompt : draft.prompt} attachmentIds={task.parameters.attachmentIds} /></RememberedDetails>
        </div>
        <footer className="ig-primary-action">{project.budgetCents != null && <p className="ig-budget">项目金额上限：{budgetLabel(project.budgetCents)}</p>}<button className={`btn ${selectedImage ? 'btn-secondary' : 'btn-primary'}`} disabled={needsModelSetup ? busy || importing || checkingReferences : !ready} aria-label={needsModelSetup ? "配置图片模型" : generationLabel} aria-describedby={generationIssue || actionError || reviewing ? actionStatusId : undefined} onClick={() => needsModelSetup ? props.navigate('models') : generate()}>{busy && active?.status !== 'paused' ? <LoaderCircle size={17} className="spin" /> : draft.mode === 'refine' ? <WandSparkles size={17} /> : <Sparkles size={17} />}{needsModelSetup ? '配置图片模型' : generationLabel}</button>{actionStatus}<p>{quantityValid && draft.quantity > 1 ? `逐张生成 ${draft.quantity} 张${draft.mode === 'refine' ? '，每张使用相同原图精修' : ''}，花费按每次实际调用累计。` : '直接使用所选模型与参考图生成，花费按实际用量自动累计。'}{draft.preset === '试衣图' ? '试衣结果仅作视觉示意。' : ''}</p></footer>
  </>;
  useEditorShortcuts(workbench, !busy && !importing && !saving, { save: async () => { if (!selectedImage) return false; await saveImage(selectedImage); return true; }, undo: () => moveHistory('undo'), redo: () => moveHistory('redo') }, target => target instanceof HTMLTextAreaElement && target.classList.contains('ig-prompt'));

  function openTool(tool: StudioTool) {
    if (tool === 'ai' && selectedImage && draft.mode === 'create') { refineImage(selectedImage); return; }
    layout.togglePanel(tool);
  }
  useStudioToolRequests(props.workspaceId, project.id, tool => { layout.openPanel(tool); });
  const formatTools = <><div className="sw-image-properties"><strong>{selectedImage ? selectedImage.name : '图片输出设置'}</strong><p>{selectedImage ? selectedImage.mimeType + ' · ' + (selectedImage.bytes / 1024).toFixed(0) + ' KB' : '首张图片完成后可在这里查看实际规格。'}</p>{imageMetadata.id === selectedImage?.id && imageMetadata.width && imageMetadata.height && <p>实际尺寸：{imageMetadata.width} × {imageMetadata.height}</p>}</div><label>画面比例与尺寸<Select aria-label="图像输出尺寸" value={draft.size} onValueChange={value => updateDraft({ size: value })} options={IMAGE_SIZES} /></label><ImageQuantityField value={draft.quantity} onChange={quantity => updateDraft({ quantity })} disabled={busy || importing} /><label>输出背景<Select aria-label="图像输出背景" disabled={purpose?.background === 'transparent'} value={task.parameters.imageBackground} onValueChange={value => updateDraft({ background: value as ImageDraft['background'] })} options={[{ value: 'auto', label: '自动' }, { value: 'opaque', label: '不透明背景' }, { value: 'transparent', label: '透明背景 PNG' }]} /></label><p>选择设置不会改动现有图片；下一次明确生成或精修时使用。尺寸与透明背景以模型支持范围为准。</p><button type="button" className="btn btn-secondary" disabled={busy || !selectedImage} onClick={inspectImage}><ShieldCheck size={15} />AI 检查当前图片</button><p>AI 检查会新增一次模型调用并记录费用。</p></>;
  const versions = <><div className="sw-scope-label">左侧保留本项目全部实际图片结果，切换或撤销不重新调用模型。</div>{selectedImage && <><strong>{selectedImage.name}</strong><p>{selectedImage.mimeType} · {(selectedImage.bytes / 1024).toFixed(0)} KB</p><div className="sw-panel-actions"><button type="button" className="btn btn-secondary" disabled={busy || importing || saving} onClick={() => refineImage(selectedImage)}><WandSparkles size={15} />作为精修基底</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => { void saveImage(selectedImage); }}><Download size={15} />另存原图</button></div></>}{creationPrompt && <RememberedDetails rememberKey="images:source-description"><summary>查看当时的画面描述</summary><p>{creationPrompt}</p></RememberedDetails>}<p>结果与原图始终保留。当前表单、参考来源和图片选择支持撤销与重做；历史费用不会减少。</p></>;
  const assets = <Suspense fallback={<p role="status">正在打开素材…</p>}><StudioAssetPicker embedded props={{ ...props, activeProject: project }} title="选择图片参考素材" description="作为固定精修参考，保留当前结果；不会自动生成或收费。" confirmLabel="作为精修参考" onClose={revealEditingInput} onChoose={useMaterial} /></Suspense>;
  const files = <><ArtifactResults artifacts={artifacts} runner={props.workflowRunner} projectId={project.id} onUseReference={refineImage} /><p>项目调用费用</p><CostTotal summary={costSummary} /><p>生成、精修和检查按每次真实调用累计；手工修改、导出和撤销不减少费用。</p></>;
  const deliveryTools = <><p>导出当前所选真实图片，再按需完成当前版本的人工验收。</p><button type="button" className="btn btn-secondary" disabled={!selectedImage || saving} onClick={() => { if (selectedImage) void saveImage(selectedImage); }}><Download size={15} />另存当前图片</button></>;
  const panel = layout.tool === 'ai' ? <div className="sw-ai-fields">{settingsPanel}</div> : layout.tool === 'format' ? formatTools : layout.tool === 'assets' ? assets : layout.tool === 'versions' ? versions : layout.tool === 'files' ? files : deliveryTools;
  return <div ref={workbench} className="sw-editor-root image-studio-page">
    <StudioWorkbench projectName={project.name} kind="image" titleActions={<button type="button" className="btn btn-ghost" onClick={() => setGroupBatchOpen(true)}><Layers3 size={16} />分组批量生成</button>} layout={layout} onTool={openTool} saveStatus={busy ? '正在制作，已发生费用保留' : selectedImage ? '真实图片已保存到当前项目' : '尚未生成图片 · 可以先添加参考'} selectionLabel={draft.mode === 'refine' && draft.references.length ? isGalleryImageBase(draft) ? '精修基底跟随当前结果' : draft.references.length + ' 份固定精修参考' : selectedImage ? '当前所选图片：' + selectedImage.name : '未选择图片'} navigation={<ImageHistoryNavigation images={images} selectedId={selectedImage?.id} runner={props.workflowRunner} onSelect={selectImage} />} navigationLabel="图片结果" panel={panel} selectionTools={<>{(textSelection || selectedImage && (localUndo.available || localRedo.available)) && <SelectionHistoryToolbar label={textSelection ? '选中的图片描述文字' : '当前图片'} exactSelection={!!textSelection} selectedCount={textSelection ? Array.from(localValue.slice(localStart, localEnd)).length : 0} image={!textSelection} selectionPreview={textSelection ? localValue.slice(localStart, localEnd) : selectedImage?.name} canUndo={localUndo.available} canRedo={localRedo.available} reason={!localUndo.available && !localRedo.available ? localUndo.reason : undefined} disabled={busy || importing || saving} onUndo={() => { void moveSelection('undo'); }} onRedo={() => { void moveSelection('redo'); }} onClearSelection={textSelection ? () => setTextSelection(undefined) : undefined} />}</>} cost={<CostTotal summary={costSummary} />} busy={busy || importing || saving} exporting={saving} canUndo={edits.canUndo} canRedo={edits.canRedo} canExport={!!selectedImage} onUndo={() => moveHistory('undo')} onRedo={() => moveHistory('redo')} onExport={() => { if (selectedImage) void saveImage(selectedImage); }} deliveryPanel={selectedImage && <DeliveryPanel inline visible={layout.tool === 'delivery' && layout.rightOpen && !layout.focus} projectId={project.id} kind="image" artifactIds={[selectedImage.id]} deliveryContext={project.lastLiveStateSignature} onDelivered={(receipt, selection) => props.onProjectDelivered ? props.onProjectDelivered(project.id, receipt, selection) : props.onUpdateProject(project.id, { status: 'complete', updatedAt: new Date().toISOString() })} onInvalidated={() => { if (project.confirmedDelivery) props.onUpdateProject(project.id, { confirmedDelivery: undefined, ...(project.status === 'complete' ? { status: 'review' as const } : {}) }); }} sourceRevision={JSON.stringify({ id: selectedImage.id, target: deliveryTarget })} checks={imageDeliveryChecks({ ...(imageMetadata.id === selectedImage.id ? imageMetadata : {}), expectedSize: deliveryTarget.size, requiresTransparency, mimeType: selectedImage.mimeType, artifactAvailable: true })} />} >
      <ImageGallery hideActions showHistory={false} onCreate={() => layout.openPanel('ai')} reference={draft.mode === 'refine' && draft.references.length ? { name: draft.references[0].name, url: referencePreview, loading: checkingReferences, error: referenceError } : undefined} onImageReady={inspectImageMetadata} images={images} selectedId={selectedImage?.id} runner={props.workflowRunner} onSelect={selectImage} onRefine={refineImage} onSave={artifact => { void saveImage(artifact); }} saving={saving} canRefine={!busy && !importing} />
    </StudioWorkbench>
    {groupBatchOpen && <Suspense fallback={<p role="status">正在打开分组生成…</p>}><ImageGroupBatchPanel key={props.workspaceId + '/' + project.id} props={props} project={project} settings={{ model: generationModel, credentialId: groupCredential, size: draft.size, background: task.parameters.imageBackground }} busy={busy || importing || saving} onClose={() => setGroupBatchOpen(false)} /></Suspense>}
    {purposeManager && <PurposeTemplates templates={props.configuration.useTemplates || []} workspaceId={props.workspaceId} workspaceName={props.workspace.name} initialMode={purposeManager} onSave={props.configuration.saveUseTemplate} onDelete={props.configuration.deleteUseTemplate} onClose={() => setPurposeManager(undefined)} />}
    {promptPickerOpen && <PromptPicker useTemplates={props.configuration.useTemplates} prompts={props.prompts} category="image" onClose={() => setPromptPickerOpen(false)} onUse={(template, content) => { props.onUsePrompt(template, content); setPromptPickerOpen(false); }} />}
    {promptEditorDraft && <PromptEditor categories={props.configuration.categories} useTemplates={props.configuration.useTemplates} initial={promptEditorDraft} onClose={() => setPromptEditorDraft(null)} onSave={(value, id) => { props.onSavePrompt(value, id); setPromptEditorDraft(null); }} />}
  </div>;
}
