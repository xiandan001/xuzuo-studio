import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { ModelRuntimeError } = require('../../electron/provider-http.cjs');
const { request, dependencies, until } = require('./production-test-fixtures.cjs');

async function fixture(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-recovery-'));
  const requestInput = request();
  const [text, manual, output] = requestInput.workflow.steps;
  requestInput.workflow.steps = [text, output, manual];
  requestInput.workflow.automaticRecovery = true;
  requestInput.models[0].pricing = { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '1000' };
  const state = { blockedRenames: 0, blockCount: 0, calls: [], unavailable: false, receiptBeforeError: false, receipts: new Map(), renders: 0 };
  const store = createArtifactStore({
    directory: path.join(directory, 'artifacts'), loadModule: dependencies,
    fileSystem: { ...fs, async rename(from, to) {
      if (state.blockCount && path.basename(to) === 'manifest-v1.json') {
        const staged = JSON.parse(await fs.readFile(from, 'utf8'));
        if (staged.artifacts.at(-1).name.includes('检查报告')) {
          ++state.blockedRenames; --state.blockCount;
          throw Object.assign(Error('fixture: manifest lock'), { code: 'EBUSY' });
        }
      }
      return fs.rename(from, to);
    } },
    renderOffice: async input => {
      state.renders++;
      return require('../../electron/office-render.cjs').renderOffice(input, dependencies);
    },
  });
  const options = {
    directory, artifactStore: store,
    credentials: { list: async () => [
      { id: 'metadata-only', connectionId: 'connection', enabled: true },
      { id: 'recovery-key', connectionId: 'connection', enabled: true },
    ] },
    modelRuntime: {
      supports: () => true,
      execute: async input => {
        state.calls.push(input);
        await state.onExecute?.(input);
        if (state.receiptBeforeError) state.receipts.set(input.requestId, await saveResult(input));
        if (input.credentialId === state.rejectedCredential) throw new ModelRuntimeError('HTTP_ERROR', '账户未接受此请求', { requestStarted: true, httpStatus: 401 });
        if (state.unavailable) throw new ModelRuntimeError('NETWORK_ERROR', '原模型响应丢失', { requestStarted: true });
        return saveResult(input);
      },
      recoverReceipt: async ({ requestId }) => state.receipts.get(requestId),
    },
  };
  const saveResult = async input => {
    const text = '# 找回的正式文稿\n保留原结果并完成导出。';
    return { text, artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: '正文.txt', mimeType: 'text/plain', text })], usage: { inputTokens: 100, outputTokens: 50 } };
  };
  let engine = createLiveWorkflowEngine(options);
  const reopen = async () => { await engine.shutdown(); engine = createLiveWorkflowEngine(options); return engine; };
  try { await callback({ directory, engine, reopen, requestInput, saveResult, state, store }); }
  finally {
    await engine.shutdown();
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-chat-recovery-')) throw Error('Unexpected fixture location');
    await fs.rm(directory, { recursive: true, force: true });
  }
}

it('交付报告登记遇到短时占用，只续写同一报告，已保存的真实 Word 不重复生成', async () => fixture(async ({ engine, requestInput, state, store }) => {
  state.blockCount = 1;
  const { id } = await engine.start(requestInput);
  const run = await until(() => engine.runDetail(id), value => value.status !== 'running');
  expect(run.status, run.error).toBe('waiting-review');
  expect(state.renders).toBe(1);
  expect(state.blockedRenames).toBe(1);
  expect(state.calls).toHaveLength(1);
  expect((await store.listProject(requestInput.project.id)).filter(file => file.kind === 'office')).toHaveLength(1);
  const output = run.attempts[1].artifacts[0];
  expect((await store.read(output.id)).buffer.subarray(0, 2).toString()).toBe('PK');
  const review = { action: 'resume', id, project: requestInput.project, manualReviewAttemptId: run.attempts.at(-1).id };
  await expect(engine.control({ ...review, reviewedArtifactId: run.attempts[0].artifacts[0].id })).rejects.toThrow('正式成品');
  await expect(engine.control({ ...review, manualReviewAttemptId: 'stale-token', reviewedArtifactId: output.id })).rejects.toThrow('验收对象已变化');
  await engine.control({ ...review, reviewedArtifactId: output.id });
  expect((await until(() => engine.runDetail(id), value => value.status !== 'running')).status).toBe('complete');
  expect(state.calls).toHaveLength(1);
}), 20000);

