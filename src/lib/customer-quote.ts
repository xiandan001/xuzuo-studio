export interface CustomerQuoteInfo { client: string; scope: string; quantity: string; revisions: string; deliveryDate: string; validUntil: string; notes: string; contact: string; }
export interface CustomerQuoteDocument { title: string; priceCents: number; issuedAt: string; info: CustomerQuoteInfo; }
export const emptyCustomerQuote = (): CustomerQuoteInfo => ({ client: '', scope: '', quantity: '1', revisions: '1', deliveryDate: '', validUntil: '', notes: '', contact: '' });
const keys = Object.keys(emptyCustomerQuote()) as (keyof CustomerQuoteInfo)[];
export function validCustomerQuoteInfo(value: unknown): value is CustomerQuoteInfo {
  return !!value && typeof value === 'object' && keys.every(key => typeof (value as CustomerQuoteInfo)[key] === 'string' && (value as CustomerQuoteInfo)[key].length <= (key === 'scope' || key === 'notes' ? 4000 : 200));
}
export function customerQuoteError(value: CustomerQuoteDocument): string {
  if (!value.title.trim() || value.title.length > 200 || !Number.isSafeInteger(value.priceCents) || value.priceCents < 0) return '请先选择项目并算出有效的总报价。';
  if (!validCustomerQuoteInfo(value.info) || !value.info.scope.trim()) return '请填写本次交付范围，避免客户误解报价包含的内容。';
  if (!/^[1-9]\d{0,5}$/.test(value.info.quantity.trim())) return '交付数量需为 1–999999 的整数。';
  if (!/^\d{1,3}$/.test(value.info.revisions.trim()) || Number(value.info.revisions) > 100) return '包含修改次数需为 0–100 的整数。';
  for (const field of ['deliveryDate', 'validUntil'] as const) {
    const text = value.info[field]; if (text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) return '请填写有效的交付日期和报价有效期，或留空。';
  }
  return '';
}
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export function customerQuotePlainText(value: CustomerQuoteDocument): string {
  const issue = customerQuoteError(value); if (issue) throw new Error(issue);
  const info = value.info;
  return [`项目：${value.title}`, info.client && `客户：${info.client}`, `项目总报价：¥${(value.priceCents / 100).toFixed(2)}`, `交付范围：${info.scope}`, `交付数量：${info.quantity}`, `包含修改：${info.revisions} 次`, info.deliveryDate && `约定交付日期：${info.deliveryDate}`, info.validUntil && `报价有效期至：${info.validUntil}`, info.notes && `补充约定：${info.notes}`, '新增需求、超出范围或额外修改另行协商。', info.contact && `联系方式：${info.contact}`].filter(Boolean).join('\n');
}
export function customerQuoteHtml(value: CustomerQuoteDocument): string {
  const issue = customerQuoteError(value); if (issue) throw new Error(issue);
  const info = value.info, lines = (text: string) => escape(text).replace(/\n/g, '<br>');
  const details = [['客户', info.client || '—'], ['交付数量', info.quantity], ['包含修改', `${info.revisions} 次`], ['约定交付日期', info.deliveryDate || '另行约定'], ['报价有效期至', info.validUntil || '另行约定'], ['出具日期', value.issuedAt.slice(0, 10)]];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; script-src 'none'"><title>${escape(value.title)} · 报价单</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#18212f;font:15px/1.85 'Microsoft YaHei','Segoe UI',sans-serif}.quote{max-width:780px;margin:0 auto;padding:34px}header{border-bottom:2px solid #242b3c;padding-bottom:22px}header small{letter-spacing:3px;color:#667085}h1{font-size:28px;line-height:1.45;margin:9px 0;overflow-wrap:anywhere}.price{margin:24px 0;padding:20px;background:#f5f6f8;border-radius:10px;display:flex;align-items:center;justify-content:space-between}.price b{font-size:30px;white-space:nowrap}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:22px 0}dl div{min-width:0}dt{color:#667085;font-size:13px}dd{margin:3px 0 0;overflow-wrap:anywhere}section{margin-top:22px;break-inside:avoid}h2{font-size:17px;margin:0 0 8px}p{margin:0;overflow-wrap:anywhere}footer{border-top:1px solid #d5dae2;margin-top:28px;padding-top:15px;color:#667085;font-size:12px}@media print{.quote{max-width:none;padding:0}.price{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><article class="quote"><header><small>PROJECT QUOTATION</small><h1>${escape(value.title)}</h1><p>项目报价单</p></header><div class="price"><span>项目总报价 · 人民币</span><b>¥${(value.priceCents / 100).toFixed(2)}</b></div><dl>${details.map(([label, text]) => `<div><dt>${label}</dt><dd>${escape(text)}</dd></div>`).join('')}</dl><section><h2>本次交付范围</h2><p>${lines(info.scope)}</p></section>${info.notes ? `<section><h2>补充约定</h2><p>${lines(info.notes)}</p></section>` : ''}<footer>新增需求、超出范围或额外修改另行协商。${info.contact ? `<br>联系方式：${escape(info.contact)}` : ''}</footer></article></body></html>`;
}
