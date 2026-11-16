import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { fixture, PNG } = require('./production-test-fixtures.cjs');
const { createBusinessStore } = require('../../electron/business-store.cjs');
const { createBusinessLinks } = require('../../electron/business-links.cjs');
const roots = []; afterEach(async () => { for (const root of roots.splice(0)) { if (!path.isAbsolute(root) || !path.basename(root).startsWith('xuzuo-production-')) throw Error('Unowned test directory'); await fs.rm(root, { recursive: true, force: true }); } });
async function setup() { const f = await fixture(); roots.push(f.directory); await f.workspaceStorage.ensureProject({ workspaceId: 'production-workspace', projectId: 'source', name: '原作品' }); await f.workspaceStorage.ensureProject({ workspaceId: 'production-workspace', projectId: 'target', name: '新作品' }); const ledger = [{ id: 'chat-fee', workspaceId: 'production-workspace', scope: 'chat', projectId: '', projectName: '前期准备', action: 'AI 复核', model: 'fixture', costCents: 12, costState: 'calculated', billingMode: 'live', status: 'complete', time: '2026-11-12T00:00:00Z' }], runs = []; const store = createBusinessStore({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore }); return { ...f, ledger, runs, store, links: createBusinessLinks({ store, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, getLedger: async () => ledger, getRuns: async () => runs }) }; }
describe('成品主线与不可退款的聊天费用归属', () => {
  it('serializes percentages, validates scope and revision, keeps immutable historical shares and the original ledger', async () => {
    const f = await setup(), ledger = structuredClone(f.ledger);
    let state = await f.links.allocateCosts({ workspaceId: 'production-workspace', expectedRevision: 0, entryId: 'chat-fee', allocations: [{ projectId: 'source', basisPoints: 3333 }, { projectId: 'target', basisPoints: 6667 }] });
    expect(state.costAllocations.filter(row => !row.voidedAt).reduce((sum, row) => sum + row.basisPoints, 0)).toBe(10000);
    await expect(f.links.allocateCosts({ workspaceId: 'production-workspace', expectedRevision: 0, entryId: 'chat-fee', allocations: [] })).rejects.toThrow('变化');
    await expect(f.links.allocateCosts({ workspaceId: 'production-workspace', expectedRevision: state.revision, entryId: 'chat-fee', allocations: [{ projectId: 'source', basisPoints: 10001 }] })).rejects.toThrow('100%');
    await expect(f.links.allocateCosts({ workspaceId: 'production-workspace', expectedRevision: state.revision, entryId: 'chat-fee', allocations: [{ projectId: 'foreign', basisPoints: 10000 }] })).rejects.toThrow('工作区');
    state = await f.links.allocateCosts({ workspaceId: 'production-workspace', expectedRevision: state.revision, entryId: 'chat-fee', allocations: [] }); expect(state.costAllocations).toHaveLength(2); expect(state.costAllocations.every(row => !!row.voidedAt)).toBe(true); expect(f.ledger).toEqual(ledger);
    const forged = structuredClone(state); forged.costAllocations = []; await expect(f.store.save({ workspaceId: state.workspaceId, expectedRevision: state.revision, state: forged })).rejects.toThrow('归属');
  });
  it('links real output once, prevents duplicate run ownership and imports exact-source feedback idempotently', async () => {
    const f = await setup(), file = await f.artifactStore.write({ projectId: 'source', name: '成品.png', mimeType: 'image/png', buffer: PNG });
    f.runs.push({ id: 'paid-run', workspaceId: 'production-workspace', projectId: 'source', mode: 'live', attempts: [{ artifacts: [file] }] });
    let state = await f.links.linkOutput({ workspaceId: 'production-workspace', projectId: 'source', artifactIds: [file.id], name: '交付一' }); const orderId = state.orders[0].id; expect(state.orders[0].runIds).toEqual(['paid-run']); expect(state.transactions).toEqual([]);
    state = await f.links.linkOutput({ workspaceId: 'production-workspace', projectId: 'source', artifactIds: [file.id], orderId }); expect(state.orders[0].tasks).toHaveLength(1);
    await expect(f.links.linkOutput({ workspaceId: 'production-workspace', projectId: 'source', artifactIds: [file.id], name: '重复交付' })).rejects.toThrow('重复计算');
    const input = { workspaceId: 'production-workspace', packageId: 'proof-package', annotations: [{ id: 'annotation', target: { projectId: 'source', artifactId: file.id, region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }, text: '改成蓝色', sourceSha256: createHash('sha256').update(PNG).digest('hex'), sourceRevision: 1 }] };
    state = await f.links.importProofFeedback(input); expect(state.orders).toHaveLength(1); expect(state.feedback[0].orderId).toBe(orderId); expect(state.feedback[0].sourceRevision).toBe(1);
    state = await f.links.importProofFeedback(input); expect(state.feedback).toHaveLength(1);
    await expect(f.links.importProofFeedback({ ...input, annotations: [{ ...input.annotations[0], sourceSha256: 'f'.repeat(64) }] })).rejects.toThrow('改变'); expect((await f.store.snapshot('production-workspace')).feedback).toHaveLength(1);
  });
});
