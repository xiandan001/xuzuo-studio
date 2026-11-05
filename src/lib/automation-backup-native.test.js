import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url)), deps = createRequire(path.join(root, 'work/ui-build/package.json'));
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs'), { createProjectBackup } = require('../../electron/project-backup.cjs');
const { exportAutomationBackup, mergeAutomationBackup } = require('../../electron/automation-backup.cjs'), { exportModelReceiptBackup, mergeModelReceiptImport } = require('../../electron/model-receipt-backup.cjs');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex'), stamp = '2026-11-03T00:00:00Z';
function emptyAutomation() { return { version: 1, revision: 0, context: { workspaces: [], projects: [], workflows: [], models: [], connections: [] }, rules: [], events: [], jobs: [], decisions: [], memories: [] }; }
async function profile(directory, providers = {}) {
  await fs.mkdir(directory); const storage = createWorkspaceStorage({ directory }), artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage: storage, loadModule: deps }); storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
  return { storage, artifacts, engine, backup: createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: deps, ...providers }) };
}
async function sourceFixture(directory) {
  let automation, receipt; const scopes = [], source = await profile(path.join(directory, 'source'), { automationProvider: { backupEntries(scope) { scopes.push({ automation: scope }); return exportAutomationBackup(automation, scope); } }, receiptProvider: { backupEntries(scope) { scopes.push({ receipt: scope }); return exportModelReceiptBackup([receipt], scope); } } });
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace); await source.storage.bindRoot({ workspaceId: 'workspace-one', name: '自动化工作区', directory: workspace }); await source.storage.ensureProject({ projectId: 'project-one', workspaceId: 'workspace-one', name: '项目一' });
  const project = { id: 'project-one', workspaceId: 'workspace-one', name: '项目一', kind: 'word', status: 'draft', description: '', updatedAt: stamp, costCents: 17, version: 1, accent: 'purple' }, workflow = { id: 'workflow-one', workspaceId: 'workspace-one', name: '制作检查', outputKind: 'word', steps: [{ id: 'producer', kind: 'text', enabled: true, prompt: '保留事实' }] };
  const artifact = await source.artifacts.write({ projectId: project.id, runId: 'run-one', name: 'result.txt', mimeType: 'text/plain', buffer: Buffer.from('已有完整结果') }), missing = { id: 'deleted-artifact', projectId: project.id, runId: 'run-one', name: 'removed.png', kind: 'image', mimeType: 'image/png', bytes: 17, path: 'C:\\old-machine\\removed.png' };
  const attempt = { id: 'attempt-one', stepId: 'producer', status: 'complete', artifacts: [artifact, missing], summary: '已有完整结果', costCents: 17 }, run = { id: 'run-one', workspaceId: 'workspace-one', projectId: project.id, workflowId: workflow.id, status: 'paused', snapshot: workflow, attempts: [attempt], dispatchKey: 'a'.repeat(64), createdAt: stamp, updatedAt: stamp };
  const ledger = [{ id: 'paid-one', projectId: project.id, projectName: project.name, workflowRunId: run.id, workflowAttemptId: attempt.id, action: '初次生成', model: '历史', costCents: 17, billingMode: 'live', costState: 'manual', status: 'complete', time: stamp }];
  await source.engine.importRecords([{ run, request: { project, workflow, connections: [], models: [] }, ledger }]);
  const rule = { id: 'rule-one', workspaceId: project.workspaceId, projectId: project.id, workflowId: workflow.id, name: '自动制作', enabled: true, trigger: 'manual', input: '完整目标', variables: {} };
  automation = { ...emptyAutomation(), context: { workspaces: [{ id: 'workspace-one', name: '自动化工作区' }], projects: [project], workflows: [workflow], models: [], connections: [] }, rules: [rule], events: [{ id: 'event-one', workspaceId: project.workspaceId, projectId: project.id, trigger: 'manual' }], jobs: [{ id: 'job-one', ruleId: rule.id, eventId: 'event-one', projectId: project.id, workspaceId: project.workspaceId, runId: run.id, status: 'running', dispatchKey: run.dispatchKey, ruleSnapshot: rule, workflowSnapshot: workflow }], decisions: [], memories: [{ id: 'memory-one', projectId: project.id, workspaceId: project.workspaceId, note: '用户保留数字', createdAt: stamp }] };
  const result = { text: '已有完整结果', artifacts: [artifact, missing], usage: { inputTokens: 100, outputTokens: 17 } }; receipt = { version: 1, requestId: attempt.id, runId: run.id, projectId: project.id, fingerprint: 'b'.repeat(64), status: 'complete', requestStarted: true, result, resultSha256: digest(result), createdAt: stamp };
  const meta = { workspaces: automation.context.workspaces, projects: [project], ledger, customPrompts: [], preferencesByWorkspace: {}, configuration: { connections: [], models: [], workflows: [workflow], categories: [], studioActions: [], useTemplates: [] } }, archive = path.join(directory, 'automation.zip');
  await source.backup.exportBackup({ meta, workspaceIds: ['workspace-one'], projectIds: ['project-one'], filePath: archive }); return { ...source, scopes, archive, sourceReceipt: receipt };
}
describe('自动化和模型回执真实ZIP恢复', () => {
  it('新格式在native run/attempt恢复后重绑回执与待办，已有费用不重复，缺失历史产物不阻塞', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-automation-backup-')), source = await sourceFixture(directory); let target;
    try {
      const zip = await deps('jszip').loadAsync(await fs.readFile(source.archive)), manifest = JSON.parse(await zip.file('manifest.json').async('string')); expect(manifest.version).toBe(2); expect(manifest.modelReceipts.records[0].result.artifacts[1].path).toBeUndefined(); expect(source.scopes).toEqual([{ automation: { workspaceIds: ['workspace-one'], projectIds: ['project-one'] } }, { receipt: { projectIds: ['project-one'] } }]);
      const order = []; let current = emptyAutomation(), receipts = [];
      const receiptProvider = { async importEntries(input) { order.push('receipts'); expect(input.records.records[0].requestId).toBe('attempt-one'); expect(input.availableRuns[0].attempts[0].id).toBe(input.idMap['attempt-one']); const availableArtifacts = []; for (const file of input.records.records.flatMap(record => record.result?.artifacts || [])) { try { availableArtifacts.push(...await target.artifacts.list([input.idMap[file.id]])); } catch { /* Deleted historical artifacts remain unavailable. */ } } receipts.push(...mergeModelReceiptImport(receipts, { ...input, availableArtifacts }).added); } };
      const automationProvider = { async importEntries(input) { order.push('automation'); expect(receipts).toHaveLength(1); current = mergeAutomationBackup(current, { ...input, availableRuns: (await target.engine.snapshot()).runs }).state; } };
      target = await profile(path.join(directory, 'target'), { receiptProvider, automationProvider }); const destination = path.join(directory, 'restore'); await fs.mkdir(destination); const restored = await target.backup.importBackup({ filePath: source.archive, directory: destination });
      expect(order).toEqual(['receipts', 'automation']); expect(receipts[0].result.artifacts[0].path).toContain(destination); expect(receipts[0].result.artifacts[1]).toMatchObject({ unavailable: true, path: '' }); expect(current.rules[0].enabled).toBe(false); expect(current.jobs[0].status).toBe('decision'); expect(current.jobs[0].runId).toBe(restored.idMap['run-one']); expect(current.decisions[0].kind).toBe('uncertain');
      const once = await target.engine.snapshot(); expect(once.runs[0].status).toBe('interrupted'); expect(once.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(17); await target.backup.importBackup({ filePath: source.archive, directory: destination }); expect(receipts).toHaveLength(1); expect(current.jobs).toHaveLength(1); expect((await target.engine.snapshot()).ledger).toHaveLength(1);
      await target.backup.acknowledgeImport(restored.backupId); await expect(target.backup.importBackup({ filePath: source.archive, directory: destination })).rejects.toThrow('已导入');
    } finally { await source.engine.flush(); if (target) await target.engine.flush(); }
  });
  it('恢复模块未就绪时保留prepared凭据，接回模块后继续，不冒充已完成', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-automation-pending-')), source = await sourceFixture(directory); let target;
    try {
      let receiptProvider, automationProvider; target = await profile(path.join(directory, 'target'), { receiptProvider: () => receiptProvider, automationProvider: () => automationProvider }); const destination = path.join(directory, 'restore'); await fs.mkdir(destination);
      await expect(target.backup.importBackup({ filePath: source.archive, directory: destination })).rejects.toThrow('模型回执恢复模块');
      const filenames = await fs.readdir(path.join(directory, 'target', 'backup-imports-v1')), receiptFile = path.join(directory, 'target', 'backup-imports-v1', filenames[0]); expect(JSON.parse(await fs.readFile(receiptFile, 'utf8')).phase).toBe('prepared');
      receiptProvider = { importEntries: async () => undefined }; await expect(target.backup.pendingImports()).rejects.toThrow('自动化恢复模块'); automationProvider = { importEntries: async () => undefined }; expect(await target.backup.pendingImports()).toHaveLength(1); expect(JSON.parse(await fs.readFile(receiptFile, 'utf8')).phase).toBe('native-ready'); expect((await target.engine.snapshot()).ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(17);
    } finally { await source.engine.flush(); if (target) await target.engine.flush(); }
  });
});
