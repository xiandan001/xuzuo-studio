import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, FileJson, ImagePlus, LoaderCircle, Palette, Save, Undo2, Redo2, Upload } from 'lucide-react';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { BeadExportFormat, BeadPalette, BeadSavedVersion, BeadSettings, BeadSourcePreview } from '../bead-types';
import { BEAD_PALETTES, DEFAULT_BEAD_PALETTE_ID } from '../data/bead-palettes';
import { beadPaletteIssue, beadSettingsIssue, beadTotals, beadUsage, DEFAULT_BEAD_PROCUREMENT, DEFAULT_BEAD_SETTINGS, editBeadCells, replaceBeadColor } from '../lib/bead-pattern';
import { useBeadDocument } from '../hooks/useBeadDocument';
import { BeadCanvas } from '../components/BeadCanvas';
import type { BeadCanvasHandle, BeadCellEdit } from '../components/BeadCanvas';
import { BeadColorTools } from '../components/BeadColorTools';
import { BeadProcurement } from '../components/BeadProcurement';
import { BeadAIPreparation } from '../components/BeadAIPreparation';
import { Select } from '../components/Select';
import { RememberedDetails } from '../components/RememberedDetails';
import { ArtifactResults } from '../components/ArtifactResults';
import { StudioDrawer } from '../components/StudioDrawer';
import { DeliveryPanel } from '../components/DeliveryPanel';
import { CostTotal } from '../components/CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { RASTER_IMAGE_TYPES } from '../lib/image-output-options';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { useRememberedString } from '../hooks/useRememberedString';
import { registerEditorSession } from '../lib/editor-session-guard';
import './bead-studio.css';

const BeadMarketPanel = lazy(() => import('../components/bead-market/BeadMarketPanel').then(module => ({ default: module.BeadMarketPanel })));
const StudioAssetPicker = lazy(() => import('../components/StudioAssetPicker').then(module => ({ default: module.StudioAssetPicker })));
interface Props { props: PageProps; project: Project; onBack: () => void; initialReferenceId?: string; }
const number = (text: string) => text.trim() ? Number(text) : Number.NaN;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作暂未完成，当前图纸与费用保留。';
const formatNames: Record<BeadExportFormat, string> = { bundle: '整套 ZIP', png: '预览 PNG', pdf: '打印 PDF', csv: '用量 CSV', xlsx: '采购 Excel', json: '工程 JSON' };

export function BeadStudio(input: Props) { return <BeadProject key={input.project.id} {...input} />; }

