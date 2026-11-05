import { hasManagedDialog } from '../lib/dialog-stack';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Download, ExternalLink, Eye, FileText, Image, LoaderCircle, Paperclip, Video, Trash2, RotateCcw, ShieldCheck, AlertCircle, X } from 'lucide-react';
import type { WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import type { EditorKind } from '../editor-types';
import { DocumentArtifactPreview } from './DocumentArtifactPreview';
import { ModalPortal } from './ModalPortal';
import { mergeProjectInventory, projectInventoryFiles } from '../lib/project-inventory';
import { useProjectInventory } from '../hooks/useProjectInventory';
import { isProductionRun } from '../lib/workflow-purpose';
import './artifact-results.css';

export interface ArtifactResultsProps { artifacts: ArtifactMetadata[]; runner: WorkflowRunner; onUseReference?: (artifact: ArtifactMetadata) => void | Promise<void>; projectId?: string; visibleProjectIds?: string[]; documentKind?: EditorKind | 'excel'; onEditDocument?: () => void; }
export function latestProjectArtifacts(runs: WorkflowRun[], projectId: string): ArtifactMetadata[] {
  const recent = runs.filter(run => run.mode === 'live' && isProductionRun(run) && run.projectId === projectId && !run.workflowId.startsWith('local-refine-')).sort((first, second) => (Date.parse(second.updatedAt) || 0) - (Date.parse(first.updatedAt) || 0));
  for (const run of recent) {
    const byStep = new Map<string, ArtifactMetadata[]>();
    for (const attempt of run.attempts) if (attempt.artifacts?.length) byStep.set(attempt.stepId, attempt.artifacts);
    const artifacts = [...byStep.values()].flat();
    if (artifacts.length) return artifacts;
  }
  return [];
}
export function latestProjectContentArtifact(runs: WorkflowRun[], projectId: string): ArtifactMetadata | undefined {
  const recent = runs.filter(run => run.mode === 'live' && isProductionRun(run) && run.projectId === projectId && !run.workflowId.startsWith('local-refine-')).sort((first, second) => (Date.parse(second.updatedAt) || 0) - (Date.parse(first.updatedAt) || 0));
  for (const run of recent) {
    const exportStep = run.snapshot.steps.filter(step => step.enabled && step.kind === 'export').at(-1);
    const end = exportStep ? run.snapshot.steps.findIndex(step => step.id === exportStep.id) : run.snapshot.steps.length;
    const sources = run.snapshot.steps.slice(0, end).filter(step => step.enabled && !['planner', 'reviewer'].includes(step.role || '') && (step.kind === 'text' || step.kind === 'transcription')).reverse();
    if (exportStep?.contentSourceStepId) sources.sort((first, second) => Number(second.id === exportStep.contentSourceStepId) - Number(first.id === exportStep.contentSourceStepId));
    for (const source of sources) {
      const artifact = run.attempts.filter(attempt => attempt.stepId === source.id && attempt.status === 'complete').at(-1)?.artifacts?.filter(item => item.kind === 'text' && !item.trashedAt).at(-1);
      if (artifact) return artifact;
    }
  }
  return undefined;
}
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
function ArtifactIcon({ kind }: { kind: ArtifactMetadata['kind'] }) {
  const Icon = kind === 'image' ? Image : kind === 'audio' ? AudioLines : kind === 'video' ? Video : kind === 'office' || kind === 'text' ? FileText : Paperclip;
  return <Icon size={18} />;
}
export function PreviewContent({ artifact, preview, documentKind }: { artifact: ArtifactMetadata; preview: ArtifactPreview; documentKind?: EditorKind | 'excel' }) {
  if (preview.dataUrl && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(preview.dataUrl)) return <img className="ar-preview-image" src={preview.dataUrl} alt={artifact.name} />;
  if (preview.dataUrl && /^data:audio\/[\w.+-]+;base64,/i.test(preview.dataUrl)) return <audio className="ar-preview-media" controls src={preview.dataUrl}>当前环境不能内嵌播放，请使用“打开”。</audio>;
  if (preview.dataUrl && /^data:video\/[\w.+-]+;base64,/i.test(preview.dataUrl)) return <video className="ar-preview-media" controls src={preview.dataUrl}>当前环境不能内嵌播放，请使用“打开”。</video>;
  if (typeof preview.text === 'string') return artifact.kind === 'office' && !preview.documentSource ? <><p className="ar-preview-note">以下为提取的文字。可在文档工作台编辑本应用生成的内容，实际文件也可用 Office 或 WPS 打开。</p><pre className="ar-preview-text">{preview.text}</pre></> : <>{preview.documentSource && <p className="ar-preview-note">对应此文件的生成内容{preview.sourceRevision ? ` · 编辑源 v${preview.sourceRevision}` : ''}；分页与最终版式可在实际文件中检查。</p>}<DocumentArtifactPreview text={preview.text} title={artifact.name} hint={/检查|报告|report/i.test(artifact.name) ? undefined : documentKind} /></>;
  return <div className="ar-no-preview"><FileText size={32} /><h3>使用本机应用检查这份文件</h3><p>当前格式不提供网页内完整预览。Office 文件请在 Office 或 WPS 中打开，检查版式、公式与可编辑性。</p></div>;
}

function uniqueArtifacts(artifacts: ArtifactMetadata[]): ArtifactMetadata[] {
  return artifacts.filter((artifact, index) => artifacts.findIndex(item => item.id === artifact.id) === index);
}

export function ArtifactResults({ artifacts, runner, onUseReference, projectId, visibleProjectIds, documentKind, onEditDocument }: ArtifactResultsProps) {
  const inventory = useProjectInventory(projectId, runner);
  const [selected, setSelected] = useState<{ artifact: ArtifactMetadata; preview: ArtifactPreview } | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [trashTarget, setTrashTarget] = useState<ArtifactMetadata | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [recycled, setRecycled] = useState<ArtifactMetadata[]>([]);
  const [recent, setRecent] = useState<ArtifactMetadata[]>([]);
  const supplied = uniqueArtifacts(artifacts);
  const outputKind = documentKind || runner.runs.find(run => run.projectId === (projectId || selected?.artifact.projectId) && run.snapshot.outputKind)?.snapshot.outputKind;
  const previewKind = outputKind === 'image' ? undefined : outputKind;
  const explicitScope = Boolean(projectId) || visibleProjectIds !== undefined;
  const scopeIds = new Set(projectId ? [projectId] : visibleProjectIds ?? supplied.map(artifact => artifact.projectId).filter((id): id is string => Boolean(id)));
  const scopeKey = [...scopeIds].sort().join('|');
  const previousScope = useRef(scopeKey);
  const belongs = (artifact: ArtifactMetadata) => Boolean(artifact.projectId && scopeIds.has(artifact.projectId));
  const provided = explicitScope ? supplied.filter(belongs) : supplied;
  const rootTrash = Array.isArray(runner.trashedArtifacts) ? runner.trashedArtifacts : undefined;
  const rootTrashIds = new Set(rootTrash?.map(artifact => artifact.id));
  const isTrashed = (artifact: ArtifactMetadata) => rootTrashIds.has(artifact.id) || Boolean(artifact.trashedAt);
  const normalRows = projectId ? mergeProjectInventory(projectId, [...provided, ...recent.filter(belongs)], inventory.files, rootTrash) : uniqueArtifacts([...provided, ...recent.filter(belongs)]);
  const trashRows = uniqueArtifacts([...normalRows.filter(artifact => belongs(artifact) && isTrashed(artifact)), ...(rootTrash || []).filter(belongs), ...recycled.filter(belongs)]).filter(isTrashed);
  const presentation = new Map(projectInventoryFiles(runner.runs, projectId || selected?.artifact.projectId || '', inventory.files, runner.trashedArtifacts).map(item => [item.artifact.id, item]));
  const rows = showTrash ? trashRows : normalRows.slice().sort((first, second) => Number(second.kind === 'office') - Number(first.kind === 'office'));
  const canonicalSignature = JSON.stringify(provided.map(artifact => [artifact.id, artifact.trashedAt || '']));
  const rootTrashSignature = JSON.stringify(rootTrash?.map(artifact => [artifact.id, artifact.trashedAt || '']));
  const availabilitySignature = normalRows.map(item => `${item.id}:${!!item.unavailable}:${item.trashedAt || ''}`).join('|');
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey; setRecent([]); setRecycled([]); setSelected(null); setTrashTarget(null); setShowTrash(false); setMessage('');
  }, [scopeKey]);
  useEffect(() => {
    if (selected && normalRows.some(artifact => artifact.id === selected.artifact.id && (isTrashed(artifact) || artifact.unavailable))) setSelected(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalSignature, rootTrashSignature, availabilitySignature]);
  useEffect(() => {
    if (!selected && !trashTarget) return;
    const close = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return; if (event.key === 'Escape' && !busy) { event.preventDefault(); setSelected(null); setTrashTarget(null); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected, trashTarget, busy]);
  async function refreshTrash() {
    if (busy || !scopeIds.size) return;
    const expectedScope = scopeKey; setBusy('trash-list'); setMessage(''); setMessageError(false);
    try {
      const list = (await runner.listTrashedArtifacts()).filter(artifact => Boolean(artifact.trashedAt) && belongs(artifact));
      if (previousScope.current !== expectedScope) return;
      // The runner publishes this list to shared root state; local fallback is used only until it loads.
      setRecycled(list);
    } catch { setMessage('回收站读取未完成，请稍后刷新；没有删除任何文件。'); setMessageError(true); }
    finally { setBusy(''); }
  }
  async function changeTrash(artifact: ArtifactMetadata, trash: boolean) {
    if (busy) return;
    const expectedScope = scopeKey; setBusy(`${trash ? 'trash' : 'restore'}:${artifact.id}`); setMessage(''); setMessageError(false);
    try {
      if (trash) await runner.trashArtifact(artifact.id); else await runner.restoreArtifact(artifact.id);
      if (previousScope.current !== expectedScope) return;
      const next = { ...artifact, trashedAt: trash ? new Date().toISOString() : undefined };
      setRecent(current => [next, ...current.filter(item => item.id !== artifact.id)]);
      setRecycled(current => trash ? [next, ...current.filter(item => item.id !== artifact.id)] : current.filter(item => item.id !== artifact.id));
      if (trash) setSelected(current => current?.artifact.id === artifact.id ? null : current);
      setTrashTarget(null);
      setMessage(trash ? `“${artifact.name}”已移入回收站，可恢复；相关历史费用保留。` : `“${artifact.name}”已恢复，历史费用保持不变。`);
      if (inventory.supported) await inventory.refresh();
    } catch { setMessage('操作未确认完成，请刷新回收站和运行记录后再试。历史费用仍会保留。'); setMessageError(true); }
    finally { setBusy(''); }
  }
  async function perform(artifact: ArtifactMetadata, action: 'preview' | 'open' | 'save') {
    if (busy) return;
    if (artifact.unavailable) { setMessage(artifact.unavailableReason || '原文件不在原位置，请检查本机文件后刷新。'); setMessageError(true); return; }
    if (isTrashed(artifact)) { setMessage('这份文件已移入回收站，请先恢复再预览、打开或另存。'); setMessageError(true); return; }
    setBusy(`${action}:${artifact.id}`); setMessage(''); setMessageError(false);
    try {
      if (action === 'preview') setSelected({ artifact, preview: await runner.previewArtifact(artifact.id) });
      else if (action === 'open') { await runner.openArtifact(artifact.id); setMessage(`已请求本机应用打开“${artifact.name}”。`); }
      else { const result = await runner.saveArtifact(artifact.id); setMessage(result.saved ? `“${artifact.name}”已另存。` : '已取消另存，原文件仍保留。'); }
    } catch { setMessage(action === 'preview' ? '这份文件暂不能在此预览，可尝试用本机应用打开或另存。' : '操作未完成，请检查文件是否仍存在，或稍后重试。'); setMessageError(true); }
    finally { setBusy(''); }
  }
  if (!normalRows.length && !scopeIds.size) return null;
  return <section className="ar-results" aria-label="步骤产物"><div className="ar-heading"><Paperclip size={14} /><strong>{showTrash ? '本项目范围的产物回收站' : projectId ? '项目文件' : '本次产物'}</strong><span>{rows.length} 份</span>{projectId && inventory.supported && <button className="ar-trash-tab" disabled={!!busy || inventory.loading} aria-label="刷新项目文件" title="读取本地登记文件，不调用模型" onClick={() => { void inventory.refresh(); }}><RotateCcw size={12} className={inventory.loading ? 'spin' : undefined} />刷新项目文件</button>}<button className="ar-trash-tab" disabled={!!busy || !scopeIds.size} title={scopeIds.size ? '仅显示当前项目或允许范围内的文件' : '缺少关联项目，不能查看回收站'} onClick={() => { if (showTrash) setShowTrash(false); else { setShowTrash(true); void refreshTrash(); } }}>{showTrash ? <Paperclip size={12} /> : <Trash2 size={12} />}{showTrash ? '返回产物' : '回收站'}</button>{showTrash && <button className="ar-trash-tab" disabled={!!busy} aria-label="刷新产物回收站" onClick={() => { void refreshTrash(); }}>{busy === 'trash-list' ? <LoaderCircle size={12} className="spin" /> : <RotateCcw size={12} />}刷新</button>}</div><div className={`ar-file-list ${showTrash ? 'ar-trash-file-list' : ''}`}>{rows.map(artifact => {
    const trashed = isTrashed(artifact);
    return <article key={artifact.id} className={`ar-file ${trashed ? 'ar-file-trashed' : ''}`}><span className={`ar-file-icon ar-file-${artifact.kind}`}><ArtifactIcon kind={artifact.kind} /></span><div><strong title={artifact.name}>{artifact.name}</strong><small>{presentation.get(artifact.id)?.description || `${fileSize(artifact.bytes)} · ${artifact.mimeType}`}</small>{artifact.unavailable && <span className="ar-unavailable-label">{artifact.unavailableReason || '原文件不在原位置，请检查本机文件后刷新。'}</span>}{trashed && <span className="ar-trashed-label"><Trash2 size={10} />已移入回收站 · 费用记录保留</span>}</div><div className="ar-file-actions">{!trashed && onEditDocument && (artifact.kind === 'office' || artifact.kind === 'text' && !/检查|报告|report/i.test(artifact.name)) && <button disabled={!!busy || !!artifact.unavailable} onClick={onEditDocument}><FileText size={14} /><span>查看文档</span></button>}{trashed ? <button disabled={!!busy || !!artifact.unavailable} aria-label={`恢复产物 ${artifact.name}`} onClick={() => { void changeTrash(artifact, false); }}>{busy === `restore:${artifact.id}` ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}<span>恢复</span></button> : <>{artifact.kind === 'image' && onUseReference && <button disabled={!!busy || !!artifact.unavailable} aria-label={`用作参考 ${artifact.name}`} onClick={() => { void onUseReference(artifact); }}><Paperclip size={13} /><span>用作参考</span></button>}<button disabled={!!busy || !!artifact.unavailable} aria-label={`预览产物 ${artifact.name}`} title={artifact.kind === 'text' ? '查看完整正文' : '预览'} onClick={() => { void perform(artifact, 'preview'); }}>{busy === `preview:${artifact.id}` ? <LoaderCircle size={14} className="spin" /> : <Eye size={14} />}<span>预览</span></button><button disabled={!!busy || !!artifact.unavailable} aria-label={`打开产物 ${artifact.name}`} onClick={() => { void perform(artifact, 'open'); }}><ExternalLink size={13} /><span>打开</span></button><button disabled={!!busy || !!artifact.unavailable} aria-label={`另存产物 ${artifact.name}`} onClick={() => { void perform(artifact, 'save'); }}><Download size={14} /><span>另存</span></button><button className="ar-trash-button" disabled={!!busy || !!artifact.unavailable} aria-label={`移入回收站产物 ${artifact.name}`} title="移入可恢复回收站，历史费用保留" onClick={() => setTrashTarget(artifact)}><Trash2 size={13} /><span>移入回收站</span></button></>}</div></article>;
  })}{!rows.length && <div className="ar-trash-empty"><Trash2 size={26} /><strong>{busy === 'trash-list' ? '正在读取回收站…' : showTrash ? '此项目范围的回收站为空' : '当前没有产物'}</strong><p>移入回收站的文件可恢复，相关调用记录与历史费用不会清零。</p></div>}</div>{inventory.error && <p className="ar-message ar-error-message" role="alert">{inventory.error}</p>}{message && <p className={`ar-message ${messageError ? 'ar-error-message' : ''}`} role="status">{messageError ? <AlertCircle size={13} /> : <Check size={13} />}{message}</p>}
  {selected && !selected.artifact.unavailable && !isTrashed(selected.artifact) && <ModalPortal onClose={() => setSelected(null)} busy={!!busy}><div className="ar-overlay" onMouseDown={event => event.target === event.currentTarget && setSelected(null)}><section className="ar-preview-dialog" role="dialog" aria-modal="true" aria-label={`预览 ${selected.artifact.name}`}><header><span className="ar-file-icon"><ArtifactIcon kind={selected.artifact.kind} /></span><div><h2>{selected.artifact.name}</h2><p>{fileSize(selected.artifact.bytes)} · {selected.preview.mimeType}</p></div><button className="btn-icon" aria-label="关闭产物预览" onClick={() => setSelected(null)}><X size={19} /></button></header><div className="ar-preview-body">{message && <p className="ar-preview-feedback" role="status">{message}</p>}<PreviewContent artifact={selected.artifact} preview={selected.preview} documentKind={previewKind} /></div><footer><span>产物保存在本机；打开后请继续核对内容与格式。</span><button className="btn btn-secondary" disabled={!!busy} onClick={() => { void perform(selected.artifact, 'open'); }}><ExternalLink size={14} />本机打开</button><button className="btn btn-primary" disabled={!!busy} onClick={() => { void perform(selected.artifact, 'save'); }}><Download size={14} />另存文件</button></footer></section></div></ModalPortal>}
  {trashTarget && <ModalPortal onClose={() => setTrashTarget(null)} busy={!!busy}><div className="ar-overlay ar-trash-overlay" onMouseDown={event => event.target === event.currentTarget && !busy && setTrashTarget(null)}><section className="ar-trash-dialog" role="dialog" aria-modal="true" aria-label="确认产物移入回收站"><header><span className="ar-file-icon"><Trash2 size={20} /></span><div><h2>将这份产物移入回收站？</h2><p>{trashTarget.name}</p></div><button className="btn-icon" disabled={!!busy} aria-label="关闭产物回收确认" onClick={() => setTrashTarget(null)}><X size={19} /></button></header><div><p>移入后暂不能预览、打开或另存。你可以在当前项目范围的产物回收站恢复。</p><p><ShieldCheck size={15} />历史调用记录与已经发生的费用始终保留。</p></div><footer><button autoFocus className="btn btn-secondary" disabled={!!busy} onClick={() => setTrashTarget(null)}>取消</button><button className="btn btn-primary" disabled={!!busy} onClick={() => { void changeTrash(trashTarget, true); }}>{busy === `trash:${trashTarget.id}` ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}确认移入回收站</button></footer></section></div></ModalPortal>}
  </section>;
}
