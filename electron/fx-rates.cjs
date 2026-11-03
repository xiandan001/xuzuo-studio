const fs = require('node:fs/promises');
const path = require('node:path');
const seed = require('./fx-rates-seed.json');
const SOURCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const valid = item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && /^\d+(?:\.\d{1,12})?$/.test(item.rate) && Number(item.rate) > 0 && Number(item.rate) < 100;
function scaled(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
}
function crossRate(cny, usd) {
  const scale = 1_000_000_000_000n;
  const value = (scaled(cny) * scale + scaled(usd) / 2n) / scaled(usd);
  return `${value / scale}.${String(value % scale).padStart(12, '0')}`.replace(/0+$/, '').replace(/\.$/, '');
}
function parseRates(xml) {
  if (typeof xml !== 'string' || xml.length > 128 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('汇率响应格式无效。');
  const result = [];
  for (const day of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const rates = {};
    for (const rate of day[2].matchAll(/<Cube\s+currency=['"](USD|CNY)['"]\s+rate=['"](\d+(?:\.\d{1,12})?)['"]\s*\/>/g)) rates[rate[1]] = rate[2];
    if (!rates.USD || !rates.CNY || Number(rates.USD) <= 0) continue;
    const item = { date: day[1], rate: crossRate(rates.CNY, rates.USD) };
    if (valid(item)) result.push(item);
  }
  if (!result.length) throw new Error('汇率响应没有可用的 USD/CNY 数据。');
  return result.sort((a, b) => b.date.localeCompare(a.date));
}
function createFxRateService({ directory, fetchImpl = fetch, fileSystem = fs, timeoutMs = 8000 } = {}) {
  const filename = path.join(directory, 'fx-rates-v1.json');
  let rates = seed.rates.filter(valid), pending;
  const ready = fileSystem.readFile(filename, 'utf8').then(text => {
    const cached = JSON.parse(text);
    if (cached.version === 1 && cached.source === SOURCE && Array.isArray(cached.rates)) rates = [...cached.rates.filter(valid), ...rates].sort((a, b) => b.date.localeCompare(a.date));
  }).catch(() => undefined);
  const current = at => {
    const date = (at || new Date().toISOString()).slice(0, 10);
    const item = rates.find(rate => rate.date <= date);
    return item ? { base: 'USD', quote: 'CNY', rate: item.rate, date: item.date, source: SOURCE, kind: 'reference' } : undefined;
  };
  return {
    current,
    async refresh({ signal } = {}) {
      if (signal?.aborted) return false;
      if (pending) return pending;
      pending = (async () => {
        await ready;
        const controller = new AbortController();
        const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
        try {
          const response = await fetchImpl(SOURCE, { signal: controller.signal, redirect: 'error' });
          if (!response.ok || Number(response.headers?.get('content-length')) > 128 * 1024) throw new Error('汇率服务暂不可用。');
          let xml = '';
          if (response.body?.getReader) {
            const reader = response.body.getReader(); let bytes = 0; const chunks = [];
            try {
              for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 128 * 1024) { await reader.cancel(); throw new Error('汇率响应过大。'); } chunks.push(Buffer.from(item.value)); }
              xml = Buffer.concat(chunks).toString('utf8');
            } finally { reader.releaseLock(); }
          } else xml = await response.text();
          const incoming = parseRates(xml);
          rates = [...new Map([...rates, ...incoming].map(item => [item.date, item])).values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
          await fileSystem.mkdir(directory, { recursive: true });
          const temporary = `${filename}.tmp`;
          await fileSystem.writeFile(temporary, `${JSON.stringify({ version: 1, source: SOURCE, rates })}\n`, 'utf8');
          await fileSystem.rename(temporary, filename);
          return true;
        } catch { return false; } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      })().finally(() => { pending = undefined; });
      return pending;
    },
    async get(at) { await ready; return current(at); },
  };
}
module.exports = { createFxRateService, parseRates, crossRate, SOURCE };
