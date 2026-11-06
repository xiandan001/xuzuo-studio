import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aq3sAAAAASUVORK5CYII=', 'base64');
const FAKE_SECRET = 'owned-paid-output-fixture-only';
const base = path.resolve('work'), roots = [], services = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const durable = value => JSON.parse(JSON.stringify(value));

afterEach(async () => {
  for (const service of services.splice(0).reverse()) { await service.engine.shutdown(); await service.artifacts.drain(); }
  for (const directory of roots.splice(0)) {
    if (path.dirname(directory) !== base || !path.basename(directory).startsWith('paid-output-recovery-') || (await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('Unowned paid-output fixture');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function settled(engine, status) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const snapshot = await engine.snapshot();
    if (snapshot.runs[0]?.status === status) { await engine.drain(); return engine.snapshot(); }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error(`Paid-output fixture did not reach ${status}`);
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(base, 'paid-output-recovery-')); roots.push(directory);
  const profile = path.join(directory, 'profile'), workspace = path.join(directory, 'workspace');
  await fs.mkdir(profile); await fs.mkdir(workspace);
  const state = { phase: 'initial', fetches: [], secrets: [], requests: [], faultPaths: [], failed: false, projectDirectory: '' };
  const fileSystem = { ...fs, writeFile: async (filename, bytes, ...options) => {
    const target = path.resolve(filename);
    if (!state.failed && state.projectDirectory && path.dirname(target) === path.join(state.projectDirectory, 'files') && /-image-2_.*\.png$/.test(path.basename(target))) {
      state.failed = true; state.faultPaths.push(target); throw Object.assign(Error('Owned second PNG write failure'), { code: 'EIO' });
    }
    return fs.writeFile(filename, bytes, ...options);
  } };
  const credentials = {
    list: async () => [{ id: 'fixture-key-id', connectionId: 'connection', name: 'Owned metadata only', enabled: true }],
    withSecret: async (id, connectionId, action) => {
      state.secrets.push(state.phase);
      if (state.phase === 'cold') throw Error('Cold read must not request a secret');
      expect(id).toBe('fixture-key-id'); expect(connectionId).toBe('connection'); return action(FAKE_SECRET);
    },
  };
  const fetchImpl = async (url, input) => {
    state.fetches.push(state.phase);
    if (state.phase === 'cold') throw Error('Cold recovery must not send another request');
    expect(url).toBe('https://fixture.invalid/v1/images/generations'); expect(JSON.parse(input.body).n).toBe(2);
    return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }], usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 } }), { headers: { 'content-type': 'application/json', 'x-request-id': `paid-images-${state.fetches.length}` } });
  };
  function open() {
    const storage = createWorkspaceStorage({ directory: profile });
    const artifacts = createArtifactStore({ directory: path.join(profile, 'artifacts'), workspaceStorage: storage, fileSystem });
    storage.setArtifactMigrator((id, destination, options) => artifacts.migrateProject(id, destination, options));
    const runtime = createModelRuntime({ directory: profile, artifactStore: artifacts, credentialStore: credentials, fetchImpl });
    const execute = runtime.execute;
    runtime.execute = (request, options) => { state.requests.push(structuredClone(request)); return execute(request, options); };
    const engine = createLiveWorkflowEngine({ directory: profile, artifactStore: artifacts, credentials, modelRuntime: runtime, assertProjectAdmission: id => storage.assertNotPurged(id) });
    const service = { storage, artifacts, runtime, engine }; services.push(service); return service;
  }
  const first = open();
  await first.storage.bindRoot({ workspaceId: 'workspace', name: 'Owned output recovery', directory: workspace });
  const location = await first.storage.ensureProject({ workspaceId: 'workspace', projectId: 'project', name: 'Paid output' }); state.projectDirectory = location.directory;
  const project = { id: 'project', workspaceId: 'workspace', directory: location.directory, name: 'Paid output', kind: 'image', status: 'draft', description: '', costCents: 0, version: 0, updatedAt: '2026-11-06T00:00:00Z', accent: 'purple' };
  const request = {
    project,
    workflow: { id: 'flow', workspaceId: 'workspace', name: 'Two real output files', description: '', outputKind: 'image', updatedAt: project.updatedAt, steps: [{ id: 'images', name: 'Generate two images', kind: 'image-generation', prompt: 'Create two original product images', inputSource: 'project', modelConfigId: 'model', credentialId: 'fixture-key-id', count: 2, enabled: true }] },
    connections: [{ id: 'connection', name: 'In-memory response only', providerId: 'custom', protocol: 'image', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }],
    models: [{ id: 'model', name: 'Owned fixed price', modelId: 'fixture-image', connectionId: 'connection', enabled: true, capabilities: ['image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } }],
    input: 'Keep both original images', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
  };
  return { directory, profile, first, open, state, request };
}

describe('已计费用量、部分实物与持久回执的跨层恢复', () => {
  it('第二PNG写入EIO后冷读和同请求不重发，明确新尝试另收费且首账本与首图不变', async () => {
    const f = await fixture();
    await f.first.storage.assertProject('project');
    const started = await f.first.engine.start(f.request), failed = await settled(f.first.engine, 'failed');
    expect(f.state.fetches).toEqual(['initial']); expect(f.state.faultPaths).toHaveLength(1);
    const attempt = failed.runs[0].attempts[0], firstFee = durable(failed.ledger[0]);
    expect(attempt.status).toBe('failed'); expect(attempt.artifacts).toHaveLength(1);
    expect(firstFee).toMatchObject({ status: 'failed', costState: 'calculated', costCents: 20, workflowRunId: started.id, workflowAttemptId: attempt.id, usage: { images: 2, inputTokens: 4, outputTokens: 8, totalTokens: 12, providerRequestId: 'paid-images-1' } });
    expect(attempt.usage).toMatchObject(firstFee.usage);
    const original = await f.first.artifacts.read(attempt.artifacts[0].id), imageHash = hash(original.buffer);
    expect(original.buffer).toEqual(PNG); expect((await f.first.artifacts.listProject('project'))).toHaveLength(1);
    const receiptPath = path.join(f.profile, 'model-receipts-v1', `${attempt.id}.json`), receiptBytes = await fs.readFile(receiptPath), receiptHash = hash(receiptBytes);
    expect(JSON.parse(receiptBytes.toString('utf8'))).toMatchObject({ requestId: attempt.id, runId: started.id, projectId: 'project', status: 'started', requestStarted: true });
    expect(receiptBytes.toString('utf8')).not.toContain(FAKE_SECRET);
    const originalRequest = structuredClone(f.state.requests[0]);
    await f.first.engine.shutdown(); await f.first.artifacts.drain();

    f.state.phase = 'cold';
    const cold = f.open(), restored = await cold.engine.snapshot();
    expect(restored.runs[0].id).toBe(started.id); expect(restored.runs[0].status).toBe('failed');
    expect(durable(restored.ledger)).toEqual([firstFee]);
    expect((await cold.engine.runDetail(started.id)).attempts[0].artifacts).toEqual(attempt.artifacts);
    expect(hash((await cold.artifacts.read(original.id)).buffer)).toBe(imageHash);
    expect(await cold.runtime.recoverReceipt({ requestId: attempt.id, runId: started.id, projectId: 'project' })).toBeUndefined();
    await expect(cold.runtime.execute(originalRequest)).rejects.toThrow('不能自动重发');
    expect(f.state.fetches).toEqual(['initial']); expect(f.state.secrets).toEqual(['initial']);
    expect(hash(await fs.readFile(receiptPath))).toBe(receiptHash); expect(durable((await cold.engine.snapshot()).ledger)).toEqual([firstFee]);

    f.state.phase = 'retry';
    await cold.engine.control({ id: started.id, action: 'retry', stepId: 'images' });
    const completed = await settled(cold.engine, 'complete'), retry = completed.runs[0].attempts[1];
    expect(f.state.fetches).toEqual(['initial', 'retry']); expect(f.state.secrets).toEqual(['initial', 'retry']);
    expect(retry.id).not.toBe(attempt.id); expect(retry.status).toBe('complete'); expect(retry.artifacts).toHaveLength(2);
    expect(completed.ledger).toHaveLength(2); expect(durable(completed.ledger.find(row => row.id === firstFee.id))).toEqual(firstFee);
    expect(completed.ledger.find(row => row.workflowAttemptId === retry.id)).toMatchObject({ costCents: 20, status: 'complete', costState: 'calculated' });
    expect(completed.ledger.reduce((sum, row) => sum + row.costCents, 0)).toBe(40);
    expect(hash((await cold.artifacts.read(original.id)).buffer)).toBe(imageHash); expect(await cold.artifacts.listProject('project')).toHaveLength(3);
    expect(hash(await fs.readFile(receiptPath))).toBe(receiptHash);
    const retryReceipt = JSON.parse(await fs.readFile(path.join(f.profile, 'model-receipts-v1', `${retry.id}.json`), 'utf8'));
    expect(retryReceipt).toMatchObject({ requestId: retry.id, status: 'complete', requestStarted: true });
    expect(retryReceipt.result.artifacts).toHaveLength(2); expect(retryReceipt.result.usage.images).toBe(2);
  });
});