it('交付报告持续占用后，重开只补写报告，原 DOCX 和已发生费用保持', async () => fixture(async ({ engine, reopen, requestInput, state, store }) => {
  state.blockCount = 3;
  const { id } = await engine.start(requestInput);
  const run = await until(() => engine.runDetail(id), value => value.status !== 'running');
  expect(run.status).toBe('failed');
  expect(run.snapshot.steps[run.stepIndex].kind).toBe('export');
  expect(state.blockedRenames).toBe(2);
  expect(state.renders).toBe(1);
  expect(state.calls).toHaveLength(1);
  const partial = run.attempts.at(-1).artifacts[0], reportName = file => file.name.includes('检查报告');
  expect((await store.listProject(requestInput.project.id)).filter(file => file.kind === 'office').map(file => file.id)).toEqual([partial.id]);
  expect(run.attempts.at(-1).officeCheckpoint).toBeUndefined();
  expect((await engine.snapshot(undefined, { summaryOnly: true })).runs[0].attempts.at(-1).officeCheckpoint).toBeUndefined();
  expect((await engine.exportRecords([requestInput.project.id]))[0].run.attempts.at(-1).officeCheckpoint.artifactId).toBe(partial.id);
  const ledger = (await engine.snapshot()).ledger;
  const restarted = await reopen();
  state.blockCount = 0;
  // A changed source does not silently replace or append to the partial DOCX.
  await restarted.control({ id, action: 'continue', project: { ...requestInput.project, name: '其他原始项目' } });
  const changed = await until(() => restarted.runDetail(id), value => value.status !== 'running');
  expect(changed.status).toBe('failed');
  expect(changed.error).toContain('原交付资料已变化');
  expect(changed.attempts.at(-1).artifacts[0].id).toBe(partial.id);
  const previous = await store.read(partial.id);
  await fs.writeFile(previous.path, 'Modified test DOCX');
  await restarted.control({ id, action: 'continue', project: requestInput.project });
  const tampered = await until(() => restarted.runDetail(id), value => value.status !== 'running');
  expect(tampered.status).toBe('failed');
  expect(tampered.error).toContain('产物内容已在应用外改变');
  await fs.writeFile(previous.path, previous.buffer);
  await restarted.control({ id, action: 'continue', project: requestInput.project });
  const resumed = await until(() => restarted.runDetail(id), value => value.status !== 'running');
  expect(resumed.status, resumed.error).toBe('waiting-review');
  expect(resumed.attempts.at(-2).artifacts.find(file => file.kind === 'office').id).toBe(partial.id);
  const files = await store.listProject(requestInput.project.id);
  expect(files.filter(file => file.kind === 'office').map(file => file.id)).toEqual([partial.id]);
  expect(files.filter(reportName)).toHaveLength(1);
  expect(state.renders).toBe(1);
  expect(state.calls).toHaveLength(1);
  expect((await restarted.snapshot()).ledger).toEqual(ledger);
}), 20000);

it('丢失模型响应不会重新派发，重启后查到同一回执再接着交付', async () => fixture(async ({ engine, reopen, requestInput, state, saveResult }) => {
  state.unavailable = true;
  const { id } = await engine.start(requestInput);
  const interrupted = await until(() => engine.runDetail(id), value => value.status !== 'running');
  expect(interrupted.attempts[0].requestOutcomeUnknown).toBe(true);
  const [old] = (await engine.snapshot()).ledger;
  const restored = await reopen();
  const control = { id, project: requestInput.project, expectedAttemptId: interrupted.attempts[0].id };
  await expect(restored.control({ ...control, action: 'continue' })).rejects.toThrow('避免重复计费');
  await expect(restored.control({ id, action: 'retry', stepId: requestInput.workflow.steps[0].id })).rejects.toThrow('避免重复计费');
  await expect(restored.control({ ...control, action: 'recover-receipt', expectedAttemptId: 'stale-token' })).rejects.toThrow('步骤已变化');
  await expect(restored.control({ ...control, action: 'recover-receipt', project: { ...requestInput.project, workspaceId: 'other' } })).rejects.toThrow('不属于当前工作区');
  await restored.control({ ...control, action: 'recover-receipt' });
  expect(state.calls).toHaveLength(1);
  expect((await restored.runDetail(id)).status).toBe('failed');
  const first = state.calls[0], response = await saveResult(first);
  state.receipts.set(first.requestId, { ...response, artifacts: [{ ...response.artifacts[0], runId: 'different-run' }] });
  await expect(restored.control({ ...control, action: 'recover-receipt' })).rejects.toThrow('不属于这次制作');
  state.receipts.set(first.requestId, response);
  await restored.control({ ...control, action: 'recover-receipt' });
  const resumed = await until(() => restored.runDetail(id), value => value.status !== 'running');
  expect(resumed.status, resumed.error).toBe('waiting-review');
  expect(resumed.attempts[0]).toMatchObject({ id: control.expectedAttemptId, status: 'complete', costState: 'calculated' });
  expect(resumed.attempts[0].requestOutcomeUnknown).toBeUndefined();
  expect(resumed.attempts[0].artifacts[0].id).toBe(response.artifacts[0].id);
  expect((await restored.snapshot()).ledger).toMatchObject([{ id: old.id, costCents: 15, status: 'complete' }]);
  expect(state.calls).toHaveLength(1);
}), 20000);

