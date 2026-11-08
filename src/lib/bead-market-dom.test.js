import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs'), { JSDOM } = dependencies('jsdom');
const { beadMarketDomCapture } = require('../../electron/bead-market-sources-dom.cjs'), { parseBeadMarketCapture } = require('../../electron/bead-market-sources-parser.cjs');
function capture(html, url = 'https://item.taobao.com/item.htm?id=123456789') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { value() { return this.hidden ? [] : [{ width: 400, height: 50 }]; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  Object.defineProperty(dom.window.document, 'cookie', { get() { throw Error('Cookie must never be read'); } });
  const result = dom.window.eval(`(${beadMarketDomCapture.toString()})()`); dom.window.close(); return result;
}
describe('商品页实际DOM只读采集', () => {
  it('采集当前所选规格和价格，不采集顶部账号、地址、隐藏应用状态或Cookie', () => {
    const result = capture('<header>账号昵称：私人姓名 收货地址：私人地址</header><script>window.privateState={token:"NEVER_READ"}</script><div class="ItemHeader--root">MARD单色珠</div><section class="SkuContent--current">品牌：MARD\n珠径：2.6mm\n色号：H1\n每包：1000粒\n单价：1.50元\n运费：0元\n手机号：13912345678</section>');
    expect(JSON.stringify(result)).not.toMatch(/私人姓名|私人地址|NEVER_READ|13912345678/);
    const parsed = parseBeadMarketCapture({ platform: 'taobao', capture: result }); expect(parsed.offers[0]).toMatchObject({ brand: 'MARD', code: 'H1', diameterMm: '2.6', packCount: 1000, priceCents: 150, verification: 'candidate' });
  });
  it('可见登录遮罩与安全验证优先，不透出遮罩背后报价', () => {
    const result = capture('<div role="dialog">请先登录 扫码登录</div><section class="SkuContent--current">单价：1.50元</section>');
    expect(result.state).toBe('needs-login'); expect(parseBeadMarketCapture({ platform: 'taobao', capture: result }).offers).toHaveLength(0);
    expect(capture('<section>请完成安全验证</section>').state).toBe('restricted');
  });
  it('搜索候选保留实际商品URL和卡片，不把广告或搜索按钮伪造为商品', () => {
    const result = capture('<div class="item-card"><a href="https://item.taobao.com/item.htm?id=123456789">MARD H1补充包</a><span>价格：1.50元</span></div><a href="https://s.taobao.com/search?q=拼豆">搜索</a><a href="https://evil.invalid/offer/123456789.html">伪装商品</a>', 'https://s.taobao.com/search?q=拼豆');
    const parsed = parseBeadMarketCapture({ platform: 'taobao', capture: result }); expect(parsed.offers).toHaveLength(1); expect(parsed.offers[0].url).toBe('https://item.taobao.com/item.htm?id=123456789'); expect(parsed.offers[0].priceCents).toBe(150);
  });
});
