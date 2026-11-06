import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, Eye, FileText, Image, LoaderCircle, X } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { RememberedDetails } from './RememberedDetails';
import { customerQuoteError, customerQuoteHtml, customerQuotePlainText, emptyCustomerQuote } from '../lib/customer-quote';
import type { CustomerQuoteDocument, CustomerQuoteInfo } from '../lib/customer-quote';
import { registerEditorSession } from '../lib/editor-session-guard';
import './customer-quote.css';

interface Props { workspaceId: string; projectId: string; title: string; priceCents?: number; enabled: boolean; info: CustomerQuoteInfo; onChange: (name: keyof CustomerQuoteInfo, value: string) => void; notify: (message: string, type?: 'success' | 'info' | 'error') => void; }
const quoteFieldLabels: Record<keyof CustomerQuoteInfo, string> = { scope: '交付范围', quantity: '交付数量', revisions: '包含修改次数', deliveryDate: '约定交付日期', validUntil: '报价有效期', client: '客户名称', notes: '补充约定', contact: '联系方式' };
export function quoteIssueField(value: CustomerQuoteDocument, issue = customerQuoteError(value)): keyof CustomerQuoteInfo | undefined {
  const base = { ...value, info: { ...emptyCustomerQuote(), scope: '交付范围' } };
  if (!issue || customerQuoteError(base)) return undefined;
  for (const field of Object.keys(quoteFieldLabels) as (keyof CustomerQuoteInfo)[]) {
    if (customerQuoteError({ ...base, info: { ...base.info, [field]: value.info[field] } }) === issue) return field;
  }
  return undefined;
}
export function CustomerQuotePanel({ workspaceId, projectId, title, priceCents, enabled, info, onChange, notify }: Props) {
  const [preview, setPreview] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const pending = useRef(false), request = useRef(0), scope = `${workspaceId}/${projectId}`;
  const current = useRef(scope); current.current = scope;
  const form = useRef<HTMLDivElement>(null), formId = useId();
  useEffect(() => { request.current++; pending.current = false; setPreview(false); setError(''); setBusy(''); }, [scope]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => registerEditorSession({ id: `customer-quote-${scope}`, projectId, label: '正在导出客户报价单', getState: () => ({ dirty: false, pending: pending.current }), save: async () => false, exportRecovery: () => false }), [scope, projectId]);
  const value: CustomerQuoteDocument = { title, priceCents: priceCents ?? -1, issuedAt: new Date().toLocaleDateString('sv-SE'), info };
  const issue = customerQuoteError(value), html = issue ? '' : customerQuoteHtml(value);
  const issueField = quoteIssueField(value, issue), errorId = `${formId}-${issueField}-error`;
  const fieldAttributes = (field: keyof CustomerQuoteInfo) => ({ id: `${formId}-${field}`, 'data-quote-field': field, 'aria-invalid': issueField === field || undefined, 'aria-describedby': issueField === field ? errorId : undefined });
  const fieldNote = (field: keyof CustomerQuoteInfo) => issueField === field ? <small className="customer-quote-field-error" id={errorId}>{issue}</small> : null;
  function focusIssue() { if (issueField) form.current?.querySelector<HTMLElement>(`[data-quote-field="${issueField}"]`)?.focus(); }
  function update(name: keyof CustomerQuoteInfo, text: string) { setError(''); onChange(name, text); }
  async function exportFile(format: 'pdf' | 'png') {
    if (pending.current || !enabled || issue) return;
    const exporter = window.desktop?.customerQuotes;
    if (!exporter) { setError('请在新版桌面应用中保存 PDF 或图片；仍可预览与复制报价。'); return; }
    const identity = scope, operation = ++request.current; pending.current = true; setBusy(format); setError('');
    try {
      const result = await exporter.export({ workspaceId, projectId, title, html, format });
      if (current.current === identity && operation === request.current) { if (result.saved) notify(`客户报价${format === 'pdf' ? ' PDF' : '图片'}已保存到项目文件；不包含内部成本。`); else setError('本次未保存报价文件，当前内容保留。'); }
    } catch (cause) { if (current.current === identity && operation === request.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '报价导出未完成，当前内容仍保留。'); }
    finally { if (current.current === identity && operation === request.current) { pending.current = false; setBusy(''); } }
  }
  async function copy() {
    if (issue || !enabled) return;
    try { await navigator.clipboard.writeText(customerQuotePlainText(value)); notify('已复制客户报价与交付约定，不含内部成本。'); }
    catch { setError('复制未完成，可先预览，再导出报价文件。'); }
  }
  const actions = <><button type="button" className="btn btn-secondary" disabled={!enabled || !!issue || !!busy} onClick={() => { void copy(); }}><Copy size={15} />复制客户报价</button><button type="button" className="btn btn-secondary" disabled={!enabled || !!issue || !!busy} onClick={() => { void exportFile('png'); }}>{busy === 'png' ? <LoaderCircle size={15} className="spin" /> : <Image size={15} />}保存报价图片</button><button type="button" className="btn btn-primary" disabled={!enabled || !!issue || !!busy} onClick={() => { void exportFile('pdf'); }}>{busy === 'pdf' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}导出 PDF</button></>;
  return <RememberedDetails rememberKey={`workspace:${workspaceId}:customer-quote-form`} className="customer-quote-panel"><summary><FileText size={16} /><strong>制作客户报价单</strong><span>交付约定 · PDF / 图片</span></summary><div ref={form} className="customer-quote-form"><p>只展示售价与交付约定，API 费用、人工成本和利润不会放进客户文件。</p><div className="customer-quote-fields"><label>客户名称<input {...fieldAttributes('client')} aria-label="报价客户名称" value={info.client} maxLength={200} onChange={event => update('client', event.target.value)} placeholder="可选" />{fieldNote('client')}</label><label>交付数量<input {...fieldAttributes('quantity')} aria-label="报价交付数量" inputMode="numeric" value={info.quantity} maxLength={6} onChange={event => update('quantity', event.target.value)} />{fieldNote('quantity')}</label><label>包含修改次数<input {...fieldAttributes('revisions')} aria-label="报价包含修改次数" inputMode="numeric" value={info.revisions} maxLength={3} onChange={event => update('revisions', event.target.value)} />{fieldNote('revisions')}</label><label>约定交付日期<input {...fieldAttributes('deliveryDate')} aria-label="报价交付日期" value={info.deliveryDate} maxLength={10} onChange={event => update('deliveryDate', event.target.value)} placeholder="可选，例如 2026-11-15" />{fieldNote('deliveryDate')}</label><label>报价有效期至<input {...fieldAttributes('validUntil')} aria-label="报价有效期" value={info.validUntil} maxLength={10} onChange={event => update('validUntil', event.target.value)} placeholder="可选，例如 2026-11-10" />{fieldNote('validUntil')}</label><label>联系方式<input {...fieldAttributes('contact')} aria-label="报价联系方式" value={info.contact} maxLength={200} onChange={event => update('contact', event.target.value)} placeholder="可选" />{fieldNote('contact')}</label></div><label>本次交付范围（必填）<textarea {...fieldAttributes('scope')} aria-label="报价交付范围" value={info.scope} maxLength={4000} rows={3} onChange={event => update('scope', event.target.value)} placeholder="例如：12 页品牌提案 PPT，含封面、方案与执行计划；交付可编辑文件" />{fieldNote('scope')}</label><label>补充约定<textarea {...fieldAttributes('notes')} aria-label="报价补充约定" value={info.notes} maxLength={4000} rows={2} onChange={event => update('notes', event.target.value)} placeholder="可选：格式、修改边界、验收方式等" />{fieldNote('notes')}</label>{!enabled && <p className="customer-quote-note">使用真实费用范围的单次交付报价，且计费依据齐全后，即可制作客户文件。</p>}{issue && <div className="customer-quote-validation" role="status"><span>{issueField ? `请完善${quoteFieldLabels[issueField]}后继续。` : issue}</span>{issueField && <button type="button" className="btn btn-secondary" onClick={focusIssue}>定位问题字段</button>}</div>}{error && <p className="customer-quote-error" role="alert">{error}</p>}<div className="customer-quote-actions"><button type="button" className="btn btn-secondary" disabled={!enabled || !!issue || !!busy} onClick={() => setPreview(true)}><Eye size={15} />预览客户报价</button>{actions}</div></div>{preview && <ModalPortal onClose={() => setPreview(false)} busy={!!busy}><div className="customer-quote-overlay"><section className="customer-quote-dialog" role="dialog" aria-modal="true" aria-label="客户报价单预览"><header><div><h2>客户报价单预览</h2><p>项目总报价，不含内部成本和利润。</p></div><button type="button" className="btn-icon" aria-label="关闭报价单预览" disabled={!!busy} onClick={() => setPreview(false)}><X size={19} /></button></header><iframe title="客户报价单" sandbox="" srcDoc={html} /><footer>{error && <p role="alert">{error}</p>}{actions}</footer></section></div></ModalPortal>}</RememberedDetails>;
}
