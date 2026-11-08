// Read only visible product sections and public Product structured data. Never read cookies or page application state.
function beadMarketDomCapture() {
  const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const clean = (value, limit = 3000) => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit);
  const scrub = value => clean(value).replace(/(?:收货地址|收货人|账号昵称|账户名|手机号码|手机号)\s*[:：]?[^\n]{0,100}/g, '[个人信息未采集]').replace(/\b1[3-9]\d{9}\b/g, '[号码未采集]');
  const pageText = document.body?.innerText || '';
  let state = '';
  if (/验证码|滑动验证|访问过于频繁|访问受限|安全验证|验证后继续|异常流量/.test(pageText.slice(0, 6000))) state = 'restricted';
  else if (/请(?:先)?登录|登录后(?:查看|可见|继续)|扫码登录|手机扫码登录/.test(pageText.slice(0, 5000)) && /login|passport|signin/.test(location.href)) state = 'needs-login';
  const fields = ['[class*="ItemHeader--"]', '[class*="SkuContent--"]', '[class*="skuWrapper"]', '[class*="Price--"]', '#J_DetailMeta', '#sku', '.od-pc-offer-detail', '.detail-product', '.mod-detail-title', '.mod-detail-price', '.mod-detail-sku', '[class*="goods-detail-title"]', '[class*="goods-price"]', '[class*="sku-info"]', '[data-goods-property]'];
  const sections = [];
  for (const selector of fields) for (const element of document.querySelectorAll(selector)) if (visible(element)) { const value = scrub(element.innerText); if (value && !sections.includes(value)) sections.push(value); if (sections.length >= 24) break; }
  const text = sections.join('\n').slice(0, 12000);
  if (!state && /请(?:先)?登录|登录后(?:查看|可见|继续)|扫码登录|手机扫码登录/.test(pageText.slice(0, 5000)) && (!text || [...document.querySelectorAll('[role="dialog"],iframe[src*="login"],#login,.login-container')].some(visible))) state = 'needs-login';
  if (!state && /(?:商品|宝贝)(?:已|已经)?(?:下架|删除|不存在|失效)|您查看的宝贝不存在/.test(pageText.slice(0, 6000))) state = 'unavailable';
  const products = []; let visited = 0;
  function walk(value, depth) {
    if (!value || depth > 7 || visited++ > 1200) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 100)) walk(item, depth + 1); return; }
    if (typeof value !== 'object') return;
    if (/^(Product|ProductGroup)$/i.test(String(value['@type']))) {
      const copy = {};
      for (const key of ['@type', '@id', 'name', 'url', 'brand', 'color', 'sku', 'offers', 'additionalProperty', 'seller']) if (Object.hasOwn(value, key)) { const encoded = JSON.stringify(value[key]); if (encoded.length <= 30000) copy[key] = value[key]; }
      products.push(copy); if (Array.isArray(value.hasVariant)) walk(value.hasVariant, depth + 1); return;
    }
    for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasVariant']) if (Object.hasOwn(value, key)) walk(value[key], depth + 1);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) { if (script.textContent.length > 512000) continue; try { walk(JSON.parse(script.textContent), 0); } catch { /* A malformed script is not price evidence. */ } if (products.length >= 60) break; }
  const links = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    if (!visible(anchor)) continue; let url; try { url = new URL(anchor.getAttribute('href'), location.href); } catch { continue; }
    if (!/\/offer\/\d+\.html$|\/(?:item|detail)\.htm$|\/(?:goods|goods2)\.html$/.test(url.pathname)) continue;
    const card = anchor.closest('[data-item-id],[data-offer-id],.offer-card,.item-card,[class*="DoubleCard--"],[class*="goods-card"]') || anchor;
    const title = clean(anchor.getAttribute('title') || anchor.getAttribute('aria-label') || anchor.innerText || card.querySelector('img')?.getAttribute('alt'), 300);
    const priceElements = [...card.querySelectorAll('[class*="price"],[class*="Price"]')].filter(visible).map(element => clean(element.innerText, 100)).filter(Boolean), prices = [...new Set(priceElements)];
    if (title) links.push({ url: url.href, title, text: scrub(card.innerText), priceText: prices.length === 1 ? prices[0] : '' }); if (links.length >= 60) break;
  }
  return { url: location.href, title: clean(document.title, 300), text, products: products.slice(0, 60), links, state };
}
module.exports = { beadMarketDomCapture };
