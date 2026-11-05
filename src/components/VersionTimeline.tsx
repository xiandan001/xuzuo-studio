import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileOutput, GitCompareArrows, History, LoaderCircle, X } from 'lucide-react';
import type { ComparableDocument } from '../lib/version-comparison';
import { compareDocumentVersions } from '../lib/version-comparison';
import { workflowPublicError } from '../lib/studio-run';
import { ModalPortal } from './ModalPortal';
import './version-timeline.css';

interface Version { revision: number; savedAt: string; title?: string; recoveryState?: string; }
interface Props {
  projectId: string; document: ComparableDocument; savedRevision?: number; dirty: boolean; busy: boolean;
  versions: Version[]; exportNames: string[]; requestedRevision?: number; onRequestConsumed?: () => void;
  loadVersion: (revision: number) => Promise<{ document: ComparableDocument }>;
  onRestore: (revision: number) => boolean | void | Promise<boolean | void>;
}
export function VersionTimeline(props: Props) {
  const current = useRef(props); current.current = props;
  const [selected, setSelected] = useState<number>(), [candidate, setCandidate] = useState<ComparableDocument>(), [error, setError] = useState(''), [loading, setLoading] = useState(false), [applying, setApplying] = useState(false);
  useEffect(() => { setSelected(undefined); setCandidate(undefined); setError(''); }, [props.projectId]);
  useEffect(() => { if (props.requestedRevision !== undefined) { setSelected(props.requestedRevision); props.onRequestConsumed?.(); } }, [props.requestedRevision]);
  useEffect(() => {
    if (selected === undefined) return;
    let disposed = false; setLoading(true); setError(''); setCandidate(undefined);
    void current.current.loadVersion(selected).then(record => { if (!disposed) setCandidate(record.document); }).catch(cause => { if (!disposed) setError(workflowPublicError(cause, '版本暂时无法读取，当前编辑保持不变。')); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [selected, props.projectId]);
  const comparison = useMemo(() => selected !== undefined && candidate ? compareDocumentVersions(props.document, candidate) : undefined, [props.document, candidate, selected]);
  const close = () => { if (!applying) { setSelected(undefined); setCandidate(undefined); } };
  async function restore() {
    if (selected === undefined || applying || props.dirty || props.busy) return;
    setApplying(true); setError('');
    try { const done = await props.onRestore(selected); if (done === false) setError('历史内容未载入，当前内容仍保留。请核对工作台提示后重试。'); else { setSelected(undefined); setCandidate(undefined); } }
    catch (cause) { setError(workflowPublicError(cause, '历史内容未载入。')); }
    finally { setApplying(false); }
  }
  return <section className="version-timeline" aria-label="编辑版本时间线"><div className="version-current"><CheckCircle2 size={17} /><div><strong>{props.dirty ? '当前未保存修改' : props.savedRevision ? `当前编辑源 v${props.savedRevision}` : '当前新草稿'}</strong><span>{props.savedRevision ? `基于已保存版本 v${props.savedRevision}` : '保存后建立第一个版本'}{props.dirty ? '，当前修改尚未导出' : ''}</span></div></div><div className="version-export"><FileOutput size={16} /><span>{props.exportNames.length ? `对应已保存版本的导出文件：${props.exportNames.join('、')}` : '当前保存版本尚无对应导出文件'}</span></div><p>先比较，再载入。载入只改变编辑内容；保存后新增版本，历史费用不减少。</p>
    {props.versions.length ? props.versions.map(version => <button type="button" className="version-row" key={version.revision} disabled={props.busy} aria-label={`比较编辑版本 ${version.revision}`} onClick={() => setSelected(version.revision)}><History size={16} /><span><strong>编辑源 v{version.revision}{version.revision === props.savedRevision ? ' · 当前保存' : ''}</strong><small>{new Date(version.savedAt).toLocaleString('zh-CN')}{version.recoveryState && version.recoveryState !== 'saved' ? ' · 可恢复候选' : ''}</small></span><GitCompareArrows size={16} /></button>) : <p>保存第一个版本后，这里会出现可比较的历史。</p>}
    {selected !== undefined && <ModalPortal onClose={close} busy={applying}><div className="modal-backdrop"><section className="version-compare-dialog modal" role="dialog" aria-modal="true" aria-label="比较编辑版本"><header><div><h2>当前内容与编辑源 v{selected}</h2><p>比较不会修改内容或调用模型。</p></div><button type="button" className="btn-icon" aria-label="关闭版本比较" disabled={applying} onClick={close}><X size={19} /></button></header>{loading ? <p role="status"><LoaderCircle className="spin" size={17} />正在读取历史版本…</p> : comparison && <><p>{comparison.total ? `共 ${comparison.total} 处差异${comparison.total > comparison.changes.length ? `，预览前 ${comparison.changes.length} 处；载入时使用完整版本` : ''}。` : '当前内容与该版本相同。'}</p><div className="version-differences">{comparison.changes.map((change, index) => <article key={index}><h3>{change.label}</h3><div><section><b>当前内容</b><pre>{change.before.slice(0, 1200) || '（空）'}{change.before.length > 1200 ? '\n…预览已折叠，载入不截断内容' : ''}</pre></section><section><b>编辑源 v{selected}</b><pre>{change.after.slice(0, 1200) || '（空）'}{change.after.length > 1200 ? '\n…预览已折叠，载入不截断内容' : ''}</pre></section></div></article>)}</div></>}{error && <p role="alert" className="version-error">{error}</p>}{props.dirty && <p className="version-error">请先保存当前修改，再载入历史版本。可以关闭此窗口继续编辑。</p>}<footer><button type="button" className="btn btn-secondary" disabled={applying} onClick={close}>保留当前内容</button><button type="button" className="btn btn-primary" disabled={!candidate || loading || applying || props.dirty || props.busy} onClick={() => { void restore(); }}>{applying ? '正在载入…' : `载入 v${selected} 内容`}</button></footer></section></div></ModalPortal>}
  </section>;
}
