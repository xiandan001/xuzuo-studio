import { describe, expect, it } from 'vitest';
import { businessReplacementSelection } from './business-output-selection';
import type { BusinessOrder } from '../business-types';
import type { ArtifactMetadata } from '../live-types';

describe('精修成品只替换对应SKU，保留同组其他尺寸', () => {
  const order = { outputIds: ['a', 'a-tall', 'b', 'b-tall'], tasks: [{ id: 'sku-a', projectId: 'shared', operation: 'compose', artifactIds: ['a', 'a-tall'] }, { id: 'sku-b', projectId: 'shared', operation: 'compose', artifactIds: ['b', 'b-tall'] }] } as BusinessOrder;
  const png = { id: 'b-new', kind: 'image', mimeType: 'image/png' } as ArtifactMetadata;
  it('同一源项目的第二款商品不会被归到第一款任务', () => {
    const before = JSON.stringify(order);
    expect(businessReplacementSelection(order, 'b', [png, { id: 'private-json', kind: 'other', mimeType: 'application/json' } as ArtifactMetadata])).toEqual({ taskId: 'sku-b', ids: ['b-tall', 'b-new'] });
    expect(JSON.stringify(order)).toBe(before);
  });
  it('没有实际PNG时不采用JSON或改写原正式文件', () => {
    expect(businessReplacementSelection(order, 'b', [{ id: 'json', kind: 'other', mimeType: 'application/json' } as ArtifactMetadata])).toBeUndefined();
    expect(businessReplacementSelection(order, 'b', [{ ...png, unavailable: true }])).toBeUndefined();
  });
});
