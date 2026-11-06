import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { persistBackupImport } from './data-management';
import { initialConfiguration } from './configuration';
import { CONFIGURATION_KEY } from './configuration-storage';
import { readWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { projectQuoteKey, readProjectQuote, saveProjectQuote } from './project-quotes';
import { quoteWorkingKey, readQuoteWorkingDraft, saveQuoteWorkingDraft } from './quote-working-drafts';
import { collectQuoteBackups } from './quote-backup';
import { emptyCustomerQuote } from './customer-quote';
import { INITIAL_PREFERENCES } from '../data';

const require = createRequire(import.meta.url), repository = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = createRequire(path.join(repository, 'work/ui-build/package.json'));
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createModelReceipts } = require('../../electron/model-receipts.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs');
const { calculateCost } = require('../../electron/live-cost.cjs');
const base = path.resolve('work'), roots = [], profiles = [], stamp = '2026-11-07T00:00:00Z';
const clone = value => structuredClone(value), durable = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const financialFields = row => Object.fromEntries(['calculation', 'pricingSnapshot', 'fxSnapshot'].filter(key => row[key] !== undefined).map(key => [key, row[key]]));

afterEach(async () => {
  for (const profile of profiles.splice(0).reverse()) { await profile.backup.flush(); await profile.engine.shutdown(); await profile.artifacts.drain(); }
  for (const directory of roots.splice(0)) {
    if (path.dirname(directory) !== base || !path.basename(directory).startsWith('financial-import-') || (await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('Unowned financial-import fixture');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return { values, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } };
}

async function fileTree(directory) {
  const files = [];
  async function visit(current, relative) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw Error('Financial fixture cannot follow links');
      const filename = path.join(current, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(filename, name);
      else { if (!entry.isFile()) throw Error('Unexpected financial fixture entry'); files.push({ path: name, sha256: hash(await fs.readFile(filename)) }); }
    }
  }
  await visit(directory, ''); return files;
}

async function openProfile(directory, counters) {
  await fs.mkdir(directory, { recursive: true });
  const storage = createWorkspaceStorage({ directory });
  const artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, destination, options) => artifacts.migrateProject(id, destination, options));
  const receipts = createModelReceipts({ directory, artifactStore: artifacts });
  const forbidden = name => async () => { counters[name]++; throw Error(`Synthetic financial restore cannot ${name}`); };
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: { list: forbidden('secret'), get: forbidden('secret'), withSecret: forbidden('secret') }, modelRuntime: { supports: () => false, execute: forbidden('execute'), recoverReceipt: receipts.recoverReceipt } });
  const backup = createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: dependencies, receiptProvider: { backupEntries: async scope => receipts.backupEntries({ ...scope, availableRuns: (await engine.snapshot()).runs }), importEntries: input => receipts.importEntries(input) } });
  const profile = { directory, storage, artifacts, receipts, engine, backup }; profiles.push(profile); return profile;
}

