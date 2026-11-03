import { readLiveHistory, writeLiveHistory } from './live-history-test-helper';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const engines = [];
afterEach(async () => { for (const engine of engines.splice(0)) await engine.shutdown(); });
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
function request(projectId = 'review-project', replacementId) {
  return {
    project: { id: projectId, workspaceId: 'review-workspace', name: '隔离测试', kind: 'word', costCents: 0 },
    workflow: { id: `flow-${projectId}`, workspaceId: 'review-workspace', name: '保留旧成果再精修', outputKind: 'word', steps: [
      { id: 'draft', name: '生成正文', kind: 'text', prompt: '生成初稿', modelConfigId: 'model', credentialId: 'metadata-only', inputSource: 'project', enabled: true },
      { id: 'review', name: '检查正文', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true },
      { id: 'later-model', name: '旧流程后续付费步骤', kind: 'text', prompt: '旧流程后续步骤', modelConfigId: 'model', credentialId: 'metadata-only', inputSource: 'previous', enabled: true },
      { id: 'later-review', name: '再次检查', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true },
      { id: 'later-export', name: '旧流程后续导出', kind: 'export', prompt: '', inputSource: 'previous', enabled: true },
    ] },
    connections: [{ id: 'connection', name: '无网络测试连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://isolated.invalid/v1', enabled: true }],
    models: [{ id: 'model', name: '内存测试模型', modelId: 'fixture', connectionId: 'connection', capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' }, enabled: true }],
    input: '仅本地固定数据，不发送任何网络请求。', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
    ...(replacementId === undefined ? {} : { replaceWaitingReviewRunId: replacementId }),
  };
}
function refinement(id, projectId) { const input = request(projectId, id); input.workflow.steps = input.workflow.steps.slice(0, 2); input.workflow.steps[0].prompt = '新一轮精修'; return input; }
async function waitFor(engine, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const snapshot = await engine.snapshot(); if (predicate(snapshot)) return snapshot; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('isolated replacement test deadline exceeded');
}
async function fixture({ fileSystem = fs, execute } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-review-replacement-'));
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts') });
  const calls = [];
  let validationGate;
  const options = { directory, fileSystem, artifactStore: store,
    credentials: { list: async () => { const gate = validationGate; validationGate = undefined; if (gate) { gate.entered.resolve(); await gate.release.promise; } return [{ id: 'metadata-only', connectionId: 'connection', enabled: true, name: '仅凭证元数据，无Key' }]; } },
    modelRuntime: { supports: () => true, execute: async (input, controls) => {
      calls.push(input);
      if (execute) await execute(input, controls);
      const text = `${input.prompt}：完整保留的固定正文。`;
      return { text, usage: { inputTokens: 100, outputTokens: 50 }, artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: '固定正文.txt', mimeType: 'text/plain', text })] };
    } },
  };
  const engine = createLiveWorkflowEngine(options); engines.push(engine);
  return { engine, options, directory, store, calls, gateValidation: () => { validationGate = { entered: deferred(), release: deferred() }; return validationGate; } };
}
async function waiting(f) { const run = await f.engine.start(request()); const snapshot = await waitFor(f.engine, value => value.runs.find(item => item.id === run.id)?.status === 'waiting-review'); return { run: snapshot.runs.find(item => item.id === run.id), snapshot }; }
const active = snapshot => snapshot.runs.filter(run => ['running', 'paused', 'waiting-review'].includes(run.status));

