import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileCheck2, LoaderCircle, MessageSquarePlus, X } from 'lucide-react';
import type { ArtifactMetadata } from '../live-types';
import type { CustomerProofingBridge, ProofingImportResult, ProofingPackage } from '../proofing-types';
import { ModalPortal } from './ModalPortal';
import './client-proofing.css';

export function ClientProofingDialog({ workspaceId, projectId, files, orderId, title: initialTitle, onClose, onImported }: { workspaceId: string; projectId: string; files: ArtifactMetadata[]; orderId?: string; title?: string; onClose: () => void; onImported?: (result: ProofingImportResult) => void }) {
  const eligible = files.filter(file => !file.trashedAt && !file.unavailable && (file.kind === 'image' || file.kind === 'office'));
  const [selected, setSelected] = useState<string[]>(eligible.map(file => file.id).slice(0, 32)), [title, setTitle] = useState(initialTitle || '作品校样');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [result, setResult] = useState<ProofingPackage>(), [notice, setNotice] = useState('');
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bridge = (window.desktop as typeof window.desktop & { customerProofing?: CustomerProofingBridge })?.customerProofing;
  async function exportPackage() {
    if (pending.current || !bridge || !selected.length || !title.trim()) return;
    pending.current = true; setBusy('export'); setError(''); setNotice('');
    try {
      const output = await bridge.create({ workspaceId, projectId, artifactIds: selected, title: title.trim(), ...(orderId ? { orderId } : {}) });
      if (!alive.current) return; setResult(output);
      const saved = await window.desktop?.runtime?.saveArtifact(output.artifact.id);
      if (alive.current) setNotice(saved?.saved ? '校样包已另存。把 ZIP 交给客户，解压后打开 index.html 即可。' : '校样包已保存在项目中，可随时另存。');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '校样包未能完成，原成品保留。'); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  }
  async function importFeedback() {
    if (pending.current || !bridge) return;
    pending.current = true; setBusy('import'); setError(''); setNotice('');
    try {
      const imported = await bridge.importFeedback({ workspaceId, projectId, ...(result ? { packageId: result.packageId } : {}) });
      if (!alive.current || !imported) return;
      setNotice(imported.annotations ? `已导入 ${imported.annotations} 条意见并进入返修流程。${imported.duplicate ? `另外 ${imported.duplicate} 条已导入，未重复添加。` : ''}` : `这 ${imported.duplicate} 条意见之前已经导入，没有重复添加。`); onImported?.(imported);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '反馈未能导入，请保留客户原文件后重试。'); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  }
  function close() { if (!pending.current) { alive.current = false; onClose(); } }
  return <ModalPortal onClose={close} busy={!!busy}><div className="modal-backdrop"><section className="client-proofing-dialog" role="dialog" aria-modal="true" aria-label="客户校样与反馈"><header><span><FileCheck2 size={23} /></span><div><h2>发给客户，准确收回意见</h2><p>离线校样，无需客户安装软件或注册账号。</p></div><button type="button" className="btn-icon" aria-label="关闭客户校样" disabled={!!busy} onClick={close}><X size={19} /></button></header><div className="client-proofing-body"><ol className="client-proofing-steps"><li><b>1</b>选已保存成品</li><li><b>2</b>客户打开校样并批注</li><li><b>3</b>导回意见，定位返修</li></ol><label className="client-proofing-title">校样标题<input aria-label="客户校样标题" maxLength={120} value={title} disabled={!!busy} onChange={event => setTitle(event.target.value)} /></label><div className="client-proofing-files" role="group" aria-label="选择校样成品">{eligible.length ? eligible.map(file => <label key={file.id}><input type="checkbox" checked={selected.includes(file.id)} disabled={!!busy || !selected.includes(file.id) && selected.length >= 32} onChange={event => setSelected(previous => event.target.checked ? [...previous, file.id] : previous.filter(id => id !== file.id))} /><span><strong>{file.name}</strong><small>{Math.ceil(file.bytes / 1024)} KB · 已保存文件</small></span></label>) : <p>当前还没有可用于校样的正式文件，请先保存并导出成品。</p>}</div><div className="client-proofing-scope"><Check size={16} /><p>只包含所选成品的预览内容。Key、提示词、费用和其他原始资料不会打包。Office 使用已保存内容的校样视图，复杂原稿分页、动画和特殊图表请以正式文件或另附 PDF 为准。</p></div>{result && <p className="client-proofing-success"><Check size={16} />已建立 {result.pageCount} 个可定位内容页，原文件与版本哈希已绑定。</p>}{notice && <p className="client-proofing-success" role="status">{notice}</p>}{error && <p className="client-proofing-error" role="alert">{error}</p>}{!bridge && <p className="client-proofing-error">请在最新版桌面应用中导出校样或导入反馈。</p>}</div><footer><span>本地导出与导入不调用模型，不新增 API 费用。</span><div><button type="button" className="btn btn-secondary" disabled={!!busy || !bridge} onClick={() => { void importFeedback(); }}>{busy === 'import' ? <LoaderCircle size={15} className="spin" /> : <MessageSquarePlus size={15} />}导入客户反馈</button><button type="button" className="btn btn-primary" disabled={!!busy || !bridge || !selected.length || !title.trim()} onClick={() => { void exportPackage(); }}>{busy === 'export' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}导出校样包</button></div></footer></section></div></ModalPortal>;
}