async function sourceFixture(directory, counters) {
  const source = await openProfile(path.join(directory, 'source-profile'), counters), workspaceDirectory = path.join(directory, 'source-workspace');
  await fs.mkdir(workspaceDirectory);
  const workspace = { id: 'source-workspace', name: 'Synthetic 金额恢复', description: 'Synthetic controlled history; no account or provider', directory: workspaceDirectory, createdAt: stamp };
  await source.storage.bindRoot({ workspaceId: workspace.id, name: workspace.name, directory: workspace.directory });
  const location = await source.storage.ensureProject({ projectId: 'source-project', workspaceId: workspace.id, name: 'Synthetic 历史项目' });
  const project = { id: 'source-project', workspaceId: workspace.id, name: 'Synthetic 历史项目', directory: location.directory, kind: 'word', status: 'draft', description: 'Synthetic records, not recovered real-account billing', updatedAt: stamp, costCents: 22, version: 1, accent: 'purple' };
  const workflow = { id: 'source-flow', workspaceId: workspace.id, name: 'Synthetic 历史流程', description: 'Stored historical calls only', outputKind: 'word', updatedAt: stamp, steps: ['usd', 'cny'].map(currency => ({ id: `step-${currency}`, name: `Synthetic ${currency}`, kind: 'text', prompt: 'Synthetic historical result', inputSource: 'project', enabled: true })) };
  const fx = { base: 'USD', quote: 'CNY', rate: '6.661635220126', date: '2026-10-29', source: 'https://synthetic.invalid/frozen-fx', kind: 'reference' };
  const amounts = [{ currency: 'USD', amount: '0.00603', cny: '0.04016966037735978', cents: 5 }, { currency: 'CNY', amount: '0.17', cny: '0.17', cents: 17 }];
  const artifacts = [], attempts = [], ledger = [];
  for (const [index, item] of amounts.entries()) {
    const name = item.currency.toLowerCase(), attemptId = `attempt-${name}`, providerRequestId = `synthetic-provider-${name}`;
    const artifact = await source.artifacts.write({ projectId: project.id, runId: 'source-run', name: `synthetic-${name}.txt`, mimeType: 'text/plain', text: `Synthetic historical ${item.currency} result END-${name}` }); artifacts.push(artifact);
    const usage = { inputTokens: 100, outputTokens: 17, totalTokens: 117, providerRequestId };
    const pricingSnapshot = { unit: 'request', currency: item.currency, input: '0', output: item.amount };
    const priced = calculateCost(pricingSnapshot, usage, { operation: 'text', startedAt: stamp, fx: clone(fx) });
    expect(priced).toMatchObject({ costState: 'calculated', costCents: item.cents, calculation: { completeness: 'complete', nativeCurrency: item.currency, nativeAmount: item.amount, cnyAmount: item.cny } });
    if (item.currency === 'USD') expect(priced.calculation.fx).toEqual(fx);
    const calculation = priced.calculation;
    ledger.push({ id: `fee-${name}`, projectId: project.id, projectName: project.name, workflowRunId: 'source-run', workflowAttemptId: attemptId, workflowStepId: workflow.steps[index].id, action: '初次生成', model: 'Synthetic historical model', billingMode: 'live', status: 'complete', costState: priced.costState, costCents: priced.costCents, costReason: priced.reason, time: stamp, quantity: 1, usage, pricingSnapshot, calculation, ...(item.currency === 'USD' ? { fxSnapshot: clone(fx) } : {}) });
    attempts.push({ id: attemptId, stepId: workflow.steps[index].id, stepName: workflow.steps[index].name, modelLabel: 'Synthetic historical model', status: 'complete', costState: priced.costState, costCents: priced.costCents, action: '初次生成', summary: `Synthetic ${item.currency} received`, input: 'Synthetic input', prompt: 'Synthetic prompt', artifacts: [artifact], usage, calculation, startedAt: stamp });
    // Only persist labelled historical fixture data; no provider client or credential vault is constructed.
    await source.receipts.execute({ requestId: attemptId, runId: 'source-run', projectId: project.id, connection: { providerId: 'synthetic', baseUrl: 'https://synthetic.invalid/unused' }, model: { modelId: `synthetic-${name}` }, kind: 'text', prompt: 'Stored synthetic result', input: 'Synthetic input', attachments: [], options: {} }, async () => ({ text: `Synthetic ${item.currency} received`, artifacts: [artifact], usage, providerRequestId }));
  }
  const run = { id: 'source-run', mode: 'live', workspaceId: workspace.id, projectId: project.id, workflowId: workflow.id, workflowName: workflow.name, snapshot: workflow, status: 'complete', stepIndex: 2, attempts, input: 'Synthetic input', variables: {}, createdAt: stamp, updatedAt: stamp, completedAt: stamp };
  await source.engine.importRecords([{ run, request: { project, workflow, connections: [], models: [], input: 'Synthetic input', variables: {}, attachmentIds: [] }, ledger, legacyBaseCostCents: 0 }]);

  const quotes = memoryStorage(), inputs = { minutes: '30', rate: '60', remaining: '0', other: '0', reserve: '0', fee: '10', profit: '20', price: '19.90', variable: '0' };
  const customer = { ...emptyCustomerQuote(), client: 'Synthetic 客户', scope: 'Synthetic two historical results' };
  const saved = { type: 'xuzuo-project-quote', version: 1, workspaceId: workspace.id, projectId: project.id, project: project.name, inputs, mode: 'single', scope: 'live', savedAt: stamp, customer, apiCostCents: 22, apiCostCnyAmount: '0.21016966037735978', nativeApiCosts: { USD: '0.00603', CNY: '0.17' } };
  const savedRaw = saveProjectQuote(quotes.storage, saved, null);
  const workingRaw = saveQuoteWorkingDraft(quotes.storage, { type: 'xuzuo-quote-working', version: 1, workspaceId: workspace.id, projectId: project.id, inputs: { ...inputs, minutes: '45' }, mode: 'single', scope: 'live', customer, baseSavedRaw: savedRaw, updatedAt: stamp }, null);
  const configuration = { categories: [], workflows: [workflow], connections: [], models: [], studioActions: [], useTemplates: [] };
  const meta = { workspaces: [workspace], projects: [project], ledger: durable((await source.engine.snapshot()).ledger), customPrompts: [], preferencesByWorkspace: { [workspace.id]: { ...INITIAL_PREFERENCES, studioName: workspace.name } }, configuration, quoteDrafts: collectQuoteBackups(quotes.storage, [project]) };
  await source.engine.flush(); await source.artifacts.drain();
  const before = { profile: await fileTree(source.directory), workspace: await fileTree(workspaceDirectory) }, archive = path.join(directory, 'synthetic-financial.zip');
  await source.backup.exportBackup({ meta, workspaceIds: [workspace.id], projectIds: [project.id], filePath: archive });
  return { source, workspace, project, artifacts, ledger: meta.ledger, quotes, savedRaw, workingRaw, customer, meta, before, archive, zipHash: hash(await fs.readFile(archive)) };
}

