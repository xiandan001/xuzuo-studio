import { describe, expect, it } from 'vitest';
import type { ModelConnection } from '../configuration-types';
import { quickSetupConnections, quickSetupEntries, quickSetupSites } from './quick-model-setup';

describe('快速接入的型号和站点对应', () => {
  it('只提供已适配的新型号，保持所选站点，不将旧款或待适配型号充当推荐', () => {
    const sites = quickSetupSites('openai'); expect(sites.length).toBeGreaterThan(0);
    const entries = quickSetupEntries('openai', sites[0].value);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.support.ready && entry.status !== 'older' && entry.defaultBaseUrl === sites[0].value)).toBe(true);
    expect(quickSetupEntries('unknown')).toEqual([]);
    expect(quickSetupEntries('openai', 'https://different.test')).toEqual([]);
  });
  it('文字和图片可以复用同一官方连接；不覆盖或重复建立兼容的现有连接', () => {
    const entries = quickSetupEntries('openai'), text = entries.find(entry => entry.capabilities.includes('text'))!, image = entries.find(entry => entry.capabilities.includes('image-generation'))!;
    const fresh = quickSetupConnections([text, image], []);
    expect(fresh).toHaveLength(1); expect(fresh[0].create).toBe(true); expect(fresh[0].entries).toHaveLength(2);
    const existing = { ...fresh[0].connection, id: 'existing' };
    const reused = quickSetupConnections([text, image], [existing]);
    expect(reused).toHaveLength(1); expect(reused[0]).toMatchObject({ create: false, connection: { id: 'existing' } });
  });
  it('跨站点、停用及非官方连接不能复用；已有连接及条目不被更改', () => {
    const entry = quickSetupEntries('openai').find(item => item.capabilities.includes('text'))!;
    const connection = quickSetupConnections([entry], [])[0].connection;
    for (const change of [{ baseUrl: 'https://elsewhere.test/v1' }, { enabled: false }, { demo: true }, { protocol: 'image' }]) {
      const original = { ...connection, ...change } as ModelConnection, before = structuredClone(original);
      expect(quickSetupConnections([entry], [original])[0].create).toBe(true);
      expect(original).toEqual(before);
    }
  });
});