it.each([false, true])('找回付费回执并先落盘，重新校验后续付费步骤（预算足够：%s）', async budgetAvailable => fixture(async ({ directory, engine, requestInput, saveResult, state }) => {
  state.unavailable = true;
  requestInput.workflow.steps.splice(1, 0, { ...requestInput.workflow.steps[0], id: 'next-text', name: '撰写后续段落', inputSource: 'previous' });
  const { id } = await engine.start(requestInput);
  const failed = await until(() => engine.runDetail(id), value => value.status !== 'running');
  const first = state.calls[0];
  state.receipts.set(first.requestId, await saveResult(first));
  state.unavailable = false;
  let persistedCost;
  state.onExecute = async () => {
    const history = path.join(directory, 'live-runs-v2');
    const index = JSON.parse(await fs.readFile(path.join(history, 'index-v2.json'), 'utf8'));
    const tracked = index.records.find(record => record.id === id);
    const record = JSON.parse(await fs.readFile(path.join(history, tracked.fileName), 'utf8')).records[0];
    persistedCost = record.ledger.find(entry => entry.workflowAttemptId === first.requestId).costCents;
  };
  await engine.control({ id, action: 'recover-receipt', expectedAttemptId: failed.attempts[0].id, project: { ...requestInput.project, budgetCents: budgetAvailable ? 1000 : 15 } });
  const resumed = await until(() => engine.runDetail(id), value => value.status !== 'running');
  expect(resumed.status, resumed.error).toBe(budgetAvailable ? 'waiting-review' : 'paused');
  expect(state.calls).toHaveLength(budgetAvailable ? 2 : 1);
  expect(persistedCost).toBe(budgetAvailable ? 15 : undefined);
  expect((await engine.snapshot()).ledger.find(entry => entry.workflowAttemptId === first.requestId).costCents).toBe(15);
}), 20000);

it('已写入回执但收到超时错误时，无需用户点击就能恢复本轮成品', async () => fixture(async ({ engine, requestInput, state }) => {
  state.unavailable = state.receiptBeforeError = true;
  const { id } = await engine.start(requestInput);
  const run = await until(() => engine.runDetail(id), value => value.status !== 'running');
  expect(run.status, run.error).toBe('waiting-review');
  expect(run.attempts[0].recoveredFromReceiptAt).toBeTruthy();
  expect(run.attempts[0].id).toBe(state.calls[0].requestId);
  expect((await engine.snapshot()).ledger).toHaveLength(1);
  expect(state.calls).toHaveLength(1);
}), 20000);

it('账户明确被拒后可换模型与凭证，旧推理强度自动适配到新模型', async () => fixture(async ({ engine, requestInput, state }) => {
  requestInput.connections[0].providerId = 'openai';
  requestInput.models[0].modelId = 'gpt-6.2-astra';
  requestInput.workflow.steps[0].reasoningEffort = 'xhigh';
  requestInput.models.push({ ...requestInput.models[0], id: 'fallback-model', modelId: 'gpt-4o' });
  state.rejectedCredential = requestInput.workflow.steps[0].credentialId;
  const { id } = await engine.start(requestInput);
  const run = await until(() => engine.runDetail(id), value => value.status !== 'running');
  expect(run.status).toBe('failed');
  expect(run.attempts[0].requestOutcomeUnknown).toBe(false);
  const stepBinding = { stepId: run.snapshot.steps[0].id, modelConfigId: 'fallback-model', credentialId: 'recovery-key' };
  const input = { action: 'continue', id, project: requestInput.project, expectedAttemptId: run.attempts[0].id, stepBinding };
  await expect(engine.control({ ...input, expectedAttemptId: 'stale-token' })).rejects.toThrow('步骤已变化');
  await expect(engine.control({ ...input, stepBinding: { ...stepBinding, stepId: 'export' } })).rejects.toThrow('模型设置已变化');
  expect(state.calls).toHaveLength(1);
  await engine.control(input);
  expect((await until(() => engine.runDetail(id), value => value.status !== 'running')).status).toBe('waiting-review');
  expect(state.calls.map(call => call.credentialId)).toEqual(['metadata-only', 'recovery-key']);
  expect(state.calls.map(call => call.options.reasoningEffort)).toEqual(['xhigh', 'auto']);
}), 20000);