describe('Synthetic 非空金额ZIP到renderer提交和ACK的恢复链', () => {
  it('第二业务写入失败回滚，原backupId重放与冷读不重复账本并保留冻结原币和报价基线', async () => {
    const directory = await fs.mkdtemp(path.join(base, 'financial-import-')); roots.push(directory);
    const counters = { execute: 0, secret: 0 }, f = await sourceFixture(directory, counters);
    const zip = await dependencies('jszip').loadAsync(await fs.readFile(f.archive)), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    expect(manifest.meta.ledger).toHaveLength(2); expect(manifest.records).toHaveLength(1); expect(manifest.records[0].run.attempts).toHaveLength(2); expect(manifest.modelReceipts.records).toHaveLength(2); expect(manifest.automations).toBeUndefined();
    expect(manifest.meta.quoteDrafts[0].working.baseSavedMatchesCurrent).toBe(true); expect(JSON.stringify(manifest)).not.toContain('baseSavedRaw');
    const target = await openProfile(path.join(directory, 'target-profile'), counters), destination = path.join(directory, 'restore'); await fs.mkdir(destination);
    const imported = await target.backup.importBackup({ filePath: f.archive, directory: destination });
    expect(JSON.parse(await fs.readFile(imported.receiptPath, 'utf8')).phase).toBe('native-ready');
    const mappedProject = imported.idMap[f.project.id], mappedWorkspace = imported.idMap[f.workspace.id], mappedRun = imported.idMap['source-run'];
    const mappedLedger = f.ledger.map(row => ({ ...clone(row), id: imported.idMap[row.id], projectId: mappedProject, workflowRunId: mappedRun, workflowStepId: imported.idMap[row.workflowStepId], workflowAttemptId: imported.idMap[row.workflowAttemptId] }));
    const frozen = f.ledger.map(row => hash(JSON.stringify(financialFields(row))));
    expect(durable((await target.engine.snapshot()).ledger)).toEqual(mappedLedger);
    expect(imported.meta.ledger).toEqual(mappedLedger);

    const current = { activeWorkspaceId: 'existing-workspace', workspaces: [{ id: 'existing-workspace', name: 'Existing owned workspace', description: '', createdAt: stamp }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: { 'existing-workspace': { ...INITIAL_PREFERENCES } } };
    const ui = memoryStorage([[WORKSPACE_STORAGE_KEY, JSON.stringify(current)], [CONFIGURATION_KEY, JSON.stringify(initialConfiguration())]]), beforeWorkspace = ui.storage.getItem(WORKSPACE_STORAGE_KEY), beforeConfiguration = ui.storage.getItem(CONFIGURATION_KEY);
    let fail = true, configurationWrittenBeforeFailure = false;
    const failingStorage = { ...ui.storage, setItem: (key, value) => {
      if (fail && key === WORKSPACE_STORAGE_KEY && value.includes(mappedProject)) { fail = false; configurationWrittenBeforeFailure = ui.storage.getItem(CONFIGURATION_KEY) !== beforeConfiguration; throw Error('Synthetic second business write failure'); }
      ui.storage.setItem(key, value);
    } };
    expect(() => persistBackupImport(failingStorage, current, imported)).toThrow('重新保存恢复登记');
    expect(configurationWrittenBeforeFailure).toBe(true); expect(ui.storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(beforeWorkspace); expect(ui.storage.getItem(CONFIGURATION_KEY)).toBe(beforeConfiguration);
    const journalKey = `xuzuo-import-${imported.backupId}`;
    expect(JSON.parse(ui.storage.getItem(journalKey))).toMatchObject({ backupId: imported.backupId, beforeWorkspace, beforeConfiguration });
    expect(JSON.parse(ui.storage.getItem(journalKey)).quoteWrites).toHaveLength(2);
    expect(ui.storage.getItem(projectQuoteKey(mappedWorkspace, mappedProject))).toBeNull(); expect(ui.storage.getItem(quoteWorkingKey(mappedWorkspace, mappedProject))).toBeNull();
    expect(JSON.parse(await fs.readFile(imported.receiptPath, 'utf8')).phase).toBe('native-ready'); expect(durable((await target.engine.snapshot()).ledger)).toEqual(mappedLedger);

    const pending = await target.backup.pendingImports(); expect(pending).toHaveLength(1); expect(pending[0].backupId).toBe(imported.backupId); expect(pending[0].idMap).toEqual(imported.idMap);
    const replay = await target.backup.importBackup({ filePath: f.archive, directory: destination }); expect(replay.backupId).toBe(imported.backupId); expect(replay.idMap).toEqual(imported.idMap);
    const once = persistBackupImport(ui.storage, readWorkspaceState(ui.storage).state, replay), twice = persistBackupImport(ui.storage, readWorkspaceState(ui.storage).state, replay);
    expect(once.ledger).toEqual(mappedLedger); expect(twice.ledger).toEqual(mappedLedger); expect(twice.projects).toHaveLength(1); expect(twice.activeWorkspaceId).toBe(current.activeWorkspaceId); expect(ui.storage.getItem(journalKey)).toBeNull();
    const saved = readProjectQuote(ui.storage, mappedWorkspace, mappedProject), working = readQuoteWorkingDraft(ui.storage, mappedWorkspace, mappedProject);
    expect(saved.error).toBeUndefined(); expect(working.error).toBeUndefined(); expect(saved.draft.inputs.minutes).toBe('30'); expect(working.draft.inputs.minutes).toBe('45'); expect(working.draft.baseSavedRaw).toBe(saved.raw);
    expect(saved.draft.customer).toEqual(f.customer); expect(working.draft.customer).toEqual(f.customer);
    expect(saved.draft).toMatchObject({ projectId: mappedProject, workspaceId: mappedWorkspace, nativeApiCosts: { USD: '0.00603', CNY: '0.17' }, apiCostCnyAmount: '0.21016966037735978' });
    expect(() => saveProjectQuote(ui.storage, saved.draft, f.savedRaw)).toThrow('另一处变化'); expect(ui.storage.getItem(projectQuoteKey(mappedWorkspace, mappedProject))).toBe(saved.raw);
    await target.backup.acknowledgeImport(imported.backupId); expect(JSON.parse(await fs.readFile(imported.receiptPath, 'utf8')).phase).toBe('acknowledged');
    await target.backup.flush(); await target.engine.shutdown(); await target.artifacts.drain();

    const cold = await openProfile(target.directory, counters), coldSnapshot = await cold.engine.snapshot();
    expect(durable(coldSnapshot.ledger)).toEqual(mappedLedger); expect(coldSnapshot.runs).toHaveLength(1); expect(coldSnapshot.runs[0]).toMatchObject({ id: mappedRun, projectId: mappedProject, workspaceId: mappedWorkspace, status: 'complete' }); expect(coldSnapshot.runs[0].attempts.map(attempt => attempt.id)).toEqual(['attempt-usd', 'attempt-cny'].map(id => imported.idMap[id])); expect(await cold.backup.pendingImports()).toEqual([]);
    await expect(cold.backup.importBackup({ filePath: f.archive, directory: destination })).rejects.toThrow('已导入');
    for (const [index, row] of coldSnapshot.ledger.entries()) expect(hash(JSON.stringify(financialFields(row)))).toBe(frozen[index]);
    for (const [index, original] of f.artifacts.entries()) {
      const receipt = await cold.receipts.recoverReceipt({ requestId: imported.idMap[`attempt-${index === 0 ? 'usd' : 'cny'}`], runId: mappedRun, projectId: mappedProject });
      expect(receipt.artifacts).toHaveLength(1); expect(receipt.artifacts[0].id).toBe(imported.idMap[original.id]); expect(receipt.artifacts[0].projectId).toBe(mappedProject); expect(receipt.artifacts[0].runId).toBe(mappedRun); expect(receipt.usage).toEqual(f.ledger[index].usage);
      expect(hash((await cold.artifacts.read(receipt.artifacts[0].id)).buffer)).toBe(hash((await f.source.artifacts.read(original.id)).buffer));
    }
    expect((await fs.readdir(path.join(cold.directory, 'model-receipts-v1'))).filter(name => name.endsWith('.json'))).toHaveLength(2);
    // This rehydrates a Storage adapter from the exact stored strings; it is not a Chromium cold-profile claim.
    const coldUi = memoryStorage([...ui.values]); expect(readWorkspaceState(coldUi.storage).state.ledger).toEqual(mappedLedger); expect(readProjectQuote(coldUi.storage, mappedWorkspace, mappedProject).raw).toBe(saved.raw); expect(readQuoteWorkingDraft(coldUi.storage, mappedWorkspace, mappedProject).draft.baseSavedRaw).toBe(saved.raw);
    expect(await fileTree(f.source.directory)).toEqual(f.before.profile); expect(await fileTree(f.workspace.directory)).toEqual(f.before.workspace); expect(hash(await fs.readFile(f.archive))).toBe(f.zipHash); expect(f.quotes.storage.getItem(projectQuoteKey(f.workspace.id, f.project.id))).toBe(f.savedRaw); expect(f.quotes.storage.getItem(quoteWorkingKey(f.workspace.id, f.project.id))).toBe(f.workingRaw);
    expect(counters).toEqual({ execute: 0, secret: 0 });
  });
});
