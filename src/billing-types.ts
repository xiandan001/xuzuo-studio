export interface FxRate {
  base: 'USD';
  quote: 'CNY';
  rate: string;
  date: string;
  source: string;
  kind: 'reference' | 'user';
}
export interface BillingRequestSnapshot {
  version: 1;
  adapter: 'xuzuo-openai-responses-v1';
  source: 'adapter-request' | 'verified-legacy-adapter';
  providerId: 'openai';
  protocol: 'openai-responses';
  modelId: string;
  operation: 'text' | 'vision';
  cache: { ttl: '30m' | '12h' | 'unknown'; source: 'documented-default' | 'explicit-or-unverified'; breakpoints: boolean };
}
export interface CostComponent {
  code: string;
  label: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  amount: string;
  currency: 'USD' | 'CNY';
}
export interface CostCalculation {
  version: 1;
  ruleId: string;
  ruleVersion: string;
  nativeCurrency: 'USD' | 'CNY';
  nativeAmount: string;
  cnyAmount?: string;
  fx?: FxRate;
  components: CostComponent[];
  basis: string;
  completeness: 'complete' | 'partial';
}
