import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { fixture, request, PNG, until } = require('./production-test-fixtures.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');

it('失败质检从原样稿重检，精修后仍须通过相同质检才继续；重开和双击不重复计费', async () => {
  const f = await fixture(), input = request(), store = f.artifactStore;
  await f.engine.shutdown();
  const project = { ...input.project, kind: 'image' };
  const common = { enabled: true, inputSource: 'previous', modelConfigId: 'model', credentialId: 'metadata-only' };
  input.project = project; input.workflow.outputKind = 'image';
  input.workflow.steps = [
    { ...common, id: 'make', name: '生成样稿', kind: 'image-generation', role: 'producer', count: 1, imageOutputFormat: 'png', inputSource: 'project', prompt: '制作小猫' },
    { ...common, id: 'review', name: '独立质检', kind: 'vision', role: 'reviewer', prompt: '检查实际图片', qualityGate: { minScore: 80, maxRepairs: 0 } },
    { id: 'export', kind: 'export', name: '本地交付', contentSourceStepId: 'make', prompt: '', enabled: true, inputSource: 'previous' },
    { id: 'manual', kind: 'manual-review', name: '人工验收', prompt: '', enabled: true, inputSource: 'previous' },
  ];
  input.models[0].capabilities = ['vision'];
  input.models.push({ ...input.models[0], id: 'art-model', capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } });
  input.workflow.steps[0].modelConfigId = 'art-model';
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  let reviews = 0;
  const execute = vi.fn(async task => {
    if (task.kind === 'vision') {
      const passed = ++reviews === 3;
      return { text: JSON.stringify({ passed, score: passed ? 95 : 60, issues: passed ? [] : ['主体太小'], summary: passed ? '清晰' : '修改主体大小' }), artifacts: [], usage: { inputTokens: 101, outputTokens: 31 } };
    }
    const image = await store.write({ projectId: project.id, runId: task.runId, name: task.kind + '.png', mimeType: 'image/png', buffer: PNG });
    return { text: '样稿已保存', artifacts: [image], usage: { images: 1 } };
  });
  const options = { ...f.engineOptions, modelRuntime: { supports: () => true, execute } };
  let engine = createLiveWorkflowEngine(options);
  try {
    const { id } = await engine.start(input);
    const wait = (predicate) => until(() => engine.runDetail(id), predicate);
    const first = await wait(r => r.status === 'waiting-review');
    const original = first.attempts[0].artifacts[0];
    const priorLedger = (await engine.snapshot()).ledger;
    await engine.shutdown(); engine = createLiveWorkflowEngine(options);
    const message = { id, project, connections: input.connections, models: input.models, reviewAttemptId: first.qualityReviews[0].attemptId };
    await expect(engine.control({ ...message, action: 'recheck-quality', reviewAttemptId: 'stale' })).rejects.toThrow('质检记录');
    const rechecks = await Promise.allSettled([engine.control({ ...message, action: 'recheck-quality' }), engine.control({ ...message, action: 'recheck-quality' })]);
    expect(rechecks.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const second = await wait(r => r.status === 'waiting-review' && r.qualityReviews?.length === 2);
    expect(second.stepIndex).toBe(1); expect(second.attempts.slice(0, 2)).toEqual(first.attempts);
    expect(execute.mock.calls.map(([t]) => t.kind)).toEqual(['image-generation', 'vision', 'vision']);
    expect(execute.mock.calls[2][0].attachments.map(a => a.id)).toContain(original.id);
    const refinement = { instruction: '保持原有金线，将猫脸放大', sourceArtifactId: original.id, modelConfigId: 'art-model', credentialId: 'metadata-only' };
    const recovery = { ...message, action: 'refine-quality', reviewAttemptId: second.qualityReviews[1].attemptId, refinement };
    await expect(engine.control({ ...recovery, refinement: { ...refinement, sourceArtifactId: 'foreign' } })).rejects.toThrow('样稿');
    await expect(engine.control({ ...recovery, refinement: { ...refinement, credentialId: 'missing' } })).rejects.toThrow();
    expect((await engine.runDetail(id)).snapshot.steps).toEqual(first.snapshot.steps);
    const repairs = await Promise.allSettled([engine.control(recovery), engine.control(recovery)]);
    expect(repairs.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const final = await wait(r => r.status === 'waiting-review' && r.snapshot.steps[r.stepIndex]?.kind === 'manual-review');
    expect(final.qualityReviews.map(q => q.passed)).toEqual([false, false, true]);
    expect(execute.mock.calls.map(([t]) => t.kind)).toEqual(['image-generation', 'vision', 'vision', 'image-editing', 'vision']);
    expect(execute.mock.calls[3][0]).toMatchObject({ prompt: refinement.instruction, attachments: [expect.objectContaining({id: original.id})] });
    const edited = final.attempts.find(a => a.stepName === '按质检建议精修').artifacts[0];
    expect(edited.id).not.toBe(original.id);
    expect(execute.mock.calls[4][0].attachments.map(a => a.id)).toContain(edited.id);
    expect(final.snapshot.steps.find(s => s.id === 'export').contentSourceStepId).toBe(final.attempts.find(a => a.stepName === '按质检建议精修').stepId);
    const ledger = (await engine.snapshot()).ledger; expect(ledger).toHaveLength(5); for (const previous of priorLedger) expect(ledger.find(entry => entry.id === previous.id)).toEqual(previous);
    expect(ledger.filter(entry => entry.operation === 'image-generation' || entry.operation === 'image-editing').map(entry => entry.costCents)).toEqual([10, 10]);
    expect((await store.read(original.id)).buffer).toEqual(PNG);
    await expect(engine.control(recovery)).rejects.toThrow('质检记录');
    await engine.control({id, action: 'resume'}); await wait(r => r.status === 'complete');
    expect(execute).toHaveBeenCalledTimes(5);
  } finally { await engine.shutdown(); }
});

it('不完整的质检 JSON 可重新质检，但不能通过精修或点击重检直接放行', async () => {
  let checks = 0;
  const f = await fixture(async task => task.prompt === '只检查正文'
    ? ++checks === 1 ? '返回被截断' : JSON.stringify({ passed: true, score: 92, issues: [], summary: '通过' })
    : '已保存的正文');
  const input = request(), [draft, manual] = input.workflow.steps;
  await f.workspaceStorage.ensureProject({ projectId: input.project.id, workspaceId: input.project.workspaceId, name: input.project.name });
  input.connections[0].providerId = 'openai'; input.models[0].modelId = 'gpt-6.1-terra';
  input.models.push({ ...input.models[0], id: 'replacement', modelId: 'offline-default-only' });
  input.workflow.steps = [draft, { ...draft, id: 'review-text', role: 'reviewer', reasoningEffort: 'high', inputSource: 'previous', prompt: '只检查正文', qualityGate: { minScore: 80, maxRepairs: 0 } }, manual];
  try {
    const { id } = await f.engine.start(input);
    const stopped = await until(() => f.engine.runDetail(id), r => r.status !== 'running');
    expect(stopped.status, stopped.error).toBe('waiting-review');
    expect(stopped.error).toContain('有效 JSON'); expect(stopped.qualityReviews || []).toEqual([]);
    const reviewAttemptId = stopped.attempts.at(-1).id;
    const args = { id, project: input.project, reviewAttemptId };
    await expect(f.engine.control({ ...args, action: 'refine-quality', refinement: {} })).rejects.toThrow('质检记录');
    await f.engine.control({ ...args, action: 'recheck-quality', reviewBinding: {modelConfigId: 'replacement', credentialId: 'metadata-only'} });
    const result = await until(() => f.engine.runDetail(id), r => r.status !== 'running');
    expect(result.status, result.error).toBe('waiting-review'); expect(result.stepIndex).toBe(2);
    expect(result.qualityReviews.map(q => q.passed)).toEqual([true]); expect(checks).toBe(2);
    expect(f.calls.filter(call => call.prompt === '只检查正文').map(call => [call.model.id, call.options.reasoningEffort])).toEqual([['model', 'high'], ['replacement', 'auto']]);
    expect(result.attempts.find(a => a.id === reviewAttemptId)).toEqual(stopped.attempts.at(-1));
    expect((await f.engine.snapshot()).ledger).toHaveLength(3);
  } finally { await f.engine.shutdown(); }
});
