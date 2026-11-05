import { describe, expect, it } from 'vitest';
import { customerQuoteError, customerQuoteHtml, customerQuotePlainText, emptyCustomerQuote } from './customer-quote';
const document = { title: '茶饮品牌方案', priceCents: 38800, issuedAt: '2026-11-03', info: { ...emptyCustomerQuote(), client: '清禾', scope: '12页PPT\n含可编辑文件', deliveryDate: '2026-11-12', validUntil: '2026-11-08' } };
describe('对客报价只包含售价与交付约定', () => {
  it('完整范围/数量/修改次数/日期输出，额外内部字段不泄漏', () => {
    const value = { ...document, apiCostCents: 17, profitCents: 19999, key: 'SECRET-DO-NOT-SHOW' }, html = customerQuoteHtml(value), text = customerQuotePlainText(value);
    for (const field of ['388.00', '12页PPT', '2026-11-12', '2026-11-08', '1 次']) expect(html + text).toContain(field);
    for (const hidden of ['apiCostCents', 'profitCents', '19999', 'SECRET-DO-NOT-SHOW']) expect(html + text).not.toContain(hidden);
    expect(html).toContain("script-src 'none'"); expect(html).toContain("connect-src 'none'");
  });
  it('文本转义后安全预览，不把客户字段作为HTML', () => {
    const html = customerQuoteHtml({ ...document, title: '<script>alert(1)</script>', info: { ...document.info, scope: '<img src=x onerror=alert(1)> & 方案' } });
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x'); expect(html).toContain('&lt;img'); expect(html).toContain('&amp;');
  });
  it('缺范围、无效数量、修改次数和日期都阻止导出', () => {
    for (const info of [{ ...document.info, scope: '' }, { ...document.info, quantity: '0' }, { ...document.info, revisions: '101' }, { ...document.info, deliveryDate: '2026-02-30' }]) expect(customerQuoteError({ ...document, info })).toBeTruthy();
    expect(() => customerQuoteHtml({ ...document, priceCents: -1 })).toThrow();
  });
});
