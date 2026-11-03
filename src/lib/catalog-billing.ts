import type { ModelConfiguration, ModelConnection } from '../configuration-types';
import { MODEL_CATALOG, catalogConnectionMatches } from '../model-catalog';

export function automaticBillingEntry(model: Pick<ModelConfiguration, 'modelId' | 'connectionId' | 'pricing'>, connections: ModelConnection[]) {
  const connection = connections.find(item => item.id === model.connectionId);
  if (!connection || !model.pricing.officialUrl || !model.pricing.verifiedAt) return undefined;
  return MODEL_CATALOG.find(entry => entry.support.ready && entry.modelId === model.modelId && entry.checkedAt === model.pricing.verifiedAt && catalogConnectionMatches(entry, connection));
}
