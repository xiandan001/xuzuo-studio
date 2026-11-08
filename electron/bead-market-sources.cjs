const { CONFIG, classifyBeadMarketUrl, beadMarketProductUrl, extractBeadMarketLinks, beadMarketSearchUrl, platformForUrl, sourceRequestUrl } = require('./bead-market-sources-url.cjs');
const { parseBeadMarketPage } = require('./bead-market-sources-parser.cjs');

const cancelled = () => Object.assign(Error('材料查询已取消，已有报价仍保留。'), { name: 'AbortError' });
function raceAbort(task, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled()); if (signal.aborted) { reject(cancelled()); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(task).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined);
  });
}
function createBeadMarketSources({ session, fetchImpl, clock = () => Date.now(), timeoutMs = 10000, maxBytes = 2 * 1024 * 1024 } = {}) {
  let running = 0, closing = false; const pending = [], tasks = new Set(), controllers = new Set();
  function fetchFor(platform) { if (fetchImpl) return fetchImpl; const scoped = session?.fromPartition(`persist:bead-market-${platform}`); if (!scoped?.fetch) throw Error('当前环境未接通平台查询，请使用新版桌面应用。'); return (url, options) => scoped.fetch(url, options); }
  function schedule(operation, signal) {
    if (closing) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const queued = { resolve, reject, operation, signal, abort: () => { const at = pending.indexOf(queued); if (at >= 0) pending.splice(at, 1); reject(cancelled()); } };
      if (signal?.aborted) { reject(cancelled()); return; } signal?.addEventListener('abort', queued.abort, { once: true }); pending.push(queued); pump();
    });
  }
  function pump() { while (running < 2 && pending.length && !closing) { const next = pending.shift(); next.signal?.removeEventListener('abort', next.abort); if (next.signal?.aborted) { next.reject(cancelled()); continue; } running++; const task = Promise.resolve().then(next.operation); tasks.add(task); task.then(next.resolve, next.reject).finally(() => { tasks.delete(task); running--; pump(); }).catch(() => undefined); } }
  async function read(url, platform, outerSignal) {
    const controller = new AbortController(); controllers.add(controller); const abort = () => controller.abort(); if (outerSignal?.aborted) abort(); else outerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(100, Math.min(20000, timeoutMs))); timer.unref?.();
    const capturedAt = new Date(clock()).toISOString(); let current = sourceRequestUrl(url, platform).url;
    try {
      const fetch = fetchFor(platform);
      for (let redirect = 0; redirect <= 4; redirect++) {
        if (controller.signal.aborted) throw cancelled();
        const response = await raceAbort(fetch(current, { method: 'GET', redirect: 'manual', credentials: 'include', signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,application/json;q=0.7', 'Accept-Language': 'zh-CN,zh;q=0.9' } }), controller.signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location'); await response.body?.cancel(); if (!location || redirect === 4) throw Error('平台跳转次数过多，请打开商品页核对。');
          current = sourceRequestUrl(new URL(location, current).href, platform).url; continue;
        }
        const length = Number(response.headers.get('content-length')); if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel(); throw Error('平台页面超过安全读取容量，请打开商品页后采集。'); }
        const type = response.headers.get('content-type') || ''; if (type && !/text\/html|application\/(?:xhtml\+xml|json)|text\/plain/i.test(type)) { await response.body?.cancel(); throw Error('此来源没有返回可读取的商品页面。'); }
        let total = 0; const chunks = [];
        if (response.body) { const iterator = response.body[Symbol.asyncIterator](); while (true) { const item = await raceAbort(iterator.next(), controller.signal); if (item.done) break; const chunk = item.value; total += chunk.length; if (total > maxBytes) { controller.abort(); throw Error('平台页面超过安全读取容量，请打开商品页后采集。'); } chunks.push(Buffer.from(chunk)); } }
        if (controller.signal.aborted) throw cancelled();
        const bytes = Buffer.concat(chunks), charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1];
        let html; try { html = new TextDecoder(/^(?:gbk|gb2312|gb18030)$/i.test(charset || '') ? 'gb18030' : 'utf-8').decode(bytes); } catch { html = bytes.toString('utf8'); }
        const { searchUrl: _finalLocation, ...result } = parseBeadMarketPage({ platform, url: current, html, capturedAt, statusCode: response.status });
        return { ...result, ...(classifyBeadMarketUrl(url)?.kind === 'search' ? { searchUrl: url } : {}) };
      }
      throw Error('商品地址暂时无法读取。');
    } catch (error) {
      if (outerSignal?.aborted || closing) throw cancelled();
      return { platform, status: 'failed', message: controller.signal.aborted ? '平台查询超时，未取得可核实价格；可打开平台或导入商品资料。' : error?.message && !/https?:\/\//.test(error.message) ? error.message.slice(0, 250) : '平台连接失败，尚未取得真实价格；可稍后重试或导入资料。', searchUrl: classifyBeadMarketUrl(url)?.kind === 'search' ? url : undefined, offers: [], capturedAt };
    } finally { clearTimeout(timer); controllers.delete(controller); outerSignal?.removeEventListener('abort', abort); }
  }
  const api = {
    search({ platform, spec, codes = [], signal } = {}) { if (!Object.hasOwn(CONFIG, platform)) return Promise.reject(Error('请选择1688、淘宝或拼多多。')); const url = beadMarketSearchUrl(platform, spec, codes); return schedule(() => read(url, platform, signal), signal); },
    details({ url, signal } = {}) { const platform = platformForUrl(url); if (!platform) return Promise.reject(Error('请选择三个平台的官方商品链接。')); const classification = classifyBeadMarketUrl(url); if (classification && !['product', 'share'].includes(classification.kind)) return Promise.reject(Error('搜索页和登录页不能作为购买链接。')); const allowed = extractBeadMarketLinks(url); if (allowed.length !== 1) return Promise.reject(Error('请提供单个商品详情或官方分享链接。')); return schedule(() => read(allowed[0], platform, signal), signal); },
    async drain() { while (tasks.size || pending.length) { if (tasks.size) await Promise.allSettled([...tasks]); else await new Promise(resolve => setTimeout(resolve, 0)); } },
    async prepareClose() { for (const controller of controllers) controller.abort(); for (const queued of pending.splice(0)) { queued.signal?.removeEventListener('abort', queued.abort); queued.reject(cancelled()); } await api.drain(); },
    async shutdown() { closing = true; await api.prepareClose(); },
  };
  return api;
}
module.exports = { createBeadMarketSources, classifyBeadMarketUrl, beadMarketProductUrl, extractBeadMarketLinks, beadMarketSearchUrl, sourceRequestUrl, platformForUrl };
