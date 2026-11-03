import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG, catalogConnectionDraft, catalogModelDraft } from '../model-catalog';
import { automaticBillingEntry } from './catalog-billing';
import type { ModelConnection } from '../configuration-types';

describe('官方自动计费展示绑定', () => {
  const entry = MODEL_CATALOG.find(item => item.support.ready)!;
  const connection: ModelConnection = { ...catalogConnectionDraft(entry), id: 'official', status: 'configured' };
  const model = catalogModelDraft(entry, connection);
  it('仅已适配、型号、核对日期和官方连接同时匹配时显示自动计费', () => {
    expect(automaticBillingEntry(model, [connection])?.id).toBe(entry.id);
    expect(automaticBillingEntry({ ...model, modelId: 'manual-model-id' }, [connection])).toBeUndefined();
    expect(automaticBillingEntry({ ...model, pricing: { ...model.pricing, verifiedAt: '2026-10-29' } }, [connection])).toBeUndefined();
    expect(automaticBillingEntry({ ...model, pricing: { ...model.pricing, officialUrl: undefined } }, [connection])).toBeUndefined();
    expect(automaticBillingEntry(model, [{ ...connection, baseUrl: 'https://proxy.example/v1' }])).toBeUndefined();
    expect(automaticBillingEntry(model, [{ ...connection, baseUrl: connection.baseUrl.replace('https://', 'https://').replace('/v1', ':8443/v1') }])).toBeUndefined();
  });
});
