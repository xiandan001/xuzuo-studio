const { createHash } = require('node:crypto');
const { beadMarketProductUrl, classifyBeadMarketUrl } = require('./bead-market-sources-url.cjs');
const clean = (value, maximum = 1000) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
function decode(value) { return String(value || '').replace(/&#(x[\da-f]+|\d+);?/gi, (_all, number) => { const n = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' '); }
const textOf = value => clean(decode(String(value || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')), 12000);
function cents(value) { const text = String(value ?? '').trim(); if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return; const [whole, fraction = ''] = text.split('.'); const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0')); return result > 0 && Number.isSafeInteger(result) ? result : undefined; }
const unique = list => [...new Set(list.filter(Boolean))];
function labeled(text, labels, limit = 100) { const match = new RegExp('(?:' + labels + ')\\s*[:：]\\s*([^|;；\\n]{1,' + limit + '})', 'i').exec(text); return match ? clean(match[1], limit) : ''; }
function factsFromText(text) {
  const dimensions = unique([...text.matchAll(/(?:^|[^\d.])(\d{1,2}(?:\.\d{1,2})?)\s*(?:mm|毫米)/gi)].map(match => match[1]));
  const packs = unique([...text.matchAll(/(?:每(?:包|袋|瓶)|包装(?:数量|规格)|数量|含量)\s*[:：]?\s*(\d{1,7})\s*(?:粒|颗)/g)].map(match => Number(match[1])));
  if (!packs.length) for (const match of text.matchAll(/(\d{1,7})\s*(?:粒|颗)\s*(?:\/|每)?\s*(?:包|袋|瓶)(?!装?起)/g)) packs.push(Number(match[1]));
  const colors = unique([...text.matchAll(/(?:色号|颜色编号|颜色分类|色彩编号|color\s*code)\s*[:：]?\s*([A-Za-z]{1,4}\d{1,4})(?![A-Za-z\d])/gi)].map(match => match[1].toUpperCase()));
  const prices = unique([...text.matchAll(/(?:所选(?:规格|SKU)?(?:价格)?|当前(?:规格)?价格|单价|售价|价格)\s*[:：]\s*[¥￥]?\s*(\d{1,7}(?:\.\d{1,2})?)(?![\d.])/gi)].map(match => cents(match[1])));
  const brand = labeled(text, '品牌', 60), compatible = /(?:MARD|Artkal)\s*(?:同款|通用|兼容)/i.exec(text);
  const freight = /(?:运费|快递费)\s*[:：]\s*[¥￥]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元?/.exec(text), free = /(?:运费|快递费)\s*[:：]\s*(?:免运费|包邮|免费)/.test(text);
  const minimum = /(?:起订(?:量)?|最低(?:购买|采购)(?:量)?)\s*[:：]?\s*(\d{1,5})\s*(?:包|袋|瓶)/.exec(text), weight = /(?:每(?:包|袋|瓶)|包装(?:重量|规格))\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*(?:g|克)/i.exec(text);
  const conditions = unique([...text.matchAll(/(?:券后|新人专享|首单|会员专享|拼单|返现|需凑单|满\d+[^，。;；]{0,24})/g)].map(match => match[0]));
  const explicitZero = freight && /^0(?:\.0{1,2})?$/.test(freight[1]);
  return { brand: /同款|兼容|通用/.test(brand) ? '' : brand, compatibleWith: compatible ? /mard/i.test(compatible[0]) ? 'MARD' : 'Artkal' : undefined,
    series: labeled(text, '系列', 60), diameterMm: dimensions.length === 1 && Number(dimensions[0]) > 0 && Number(dimensions[0]) <= 20 ? dimensions[0] : '', code: colors.length === 1 ? colors[0] : '',
    beadKind: /(?:材质|类型|豆子类型)\s*[:：]\s*透明/.test(text) ? 'transparent' : /(?:珠光|夜光|金属|闪粉)/.test(text) ? 'special' : 'solid',
    packCount: unique(packs).length === 1 && packs[0] > 0 ? packs[0] : undefined, packWeightGrams: weight && Number(weight[1]) > 0 ? weight[1] : undefined, priceCents: prices.length === 1 ? prices[0] : undefined,
    shippingCents: explicitZero || free ? 0 : freight ? cents(freight[1]) : undefined, minPacks: minimum ? Math.max(1, Number(minimum[1])) : 1, conditions };
}
function offerFromProduct({ platform, url, title, text = '', priceText = '', structured, capturedAt = new Date().toISOString() }) {
  let canonical; try { canonical = beadMarketProductUrl(url); if (classifyBeadMarketUrl(canonical).platform !== platform) return; } catch { return; }
  const content = String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 12000), raw = structured && typeof structured === 'object' ? structured : {};
  const properties = Array.isArray(raw.additionalProperty) ? raw.additionalProperty.slice(0, 50) : [];
  const extra = properties.map(item => clean(item?.name, 80) + '：' + clean(String(item?.value ?? ''), 300)).join('\n');
  const visiblePrice = typeof priceText === 'string' && /^\s*[¥￥]?\s*\d{1,7}(?:\.\d{1,2})?\s*(?:元|起|[-~～—至]\s*[¥￥]?\s*\d{1,7}(?:\.\d{1,2})?\s*元?)?\s*$/.test(priceText) ? `页面价格：${priceText.trim()}` : '';
  const factsText = [extra, content, visiblePrice, clean(title || raw.name, 300)].filter(Boolean).join('\n'), facts = factsFromText(factsText);
  const rawBrand = clean(typeof raw.brand === 'object' ? raw.brand?.name : raw.brand, 100); if (rawBrand && !/同款|兼容|通用/.test(rawBrand)) facts.brand = rawBrand;
  if (!facts.code && typeof raw.color === 'string') { const color = /^([A-Za-z]{1,4}\d{1,4})(?:\b|[^A-Za-z\d])/.exec(raw.color); if (color) facts.code = color[1].toUpperCase(); }
  const offers = Array.isArray(raw.offers) ? raw.offers : raw.offers ? [raw.offers] : [], selected = offers.length === 1 ? offers[0] : undefined;
  if (selected && /OutOfStock|Discontinued|SoldOut/i.test(String(selected.availability || ''))) return;
  let priceKind = facts.conditions.length ? 'conditional' : facts.priceCents === undefined ? 'unknown' : 'regular';
  if (selected) {
    const kind = String(selected['@type'] || ''), currency = String(selected.priceCurrency || '').toUpperCase();
    if (/AggregateOffer/i.test(kind) || selected.lowPrice !== undefined || selected.highPrice !== undefined) { priceKind = 'range'; facts.priceCents = undefined; }
    else if (['CNY', 'RMB'].includes(currency)) { const price = cents(selected.price); if (price !== undefined) { facts.priceCents = price; if (priceKind === 'unknown') priceKind = 'regular'; } }
  }
  if (offers.length > 1) { priceKind = 'range'; facts.priceCents = undefined; }
  if (/(?:价格|售价|单价)\s*[:：]\s*[¥￥]?\s*\d+(?:\.\d{1,2})?\s*(?:元?起|[-~～—至]\s*[¥￥]?\s*\d)/.test(factsText)) { priceKind = 'range'; facts.priceCents = undefined; }
  const sellerName = clean(selected?.seller?.name || raw.seller?.name || labeled(content, '店铺名称|店铺|卖家', 100), 160), sellerUrl = selected?.seller?.url || raw.seller?.url;
  const sellerId = typeof sellerUrl === 'string' && /^https:\/\//i.test(sellerUrl) ? createHash('sha256').update(sellerUrl).digest('hex').slice(0, 24) : '';
  const snippet = [clean(title || raw.name, 300), extra, content, visiblePrice].filter(Boolean).join('\n').slice(0, 12000);
  const sha256 = createHash('sha256').update(snippet).digest('hex'), id = createHash('sha256').update([platform, canonical, facts.code, facts.packCount || '', facts.diameterMm].join('|')).digest('hex').slice(0, 32);
  return { id, platform, url: canonical, title: clean(title || raw.name || '待核对商品', 300), sellerId, sellerName, ...facts, priceKind, tiers: [], conditionsAccepted: false, verification: 'candidate', evidence: { kind: 'page', capturedAt, url: canonical, sha256, text: snippet } };
}
function structuredProducts(html) {
  const result = [], seen = new Set(); let visited = 0;
  function walk(value, depth) { if (!value || depth > 7 || visited++ > 1500) return; if (Array.isArray(value)) { for (const item of value.slice(0, 200)) walk(item, depth + 1); return; } if (typeof value !== 'object') return;
    if (/^(?:Product|ProductGroup)$/i.test(String(value['@type']))) { result.push(value); if (Array.isArray(value.hasVariant)) walk(value.hasVariant, depth + 1); return; }
    for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasVariant']) if (Object.hasOwn(value, key)) walk(value[key], depth + 1);
  }
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) { if (match[1].length > 512000 || seen.has(match[1])) continue; seen.add(match[1]); try { walk(JSON.parse(match[1]), 0); } catch { /* Invalid structured data is not a quote. */ } }
  return result.slice(0, 100);
}
function parseBeadMarketPage({ platform, url, html, capturedAt = new Date().toISOString(), statusCode = 200 }) {
  const text = textOf(html), productPage = classifyBeadMarketUrl(url)?.kind === 'product';
  if (statusCode === 401 || classifyBeadMarketUrl(url)?.kind === 'login' || /请(?:先)?登录|登录后(?:查看|可见|继续)|扫码登录|手机扫码登录/.test(text) && !structuredProducts(html).length) return { platform, status: 'needs-login', message: '平台要求登录后查看，请打开平台完成登录，再采集所选规格。', searchUrl: productPage ? undefined : url, offers: [], capturedAt };
  if ([403, 429].includes(statusCode) || /验证码|滑动验证|访问过于频繁|访问受限|安全验证|验证后继续|异常流量/.test(text)) return { platform, status: 'restricted', message: '平台要求人工验证或暂时限制访问；可打开平台核对，不会自动绕过验证。', searchUrl: productPage ? undefined : url, offers: [], capturedAt };
  if (statusCode < 200 || statusCode >= 300) return { platform, status: 'failed', message: `平台返回HTTP ${statusCode}，尚未取得可核实商品。`, offers: [], capturedAt };
  if (productPage && /(?:商品|宝贝)(?:已|已经)?(?:下架|删除|不存在|失效)|您查看的宝贝不存在/.test(text)) return { platform, status: 'failed', message: '当前商品已下架或不可购买，请更换商品链接。', offers: [], capturedAt };
  const products = structuredProducts(html);
  if (productPage && products.length && products.every(product => { const list = Array.isArray(product.offers) ? product.offers : product.offers ? [product.offers] : []; return list.length && list.every(offer => /OutOfStock|Discontinued|SoldOut/i.test(String(offer.availability || ''))); })) return { platform, status: 'failed', message: '页面标注该商品已售罄或停售，请核对其他规格或商品。', offers: [], capturedAt };
  const candidates = [];
  for (const product of products) { let link = product.url || product['@id'] || (productPage ? url : undefined); if (link && typeof link === 'object') link = link['@id']; if (typeof link !== 'string') continue; try { link = new URL(decode(link), url).href; } catch { continue; } const offer = offerFromProduct({ platform, url: link, title: product.name, structured: product, text: '', capturedAt }); if (offer) candidates.push(offer); }
  for (const anchor of String(html).matchAll(/<a\b([^>]*?href\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    if (candidates.length >= 100) break; let link; try { link = new URL(decode(anchor[2]), url).href; } catch { continue; }
    const titleMatch = /(?:title|aria-label)\s*=\s*["']([^"']*)["']/i.exec(anchor[1]), card = textOf(anchor[3]), title = decode(titleMatch?.[1] || card); if (!title || title.length < 3) continue;
    const offer = offerFromProduct({ platform, url: link, title, text: card, capturedAt }); if (offer) candidates.push(offer);
  }
  if (productPage && !candidates.length) { const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '待核对商品'; candidates.push(offerFromProduct({ platform, url, title: textOf(title), text: '', capturedAt })); }
  const offers = [...new Map(candidates.filter(Boolean).map(offer => [offer.id, offer])).values()].slice(0, 60).map(offer => { const { shippingCents: _publicFreight, freeShippingAboveCents: _publicThreshold, ...unverified } = offer; return unverified; });
  if (offers.length) return { platform, status: 'complete', message: `找到${offers.length}个真实商品链接，规格与价格须在采购表核对。`, searchUrl: productPage ? undefined : url, offers, capturedAt };
  if (/没有(?:找到|搜索到)|暂无(?:相关商品|搜索结果)|无搜索结果/.test(text)) return { platform, status: 'complete', message: '当前关键词没有找到可读取的商品。', searchUrl: url, offers: [], capturedAt };
  return { platform, status: 'restricted', message: '公开页面未提供可核实商品数据，可打开平台选规格后采集，或导入链接、截图、报价表。', searchUrl: url, offers: [], capturedAt };
}
function parseBeadMarketCapture({ platform, capture, capturedAt = new Date().toISOString() }) {
  if (!capture || typeof capture.url !== 'string') throw Error('未读取到平台商品页面，请重新打开。');
  if (capture.state === 'unavailable') return { platform, status: 'failed', message: '页面标注当前商品已下架或不可购买，请更换商品。', offers: [], capturedAt };
  if (['restricted', 'needs-login'].includes(capture.state)) return { platform, status: capture.state, message: capture.state === 'needs-login' ? '请先在平台窗口完成登录，再采集商品。' : '请自行完成平台验证，再选择商品规格并采集。', offers: [], capturedAt };
  const offers = [];
  for (const product of (Array.isArray(capture.products) ? capture.products : []).slice(0, 60)) {
    const link = typeof product.url === 'string' ? product.url : typeof product['@id'] === 'string' ? product['@id'] : capture.url;
    const offer = offerFromProduct({ platform, url: link, title: product.name, structured: product, text: link === capture.url ? capture.text : '', capturedAt }); if (offer) offers.push(offer);
  }
  if (classifyBeadMarketUrl(capture.url)?.kind === 'product') { const offer = offerFromProduct({ platform, url: capture.url, title: capture.title, text: capture.text, capturedAt }); if (offer) offers.push(offer); }
  for (const link of (Array.isArray(capture.links) ? capture.links : []).slice(0, 60)) { const offer = offerFromProduct({ platform, ...link, capturedAt }); if (offer) offers.push(offer); }
  const uniqueOffers = [...new Map(offers.map(offer => [offer.id, offer])).values()];
  return { platform, status: uniqueOffers.length ? 'complete' : 'restricted', message: uniqueOffers.length ? `已采集${uniqueOffers.length}个商品候选，请回采购表核对色号、包装、价格与运费。` : '当前页没有可核对的商品数据。请打开具体商品、选择规格，或改用截图／报价表导入。', offers: uniqueOffers, capturedAt };
}
module.exports = { parseBeadMarketPage, parseBeadMarketCapture, offerFromProduct, structuredProducts, factsFromText, textOf, decode, cents };
