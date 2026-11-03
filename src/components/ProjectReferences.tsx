import { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, Paperclip, X } from 'lucide-react';
import type { PageProps } from '../types';
import type { ProjectReference } from '../asset-types';
import { workflowPublicError } from '../lib/studio-run';
import { registerEditorSession } from '../lib/editor-session-guard';
import './project-references.css';

export function ProjectReferences({ props, onUseImages }: { props: PageProps; onUseImages?: (files: ProjectReference[]) => void }) {
  const project = props.activeProject, files = project.referenceFiles || [];
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(busy); pending.current = busy;
  useEffect(() => registerEditorSession({ id: `references-${project.id}`, projectId: project.id, label: '正在复制参考资料', getState: () => ({ dirty: false, pending: pending.current }), save: async () => false, exportRecovery: () => false }), [project.id]);
  async function add() {
    setBusy(true); setError('');
    try {
      const imported = await props.workflowRunner.importFiles(project.id);
      const next = [...new Map([...files, ...imported].map(file => [file.id, { id: file.id, name: file.name, kind: file.kind, mimeType: file.mimeType, bytes: file.bytes }])).values()];
      if (next.length > 16) throw new Error('每个项目最多附加 16 份参考资料，请先移除不需要的引用；本次复制的文件仍保留在项目文件夹。');
      props.onUpdateProject(project.id, { referenceFiles: next });
    } catch (cause) { setError(workflowPublicError(cause, '参考文件添加未完成。')); }
    finally { setBusy(false); }
  }
  return <details className="project-references" open={files.length > 0 || !!error}>
    <summary><Paperclip size={15} />项目参考资料 <span>{files.length} 份</span></summary>
    <div><p>文字与 Office 正文会作为生成参考；其他媒体先保存在项目中，请选择对应的理解或精修功能。</p>
      {files.map(file => <div className="project-reference-row" key={file.id}><FileText size={15} /><span title={file.name}>{file.name}<small>{['text', 'office'].includes(file.kind) ? '生成时读取正文' : '已保存为参考文件'}</small></span><button className="btn-icon" disabled={busy} aria-label={`移除参考引用 ${file.name}`} title="仅移除引用，保留项目文件和费用" onClick={() => props.onUpdateProject(project.id, { referenceFiles: files.filter(item => item.id !== file.id) })}><X size={14} /></button></div>)}
      <div className="project-reference-actions"><button className="btn btn-secondary" disabled={busy || !window.desktop?.runtime || files.length >= 16} onClick={() => { void add(); }}><Paperclip size={14} />{busy ? '正在复制文件' : '添加参考文件'}</button>{onUseImages && files.some(file => file.kind === 'image') && <button className="btn btn-secondary" disabled={busy} onClick={() => onUseImages(files.filter(file => file.kind === 'image'))}><ImagePlus size={14} />将参考图用于精修</button>}</div>
      {error && <p role="alert">{error}</p>}{!window.desktop?.runtime && <p>在桌面版可添加和持久保存真实文件。</p>}
    </div>
  </details>;
}
