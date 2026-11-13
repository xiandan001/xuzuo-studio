import { lazy, Suspense, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import { ModalPortal } from './ModalPortal';
import './commerce-editor-dialog.css';

const CommerceLayerEditor = lazy(() => import('./CommerceLayerEditor').then(module => ({ default: module.CommerceLayerEditor })));
export function CommerceEditorDialog({ props, projectId, artifactId, onClose, onExport }: { props: PageProps; projectId: string; artifactId?: string; onClose: () => void; onExport?: (files: ArtifactMetadata[]) => void }) {
  const [closing, setClosing] = useState(false), closingFlight = useRef(false);
  async function close() { if (closingFlight.current) return; closingFlight.current = true; setClosing(true); try { const sessions = guardedEditorSessions({ includeDirty: true }).filter(session => { const state = session.getState(); return session.projectId === projectId && session.id.startsWith('commerce') && (state.dirty || state.pending); }); const saved = await Promise.all(sessions.map(session => session.save())); if (saved.some(ok => !ok)) { props.notify('图层修改尚未保存，请先保存或导出恢复文件。', 'error'); return; } onClose(); } catch { props.notify('图层修改尚未保存，请先保存或导出恢复文件。', 'error'); } finally { closingFlight.current = false; setClosing(false); } }
  return <ModalPortal onClose={() => { void close(); }} busy={closing}><div className="commerce-editor-overlay"><section role="dialog" aria-modal="true" aria-label="图片排版与精确保护" className="commerce-editor-dialog"><header><div><strong>图片排版与精确保护</strong><span>文字、Logo、尺寸与手工编辑在本地完成</span></div><button type="button" className="btn-icon" aria-label="关闭图片排版" disabled={closing} onClick={() => { void close(); }}><X size={21} /></button></header><div><Suspense fallback={<p role="status">正在打开本地图层工作台…</p>}><CommerceLayerEditor props={props} projectId={projectId} sourceArtifactId={artifactId} onExport={result => onExport?.(result.artifacts)} /></Suspense></div></section></div></ModalPortal>;
}
