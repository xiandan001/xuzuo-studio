import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, request, word } = require('./production-test-fixtures.cjs');
const { createBusinessStore } = require('../../electron/business-store.cjs');
const { createBusinessIntake, candidatesFrom } = require('../../electron/business-intake.cjs');
const { createBusinessRevisionAdopter } = require('../../electron/business-revision-adoption.cjs');
const { customerStatementHtml } = require('../../electron/business-statements.cjs');
const { createIdMap, remap } = require('../../electron/backup-format.cjs');
const time = '2026-11-12T00:00:00.000Z', owned = [], hash = value => createHash('sha256').update(value).digest('hex');
afterEach(async () => { for (const f of owned.splice(0)) { await f.engine.shutdown(); await Promise.all([f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain(), f.store.drain()]); const directory = await fs.realpath(f.directory); if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-production-')) throw Error('Unsafe intake fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }); } });
async function setup() {
  const f = await fixture(); owned.push(f); const project = { ...request().project, id: 'source', name: '客户需求来源', kind: 'word' };
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  const order = { id: 'order', name: '<客户&需求>', recipe: 'documents', sourceProjectId: project.id, brief: '旧需求保留', productIds: [], projectIds: [project.id], runIds: [], outputIds: [], includedRevisions: 1, status: 'draft', factsRevision: 1, facts: { 已确认: '原事实' }, outputKinds: ['word'], imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: time, updatedAt: time };
  f.store = createBusinessStore({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore });
  await f.store.save({ workspaceId: project.workspaceId, expectedRevision: 0, state: { version: 1, workspaceId: project.workspaceId, revision: 0, brands: [], products: [], orders: [order], feedback: [], transactions: [], metrics: [] } });
  const context = { project, connections: [], credentials: [], models: [] };
  return Object.assign(f, { project, order, input: { workspaceId: project.workspaceId, orderId: order.id }, options: { businessStore: f.store, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, getContext: async () => context, loadModule: f.loadModule } });
}
describe('客户资料候选、确认与真实修订采用', () => {
  it('同一份客户原话包含多次更改时保留全部候选并标记冲突，不静默取第一值', async () => {
    const f = await setup(), intake = createBusinessIntake(f.options);
    const read = await intake.intakeRead({ ...f.input, artifactIds: [], text: '尺寸：1080×1920\n用途：详情页\n尺寸：1920×1080\n尺寸：1920×1080' });
    const draft = read.state.orders[0].intakes[0];
    expect(draft.candidates.filter(row => row.key === 'size').map(row => row.value)).toEqual(['1080×1920', '1920×1080']);
    expect(draft.warnings).toContain('交付尺寸有多个不同说法，请选择并核对。'); expect(read.state.orders[0].facts).toEqual({ 已确认: '原事实' });
    for (const candidate of draft.candidates.filter(row => row.key === 'size')) expect(candidate.evidence[0].snippet).toContain(candidate.value);
  });
  it('本地提取保存真实来源与原句，确认前不改订单，冲突与缺项明确', async () => {
    const f = await setup(), intake = createBusinessIntake(f.options), read = await intake.intakeRead({ ...f.input, artifactIds: [], text: '用途：小红书\n交付数量：3\n截止日期：2026-11-30\n修改次数：2' });
    expect(read.state.orders[0].brief).toBe('旧需求保留'); expect(read.state.orders[0].facts).toEqual({ 已确认: '原事实' });
    const draft = read.state.orders[0].intakes[0]; expect(draft.missing).toContain('size'); expect(draft.candidates.find(row => row.key === 'purpose').evidence[0].textMatched).toBe(true);
    expect(hash((await f.artifactStore.read(draft.sources[0].artifactId)).buffer)).toBe(draft.sources[0].sha256);
    const confirmed = await intake.intakeConfirm({ ...f.input, intakeId: draft.id, expectedRevision: read.state.revision, values: { purpose: '小红书', deadline: '2026-11-30', includedRevisions: '2' }, confirmed: true });
    expect(confirmed.orders[0]).toMatchObject({ deadline: '2026-11-30', includedRevisions: 2, brief: '旧需求保留', facts: { 已确认: '原事实', 用途: '小红书' } });
    const previous = confirmed.orders[0].intakes[0].confirmedAt;
    const retried = await intake.intakeConfirm({ ...f.input, intakeId: draft.id, expectedRevision: read.state.revision, values: { purpose: '小红书', deadline: '2026-11-30', includedRevisions: '2' }, confirmed: true }); expect(retried.orders[0].intakes[0].confirmedAt).toBe(previous);
    const fake = structuredClone(retried); fake.orders[0].intakes[0].sources[0].name = '伪造来源'; await expect(f.store.save({ workspaceId: f.input.workspaceId, expectedRevision: fake.revision, state: fake })).rejects.toThrow(/需求/);
  });
  it('不能将编造原文、外部来源、缺项、过期订单直接写成确认事实', async () => {
    const source = { artifactId: 'actual', name: '原话', sha256: 'a'.repeat(64), mimeType: 'text/plain', text: '用途：详情页' };
    expect(() => candidatesFrom({ candidates: [{ key: 'purpose', value: '直播', evidence: [{ artifactId: 'actual', snippet: '客户要求直播' }] }] }, [source])).toThrow(/原句/);
    expect(() => candidatesFrom({ candidates: [{ key: 'purpose', value: '详情页', evidence: [{ artifactId: 'foreign', snippet: '用途：详情页' }] }] }, [source])).toThrow(/来源/);
    const recoveredSource = { ...source, artifactId: 'restored', originalArtifactId: 'actual' };
    expect(candidatesFrom({ candidates: [{ key: 'purpose', value: '详情页', evidence: [{ artifactId: 'actual', snippet: '用途：详情页' }] }] }, [recoveredSource])[0].evidence[0].artifactId).toBe('restored');
    const f = await setup(), intake = createBusinessIntake(f.options), read = await intake.intakeRead({ ...f.input, artifactIds: [], text: '整体需求：\n用途：详情页' });
    expect(read.state.orders[0].intakes[0].candidates.some(row => row.key === 'brief')).toBe(false);
    await expect(intake.intakeConfirm({ ...f.input, intakeId: read.intakeId, expectedRevision: read.state.revision, values: { deadline: '2026-11-30' }, confirmed: true })).rejects.toThrow(/来源候选/);
    await f.store.mutate(f.input.workspaceId, state => { state.orders[0].factsRevision++; return state; });
    await expect(intake.intakeConfirm({ ...f.input, intakeId: read.intakeId, expectedRevision: read.state.revision, values: { purpose: '详情页' }, confirmed: true })).rejects.toThrow(/已更新/);
  });
  it('模型结果必须有真实证据，实际辅助run费用关联保留，重复查看不再识读', async () => {
    const f = await setup(); let calls = 0;
    const intake = createBusinessIntake({ ...f.options, businessAssist: { assist: async input => { calls++; expect(input.requestId).toBeTruthy(); const source = JSON.parse(input.text).sources[0]; await f.store.mutate(f.input.workspaceId, state => { state.orders[0].runIds.push('actual-assist-run'); return state; }); return { text: JSON.stringify({ candidates: [{ key: 'purpose', value: '详情页', evidence: [{ artifactId: source.artifactId, snippet: '用于详情页' }] }] }), runId: 'actual-assist-run' }; } } });
    const read = await intake.intakeRead({ ...f.input, artifactIds: [], text: '客户说这个设计用于详情页' }), result = await intake.intakeExtract({ ...f.input, intakeId: read.intakeId });
    expect(result.state.orders[0].intakes[0].runId).toBe('actual-assist-run'); await intake.intakeExtract({ ...f.input, intakeId: read.intakeId }); expect(calls).toBe(1); expect(result.state.orders[0].facts).toEqual({ 已确认: '原事实' });
  });
  it('AI部分或空候选只补充需求，不删除已有本地证据与数量', async () => {
    for (const empty of [false, true]) {
      const f = await setup(), intake = createBusinessIntake({ ...f.options, businessAssist: { assist: async input => {
        const source = JSON.parse(input.text).sources[0]; await f.store.mutate(f.input.workspaceId, state => { state.orders[0].runIds.push('partial-ai-run'); return state; });
        return { runId: 'partial-ai-run', text: JSON.stringify({ candidates: empty ? [] : [{ key: 'purpose', value: '详情页', evidence: [{ artifactId: source.artifactId, snippet: '设计用于详情页' }] }] }) };
      } } });
      const read = await intake.intakeRead({ ...f.input, artifactIds: [], text: '交付数量：3\n设计用于详情页' }), before = read.state.orders[0].intakes[0].candidates;
      const result = await intake.intakeExtract({ ...f.input, intakeId: read.intakeId }), draft = result.state.orders[0].intakes[0];
      expect(draft.candidates.find(row => row.key === 'quantity')).toEqual(before.find(row => row.key === 'quantity')); expect(draft.missing).not.toContain('quantity');
      if (!empty) expect(draft.candidates.some(row => row.key === 'purpose')).toBe(true);
      expect(result.state.orders[0].facts).toEqual({ 已确认: '原事实' });
    }
  });
  it('Word返修采用验证实际原文件与导出版本，原子完成本轮且可幂等重试', async () => {
    const f = await setup(), first = await f.editorStore.export({ projectId: f.project.id, expectedRevision: 0, document: word('原文客户版'), sourceArtifactIds: [] }), original = first.artifacts.find(row => row.kind === 'office'), originalBytes = await f.artifactStore.read(original.id);
    await f.store.mutate(f.input.workspaceId, state => { state.orders[0].outputIds = [original.id]; state.feedback.push({ id: 'feedback', orderId: 'order', round: 1, target: { projectId: f.project.id, artifactId: original.id }, sourceRevision: first.record.revision, text: '修正标题', tasks: [], status: 'approved', runIds: [], createdAt: time, updatedAt: time }); return state; });
    const second = await f.editorStore.export({ projectId: f.project.id, expectedRevision: first.record.revision, document: word('已修正客户版'), sourceArtifactIds: [original.id] }), final = second.artifacts.filter(row => row.kind === 'office');
    const adopt = createBusinessRevisionAdopter({ ...f.options, editorStore: f.editorStore, spreadsheetStore: f.spreadsheetStore, writable: () => {}, busy: () => false, allProjects: async () => [], deliveryFiles: async () => [] });
    const input = { ...f.input, feedbackId: 'feedback', sourceArtifactId: original.id, sourceSha256: hash(originalBytes.buffer), sourceRevision: first.record.revision, exportRevision: second.record.revision, artifactIds: final.map(row => row.id) };
    const result = await adopt(input); expect(result.state.orders[0].outputIds).toEqual(final.map(row => row.id)); expect(result.state.feedback[0].status).toBe('confirmed'); const confirmation = result.state.feedback[0].updatedAt;
    expect((await adopt(input)).state.feedback[0].updatedAt).toBe(confirmation); expect((await f.artifactStore.read(original.id)).buffer).toEqual(originalBytes.buffer);
    await expect(adopt({ ...input, exportRevision: first.record.revision })).rejects.toThrow(/已采用其他/);
  });
  it('恢复会同时映射需求来源、分期归属和返修采用ID；对账单转义客户文本且不含成本', async () => {
    const f = await setup(), intake = createBusinessIntake(f.options), read = await intake.intakeRead({ ...f.input, artifactIds: [], text: '用途：展示' });
    const state = read.state; state.orders[0].paymentPlan = { currency: 'CNY', agreedCents: 100, milestones: [{ id: 'deposit', label: '订金', amountCents: 100, dueDate: '2026-11-30' }] }; state.transactions.push({ id: 'receipt', orderId: 'order', kind: 'receipt', paymentMilestoneId: 'deposit', amountCents: 30, note: '<script>secret</script>', occurredAt: time });
    state.orders[0].paymentPlan.assignments = [{ id: 'assignment', transactionId: 'receipt', milestoneId: 'deposit', createdAt: time }];
    const ids = createIdMap(state), restored = remap(state, ids); expect(restored.transactions[0].paymentMilestoneId).toBe(restored.orders[0].paymentPlan.milestones[0].id); expect(restored.orders[0].intakes[0].sources[0].artifactId).toBe(restored.orders[0].intakes[0].candidates[0].evidence[0].artifactId); expect(restored.orders[0].paymentPlan.assignments[0].transactionId).toBe(restored.transactions[0].id); expect(restored.orders[0].paymentPlan.assignments[0].milestoneId).toBe(restored.orders[0].paymentPlan.milestones[0].id); expect(restored.orders[0].intakes[0].requestId).toBe(state.orders[0].intakes[0].requestId); expect(restored.orders[0].intakes[0].sources[0].originalArtifactId).toBe(state.orders[0].intakes[0].sources[0].artifactId);
    const html = customerStatementHtml(state, 'order'); expect(html).toContain('&lt;客户&amp;需求&gt;'); expect(html).toContain('¥0.70'); expect(html).not.toContain('<script>'); expect(html).not.toContain('apiKey');
  });
  it('归属审计可追加或作废，但不能改写实际流水或旧归属', async () => {
    const f = await setup(); await f.store.mutate(f.input.workspaceId, state => { state.orders[0].paymentPlan = { currency: 'CNY', agreedCents: 10000, milestones: [{ id: 'deposit', label: '订金', amountCents: 5000 }, { id: 'balance', label: '尾款', amountCents: 5000 }] }; state.transactions.push({ id: 'receipt', orderId: 'order', kind: 'receipt', amountCents: 3000, note: '真实流水', occurredAt: time }); return state; });
    const base = await f.store.snapshot(f.input.workspaceId), candidate = structuredClone(base); candidate.orders[0].paymentPlan.assignments = [{ id: 'assign', transactionId: 'receipt', milestoneId: 'deposit', createdAt: time }];
    const saved = await f.store.save({ workspaceId: f.input.workspaceId, expectedRevision: base.revision, state: candidate }); expect(saved.transactions).toEqual(base.transactions);
    const tampered = structuredClone(saved); tampered.orders[0].paymentPlan.assignments[0].milestoneId = 'balance'; await expect(f.store.save({ workspaceId: f.input.workspaceId, expectedRevision: saved.revision, state: tampered })).rejects.toThrow(/归属历史/);
    const valid = structuredClone(saved); valid.orders[0].paymentPlan.assignments[0].voidedAt = time; valid.orders[0].paymentPlan.assignments.push({ id: 'assign-next', transactionId: 'receipt', milestoneId: 'balance', createdAt: time });
    const moved = await f.store.save({ workspaceId: f.input.workspaceId, expectedRevision: saved.revision, state: valid }); expect(moved.transactions).toEqual(base.transactions); expect(moved.orders[0].paymentPlan.assignments).toHaveLength(2);
  });
});
