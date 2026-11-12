import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, FilePenLine, LoaderCircle } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { ChatTargetInspection } from '../chat-types';
import type { BusinessOrder } from '../business-types';
import { assertRevisionSource, clearDocumentRevisionContext, readDocumentRevisionContext, revisionExportFiles } from '../lib/document-revision-context';
import type { DocumentRevisionContext } from '../lib/document-revision-context';
import { focusBusinessView } from '../lib/business-view';
import './document-revision.css';

interface Props {
  props: PageProps; ready: boolean; busy: boolean; dirty: boolean; revision: number;
  sourceArtifactIds: string[]; exportedRevision?: number; exportedArtifacts: ArtifactMetadata[];
  onLoadSource: (inspection: ChatTargetInspection, context: DocumentRevisionContext) => void | Promise<void>;
}
export function DocumentRevisionPanel({ props, ready, busy, dirty, revision, sourceArtifactIds, exportedRevision, exportedArtifacts, onLoadSource }: Props) {
  const project = props.activeProject, scope = `${props.workspaceId}:${project.id}`;
  const [context, setContext] = useState<DocumentRevisionContext>(), [order, setOrder] = useState<BusinessOrder>(), [working, setWorking] = useState(''), [issue, setIssue] = useState('');
  const live = useRef(scope); live.current = scope;
  const editing = useRef({ ready, busy, dirty, revision }); editing.current = { ready, busy, dirty, revision };
  useEffect(() => {
    live.current = scope; let alive = true; setContext(undefined); setOrder(undefined); setIssue('');
    try {
      const value = readDocumentRevisionContext(sessionStorage, props.workspaceId, project.id); if (!value) return;
      setContext(value);
      void window.desktop?.business?.snapshot(props.workspaceId).then(state => {
        if (!alive) return;
        const original = state.orders.find(item => item.id === value.orderId), feedback = state.feedback.find(item => item.id === value.feedbackId && item.orderId === value.orderId && item.target.projectId === value.projectId && item.target.artifactId === value.sourceArtifactId);
        if (!original || !feedback) { setIssue('返修单或原文件关联已变化，请返回制作单核对。'); return; }
        setOrder(original);
      }).catch(cause => { if (alive) setIssue(cause instanceof Error ? cause.message : '返修单暂未读取，当前稿件保留。'); });
    } catch (cause) { setIssue(cause instanceof Error ? cause.message : '返修资料暂未读取。'); }
    return () => { alive = false; if (live.current === scope) live.current = ''; };
  }, [scope, props.workspaceId, project.id]);
  if (!context) return issue ? <p className="revision-context-error" role="alert">{issue}</p> : null;
  const files = revisionExportFiles(context.kind, exportedArtifacts).filter(file => file.projectId === project.id);
  const linked = sourceArtifactIds.includes(context.sourceArtifactId), exported = exportedRevision === revision && files.length > 0;
  async function loadOriginal() {
    if (!context || !window.desktop?.chat || busy || working) return;
    const operation = scope; setWorking('source'); setIssue('');
    try {
      const inspection = await window.desktop.chat.inspectTarget({ workspaceId: props.workspaceId, target: { projectId: context.projectId, artifactId: context.sourceArtifactId, sha256: context.sourceSha256, kind: context.kind, editorRevision: context.sourceRevision } });
      if (live.current !== operation) return;
      if (!editing.current.ready || editing.current.busy) throw Error('编辑器已开始其他操作，当前草稿保留，请稍后载入原版。');
      assertRevisionSource(context, inspection); await onLoadSource(inspection, context);
    } catch (cause) { if (live.current === operation) setIssue(cause instanceof Error ? cause.message : '原稿未载入，当前稿件保留。'); }
    finally { if (live.current === operation) setWorking(''); }
  }
  async function adopt() {
    if (!context || !order || busy || working || dirty || !linked || !exported || !window.desktop?.business?.adoptRevision) return;
    const operation = scope; setWorking('adopt'); setIssue('');
    try {
      const result = await window.desktop.business.adoptRevision({ workspaceId: context.workspaceId, orderId: context.orderId, feedbackId: context.feedbackId, sourceArtifactId: context.sourceArtifactId, sourceSha256: context.sourceSha256, sourceRevision: context.sourceRevision, exportRevision: revision, artifactIds: files.map(file => file.id) });
      if (live.current !== operation) return;
      if (!result.state.feedback.some(item => item.id === context.feedbackId && item.status === 'confirmed') || !files.every(file => result.state.orders.find(item => item.id === context.orderId)?.outputIds.includes(file.id))) throw Error('后台未确认本轮采用结果，请重试核对；新文件和原稿都保留。');
      clearDocumentRevisionContext(sessionStorage, context.workspaceId, context.projectId);
      for (const updated of result.projects) props.onUpdateProject(updated.id, updated);
      setContext(undefined);
      if (editing.current.dirty || editing.current.revision !== revision) { props.notify('已采用刚才核对的导出版；此后新增的编辑仍保留在当前草稿。', 'info'); return; }
      props.notify('新成品已采用，本轮返修已完成。旧版本和调用费用保留。');
      if (props.onOpenBusiness) { focusBusinessView(props.workspaceId, order.id, 'feedback'); props.onOpenBusiness(order.recipe, order.id); } else props.navigate('project', project.id);
    } catch (cause) { if (live.current === operation) setIssue(cause instanceof Error ? cause.message : '采用尚未确认，可重试；不会重新调用模型。'); }
    finally { if (live.current === operation) setWorking(''); }
  }
  return <section className="revision-context" aria-label="当前返修"><div className="revision-context-title"><FilePenLine size={20} /><div><strong>正在处理客户返修</strong><span>{order?.name || '制作单'} · 原成品 v{context.sourceRevision || '—'} → 正在编辑 v{revision || '新稿'}</span></div></div><p>{!linked ? '先载入客户反馈对应原版；当前内容会另存为恢复草稿。' : dirty ? '修改后点击“保存并导出”，再在此采用本轮成品。' : !exported ? '编辑稿已保存，导出对应 Office 成品后即可完成本轮。' : '本轮正式成品已导出。请核对内容，再采用并返回制作单。'}</p><div className="revision-context-actions">{!linked && <button type="button" className="btn btn-secondary" disabled={!ready || busy || !!working} onClick={() => { void loadOriginal(); }}>{working === 'source' ? <LoaderCircle className="spin" size={15} /> : <FilePenLine size={15} />}载入返修原版</button>}<button type="button" className="btn btn-primary" disabled={!ready || busy || !!working || dirty || !linked || !exported || !order || !window.desktop?.business?.adoptRevision} onClick={() => { void adopt(); }}>{working === 'adopt' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}已核对，采用并完成本轮</button><button type="button" className="text-button" disabled={!!working} onClick={() => { if (order && props.onOpenBusiness) props.onOpenBusiness(order.recipe, order.id); }}><ArrowLeft size={14} />返回制作单</button></div>{issue && <p className="revision-context-error" role="alert">{issue}</p>}</section>;
}
