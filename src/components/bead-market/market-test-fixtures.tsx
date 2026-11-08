import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import type { BeadMarketBridge, BeadMarketOffer, BeadMarketState } from '../../bead-market-types';
import type { PageProps } from '../../types';
import { beadUiDocument, BEAD_UI_PNG } from '../../lib/bead-ui-fixtures';
import { beadMarketComparison, newBeadMarketState } from '../../lib/bead-market';

export const marketStamp = '2026-11-08T00:00:00.000Z';
export const marketRoots: ReturnType<typeof createRoot>[] = [];
export const marketOffer = (id = 'offer-a', change: Partial<BeadMarketOffer> = {}): BeadMarketOffer => ({ id, platform: 'taobao', url: `https://item.taobao.com/item.htm?id=${id === 'offer-a' ? '10001' : '10002'}`, title: `单色材料${id}`, sellerId: 'store-1', sellerName: '测试材料店', brand: 'Fixture', series: '', diameterMm: '2.6', code: 'W1', beadKind: 'solid', packCount: 1000, priceCents: 150, shippingCents: 0, minPacks: 1, tiers: [], priceKind: 'regular', conditions: [], conditionsAccepted: false, verification: 'reviewed', reviewedAt: marketStamp, evidence: { kind: 'manual', capturedAt: marketStamp }, ...change });
export function marketBackend(projectId = 'bead-project', offers: BeadMarketOffer[] = []) {
  const document = beadUiDocument(projectId); let state: BeadMarketState = { ...newBeadMarketState(projectId, document), offers };
  const listeners = new Set<(event: { projectId: string; revision: number }) => void>(), snapshot = () => structuredClone(beadMarketComparison(state, document, marketStamp));
  const bridge: BeadMarketBridge = {
    read: vi.fn(async input => { if (input.projectId !== projectId) throw Error('wrong project'); return snapshot(); }),
    save: vi.fn(async input => { if (input.projectId !== projectId || input.expectedRevision !== state.revision) throw Error('BEAD_MARKET_CONFLICT'); state = { ...structuredClone(input.state), revision: state.revision + 1 }; for (const listener of listeners) listener({ projectId, revision: state.revision }); return snapshot(); }),
    onChanged: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    query: vi.fn(async () => ({ jobId: 'query-one' })), cancel: vi.fn(async () => {}), openSource: vi.fn(async () => ({ opened: true })), captureSource: vi.fn(async () => snapshot()), importLinks: vi.fn(async () => ({ jobId: 'link-one' })), importFile: vi.fn(async () => undefined), extractImage: vi.fn(async () => ({ token: 'extract-one', source: 'image' as const, artifactId: 'screenshot', offers: [], issues: [], warnings: [] })), commitImport: vi.fn(async input => { state = { ...state, revision: state.revision + 1, offers: [...state.offers, ...input.offers] }; return snapshot(); }), export: vi.fn(async () => ({ artifact: { id: 'export-one', projectId, name: '采购报价.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 100, kind: 'office' as const, path: '', createdAt: marketStamp } })),
  };
  const props = { workspaceId: 'workspace', projects: [{ id: projectId, workspaceId: 'workspace' }], ledger: [], configuration: { models: [], connections: [], credentials: [] }, notify: vi.fn(), navigate: vi.fn(), workflowRunner: { thumbnailArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: BEAD_UI_PNG })), previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: BEAD_UI_PNG })), saveArtifact: vi.fn(async () => ({ saved: true })) } } as unknown as PageProps;
  return { bridge, props, document, snapshot, listeners, get state() { return state; }, set state(next: BeadMarketState) { state = next; } };
}
export async function mountMarket(node: ReactNode) { const host = document.createElement('div'), root = createRoot(host); document.body.append(host); marketRoots.push(root); await act(async () => { root.render(node); }); return { host, root }; }
export async function cleanupMarket() { for (const root of marketRoots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); Reflect.deleteProperty(document, 'hidden'); }
export function marketButton(text: string, host: ParentNode = document) { const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(text)); if (!node) throw Error(`missing button ${text}`); return node; }
export async function marketClick(node: HTMLElement) { await act(async () => { node.click(); }); }
export async function marketFill(label: string, value: string, host: ParentNode = document) { await act(async () => { const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`); if (!input) throw Error(`missing field ${label}`); const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
export async function marketSelect(label: string, option: string) { const trigger = document.querySelector<HTMLElement>(`[role="combobox"][aria-label="${label}"]`); if (!trigger) throw Error('missing select '+label); await marketClick(trigger); const entry = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes(option)); if (!entry) throw Error('missing option '+option); await marketClick(entry); }
export function marketDomSetup() { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Object.defineProperty(document, 'hidden', { configurable: true, value: false }); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 50, left: 20, top: 50, bottom: 90, right: 420, width: 400, height: 40, toJSON: () => ({}) }); }