describe('待检查流程的原子替代', () => {
  it('仅取消旧人工检查并启动新精修，旧正文/产物/账本保留且旧tail不执行，重开保持关系', async () => {
    const f = await fixture(), before = await waiting(f), originalFile = before.run.attempts[0].artifacts[0];
    const originalBytes = (await f.store.read(originalFile.id)).buffer;
    const next = await f.engine.start(refinement(before.run.id));
    const snapshot = await waitFor(f.engine, value => value.runs.find(run => run.id === next.id)?.status === 'waiting-review');
    const old = snapshot.runs.find(run => run.id === before.run.id);
    expect(old).toMatchObject({ status: 'cancelled', stepIndex: before.run.stepIndex, supersededByRunId: next.id });
    expect(next.supersedesRunId).toBe(old.id); expect(old.attempts[0]).toEqual(before.run.attempts[0]);
    expect(old.attempts[1]).toMatchObject({ status: 'cancelled', summary: expect.stringContaining('后续步骤未执行') });
    expect(old.attempts).toHaveLength(2); expect(f.calls.map(call => call.prompt)).toEqual(['生成初稿', '新一轮精修']);
    expect(snapshot.ledger.filter(entry => entry.workflowRunId === old.id)).toEqual(before.snapshot.ledger);
    expect((await f.store.read(originalFile.id)).buffer).toEqual(originalBytes);
    expect(active(snapshot)).toHaveLength(1);
    await f.engine.shutdown(); const reopened = createLiveWorkflowEngine(f.options); engines.push(reopened);
    const restored = await reopened.snapshot(); expect(restored.runs.find(run => run.id === old.id)).toEqual(old);
    expect(restored.runs.find(run => run.id === next.id).supersedesRunId).toBe(old.id);
    expect(restored.ledger).toEqual(snapshot.ledger); expect(f.calls).toHaveLength(2);
  });

  it('预检失败或未授权不会改变旧待检查状态、费用与产物', async () => {
    const f = await fixture(), before = await waiting(f);
    const invalid = refinement(before.run.id); invalid.workflow.steps[0].credentialId = undefined;
    await expect(f.engine.start(invalid)).rejects.toThrow('API Key');
    const unacknowledged = refinement(before.run.id); unacknowledged.acknowledgePaidCalls = false;
    await expect(f.engine.start(unacknowledged)).rejects.toThrow('确认');
    const unknown = refinement(before.run.id); unknown.models[0].pricing = { unit: 'million-tokens', currency: 'CNY', input: '', output: '' }; unknown.acknowledgeUnknownCost = false;
    await expect(f.engine.start(unknown)).rejects.toThrow('确认');
    const after = await f.engine.snapshot(); expect(after.runs).toEqual(before.snapshot.runs); expect(after.ledger).toEqual(before.snapshot.ledger); expect(f.calls).toHaveLength(1);
  });

  it('未指定替代、错误ID/项目/工作区以及已取消旧ID均拒绝', async () => {
    const f = await fixture(), before = await waiting(f);
    await expect(f.engine.start(refinement(undefined))).rejects.toThrow('已有真实运行');
    for (const id of ['', 'missing', 42]) await expect(f.engine.start(refinement(id))).rejects.toThrow('待检查任务已变化');
    await expect(f.engine.start(refinement(before.run.id, 'other-project'))).rejects.toThrow('待检查任务已变化');
    const wrongWorkspace = refinement(before.run.id); wrongWorkspace.project.workspaceId = 'other-workspace'; wrongWorkspace.workflow.workspaceId = 'other-workspace';
    await expect(f.engine.start(wrongWorkspace)).rejects.toThrow('待检查任务已变化');
    expect((await f.engine.snapshot()).runs).toEqual(before.snapshot.runs);
    await f.engine.control({ id: before.run.id, action: 'cancel' }); const cancelled = await f.engine.snapshot();
    await expect(f.engine.start(refinement(before.run.id))).rejects.toThrow('待检查任务已变化');
    expect((await f.engine.snapshot()).runs).toEqual(cancelled.runs); expect(f.calls).toHaveLength(1);
  });

  it('真正running及paused不能被替代，不会中断或重复已有请求', async () => {
    const entered = deferred(), release = deferred(); let aborted = false;
    const f = await fixture({ execute: async (_input, { signal }) => { signal.addEventListener('abort', () => { aborted = true; }); entered.resolve(); await release.promise; } });
    const run = await f.engine.start(request()); await entered.promise;
    await expect(f.engine.start(refinement(run.id))).rejects.toThrow('待检查任务已变化');
    expect((await f.engine.snapshot()).runs[0].status).toBe('running'); expect(aborted).toBe(false);
    await f.engine.control({ id: run.id, action: 'pause' }); release.resolve();
    const paused = await waitFor(f.engine, value => value.runs[0]?.status === 'paused');
    await expect(f.engine.start(refinement(run.id))).rejects.toThrow('待检查任务已变化');
    expect((await f.engine.snapshot()).runs).toEqual(paused.runs); expect(aborted).toBe(false); expect(f.calls).toHaveLength(1);
  });

  it('单次写入或rename失败均不提交旧取消/新任务，写队列恢复后仍可启动', async () => {
    for (const operation of ['writeFile', 'rename']) {
      const reviewEntered = deferred(), reviewRelease = deferred(), replacementFiles = new Set();
      let fail = false, heldReview = false, injected = 0;
      const fileSystem = { ...fs,
        writeFile: async (filename, contents, options) => {
          const records = JSON.parse(contents).records;
          const replacing = records.some(item => item.run.supersedesRunId);
          if (replacing) replacementFiles.add(filename);
          if (!replacing && !heldReview && records.some(item => item.run.status === 'waiting-review')) { heldReview = true; reviewEntered.resolve(); await reviewRelease.promise; }
          if (fail && operation === 'writeFile' && replacing) { fail = false; injected++; throw Object.assign(new Error('owned replacement write failure'), { code: 'EIO' }); }
          return fs.writeFile(filename, contents, options);
        },
        rename: async (...args) => { if (fail && operation === 'rename' && replacementFiles.has(args[0])) { fail = false; injected++; throw Object.assign(new Error('owned replacement rename failure'), { code: 'EIO' }); } return fs.rename(...args); },
      };
      const f = await fixture({ fileSystem }), before = await waiting(f); await reviewEntered.promise; fail = true;
      const replacing = f.engine.start(refinement(before.run.id)); reviewRelease.resolve();
      await expect(replacing).rejects.toThrow('未开始新请求'); expect(injected).toBe(1);
      const after = await f.engine.snapshot(); expect(after.runs).toEqual(before.snapshot.runs); expect(after.ledger).toEqual(before.snapshot.ledger); expect(f.calls).toHaveLength(1);
      const disk = await readLiveHistory(f.directory);
      expect(disk.records).toHaveLength(1); expect(disk.records[0].run).toEqual(before.run);
      const next = await f.engine.start(refinement(before.run.id)); await waitFor(f.engine, value => value.runs.find(run => run.id === next.id)?.status === 'waiting-review'); expect(f.calls).toHaveLength(2);
    }
  });

  it('替代rename期间的费用更新不会被旧run快照覆盖，落盘后费用和attempt仍一致', async () => {
    const entered = deferred(), release = deferred(), replacementFiles = new Set(); let gated = false, armed = false;
    const fileSystem = { ...fs,
      writeFile: async (filename, contents, options) => { if (JSON.parse(contents).records.some(item => item.run.supersedesRunId)) replacementFiles.add(filename); return fs.writeFile(filename, contents, options); },
      rename: async (...args) => { if (armed && !gated && replacementFiles.has(args[0])) { gated = true; entered.resolve(); await release.promise; } return fs.rename(...args); },
    };
    const f = await fixture({ fileSystem }), before = await waiting(f); armed = true;
    const started = f.engine.start(refinement(before.run.id)); await entered.promise;
    expect((await f.engine.snapshot()).runs).toEqual(before.snapshot.runs);
    const reconciled = f.engine.reconcile({ entryId: before.snapshot.ledger[0].id, costCents: 77 });
    await waitFor(f.engine, value => value.ledger[0]?.costCents === 77); release.resolve();
    const next = await started; await reconciled; const after = await waitFor(f.engine, value => value.runs.find(run => run.id === next.id)?.status === 'waiting-review');
    const entry = after.ledger.find(item => item.id === before.snapshot.ledger[0].id), old = after.runs.find(item => item.id === before.run.id);
    expect(entry).toMatchObject({ costCents: 77, costState: 'manual' }); expect(old.attempts[0]).toMatchObject({ costCents: 77, costState: 'manual' }); expect(old.status).toBe('cancelled');
    const disk = await readLiveHistory(f.directory); const saved = disk.records.find(item => item.run.id === old.id);
    expect(saved.ledger[0].costCents).toBe(77); expect(saved.run.attempts[0].costCents).toBe(77);
  });

  it('其它项目排队持久时不会保存替代事务的失败临时态', async () => {
    const entered = deferred(), release = deferred(); let armed = false, failed = false;
    const fileSystem = { ...fs, writeFile: async (filename, contents, options) => {
      if (armed && !failed && JSON.parse(contents).records.some(item => item.run.supersededByRunId)) { failed = true; entered.resolve(); await release.promise; throw Object.assign(new Error('owned transaction failure'), { code: 'EIO' }); }
      return fs.writeFile(filename, contents, options);
    } };
    const f = await fixture({ fileSystem }), before = await waiting(f); armed = true;
    const replacing = f.engine.start(refinement(before.run.id)).then(() => undefined, error => error); await entered.promise;
    const other = f.engine.start(refinement(undefined, 'independent-project')); release.resolve();
    expect((await replacing).message).toContain('未开始新请求'); const otherRun = await other;
    await waitFor(f.engine, value => value.runs.find(run => run.id === otherRun.id)?.status === 'waiting-review');
    const disk = await readLiveHistory(f.directory);
    expect(disk.records).toHaveLength(2); expect(disk.records.find(item => item.run.id === before.run.id).run).toEqual(before.run);
    expect(disk.records.some(item => item.run.supersedesRunId || item.run.supersededByRunId)).toBe(false); expect(f.calls).toHaveLength(2);
  });

  it('同时替代同一旧流程时只有一个新流程成功，失败方不重复调用', async () => {
    const f = await fixture(), before = await waiting(f);
    const results = await Promise.allSettled([f.engine.start(refinement(before.run.id)), f.engine.start(refinement(before.run.id))]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    const next = results.find(item => item.status === 'fulfilled').value;
    const after = await waitFor(f.engine, value => value.runs.find(run => run.id === next.id)?.status === 'waiting-review');
    expect(active(after)).toHaveLength(1); expect(after.runs).toHaveLength(2); expect(f.calls).toHaveLength(2);
  });

  it('resume先占锁则精修不能替代已开始的旧后续流程', async () => {
    const f = await fixture(), before = await waiting(f), gate = f.gateValidation();
    const resuming = f.engine.control({ id: before.run.id, action: 'resume' }); await gate.entered.promise;
    const replacing = f.engine.start(refinement(before.run.id)).then(() => undefined, error => error); gate.release.resolve();
    await resuming; expect((await replacing).message).toContain('待检查任务已变化');
    const after = await waitFor(f.engine, value => value.runs[0]?.status === 'waiting-review' && value.runs[0].stepIndex === 3);
    expect(after.runs).toHaveLength(1); expect(after.runs[0].supersededByRunId).toBeUndefined(); expect(active(after)).toHaveLength(1);
    expect(f.calls.map(call => call.prompt)).toEqual(['生成初稿', '旧流程后续步骤']);
  });

  it('替代先占锁则旧resume不会启动任何旧后续步骤，且其它项目不受同项目锁阻塞', async () => {
    const f = await fixture(), before = await waiting(f), gate = f.gateValidation();
    const replacing = f.engine.start(refinement(before.run.id)); await gate.entered.promise;
    const resuming = f.engine.control({ id: before.run.id, action: 'resume' }).then(() => undefined, error => error);
    const otherRun = await f.engine.start(refinement(undefined, 'independent-project')); await waitFor(f.engine, value => value.runs.find(run => run.id === otherRun.id)?.status === 'waiting-review');
    gate.release.resolve(); const next = await replacing; expect((await resuming).message).toContain('当前状态不能');
    const after = await waitFor(f.engine, value => value.runs.find(run => run.id === next.id)?.status === 'waiting-review');
    expect(f.calls.some(call => call.prompt === '旧流程后续步骤')).toBe(false); expect(active(after).filter(run => run.projectId === before.run.projectId)).toHaveLength(1); expect(after.ledger.filter(entry => entry.workflowRunId === before.run.id)).toEqual(before.snapshot.ledger);
  });

  it('异常待检查结构、隐藏或回收任务不能被静默替代', async () => {
    const f = await fixture(), before = await waiting(f); await f.engine.shutdown();
    const original = await readLiveHistory(f.directory);
    for (const mutate of [run => { run.snapshot.steps[run.stepIndex].kind = 'text'; }, run => { run.attempts.at(-1).status = 'cancelled'; }, run => { run.hiddenAt = '2026-10-30'; }, run => { run.trashedAt = '2026-10-30'; }]) {
      const contents = structuredClone(original); mutate(contents.records[0].run); await writeLiveHistory(f.directory, contents);
      const engine = createLiveWorkflowEngine(f.options); engines.push(engine); const prior = await engine.snapshot();
      await expect(engine.start(refinement(before.run.id))).rejects.toThrow('待检查任务已变化'); expect((await engine.snapshot()).runs).toEqual(prior.runs); await engine.shutdown();
    }
    expect(f.calls).toHaveLength(1);
  });
});
