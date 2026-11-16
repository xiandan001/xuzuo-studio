import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCheck, LoaderCircle, ScanLine, Square, TriangleAlert } from 'lucide-react';
import type { DeliveryPreflightFinding, DeliveryPreflightReport } from '../delivery-types';
import type { ProjectKind } from '../types';
import { workflowPublicError } from '../lib/studio-run';
import { RememberedDetails } from './RememberedDetails';
import './DeliveryPreflightPanel.css';

export interface DeliveryPreflightPanelProps { projectId: string; kind: ProjectKind; artifactIds: string[]; sourceRevision?: number | string; dirty?: boolean; onOpenIssue?: (finding: DeliveryPreflightFinding) => void | Promise<void>; }
function address(finding: DeliveryPreflightFinding) { const target = finding.target; return target.sheetName ? `${target.sheetName}${target.cellAddress ? '!' + target.cellAddress : ''}` : target.pageNumber ? `第 ${target.pageNumber} 页` : target.blockId ? '对应正文段落' : '实际导出文件'; }
const method = { file: '文件完整性', ooxml: '导出结构', spreadsheet: '公式重算', image: '真实像素', pdf: '真实分页' };
export function DeliveryPreflightPanel({ projectId, kind, artifactIds, sourceRevision, dirty = false, onOpenIssue }: DeliveryPreflightPanelProps) {
  const bridge = window.desktop?.delivery;
  const [report, setReport] = useState<DeliveryPreflightReport>(), [busy, setBusy] = useState(false), [phase, setPhase] = useState(''), [error, setError] = useState(''), [limit, setLimit] = useState(20), [opening, setOpening] = useState('');
  const active = useRef<{ requestId: string; controller: AbortController } | undefined>(undefined), epoch = useRef(0);
  const signature = JSON.stringify([projectId, kind, artifactIds, sourceRevision]);
  useEffect(() => { ++epoch.current; setReport(undefined); setError(''); setBusy(false); setLimit(20); setOpening(''); return () => { ++epoch.current; const pending = active.current; active.current = undefined; pending?.controller.abort(); if (pending) void bridge?.cancelPreflight?.({ requestId: pending.requestId }).catch(() => undefined); }; }, [signature, dirty, bridge]);
  function cancel() { const pending = active.current; if (!pending) return; ++epoch.current; active.current = undefined; pending.controller.abort(); void bridge?.cancelPreflight?.({ requestId: pending.requestId }).catch(() => undefined); setBusy(false); setPhase(''); setError('已取消本次预检，成品和费用记录保持不变。'); }
  async function run() {
    if (!bridge?.preflight || dirty || busy || !artifactIds.length) return;
    const generation = ++epoch.current, pending = { requestId: crypto.randomUUID(), controller: new AbortController() }; active.current = pending;
    setBusy(true); setError(''); setReport(undefined); setLimit(20); setOpening(''); setPhase('读取正式文件并检查结构…');
    try {
      const raw = await bridge.preflight({ requestId: pending.requestId, projectId, kind, artifactIds, sourceRevision });
      if (generation !== epoch.current) return;
      setPhase(raw.pdfPreviews?.length ? '检查真实分页…' : '整理检查结果…');
      const { pdfPreviews, ...metadata } = raw;
      let completed: DeliveryPreflightReport = metadata;
      if (pdfPreviews?.length) {
        const { completeDeliveryPreflight } = await import('../lib/delivery-pdf-inspection');
        completed = await completeDeliveryPreflight(raw, { signal: pending.controller.signal, onProgress: (page, pages) => { if (generation === epoch.current) setPhase(`检查真实分页 ${page} / ${pages}…`); } });
      }
      if (generation === epoch.current) setReport(completed);
    } catch (cause) { if (generation === epoch.current) setError(workflowPublicError(cause, '本次预检未完成，原文件保持不变。')); }
    finally { if (generation === epoch.current) { active.current = undefined; setBusy(false); setPhase(''); } }
  }
  async function open(finding: DeliveryPreflightFinding) { if (!onOpenIssue || opening) return; const generation = epoch.current; setOpening(finding.id); setError(''); try { await onOpenIssue(finding); } catch (cause) { if (generation === epoch.current) setError(workflowPublicError(cause, '未能打开对应位置，请从项目文件打开成品。')); } finally { if (generation === epoch.current) setOpening(''); } }
  const errors = report?.findings.filter(finding => finding.severity === 'error').length || 0, warnings = report?.findings.filter(finding => finding.severity === 'warning').length || 0, unknown = report?.checks.filter(check => check.status === 'unverified').length || 0;
  return <section className="delivery-preflight" aria-label="成品格式预检"><div className="delivery-preflight-toolbar"><span><ScanLine size={17} /><strong>成品格式预检</strong><small>本地检查 · 0 API费用</small></span>{busy ? <button className="btn btn-secondary" type="button" onClick={cancel}><Square size={13} />取消</button> : <button className="btn btn-secondary" type="button" disabled={dirty || !artifactIds.length || !bridge?.preflight} onClick={() => { void run(); }}>{report ? '重新预检' : '运行预检'}</button>}</div>
    {dirty ? <p className="delivery-preflight-note">先保存并导出当前版本，再检查正式文件。预检不会覆盖草稿。</p> : !bridge?.preflight ? <p className="delivery-preflight-note">此功能需要更新后的桌面应用。</p> : !report && !busy && <p className="delivery-preflight-note">检查实际Office结构、公式与图片；有本地分页引擎时继续检查真实PDF。</p>}
    {busy && <p className="delivery-preflight-status" role="status"><LoaderCircle className="spin" size={15} />{phase}</p>}{error && <p className="delivery-preflight-error" role="status">{error}</p>}
    {report && <><div className="delivery-preflight-summary" role="status">{errors || warnings ? <TriangleAlert size={17} /> : <CheckCheck size={17} />}<span><strong>{errors ? `${errors}项需要处理` : warnings ? `${warnings}处建议核对` : '自动检查已完成'}</strong><small>{report.files.length}份实际文件 · {unknown ? `${unknown}项尚未自动核定` : '查看结果后确认交付'}{report.cached ? ' · 结构结果来自同指纹缓存' : ''}</small></span></div>
      {report.rendered.status !== 'not-needed' && <p className="delivery-preflight-note">{report.rendered.reason || '已读取真实分页。'}{report.rendered.status === 'unavailable' ? ' 缺少分页引擎不影响继续编辑或导出。' : ''}</p>}
      {report.findings.length > 0 && <ul className="delivery-preflight-findings">{report.findings.slice(0, limit).map(finding => <li className={`preflight-${finding.severity}`} key={finding.id}><div><span className="delivery-preflight-badge">{finding.severity === 'error' ? '需处理' : finding.severity === 'warning' ? '建议核对' : '人工核对'}</span><strong>{finding.label}</strong><small>{address(finding)} · {method[finding.method]}</small><p>{finding.detail}</p></div>{onOpenIssue && <button type="button" className="btn btn-ghost" disabled={!!opening || dirty} onClick={() => { void open(finding); }}><ArrowUpRight size={14} />{opening === finding.id ? '打开中…' : '查看位置'}</button>}</li>)}</ul>}
      {report.findings.length > limit && <button type="button" className="btn btn-ghost" onClick={() => setLimit(value => value + 20)}>再显示20项（剩余{report.findings.length - limit}项）</button>}
      <RememberedDetails rememberKey={`project:${projectId}:preflight-methods`} className="delivery-preflight-methods"><summary>查看检查项目与依据</summary><ul>{report.checks.map(check => <li key={check.id}><strong>{check.status === 'passed' ? '已检查' : check.status === 'issues' ? '有提示' : '未核定'} · {check.label}</strong><small>{method[check.method]}</small><p>{check.detail}</p></li>)}</ul></RememberedDetails>
      <p className="delivery-preflight-note">检查只针对所选成品SHA，不修改原稿或费用。事实、授权、画面效果仍使用下方交付验收核对；自动检查不保证所有视觉问题都能识别。</p>
    </>}
  </section>;
}
