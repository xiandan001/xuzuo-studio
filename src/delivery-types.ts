import type { DeliveryCheck } from './lib/delivery-quality';
import type { ProjectKind } from './types';

export interface DeliverySelection { projectId: string; kind: ProjectKind; artifactIds: string[]; sourceRevision?: number | string; checks: DeliveryCheck[]; }
export interface DeliveryFile { id: string; name: string; mimeType: string; bytes: number; sha256: string; }
export interface DeliveryReceipt { version: 1; id: string; projectId: string; kind: ProjectKind; title: string; revision: string; fingerprint: string; confirmedAt: string; files: DeliveryFile[]; checks: DeliveryCheck[]; checkedIds: string[]; }
export interface DeliveryInspection { projectId: string; kind: ProjectKind; title: string; revision: string; fingerprint: string; files: DeliveryFile[]; checks: DeliveryCheck[]; errors: string[]; ready: boolean; checkedIds: string[]; reviewSavedAt?: string; receipts: DeliveryReceipt[]; currentReceipt?: DeliveryReceipt; }
export interface DeliveryBridge {
  inspect: (input: DeliverySelection) => Promise<DeliveryInspection>;
  saveReview: (input: DeliverySelection & { fingerprint: string; checkedIds: string[] }) => Promise<DeliveryInspection>;
  confirm: (input: DeliverySelection & { fingerprint: string }) => Promise<DeliveryReceipt>;
  history: (input: { projectId: string }) => Promise<DeliveryReceipt[]>;
  exportZip: (input: { projectId: string; deliveryId: string }) => Promise<{ saved: boolean; path?: string; sha256?: string; bytes?: number }>;
}
