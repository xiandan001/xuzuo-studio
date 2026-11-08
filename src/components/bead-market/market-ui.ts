import type { BeadDocument } from '../../bead-types';
import type { BeadMarketEvidence, BeadMarketOffer, BeadMaterialSpec } from '../../bead-market-types';
export const MARKET_NAMES = { '1688': '1688', taobao: '淘宝／天猫', pdd: '拼多多' };
export const marketMoney = (cents?: number) => cents === undefined ? '待补充' : `¥${(cents / 100).toFixed(2)}`;
export const marketTime = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未读取';
export const marketError = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，原图纸与报价仍保留。';
export function newMarketOffer(document: BeadDocument, spec: BeadMaterialSpec, evidence?: BeadMarketEvidence): BeadMarketOffer {
  return { id: crypto.randomUUID(), platform: 'taobao', url: '', title: '', sellerId: '', sellerName: '', brand: spec.brand, series: spec.series, diameterMm: spec.diameterMm, code: '', beadKind: 'solid', minPacks: 1, tiers: [], priceKind: 'regular', conditions: [], conditionsAccepted: false, verification: 'candidate', evidence: evidence || { kind: 'manual', capturedAt: new Date().toISOString() }, ...(document.pattern.palette.colors.length === 1 ? { code: document.pattern.palette.colors[0].code, beadKind: document.pattern.palette.colors[0].kind } : {}) };
}
