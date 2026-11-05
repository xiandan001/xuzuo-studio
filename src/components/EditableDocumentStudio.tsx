import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, History, ImagePlus, LoaderCircle, Save, Sparkles } from 'lucide-react';
import type { PageProps, PromptDraft } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { EditorDocument, EditorKind, EditorRecord, EditorVersionInfo } from '../editor-types';
import { emptyEditorDocument, editorFromText, editorPlainText, legacyEditorDocument, newWordBlock, withSlideLayout } from '../lib/editor-document';
import { latestProjectContentArtifact, latestProjectArtifacts, ArtifactResults } from './ArtifactResults';
import { isProductionRun } from '../lib/workflow-purpose';
import { WordEditor, WordFormattingTools, WordOutline } from './WordEditor';
import { PresentationEditor, PresentationFormattingTools, PresentationNavigation } from './PresentationEditor';
import { CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { Select } from './Select';
import { PromptEditor, PromptPicker } from './PromptDialogs';
import { RememberedDetails } from './RememberedDetails';
import { StudioActions } from './StudioActions';
import { useStudioLayout } from '../hooks/useStudioLayout';
import { StudioWorkbench } from './StudioWorkbench';
import { useStudioToolRequests } from '../hooks/useStudioToolRequests';
import { useDocumentImagePreviews } from '../hooks/useDocumentImagePreviews';
import type { StudioTool } from '../lib/studio-commands';
import { VersionTimeline } from './VersionTimeline';
import { documentStudioFormKey, readDocumentStudioForm } from '../lib/document-studio-state';
import { workflowPublicError } from '../lib/studio-run';
import { latestStudioBinding, readStudioCredentialPreference, saveStudioCredentialPreference, studioCredentialChoice, studioProjectCredential, studioProjectModel } from '../lib/studio-project-bindings';
import { DOCUMENT_IMAGE_LIMIT, documentImageModels, validDocumentImageCount } from '../lib/document-illustrations';
import type { DocumentImageMode } from '../lib/document-illustrations';
import { replaceDocumentImage, selectedDocumentImage } from '../lib/document-image-edit';
import type { DocumentImageTarget } from '../lib/document-image-edit';
import { documentFieldChanges, documentFieldValue } from '../lib/document-fields';
import { assertAssetImage, insertDocumentAsset, insertWorkbenchAsset } from '../lib/asset-application';
import { DocumentIllustrationOptions } from './DocumentIllustrationOptions';
import { DocumentImageTools } from './DocumentImageTools';
import { REVIEW_REPLACEMENT_NOTE, studioActionIssue } from '../lib/studio-action-status';
import type { StudioActionTarget } from '../lib/studio-action-status';
import { StudioActionStatus } from './StudioActionStatus';
import { DeliveryPanel } from './DeliveryPanel';
import { editorDeliveryChecks } from '../lib/delivery-quality';
import { canAutoLoadEditorSource, isPristineEditorDocument } from '../lib/editor-first-open';
import { conflictKey, loadProtectedEditorRecovery, preserveEditorDraft, readRecovery, recoveryDrafts, recoveryKey } from '../lib/editor-recovery';
import type { RecoveryDraft } from '../lib/editor-recovery';
import { editorExportArtifacts } from '../lib/editor-export-proof';
import type { EditorExportProof } from '../lib/editor-export-proof';
import { isWorkspaceConnectionError, WorkspaceConnectionRecovery } from './WorkspaceConnectionRecovery';
import { useEditHistory } from '../hooks/useEditHistory';
import { useDocumentSelectionHistory } from '../hooks/useDocumentSelectionHistory';
import { useRecoveryDraft } from '../hooks/useRecoveryDraft';
import { editorTypingGroup } from '../lib/editor-typing-group';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { registerEditorSession } from '../lib/editor-session-guard';
import { RecoveryDraftNotice } from './RecoveryDraftNotice';
import { ProjectReferences } from './ProjectReferences';
import { LocalRefinement } from './LocalRefinement';
import { applyDocumentRefinement, documentRefinementTargets } from '../lib/local-refinement';
import './document-editor.css';
const StudioAssetPicker = lazy(() => import('./StudioAssetPicker').then(module => ({ default: module.StudioAssetPicker })));
const OfficeFilePreview = lazy(() => import('./OfficeFilePreview').then(module => ({ default: module.OfficeFilePreview })));

function selectedContentId(document: EditorDocument) { return document.kind === 'word' ? document.blocks[0]?.id || '' : document.slides[0]?.id || ''; }
interface DocumentHistorySnapshot { document: EditorDocument; sourceArtifactIds: string[]; selectedId: string; }
export function EditableDocumentStudio(props: PageProps) {
  const project = props.activeProject;
  const layout = useStudioLayout('documents');
  const [initialForm] = useState(() => readDocumentStudioForm(localStorage.getItem(documentStudioFormKey(project.id)), project.description));
  const [formProjectId, setFormProjectId] = useState(project.id);
  const kind: EditorKind = project.kind === 'word' ? 'word' : 'ppt';
  const [document, setDocument] = useState<EditorDocument>(() => emptyEditorDocument(kind, project.name));
  const [record, setRecord] = useState<EditorRecord | null>(null);
  const [localExport, setLocalExport] = useState<EditorExportProof>();
  const [sourceArtifactIds, setSourceArtifactIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [refineScope, setRefineScope] = useState('current');
  const [selectedCellId, setSelectedCellId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const persisting = useRef(false);
  const [ready, setReady] = useState(false);
  const [reload, setReload] = useState(0);
  const [conflictDraft, setConflictDraft] = useState<RecoveryDraft>();
  const [assetRecoveryResolved, setAssetRecoveryResolved] = useState(false);
  const [selectedRecovery, setSelectedRecovery] = useState('0');
  const [loadingSource, setLoadingSource] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [materialPicker, setMaterialPicker] = useState<{ projectId: string; workspaceId: string; selectedId: string; epoch: number; imageId?: string; replace?: DocumentImageTarget }>();
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const workbench = useRef<HTMLDivElement>(null);
  const [brief, setBrief] = useState(initialForm.brief);
  const [instruction, setInstruction] = useState(initialForm.instruction);
  const [modelId, setModelId] = useState(initialForm.modelId);
  const [credentialId, setCredentialId] = useState(() => readStudioCredentialPreference(project.id, 'text'));
  const [imageMode, setImageMode] = useState<DocumentImageMode>(initialForm.imageMode);
  const [imageModelId, setImageModelId] = useState(initialForm.imageModelId);
  const [imageCredentialId, setImageCredentialId] = useState(initialForm.imageCredentialId);
  const [imageCount, setImageCount] = useState<number>(initialForm.imageCount);
  const [imageIds, setImageIds] = useState<string[]>(initialForm.imageIds);
  const [inspector, setInspector] = useState<'create' | 'refine' | 'history'>(initialForm.inspector);
  const [history, setHistory] = useState<EditorVersionInfo[]>([]);
  const [comparisonRevision, setComparisonRevision] = useState<number>();
  const [officePreview, setOfficePreview] = useState<ArtifactMetadata>();
  const previewAfterExport = useRef(false);
  const [recoveryVersion, setRecoveryVersion] = useState<EditorRecord>();
  const edits = useEditHistory<DocumentHistorySnapshot>();
  const [images, setImages] = useState<ArtifactMetadata[]>([]);
  const [showImageTools, setShowImageTools] = useState(false);
  const [promptPicker, setPromptPicker] = useState(false);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const loadEpoch = useRef(0);
  const manualEdits = useRef(0);
  const composing = useRef(false);
  const sourceRequest = useRef(0);
  const loadingSourceRequest = useRef<number | undefined>(undefined);
  const autoSourceAttempt = useRef('');
  const current = useRef({ projectId: project.id, document, record, sourceArtifactIds, dirty });
  current.current = { projectId: project.id, document, record, sourceArtifactIds, dirty };
  const scopedEdits = useDocumentSelectionHistory({ document, selectedId, selectedCellId, enabled: ready && !busy, onApply: applyScopedDocument });
  const source = latestProjectContentArtifact(props.workflowRunner.runs, project.id);
  const sourceRef = useRef(source); sourceRef.current = source;
  const runnerRef = useRef(props.workflowRunner); runnerRef.current = props.workflowRunner;
  const notifyRef = useRef(props.notify); notifyRef.current = props.notify;
  const appliedPrompt = useRef<string | undefined>(undefined);
  const appliedAsset = useRef<string | undefined>(undefined), pendingAsset = useRef<string | undefined>(undefined);
  const assetContext = useRef({ application: props.assetToApply, workspaceId: props.workspaceId, selectedId, acknowledge: props.onAssetApplied });
  assetContext.current = { application: props.assetToApply, workspaceId: props.workspaceId, selectedId, acknowledge: props.onAssetApplied };
  const bridge = window.desktop?.editor;
  const models = props.configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes('text') && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
  const quickFlowId = `quick-${project.id}-text-${inspector === 'refine' ? 'refine' : 'create'}`;
  const quickModelId = props.configuration.workflows.find(flow => flow.id === quickFlowId)?.steps[0]?.modelConfigId;
  const inheritedText = latestStudioBinding(props.workflowRunner.runs, props.workspaceId, project.id, 'text') || props.configuration.workflows.find(flow => flow.id === quickFlowId)?.steps[0];
  const selectedModel = studioProjectModel(models, modelId, inheritedText);
  const textCredentials = (props.configuration.credentials || []).filter(key => key.enabled && key.connectionId === selectedModel?.connectionId);
  const selectedCredential = studioProjectCredential(textCredentials, selectedModel, credentialId, inheritedText);
  const textKeyIssue = selectedModel && !selectedCredential ? '请选择本次调用的 Key；原选择可能已停用，当前不会换用其他账户。' : '';
  const pictureModels = documentImageModels(props.configuration);
  const inheritedPicture = latestStudioBinding(props.workflowRunner.runs, props.workspaceId, project.id, 'image-generation');
  const pictureModel = studioProjectModel(pictureModels, imageModelId, inheritedPicture);
  const pictureCredentials = props.configuration.credentials.filter(item => item.enabled && item.connectionId === pictureModel?.connectionId);
  const pictureCredential = studioProjectCredential(pictureCredentials, pictureModel, imageCredentialId, inheritedPicture);
  const availableImages = images.filter(image => image.projectId === project.id && !image.trashedAt && !image.unavailable && !props.workflowRunner.trashedArtifacts?.some(item => item.id === image.id) && ['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType));
  const chosenImages = imageIds.filter(id => availableImages.some(image => image.id === id));
  const illustrationIssue = imageMode === 'generate' ? !validDocumentImageCount(imageCount) ? `配图数量请填写 1–${DOCUMENT_IMAGE_LIMIT} 的整数。` : !pictureModel ? '请选择图片生成模型。' : !pictureCredential ? '请为配图模型选择启用的 Key。' : '' : imageMode === 'references' && !chosenImages.length ? '请选择至少一张项目图片。' : '';
  const selectedPicture = selectedDocumentImage(document, selectedId);
  const { previews, previewErrors, rememberPreview, retryPreviews } = useDocumentImagePreviews({ scope: props.workspaceId + '/' + project.id, document, selectedId, selectedImageId: selectedPicture?.imageId, allowedIds: availableImages.map(image => image.id), enabled: ready, root: workbench, read: id => (props.workflowRunner.thumbnailArtifact || props.workflowRunner.previewArtifact)(id) });
  const refining = inspector === 'refine';
  const hasResult = !isPristineEditorDocument(document, project.name);
  const generationTask = props.workflowRunner.runs.find(run => isProductionRun(run) && run.projectId === project.id && ['running', 'paused'].includes(run.status));
  const reviewing = props.workflowRunner.runs.some(run => run.projectId === project.id && run.status === 'waiting-review');
  const generationIssue = studioActionIssue({ ready, busy, taskStatus: generationTask?.status, input: refining ? instruction : brief, inputLabel: refining ? '修改指令' : '创作需求', modelId: selectedModel?.id, modelCount: models.length });
  const actionStatusId = `document-action-status-${project.id}`;
  const previousQuickModels = useRef(new Map<string, string | undefined>());
  const realArtifacts = latestProjectArtifacts(props.workflowRunner.runs, project.id);
  const currentExport = editorExportArtifacts(project.id, kind, record?.revision, props.workflowRunner.runs, localExport, props.workflowRunner.trashedArtifacts);
  useEffect(() => { previewAfterExport.current = false; setOfficePreview(undefined); setComparisonRevision(undefined); }, [project.id]);
  useEffect(() => { if (previewAfterExport.current && ready && !dirty && currentExport[0]) { previewAfterExport.current = false; setOfficePreview(currentExport[0]); } }, [currentExport, ready, dirty]);
  const exportRegistryKnown = Array.isArray(props.workflowRunner.trashedArtifacts) || localExport?.projectId === project.id && localExport.revision === record?.revision;
  const exported = !record || dirty ? false : exportRegistryKnown ? currentExport.length > 0 : undefined;
  const recoveryPayload = useMemo(() => ({ document, sourceArtifactIds, baseRevision: record?.revision || 0 }), [document, sourceArtifactIds, record?.revision]);
  const recovery = useRecoveryDraft(recoveryKey(project.id), recoveryPayload, ready, `${project.name}-恢复稿.json`, () => ({ document: current.current.document, sourceArtifactIds: current.current.sourceArtifactIds, baseRevision: current.current.record?.revision || 0 }));
  const guardRef = useRef<{ dirty: boolean; pending: boolean; persistenceError: string; save: () => Promise<boolean>; exportRecovery: () => boolean | Promise<boolean> }>({ dirty, pending: !!busy, persistenceError: '', save: async () => false, exportRecovery: () => false });
  useEffect(() => registerEditorSession({ id: `document-${project.id}`, projectId: project.id, label: project.name, getState: () => ({ dirty: guardRef.current.dirty, pending: guardRef.current.pending || composing.current, persistenceError: guardRef.current.dirty ? guardRef.current.persistenceError : undefined }), save: () => guardRef.current.save(), flushRecovery: () => recovery.retry(), exportRecovery: () => guardRef.current.exportRecovery() }), [project.id, project.name]);
  const cost = summarizeCosts(props.ledger.filter(entry => entry.projectId === project.id && entry.billingMode === 'live'));

  useEffect(() => {
    if (formProjectId === project.id) return;
    const saved = readDocumentStudioForm(localStorage.getItem(documentStudioFormKey(project.id)), project.description);
    setBrief(saved.brief); setInstruction(saved.instruction); setModelId(saved.modelId); setInspector(saved.inspector); setImageMode(saved.imageMode); setImageModelId(saved.imageModelId); setImageCredentialId(saved.imageCredentialId); setImageCount(saved.imageCount); setImageIds(saved.imageIds); setFormProjectId(project.id);
  }, [project.id, project.description, formProjectId]);
  useEffect(() => {
    if (formProjectId !== project.id) return;
    try { localStorage.setItem(documentStudioFormKey(project.id), JSON.stringify({ version: 1, brief, instruction, modelId, inspector, imageMode, imageModelId, imageCredentialId, imageCount, imageIds })); } catch { /* The visible form is retained; explicit beforeRun reports a save failure. */ }
  }, [brief, instruction, modelId, inspector, imageMode, imageModelId, imageCredentialId, imageCount, imageIds, project.id, formProjectId]);
  useEffect(() => {
    const seen = previousQuickModels.current.has(quickFlowId), previous = previousQuickModels.current.get(quickFlowId);
    previousQuickModels.current.set(quickFlowId, quickModelId);
    if (seen && quickModelId !== previous && models.some(model => model.id === quickModelId)) setModelId(quickModelId!);
  }, [quickFlowId, quickModelId, models]);

  useEffect(() => {
    const projectId = project.id; let disposed = false; loadEpoch.current++; sourceRequest.current++; manualEdits.current = 0; autoSourceAttempt.current = '';
    setReady(false); setError(''); setRecoveryNotice(''); setBusy('load'); setDirty(false); setRecord(null); setLocalExport(undefined); setImages([]); setHistory([]); setShowImageTools(false); setConflictDraft(undefined); setAssetRecoveryResolved(false); setSelectedRecovery('0'); setLoadingSource('');
    edits.reset(); scopedEdits.reset(); setRecoveryVersion(undefined);
    const fallback = emptyEditorDocument(kind, project.name); setDocument(fallback); setSelectedId(selectedContentId(fallback)); setSourceArtifactIds([]);
    void (async () => {
      try {
        const saved = bridge ? await bridge.load({ projectId, kind, title: project.name }) : null;
        if (disposed) return;
        const recovery = loadProtectedEditorRecovery(localStorage, projectId, kind, !!saved), recovered = recovery.draft;
        if (recovery.notice) setRecoveryNotice(recovery.notice);
        let conflict = readRecovery(localStorage, projectId, kind, conflictKey(projectId));
        if (saved && recovered && recovered.baseRevision !== saved.revision && JSON.stringify(recovered.document) !== JSON.stringify(saved.document)) {
          conflict = preserveEditorDraft(localStorage, projectId, recovered);
        }
        let next = saved?.document || recovered?.document || legacyEditorDocument(projectId, kind, project.name) || fallback;
        let sources = saved?.sourceArtifactIds || recovered?.sourceArtifactIds || [];
        let unsaved = !saved && !!(recovered || legacyEditorDocument(projectId, kind, project.name));
        if (saved && recovered && recovered.baseRevision === saved.revision && JSON.stringify(recovered.document) !== JSON.stringify(saved.document)) { next = recovered.document; sources = recovered.sourceArtifactIds; unsaved = true; }
        setRecord(saved); setDocument(next); setSelectedId(selectedContentId(next)); setSourceArtifactIds(sources); setDirty(unsaved); setConflictDraft(conflict); setReady(true);
        if (saved) { const versions = bridge ? await bridge.history({ projectId }) : []; if (!disposed) setHistory(versions); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '编辑源读取失败，原文件已保留。');
        if (bridge) { try { const versions = await bridge.history({ projectId }); if (!disposed) setHistory(versions); } catch { /* Keep the load error and original source when no independent history is available. */ } }
      }
      finally { if (!disposed) setBusy(''); }
    })();
    return () => { disposed = true; loadEpoch.current++; };
  // Persisted source loads on project changes; the separate generated-source effect protects manual edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, kind, bridge, props.workspace.directory, reload]);
  useEffect(() => {
    if (!source || !ready || busy || autoSourceAttempt.current === source.id || !canAutoLoadEditorSource(document, project.name, record, sourceArtifactIds, manualEdits.current)) return;
    const projectId = project.id, sourceId = source.id, epoch = loadEpoch.current, editVersion = manualEdits.current, request = ++sourceRequest.current;
    let disposed = false; autoSourceAttempt.current = sourceId; loadingSourceRequest.current = request; setLoadingSource(sourceId);
    void (async () => {
      try {
        const preview = await runnerRef.current.previewArtifact(sourceId);
        if (typeof preview.text !== 'string' || !preview.text.trim()) throw new Error('这份生成结果没有可编辑正文，请检查原文件。');
        const next = editorFromText(kind, project.name, preview.text), snapshot = current.current;
        if (disposed || request !== sourceRequest.current || loadEpoch.current !== epoch || snapshot.projectId !== projectId || sourceRef.current?.id !== sourceId || manualEdits.current !== editVersion || !canAutoLoadEditorSource(snapshot.document, project.name, snapshot.record, snapshot.sourceArtifactIds, manualEdits.current)) return;
        localStorage.setItem(recoveryKey(projectId), JSON.stringify({ document: next, sourceArtifactIds: [sourceId], baseRevision: snapshot.record?.revision || 0 }));
        change(next, false, [sourceId]); setSelectedId(selectedContentId(next));
      } catch (cause) { if (!disposed && request === sourceRequest.current && current.current.projectId === projectId && loadEpoch.current === epoch) setError(cause instanceof Error ? cause.message : '生成正文读取未完成，当前文稿保留。'); }
      finally { if (!disposed && request === sourceRequest.current) { loadingSourceRequest.current = undefined; setLoadingSource(''); } }
    })();
    return () => { disposed = true; if (loadingSourceRequest.current === request) loadingSourceRequest.current = undefined; if (sourceRequest.current === request) setLoadingSource(''); };
  // A new completed source is observed in-place. A manual change during the read invalidates adoption.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, ready, busy, project.id, kind, record?.revision]);
  useEffect(() => {
    const application = props.promptToApply;
    if (!application || application.projectId !== project.id || appliedPrompt.current === application.token || ![kind, 'general'].includes(application.category)) return;
    appliedPrompt.current = application.token;
    layout.openPanel('ai');
    if (application.mode === 'refine') { setInstruction(application.content); setInspector('refine'); } else { setBrief(application.content); setInspector('create'); }
    props.onPromptApplied(application.token);
  }, [props.promptToApply, props.onPromptApplied, project.id, kind]);
  useEffect(() => {
    const application = props.assetToApply;
    if (!application || application.workspaceId !== props.workspaceId || application.projectId !== project.id || appliedAsset.current === application.token || pendingAsset.current === application.token || !ready || busy || loadingSource || loadingSourceRequest.current !== undefined || (conflictDraft && !assetRecoveryResolved)) return;
    const epoch = loadEpoch.current; let disposed = false; pendingAsset.current = application.token;
    void (async () => {
      try {
        assertAssetImage(project.id, application.file, true);
        const preview = await runnerRef.current.previewArtifact(application.file.id);
        if (!preview.dataUrl?.startsWith('data:image/')) throw new Error('素材图片暂不能读取；已复制文件与当前文稿保留。');
        const context = assetContext.current, snapshot = current.current;
        if (disposed || loadEpoch.current !== epoch || snapshot.projectId !== application.projectId || context.workspaceId !== application.workspaceId || context.application?.token !== application.token) return;
        const inserted = insertDocumentAsset(snapshot.document, context.selectedId, application.file);
        setImages(items => [...new Map([...items, application.file].map(item => [item.id, item])).values()]);
        rememberPreview(application.file.id, preview.dataUrl!);
        change(inserted.document); setSelectedId(inserted.selectedId); setError(''); appliedAsset.current = application.token;
        context.acknowledge?.(application.token);
        notifyRef.current(kind === 'word' ? '素材已插入当前段落之后，可撤销；保存为 Word 后写入文件，未调用模型。' : '已新增素材图片页，原页面保留；可撤销，保存为 PPT 后写入文件，未调用模型。');
      } catch (cause) {
        if (!disposed && assetContext.current.application?.token === application.token && current.current.projectId === application.projectId) {
          appliedAsset.current = application.token; setActionError(workflowPublicError(cause, '素材未能插入，项目副本和原文仍保留。')); assetContext.current.acknowledge?.(application.token);
        }
      } finally { if (pendingAsset.current === application.token) pendingAsset.current = undefined; }
    })();
    return () => { disposed = true; if (pendingAsset.current === application.token) pendingAsset.current = undefined; };
  }, [props.assetToApply?.token, props.workspaceId, project.id, ready, busy, loadingSource, conflictDraft, assetRecoveryResolved]);
  useEffect(() => {
    const known = props.workflowRunner.runs.filter(run => run.projectId === project.id).flatMap(run => run.attempts.flatMap(attempt => attempt.artifacts || [])).filter(artifact => artifact.kind === 'image' && !artifact.trashedAt);
    setImages(previous => [...new Map([...previous, ...known].map(item => [item.id, item])).values()]);
  }, [project.id, props.workflowRunner.runs]);
  useEffect(() => {
    if (!props.workflowRunner.listProjectArtifacts) return;
    let disposed = false;
    void props.workflowRunner.listProjectArtifacts(project.id).then(files => { if (!disposed) setImages(previous => [...new Map([...previous, ...files.filter(file => file.kind === 'image' && !file.trashedAt)].map(file => [file.id, file])).values()]); }).catch(() => { /* Existing known images remain selectable when the inventory is unavailable. */ });
    return () => { disposed = true; };
  }, [project.id, project.referenceFiles]);
  function openMaterialPicker(replace?: DocumentImageTarget) {
    if (!ready || busy || loadingSource) return;
    const selected = current.current.document.kind === 'ppt' ? current.current.document.slides.find(item => item.id === selectedId) : undefined;
    layout.openPanel('assets');
    setMaterialPicker({ projectId: project.id, workspaceId: props.workspaceId, selectedId, epoch: loadEpoch.current, imageId: selected?.imageId, replace });
  }
  async function useMaterial(file: ArtifactMetadata) {
    const page = current.current.document.kind === 'ppt' ? current.current.document.slides.find(item => item.id === selectedId) : undefined;
    const context = materialPicker || { projectId: project.id, workspaceId: props.workspaceId, selectedId, epoch: loadEpoch.current, imageId: page?.imageId };
    if (!context || context.projectId !== project.id || context.workspaceId !== props.workspaceId || !ready || busy || loadingSource) throw new Error('编辑位置已变化，请重新选择素材；已复制文件仍保留。');
    assertAssetImage(context.projectId, file, true);
    const preview = await runnerRef.current.previewArtifact(file.id), snapshot = current.current;
    if (loadEpoch.current !== context.epoch || snapshot.projectId !== context.projectId || assetContext.current.workspaceId !== context.workspaceId || assetContext.current.selectedId !== context.selectedId) throw new Error('工作区或文稿已变化，未插入旧位置；素材副本仍保留。');
    if (!preview.dataUrl?.startsWith('data:image/')) throw new Error('素材图片无法读取，请检查项目副本。');
    const items = snapshot.document.kind === 'word' ? snapshot.document.blocks : snapshot.document.slides;
    if (!items.some(item => item.id === context.selectedId)) throw new Error('原插入位置已移除，请重新选择位置。');
    if (!context.replace && snapshot.document.kind === 'ppt' && snapshot.document.slides.find(item => item.id === context.selectedId)?.imageId !== context.imageId) throw new Error('当前页图片已更改，请重新选择插入或替换。');
    if (context.replace) replacePicture(context.replace, file);
    else { const next = insertWorkbenchAsset(snapshot.document, context.selectedId, file); change(next.document); setSelectedId(next.selectedId); }
    setImages(items => [...new Map([...items, file].map(item => [item.id, item])).values()]);
    rememberPreview(file.id, preview.dataUrl!);
    setMaterialPicker(undefined);
    if (!context.replace) props.notify(kind === 'ppt' && !context.imageId ? '素材已插入当前页，正文与备注保留；可撤销，未调用模型。' : '素材已插入当前文稿，可撤销；保存导出后写入文件，未调用模型。');
  }
  function replacePicture(target: DocumentImageTarget, image: ArtifactMetadata) {
    if (image.projectId !== current.current.projectId || image.kind !== 'image' || image.trashedAt || image.unavailable) throw new Error('只能替换为当前项目中可用的实际图片。');
    const next = replaceDocumentImage(current.current.document, target, image.id);
    setImages(items => [...new Map([...items, image].map(item => [item.id, item])).values()]); change(next); props.notify('已替换所选插图，可撤销；保存并导出后写入新文件，原图保留。');
  }
  async function applyScopedDocument(next: EditorDocument, expected: EditorDocument) {
    if (current.current.document !== expected) throw new Error('文稿已有新的修改，请重新选择内容。未覆盖当前编辑。');
    const restoring = documentFieldChanges(expected, next).filter(change => documentFieldValue(next, change.key)?.image && change.after).map(change => change.after);
    if (restoring.length) {
      const files = props.workflowRunner.listProjectArtifacts ? await props.workflowRunner.listProjectArtifacts(project.id) : availableImages;
      if (restoring.some(id => !files.some(file => file.id === id && file.projectId === project.id && file.kind === 'image' && !file.trashedAt && !file.unavailable))) throw new Error('原图片已被移走或删除，请先从项目回收站恢复。局部撤销记录仍保留。');
      if (current.current.document !== expected) throw new Error('检查图片期间文稿已有新修改，请重新选择内容；当前内容保留。');
    }
    change(next, true, current.current.sourceArtifactIds, undefined, true);
  }
  function historySnapshot(): DocumentHistorySnapshot { return { document: current.current.document, sourceArtifactIds: current.current.sourceArtifactIds, selectedId }; }
  function change(next: EditorDocument, manual = true, sources = current.current.sourceArtifactIds, group?: string, scopedOperation = false) {
    if (manual && !scopedOperation) scopedEdits.recordChanges(current.current.document, next);
    if (manual && next !== current.current.document && props.activeProject.status === 'complete') props.onUpdateProject(project.id, { status: 'review', confirmedDelivery: undefined });
    if (manual) { manualEdits.current++; edits.record(historySnapshot(), { document: next, sourceArtifactIds: sources, selectedId }, group); }
    else { edits.reset(); scopedEdits.reset(); }
    current.current = { ...current.current, document: next, sourceArtifactIds: sources, dirty: true };
    setDocument(next); setSourceArtifactIds(sources); setDirty(true); setError('');
  }
  function changeTypedDocument(next: EditorDocument) { change(next, true, current.current.sourceArtifactIds, editorTypingGroup(current.current.document, next)); }
  function moveHistory(direction: 'undo' | 'redo') {
    if (!ready || busy) return;
    const snapshot = edits[direction](historySnapshot()); if (!snapshot) return;
    scopedEdits.reset();
    manualEdits.current++;
    current.current = { ...current.current, document: snapshot.document, sourceArtifactIds: snapshot.sourceArtifactIds, dirty: true };
    setDocument(snapshot.document); setSourceArtifactIds(snapshot.sourceArtifactIds); setSelectedId(snapshot.selectedId || selectedContentId(snapshot.document)); setDirty(true); setError('');
  }
  async function persist(exportFile = false, saveCopy = false) {
    if (busy || !ready || persisting.current) return false;
    const snapshot = current.current, projectId = project.id, operationEpoch = loadEpoch.current;
    if (!exportFile && snapshot.record && !snapshot.dirty) { props.notify('当前版本已经保存。'); return true; }
    persisting.current = true;
    setBusy(exportFile ? 'export' : 'save'); setError('');
    const input = { projectId, expectedRevision: snapshot.record?.revision || 0, document: snapshot.document, sourceArtifactIds: snapshot.sourceArtifactIds };
    try {
      if (!bridge) {
        localStorage.setItem(recoveryKey(projectId), JSON.stringify({ document: snapshot.document, sourceArtifactIds: snapshot.sourceArtifactIds, baseRevision: 0 }));
        if (exportFile) props.onExport(projectId, { title: snapshot.document.title, text: JSON.stringify({ editorDocument: snapshot.document }) });
        else props.notify('已保存浏览器草稿；桌面版会保存到项目文件夹。');
        if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setDirty(false);
        return true;
      }
      const reusable = exportFile && snapshot.record && !snapshot.dirty && currentExport.length ? { record: snapshot.record, artifacts: currentExport } : undefined;
      const result = reusable || (exportFile ? await bridge.export(input) : { record: await bridge.save(input), artifacts: [] });
      if (current.current.projectId !== projectId || loadEpoch.current !== operationEpoch) return false;
      current.current = { ...current.current, record: result.record, dirty: false };
      setRecord(result.record); setDirty(false);
      if (exportFile) setLocalExport({ projectId, revision: result.record.revision, artifacts: result.artifacts });
      const versions = await bridge.history({ projectId }).catch(() => []);
      if (current.current.projectId !== projectId || loadEpoch.current !== operationEpoch) return false;
      setHistory(versions);
      props.onUpdateProject(projectId, { name: result.record.document.title, description: brief });
      if (saveCopy && exportFile && result.artifacts[0]) {
        const copied = await runnerRef.current.saveArtifact(result.artifacts[0].id);
        if (current.current.projectId !== projectId || loadEpoch.current !== operationEpoch) return false;
        props.notify(copied.saved ? '当前 Office 文件已导出，项目内原文件和费用记录保留。' : '当前文件已保存在项目内，已取消另存。');
      } else props.notify(exportFile ? '当前内容已保存并生成真实 Office 文件，未调用模型。' : `已保存编辑版本 v${result.record.revision}，未调用模型。`);
      if (exportFile) layout.openPanel('delivery');
      return true;
    } catch (cause) {
      if (current.current.projectId !== projectId || loadEpoch.current !== operationEpoch) return false;
      if (exportFile) layout.openPanel('delivery');
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '保存未完成，当前修改仍保留。');
      if (bridge && exportFile) { try { const latest = await bridge.load({ projectId, kind, title: snapshot.document.title }); if (latest && current.current.projectId === projectId && loadEpoch.current === operationEpoch && JSON.stringify(latest.document) === JSON.stringify(snapshot.document)) setRecord(latest); } catch { /* Keep unsaved text and the original error. */ } }
      return false;
    } finally { persisting.current = false; if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setBusy(''); }
  }
  async function loadGenerated() {
    if (!source || busy || !ready) return;
    const projectId = project.id, sourceId = source.id, operationEpoch = loadEpoch.current, editVersion = manualEdits.current, request = ++sourceRequest.current; setBusy('source'); setLoadingSource(''); setError('');
    try {
      const preview = await props.workflowRunner.previewArtifact(sourceId);
      if (typeof preview.text !== 'string' || !preview.text.trim()) throw new Error('这份产物没有可编辑正文。');
      const next = editorFromText(kind, project.name, preview.text), snapshot = current.current;
      if (snapshot.projectId !== projectId || loadEpoch.current !== operationEpoch || sourceRef.current?.id !== sourceId || sourceRequest.current !== request || manualEdits.current !== editVersion) return;
      const backup = preserveEditorDraft(localStorage, projectId, { document: snapshot.document, sourceArtifactIds: snapshot.sourceArtifactIds, baseRevision: snapshot.record?.revision || 0 });
      localStorage.setItem(recoveryKey(projectId), JSON.stringify({ document: next, sourceArtifactIds: [sourceId], baseRevision: snapshot.record?.revision || 0 }));
      change(next, true, [sourceId]); setSelectedId(selectedContentId(next)); setConflictDraft(backup); setAssetRecoveryResolved(true); setSelectedRecovery('0'); props.notify('已显示生成文稿，切换前的内容已保留为可恢复草稿；未调用模型。');
    }
    catch (cause) { if (current.current.projectId === projectId && loadEpoch.current === operationEpoch && sourceRequest.current === request) setError(cause instanceof Error ? cause.message : '读取生成正文未完成，当前文稿保留。'); }
    finally { if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setBusy(''); }
  }
  async function importImage(replaceTarget?: DocumentImageTarget) {
    if (busy || !ready) return;
    const projectId = project.id, operationEpoch = loadEpoch.current; setBusy('image'); setError('');
    try {
      const imported = await props.workflowRunner.importFiles(projectId);
      if (current.current.projectId !== projectId || loadEpoch.current !== operationEpoch) return;
      const added = imported.filter(item => item.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType)); if (!added.length) { if (imported.length) props.notify('请选择 PNG、JPEG 或 WebP 图片作为插图。', 'info'); return; }
      setImages(items => [...new Map([...items, ...added].map(item => [item.id, item])).values()]);
      const image = added[0], value = current.current.document;
      if (replaceTarget) { replacePicture(replaceTarget, image); return; }
      if (value.kind === 'word') { const block = { ...newWordBlock('image'), imageId: image.id }; const position = value.blocks.findIndex(item => item.id === selectedId); const blocks = [...value.blocks]; blocks.splice(position + 1, 0, block); change({ ...value, blocks }); setSelectedId(block.id); }
      else { const selected = value.slides.find(item => item.id === selectedId) || value.slides[0]; change({ ...value, slides: value.slides.map(item => item.id === selected.id ? { ...withSlideLayout(item, 'image-right'), imageId: image.id } : item) }); }
    } catch (cause) { if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setError(cause instanceof Error ? cause.message : '图片导入未完成。'); }
    finally { if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setBusy(''); }
  }
  async function previewCurrentOffice() {
    if (!ready || busy) return;
    if (!dirty && currentExport[0]) { setOfficePreview(currentExport[0]); return; }
    const identity = project.id; previewAfterExport.current = true;
    const saved = await persist(true);
    if (!saved && current.current.projectId === identity) previewAfterExport.current = false;
  }
  async function applyVersion(revision: number) {
    if (!bridge || busy) return false;
    if (dirty) { props.notify('请先保存当前修改，再载入历史版本。', 'info'); return false; }
    const projectId = project.id, operationEpoch = loadEpoch.current; setBusy('version');
    try { const previous = await bridge.loadVersion({ projectId, revision }); if (current.current.projectId !== projectId || loadEpoch.current !== operationEpoch) return false; if (!ready) { setRecoveryVersion(previous); return true; } change(previous.document, true, previous.sourceArtifactIds); setSelectedId(selectedContentId(previous.document)); props.notify(`已载入 v${revision} 内容，保存后会成为新版本，原历史保留。`); return true; }
    catch (cause) { if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setError(cause instanceof Error ? cause.message : '历史版本读取失败。'); return false; }
    finally { if (current.current.projectId === projectId && loadEpoch.current === operationEpoch) setBusy(''); }
  }
  async function restoreDamagedSource() {
    if (!bridge?.restore || !recoveryVersion || busy) return;
    setBusy('restore'); setError('');
    try { await bridge.restore({ projectId: project.id, revision: recoveryVersion.revision }); setRecoveryVersion(undefined); setReload(value => value + 1); props.notify('已保留原稿并恢复为新的编辑版本，未调用模型。'); }
    catch (cause) { setError(workflowPublicError(cause, '历史版本恢复未完成，原稿仍保留。')); }
    finally { setBusy(''); }
  }
  function loadConflictDraft() {
    const previous = recoveryDrafts(conflictDraft)[Number(selectedRecovery)];
    if (!previous || busy || !ready) return;
    try {
      const backup = preserveEditorDraft(localStorage, project.id, { document, sourceArtifactIds, baseRevision: record?.revision || 0 });
      localStorage.setItem(recoveryKey(project.id), JSON.stringify({ document: previous.document, sourceArtifactIds: previous.sourceArtifactIds, baseRevision: record?.revision || 0 }));
      change(previous.document, true, previous.sourceArtifactIds); setSelectedId(selectedContentId(previous.document)); setConflictDraft(backup); setAssetRecoveryResolved(true); setSelectedRecovery('0');
      props.notify('已恢复所选草稿，切换前的文稿也已保留；保存会新增版本。');
    } catch { setError('无法保存恢复草稿，原恢复副本仍保留，当前内容未被替换。'); }
  }
  function beforeRun() {
    if (!ready || busy) return false;
    try { localStorage.setItem(recoveryKey(project.id), JSON.stringify({ document, sourceArtifactIds, baseRevision: record?.revision || 0 })); localStorage.setItem(documentStudioFormKey(project.id), JSON.stringify({ version: 1, brief, instruction, modelId: selectedModel?.id || '', inspector, imageMode, imageModelId, imageCredentialId, imageCount, imageIds })); return true; } catch (cause) { setActionError(workflowPublicError(cause, '工作台草稿无法保存，当前需求和编辑内容仍保留，请检查本机存储。')); return false; }
  }
  function generate(refine = false) {
    if (refine) return;
    if (generationIssue || illustrationIssue || textKeyIssue) return;
    setActionError('');
    if (!beforeRun()) return;

    props.onGenerate(project.id, refine ? 'AI 精修' : '初次生成', 1, undefined, { prompt: refine ? `${instruction}\n输出完整修订内容，保留已确认事实和数字。` : `${brief}\n${kind === 'ppt' ? '请用 JSON 返回 {title,slides:[{title,bullets,notes}]}，每页文字适量。' : '请用 JSON 返回 {title,sections:[{heading,paragraphs}]}。'}不要编造未提供事实。`, input: refine ? editorPlainText(document) : brief, modelConfigId: selectedModel?.id, credentialId: selectedCredential, capability: 'text', ...(imageMode !== 'none' ? { documentImages: { mode: imageMode, count: imageCount, modelConfigId: pictureModel?.id, credentialId: pictureCredential }, attachmentIds: imageMode === 'references' ? chosenImages : [] } : {}) });
  }
  function savePrompt() { const content = inspector === 'refine' ? instruction : brief; setPromptDraft({ name: `${kind === 'ppt' ? 'PPT' : 'Word'} ${inspector === 'refine' ? '精修' : '创作'}模板`, category: kind, content, description: '来自当前文档工作台', mode: inspector === 'refine' ? 'refine' : 'create', businessCategoryId: project.businessCategoryId }); }
  function fixGeneration(target: StudioActionTarget) {
    if (target === 'models') props.navigate('models');
    else if (target === 'task') props.navigate('activity', project.id);
    else if (target === 'reload') setReload(value => value + 1);
    else { layout.openPanel('ai'); requestAnimationFrame(() => { const field = workbench.current?.querySelector<HTMLElement>(target === 'request' ? 'textarea[aria-label="' + (refining ? '文档修改指令' : '文档创作需求') + '"]' : '[role="combobox"][aria-label="文档实际模型"]'); field?.focus(); if (target === 'model') field?.click(); }); }
  }
  function chooseTextModel(value: string) { setModelId(value); chooseTextCredential(''); }
  function chooseTextCredential(value: string) { const choice = studioCredentialChoice(value, selectedModel); setCredentialId(choice); if (!saveStudioCredentialPreference(project.id, 'text', choice)) props.notify('本次 Key 选择已带入，但偏好暂未保存。', 'info'); }
  guardRef.current = { dirty, pending: ['save', 'export', 'restore'].includes(busy), persistenceError: recovery.error, save: () => { if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur(); return persist(); }, exportRecovery: recovery.exportDraft };
  useEditorShortcuts(workbench, ready && !busy, { save: () => persist(), undo: () => moveHistory('undo'), redo: () => moveHistory('redo') }, target => target instanceof HTMLElement && !!target.dataset.editField && !!target.closest('.ed-main'));
  const actionStatus = <StudioActionStatus id={actionStatusId} issue={generationIssue} error={actionError} note={reviewing ? REVIEW_REPLACEMENT_NOTE : undefined} onFix={fixGeneration} />;
  const textCredentialControl = <label>调用 Key<Select className="simple-inline-field" aria-label="文档调用Key" value={selectedCredential || ''} onValueChange={chooseTextCredential} options={textCredentials.map(key => ({ value: key.id, label: key.name }))} placeholder="选择 Key" />{textKeyIssue && <small role="status">{textKeyIssue}</small>}</label>;
  const scopedRefinement = <><label>精修范围<Select aria-label="文档精修范围" value={refineScope} onValueChange={setRefineScope} options={[{ value: 'current', label: kind === 'ppt' ? '当前页面' : '当前段落或表格' }, ...(document.kind === 'word' && selectedCellId ? [{ value: 'cell', label: '当前表格单元格' }] : []), { value: 'all', label: '全文文字（保留版式）' }]} /></label><LocalRefinement props={props} targets={documentRefinementTargets(document, refineScope === 'all' ? undefined : selectedId, refineScope === 'cell' ? selectedCellId : undefined)} instruction={instruction} model={selectedModel} preferredCredentialId={selectedCredential} secondaryAction disabled={!ready || !!busy || !!generationTask || !!textKeyIssue} beforeRun={beforeRun} onApply={changes => { change(applyDocumentRefinement(current.current.document, changes)); props.notify('已应用局部修改，可撤销；保存并导出后再交付。'); }} /></>;
  const illustrationControls = <DocumentIllustrationOptions mode={imageMode} onMode={setImageMode} images={availableImages} selectedIds={chosenImages} onSelect={setImageIds} modelId={pictureModel?.id || ''} models={pictureModels} onModel={setImageModelId} credentialId={pictureCredential || ''} credentials={pictureCredentials} onCredential={setImageCredentialId} count={imageCount} onCount={setImageCount} issue={illustrationIssue} />;
  const pictureTools = selectedPicture && <DocumentImageTools key={project.id} onPickAsset={() => openMaterialPicker(selectedPicture)} props={props} target={selectedPicture} images={availableImages} preview={previews[selectedPicture.imageId]} disabled={!ready || !!busy} beforeRun={beforeRun} onReplace={replacePicture} onImport={() => { void importImage(selectedPicture); }} />;

  function openTool(tool: StudioTool) {
    if (tool === 'assets') { openMaterialPicker(selectedPicture); return; }
    if (tool === 'ai') setInspector(hasResult ? 'refine' : 'create');
    layout.togglePanel(tool);
    if (tool === 'ai') requestAnimationFrame(() => { const field = workbench.current?.querySelector<HTMLTextAreaElement>('.sw-panel textarea[aria-label="文档修改指令"],.sw-panel textarea[aria-label="文档创作需求"]'); if (field?.getClientRects().length) field.focus(); });
  }
  useStudioToolRequests(props.workspaceId, project.id, tool => { if (tool === 'assets') openMaterialPicker(selectedPicture); else { if (tool === 'ai' && inspector === 'history') setInspector(hasResult ? 'refine' : 'create'); layout.openPanel(tool); } });
  const chooseContent = (id: string) => { scopedEdits.chooseContent(id); setSelectedId(id); setSelectedCellId(''); setShowImageTools(false); };
  const navigation = document.kind === 'word' ? <WordOutline document={document} selectedId={selectedId} onSelect={chooseContent} /> : <PresentationNavigation document={document} onChange={changeTypedDocument} selectedId={selectedId} onSelect={chooseContent} disabled={!!busy} />;
  const formatTools = selectedPicture && showImageTools ? <>{scopedEdits.toolbar}{pictureTools}</> : document.kind === 'word' ? <WordFormattingTools document={document} onChange={changeTypedDocument} selectedId={selectedId} onSelect={chooseContent} onImportImage={() => { void importImage(); }} disabled={!!busy || !ready} /> : <PresentationFormattingTools document={document} onChange={changeTypedDocument} selectedId={selectedId} onSelect={chooseContent} images={images} onImportImage={() => { void importImage(); }} disabled={!!busy || !ready} />;
  const aiTools = <div className="sw-ai-fields"><div className="sw-ai-mode"><button type="button" className={!refining ? 'active' : ''} onClick={() => setInspector('create')}>生成新内容</button><button type="button" className={refining ? 'active' : ''} onClick={() => setInspector('refine')}>修改当前内容</button></div><div className="sw-scope-label">{refining ? refineScope === 'all' ? 'AI 范围：全文文字，保留版式与图片' : kind === 'ppt' ? 'AI 范围：当前整页文字' : selectedCellId ? 'AI 范围：当前表格或单元格' : 'AI 范围：当前整段文字' : '将生成一份新初稿，现有文稿与历史保留'}</div><div className="ed-prompt-actions"><button type="button" onClick={() => setPromptPicker(true)}><BookOpen size={14} />提示词模板</button><button type="button" disabled={!(refining ? instruction : brief).trim()} onClick={savePrompt}><Save size={14} />保存模板</button></div><label>{refining ? '修改指令' : '创作需求'}<textarea aria-label={refining ? '文档修改指令' : '文档创作需求'} value={refining ? instruction : brief} rows={5} onChange={event => refining ? setInstruction(event.target.value) : setBrief(event.target.value)} placeholder="说明用途、受众、已确认事实和需要保留的内容" /></label><label>文本模型<Select aria-label="文档实际模型" value={selectedModel?.id || ''} onValueChange={chooseTextModel} options={[{ value: '', label: '请选择文本模型' }, ...models.map(model => ({ value: model.id, label: model.name, description: model.modelId }))]} /></label>{textCredentialControl}{!refining && illustrationControls}{refining ? scopedRefinement : <button type="button" className="btn btn-primary" disabled={!!generationIssue || !!textKeyIssue || !!illustrationIssue} aria-describedby={generationIssue || actionError || reviewing ? actionStatusId : undefined} onClick={() => generate(false)}><Sparkles size={16} />生成内容</button>}{actionStatus}<RememberedDetails rememberKey="documents:custom-actions"><summary>自定义创作功能</summary><StudioActions props={props} studio="documents" projectId={project.id} outputKind={kind} onBeforeRun={beforeRun} input={editorPlainText(document)} /></RememberedDetails><p>手工编辑、插图、保存和导出不调用模型。AI 请求费用自动累计；撤销不会退回已发生费用。</p></div>;
  const versions = <VersionTimeline key={project.id} projectId={project.id} document={document} savedRevision={record?.revision} dirty={dirty} busy={!!busy} versions={history} exportNames={currentExport.map(file => file.name)} requestedRevision={comparisonRevision} onRequestConsumed={() => setComparisonRevision(undefined)} loadVersion={revision => bridge ? bridge.loadVersion({ projectId: project.id, revision }) : Promise.reject(new Error('请在桌面应用中读取已保存版本。'))} onRestore={applyVersion} />;
  const assets = <><div className="sw-panel-actions"><button type="button" className="btn btn-secondary" disabled={!ready || !!busy} onClick={() => { void importImage(selectedPicture); }}><ImagePlus size={15} />从本地导入图片</button></div><Suspense fallback={<p role="status">正在打开素材…</p>}><StudioAssetPicker embedded props={props} title={selectedPicture ? '替换当前插图' : '插入文档素材'} description={selectedPicture ? '替换所选图片，正文和其他图片保留，可撤销。' : kind === 'word' ? '插入当前段落之后，原文字保留，可撤销。' : '放入当前页；已有插图时新增图片页，原页保留。'} confirmLabel={selectedPicture ? '替换所选图片' : '插入当前位置'} onClose={layout.closePanel} onChoose={useMaterial} /></Suspense></>;
  const files = <ArtifactResults artifacts={realArtifacts} runner={props.workflowRunner} projectId={project.id} />;
  const deliveryTools = <><div className="sw-panel-actions"><button type="button" className="btn btn-secondary" disabled={!!busy || !ready || !bridge} onClick={() => { void previewCurrentOffice(); }}>预览实际 Office 文件</button><button type="button" className="btn btn-secondary" disabled={!!busy || !ready || !bridge} onClick={() => { void persist(true); }}>导出到项目</button></div><p>先导出当前版本，再核对实际文件；确认交付与普通导出分开记录。</p></>;
  const panel = layout.tool === 'ai' ? aiTools : layout.tool === 'assets' ? assets : layout.tool === 'format' ? formatTools : layout.tool === 'versions' ? versions : layout.tool === 'files' ? files : deliveryTools;
  const notices = <>{Object.keys(previewErrors).length > 0 && <div className="ed-new-source" role="status"><span>当前可见插图有 {Object.keys(previewErrors).length} 张预览未能读取，原文件与文稿保留。</span><button type="button" className="btn btn-secondary" onClick={retryPreviews}>重新读取插图预览</button></div>}<ProjectReferences props={props} />
    <RecoveryDraftNotice error={recovery.error} onRetry={recovery.retry} onDownload={recovery.exportDraft} />
    {recoveryVersion && <section className="editor-recovery-notice" role="region" aria-label="可恢复历史版本"><h3>编辑源 v{recoveryVersion.revision} · {recoveryVersion.document.title}</h3><pre>{editorPlainText(recoveryVersion.document)}</pre><div><button className="btn btn-primary" disabled={!!busy || !bridge?.restore} onClick={() => { void restoreDamagedSource(); }}>保留原稿并恢复此版本</button><button className="btn btn-secondary" onClick={() => setRecoveryVersion(undefined)}>取消恢复</button></div></section>}
    {recoveryNotice && <div className="ed-new-source" role="status"><History size={17} /><span>{recoveryNotice}</span></div>}
    {error && <div className="ed-error" role="alert">{error}<span>当前编辑内容不会被自动覆盖。</span>{isWorkspaceConnectionError(error) ? <WorkspaceConnectionRecovery workspaceId={props.workspaceId} disabled={!!busy} onRecovered={() => setReload(value => value + 1)} /> : !ready && <button className="btn btn-secondary" disabled={!!busy} onClick={() => setReload(value => value + 1)}>重新读取编辑源</button>}{!ready && history.length > 0 && <button className="btn btn-secondary" onClick={() => { setInspector('history'); layout.openPanel('versions'); }}>查看可恢复历史</button>}</div>}{source && !sourceArtifactIds.includes(source.id) && <div className="ed-new-source"><Sparkles size={17} /><span>{loadingSource ? '正在整理完整文稿…' : '新生成的完整文稿已就绪。查看时会自动保留当前草稿，可随时恢复。'}</span><button className="btn btn-secondary" disabled={!!busy || !ready || !!loadingSource} onClick={() => { void loadGenerated(); }}>查看新生成文稿</button></div>}
    {conflictDraft && <div className="ed-new-source ed-recovery-source" role="status"><History size={17} /><span>切换前的文稿已保留，保存后会成为新版本，已有文件不变。</span>{recoveryDrafts(conflictDraft).length > 1 && <Select aria-label="选择保留草稿" value={selectedRecovery} onValueChange={setSelectedRecovery} options={recoveryDrafts(conflictDraft).map((item, index) => ({ value: String(index), label: `${index + 1}. ${item.document.title} · ${item.document.kind === 'word' ? `${item.document.blocks.length} 段` : `${item.document.slides.length} 页`}` }))} />}<button className="btn btn-secondary" disabled={!!busy || !ready} onClick={loadConflictDraft}>{props.assetToApply?.projectId === project.id && !assetRecoveryResolved ? '载入恢复稿后插入' : '载入未保存恢复稿'}</button>{props.assetToApply?.projectId === project.id && !assetRecoveryResolved && <div className="ed-asset-recovery-choice"><span>素材已复制，请先载入恢复稿，或选择插入当前文稿。</span><button className="btn btn-primary" disabled={!!busy || !ready} onClick={() => setAssetRecoveryResolved(true)}>插入当前文稿</button></div>}</div>}</>;
  return <div className="sw-editor-root" ref={workbench} onSelectCapture={scopedEdits.capture} onMouseUpCapture={scopedEdits.capture} onKeyUpCapture={scopedEdits.capture} onFocusCapture={event => { scopedEdits.capture(event); if (event.target instanceof HTMLElement && event.target.dataset.editField && event.target.closest('.ed-main')) setShowImageTools(false); }} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}>
    <StudioWorkbench projectName={project.name} kind={kind} layout={layout} onTool={openTool} saveStatus={!ready ? '正在读取编辑源' : dirty ? '草稿已保留 · 项目版本尚未保存' : record ? '已保存项目版本 v' + record.revision + (exported ? ' · 对应成品已导出' : ' · 尚未导出此版') : '新文稿 · 尚未保存项目版本'} selectionLabel={document.kind === 'ppt' ? '第 ' + (Math.max(0, document.slides.findIndex(slide => slide.id === selectedId)) + 1) + ' / ' + document.slides.length + ' 页' : selectedCellId ? '当前表格单元格' : '当前段落 · 点击正文直接编辑'} navigation={navigation} navigationLabel={kind === 'ppt' ? '页面导航' : '文档大纲'} panel={panel} notices={notices} selectionTools={scopedEdits.toolbar} cost={<CostTotal summary={cost} />} busy={!!busy || !ready} exporting={busy === 'export'} canUndo={edits.canUndo} canRedo={edits.canRedo} canExport={!!bridge && hasResult} onUndo={() => moveHistory('undo')} onRedo={() => moveHistory('redo')} onSave={() => { void persist(); }} onExport={() => { void persist(true, true); }} deliveryPanel={<DeliveryPanel inline visible={layout.tool === 'delivery' && layout.rightOpen && !layout.focus} projectId={project.id} kind={kind} sourceRevision={record?.revision || 0} dirty={dirty || !ready} artifactIds={currentExport.map(file => file.id)} deliveryContext={project.lastLiveStateSignature} onDelivered={(receipt, selection) => props.onProjectDelivered ? props.onProjectDelivered(project.id, receipt, selection) : props.onUpdateProject(project.id, { status: 'complete', updatedAt: new Date().toISOString() })} onInvalidated={() => { if (project.confirmedDelivery) props.onUpdateProject(project.id, { confirmedDelivery: undefined, ...(project.status === 'complete' ? { status: 'review' as const } : {}) }); }} checks={editorDeliveryChecks(document, { saved: !!record && !dirty, exported })} />}>
            <main className="ed-main">{!ready ? <div className="ed-loading">{error ? <FileText size={28} /> : <LoaderCircle className="spin" size={28} />}<p>{error ? '请保留原文件并检查工作区路径，当前未创建空白文件覆盖它。' : '正在读取项目编辑源…'}</p></div> : document.kind === 'word' ? <WordEditor showToolbar={false} showAddControls={false} document={document} onChange={changeTypedDocument} selectedId={selectedId} onSelect={id => { scopedEdits.chooseContent(id); setSelectedId(id); setSelectedCellId(''); }} onSelectTableCell={(id, cellId) => { scopedEdits.chooseContent(id); setSelectedId(id); setSelectedCellId(cellId); }} images={images} previews={previews} onEditImage={id => { scopedEdits.chooseContent(id, true); setSelectedId(id); setShowImageTools(true); layout.openPanel('format'); }} onImportImage={() => { void importImage(); }} disabled={!!busy} /> : <PresentationEditor showNavigation={false} showToolbar={false} showImageControls={false} document={document} onChange={changeTypedDocument} selectedId={selectedId} onSelect={id => { scopedEdits.chooseContent(id); setSelectedId(id); }} images={images} previews={previews} onEditImage={id => { scopedEdits.chooseContent(id, true); setSelectedId(id); setShowImageTools(true); layout.openPanel('format'); }} onImportImage={() => { void importImage(); }} disabled={!!busy} />}</main>
    </StudioWorkbench>
    {promptPicker && <PromptPicker prompts={props.prompts} category={kind} onClose={() => setPromptPicker(false)} onUse={(template, content) => { props.onUsePrompt(template, content); setPromptPicker(false); }} />}{promptDraft && <PromptEditor categories={props.configuration.categories} initial={promptDraft} onClose={() => setPromptDraft(null)} onSave={(draft, id) => { props.onSavePrompt(draft, id); setPromptDraft(null); }} />}
    {officePreview && officePreview.projectId === project.id && <Suspense fallback={<p role="status">正在打开实际文件预览…</p>}><OfficeFilePreview artifact={officePreview} onClose={() => setOfficePreview(undefined)} onOpenSource={() => { void props.workflowRunner.openArtifact(officePreview.id); }} /></Suspense>}
  </div>;
}
