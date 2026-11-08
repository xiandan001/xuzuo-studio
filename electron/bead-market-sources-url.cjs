const CONFIG = Object.freeze({
  '1688': { label: '1688', roots: ['1688.com', 'alibaba.com'], share: ['qr.1688.com'], search: 'https://s.1688.com/selloffer/offer_search.htm', parameter: 'keywords' },
  taobao: { label: '淘宝／天猫', roots: ['taobao.com', 'tmall.com', 'alibaba.com'], share: ['m.tb.cn', 'e.tb.cn'], search: 'https://s.taobao.com/search', parameter: 'q' },
  pdd: { label: '拼多多', roots: ['yangkeduo.com', 'pinduoduo.com'], share: ['p.pinduoduo.com'], search: 'https://mobile.yangkeduo.com/search_result.html', parameter: 'search_key' },
});
const under = (host, root) => host === root || host.endsWith('.' + root);
function parsed(value) {
  if (typeof value !== 'string' || value.length > 4000) return;
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || /[\r\n\u0000]/.test(value)) return; return url; } catch { return; }
}
function platformForUrl(value, preferred) {
  const url = parsed(value); if (!url) return;
  const ids = preferred ? [preferred] : ['1688', 'taobao', 'pdd'];
  for (const platform of ids) { const config = CONFIG[platform]; if (config && (config.roots.some(root => under(url.hostname, root)) || config.share.includes(url.hostname))) return platform; }
}
function classifyBeadMarketUrl(value) {
  const url = parsed(value), platform = platformForUrl(value); if (!url || !platform) return;
  if (/login|passport|signin|member\.1688\.com/i.test(url.hostname + url.pathname)) return { platform, kind: 'login' };
  if (platform === '1688' && under(url.hostname, '1688.com') && /^\/offer\/\d{5,24}\.html$/.test(url.pathname)) return { platform, kind: 'product' };
  if (platform === 'taobao' && ['item.taobao.com', 'detail.tmall.com', 'h5.m.taobao.com', 'item.m.taobao.com', 'detail.m.tmall.com'].includes(url.hostname) && /\/(?:item|detail)\.htm$/.test(url.pathname) && /^\d{5,24}$/.test(url.searchParams.get('id') || '')) return { platform, kind: 'product' };
  if (platform === 'pdd' && /^\/(?:goods|goods2)\.html$/.test(url.pathname) && /^\d{5,24}$/.test(url.searchParams.get('goods_id') || '')) return { platform, kind: 'product' };
  if (url.hostname === new URL(CONFIG[platform].search).hostname && url.pathname === new URL(CONFIG[platform].search).pathname) return { platform, kind: 'search' };
  if (CONFIG[platform].share.includes(url.hostname) || platform === 'pdd' && /\/short\.html$/.test(url.pathname)) return { platform, kind: 'share' };
}
function beadMarketProductUrl(value) {
  const kind = classifyBeadMarketUrl(value); if (kind?.kind !== 'product') throw Error('请使用1688、淘宝／天猫或拼多多的实际商品详情链接。');
  const source = parsed(value); let result;
  if (kind.platform === '1688') result = new URL('https://detail.1688.com' + source.pathname);
  else if (kind.platform === 'taobao') { result = new URL(under(source.hostname, 'tmall.com') ? 'https://detail.tmall.com/item.htm' : 'https://item.taobao.com/item.htm'); result.searchParams.set('id', source.searchParams.get('id')); }
  else { result = new URL('https://mobile.yangkeduo.com' + source.pathname); result.searchParams.set('goods_id', source.searchParams.get('goods_id')); }
  for (const key of ['skuId', 'sku_id']) { const value = source.searchParams.get(key); if (value && /^[A-Za-z0-9_-]{1,80}$/.test(value)) result.searchParams.set(key, value); }
  return result.href;
}
function sourceRequestUrl(value, preferred) {
  const platform = platformForUrl(value, preferred), url = parsed(value); if (!url || !platform) throw Error('来源仅支持三个平台的官方HTTPS页面。');
  if (preferred && platform !== preferred) throw Error('商品跳转到了另一个平台，未继续读取。');
  url.hash = ''; return { platform, url: url.href };
}
function extractBeadMarketLinks(text) {
  if (typeof text !== 'string' || text.length > 20000) throw Error('一次最多粘贴20条、20000字以内的商品链接。');
  const links = [...text.matchAll(/https?:\/\/[^\s<>"'“”）)]+/g)].map(match => match[0].replace(/[。，；、]+$/, ''));
  if (links.length > 20) throw Error('一次最多导入20条商品链接。');
  const result = [];
  for (const link of links) {
    const platform = platformForUrl(link), url = parsed(link); if (!platform || !url) throw Error('链接中包含非官方或不安全的地址，请保留三个平台的实际商品分享链接。');
    if (classifyBeadMarketUrl(link)?.kind === 'product') result.push(beadMarketProductUrl(link));
    else if (CONFIG[platform].share.includes(url.hostname) || platform === 'pdd' && /\/short\.html$/.test(url.pathname)) result.push(url.href);
    else throw Error('搜索页或登录页不能作为购买链接，请复制商品详情页或官方分享短链接。');
  }
  return [...new Set(result)];
}
function beadMarketSearchUrl(platform, spec, codes = []) {
  const config = Object.hasOwn(CONFIG, platform) && CONFIG[platform]; if (!config) throw Error('请选择1688、淘宝或拼多多。');
  const values = [spec?.brand, spec?.series, spec?.diameterMm ? spec.diameterMm + 'mm' : '', '拼豆 单色 补充包', ...(codes.length === 1 ? codes : [])].filter(value => typeof value === 'string' && value.trim());
  const url = new URL(config.search); url.searchParams.set(config.parameter, values.join(' ').slice(0, 180)); return url.href;
}
module.exports = { CONFIG, classifyBeadMarketUrl, beadMarketProductUrl, extractBeadMarketLinks, beadMarketSearchUrl, platformForUrl, sourceRequestUrl };
