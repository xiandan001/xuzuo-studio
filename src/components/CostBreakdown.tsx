import type { LedgerEntry } from '../types';
import { displayCost, formatCostAmount } from '../lib/cost-display';
import { CostAmount } from './CostAmount';
import './cost-breakdown.css';

const UNIT_LABELS: Record<string, string> = { 'million-tokens': '百万 Token', token: 'Token', image: '张图片', request: '次请求', second: '秒' };

export function CostBreakdown({ entry }: { entry: LedgerEntry }) {
  const value = displayCost(entry), calculation = value.calculation;
  return <section className="cost-breakdown" aria-label="费用计算明细"><header><div><h3>费用计算明细</h3><p>{entry.model}</p></div><strong><CostAmount entry={entry} /></strong></header>
    {entry.costState === 'manual' && <p className="cost-billing-note">当前采用你保存的人工账单校正金额。下方如有自动计算凭据，仅保留为原始记录。</p>}
    {value.pending && entry.costReason && <p className="cost-billing-note" role="status">{entry.costReason}</p>}
    {calculation ? <><p className="cost-billing-note">{calculation.basis}</p><div className="cost-component-table"><table><thead><tr><th>计费项</th><th>实际用量</th><th>单价</th><th>金额</th></tr></thead><tbody>{calculation.components.map((component, index) => <tr key={`${component.code}-${index}`}><td>{component.label}</td><td>{component.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 8 })} {component.unit === 'million-tokens' ? 'Token' : UNIT_LABELS[component.unit] || component.unit}</td><td>{formatCostAmount(component.unitPrice, component.currency)} / {UNIT_LABELS[component.unit] || component.unit}</td><td>{formatCostAmount(component.amount, component.currency)}</td></tr>)}</tbody></table></div>
      <dl><div><dt>原币合计</dt><dd>{formatCostAmount(calculation.nativeAmount, calculation.nativeCurrency)}{calculation.completeness === 'partial' ? '（已知部分）' : ''}</dd></div><div><dt>费率规则</dt><dd>{calculation.ruleId} · {calculation.ruleVersion}</dd></div>{calculation.fx && <><div><dt>换算汇率</dt><dd>1 USD = {calculation.fx.rate} CNY · {calculation.fx.kind === 'reference' ? '公共参考汇率' : '手动汇率'}</dd></div><div><dt>汇率日期</dt><dd>{calculation.fx.date}</dd></div><div><dt>汇率来源</dt><dd>{calculation.fx.source}</dd></div></>}{calculation.nativeCurrency === 'USD' && !calculation.cnyAmount && <div><dt>人民币换算</dt><dd>美元费用已经计算，暂缺可用汇率；不会当作免费。</dd></div>}</dl>
      <p className="cost-billing-note">{calculation.completeness === 'partial' ? '部分计费用量或规则尚不完整，当前金额不是完整总费用。' : '按返回的实际计费用量与保存的费率计算；参考汇率折算金额不等于付款渠道的最终结算金额。'}金额保留小数精度，汇总后再格式化。</p></> : <p className="cost-billing-note">{value.legacy ? '这是旧版按分保存的历史核算记录，缺少精确计算明细。历史金额保留，不补造用量或单价。' : entry.costState === 'not-incurred' ? '本次未发出收费请求。' : entry.costState === 'manual' ? '人工校正记录保留在本机。' : entry.billingMode !== 'live' ? '这是模拟记录，没有真实 API 扣费。' : '这笔记录暂缺完整计费用量或适用费率，软件不会把未知费用当成零元。'}</p>}
    {entry.usage?.providerRequestId && <p className="cost-request-id">供应商请求 ID：{entry.usage.providerRequestId}</p>}
  </section>;
}
