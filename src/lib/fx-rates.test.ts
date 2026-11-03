import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FxRate } from '../billing-types';
const require = createRequire(import.meta.url);
const { parseRates, crossRate, createFxRateService, SOURCE } = require('../../electron/fx-rates.cjs') as {
  parseRates: (xml: string) => { date: string; rate: string }[];
  crossRate: (cny: string, usd: string) => string;
  SOURCE: string;
  createFxRateService: (options: { directory: string; fetchImpl: typeof fetch }) => { get: (at?: string) => Promise<FxRate | undefined>; refresh: (options?: { signal?: AbortSignal }) => Promise<boolean> };
};
const xml = `<Envelope><Cube><Cube time='2026-10-29'><Cube currency='USD' rate='1.113'/><Cube currency='CNY' rate='7.4144'/></Cube></Cube></Envelope>`;
describe('自动参考汇率', () => {
  it('退出时中断公共汇率请求并保留已知汇率，已取消的请求不会开始连接', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-fx-abort-'));
    let entered!: () => void, calls = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const service = createFxRateService({ directory, fetchImpl: async (_url, options) => {
      calls++; entered();
      return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } });
    const controller = new AbortController(), pending = service.refresh({ signal: controller.signal });
    await started; controller.abort(); expect(await pending).toBe(false);
    expect((await service.get('2026-10-30'))?.rate).toBe('6.661635220126');
    expect(await service.refresh({ signal: controller.signal })).toBe(false); expect(calls).toBe(1);
  });
  it('按同一公布日的EUR交叉计算，保留12位精度', () => {
    expect(crossRate('7.4144', '1.113')).toBe('6.661635220126');
    expect(parseRates(xml)).toEqual([{ date: '2026-10-29', rate: '6.661635220126' }]);
    expect(() => parseRates('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///private">]>' + xml)).toThrow();
    expect(() => parseRates('<Envelope/>')).toThrow();
    expect(() => parseRates(' '.repeat(128 * 1024 + 1))).toThrow();
  });
  it('网络失败保留带原日期来源的已核实汇率，不伪造今天汇率', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-fx-'));
    let calls = 0;
    const service = createFxRateService({ directory, fetchImpl: async () => { calls++; throw new Error('offline'); } });
    expect(await service.refresh()).toBe(false);
    expect(await service.get('2026-10-30T03:59:09Z')).toMatchObject({ rate: '6.661635220126', date: '2026-10-29', kind: 'reference', source: SOURCE });
    expect(await service.get('2000-01-01')).toBeUndefined();
    expect(calls).toBe(1);
  });
  it('仅请求固定公共地址，不发送认证，缓存原子保存并且同一时刻复用请求', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-fx-'));
    let calls = 0;
    const service = createFxRateService({ directory, fetchImpl: async (url, options) => {
      expect(url).toBe(SOURCE); expect(options?.redirect).toBe('error'); expect(options?.headers).toBeUndefined(); calls++;
      return new Response(xml, { status: 200 });
    } });
    expect(await Promise.all([service.refresh(), service.refresh()])).toEqual([true, true]);
    expect(calls).toBe(1);
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'fx-rates-v1.json'), 'utf8'));
    expect(saved).toMatchObject({ version: 1, source: SOURCE });
    expect(saved.rates[0]).toEqual({ date: '2026-10-29', rate: '6.661635220126' });
  });
  it('官方同日修订的新数据覆盖旧缓存', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-fx-'));
    const service = createFxRateService({ directory, fetchImpl: async () => new Response(xml.replace("rate='7.4144'", "rate='7.792'")) });
    await service.refresh();
    expect((await service.get('2026-10-30'))?.rate).toBe(crossRate('7.792', '1.113'));
  });
});
