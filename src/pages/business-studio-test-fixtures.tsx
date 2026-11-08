import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { BusinessBridge, BusinessOrder, BusinessState } from '../business-types';
import type { ArtifactMetadata } from '../live-types';
import type { ModelCapability } from '../configuration-types';
import { newBusinessState } from '../lib/business-data';
import BusinessStudio from './BusinessStudio';
import { artifact, order, seeded, time } from './business-studio-demo-data';
export { order, artifact, seeded, time } from './business-studio-demo-data';

// Renderer integration fixtures only: these Native bridge functions never send an API request.
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const roots: ReturnType<typeof createRoot>[] = [];
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
export function multiSkuFixture(id: string) {
  const row = order(id, 'merchant', { status: 'review', productIds: ['product-a', 'product-b'], runIds: ['paid-original', 'paid-refine'], outputIds: ['a-square', 'a-tall', 'b-square', 'b-tall'], tasks: [
    { id: 'task-a', label: 'SKU-A两种尺寸', kind: 'image', operation: 'compose', projectId: `project-${id}`, productId: 'product-a', status: 'complete', artifactIds: ['a-square', 'a-tall'], factsRevision: 1 },
    { id: 'task-b', label: 'SKU-B两种尺寸', kind: 'image', operation: 'compose', projectId: `project-${id}`, productId: 'product-b', status: 'complete', artifactIds: ['b-square', 'b-tall'], factsRevision: 1 },
  ] });
  const state = { ...seeded('workspace-a', [row]), products: ['a', 'b'].map(name => ({ id: `product-${name}`, sku: `SKU-${name.toUpperCase()}`, name: `商品${name.toUpperCase()}`, projectId: row.sourceProjectId, referenceArtifactIds: [], facts: {}, updatedAt: time })), transactions: [{ id: 'receipt-preserved', orderId: row.id, kind: 'receipt' as const, amountCents: 12900, quantity: 2, occurredAt: time, note: '已实收，返修不能回退' }] };
  const files = [...row.outputIds, 'b-new'].map(id => artifact(id, row.sourceProjectId, { name: `${id}.png`, mimeType: 'image/png', kind: 'image', createdAt: id === 'b-new' ? '2026-11-08T02:00:00Z' : time }));
  return { row, state, files };
}
export function backend(seeds: BusinessState[] = []) {
  const states = new Map(seeds.map(state => [state.workspaceId, structuredClone(state)]));
  const current = (id: string) => states.get(id) || newBusinessState(id);
  const update = (workspaceId: string, orderId: string, change: Partial<BusinessOrder>) => {
    const state = current(workspaceId), saved = { ...state, revision: state.revision + 1, orders: state.orders.map(row => row.id === orderId ? { ...row, ...change } : row) }; states.set(workspaceId, saved); return structuredClone(saved);
  };
  const bridge: BusinessBridge = {
    snapshot: vi.fn(async id => structuredClone(current(id))),
    save: vi.fn(async input => { if (input.expectedRevision !== current(input.workspaceId).revision) throw Error('BUSINESS_CONFLICT'); const state = { ...structuredClone(input.state), revision: input.expectedRevision + 1 }; states.set(input.workspaceId, state); return structuredClone(state); }),
    start: vi.fn(async input => ({ state: update(input.workspaceId, input.orderId, { status: 'sample-review', tasks: [{ id: 'sample-task', kind: 'ppt', operation: 'document', projectId: current(input.workspaceId).orders.find(row => row.id === input.orderId)!.sourceProjectId, label: '首份正式样稿', status: 'complete', artifactIds: [], factsRevision: 1 }] }), projects: [] })),
    control: vi.fn(async input => ({ state: update(input.workspaceId, input.orderId, { status: input.action === 'continue' ? 'running' : input.action === 'pause' ? 'paused' : 'failed' }), projects: [] })),
    adopt: vi.fn(async input => ({ state: update(input.workspaceId, input.orderId, { outputIds: input.artifactIds, status: 'review' }), projects: [] })),
    deliver: vi.fn(async input => ({ state: update(input.workspaceId, input.orderId, { status: 'complete' }), projects: [] })),
    importPreview: vi.fn(), importCommit: vi.fn(), exportRecovery: vi.fn(async () => ({ saved: true })), prepare: vi.fn(), listing: vi.fn(), assist: vi.fn(),
  };
  return { states, current, update, bridge };
}
export async function mountBusiness(b: ReturnType<typeof backend>, options: { workspaceId?: string; files?: ArtifactMetadata[]; configuration?: Partial<PageProps['configuration']> } = {}) {
  Object.defineProperty(window, 'desktop', { configurable: true, value: { business: b.bridge } });
  const workspaceId = options.workspaceId || 'workspace-a', files = options.files || [];
  const capabilities: ModelCapability[] = ['text', 'vision', 'image-generation', 'image-editing'];
  const configuration = { models: [{ id: 'configured-model', name: '已配置多模态模型', modelId: 'fixture-only', enabled: true, connectionId: 'connection', capabilities, pricing: { unit: 'million-tokens', currency: 'CNY', input: '0', output: '0' } }], connections: [{ id: 'connection', name: '测试连接', enabled: true, providerId: 'fixture', protocol: 'openai-responses', baseUrl: 'https://fixture.invalid', status: 'configured' }], credentials: [{ id: 'saved-key', name: '已保存账户', connectionId: 'connection', enabled: true, lastFour: 'TEST', updatedAt: time }], ...options.configuration };
  const projects = [...b.states.values()].flatMap(state => state.orders.map(row => ({ id: row.sourceProjectId, workspaceId: state.workspaceId, name: row.name, kind: row.recipe === 'documents' ? 'word' : 'image', status: 'draft' }))) as Project[];
  if (!projects.length) projects.push({ id: 'existing-project', workspaceId, name: '现有本地项目', kind: 'image', status: 'draft' } as Project);
  const props = { workspaceId, configuration, projects, preferences: { hourlyRate: 50 }, navigate: vi.fn(), notify: vi.fn(), onCreateProject: vi.fn(), onOpenBusiness: vi.fn(), onBusinessIntentConsumed: vi.fn(), onBatchProjectsCreated: vi.fn(), ledger: Object.freeze([Object.freeze({ id: 'paid', projectId: 'existing-project', costCents: 157, billingMode: 'live', costState: 'calculated' })]), workflowRunner: { runs: [], inventoryRevision: 0, listProjectArtifacts: vi.fn(async (projectId: string) => structuredClone(files.filter(file => file.projectId === projectId))), thumbnailArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: image })), previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: image })), importFiles: vi.fn(async () => []), saveArtifact: vi.fn(async () => ({ saved: true })), trashArtifact: vi.fn(), restoreArtifact: vi.fn(), listTrashedArtifacts: vi.fn(async () => []) } } as unknown as PageProps;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  const render = async (changes: Partial<PageProps> = {}) => { Object.assign(props, changes); await act(async () => root.render(<BusinessStudio {...props} />)); };
  await render(); return { host, root, props, render, files };
}
export async function cleanupBusiness() { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); delete window.desktop; }
export function button(host: ParentNode, name: string) { const element = [...host.querySelectorAll<HTMLButtonElement>('button')].find(row => row.getAttribute('aria-label') === name || row.textContent?.trim() === name || row.querySelector('strong')?.textContent === name); if (!element) throw Error(`Button not found: ${name}`); return element; }
export async function click(host: ParentNode, name: string) { await act(async () => button(host, name).click()); }
export async function select(host: ParentNode, name: string, label: string) {
  await click(host, name); const element = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(row => row.textContent?.trim() === label); if (!element) throw Error(`Option not found: ${label}`); await act(async () => element.click());
}
export async function field(host: ParentNode, name: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`); if (!element) throw Error('Field not found: ' + name);
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
export async function check(host: ParentNode, label: string) { const element = [...host.querySelectorAll<HTMLLabelElement>('label')].find(row => row.textContent?.includes(label))?.querySelector<HTMLInputElement>('input[type="checkbox"]'); if (!element) throw Error('Checkbox not found: ' + label); await act(async () => element.click()); }
