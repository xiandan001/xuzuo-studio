import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createBeadMarketSources, classifyBeadMarketUrl, beadMarketProductUrl, extractBeadMarketLinks, beadMarketSearchUrl } = require('../../electron/bead-market-sources.cjs');
const { parseBeadMarketPage, offerFromProduct, parseBeadMarketCapture } = require('../../electron/bead-market-sources-parser.cjs');
const productUrl = 'https://item.taobao.com/item.htm?id=123456789&spm=private-tracking';
const product = (changes = {}) => ({ '@type': 'Product', name: 'MARD单色补充包', url: productUrl, brand: { name: 'MARD' }, additionalProperty: [{ name: '色号', value: 'H1' }, { name: '珠径', value: '2.6mm' }, { name: '每包', value: '1000粒' }], offers: { '@type': 'Offer', priceCurrency: 'CNY', price: '1.50' }, ...changes });
const html = value => `<html><script type="application/ld+json">${JSON.stringify(value)}</script></html>`;
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html;charset=utf-8', ...headers } });

describe('平台官方商品链接与真实报价来源', () => {
  it('只认实际商品URL，删除跟踪参数并保留选定SKU，不将搜索或短链当购买链接', () => {
    expect(beadMarketProductUrl(productUrl + '&skuId=987654')).toBe('https://item.taobao.com/item.htm?id=123456789&skuId=987654');
    expect(beadMarketProductUrl('https://detail.1688.com/offer/123456789.html?spm=tracking')).toBe('https://detail.1688.com/offer/123456789.html');
    expect(beadMarketProductUrl('https://mobile.yangkeduo.com/goods2.html?goods_id=123456789&sku_id=789456')).toBe('https://mobile.yangkeduo.com/goods2.html?goods_id=123456789&sku_id=789456');
    for (const url of ['https://s.taobao.com/search?q=拼豆', 'https://e.tb.cn/h.example', 'https://item.taobao.com.evil.example/item.htm?id=123456789', 'https://127.0.0.1/goods.html?goods_id=123456789', 'http://item.taobao.com/item.htm?id=123456789', 'https://secret@item.taobao.com/item.htm?id=123456789']) expect(() => beadMarketProductUrl(url)).toThrow();
    expect(classifyBeadMarketUrl('https://s.taobao.com/search?q=拼豆')).toEqual({ platform: 'taobao', kind: 'search' });
  });
  it('接受多条官方分享文本，拒绝夹带搜索页或外站；多色只泛搜不制造AND色号查询', () => {
    expect(extractBeadMarketLinks(`【淘宝】https://e.tb.cn/h.example 点击购买\n${productUrl}`)).toEqual(['https://e.tb.cn/h.example', 'https://item.taobao.com/item.htm?id=123456789']);
    expect(() => extractBeadMarketLinks(productUrl + '\nhttps://evil.example/price')).toThrow(/非官方/);
    expect(() => extractBeadMarketLinks('https://s.1688.com/selloffer/offer_search.htm?keywords=拼豆')).toThrow(/搜索页/);
    const generic = new URL(beadMarketSearchUrl('taobao', { brand: 'MARD', diameterMm: '2.6' }, ['H1', 'H2'])).searchParams.get('q');
    expect(generic).toContain('MARD'); expect(generic).not.toContain('H1');
    expect(new URL(beadMarketSearchUrl('taobao', { brand: 'MARD' }, ['H1'])).searchParams.get('q')).toContain('H1');
  });
  it('从实际HTML结构化数据保留价格与规格出处，但仍标候选而不伪造已核实状态', () => {
    const result = parseBeadMarketPage({ platform: 'taobao', url: 'https://s.taobao.com/search?q=拼豆', html: html(product()), capturedAt: '2026-11-08T02:00:00Z' });
    expect(result.status).toBe('complete'); expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ url: 'https://item.taobao.com/item.htm?id=123456789', brand: 'MARD', code: 'H1', diameterMm: '2.6', packCount: 1000, priceCents: 150, verification: 'candidate', priceKind: 'regular' });
    expect(result.offers[0].shippingCents).toBeUndefined(); expect(result.offers[0].evidence).toMatchObject({ kind: 'page', capturedAt: '2026-11-08T02:00:00Z' });
  });
  it('聚合最低价、多个SKU、外币都不当作所选规格人民币单价', () => {
    for (const offers of [{ '@type': 'AggregateOffer', lowPrice: '0.01', highPrice: '30', priceCurrency: 'CNY' }, [{ price: '1', priceCurrency: 'CNY' }, { price: '10', priceCurrency: 'CNY' }]]) {
      const offer = offerFromProduct({ platform: 'taobao', url: productUrl, structured: product({ offers }) }); expect(offer.priceKind).toBe('range'); expect(offer.priceCents).toBeUndefined();
    }
    expect(offerFromProduct({ platform: 'taobao', url: productUrl, structured: product({ offers: { priceCurrency: 'USD', price: '1' } }) }).priceCents).toBeUndefined();
    for (const priceText of ['¥1.50起', '1.50～3.00元']) expect(offerFromProduct({ platform: 'taobao', url: productUrl, priceText })).toMatchObject({ priceKind: 'range', priceCents: undefined });
    expect(offerFromProduct({ platform: 'taobao', url: productUrl, priceText: '¥1.50' })).toMatchObject({ priceKind: 'regular', priceCents: 150 });
  });
  it('同款不是原厂、重量不猜粒数、条件优惠不默认可用、未知运费不当零', () => {
    const offer = offerFromProduct({ platform: 'taobao', url: productUrl, title: 'MARD同款100克', text: '品牌：MARD同款\n包装重量：100克\n珠径：2.6mm\n色号：H1\n单价：1.20元\n新人专享' });
    expect(offer.brand).toBe(''); expect(offer.compatibleWith).toBe('MARD'); expect(offer.packCount).toBeUndefined(); expect(offer.packWeightGrams).toBe('100'); expect(offer.priceKind).toBe('conditional'); expect(offer.conditionsAccepted).toBe(false); expect(offer.shippingCents).toBeUndefined();
    expect(offerFromProduct({ platform: 'taobao', url: productUrl, text: '运费：0元' }).shippingCents).toBe(0);
    expect(offerFromProduct({ platform: 'taobao', url: productUrl, title: '本商品包邮 MARD H1' }).shippingCents).toBeUndefined();
  });
  it('公开HTTP运费没有用户收货地核实，哪怕写0元也不作为个人运费保存', () => {
    const item = product(); item.additionalProperty.push({ name: '运费', value: '0元' });
    const result = parseBeadMarketPage({ platform: 'taobao', url: productUrl, html: html(item) }); expect(result.offers[0].shippingCents).toBeUndefined();
    expect(offerFromProduct({ platform: 'taobao', url: productUrl, text: '品牌：MARD\n运费：5元' }).shippingCents).toBe(500);
  });
  it('商品页登录遮挡和验证码返回明确状态，不伪造空白商品报价', () => {
    expect(parseBeadMarketPage({ platform: 'taobao', url: productUrl, html: '<body>请先登录 扫码登录</body>' }).status).toBe('needs-login');
    expect(parseBeadMarketPage({ platform: '1688', url: 'https://s.1688.com/selloffer/offer_search.htm', html: '<body>滑动验证</body>' }).status).toBe('restricted');
    expect(parseBeadMarketPage({ platform: 'pdd', url: 'https://mobile.yangkeduo.com/search_result.html', html: '<div>无搜索结果</div>' })).toMatchObject({ status: 'complete', offers: [] });
    expect(parseBeadMarketCapture({ platform: 'taobao', capture: { url: productUrl, state: 'restricted', products: [product()] } })).toMatchObject({ status: 'restricted', offers: [] });
  });
  it('下架和明确售罄商品不作为可购买候选，不能用HTTP200伪装链接可用', () => {
    expect(parseBeadMarketPage({ platform: 'taobao', url: productUrl, html: '<div>您查看的宝贝不存在</div>' })).toMatchObject({ status: 'failed', offers: [] });
    expect(parseBeadMarketPage({ platform: 'taobao', url: productUrl, html: html(product({ offers: { price: '1.50', priceCurrency: 'CNY', availability: 'https://schema.org/OutOfStock' } })) })).toMatchObject({ status: 'failed', offers: [] });
    expect(parseBeadMarketCapture({ platform: 'taobao', capture: { url: productUrl, state: 'unavailable' } })).toMatchObject({ status: 'failed', offers: [] });
  });
  it('会话HTTP适配器短链逐跳核验，禁止跨平台或私网跳转', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('', 302, { location: productUrl })).mockResolvedValueOnce(response(html(product())));
    const factory = vi.fn(() => ({ fetch })), service = createBeadMarketSources({ session: { fromPartition: factory } });
    const result = await service.details({ url: 'https://e.tb.cn/h.example' }); expect(result.offers[0].priceCents).toBe(150); expect(factory).toHaveBeenCalledWith('persist:bead-market-taobao'); expect(fetch).toHaveBeenCalledTimes(2);
    const blocked = vi.fn().mockResolvedValue(response('', 302, { location: 'http://127.0.0.1/private' })), bad = createBeadMarketSources({ fetchImpl: blocked }); expect((await bad.details({ url: productUrl })).status).toBe('failed'); expect(blocked).toHaveBeenCalledTimes(1); await service.shutdown(); await bad.shutdown();
  });
  it('最多2个并发，第三个排队，取消不触发排队网络请求', async () => {
    const pending = []; const fetch = vi.fn((_url, options) => new Promise((resolve, reject) => { pending.push(resolve); options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' }))); }));
    const service = createBeadMarketSources({ fetchImpl: fetch }), first = service.details({ url: productUrl }), second = service.details({ url: productUrl }), controller = new AbortController(), third = service.details({ url: productUrl, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(fetch).toHaveBeenCalledTimes(2); const rejected = expect(third).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected; pending[0](response(html(product()))); pending[1](response(html(product()))); await Promise.all([first, second]); expect(fetch).toHaveBeenCalledTimes(2); await service.shutdown();
  });
  it('限制真实响应体，网络失败不伪称需要登录', async () => {
    const large = createBeadMarketSources({ fetchImpl: async () => response('x'.repeat(1024)), maxBytes: 512 }); expect((await large.details({ url: productUrl })).status).toBe('failed'); await large.shutdown();
    const offline = createBeadMarketSources({ fetchImpl: async () => { throw Error('network unavailable'); } }); expect(await offline.details({ url: productUrl })).toMatchObject({ status: 'failed', offers: [] }); await offline.shutdown();
  });
  it('本地HTTP桩真实传输响应流，单独验证读取边界而不冒充平台实价', async () => {
    const server = createServer((_request, result) => { result.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); result.write('<html>'); result.end(html(product()) + '</html>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const local = `http://127.0.0.1:${server.address().port}`;
    const service = createBeadMarketSources({ fetchImpl: (_officialUrl, options) => fetch(local, options) });
    try { const result = await service.details({ url: productUrl }); expect(result.offers).toHaveLength(1); expect(result.offers[0].priceCents).toBe(150); }
    finally { await service.shutdown(); await new Promise(resolve => server.close(resolve)); }
  });
  it('无响应fetch也被硬超时结束，关闭不会永久等待', async () => {
    const service = createBeadMarketSources({ fetchImpl: () => new Promise(() => {}), timeoutMs: 100 }), started = Date.now();
    expect(await service.details({ url: productUrl })).toMatchObject({ status: 'failed', offers: [] }); expect(Date.now() - started).toBeLessThan(2000); await service.shutdown();
  });
  it('登录跳转票据不进入报价或查询记录，只保留最初固定搜索入口', async () => {
    const make = () => vi.fn().mockResolvedValueOnce(response('', 302, { location: 'https://login.taobao.com/member/login.jhtml?ticket=DO_NOT_PERSIST' })).mockResolvedValueOnce(response('<body>扫码登录</body>'));
    const service = createBeadMarketSources({ fetchImpl: make() }), detail = await service.details({ url: productUrl }); expect(detail.status).toBe('needs-login'); expect(detail.searchUrl).toBeUndefined(); expect(JSON.stringify(detail)).not.toContain('DO_NOT_PERSIST'); await service.shutdown();
    const search = createBeadMarketSources({ fetchImpl: make() }), result = await search.search({ platform: 'taobao', spec: { brand: 'MARD', diameterMm: '2.6' } }); expect(result.status).toBe('needs-login'); expect(result.searchUrl).toMatch(/^https:\/\/s\.taobao\.com\/search\?/); expect(JSON.stringify(result)).not.toContain('DO_NOT_PERSIST'); await search.shutdown();
  });
});