function BeadProject({ props, project, onBack, initialReferenceId }: Props) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.beads, canvas = useRef<BeadCanvasHandle>(null);
  const store = useBeadDocument(project.id, bridge, { beforeSave: () => canvas.current?.commitStroke(), pendingStroke: () => Boolean(canvas.current?.hasPendingStroke()) });
  const [settings, setSettings] = useState<BeadSettings>({ ...DEFAULT_BEAD_SETTINGS }), [palette, setPalette] = useState<BeadPalette>(() => BEAD_PALETTES.find(item => item.id === DEFAULT_BEAD_PALETTE_ID) || BEAD_PALETTES[0]);
  const [customPalettes, setCustomPalettes] = useState<BeadPalette[]>([]), [source, setSource] = useState<BeadSourcePreview>(), [sourceIssue, setSourceIssue] = useState(''), [operationIssue, setOperationIssue] = useState(''), [procurementIssue, setProcurementIssue] = useState('');
  const [busy, setBusy] = useState(''), [sourceLoading, setSourceLoading] = useState(false), [brush, setBrush] = useState(1), [materials, setMaterials] = useState(false), [files, setFiles] = useState<ArtifactMetadata[]>([]), [exports, setExports] = useState<ArtifactMetadata[]>([]), [format, setFormat] = useState<BeadExportFormat>('bundle'), [compare, setCompare] = useState(false);
  const [exportOpen, setExportOpen] = useState(false), [delivery, setDelivery] = useState<{ artifactIds: string[]; revision: number }>();
  const [historyOpen, setHistoryOpen] = useState(false), [versions, setVersions] = useState<BeadSavedVersion[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyIssue, setHistoryIssue] = useState('');
  const [keepAspect, setKeepAspect] = useRememberedBoolean(`beads:${project.id}:aspect`, true), [view, setView] = useRememberedString(`beads:${project.id}:view`, 'canvas');
  const alive = useRef(true), operation = useRef(0), sourceRead = useRef(0), sourceRef = useRef(source); sourceRef.current = source;
  const initialSourceRead = useRef<string | undefined>(undefined);
  const appliedAsset = useRef<string | undefined>(undefined), currentAsset = useRef(props.assetToApply); currentAsset.current = props.assetToApply;
  const tasks = useRef(new Set<Promise<void>>());
  const track = (task: Promise<void>) => { tasks.current.add(task); void task.then(() => tasks.current.delete(task), cause => { tasks.current.delete(task); if (alive.current) setOperationIssue(errorText(cause)); }); };
  useEffect(() => registerEditorSession({ id: `bead-tasks:${project.id}`, projectId: project.id, label: '拼豆本地任务', getState: () => ({ dirty: false, pending: tasks.current.size > 0 }), save: async () => { await Promise.allSettled([...tasks.current]); return store.flush(); }, exportRecovery: async () => false }), [project.id, store.flush]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current++; sourceRead.current++; }; }, []);
  const document = store.document;
  function invalidateDelivery() { if (project.confirmedDelivery) props.onUpdateProject(project.id, { confirmedDelivery: undefined, ...(project.status === 'complete' ? { status: 'review' as const } : {}) }); }
  useEffect(() => { if (store.dirty) invalidateDelivery(); }, [store.dirty, project.confirmedDelivery]);
  const settingsSignature = document ? JSON.stringify([document.id, document.referenceId, document.sourceSha256, document.settings.columns, document.settings.rows, document.settings.fit, document.settings.maxColors, document.settings.alphaThreshold]) : '';
  const paletteSignature = document ? document.pattern.palette.id + ':' + document.pattern.palette.version : '';
  useEffect(() => { if (document) setSettings({ ...document.settings }); }, [settingsSignature]);
  useEffect(() => { if (document) setSettings(previous => previous.boardColumns === document.settings.boardColumns && previous.boardRows === document.settings.boardRows ? previous : { ...previous, boardColumns: document.settings.boardColumns, boardRows: document.settings.boardRows }); }, [document?.settings.boardColumns, document?.settings.boardRows]);
  useEffect(() => { if (document) { setPalette(document.pattern.palette); setBrush(1); } }, [paletteSignature]);
  async function readSource(referenceId: string, autoAspect = true) {
    if (!bridge) return;
    const request = ++sourceRead.current; setSourceIssue(''); setSourceLoading(true);
    try {
      const value = await bridge.source({ projectId: project.id, referenceId });
      if (!alive.current || request !== sourceRead.current) return;
      setSource(value); sourceRef.current = value;
      if (autoAspect && keepAspect) setSettings(previous => ({ ...previous, rows: Math.max(8, Math.min(256, Math.round(previous.columns * value.originalHeight / value.originalWidth))) }));
    } catch (cause) { if (alive.current && request === sourceRead.current) { setSource(undefined); sourceRef.current = undefined; setSourceIssue(document ? '原底图暂不可用，现有图纸仍可编辑和导出；重新制图需选择新底图。' : errorText(cause)); } }
    finally { if (alive.current && request === sourceRead.current) setSourceLoading(false); }
  }
  useEffect(() => {
    if (document && !document.referenceId) { sourceRead.current++; setSource(undefined); sourceRef.current = undefined; setSourceLoading(false); setSourceIssue('工程未连接底图，现有图纸仍可编辑和导出；重新制图需选择底图。'); return; }
    if (!document?.referenceId) return;
    if (sourceRef.current?.referenceId === document.referenceId && sourceRef.current.sourceSha256 === document.sourceSha256) return;
    void readSource(document.referenceId, false);
  }, [document?.id, document?.referenceId, document?.sourceSha256]);
  useEffect(() => {
    if (!initialReferenceId || !bridge || store.loading || store.error || document || sourceRef.current || initialSourceRead.current === initialReferenceId) return;
    initialSourceRead.current = initialReferenceId;
    void readSource(initialReferenceId, false);
  }, [initialReferenceId, bridge, store.loading, store.error, document]);
  useEffect(() => {
    let current = true;
    if (props.workflowRunner.listProjectArtifacts) void props.workflowRunner.listProjectArtifacts(project.id).then(value => { if (current) setFiles(value); }, () => {});
    return () => { current = false; };
  }, [project.id, props.workflowRunner.listProjectArtifacts]);
  const palettes = [...new Map([...BEAD_PALETTES, ...customPalettes, ...(document ? [document.pattern.palette] : [])].map(item => [item.id + ':' + item.version, item])).values()];
  const sourceFiles = [...new Map([...files, ...(project.referenceFiles || [])].filter(item => item.kind === 'image' && RASTER_IMAGE_TYPES.has(item.mimeType) && !('trashedAt' in item && item.trashedAt) && !('unavailable' in item && item.unavailable)).map(item => [item.id, item])).values()];
  const totals = useMemo(() => document ? beadTotals(document.pattern) : undefined, [document?.pattern]);
  const usage = useMemo(() => document ? beadUsage(document.pattern, document.procurement) : [], [document?.pattern, document?.procurement]);
  const settingsIssue = beadSettingsIssue(settings) || beadPaletteIssue(palette), blocked = Boolean(busy || sourceLoading || store.loading || !bridge);
  useEffect(() => {
    const application = props.assetToApply;
    if (!application || application.projectId !== project.id || application.workspaceId !== props.workspaceId || application.token === appliedAsset.current || blocked) return;
    appliedAsset.current = application.token;
    if (!RASTER_IMAGE_TYPES.has(application.file.mimeType) || application.file.projectId && application.file.projectId !== project.id) { setSourceIssue('请选择当前项目的 PNG、JPEG 或 WebP 静态底图。'); props.onAssetApplied?.(application.token); return; }
    setFiles(previous => [application.file, ...previous.filter(file => file.id !== application.file.id)]);
    void readSource(application.file.id).then(() => { if (alive.current && currentAsset.current?.token === application.token) props.onAssetApplied?.(application.token); });
  }, [props.assetToApply?.token, props.workspaceId, project.id, blocked]);
  const fees = summarizeCosts(props.ledger.filter(item => item.projectId === project.id && item.billingMode === 'live'));
  function updateSetting(field: keyof BeadSettings, value: number | BeadSettings['fit']) {
    setSettings(previous => {
      const next = { ...previous, [field]: value };
      if (keepAspect && source && Number.isInteger(value) && (field === 'columns' || field === 'rows')) {
        if (field === 'columns') next.rows = Math.max(8, Math.min(256, Math.round(Number(value) * source.originalHeight / source.originalWidth)));
        else next.columns = Math.max(8, Math.min(256, Math.round(Number(value) * source.originalWidth / source.originalHeight)));
      }
      return next;
    });
    const current = store.current.current;
    if (current && (field === 'boardColumns' || field === 'boardRows')) { const next = { ...current.settings, [field]: Number(value) }; if (!beadSettingsIssue(next)) store.change({ ...current, settings: next }); }
  }
  async function importSource() {
    if (blocked) return; setBusy('source'); setOperationIssue(''); const request = ++operation.current;
    try {
      const selected = await props.workflowRunner.importFiles(project.id); if (!alive.current || request !== operation.current) return;
      const file = selected.find(item => item.kind === 'image' && RASTER_IMAGE_TYPES.has(item.mimeType));
      if (!file) { if (selected.length) setSourceIssue('请选择 PNG、JPEG 或 WebP 静态底图；其他文件仍保留在项目中。'); return; }
      setFiles(previous => [...selected, ...previous.filter(item => !selected.some(file => file.id === item.id))]); await readSource(file.id);
      if (selected.length > 1 && alive.current) props.notify('本次使用第一张静态底图，其余文件保留在项目中。', 'info');
    } catch (cause) { if (alive.current) setOperationIssue(errorText(cause)); }
    finally { if (alive.current && request === operation.current) setBusy(''); }
  }
  async function makePattern() {
    if (blocked || !bridge || !source || settingsIssue) return;
    setBusy('generate'); setOperationIssue(''); const request = ++operation.current;
    try {
      if (!await store.flush() || !alive.current || request !== operation.current) return;
      const previous = store.current.current, changedPalette = previous && (previous.pattern.palette.id !== palette.id || previous.pattern.palette.version !== palette.version);
      const procurement = previous ? changedPalette ? { ...previous.procurement, stock: {}, packSizes: {} } : previous.procurement : { ...DEFAULT_BEAD_PROCUREMENT, stock: {}, packSizes: {} };
      const value = await bridge.generate({ projectId: project.id, referenceId: source.referenceId, title: project.name.slice(0, 120), settings, palette, procurement, expectedRevision: store.revision.current });
      if (alive.current && request === operation.current) { store.accept(value); invalidateDelivery(); setExports([]); setDelivery(undefined); setProcurementIssue(''); props.notify('已在本地生成图纸，未调用模型。'); }
    } catch (cause) { if (alive.current && request === operation.current) setOperationIssue(errorText(cause)); }
    finally { if (alive.current && request === operation.current) setBusy(''); }
  }
  async function cancel() { const request = ++operation.current; setBusy('cancel'); try { await bridge?.cancel({ projectId: project.id }); } catch (cause) { if (alive.current) setOperationIssue(errorText(cause)); } finally { if (alive.current && request === operation.current) setBusy(''); } }
  function editCells(edits: BeadCellEdit[]) {
    const value = store.current.current; if (!value) return;
    const pattern = editBeadCells(value.pattern, edits); if (pattern !== value.pattern) store.change({ ...value, pattern });
  }
  function replaceColor(from: number, to: number) {
    const value = store.current.current; if (!value || blocked) return;
    const pattern = replaceBeadColor(value.pattern, from, to); if (pattern !== value.pattern) store.change({ ...value, pattern });
  }
  async function importPalette() {
    if (!bridge || blocked) return; setBusy('palette'); setOperationIssue(''); const request = ++operation.current;
    try { const value = await bridge.importPalette({ projectId: project.id }); if (value && alive.current && request === operation.current) { setCustomPalettes(previous => [...previous.filter(item => item.id !== value.id), value]); setPalette(value); } }
    catch (cause) { if (alive.current) setOperationIssue(errorText(cause)); }
    finally { if (alive.current && request === operation.current) setBusy(''); }
  }
  async function importDocument() {
    if (!bridge || blocked) return; setBusy('import'); setOperationIssue(''); const request = ++operation.current;
    try { if (store.current.current && !await store.flush() && !store.hasCurrentRecovery()) return; const value = await bridge.importDocument({ projectId: project.id }); if (value && alive.current && request === operation.current) { store.accept(value); invalidateDelivery(); setSettings({ ...value.settings }); setPalette(value.pattern.palette); setExports([]); setDelivery(undefined); setProcurementIssue(''); setView('canvas'); } }
    catch (cause) { if (alive.current && request === operation.current) setOperationIssue(errorText(cause)); }
    finally { if (alive.current && request === operation.current) setBusy(''); }
  }
  async function exportFiles() {
    if (!bridge || blocked || !document || procurementIssue || pendingRemake || boardIssue || (!totals?.beads && format !== 'json')) return;
    setBusy('export'); setOperationIssue(''); const request = ++operation.current;
    try {
      if (!await store.flush() || !alive.current || request !== operation.current) return;
      const expectedRevision = store.revision.current; if (expectedRevision === undefined) return;
      const result = await bridge.export({ projectId: project.id, format, expectedRevision });
      if (alive.current && request === operation.current) {
        const artifacts = result.artifacts?.length ? result.artifacts : [result.artifact]; setExports(artifacts); setExportOpen(true);
        if (result.exportRunId && result.sourceRevision !== undefined && result.artifacts?.length) setDelivery({ artifactIds: result.artifacts.filter(item => item.mimeType !== 'application/zip').map(item => item.id), revision: result.sourceRevision }); else setDelivery(undefined);
        props.notify(`${formatNames[format]}已保存到本项目，可打开或另存。`);
      }
    } catch (cause) { if (alive.current && request === operation.current) setOperationIssue(errorText(cause)); }
    finally { if (alive.current && request === operation.current) setBusy(''); }
  }
  async function showHistory() {
    if (!bridge || typeof bridge.history !== 'function' || blocked) return;
    setHistoryOpen(true); setHistoryLoading(true); setHistoryIssue('');
    try { const result = await bridge.history({ projectId: project.id }); if (alive.current) setVersions(result); }
    catch (cause) { if (alive.current) setHistoryIssue(errorText(cause)); }
    finally { if (alive.current) setHistoryLoading(false); }
  }
  async function restoreVersion(version: number) {
    if (!bridge || blocked) return; setBusy('restore'); setHistoryIssue(''); const request = ++operation.current;
    try {
      let saved = !store.error;
      if (store.current.current) { saved = await store.flush(); if (!saved && !store.hasCurrentRecovery() && !await store.recover()) { setHistoryIssue('当前修改还未备份，请先导出恢复 JSON，再恢复所选记录。'); return; } }
      const result = await bridge.restore({ projectId: project.id, revision: version, expectedRevision: saved ? store.revision.current : undefined });
      if (alive.current && request === operation.current) { store.accept(result); invalidateDelivery(); setHistoryOpen(false); setExports([]); setDelivery(undefined); setProcurementIssue(''); setSettings({ ...result.settings }); setPalette(result.pattern.palette); setView('canvas'); props.notify('已恢复图案内容并保存为新版本；原文件和历史费用保留。'); }
    } catch (cause) { if (alive.current && request === operation.current) setHistoryIssue(errorText(cause)); }
    finally { if (alive.current && request === operation.current) setBusy(''); }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (blocked || event.target instanceof Element && event.target.closest('input,textarea,select,[role=combobox]')) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void store.flush(); }
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); canvas.current?.commitStroke(); event.shiftKey ? store.redo() : store.undo(); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); canvas.current?.commitStroke(); store.redo(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [blocked, store]);
  const sourceDifferent = document && source && (document.referenceId !== source.referenceId || document.sourceSha256 !== source.sourceSha256), paletteDifferent = document && (document.pattern.palette.id !== palette.id || document.pattern.palette.version !== palette.version);
  const pendingRemake = Boolean(document && (sourceDifferent || paletteDifferent || ['columns', 'rows', 'fit', 'maxColors', 'alphaThreshold'].some(key => settings[key as keyof BeadSettings] !== document.settings[key as keyof BeadSettings])));
  const boardIssue = document ? beadSettingsIssue({ ...document.settings, boardColumns: settings.boardColumns, boardRows: settings.boardRows }) : undefined;
  function keepCurrentPattern() { if (!document) return; setSettings({ ...document.settings }); setPalette(document.pattern.palette); if (source?.referenceId !== document.referenceId) { setSource(undefined); sourceRef.current = undefined; if (document.referenceId) void readSource(document.referenceId, false); } }
  const checkConservation = totals && totals.beads + totals.emptyCells === totals.totalCells;
  async function back() { if (!store.dirty && !canvas.current?.hasPendingStroke() || await store.flush()) onBack(); else if (store.hasCurrentRecovery()) { props.notify('当前修改已有恢复 JSON，返回后可导入该副本继续。', 'info'); onBack(); } }
  return <section className="bead-studio" aria-label="拼豆制图工作台">
    <header className="bead-studio-heading"><div><button type="button" className="btn btn-ghost" disabled={!!busy || store.loading || sourceLoading} onClick={() => { void back(); }}><ArrowLeft size={16} />返回图片</button><h1>拼豆制图</h1><span role="status">{store.loading ? '正在读取' : store.saving ? '自动保存中…' : store.dirty ? '有未保存修改' : document ? `已保存 · v${document.revision}` : '先选底图，本地制图'}</span></div><div><button type="button" className="btn btn-ghost" disabled={blocked} onClick={() => track(showHistory())}>保存记录</button>{exports.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setExportOpen(true)}>查看导出</button>}<button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => { track(importDocument()); }}><FileJson size={16} />导入工程</button><Select aria-label="拼豆导出格式" value={format} onValueChange={value => setFormat(value as BeadExportFormat)} options={Object.entries(formatNames).map(([value, label]) => ({ value, label }))} /><button type="button" className="btn btn-primary" disabled={blocked || !document || !!procurementIssue || pendingRemake || !!boardIssue || (!totals?.beads && format !== 'json')} onClick={() => { track(exportFiles()); }}>{busy === 'export' ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{format === 'bundle' ? '导出整套' : `导出${formatNames[format]}`}</button></div></header>
    {(operationIssue || store.error) && <div className="bead-error-banner" role="alert"><span>{operationIssue || store.error}</span>{store.error && <><button type="button" className="ig-link" disabled={blocked} onClick={() => track(showHistory())}>从保存记录恢复</button><button type="button" className="ig-link" onClick={() => { void (store.dirty ? store.flush() : store.reload()); }}>{store.dirty ? '重试保存' : '重新读取'}</button>{document && <button type="button" className="ig-link" onClick={() => { void store.recover().then(saved => { if (saved && alive.current) props.notify('已导出当前内存恢复 JSON；项目旧版本未被改写。'); }); }}>导出恢复 JSON</button>}{store.dirty && store.recoveryCurrent && <button type="button" className="ig-link" onClick={() => { void store.reload(); }}>已备份，重新读取</button>}</>}</div>}
    <nav className="bead-view-tabs" role="tablist" aria-label="拼豆工作视图"><button type="button" role="tab" aria-selected={view !== 'usage'} onClick={() => { setProcurementIssue(''); setView('canvas'); }}>制图与编辑</button><button type="button" role="tab" aria-selected={view === 'usage'} disabled={!document} onClick={() => setView('usage')}>用量与采购 <small>{totals?.colorsUsed || 0} 色</small></button><span>本地制图／编辑／尺寸适配不调用模型</span></nav>
    {pendingRemake && document && <div className="bead-pending-banner" role="status"><span>下次制图设置尚未应用；当前画布仍为 {document.pattern.columns} × {document.pattern.rows} 格。</span><button type="button" className="ig-link" onClick={keepCurrentPattern}>继续使用当前图纸</button></div>}
    {view === 'usage' && document ? <div className="bead-usage-view"><Suspense fallback={<p role="status">正在打开材料比价…</p>}><BeadMarketPanel props={props} projectId={project.id} document={document} disabled={blocked} beforeQuery={store.flush} /></Suspense><BeadProcurement projectId={project.id} pattern={document.pattern} value={document.procurement} boardColumns={document.settings.boardColumns} boardRows={document.settings.boardRows} disabled={blocked} onIssue={setProcurementIssue} onChange={value => { const current = store.current.current; if (current) store.change({ ...current, procurement: value }); }} /></div> : <div className="bead-studio-layout"><aside className="bead-sidebar">
      <section className="bead-source-card" aria-label="拼豆底图"><header><strong>底图</strong><div><button type="button" className="ig-link" disabled={blocked} onClick={() => { track(importSource()); }}><Upload size={14} />导入</button><button type="button" className="ig-link" disabled={blocked} onClick={() => setMaterials(true)}><ImagePlus size={14} />素材库</button></div></header>{source ? <><img src={source.dataUrl} alt={source.name} /><strong title={source.name}>{source.name}</strong><small>{source.originalWidth} × {source.originalHeight} 像素{sourceDifferent ? ' · 下次制图底图' : ''}</small></> : <p>选择一张 PNG、JPEG 或 WebP 底图，也能从本项目图片中选择。</p>}{sourceFiles.length > 0 && <Select aria-label="选择本项目拼豆底图" value={source?.referenceId || ''} onValueChange={id => { void readSource(id); }} options={sourceFiles.map(file => ({ value: file.id, label: file.name }))} placeholder="选择本项目静态图片" disabled={blocked} />}{sourceLoading && <p className="bead-small-note" role="status">正在读取底图…</p>}{sourceIssue && <p className="bead-inline-error" role="status">{sourceIssue}</p>}</section>
      <section className="bead-generation-controls" aria-label="拼豆制图设置"><div className="bead-grid-fields"><label>列数<input className="field" aria-label="拼豆列数" inputMode="numeric" value={Number.isNaN(settings.columns) ? '' : settings.columns} disabled={blocked} onChange={event => updateSetting('columns', number(event.target.value))} /></label><span>×</span><label>行数<input className="field" aria-label="拼豆行数" inputMode="numeric" value={Number.isNaN(settings.rows) ? '' : settings.rows} disabled={blocked} onChange={event => updateSetting('rows', number(event.target.value))} /></label></div><label className="bead-inline-toggle"><input type="checkbox" checked={keepAspect} onChange={event => setKeepAspect(event.target.checked)} disabled={blocked} />跟随底图比例</label><label>制图色卡<Select aria-label="拼豆制图色卡" value={palette.id + ':' + palette.version} onValueChange={key => { const next = palettes.find(item => item.id + ':' + item.version === key); if (next) setPalette(next); }} options={palettes.map(item => ({ value: item.id + ':' + item.version, label: item.name, description: item.version }))} disabled={blocked} /></label><button type="button" className="ig-link" disabled={blocked} onClick={() => { track(importPalette()); }}><Palette size={14} />导入自定义色卡</button><label>最多用色 <small>0 为整套色卡</small><input className="field" aria-label="拼豆最多用色" inputMode="numeric" value={Number.isNaN(settings.maxColors) ? '' : settings.maxColors} disabled={blocked} onChange={event => updateSetting('maxColors', number(event.target.value))} /></label><div className="bead-fit-choice" role="group" aria-label="拼豆底图适配"><button type="button" aria-pressed={settings.fit === 'contain'} disabled={blocked} onClick={() => updateSetting('fit', 'contain')}>完整保留</button><button type="button" aria-pressed={settings.fit === 'cover'} disabled={blocked} onClick={() => updateSetting('fit', 'cover')}>铺满裁边</button></div>{settingsIssue && <p className="bead-inline-error" role="status">{settingsIssue}</p>}{paletteDifferent && <p className="bead-small-note">重新制图后应用新色卡，并重置各色库存／包装；旧图仍可撤销恢复。</p>}<button type="button" className="btn btn-primary" disabled={blocked || !source || !!settingsIssue} onClick={() => { track(makePattern()); }}>{busy === 'generate' ? <LoaderCircle size={16} className="spin" /> : <Palette size={16} />}{document ? '本地重新制图 · 免费' : '本地生成图纸 · 免费'}</button>{busy === 'generate' && <button type="button" className="ig-link" onClick={() => { track(cancel()); }}>取消制图</button>}</section>
      <RememberedDetails rememberKey={`beads:${project.id}:advanced`} className="bead-advanced"><summary>高级与底板设置</summary><div><label>底板列数<input className="field" aria-label="拼豆底板列数" inputMode="numeric" value={Number.isNaN(settings.boardColumns) ? '' : settings.boardColumns} disabled={blocked} onChange={event => updateSetting('boardColumns', number(event.target.value))} /></label><label>底板行数<input className="field" aria-label="拼豆底板行数" inputMode="numeric" value={Number.isNaN(settings.boardRows) ? '' : settings.boardRows} disabled={blocked} onChange={event => updateSetting('boardRows', number(event.target.value))} /></label><label>透明阈值<input className="field" aria-label="拼豆透明阈值" inputMode="numeric" value={Number.isNaN(settings.alphaThreshold) ? '' : settings.alphaThreshold} disabled={blocked} onChange={event => updateSetting('alphaThreshold', number(event.target.value))} /></label><p>白色默认是真实珠子；真正透明的源像素才可为空格。不按格数推测成品厘米。</p></div></RememberedDetails>
      <BeadAIPreparation props={props} project={project} source={source} settings={settings} context={`${document?.id || 'new'}:${store.epoch.current}:${source?.referenceId || ''}:${settings.columns}x${settings.rows}`} disabled={blocked || !!settingsIssue} onUse={file => { void readSource(file.id); }} />
      <RememberedDetails rememberKey={`beads:${project.id}:palette-license`} className="bead-palette-license"><summary>色卡来源与许可</summary><strong>{(document?.pattern.palette || palette).name}</strong><p>{(document?.pattern.palette || palette).sourceNote}</p><a href={(document?.pattern.palette || palette).sourceUrl} target="_blank" rel="noreferrer">查看色卡来源</a><pre>{(document?.pattern.palette || palette).license}</pre></RememberedDetails>
    </aside><main className="bead-editor-main">{document ? <><div className="bead-editor-heading"><div><strong>{document.title}</strong><span>{document.pattern.columns} × {document.pattern.rows} 格 · {document.pattern.palette.name}</span></div><div><button type="button" className="btn-icon" aria-label="撤销拼豆编辑" title="撤销，不减少已发生API费用" disabled={blocked || !store.canUndo} onClick={() => { canvas.current?.commitStroke(); store.undo(); }}><Undo2 size={17} /></button><button type="button" className="btn-icon" aria-label="重做拼豆编辑" disabled={blocked || !store.canRedo} onClick={store.redo}><Redo2 size={17} /></button><button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => { void store.flush(); }}><Save size={15} />保存</button><button type="button" className="btn btn-ghost" disabled={!source} aria-pressed={compare} onClick={() => setCompare(value => !value)}>底图对照</button></div></div>{compare && source && <div className="bead-comparison"><img src={source.dataUrl} alt={`对照底图 ${source.name}`} /><span>底图预览 · 网格不会被覆盖</span></div>}<BeadCanvas ref={canvas} pattern={document.pattern} brush={brush} boardColumns={document.settings.boardColumns} boardRows={document.settings.boardRows} disabled={blocked} onCommit={editCells} /><div className="bead-editor-bottom"><BeadColorTools key={paletteSignature} pattern={document.pattern} usage={usage} brush={brush} onBrush={setBrush} onReplace={replaceColor} disabled={blocked} /><section className="bead-delivery-checks" aria-label="拼豆售卖检查"><h3>导出检查</h3><p className={checkConservation ? 'is-valid' : 'bead-inline-error'}>{checkConservation ? '✓' : '待处理'} 总格数守恒：{totals?.beads.toLocaleString()} 颗 + {totals?.emptyCells.toLocaleString()} 空格 = {totals?.totalCells.toLocaleString()}</p><p>{totals?.beads ? `✓ ${totals.colorsUsed} 种实物珠色` : '当前全空格，不能导出商品图纸；可保存 JSON 继续编辑。'}</p><p>色卡版本：{document.pattern.palette.version}</p><p>{store.dirty || store.saving ? '保存完成后才会导出当前版本' : '✓ 当前图纸已保存'}</p><small>导出后仍需人工查看图案细节和打印分块，不自动标为已交付。</small></section></div></> : <div className="bead-editor-empty"><Palette size={40} /><h2>{store.loading ? '正在读取拼豆工程…' : '选一张底图，开始本地制图'}</h2><p>不需要先调用 AI。已有 JSON 工程也可直接导入继续编辑。</p><button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => { track(importSource()); }}><Upload size={16} />导入底图</button></div>}</main></div>}
    <footer className="bead-studio-footer"><span>本地编辑、撤销与导出不回退已发生费用</span><span>本项目 API 调用 <CostTotal summary={fees} /></span></footer>
    {exportOpen && <StudioDrawer title="拼豆导出与交付" description={document ? `${document.title} · 当前保存 v${document.revision}` : project.name} onClose={() => setExportOpen(false)}><div className="bead-export-drawer-content"><ArtifactResults fileScope="attempt" artifacts={exports} runner={props.workflowRunner} projectId={project.id} />{delivery && <DeliveryPanel inline projectId={project.id} kind="image" artifactIds={delivery.artifactIds} sourceRevision={delivery.revision} deliveryContext={project.lastLiveStateSignature} dirty={store.dirty || store.saving || document?.revision !== delivery.revision} checks={[]} onInvalidated={invalidateDelivery} onDelivered={(receipt, selection) => props.onProjectDelivered?.(project.id, receipt, selection)} />}</div></StudioDrawer>}
    {historyOpen && <StudioDrawer title="拼豆保存记录" description="仅显示最近的保存信息，恢复后版本继续前进；当前手绘若不能保存，会先导出恢复 JSON。" onClose={() => setHistoryOpen(false)}><div className="bead-export-drawer-content">{historyLoading ? <p role="status">正在读取保存记录…</p> : versions.length ? versions.map(item => <article className="bead-history-item" key={item.revision}><div><strong>v{item.revision} · {item.columns} × {item.rows} 格 · {item.recoveryState === 'prepared' ? '未提交恢复点' : item.recoveryState === 'unverified' ? '待核实恢复点' : '已保存'}</strong><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small></div><button type="button" className="btn btn-secondary" disabled={blocked || item.revision === store.revision.current && !store.error} onClick={() => track(restoreVersion(item.revision))}>恢复此版本</button></article>) : <p className="bead-empty-note">没有可用保存记录。可导入已备份的工程 JSON。</p>}{historyIssue && <p className="bead-inline-error" role="alert">{historyIssue}</p>}{store.current.current && <button type="button" className="btn btn-secondary" onClick={() => { void store.recover(); }}>导出当前内存恢复 JSON</button>}</div></StudioDrawer>}
    {materials && <Suspense fallback={<p role="status">正在打开素材库…</p>}><StudioAssetPicker props={{ ...props, activeProject: project }} imagesOnly title="选择拼豆底图" description="选择一张静态底图，当前图纸仍保留；点击本地制图才会重新匹配。" confirmLabel="用作拼豆底图" onClose={() => setMaterials(false)} onChoose={async file => { if (!RASTER_IMAGE_TYPES.has(file.mimeType)) throw Error('拼豆底图需要 PNG、JPEG 或 WebP。'); await readSource(file.id); setMaterials(false); }} /></Suspense>}
  </section>;
}
