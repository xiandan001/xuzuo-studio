import snapshot from './model-catalog-data.json';
import type { ApiProtocol, ModelCapability, ModelConfiguration, ModelConnection, ModelPricing } from './configuration-types';
import { PROVIDER_PRESETS } from './model-presets';
import { publicModelPricing } from './lib/configuration';

export interface ModelCatalogEntry {
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  capabilities: ModelCapability[];
  protocols: ApiProtocol[];
  region: string;
  defaultBaseUrl: string;
  allowedHosts: string[];
  allowedPaths?: string[];
  status: 'current' | 'preview' | 'older';
  releaseDate?: string | null;
  description: string;
  checkedAt: string;
  sources: { label: string; url: string }[];
  support: { ready: boolean; note: string };
  pricing: {
    currency: 'CNY' | 'USD';
    unit: ModelPricing['unit'];
    input: string;
    output: string;
    referenceOnly: boolean;
    displayLines: string[];
    note: string;
    example: string;
  };
}

export const MODEL_CATALOG_DATE = '2026-10-30';
export const MODEL_CATALOG = snapshot.models as ModelCatalogEntry[];
const PROVIDER_SEARCH_NAMES: Record<string, string> = { openai: 'OpenAI GPT ChatGPT', anthropic: 'Claude 克劳德', google: 'Google Gemini 谷歌', deepseek: 'DeepSeek 深度求索', aliyun: '阿里 百炼 通义 千问 Qwen', volcengine: '火山 方舟 字节 豆包 Seedream 即梦', tencent: '腾讯 混元 TokenHub Hy', zhipu: '智谱 GLM 清言', moonshot: 'Kimi Moonshot 月之暗面', minimax: 'MiniMax 海螺 稀宇', siliconflow: '硅基流动 托管' };

export function filterModelCatalog({ providerId = 'all', capability = 'all', query = '', readyOnly = false }: { providerId?: string; capability?: ModelCapability | 'all'; query?: string; readyOnly?: boolean } = {}): ModelCatalogEntry[] {
  const text = query.trim().toLocaleLowerCase();
  return MODEL_CATALOG.filter(entry => (providerId === 'all' || entry.providerId === providerId) && (capability === 'all' || entry.capabilities.includes(capability)) && (!readyOnly || entry.support.ready) && (!text || `${entry.name} ${entry.modelId} ${PROVIDER_SEARCH_NAMES[entry.providerId] || entry.providerId} ${entry.region} ${entry.description}`.toLocaleLowerCase().includes(text)));
}

export function catalogConnectionMatches(entry: ModelCatalogEntry, connection: ModelConnection): boolean {
  if (connection.demo || !connection.enabled || connection.providerId !== entry.providerId || !entry.protocols.includes(connection.protocol)) return false;
  try {
    const url = new URL(connection.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    if (url.port !== new URL(entry.defaultBaseUrl).port) return false;
    const host = url.hostname.toLocaleLowerCase();
    if (!entry.allowedHosts.some(pattern => pattern.startsWith('*.') ? host.endsWith(pattern.slice(1).toLocaleLowerCase()) && host !== pattern.slice(2).toLocaleLowerCase() : host === pattern.toLocaleLowerCase())) return false;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const paths = entry.allowedPaths || [new URL(entry.defaultBaseUrl).pathname];
    return paths.some(allowed => (allowed.replace(/\/+$/, '') || '/') === path);
  } catch { return false; }
}

export function matchingCatalogConnections(entry: ModelCatalogEntry, connections: ModelConnection[]): ModelConnection[] {
  return connections.filter(connection => catalogConnectionMatches(entry, connection));
}

export function catalogPricing(entry: ModelCatalogEntry, exchangeRate?: string): ModelPricing {
  const source = entry.sources.find(item => /价格|计费|pricing/i.test(item.label)) || entry.sources[0];
  return publicModelPricing({ unit: entry.pricing.unit, currency: entry.pricing.currency, input: entry.pricing.input, output: entry.pricing.output, ...(entry.pricing.currency === 'USD' && exchangeRate ? { exchangeRate } : {}), referenceOnly: entry.pricing.referenceOnly, referenceNote: `${entry.region}。${entry.pricing.note}`.slice(0, 2000), officialUrl: source?.url, verifiedAt: entry.checkedAt });
}

export function catalogModelDraft(entry: ModelCatalogEntry, connection: ModelConnection, exchangeRate?: string): Omit<ModelConfiguration, 'id' | 'demo'> {
  if (!entry.support.ready) throw new Error(entry.support.note || '该型号需要专用接口适配，当前不能直接使用。');
  if (!catalogConnectionMatches(entry, connection)) throw new Error('请选择与该型号供应商、协议及计价地域一致的官方连接。');
  return { name: `${entry.name} · ${entry.region}`.slice(0, 60), modelId: entry.modelId, connectionId: connection.id, capabilities: [...entry.capabilities], pricing: catalogPricing(entry, exchangeRate), enabled: true };
}

export function catalogConnectionDraft(entry: ModelCatalogEntry): Omit<ModelConnection, 'id' | 'status' | 'demo'> {
  if (!entry.support.ready || !entry.protocols.length || /[{}]/.test(entry.defaultBaseUrl)) throw new Error('请先按官方说明完成该型号的接入配置。');
  const url = new URL(entry.defaultBaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('官方连接地址无效，请手动核对。');
  const provider = PROVIDER_PRESETS.find(item => item.id === entry.providerId);
  return { name: `${provider?.name || entry.providerId} · ${entry.region}`.slice(0, 60), providerId: entry.providerId, protocol: entry.protocols[0], baseUrl: entry.defaultBaseUrl, enabled: true };
}
