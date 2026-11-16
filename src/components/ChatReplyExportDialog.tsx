import { useMemo, useRef, useState } from 'react';
import { FileDown, LoaderCircle, X } from 'lucide-react';
import type { PageProps, Project } from '../types';
import type { ChatTurn } from '../chat-types';
import type { WorkflowDefinition } from '../configuration-types';
import { chatFileDocument, chatReplyTables, type ChatFileKind } from '../lib/chat-file-document';
import { parseChatMarkdown } from '../lib/chat-markdown';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import './chat-reply-export.css';

const formats = [{ value: 'word', label: 'Word 文档', extension: 'docx' }, { value: 'ppt', label: 'PPT 演示', extension: 'pptx' }, { value: 'excel', label: 'Excel 表格', extension: 'xlsx' }] as const;
export function ChatReplyExportDialog({ props, conversationId, turn, onClose, onSaved }: { props: PageProps; conversationId: string; turn: ChatTurn; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<ChatFileKind>('word'), [title, setTitle] = useState(() => (turn.text.match(/^#{1,6}\s+(.+)$/m)?.[1] || turn.userText || '对话文稿').replace(/\s+/g, ' ').slice(0, 100));
  const [projectId, setProjectId] = useState('new'), [busy, setBusy] = useState(false), [issue, setIssue] = useState('');
  const [acceptedRunId, setAcceptedRunId] = useState(''), request = useRef<WorkflowDefinition | undefined>(undefined), pending = useRef(false);
  const chosenProject = useRef<Project | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const tables = useMemo(() => chatReplyTables(parseChatMarkdown(turn.text)).length, [turn.text]);
  const projects = props.projects.filter(project => project.workspaceId === props.workspaceId && project.kind === kind && !project.trashedAt && !project.purgedAt);
  const preview = useMemo(() => { try { const document = chatFileDocument(turn.text, kind, title); return { document, text: document.kind === 'word' ? `${document.blocks.length} 个正文区块` : document.kind === 'ppt' ? `${document.slides.length} 页可编辑演示` : `${document.sheets.length} 张工作表` }; } catch (cause) { return { issue: cause instanceof Error ? cause.message : '内容暂不能转换。' }; } }, [turn.text, kind, title]);
  async function link(runId: string, sha256: string) {
    const bridge = window.desktop?.chat; if (!bridge?.linkExport) throw Error('请在最新版桌面应用保存，已有文件保留。');
    await bridge.linkExport({ workspaceId: props.workspaceId, conversationId, turnId: turn.id, runId, kind, sourceSha256: sha256 });
    props.notify('已提交本地保存，可在这条回复下查看文件；未调用模型。'); onSaved(); onClose();
  }
  async function save(project: Project) {
    if (!preview.document) return;
    setBusy(true); setIssue('');
    chosenProject.current = project; setProjectId(project.id); setLocked(true);
    try {
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(turn.text)))).map(value => value.toString(16).padStart(2, '0')).join('');
      if (acceptedRunId) { await link(acceptedRunId, sha256); return; }
      const workflow = request.current ||= { id: crypto.randomUUID(), workspaceId: props.workspaceId, name: `回复保存为 ${formats.find(item => item.value === kind)!.extension}`, description: '本地排版已有回复，不调用模型，原回复和编辑草稿保留。', outputKind: kind, sourceChat: { conversationId, turnId: turn.id, sha256 }, updatedAt: new Date().toISOString(), steps: [{ id: crypto.randomUUID(), name: '保存真实 Office 文件', kind: 'export', prompt: '', inputSource: 'project', referenceArtifactIds: [], enabled: true }] };
      const result = await props.workflowRunner.startLive(workflow, project.id, JSON.stringify(preview.document), {}, [], false);
      if (result.status === 'started') { setAcceptedRunId(result.runId); await link(result.runId, sha256); }
      else { if (result.status === 'rejected') { request.current = undefined; chosenProject.current = undefined; setLocked(false); } throw Error(result.error); }
    } catch (cause) { setIssue(cause instanceof Error ? cause.message : '保存尚未确认，请查看原任务；不会自动重复保存。'); }
    finally { pending.current = false; setBusy(false); }
  }
  function submit() {
    if (pending.current || !preview.document) return;
    pending.current = true;
    const project = chosenProject.current || projects.find(item => item.id === projectId);
    if (project) { void save(project); return; }
    setBusy(true);
    props.onCreateProject(kind, { quick: true, initial: { name: title, description: `来自对话回复的本地${formats.find(item => item.value === kind)!.label}` }, onCreated: project => { void save(project); }, onCancelled: error => { pending.current = false; setBusy(false); if (error) setIssue(error); } });
  }
  return <ModalPortal onClose={onClose} busy={busy}><div className="chat-file-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="chat-file-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-file-title">
    <header><div><h2 id="chat-file-title"><FileDown size={22} />将回复保存为文件</h2><p>保留已有文字，保存后可继续编辑。</p></div><button type="button" className="btn-icon" disabled={busy} aria-label="关闭保存文件" onClick={onClose}><X size={20} /></button></header>
    <div className="chat-file-fields"><div className="chat-file-formats" role="group" aria-label="文件格式">{formats.map(item => <button type="button" key={item.value} className="btn btn-secondary" aria-pressed={kind === item.value} disabled={busy || locked || item.value === 'excel' && !tables} title={item.value === 'excel' && !tables ? '这条回复没有可保存的 Markdown 表格' : `保存为 .${item.extension}`} onClick={() => { setKind(item.value); setProjectId('new'); request.current = undefined; }}>{item.label}</button>)}</div>
      <label>文件标题<input maxLength={120} value={title} disabled={busy || locked} onChange={event => { setTitle(event.target.value); request.current = undefined; }} /></label>
      <label>保存到<Select aria-label="回复保存项目" value={projectId} disabled={busy || locked} options={[{ value: 'new', label: '新建项目并选择文件夹' }, ...projects.map(project => ({ value: project.id, label: project.name }))]} onValueChange={value => { setProjectId(value); request.current = undefined; }} /></label>
      <div className="chat-file-preview"><strong>{preview.text || '检查内容'}</strong><p>{kind === 'excel' ? '只保存回复中的表格；文字、编号和公式样式内容按原文保留，不自动执行为公式。' : kind === 'ppt' ? '按标题分页，长段落分成续页；已有提纲会完整保留。' : '标题、段落、列表与表格会转为可编辑正文。'}</p><small>本地排版不产生 API 费用。配图、补写和视觉设计可使用“转为制作方案”。外部图片只保留说明，不会自动下载。</small></div>
      {(issue || preview.issue) && <p role="alert" className="form-error">{issue || preview.issue}{acceptedRunId && ' 文件任务已提交，只会重试关联，不会重复导出。'}</p>}
    </div><footer><span>原回复、项目草稿与已发生费用保留</span><button className="btn btn-primary" type="button" disabled={busy || !preview.document || !props.workflowRunner.runtimeStatus.available} onClick={submit}>{busy ? <LoaderCircle size={16} className="spin" /> : <FileDown size={16} />}{acceptedRunId ? '重试关联已有文件' : '保存文件'}</button></footer>
  </section></div></ModalPortal>;
}
