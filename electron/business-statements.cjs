const fsDefault = require('node:fs/promises');
const path = require('node:path');
const core = require('./business-data.runtime.cjs');
const { timestampedFilename } = require('./saved-filename.cjs');
const { checkedDirectory } = require('./workspace-paths.cjs');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const cash = value => `¥${(value / 100).toFixed(2)}`;
function customerStatementHtml(state, orderId) {
  const order = state.orders.find(row => row.id === orderId); if (!order) throw Error('制作单不存在。');
  const summary = core.businessReceivables(state, orderId), transactions = state.transactions.filter(row => row.orderId === orderId && !row.voidedAt && ['receipt', 'refund'].includes(row.kind)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const brand = state.brands.find(row => row.id === order.brandId);
  const rows = summary.milestones.map(row => `<tr><td>${escape(row.label)}</td><td>${escape(row.dueDate || '未约定')}</td><td>${cash(row.amountCents)}</td><td>${cash(row.paidCents)}</td><td>${cash(row.remainingCents)}</td></tr>`).join('');
  const assignments = new Map((order.paymentPlan?.assignments || []).filter(row => !row.voidedAt).map(row => [row.transactionId, row.milestoneId]));
  const milestoneFor = row => assignments.has(row.id) ? assignments.get(row.id) : row.paymentMilestoneId;
  const history = transactions.map(row => `<tr><td>${escape(row.occurredAt.slice(0, 10))}</td><td>${row.kind === 'receipt' ? '收款' : '退款'}</td><td>${cash(row.amountCents)}</td><td>${escape(order.paymentPlan?.milestones.find(item => item.id === milestoneFor(row))?.label || '按分期顺序自动归集')}</td><td>${escape(row.externalId || '未记录')}</td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(order.name)} · 客户对账单</title><style>body{font:15px/1.7 "Microsoft YaHei",sans-serif;color:#17212c;background:#f4f6f8;margin:0;padding:40px}main{max-width:920px;background:white;margin:auto;padding:40px;border:1px solid #dce2e8;border-radius:16px}h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 12px}p{margin:8px 0}small{color:#566372}table{width:100%;border-collapse:collapse;margin:14px 0;font-variant-numeric:tabular-nums}th,td{padding:12px 8px;text-align:left;border-bottom:1px solid #dce2e8;overflow-wrap:anywhere}th{background:#f4f6f8}strong{font-size:20px}.summary{display:flex;gap:24px;flex-wrap:wrap;padding:20px;background:#f4f6f8;border-radius:12px}footer{margin-top:30px;color:#566372;font-size:13px}@media print{body{padding:0;background:white}main{border:0;padding:12mm;border-radius:0}tr{break-inside:avoid}h2{break-after:avoid}}</style><main><h1>客户对账单</h1><p>${escape(order.name)}</p><small>${escape(brand?.name || '客户未填写')} · 生成时间 ${escape(new Date().toISOString())} · 人民币</small><div class="summary"><div>约定金额<br><strong>${summary.hasPlan ? cash(summary.agreedCents) : '未约定'}</strong></div><div>已收减退款<br><strong>${cash(summary.netReceivedCents)}</strong></div><div>剩余应收<br><strong>${summary.hasPlan ? cash(summary.remainingCents) : '待约定'}</strong></div></div><h2>付款约定与进度</h2>${rows ? `<table><thead><tr><th>阶段</th><th>约定日期</th><th>应收</th><th>净收归集</th><th>剩余</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>尚未保存付款约定，不能据此推算应收。</p>'}${summary.needsAllocation ? '<p>分期归属或退款需要双方核对；订单总应收按全部有效收退款计算。</p>' : ''}<h2>已记录的真实收退款</h2>${history ? `<table><thead><tr><th>日期</th><th>类型</th><th>金额</th><th>归属</th><th>外部流水号</th></tr></thead><tbody>${history}</tbody></table>` : '<p>暂无已记录的收退款。本文件没有生成或代收任何款项。</p>'}<footer>本文件依据本机已保存的付款约定与有效收退款记录整理，非银行回单或发票。未记录的款项不计为已收；请双方核对交易凭证。没有向客户自动发送消息。可通过浏览器打印或另存为PDF。</footer></main></html>`;
}
function createBusinessStatements({ businessStore, dialog, getWindow, fileSystem = fsDefault }) {
  return { async exportStatement(input) {
    if (!core.businessId(input?.workspaceId) || !core.businessId(input?.orderId)) throw Error('请选择当前工作区制作单。');
    const state = await businessStore.snapshot(input.workspaceId), order = state.orders.find(row => row.id === input.orderId); if (!order) throw Error('制作单不存在。');
    const html = customerStatementHtml(state, order.id), name = timestampedFilename(`${order.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70)}-客户对账单.html`);
    const result = await dialog.showSaveDialog(getWindow?.(), { title: '保存客户对账单 · 可打印HTML', defaultPath: name, filters: [{ name: '可打印HTML', extensions: ['html'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    const filename = result.filePath;
    if (!/\.html?$/i.test(filename)) throw Error('请选择HTML文件名；没有将网页内容冒充PDF。');
    await checkedDirectory(fileSystem, path.dirname(filename));
    try { await fileSystem.writeFile(filename, html, { encoding: 'utf8', flag: 'wx' }); } catch (error) { if (error.code === 'EEXIST') throw Error('同名文件已存在，请另选名称；没有覆盖原对账单。'); throw error; }
    return { saved: true };
  } };
}
module.exports = { createBusinessStatements, customerStatementHtml };
