import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, BookOpen, History, LoaderCircle, Plus, Sparkles, Table2, Trash2, Save } from 'lucide-react';
import type { PageProps, PromptDraft } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { SpreadsheetCell, SpreadsheetDocument, SpreadsheetRecord, SpreadsheetSheet, SpreadsheetVersionInfo } from '../spreadsheet-types';
import { cellFromInput, cellToInput, columnLabel, SPREADSHEET_LIMITS, validateSpreadsheetDocument } from '../lib/spreadsheet-engine';
import { createSpreadsheetCalculationCache } from '../lib/spreadsheet-calculation-cache';
import { emptySpreadsheet, hasSpreadsheetEdits, legacySpreadsheetDocument, newSpreadsheetSheet, nextSpreadsheetName, pasteSpreadsheetCells, readSpreadsheetRecovery, renameSpreadsheetSheet, resolveSpreadsheetRecovery, spreadsheetConflictKey, spreadsheetFormKey, spreadsheetFromText, spreadsheetNameError, spreadsheetRecoveryKey, SPREADSHEET_COLUMN_LIMIT, SPREADSHEET_ROW_LIMIT, updateSpreadsheetCell } from '../lib/spreadsheet-ui';
import { spreadsheetMissingInputs } from '../lib/spreadsheet-generated';
import type { SpreadsheetRecovery } from '../lib/spreadsheet-ui';
import { spreadsheetDeliveryChecks } from '../lib/spreadsheet-delivery';
import { readDocumentStudioForm } from '../lib/document-studio-state';
import { workflowPublicError } from '../lib/studio-run';
import { latestStudioBinding, readStudioCredentialPreference, saveStudioCredentialPreference, studioCredentialChoice, studioProjectCredential, studioProjectModel } from '../lib/studio-project-bindings';
import { summarizeCosts } from '../lib/cost-display';
import { ArtifactResults, latestProjectArtifacts, latestProjectContentArtifact } from './ArtifactResults';
import { isProductionRun } from '../lib/workflow-purpose';
import { SpreadsheetGrid } from './SpreadsheetGrid';
import { SpreadsheetDataTools } from './SpreadsheetDataTools';
import { clearSpreadsheetRange, fillSpreadsheetDown, spreadsheetRange } from '../lib/spreadsheet-operations';
import { Select } from './Select';
import { StudioActions } from './StudioActions';
import { PromptEditor, PromptPicker } from './PromptDialogs';
import { LocalRefinement } from './LocalRefinement';
import { applySpreadsheetRefinement, spreadsheetRefinementTargets } from '../lib/local-refinement';
import { DeliveryPanel } from './DeliveryPanel';
import { CostTotal } from './CostAmount';
import { useStudioLayout } from '../hooks/useStudioLayout';
import { useSpreadsheetCalculation } from '../hooks/useSpreadsheetCalculation';
import { validateSpreadsheetEdit } from '../lib/spreadsheet-edit-validation';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { StudioWorkbench } from './StudioWorkbench';
import { CompactAiPanel, AiSettingsSection } from './CompactAiPanel';
import { focusStudioField } from '../lib/studio-ai-focus';
import { useStudioToolRequests } from '../hooks/useStudioToolRequests';
import type { StudioTool } from '../lib/studio-commands';
import { RememberedDetails } from './RememberedDetails';
import { VersionTimeline } from './VersionTimeline';
import { studioActionIssue } from '../lib/studio-action-status';
import type { StudioActionTarget } from '../lib/studio-action-status';
import { StudioActionStatus } from './StudioActionStatus';
import { isWorkspaceConnectionError, WorkspaceConnectionRecovery } from './WorkspaceConnectionRecovery';
import { editorExportArtifacts } from '../lib/editor-export-proof';
import { useEditHistory } from '../hooks/useEditHistory';
import { useScopedTextHistory } from '../hooks/useScopedTextHistory';
import { applySpreadsheetScope, emptySpreadsheetScopeHistory, inspectSpreadsheetScope, recordSpreadsheetScope, spreadsheetHistoryScope } from '../lib/spreadsheet-scope-history';
import { SelectionHistoryToolbar } from './SelectionHistoryToolbar';
import { useRecoveryDraft } from '../hooks/useRecoveryDraft';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { registerEditorSession } from '../lib/editor-session-guard';
import { RecoveryDraftNotice } from './RecoveryDraftNotice';
import { ProjectReferences } from './ProjectReferences';
import './spreadsheet-editor.css';
const StudioAssetPicker = lazy(() => import('./StudioAssetPicker').then(module => ({ default: module.StudioAssetPicker })));
const OfficeFilePreview = lazy(() => import('./OfficeFilePreview').then(module => ({ default: module.OfficeFilePreview })));

function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
const sameDocument = (first: SpreadsheetDocument, second: SpreadsheetDocument) => JSON.stringify(first) === JSON.stringify(second);
interface SpreadsheetHistorySnapshot { workbook: SpreadsheetDocument; sourceArtifactIds: string[]; selectedSheetId: string; selectedAddress: string; }
interface CellTextSelection { key: string; sheetId: string; address: string; value: string; start: number; end: number; element: HTMLTextAreaElement; recoveryPoint?: boolean; }

