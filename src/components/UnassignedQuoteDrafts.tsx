import type { LegacyQuote, QuoteFields, QuoteMode } from '../lib/project-quotes';

export function UnassignedQuoteDrafts({ quotes, projectName, onApply, onExport }: { quotes: LegacyQuote[]; projectName?: string; onApply: (fields: QuoteFields, mode: QuoteMode, scope: 'live' | 'simulation') => void; onExport: (raw: string) => void; }) {
  if (!quotes.length) return null;
  return <details className="fin-unassigned-quotes"><summary>{quotes.length} 份旧版工作区报价尚未分配</summary><p>旧版草稿不自动关联客户。下面只载入成本参数，费用会按当前项目重新计算；另存后旧原始记录仍保留。</p>{quotes.map((quote, index) => <section key={quote.key}><strong>旧稿 {index + 1} · 原显示项目：{quote.projectName || '未明确'}</strong>{quote.error ? <p role="alert">{quote.error}</p> : <p>可明确载入到当前项目“{projectName || '未选择项目'}”，不会更改其他项目报价。</p>}<div><button type="button" className="btn btn-secondary" disabled={!projectName || !quote.inputs} onClick={() => { if (quote.inputs) onApply(quote.inputs, quote.mode || 'single', quote.scope || 'simulation'); }}>将旧版参数载入当前项目</button><button type="button" className="btn btn-ghost" onClick={() => onExport(quote.raw)}>导出旧稿原始记录</button></div></section>)}</details>;
}
