import { hasManagedDialog } from '../lib/dialog-stack';
import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Eye, FileText, FolderOpen, Image, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import { projectInventoryFiles } from '../lib/project-inventory';
import { useProjectInventory } from '../hooks/useProjectInventory';
import { ModalPortal } from './ModalPortal';
import { PreviewContent } from './ArtifactResults';
import './ProjectFilesPanel.css';

interface ProjectFilesPanelProps {
  projectId: string; projectName: string; runs: WorkflowRun[]; runner: WorkflowRunner;
  selectedImageId?: string; onSelectImage?: (id: string) => void;
  versions?: { revision: number }[]; onRestoreVersion?: (revision: number) => void;
}
export function ProjectFilesPanel({ projectId, projectName, runs, runner, selectedImageId, onSelectImage, versions = [], onRestoreVersion }: ProjectFilesPanelProps) {
  const inventory = useProjectInventory(projectId, runner);
  const items = projectInventoryFiles(runs, projectId, inventory.files, runner.trashedArtifacts);
  const outputKind = runs.find(run => run.projectId === projectId && run.snapshot.outputKind)?.snapshot.outputKind;
  const documentKind = outputKind === 'image' ? undefined : outputKind;
  const [selected, setSelected] = useState<{ artifact: ArtifactMetadata; preview?: ArtifactPreview; error?: string }>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLElement>(null);
  const closePreview = () => { generation.current++; setSelected(undefined); setBusy(''); };
  useEffect(() => { generation.current++; setSelected(undefined); setBusy(''); setMessage(''); }, [projectId]);
  const availability = items.map(item => `${item.artifact.id}:${Boolean(item.artifact.unavailable)}:${item.artifact.trashedAt || ''}`).join('|');
  useEffect(() => {
    if (selected && items.some(item => item.artifact.id === selected.artifact.id && (item.artifact.unavailable || item.artifact.trashedAt))) closePreview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeButton.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (document.activeElement instanceof Element && document.activeElement.closest('[role="dialog"][aria-modal="true"]') !== modal.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePreview(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter(button => button.getClientRects().length > 0);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [selected?.artifact.id]);
  async function preview(artifact: ArtifactMetadata) {
    if (artifact.unavailable || artifact.trashedAt) { setMessage(artifact.unavailableReason || '这份文件已回收，请恢复后再使用。'); return; }
    const request = ++generation.current; setSelected({ artifact }); setMessage(''); setBusy(`preview:${artifact.id}`);
    try { const data = await runner.previewArtifact(artifact.id); if (generation.current === request) setSelected({ artifact, preview: data }); }
    catch (cause) { if (generation.current === request) setSelected({ artifact, error: cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '预览读取未完成，原文件保留。' }); }
    finally { if (generation.current === request) setBusy(''); }
  }
  async function fileAction(artifact: ArtifactMetadata, action: 'open' | 'save') {
    if (artifact.unavailable || artifact.trashedAt) { setMessage(artifact.unavailableReason || '这份文件已回收，请恢复后再使用。'); return; }
    const request = generation.current; setBusy(`${action}:${artifact.id}`); setMessage('');
    try {
      if (action === 'open') { await runner.openArtifact(artifact.id); if (generation.current === request) setMessage('已请求使用本机应用打开。'); }
      else { const result = await runner.saveArtifact(artifact.id); if (generation.current === request) setMessage(result.saved ? '文件已另存。' : '已取消另存，原文件仍保留。'); }
    } catch (cause) { if (generation.current === request) setMessage(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '文件操作未完成，请检查文件位置。'); }
    finally { if (generation.current === request) setBusy(''); }
  }
  const groups = [{ id: 'office', label: 'Office 文档' }, { id: 'image', label: '图片' }, { id: 'source', label: '生成源稿' }, { id: 'report', label: '检查报告' }, { id: 'text', label: '其它文字' }, { id: 'other', label: '其它产物' }, { id: 'trash', label: '已回收文件' }];
  return <aside className="professional-project-files" aria-label="当前项目产物"><header><FolderOpen size={16} /><strong title={projectName}>{projectName}</strong><span>{items.length}</span>{inventory.supported && <button className="btn-icon" aria-label="刷新项目文件" title="读取本地登记文件，不调用模型" disabled={inventory.loading} onClick={() => { void inventory.refresh(); }}><RotateCcw size={14} className={inventory.loading ? 'spin' : undefined} /></button>}</header>{inventory.error && <p className="professional-file-feedback" role="alert">{inventory.error}</p>}<div className="professional-project-file-list">{groups.map(group => {
    const entries = items.filter(item => item.group === group.id);
    return entries.length ? <section key={group.id}><h3>{group.label}<span>{entries.length}</span></h3>{group.id === 'source' && <p className="professional-file-source-note">用于编辑与恢复，交付请用 Office 文档。</p>}{entries.map(({ artifact, sourceRevision, description }) => { const timestamp = description && Number.isFinite(Date.parse(artifact.createdAt)) ? new Date(artifact.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; const displayName = artifact.kind === 'office' && sourceRevision ? `${artifact.name} · 编辑源 v${sourceRevision}` : `${artifact.name}${description ? ` · ${description}` : ''}${timestamp ? ` · ${timestamp}` : ''}`; return <div className={`professional-file-item ${artifact.id === selectedImageId ? 'selected' : ''}`} key={artifact.id}><button className="professional-file-name" aria-label={`查看项目文件 ${displayName}`} title={displayName} disabled={!!artifact.unavailable || !!artifact.trashedAt || group.id === 'trash'} onClick={() => artifact.kind === 'image' && onSelectImage ? onSelectImage(artifact.id) : void preview(artifact)}>{artifact.kind === 'image' ? <Image size={14} /> : <FileText size={14} />}<span>{artifact.name}</span>{artifact.kind === 'office' && sourceRevision && <small className="professional-file-revision">v{sourceRevision}</small>}</button>{description && <p className="professional-file-description" title={`${description} · ${artifact.createdAt} · ${artifact.id}`}>{description}{timestamp && <time dateTime={artifact.createdAt}>{timestamp}</time>}</p>}<div className="professional-file-actions"><button title="按产物 ID 预览" aria-label={`预览项目文件 ${displayName}`} disabled={!!busy || !!artifact.unavailable || !!artifact.trashedAt || group.id === 'trash'} onClick={() => { void preview(artifact); }}><Eye size={13} /></button><button title="使用本机应用打开" aria-label={`打开项目文件 ${displayName}`} disabled={!!busy || !!artifact.unavailable || !!artifact.trashedAt || group.id === 'trash'} onClick={() => { void fileAction(artifact, 'open'); }}><ExternalLink size={13} /></button><button title="另存真实文件" aria-label={`另存项目文件 ${displayName}`} disabled={!!busy || !!artifact.unavailable || !!artifact.trashedAt || group.id === 'trash'} onClick={() => { void fileAction(artifact, 'save'); }}><Download size={13} /></button>{artifact.kind === 'office' && sourceRevision && onRestoreVersion && versions.some(version => version.revision === sourceRevision) && <button title={`载入已保存编辑源 v${sourceRevision}，不覆盖当前未保存内容`} aria-label={`载入项目文件源版本 ${sourceRevision}`} onClick={() => onRestoreVersion(sourceRevision)}><RotateCcw size={13} /><small>v{sourceRevision}</small></button>}</div></div>; })}</section> : null;
  })}{!items.length && <p className="professional-project-empty">当前项目还没有真实产物。生成或保存导出后，文件会按项目出现在这里。</p>}</div>{message && <p className="professional-file-feedback" role="status">{message}</p>}
    {selected && <ModalPortal onClose={closePreview} busy={!!busy}><div className="ar-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closePreview(); }}><section ref={modal} className="ar-preview-dialog" role="dialog" aria-modal="true" aria-label={`预览项目文件 ${selected.artifact.name}`}><header><FileText size={20} /><div><h2>{selected.artifact.name}</h2><p>当前项目的真实产物 · {(selected.artifact.bytes / 1024).toFixed(0)} KB</p></div><button ref={closeButton} className="btn-icon" aria-label="关闭项目文件预览" onClick={closePreview}><X size={19} /></button></header><div className="ar-preview-body">{selected.error ? <p role="alert">{selected.error}</p> : selected.preview ? <PreviewContent artifact={selected.artifact} preview={selected.preview} documentKind={documentKind} /> : <p role="status"><LoaderCircle size={20} className="spin" />正在按产物 ID 读取…</p>}</div><footer><span>Office 文字预览不代表无损原版编辑。</span><button className="btn btn-secondary" disabled={!!busy} onClick={() => { void fileAction(selected.artifact, 'open'); }}><ExternalLink size={14} />本机打开</button><button className="btn btn-primary" disabled={!!busy} onClick={() => { void fileAction(selected.artifact, 'save'); }}><Download size={14} />另存文件</button></footer></section></div></ModalPortal>}
  </aside>;
}