export function SpreadsheetStudio(props: PageProps) {
  const workbench = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState('');
  const project = props.activeProject;
  const layout = useStudioLayout('spreadsheet', { workspaceId: project.workspaceId, projectId: project.id });
  const projectKey = `${props.workspace.directory || props.workspaceId}|${project.id}`;
  const [initialForm] = useState(() => readDocumentStudioForm(stored(spreadsheetFormKey(project.id)), project.description));
  const [formProjectId, setFormProjectId] = useState(project.id);
  const [workbook, setWorkbook] = useState(() => emptySpreadsheet(project.name));
  const [record, setRecord] = useState<SpreadsheetRecord | null>(null);
  const [sourceArtifactIds, setSourceArtifactIds] = useState<string[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState(workbook.sheets[0].id);
  const [selectedAddress, setSelectedAddress] = useState('A1');
  const [dirty, setDirty] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [busy, setBusy] = useState('load');
  const persisting = useRef(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [conflictDraft, setConflictDraft] = useState<SpreadsheetRecovery>();
  const [history, setHistory] = useState<SpreadsheetVersionInfo[]>([]);
  const [officePreview, setOfficePreview] = useState<ArtifactMetadata>();
  const previewAfterExport = useRef(false);
  const [recoveryVersion, setRecoveryVersion] = useState<SpreadsheetRecord>();
  const edits = useEditHistory<SpreadsheetHistorySnapshot>();
  const scopedText = useScopedTextHistory();
  const cellHistory = useRef(emptySpreadsheetScopeHistory());
  const scopedInputs = useRef(new Map<string, string>());
  const [cellTextSelection, setCellTextSelection] = useState<CellTextSelection>();
  const [showScopeTools, setShowScopeTools] = useRememberedBoolean(layout.rememberKey('spreadsheet:scope-tools'), false);
  const [exportedRevision, setExportedRevision] = useState<number>();
  const [exportedArtifacts, setExportedArtifacts] = useState<ArtifactMetadata[]>([]);
  const [inspector, setInspector] = useState(initialForm.inspector);
  const [brief, setBrief] = useState(initialForm.brief);
  const [instruction, setInstruction] = useState(initialForm.instruction);
  const [refineRange, setRefineRange] = useState('');
  const [allowFormulaRefinement, setAllowFormulaRefinement] = useState(false);
  const [modelId, setModelId] = useState(initialForm.modelId);
  const [credentialId, setCredentialId] = useState(() => readStudioCredentialPreference(project.id, 'text'));
  const [formulaInput, setFormulaInput] = useState('');
  const [fullCellOpen, setFullCellOpen] = useRememberedBoolean(layout.rememberKey('spreadsheet:full-cell'), false);
  const [sheetName, setSheetName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [promptPicker, setPromptPicker] = useState(false);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const loadEpoch = useRef(0);
  const current = useRef({ projectKey, workbook, record, sourceArtifactIds });
  current.current = { projectKey, workbook, record, sourceArtifactIds };
  const appliedPrompt = useRef<string | undefined>(undefined);
  const skipFormulaBlur = useRef(false);
  const pendingCellEdit = useRef(false);
  const pendingFormulaEdit = useRef(false);
  const autoSourceAttempt = useRef('');
  const formulaEditor = useRef<HTMLTextAreaElement>(null);
  const ready = loadedKey === projectKey;
  const bridge = window.desktop?.spreadsheets;
  const sheet = workbook.sheets.find(item => item.id === selectedSheetId) || workbook.sheets[0];
  const selectedCell = sheet.cells[selectedAddress];
  const source = latestProjectContentArtifact(props.workflowRunner.runs, project.id);
  const models = props.configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes('text') && props.configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
  const quickFlowId = `quick-${project.id}-text-${inspector === 'refine' ? 'refine' : 'create'}`;
  const quickModelId = props.configuration.workflows.find(flow => flow.id === quickFlowId)?.steps[0]?.modelConfigId;
  const inheritedText = latestStudioBinding(props.workflowRunner.runs, props.workspaceId, project.id, 'text') || props.configuration.workflows.find(flow => flow.id === quickFlowId)?.steps[0];
  const selectedModel = studioProjectModel(models, modelId, inheritedText);
  const textCredentials = (props.configuration.credentials || []).filter(key => key.enabled && key.connectionId === selectedModel?.connectionId);
  const selectedCredential = studioProjectCredential(textCredentials, selectedModel, credentialId, inheritedText);
  const textKeyIssue = selectedModel && !selectedCredential ? '请选择本次调用的 Key；原选择可能已停用，当前不会换用其他账户。' : '';
  const generationTask = props.workflowRunner.runs.find(run => isProductionRun(run) && run.projectId === project.id && ['running', 'paused'].includes(run.status));
  const reviewing = props.workflowRunner.runs.some(run => run.projectId === project.id && run.status === 'waiting-review');
  const generationIssue = studioActionIssue({ ready, busy, taskStatus: generationTask?.status, input: inspector === 'refine' ? instruction : brief, inputLabel: inspector === 'refine' ? '修改指令' : '创作需求', modelId: selectedModel?.id, modelCount: models.length });
  const actionStatusId = `spreadsheet-action-status-${project.id}`;
  const previousQuickModels = useRef(new Map<string, string | undefined>());
  const cost = summarizeCosts(props.ledger.filter(entry => entry.projectId === project.id && entry.billingMode === 'live'));
  const [calculationCache] = useState(createSpreadsheetCalculationCache);
  const calculationState = useSpreadsheetCalculation(workbook, projectKey);
  const calculation = calculationState.calculation;
  const selectedResult = calculation?.cells[sheet.id]?.[selectedAddress];
  const missingInputs = useMemo(() => spreadsheetMissingInputs(workbook), [workbook]);
  const serializedWorkbook = useMemo(() => layout.tool === 'ai' && layout.rightOpen && !layout.focus ? JSON.stringify(workbook) : '', [workbook, layout.tool, layout.rightOpen, layout.focus]);
  const realArtifacts = [...new Map([...latestProjectArtifacts(props.workflowRunner.runs, project.id), ...(ready ? exportedArtifacts : [])].map(artifact => [artifact.id, artifact])).values()];
  const localExport = exportedRevision === undefined ? undefined : { projectId: project.id, revision: exportedRevision, artifacts: exportedArtifacts };
  const currentExport = editorExportArtifacts(project.id, 'excel', record?.revision, props.workflowRunner.runs, localExport, props.workflowRunner.trashedArtifacts);
  useEffect(() => { previewAfterExport.current = false; setOfficePreview(undefined); }, [project.id]);
  useEffect(() => { if (previewAfterExport.current && ready && !dirty && currentExport[0]) { previewAfterExport.current = false; setOfficePreview(currentExport[0]); } }, [currentExport, ready, dirty]);
  const exportRegistryKnown = Array.isArray(props.workflowRunner.trashedArtifacts);
  const exported = !record || dirty || !ready ? false : exportRegistryKnown ? currentExport.length > 0 : undefined;
  const recoveryPayload = useMemo(() => ({ document: workbook, sourceArtifactIds, baseRevision: record?.revision || 0 }), [workbook, sourceArtifactIds, record?.revision]);
  const recovery = useRecoveryDraft(spreadsheetRecoveryKey(project.id), recoveryPayload, ready, `${project.name}-恢复稿.json`, () => ({ document: current.current.workbook, sourceArtifactIds: current.current.sourceArtifactIds, baseRevision: current.current.record?.revision || 0 }));
  const guardRef = useRef<{ dirty: boolean; pending: boolean; persistenceError: string; save: () => Promise<boolean>; exportRecovery: () => boolean | Promise<boolean> }>({ dirty, pending: !!busy, persistenceError: '', save: async () => false, exportRecovery: () => false });
  useEffect(() => registerEditorSession({ id: `spreadsheet-${project.id}`, projectId: project.id, label: project.name, getState: () => ({ dirty: guardRef.current.dirty, pending: guardRef.current.pending || pendingCellEdit.current || pendingFormulaEdit.current, persistenceError: guardRef.current.dirty ? guardRef.current.persistenceError : undefined }), save: () => guardRef.current.save(), flushRecovery: () => recovery.retry(), exportRecovery: () => guardRef.current.exportRecovery() }), [project.id, project.name]);

  useEffect(() => {
    if (formProjectId === project.id) return;
    const form = readDocumentStudioForm(stored(spreadsheetFormKey(project.id)), project.description);
    setBrief(form.brief); setInstruction(form.instruction); setModelId(form.modelId); setInspector(form.inspector); setFormProjectId(project.id); setPromptDraft(null); setPromptPicker(false);
  }, [project.id, project.description, formProjectId]);
  useEffect(() => {
    if (formProjectId !== project.id) return;
    try { localStorage.setItem(spreadsheetFormKey(project.id), JSON.stringify({ version: 1, brief, instruction, modelId, inspector })); } catch { /* The current form stays in memory. beforeRun reports failure before an API request. */ }
  }, [project.id, formProjectId, brief, instruction, modelId, inspector]);
  useEffect(() => {
    const seen = previousQuickModels.current.has(quickFlowId), previous = previousQuickModels.current.get(quickFlowId);
    previousQuickModels.current.set(quickFlowId, quickModelId);
    if (seen && previous !== quickModelId && models.some(model => model.id === quickModelId)) setModelId(quickModelId!);
  }, [quickFlowId, quickModelId, models]);
  useEffect(() => {
    let disposed = false; loadEpoch.current++;
    setLoadedKey(''); setBusy('load'); setAutoLoading(false); autoSourceAttempt.current = ''; pendingCellEdit.current = false; pendingFormulaEdit.current = false; setError(''); setRecord(null); setDirty(false); setLocalSaved(false); setHistory([]); setExportedRevision(undefined); setExportedArtifacts([]); setSourceArtifactIds([]); setConflictDraft(undefined); setRenaming(false); setDeleting(false);
    edits.reset(); resetScopedHistory(); setRecoveryVersion(undefined);
    const fallback = emptySpreadsheet(project.name); setWorkbook(fallback); setSelectedSheetId(fallback.sheets[0].id); setSelectedAddress('A1');
    void (async () => {
      try {
        const saved = bridge ? await bridge.load({ projectId: project.id }) : null;
        if (disposed) return;
        const recoveryRaw = stored(spreadsheetRecoveryKey(project.id));
        const recovered = readSpreadsheetRecovery(recoveryRaw);
        if (recoveryRaw && !recovered) {
          if (!saved) throw new Error('恢复草稿未通过校验，原草稿已保留。请先恢复原草稿，当前未创建空白文件。');
          localStorage.setItem(`${spreadsheetRecoveryKey(project.id)}.invalid.${Date.now()}`, recoveryRaw);
          setError('恢复草稿未通过校验，原始副本已单独保留。已载入项目保存版本，请核对未保存内容。');
        }
        const resolved = resolveSpreadsheetRecovery(saved, recovered);
        let conflict = readSpreadsheetRecovery(stored(spreadsheetConflictKey(project.id)));
        if (resolved.conflict) { localStorage.setItem(spreadsheetConflictKey(project.id), JSON.stringify(resolved.conflict)); conflict = resolved.conflict; }
        const migrated = !saved && !recovered ? legacySpreadsheetDocument(stored(`xuzuo.document.${project.id}`), project.name) : undefined;
        const next = resolved.document || migrated || fallback;
        setRecord(saved); setWorkbook(next); setSourceArtifactIds(resolved.sourceArtifactIds); setSelectedSheetId(next.sheets[0].id); setSelectedAddress('A1'); setDirty(resolved.dirty || !!migrated); setConflictDraft(conflict); setLoadedKey(projectKey);
        if (saved && bridge) { const versions = await bridge.history({ projectId: project.id }); if (!disposed) setHistory(versions); }
      } catch (cause) {
        if (!disposed) setError(workflowPublicError(cause, '工作簿读取失败，请保留原文件并检查工作区。'));
        if (bridge) { try { const versions = await bridge.history({ projectId: project.id }); if (!disposed) setHistory(versions); } catch { /* Preserve the source error if no independent history is available. */ } }
      }
      finally { if (!disposed) setBusy(''); }
    })();
    return () => { disposed = true; loadEpoch.current++; };
  // Load persisted source only on project/retry; generated content is handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, bridge, reload]);
  useEffect(() => { setFormulaInput(cellToInput(selectedCell)); pendingFormulaEdit.current = false; }, [sheet.id, selectedAddress, selectedCell]);
  useEffect(() => {
    const field = formulaEditor.current;
    if (field) { field.style.height = 'auto'; field.style.height = `${Math.max(40, field.scrollHeight)}px`; }
  }, [formulaInput]);
  useEffect(() => {
    if (!ready || busy || !source || autoSourceAttempt.current === source.id) return;
    const snapshot = current.current;
    if (snapshot.sourceArtifactIds.length || (snapshot.record?.revision || 0) > 1 || hasSpreadsheetEdits(snapshot.workbook, project.name) || pendingCellEdit.current || pendingFormulaEdit.current) return;
    const epoch = loadEpoch.current, sourceId = source.id;
    autoSourceAttempt.current = sourceId; setAutoLoading(true);
    void (async () => {
      try {
        const preview = await props.workflowRunner.previewArtifact(sourceId);
        if (typeof preview.text !== 'string' || !preview.text.trim()) throw new Error('这份产物没有可载入的完整表格内容。');
        const next = spreadsheetFromText(preview.text, snapshot.workbook.title);
        if (!next.sheets.some(item => Object.values(item.cells).some(cell => cell.formula !== undefined || cell.value !== null && String(cell.value).trim() !== ''))) throw new Error('生成工作簿没有实际内容，当前编辑源仍保留。');
        if (!operationCurrent(snapshot.projectKey, epoch) || autoSourceAttempt.current !== sourceId || current.current.workbook !== snapshot.workbook || pendingCellEdit.current || pendingFormulaEdit.current) return;
        change(next, [sourceId], false); setSelectedSheetId(next.sheets[0].id); setSelectedAddress('A1');
      } catch (cause) {
        if (operationCurrent(snapshot.projectKey, epoch) && autoSourceAttempt.current === sourceId) setError(workflowPublicError(cause, '生成表格未能载入，原内容仍保留。'));
      } finally { if (operationCurrent(snapshot.projectKey, epoch) && autoSourceAttempt.current === sourceId) setAutoLoading(false); }
    })();
  // A source may arrive while this editor is open. Never apply an outdated response over an edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, busy, source?.id, projectKey]);
  useEffect(() => {
    const application = props.promptToApply;
    if (!application || application.projectId !== project.id || appliedPrompt.current === application.token || !['excel', 'general'].includes(application.category)) return;
    appliedPrompt.current = application.token;
    layout.openPanel('ai');
    if (application.mode === 'refine') { setInstruction(application.content); setInspector('refine'); } else { setBrief(application.content); setInspector('create'); }
    props.onPromptApplied(application.token);
  }, [props.promptToApply, props.onPromptApplied, project.id]);

  async function useReferenceMaterial(file: ArtifactMetadata) {
    if (!ready || busy || file.projectId !== project.id || current.current.projectKey !== projectKey) throw new Error('项目已变化，素材副本保留，未修改表格。');
    const references = project.referenceFiles || [];
    if (references.length >= 16) throw new Error('项目已有 16 份参考资料，请先移除不需要的引用；新副本在项目文件中保留。');
    props.onUpdateProject(project.id, { referenceFiles: [...references, { id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind, ...(file.provenance ? { provenance: file.provenance } : {}) }] });
    layout.closePanel();
    props.notify(file.kind === 'image' ? '图片已作为项目参考保存，单元格未改动，未调用模型。' : '素材已加入项目参考，表格和费用保持不变。');
  }
  function historySnapshot(): SpreadsheetHistorySnapshot { return { workbook: current.current.workbook, sourceArtifactIds: current.current.sourceArtifactIds, selectedSheetId, selectedAddress }; }
  function resetScopedHistory() { cellHistory.current = emptySpreadsheetScopeHistory(); scopedInputs.current.clear(); scopedText.reset(); setCellTextSelection(undefined); }
  function change(next: SpreadsheetDocument, sources = current.current.sourceArtifactIds, manual = true, group?: string, localOperation = false, knownCells?: { sheetId: string; address: string }[]) {
    if (manual && next !== current.current.workbook && props.activeProject.status === 'complete') props.onUpdateProject(project.id, { status: 'review', confirmedDelivery: undefined });
    if (!manual) resetScopedHistory();
    else if (!localOperation) {
      const previous = cellHistory.current, updated = recordSpreadsheetScope(previous, current.current.workbook, next, knownCells);
      cellHistory.current = updated;
      if (updated !== previous && updated.reason) { scopedInputs.current.clear(); scopedText.reset(); }
      const transaction = updated.past.at(-1);
      if (transaction && transaction.id > previous.sequence) for (const patch of transaction.patches) {
        const key = `${patch.sheetId}/${patch.address}`, before = scopedInputs.current.get(key) ?? cellToInput(patch.before), after = cellToInput(patch.after);
        scopedText.record(key, before, after); scopedInputs.current.set(key, after);
      }
      while (scopedInputs.current.size > 2000) scopedInputs.current.delete(scopedInputs.current.keys().next().value!);
    }
    if (manual) edits.record(historySnapshot(), { workbook: next, sourceArtifactIds: sources, selectedSheetId, selectedAddress }, group); else edits.reset();
    current.current = { ...current.current, workbook: next, sourceArtifactIds: sources };
    setSourceArtifactIds(sources);
    setWorkbook(next); setDirty(true); setLocalSaved(false); setError('');
  }
  function moveHistory(direction: 'undo' | 'redo') {
    if (!ready || busy) return;
    const snapshot = edits[direction](historySnapshot()); if (!snapshot) return;
    resetScopedHistory();
    current.current = { ...current.current, workbook: snapshot.workbook, sourceArtifactIds: snapshot.sourceArtifactIds };
    setWorkbook(snapshot.workbook); setSourceArtifactIds(snapshot.sourceArtifactIds); setSelectedSheetId(snapshot.selectedSheetId); setSelectedAddress(snapshot.selectedAddress); setDirty(true); setLocalSaved(false); setError('');
  }
  function changeSheet(next: SpreadsheetSheet, group?: string, knownAddresses?: string[]) {
    try { change(validateSpreadsheetEdit(current.current.workbook, next, knownAddresses), current.current.sourceArtifactIds, true, group, false, knownAddresses?.map(address => ({ sheetId: next.id, address }))); }
    catch (cause) { setError(workflowPublicError(cause, '单元格修改未能应用，原内容仍保留。')); }
  }
  function inputCell(address: string, value: string) { changeSheet(updateSpreadsheetCell(sheet, address, value), `cell:${sheet.id}:${address}`, [address]); }
  function clearSelectedRange() {
    try { const next = clearSpreadsheetRange(sheet, refineRange || selectedAddress); if (next !== sheet) changeSheet(next); }
    catch (cause) { setError(workflowPublicError(cause, '清空未完成，原内容保留。')); }
  }
  function fillSelectedRange() {
    try { changeSheet(fillSpreadsheetDown(sheet, refineRange || selectedAddress)); props.notify('已向下填充，公式相对引用已调整，可撤销。'); }
    catch (cause) { setError(workflowPublicError(cause, '填充未完成，原内容保留。')); }
  }
  function captureCellSelection(event: { target: EventTarget | null }, input = false) {
    const element = event.target;
    if (!(element instanceof HTMLTextAreaElement) || element !== formulaEditor.current && !element.closest('.ss-grid')) return;
    const address = element === formulaEditor.current ? selectedAddress : element.closest('[role="gridcell"]')?.getAttribute('aria-label')?.match(/^[A-Z]+[1-9]\d*/)?.[0];
    if (!address) return;
    const key = `${sheet.id}/${address}`, value = element.value;
    if (input) { scopedText.record(key, scopedInputs.current.get(key) ?? cellToInput(sheet.cells[address]), value); scopedInputs.current.set(key, value); if (scopedInputs.current.size > 2000) scopedInputs.current.delete(scopedInputs.current.keys().next().value!); }
    setCellTextSelection(previous => ({ key, sheetId: sheet.id, address, value, start: element.selectionStart, end: element.selectionEnd, element, recoveryPoint: !input && previous?.recoveryPoint && previous.key === key && previous.start === element.selectionStart && previous.end === element.selectionEnd }));
  }
  function selectCell(address: string) { setCellTextSelection(undefined); setSelectedAddress(address); }
  function moveScopedHistory(direction: 'undo' | 'redo') {
    if (!ready || busy) return;
    const selected = cellTextSelection, exact = selected && selected.sheetId === sheet.id && selected.address === selectedAddress && (selected.end > selected.start || selected.recoveryPoint);
    const raw = selected?.element.isConnected ? selected.element.value : cellToInput(current.current.workbook.sheets.find(item => item.id === sheet.id)?.cells[selectedAddress]);
    if (exact && raw !== selected.value) { setError('所选文字已变化，请重新选择；局部历史和当前数据保留。'); return; }
    const scalar = cellFromInput(raw), whole = !!exact && selected.start === 0 && selected.end === raw.length;
    const textOperation = !!exact && scalar.formula === undefined && (typeof scalar.value === 'string' || selected.recoveryPoint && raw === '');
    if (exact && !textOperation && !whole) { setError('公式和数值仅支持整个单元格撤销，不能截取其中一部分。'); return; }
    if (selected?.element.isConnected && selected.element === document.activeElement) selected.element.blur();
    try {
      const actual = current.current.workbook, activeSheet = actual.sheets.find(item => item.id === sheet.id);
      if (!activeSheet) throw new Error('工作表已变化，请重新选择。');
      if (selected?.sheetId === sheet.id && selected.address === selectedAddress && cellToInput(activeSheet.cells[selectedAddress]) !== raw) throw new Error('当前输入尚未通过校验或格式已变化，请先核对并重新选择，局部历史未消费。');
      if (exact && textOperation) {
        const oldText = cellToInput(activeSheet.cells[selectedAddress]);
        if (oldText !== raw) throw new Error('单元格格式已变化，请重新选择文字；原数据保留。');
        const result = scopedText.preview(direction, selected.key, oldText, selected.start, selected.end);
        if (!result.available || result.value === undefined) throw new Error(result.reason || '所选文字没有可恢复修改。');
        const replacement = updateSpreadsheetCell(activeSheet, selectedAddress, result.value);
        if (!whole && result.value !== '' && (replacement.cells[selectedAddress].formula !== undefined || typeof replacement.cells[selectedAddress].value !== 'string')) throw new Error('局部文字恢复将改变单元格数据类型，请使用完整单元格撤销。');
        const next = calculationCache.validate({ ...actual, sheets: actual.sheets.map(item => item.id === activeSheet.id ? replacement : item) });
        change(next, current.current.sourceArtifactIds, true, undefined, true);
        scopedText[direction](selected.key, oldText, selected.start, selected.end);
        cellHistory.current = emptySpreadsheetScopeHistory(); scopedInputs.current.set(selected.key, result.value);
        setFormulaInput(result.value); pendingFormulaEdit.current = false;
        requestAnimationFrame(() => { const field = formulaEditor.current; if (field) { field.focus({ preventScroll: true }); const start = result.selectionStart ?? 0, end = result.selectionEnd ?? result.value!.length; field.setSelectionRange(start, end); setCellTextSelection({ ...selected, value: result.value!, start, end, element: field, recoveryPoint: true }); } });
      } else {
        const scope = spreadsheetHistoryScope(activeSheet, refineRange || selectedAddress), result = applySpreadsheetScope(cellHistory.current, direction, actual, scope);
        if (!result.available || !result.document) throw new Error(result.reason || '此区域没有可恢复修改。');
        const next = calculationCache.validate(result.document);
        change(next, current.current.sourceArtifactIds, true, undefined, true);
        cellHistory.current = result.history; scopedInputs.current.clear(); scopedText.reset(); setCellTextSelection(undefined);
      }
      setError(''); props.notify('已仅恢复所选内容并重新计算，其他单元格与调用费用保留。');
    } catch (cause) { setError(workflowPublicError(cause, '局部操作未应用，当前内容保留。')); }
  }
  function formatCell(changes: Partial<SpreadsheetCell>) {
    try {
      const area = spreadsheetRange(sheet, refineRange || selectedAddress);
      if ((sheet.view?.sort || sheet.view?.filter?.text) && (area.top !== area.bottom || area.left !== area.right)) throw new Error('请先清除查看排序和筛选，再批量设置格式；隐藏行和当前内容未修改。');
      const cells = { ...sheet.cells }, addresses: string[] = [];
      for (let row = area.top; row <= area.bottom; row++) for (let column = area.left; column <= area.right; column++) {
        const address = `${columnLabel(column)}${row}`; addresses.push(address);
        cells[address] = { ...(cells[address] || { value: null }), ...changes };
      }
      changeSheet({ ...sheet, cells }, undefined, addresses); setError('');
    } catch (cause) { setError(workflowPublicError(cause, '格式未应用，原内容保留。')); }
  }
  function selectSheet(id: string) { setCellTextSelection(undefined); setSelectedSheetId(id); setSelectedAddress('A1'); setRenaming(false); setDeleting(false); }
  function addSheet() { if (workbook.sheets.length >= SPREADSHEET_LIMITS.sheets) return; const next = newSpreadsheetSheet(nextSpreadsheetName(workbook.sheets)); change({ ...workbook, sheets: [...workbook.sheets, next] }); selectSheet(next.id); }
  function renameSheet() {
    const problem = spreadsheetNameError(sheetName, workbook.sheets, sheet.id);
    if (problem) { setError(problem); return; }
    change(renameSpreadsheetSheet(workbook, sheet.id, sheetName)); setRenaming(false);
  }
  function deleteSheet() {
    if (workbook.sheets.length < 2) return;
    const remaining = workbook.sheets.filter(item => item.id !== sheet.id); change({ ...workbook, sheets: remaining }); selectSheet(remaining[0].id);
  }
  function operationCurrent(key: string, epoch: number) { return current.current.projectKey === key && loadEpoch.current === epoch; }
  async function persist(exportFile = false, saveCopy = false) {
    if (!ready || busy || persisting.current) return false;
    const snapshot = current.current, epoch = loadEpoch.current;
    const unchanged = !!snapshot.record && sameDocument(snapshot.workbook, snapshot.record.document) && snapshot.sourceArtifactIds.join('|') === snapshot.record.sourceArtifactIds.join('|');
    if (!exportFile && unchanged) { props.notify('当前工作簿已经保存。'); return true; }
    persisting.current = true;
    const input = { projectId: project.id, expectedRevision: snapshot.record?.revision || 0, document: snapshot.workbook, sourceArtifactIds: snapshot.sourceArtifactIds };
    setBusy(exportFile ? 'export' : 'save'); setError('');
    try {
      await calculationState.flush();
      if (!operationCurrent(snapshot.projectKey, epoch)) return false;
      input.document = validateSpreadsheetDocument(input.document);
      if (!bridge) {
        localStorage.setItem(spreadsheetRecoveryKey(project.id), JSON.stringify({ document: input.document, sourceArtifactIds: snapshot.sourceArtifactIds, baseRevision: 0 }));
        if (operationCurrent(snapshot.projectKey, epoch)) { setWorkbook(input.document); setDirty(false); setLocalSaved(true); props.notify('已保存浏览器恢复草稿。桌面版可保存项目版本并导出真实 XLSX。'); }
        return true;
      }
      const result = exportFile ? await bridge.export(input) : { record: await bridge.save(input), artifacts: [] };
      if (!operationCurrent(snapshot.projectKey, epoch)) return false;
      current.current = { ...current.current, record: result.record, workbook: result.record.document };
      setRecord(result.record); setWorkbook(result.record.document); setDirty(false); setLocalSaved(false);
      if (exportFile) { setExportedRevision(result.record.revision); setExportedArtifacts(items => [...new Map([...items, ...result.artifacts].map(file => [file.id, file])).values()]); }
      const versions = await bridge.history({ projectId: project.id }).catch(() => undefined);
      if (!operationCurrent(snapshot.projectKey, epoch)) return false;
      if (versions) setHistory(versions);
      props.onUpdateProject(project.id, { name: result.record.document.title, description: brief });
      if (saveCopy && exportFile && result.artifacts[0]) {
        const copied = await props.workflowRunner.saveArtifact(result.artifacts[0].id);
        if (!operationCurrent(snapshot.projectKey, epoch)) return false;
        props.notify(copied.saved ? '已生成新的本地导出版本，原文件保留，未调用模型。' : '已生成新的本地导出版本，原文件保留，未调用模型；已取消另存。');
      } else props.notify(exportFile ? '已生成新的本地导出版本，原文件保留，未调用模型。' : `已保存工作簿 v${result.record.revision}，未调用模型。`);
      if (exportFile) layout.openPanel('delivery');
      return true;
    } catch (cause) {
      if (!operationCurrent(snapshot.projectKey, epoch)) return false;
      if (exportFile) layout.openPanel('delivery');
      setError(workflowPublicError(cause, '保存未完成，当前编辑内容仍保留。'));
      if (bridge && exportFile) { try { const latest = await bridge.load({ projectId: project.id }); if (latest && operationCurrent(snapshot.projectKey, epoch) && sameDocument(latest.document, snapshot.workbook)) { setRecord(latest); setDirty(false); } } catch { /* Keep the draft and original error. */ } }
      return false;
    } finally { persisting.current = false; if (operationCurrent(snapshot.projectKey, epoch)) setBusy(''); }
  }
  async function loadGenerated() {
    if (!source || busy || !ready || autoLoading) return;
    const key = projectKey, epoch = loadEpoch.current; setBusy('source'); setError('');
    try {
      const preview = await props.workflowRunner.previewArtifact(source.id);
      if (!operationCurrent(key, epoch)) return;
      if (typeof preview.text !== 'string' || !preview.text.trim()) throw new Error('这份产物没有可载入的表格 JSON。');
      const next = spreadsheetFromText(preview.text, current.current.workbook.title);
      const backup = { document: current.current.workbook, sourceArtifactIds: current.current.sourceArtifactIds, baseRevision: current.current.record?.revision || 0 };
      const previous = stored(spreadsheetConflictKey(project.id));
      if (previous) localStorage.setItem(`${spreadsheetConflictKey(project.id)}.${Date.now()}`, previous);
      localStorage.setItem(spreadsheetConflictKey(project.id), JSON.stringify(backup));
      change(next, [source.id]); setConflictDraft(backup); setSelectedSheetId(next.sheets[0].id); setSelectedAddress('A1'); props.notify('已切换生成表格，上次编辑已保留，可一键恢复。');
    } catch (cause) { if (operationCurrent(key, epoch)) setError(workflowPublicError(cause, '生成表格载入失败，当前工作簿仍保留。')); }
    finally { if (operationCurrent(key, epoch)) setBusy(''); }
  }
  async function previewCurrentOffice() {
    if (!ready || busy) return;
    if (!dirty && currentExport[0]) { setOfficePreview(currentExport[0]); return; }
    const key = projectKey; previewAfterExport.current = true;
    const saved = await persist(true);
    if (!saved && current.current.projectKey === key) previewAfterExport.current = false;
  }
  async function applyVersion(revision: number) {
    if (!bridge || busy) return false;
    if (dirty) { props.notify('请先保存当前修改，再载入历史版本。', 'info'); return false; }
    const key = projectKey, epoch = loadEpoch.current; setBusy('version'); setError('');
    try {
      const previous = await bridge.loadVersion({ projectId: project.id, revision });
      if (!operationCurrent(key, epoch)) return false;
      if (!ready) { setRecoveryVersion(previous); return true; }
      change(previous.document, previous.sourceArtifactIds); setSelectedSheetId(previous.document.sheets[0].id); setSelectedAddress('A1'); props.notify(`已载入 v${revision} 内容，保存后会成为新版本，原历史保留。`);
      return true;
    } catch (cause) { if (operationCurrent(key, epoch)) setError(workflowPublicError(cause, '历史版本读取失败。')); return false; }
    finally { if (operationCurrent(key, epoch)) setBusy(''); }
  }
  async function restoreDamagedSource() {
    if (!bridge?.restore || !recoveryVersion || busy) return;
    setBusy('restore'); setError('');
    try { await bridge.restore({ projectId: project.id, revision: recoveryVersion.revision }); setRecoveryVersion(undefined); setReload(value => value + 1); props.notify('已保留原稿并恢复为新的工作簿版本，未调用模型。'); }
    catch (cause) { setError(workflowPublicError(cause, '历史工作簿恢复未完成，原稿仍保留。')); }
    finally { setBusy(''); }
  }
  function restoreConflict() {
    if (!conflictDraft || !ready || busy) return;
    try {
      const backup = { document: current.current.workbook, sourceArtifactIds: current.current.sourceArtifactIds, baseRevision: record?.revision || 0 };
      localStorage.setItem(spreadsheetRecoveryKey(project.id), JSON.stringify({ ...conflictDraft, baseRevision: record?.revision || 0 })); localStorage.setItem(spreadsheetConflictKey(project.id), JSON.stringify(backup));
      change(conflictDraft.document, conflictDraft.sourceArtifactIds); setSelectedSheetId(conflictDraft.document.sheets[0].id); setSelectedAddress('A1'); setConflictDraft(backup);
    } catch { setError('恢复草稿无法保存，原恢复副本仍保留，当前工作簿未被替换。'); }
  }
  function beforeRun() {
    if (!ready || busy) return false;
    try {
      localStorage.setItem(spreadsheetRecoveryKey(project.id), JSON.stringify({ document: current.current.workbook, sourceArtifactIds, baseRevision: record?.revision || 0 }));
      localStorage.setItem(spreadsheetFormKey(project.id), JSON.stringify({ version: 1, brief, instruction, modelId: selectedModel?.id || '', inspector })); return true;
    } catch (cause) { setActionError(workflowPublicError(cause, '草稿未能保存。当前需求和表格仍保留，请检查本机存储后再运行。')); return false; }
  }
  function generate(refine: boolean) {
    if (refine) return;
    if (generationIssue || textKeyIssue) return;
    setActionError('');
    if (!beforeRun()) return;
    props.onGenerate(project.id, refine ? 'AI 精修' : '初次生成', 1, undefined, { prompt: `${refine ? instruction : brief}\n${refine ? '返回完整修订工作簿，保留未要求改变的数据、工作表名称和公式引用。' : '返回完整工作簿，标明字段与单位。'} 不要编造未提供的数据或事实。`, input: refine ? JSON.stringify(current.current.workbook) : brief, modelConfigId: selectedModel?.id, credentialId: selectedCredential, capability: 'text' });
  }
  function savePrompt() { setPromptDraft({ name: `Excel ${inspector === 'refine' ? '精修' : '创作'}模板`, category: 'excel', content: inspector === 'refine' ? instruction : brief, description: '来自当前表格工作台', mode: inspector === 'refine' ? 'refine' : 'create', businessCategoryId: project.businessCategoryId }); }
  let refinementTargets: ReturnType<typeof spreadsheetRefinementTargets> = [], refinementRangeError = '';
  try { refinementTargets = spreadsheetRefinementTargets(workbook, sheet.id, refineRange || selectedAddress, allowFormulaRefinement); } catch (cause) { refinementRangeError = workflowPublicError(cause, '精修区域不正确。'); }
  const refinementScopeControls = <><label>精修区域<input className="field" aria-label="表格精修区域" placeholder={selectedAddress} value={refineRange} onChange={event => setRefineRange(event.target.value)} /></label><label><input type="checkbox" checked={allowFormulaRefinement} onChange={event => setAllowFormulaRefinement(event.target.checked)} />允许建议修改区域内的公式</label>{refinementRangeError && <p role="alert">{refinementRangeError}</p>}</>;
  const scopedRefinement = <LocalRefinement props={props} targets={refinementTargets} instruction={instruction} model={selectedModel} preferredCredentialId={selectedCredential} compact disabled={!ready || !!busy || !!generationTask || !!refinementRangeError || !!textKeyIssue} beforeRun={beforeRun} onApply={changes => { change(validateSpreadsheetDocument(applySpreadsheetRefinement(current.current.workbook, changes))); props.notify('已应用区域修改并重算；可撤销，原单元格格式保留。'); }} />;
  const hasResult = hasSpreadsheetEdits(workbook, project.name);
  const disabled = !!busy || !ready;
  const cellFormatToolbar = <div className="ss-toolbar" role="toolbar" aria-label="单元格格式"><button aria-label="单元格加粗" aria-pressed={!!selectedCell?.bold} disabled={disabled} onClick={() => formatCell({ bold: !selectedCell?.bold })}><b>B</b></button><span className="ss-toolbar-divider" />{([{ value: 'left', Icon: AlignLeft, label: '左对齐' }, { value: 'center', Icon: AlignCenter, label: '居中对齐' }, { value: 'right', Icon: AlignRight, label: '右对齐' }] as const).map(({ value, Icon, label }) => <button key={value} aria-label={`单元格${label}`} aria-pressed={(selectedCell?.align || 'left') === value} disabled={disabled} onClick={() => formatCell({ align: value })}><Icon size={16} /></button>)}<Select aria-label="单元格数字格式" value={selectedCell?.format || 'general'} onValueChange={value => formatCell({ format: value as SpreadsheetCell['format'] })} disabled={disabled} options={[{ value: 'general', label: '常规' }, { value: 'integer', label: '整数' }, { value: 'number', label: '数值 · 2 位小数' }, { value: 'currency', label: '货币 · 人民币' }, { value: 'percent', label: '百分比' }]} /><span className="ss-toolbar-spacer" /><button disabled={disabled || sheet.rowCount >= SPREADSHEET_ROW_LIMIT} onClick={() => changeSheet({ ...sheet, rowCount: Math.min(SPREADSHEET_ROW_LIMIT, sheet.rowCount + 50) })}><Plus size={14} />50 行</button><button disabled={disabled || sheet.columnCount >= SPREADSHEET_COLUMN_LIMIT} onClick={() => changeSheet({ ...sheet, columnCount: Math.min(SPREADSHEET_COLUMN_LIMIT, sheet.columnCount + 1) })}><Plus size={14} />1 列</button></div>;
  function openInspector(mode?: typeof inspector) { if (mode) setInspector(mode); layout.openPanel(mode === 'history' ? 'versions' : 'ai'); }
  function chooseTextModel(value: string) { setModelId(value); chooseTextCredential(''); }
  function chooseTextCredential(value: string) { const choice = studioCredentialChoice(value, selectedModel); setCredentialId(choice); if (!saveStudioCredentialPreference(project.id, 'text', choice)) props.notify('本次 Key 选择已带入，但偏好暂未保存。', 'info'); }
  function fixGeneration(target: StudioActionTarget) {
    if (target === 'models') props.navigate('models');
    else if (target === 'task') props.navigate('activity', project.id);
    else if (target === 'reload') setReload(value => value + 1);
    else { layout.openPanel('ai'); requestAnimationFrame(() => { focusStudioField(workbench.current, target === 'request' ? 'textarea[aria-label="' + (inspector === 'refine' ? '表格修改指令' : '表格创作需求') + '"]' : target === 'credential' ? '[aria-label="表格调用Key"]' : '[aria-label="表格实际模型"]', target === 'model' || target === 'credential'); }); }
  }
  guardRef.current = { dirty, pending: ['save', 'export', 'restore'].includes(busy), persistenceError: recovery.error, save: () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); return persist(); }, exportRecovery: recovery.exportDraft };
  useEditorShortcuts(workbench, ready && !busy, { save: () => persist(), undo: () => moveHistory('undo'), redo: () => moveHistory('redo') });
  const textCredentialControl = <label>调用 Key<Select className="simple-inline-field" aria-label="表格调用Key" value={selectedCredential || ''} onValueChange={chooseTextCredential} options={textCredentials.map(key => ({ value: key.id, label: key.name }))} placeholder="选择 Key" />{textKeyIssue && <small role="status">{textKeyIssue}</small>}</label>;
  const actionStatus = <StudioActionStatus id={actionStatusId} issue={generationIssue || (textKeyIssue ? { message: textKeyIssue, action: '选择调用账户', target: 'credential' } : undefined)} error={actionError} note={reviewing ? '继续制作会保留已有结果与费用。' : undefined} onFix={fixGeneration} />;
  const textSelection = cellTextSelection?.sheetId === sheet.id && cellTextSelection.address === selectedAddress && (cellTextSelection.end > cellTextSelection.start || cellTextSelection.recoveryPoint) ? cellTextSelection : undefined;
  const selectionValue = textSelection?.element.isConnected ? textSelection.element.value : formulaInput;
  const selectedScalar = cellFromInput(selectionValue), protectedValue = selectedScalar.formula !== undefined || typeof selectedScalar.value !== 'string' && !(textSelection?.recoveryPoint && selectionValue === '');
  const wholeTextSelected = !!textSelection && textSelection.start === 0 && textSelection.end === selectionValue.length;
  const exactText = !!textSelection && !protectedValue;
  const scopeVisible = showScopeTools || !!textSelection;
  let scopeReason = textSelection && textSelection.value !== selectionValue ? '所选文字已变化，请重新选择；局部历史和当前数据保留。' : protectedValue && textSelection && !wholeTextSelected ? '公式和数值仅支持整个单元格撤销，不能截取其中一部分。' : '';
  let scopeUndo: { available: boolean; reason?: string } = { available: false }, scopeRedo: { available: boolean; reason?: string } = { available: false };
  if (scopeVisible && !scopeReason) {
    if (exactText) {
      scopeUndo = scopedText.inspect('undo', textSelection.key, selectionValue, textSelection.start, textSelection.end);
      scopeRedo = scopedText.inspect('redo', textSelection.key, selectionValue, textSelection.start, textSelection.end);
    } else try {
      const scope = spreadsheetHistoryScope(sheet, refineRange || selectedAddress);
      scopeUndo = inspectSpreadsheetScope(cellHistory.current, 'undo', workbook, scope);
      scopeRedo = inspectSpreadsheetScope(cellHistory.current, 'redo', workbook, scope);
      const pending = cellTextSelection?.element.isConnected && cellTextSelection.element.value !== cellToInput(selectedCell) && scope.contains(selectedAddress);
      if (pending && scopedText.inspect('undo', cellTextSelection.key, cellTextSelection.element.value, 0, cellTextSelection.element.value.length).available) scopeUndo = { available: true, reason: '' };
    } catch (cause) { scopeReason = workflowPublicError(cause, '请填写有效的局部区域。'); }
  }

  function openTool(tool: StudioTool) { if (tool === 'ai') setInspector(hasResult ? 'refine' : 'create'); layout.togglePanel(tool); if (tool === 'ai') requestAnimationFrame(() => { const field = workbench.current?.querySelector<HTMLTextAreaElement>('.sw-panel textarea[aria-label="表格修改指令"],.sw-panel textarea[aria-label="表格创作需求"]'); if (field?.getClientRects().length) field.focus(); }); }
  useStudioToolRequests(props.workspaceId, project.id, tool => { if (tool === 'ai' && inspector === 'history') setInspector(hasResult ? 'refine' : 'create'); layout.openPanel(tool); });
  const navigation = <><nav className="sw-content-nav" aria-label="工作表导航">{workbook.sheets.map(item => <button type="button" key={item.id} aria-current={item.id === sheet.id ? 'page' : undefined} disabled={disabled} onClick={() => selectSheet(item.id)}><span>工作表</span><strong>{item.name}</strong><small>{item.rowCount} × {item.columnCount}</small></button>)}</nav><div className="sw-panel-actions"><button type="button" className="btn btn-secondary" aria-label="新增工作表" disabled={disabled || workbook.sheets.length >= SPREADSHEET_LIMITS.sheets} onClick={addSheet}><Plus size={14} />新增</button><button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => { setSheetName(sheet.name); setRenaming(true); setDeleting(false); }}>重命名</button><button type="button" className="btn btn-ghost" aria-label="删除当前工作表" disabled={disabled || workbook.sheets.length < 2} onClick={() => { setDeleting(true); setRenaming(false); }}><Trash2 size={14} /></button></div>        {renaming && <form className="ss-inline-sheet" onSubmit={event => { event.preventDefault(); renameSheet(); }}><label>工作表名称<input autoFocus aria-label="工作表名称" value={sheetName} maxLength={31} onChange={event => setSheetName(event.target.value)} /></label><button className="btn btn-secondary" type="submit">确认</button><button className="btn btn-secondary" type="button" onClick={() => setRenaming(false)}>取消</button></form>}
        {deleting && <div className="ss-inline-sheet" role="alert"><span>删除“{sheet.name}”及其中内容？保存的历史版本仍会保留。</span><button className="btn btn-secondary" onClick={deleteSheet}>确认删除</button><button className="btn btn-secondary" onClick={() => setDeleting(false)}>取消</button></div>}
</>;
  const versions = <VersionTimeline key={project.id} projectId={project.id} document={workbook} savedRevision={record?.revision} dirty={dirty} busy={!!busy} versions={history} exportNames={currentExport.map(file => file.name)} loadVersion={revision => bridge ? bridge.loadVersion({ projectId: project.id, revision }) : Promise.reject(new Error('请在桌面应用中读取已保存版本。'))} onRestore={applyVersion} />;
  const formatTools = <>{cellFormatToolbar}<div className="sw-scope-label">{sheet.name}!{refineRange || selectedAddress} · 格式、AI 和局部历史使用同一选区</div><SpreadsheetDataTools projectId={project.id} sheet={sheet} range={refineRange || selectedAddress} calculation={calculationState.pending || calculationState.error ? undefined : calculation} disabled={disabled} containsFormulas={workbook.sheets.some(item => Object.values(item.cells).some(cell => cell.formula !== undefined))} onRange={value => { setRefineRange(value); setCellTextSelection(undefined); }} onChange={next => { const actual = current.current.workbook.sheets.find(item => item.id === sheet.id); if (actual !== sheet) { setError('单元格刚刚更新，请核对当前内容后重试操作，未覆盖新输入。'); return; } changeSheet(next); }} onFeedback={message => props.notify(message, 'info')} /><RememberedDetails rememberKey={layout.rememberKey('spreadsheet:formula-check')} defaultOpen={!!calculation?.issues.length}><summary>公式检查 · {calculation?.issues.length || 0} 项问题</summary><p>{calculationState.error || (calculationState.pending ? '后台正在计算，等待当前修订完成后可导出。' : '已计算 ' + (calculation?.calculatedCount || 0) + ' / ' + (calculation?.formulaCount || 0) + ' 个公式')}</p>{!!calculation?.issues.length && <RememberedDetails rememberKey={layout.rememberKey('spreadsheet:formula-issues')} className="ss-formula-issues"><summary>查看公式问题（{calculation.issues.length}）</summary><ul>{calculation.issues.map(issue => <li key={`${issue.sheetId}-${issue.address}`}><button onClick={() => { selectSheet(issue.sheetId); setSelectedAddress(issue.address); }}>{workbook.sheets.find(item => item.id === issue.sheetId)?.name}!{issue.address}</button><span>{issue.status === 'unsupported' ? '不支持' : '错误'}：{issue.message}</span></li>)}</ul></RememberedDetails>}</RememberedDetails></>;
  const aiTools = <CompactAiPanel mode={<div className="sw-ai-mode"><button type="button" className={inspector !== 'refine' ? 'active' : ''} aria-pressed={inspector !== 'refine'} onClick={() => setInspector('create')}>生成新工作簿</button><button type="button" className={inspector === 'refine' ? 'active' : ''} aria-pressed={inspector === 'refine'} onClick={() => setInspector('refine')}>修改当前选区</button></div>} footer={<>
    {inspector === 'refine' ? scopedRefinement : <button type="button" className="btn btn-primary" disabled={!!generationIssue || !!textKeyIssue} aria-describedby={generationIssue || actionError || reviewing ? actionStatusId : undefined} onClick={() => generate(false)}><Sparkles size={16} />生成表格</button>}
    {actionStatus}<p className="studio-ai-fee-note">调用费用自动记录</p>
  </>}>
    {inspector === 'refine' && <div className="sw-scope-label">{sheet.name + '!' + (refineRange || selectedAddress)}</div>}
    <div className="studio-ai-prompt-head"><label htmlFor={'spreadsheet-ai-input-' + project.id}>{inspector === 'refine' ? '修改指令' : '创作需求'}</label><button type="button" aria-label="提示词模板" onClick={() => setPromptPicker(true)}><BookOpen size={14} />模板</button></div>
    <textarea id={'spreadsheet-ai-input-' + project.id} aria-label={inspector === 'refine' ? '表格修改指令' : '表格创作需求'} value={inspector === 'refine' ? instruction : brief} rows={4} onChange={event => inspector === 'refine' ? setInstruction(event.target.value) : setBrief(event.target.value)} placeholder="提供字段、单位和已确认数据，说明需要的计算" />
    {inspector === 'refine' && refinementScopeControls}
    <div className="studio-ai-model-row"><span>模型</span><Select aria-label="表格实际模型" value={selectedModel?.id || ''} onValueChange={chooseTextModel} options={[{ value: '', label: '请选择文本模型' }, ...models.map(model => ({ value: model.id, label: model.name, description: model.modelId }))]} /></div>
    <AiSettingsSection rememberKey={layout.rememberKey('spreadsheet:account')} title="调用账户" summary={textCredentials.find(key => key.id === selectedCredential)?.name || '未选择账户'} defaultOpen={!!textKeyIssue}>{textCredentialControl}<button type="button" className="btn btn-ghost" onClick={() => props.navigate('models')}>管理模型与账户</button></AiSettingsSection>
    <AiSettingsSection rememberKey={layout.rememberKey('spreadsheet:more-tools')} title="更多工具"><button type="button" className="btn btn-ghost" disabled={!(inspector === 'refine' ? instruction : brief).trim()} onClick={savePrompt}><Save size={14} />保存模板</button><RememberedDetails rememberKey={layout.rememberKey('spreadsheet:custom-actions')}><summary>自定义创作功能</summary><StudioActions props={props} studio="documents" projectId={project.id} outputKind="excel" input={serializedWorkbook} onBeforeRun={beforeRun} /></RememberedDetails></AiSettingsSection>
  </CompactAiPanel>;
  const assets = <Suspense fallback={<p role="status">正在打开参考素材…</p>}><StudioAssetPicker embedded props={props} imagesOnly={false} title="选择表格参考素材" description="加入项目参考资料；不会直接嵌入工作表或修改单元格。" confirmLabel="加入参考资料" onClose={layout.closePanel} onChoose={useReferenceMaterial} /></Suspense>;
  const deliveryTools = <><div className="sw-panel-actions"><button type="button" className="btn btn-secondary" disabled={disabled || !bridge} onClick={() => { void previewCurrentOffice(); }}>预览实际 Excel 文件</button><button type="button" className="btn btn-secondary" disabled={disabled || !bridge} onClick={() => { void persist(true); }}>导出到项目</button></div><p>宽表打印自动使用 A3 横向，普通表使用 A4。请核对公式、数据与排版，再确认交付。</p></>;
  const panel = layout.tool === 'ai' ? aiTools : layout.tool === 'format' ? formatTools : layout.tool === 'versions' ? versions : layout.tool === 'assets' ? assets : layout.tool === 'files' ? <ArtifactResults artifacts={realArtifacts} runner={props.workflowRunner} projectId={project.id} /> : deliveryTools;
  return <div ref={workbench} className="sw-editor-root ss-unified" data-spreadsheet-layout="unified" onChangeCapture={event => captureCellSelection(event, true)} onSelectCapture={captureCellSelection} onPointerDownCapture={event => { if (event.target instanceof HTMLTextAreaElement && (event.target === formulaEditor.current || event.target.closest('.ss-grid'))) setCellTextSelection(previous => previous ? { ...previous, recoveryPoint: false } : previous); }} onKeyDownCapture={event => { if (event.key === 'Escape' && event.target instanceof HTMLTextAreaElement && (event.target === formulaEditor.current || event.target.closest('.ss-grid')) && !event.nativeEvent.isComposing) resetScopedHistory(); }}>
    <StudioWorkbench projectName={project.name} kind="excel" layout={layout} onTool={openTool} saveStatus={!ready ? '正在读取工作簿' : dirty ? '草稿已保留 · 项目版本尚未保存' : record ? '已保存工作簿 v' + record.revision + (exported ? ' · 对应成品已导出' : ' · 此版尚未导出') : localSaved ? '浏览器草稿已保存 · 本地项目版本尚未建立' : '新工作簿 · 尚未保存项目版本'} selectionLabel={sheet.name + '!' + (refineRange || selectedAddress)} navigation={navigation} navigationLabel="工作表" panel={panel} notices={<>    <ProjectReferences props={props} />
    <RecoveryDraftNotice error={recovery.error} onRetry={recovery.retry} onDownload={recovery.exportDraft} />
    {recoveryVersion && <section className="editor-recovery-notice" role="region" aria-label="可恢复历史工作簿"><h3>工作簿 v{recoveryVersion.revision} · {recoveryVersion.document.title}</h3><p>每张表预览前 20 个已用单元格，恢复包含全部内容。</p><pre>{recoveryVersion.document.sheets.map(item => `${item.name}\n${Object.entries(item.cells).slice(0, 20).map(([address, cell]) => `${address}: ${cell.formula !== undefined ? `=${cell.formula}` : String(cell.value ?? '')}`).join('\n')}`).join('\n\n')}</pre><div><button className="btn btn-primary" disabled={!!busy || !bridge?.restore} onClick={() => { void restoreDamagedSource(); }}>保留原稿并恢复此版本</button><button className="btn btn-secondary" onClick={() => setRecoveryVersion(undefined)}>取消恢复</button></div></section>}
    {error && <div className="ss-message ss-message-error" role="alert"><span>{error} 当前编辑内容会保留。</span>{isWorkspaceConnectionError(error) ? <WorkspaceConnectionRecovery workspaceId={props.workspaceId} disabled={!!busy} onRecovered={() => setReload(value => value + 1)} /> : !ready && <button className="btn btn-secondary" disabled={!!busy} onClick={() => setReload(value => value + 1)}>重新读取</button>}{!ready && history.length > 0 && <button className="btn btn-secondary" onClick={() => openInspector('history')}>查看可恢复历史</button>}</div>}
    {source && !sourceArtifactIds.includes(source.id) && <div className="ss-message"><Sparkles size={17} /><span>{autoLoading ? '正在把生成结果载入工作表…' : '有新生成的表格内容。切换时会保留当前编辑，可一键恢复。'}</span><button className="btn btn-secondary" disabled={disabled || autoLoading} onClick={() => { void loadGenerated(); }}>载入生成表格</button></div>}
    {conflictDraft && <div className="ss-message"><History size={17} /><span>上次编辑已保留；恢复时也会保留当前内容，保存版本均不受影响。</span><button className="btn btn-secondary" disabled={disabled} onClick={restoreConflict}>载入恢复稿</button></div>}
    {missingInputs.length > 0 && <RememberedDetails rememberKey={layout.rememberKey('spreadsheet:missing-inputs')} className="ss-missing-inputs panel"><summary>待补充资料 · {missingInputs.length} 项</summary><p>模型已将缺少的资料单独列出，未补造数据。内容也保存在“资料说明”工作表中。</p><ul>{missingInputs.map((item, index) => <li key={index}>{item}</li>)}</ul></RememberedDetails>}
</>} selectionTools={scopeVisible && <div className="ss-scope-tools"><SelectionHistoryToolbar label={exactText ? `${sheet.name}!${selectedAddress} · 选中文字` : `${sheet.name}!${refineRange || selectedAddress} · 单元格区域`} selectionPreview={exactText ? selectionValue.slice(textSelection.start, textSelection.end) : undefined} selectedCount={exactText ? Array.from(selectionValue.slice(textSelection.start, textSelection.end)).length : 0} exactSelection={exactText} scopeDescription={exactText ? textSelection.recoveryPoint && textSelection.start === textSelection.end ? '已保留局部恢复位置，可重做刚才所选文字' : `已选择 ${Array.from(selectionValue.slice(textSelection.start, textSelection.end)).length} 字，只恢复选区内变化` : '按整个单元格恢复值、公式与格式，区域外内容保留'} canUndo={!scopeReason && scopeUndo.available} canRedo={!scopeReason && scopeRedo.available} reason={scopeReason || (!scopeUndo.available && !scopeRedo.available ? scopeUndo.reason : undefined)} disabled={disabled} onUndo={() => moveScopedHistory('undo')} onRedo={() => moveScopedHistory('redo')} onClearSelection={() => { setCellTextSelection(undefined); formulaEditor.current?.setSelectionRange(0, 0); setShowScopeTools(true); }} /><label className="ss-scope-range"><span>单元格区域</span><input className="field" aria-label="表格撤销重做区域" placeholder={selectedAddress} value={refineRange} onChange={event => { setRefineRange(event.target.value); setCellTextSelection(undefined); }} disabled={disabled} /><small>例如 A1 或 A1:D20，与 AI 精修区域同步</small></label></div>} cost={<CostTotal summary={cost} />} busy={disabled} exporting={busy === 'export'} canUndo={edits.canUndo} canRedo={edits.canRedo} canExport={!!bridge && hasResult} onUndo={() => moveHistory('undo')} onRedo={() => moveHistory('redo')} onSave={() => { void persist(); }} onExport={() => { void persist(true, true); }} deliveryPanel={<DeliveryPanel inline visible={layout.tool === 'delivery' && layout.rightOpen && !layout.focus} projectId={project.id} kind="excel" sourceRevision={record?.revision || 0} dirty={dirty || !ready} artifactIds={currentExport.map(file => file.id)} deliveryContext={project.lastLiveStateSignature} onDelivered={(receipt, selection) => props.onProjectDelivered ? props.onProjectDelivered(project.id, receipt, selection) : props.onUpdateProject(project.id, { status: 'complete', updatedAt: new Date().toISOString() })} onInvalidated={() => { if (project.confirmedDelivery) props.onUpdateProject(project.id, { confirmedDelivery: undefined, ...(project.status === 'complete' ? { status: 'review' as const } : {}) }); }} checks={spreadsheetDeliveryChecks(workbook, calculationState.pending || calculationState.error ? undefined : calculation, { saved: !!record && !dirty && ready, exported })} />}>
      <main className="ss-main panel">
      {!ready ? <div className="ss-loading">{error ? <Table2 size={26} /> : <LoaderCircle className="spin" size={26} />}<p>{error ? '请检查工作区路径；原工作簿未被空白文件覆盖。' : '正在读取项目工作簿…'}</p></div> : <>
        <div className={`ss-formula-bar ${fullCellOpen ? 'show-full-content' : ''}`}><output aria-label="选中单元格地址">{selectedAddress}</output><span aria-hidden="true">fx</span><textarea ref={formulaEditor} rows={1} aria-label="单元格值或公式" value={formulaInput} disabled={disabled} spellCheck={false} onChange={event => { pendingFormulaEdit.current = true; setFormulaInput(event.target.value); }} onBlur={() => { pendingFormulaEdit.current = false; if (skipFormulaBlur.current) { skipFormulaBlur.current = false; return; } if (formulaInput !== cellToInput(selectedCell)) inputCell(selectedAddress, formulaInput); }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); pendingFormulaEdit.current = false; skipFormulaBlur.current = true; inputCell(selectedAddress, formulaInput); event.currentTarget.blur(); } else if (event.key === 'Escape') { pendingFormulaEdit.current = false; skipFormulaBlur.current = true; setFormulaInput(cellToInput(selectedCell)); event.currentTarget.blur(); } }} placeholder="输入值，或以 = 开始输入公式" /></div>
        <div className="ss-cell-content-help"><span>{sheet.name}!{selectedAddress} · {formulaInput.length} 字符 · Enter 应用，Shift+Enter 换行，Esc 撤销</span><div><button aria-expanded={scopeVisible} onClick={() => { setShowScopeTools(value => !value); if (scopeVisible) setCellTextSelection(undefined); }}>局部撤销/重做</button><button aria-expanded={fullCellOpen} onClick={() => setFullCellOpen(value => !value)}>{fullCellOpen ? '收起完整内容' : '展开完整内容'}</button></div></div>


        <SpreadsheetGrid key={`${projectKey}|${sheet.id}`} sheet={sheet} calculation={calculation} selectedAddress={selectedAddress} viewPending={calculationState.pending || !!calculationState.error} range={refineRange || selectedAddress} onRangeChange={value => { setRefineRange(value); setCellTextSelection(undefined); }} onColumnWidthChange={(column, width) => changeSheet({ ...sheet, columnWidths: { ...sheet.columnWidths, [column]: width } }, `width:${sheet.id}:${column}`)} onFillDown={fillSelectedRange} onClearRange={clearSelectedRange} onSelect={selectCell} onCellInput={inputCell} onEditingChange={value => { pendingCellEdit.current = value; }} onPasteBlock={(address, text) => { try { changeSheet(pasteSpreadsheetCells(sheet, address, text)); } catch (cause) { setError(workflowPublicError(cause, '粘贴未完成。')); } }} disabled={disabled} />
        <div className={`ss-calculation-status ${calculation?.issues.length || calculationState.error ? 'has-issue' : ''}`} role="status">{calculationState.error || (calculationState.pending ? '正在后台计算…上次结果仅供参考' : calculation ? `${calculation.calculatedCount} / ${calculation.formulaCount} 个公式已计算${calculation.issues.length ? ` · ${calculation.issues.length} 项需处理` : ''}` : '计算状态尚未确认')}{selectedResult?.message && <span>{selectedAddress}：{selectedResult.message}</span>}{calculationState.error && <button type="button" className="btn btn-ghost" onClick={calculationState.restart}>重新启动计算</button>}</div>

      </>}
    </main>
    </StudioWorkbench>
    {promptPicker && <PromptPicker prompts={props.prompts} category="excel" onClose={() => setPromptPicker(false)} onUse={(template, content) => { props.onUsePrompt(template, content); setPromptPicker(false); }} />}{promptDraft && <PromptEditor categories={props.configuration.categories} initial={promptDraft} onClose={() => setPromptDraft(null)} onSave={(draft, id) => { props.onSavePrompt(draft, id); setPromptDraft(null); }} />}
    {officePreview && officePreview.projectId === project.id && <Suspense fallback={<p role="status">正在打开实际文件预览…</p>}><OfficeFilePreview artifact={officePreview} onClose={() => setOfficePreview(undefined)} onOpenSource={() => { void props.workflowRunner.openArtifact(officePreview.id); }} /></Suspense>}
  </div>;
}
