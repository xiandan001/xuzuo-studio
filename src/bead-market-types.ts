import type { ArtifactMetadata } from './live-types';
import type { BeadDocument, BeadUsageRow } from './bead-types';

export type BeadMarketPlatform = '1688' | 'taobao' | 'pdd';
export type BeadMarketQueryStatus = 'idle' | 'querying' | 'complete' | 'needs-login' | 'restricted' | 'failed' | 'cancelled';
export interface BeadMaterialSpec {
  brand: string; series: string; diameterMm: string; paletteId: string; paletteVersion: string;
  allowCompatible: boolean;
}
export interface BeadMarketEvidence {
  kind: 'page' | 'link' | 'image' | 'table' | 'manual'; capturedAt: string;
  url?: string; artifactId?: string; sha256?: string; text?: string; expiresAt?: string;
}
export interface BeadMarketOffer {
  id: string; platform: BeadMarketPlatform; url: string; title: string;
  sellerId: string; sellerName: string; brand: string; compatibleWith?: string; series: string;
  diameterMm: string; code: string; beadKind: 'solid' | 'transparent' | 'special';
  packCount?: number; packWeightGrams?: string; priceCents?: number; minPacks: number;
  tiers: { minPacks: number; priceCents: number }[]; shippingCents?: number; freeShippingAboveCents?: number;
  priceKind: 'regular' | 'conditional' | 'range' | 'unknown'; conditions: string[]; conditionsAccepted: boolean;
  verification: 'candidate' | 'reviewed' | 'page' | 'api'; reviewedAt?: string; evidence: BeadMarketEvidence;
}
export interface BeadMarketSourceStatus {
  status: BeadMarketQueryStatus; message: string; searchUrl?: string; updatedAt: string; count: number;
}
export interface BeadMarketQuery {
  id: string; fingerprint: string; status: BeadMarketQueryStatus; startedAt: string; finishedAt?: string;
  platforms: BeadMarketPlatform[]; codes: string[]; sources: Partial<Record<BeadMarketPlatform, BeadMarketSourceStatus>>;
}
export interface BeadMarketState {
  version: 1; projectId: string; revision: number; spec: BeadMaterialSpec;
  offers: BeadMarketOffer[]; selections: Record<string, string>; lastQuery?: BeadMarketQuery;
}
export interface BeadMarketDemand {
  documentId: string; documentRevision: number; fingerprint: string; spec: BeadMaterialSpec; rows: BeadUsageRow[];
}
export interface BeadMarketOfferPrice {
  offerId: string; code: string; eligible: boolean; reasons: string[]; warnings: string[];
  packs?: number; beads?: number; materialCents?: number; perThousandCents?: number;
  shippingCents?: number; totalCents?: number;
}
export interface BeadMarketCart {
  lines: BeadMarketOfferPrice[]; materialCents: number; shippingCents?: number; totalCents?: number;
  complete: boolean; missingCodes: string[]; warnings: string[];
  stores: { key: string; platform: BeadMarketPlatform; sellerName: string; materialCents: number; shippingCents?: number; offerIds: string[] }[];
}
export interface BeadMarketSnapshot { state: BeadMarketState; demand?: BeadMarketDemand; prices: BeadMarketOfferPrice[]; cart?: BeadMarketCart; suggestions?: { material: BeadMarketCart; fewStores: BeadMarketCart }; }
export interface BeadMarketPlatformSession { platform: BeadMarketPlatform; status: 'not-opened' | 'opened' | 'confirmed' | 'needs-login'; openedAt?: string; userConfirmedAt?: string; }
export interface BeadMarketImportPreview {
  token: string; source: 'table' | 'image' | 'links'; artifactId?: string; offers: BeadMarketOffer[];
  issues: string[]; warnings: string[]; rawText?: string;
}
export interface BeadMarketBridge {
  sessions?: () => Promise<BeadMarketPlatformSession[]>;
  login?: (input: { platform: BeadMarketPlatform }) => Promise<{ opened: boolean }>;
  confirmLogin?: (input: { platform: BeadMarketPlatform }) => Promise<BeadMarketPlatformSession[]>;
  onSessionChanged?: (listener: () => void) => () => void;
  read: (input: { projectId: string }) => Promise<BeadMarketSnapshot>;
  save: (input: { projectId: string; expectedRevision: number; state: BeadMarketState }) => Promise<BeadMarketSnapshot>;
  query: (input: { projectId: string; platforms?: BeadMarketPlatform[]; codes?: string[]; force?: boolean }) => Promise<{ jobId: string }>;
  cancel: (input: { projectId: string }) => Promise<void>;
  openSource: (input: { projectId: string; platform: BeadMarketPlatform; offerId?: string }) => Promise<{ opened: boolean }>;
  captureSource: (input: { projectId: string; platform: BeadMarketPlatform }) => Promise<BeadMarketSnapshot>;
  importLinks: (input: { projectId: string; text: string }) => Promise<{ jobId: string }>;
  importFile: (input: { projectId: string; kind: 'table' | 'image' }) => Promise<BeadMarketImportPreview | undefined>;
  extractImage: (input: { projectId: string; artifactId: string; platform?: BeadMarketPlatform; modelConfigId?: string; credentialId?: string; retry?: boolean }) => Promise<BeadMarketImportPreview>;
  commitImport: (input: { projectId: string; expectedRevision: number; token: string; offers: BeadMarketOffer[] }) => Promise<BeadMarketSnapshot>;
  export: (input: { projectId: string; format: 'xlsx' | 'csv' }) => Promise<{ artifact: ArtifactMetadata }>;
  onChanged?: (listener: (event: { projectId: string; revision: number }) => void) => () => void;
}
export type BeadMarketDocumentReader = (projectId: string) => Promise<BeadDocument | undefined>;
