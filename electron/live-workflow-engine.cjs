const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { calculateCost, estimateCost } = require('./live-cost.cjs');
const { resolveOfficialBillingRule } = require('./official-billing.cjs');
const { recoverLegacyBillingRequest, completeBillingUsage } = require('./billing-request-shape.cjs');
const { preflight, replaceVariables, modelStep } = require('./live-validation.cjs');
const { extractReferenceText } = require('./reference-text.cjs');
const { finishEditedReview } = require('./edited-delivery.cjs');
const { illustrationAssets, composeDocumentImages } = require('./document-illustrations.cjs');
const { createRunHistoryStore, validateRecords, runSummary } = require('./run-history-store.cjs');

const ACTIVE = new Set(['running', 'paused', 'waiting-review']);
const now = () => new Date().toISOString();
const cnyKnown = cost => cost.costState === 'calculated' && (!cost.calculation || cost.calculation.cnyAmount !== undefined);
function safeRequest(input) {
  const request = structuredClone(input);
  request.project = { ...request.project, budgetCents: request.project.budgetCents ?? undefined };
  request.workflow = { ...request.workflow, steps: request.workflow.steps.map(step => ({ ...step, budgetCents: step.budgetCents ?? undefined })) };
  request.connections = request.connections.map(({ id, name, providerId, protocol, baseUrl, enabled, demo, status }) => ({ id, name, providerId, protocol, baseUrl, enabled, demo, status }));
  request.models = request.models.map(({ id, name, modelId, connectionId, capabilities, pricing, enabled, demo }) => ({ id, name, modelId, connectionId, capabilities, pricing: { unit: pricing?.unit, currency: pricing?.currency, input: pricing?.input, output: pricing?.output, exchangeRate: pricing?.exchangeRate, referenceOnly: pricing?.referenceOnly, referenceNote: pricing?.referenceNote, officialUrl: pricing?.officialUrl, verifiedAt: pricing?.verifiedAt }, enabled, demo }));
  return request;
}
function actionFor(step, retry) { return retry ? '重新生成' : ['vision', 'video-understanding'].includes(step.kind) ? 'AI 复核' : step.kind === 'image-editing' ? 'AI 精修' : '初次生成'; }
function latestBefore(run, index) {
  const before = run.snapshot.steps.slice(0, index).filter(step => step.enabled && modelStep(step)).reverse();
  for (const step of before) { const attempt = run.attempts.filter(item => item.stepId === step.id && item.status === 'complete').at(-1); if (attempt) return attempt; }
  return undefined;
}
function validResults(run) {
  return run.snapshot.steps.filter(step => step.enabled && modelStep(step)).map(step => run.attempts.filter(attempt => attempt.stepId === step.id && attempt.status === 'complete').at(-1)).filter(Boolean);
}
function createLiveWorkflowEngine({ directory, credentials, modelRuntime, artifactStore, fileSystem = fs, fxRates, recoverInterrupted = true, legacyBillingBindings = {} }) {
  const historyStore = createRunHistoryStore({ directory, fileSystem });
  const records = new Map();
  const controllers = new Map();
  const pumps = new Map();
  const projectMutations = new Map();
  const dirty = new Map(), detailVersions = new Map(); let mutationVersion = 0;
  const mark = record => { const generation = ++mutationVersion; dirty.set(record.run.id, generation); detailVersions.set(record.run.id, generation); };
  let writes = Promise.resolve(), shuttingDown = false, revision = 0, shutdownPromise, recalculation;
  const mutateProject = (projectId, operation) => {
    const task = (projectMutations.get(projectId) || Promise.resolve()).catch(() => undefined).then(operation);
    projectMutations.set(projectId, task);
    return task.finally(() => { if (projectMutations.get(projectId) === task) projectMutations.delete(projectId); });
  };
  const persist = transaction => {
    revision++;
    const task = writes.then(async () => {
      // Resolve queued snapshots after earlier transactions commit, never from an uncommitted map.
      const current = [...records.values()];
      const captured = new Map(dirty), changedIds = [...captured.keys(), ...(transaction?.changedIds || [])];
      await historyStore.save(transaction ? transaction.records(current) : current, revision, { changedIds });
      for (const [id, generation] of captured) if (dirty.get(id) === generation) dirty.delete(id);
      if (transaction) { transaction.commit(); for (const id of transaction.changedIds || []) detailVersions.set(id, ++mutationVersion); revision++; }
    });
    writes = task.catch(() => undefined);
    return task;
  };
  const ready = (async () => {
    const data = await historyStore.load();
    if (data.fresh) return;
    revision = data.revision || 0;
    for (const record of data.records) {
      if (data.legacy || record.request.project.budgetCents === null || record.run.snapshot.steps.some(step => step.budgetCents === null) || record.request.workflow.steps.some(step => step.budgetCents === null)) mark(record);
      record.request = safeRequest(record.request);
      record.run.snapshot = { ...record.run.snapshot, steps: record.run.snapshot.steps.map(step => ({ ...step, budgetCents: step.budgetCents ?? undefined })) };
      if (recoverInterrupted && record.run.status === 'running') {
        mark(record);
        record.run.status = 'interrupted'; record.run.error = '应用关闭或重启导致中断；继续执行可能再次调用模型并产生费用。';
        for (const attempt of record.run.attempts) if (attempt.status === 'running') { attempt.status = 'cancelled'; attempt.summary = '执行中断，远端可能已经处理请求，请检查保存的用量和产物。'; }
        for (const entry of record.ledger) if (entry.status === 'processing') { entry.status = 'cancelled'; entry.costState = 'unknown'; }
      }
      records.set(record.run.id, record);
    }
    await recalculateStored();
    await persist();
  })();
  const validation = async (request, queryOnlyStepId, completedImageStepIds) => { await ready; return preflight(request, { credentials, modelRuntime, artifactStore, queryOnlyStepId, fxRates, completedImageStepIds }); };
  const projectLedgerCost = projectId => [...records.values()].filter(record => record.run.projectId === projectId).flatMap(record => record.ledger).reduce((sum, entry) => sum + entry.costCents, 0);
  const projectCost = record => Math.max(0, ...[...records.values()].filter(item => item.run.projectId === record.run.projectId).map(item => item.legacyBaseCostCents || 0)) + projectLedgerCost(record.run.projectId);
  const update = (record, changes) => { mark(record); return Object.assign(record.run, changes, { updatedAt: now() }); };
  function ledgerFor(record, attempt) { return record.ledger.find(entry => entry.workflowAttemptId === attempt.id); }
  async function billingContext(record, entry, attempt) {
    const step = record.run.snapshot.steps.find(item => item.id === entry.workflowStepId);
    // A resumed run may replace request configuration: it cannot prove an old endpoint.
    const recovered = legacyBillingBindings[entry.id];
    return { modelId: entry.modelId || recovered?.modelId, connection: entry.billingConnectionSnapshot || recovered?.connection,
      operation: entry.operation || recovered?.operation || step?.kind, startedAt: attempt?.startedAt || entry.time,
      fx: entry.calculation?.fx || entry.fxSnapshot || await fxRates?.get(entry.time), ruleSnapshot: entry.billingRuleSnapshot };
  }
  async function costFor(record, entry, attempt, usage) {
    const context = await billingContext(record, entry, attempt);
    const rule = context.ruleSnapshot || resolveOfficialBillingRule(context, entry.pricingSnapshot);
    const requestSnapshot = entry.billingRequestSnapshot || attempt?.billingRequestSnapshot || recoverLegacyBillingRequest(record, entry, attempt, context, rule);
    const receipt = completeBillingUsage(usage, requestSnapshot, context, rule);
    if (requestSnapshot && !entry.billingRequestSnapshot) entry.billingRequestSnapshot = structuredClone(requestSnapshot);
    if (rule && context.operation === 'image-generation' && context.connection?.providerId === 'openai') {
      if (receipt.inputTextTokens === undefined && receipt.inputImageTokens === undefined && Number.isSafeInteger(receipt.inputTokens)) { receipt.inputTextTokens = receipt.inputTokens; receipt.inputImageTokens = 0; receipt.usageSource = 'provider-reported+request-shape'; }
      if (receipt.outputImageTokens === undefined && receipt.outputTextTokens === undefined && Number.isSafeInteger(receipt.outputTokens)) { receipt.outputImageTokens = receipt.outputTokens; receipt.outputTextTokens = 0; }
    }
    const cost = calculateCost(entry.pricingSnapshot, receipt, { ...context, ruleSnapshot: rule });
    if (cost.calculation && receipt.usageSource === 'provider-reported+request-shape-default') cost.calculation.basis += ' 缓存写入保留时长根据本应用已保存的请求形状与官方默认30分钟规则补全，未估算Token。';
    if (cost.calculation && rule) {
      entry.billingRuleSnapshot = structuredClone(rule);
      if (!entry.billingConnectionSnapshot && legacyBillingBindings[entry.id]) {
        entry.billingConnectionSnapshot = structuredClone(context.connection); entry.modelId = context.modelId; entry.operation = context.operation;
        entry.billingIdentityRecovery = 'operator-verified';
      }
    }
    return { ...cost, usage: receipt };
  }
  async function recalculateStored({ pendingOnly = false } = {}) {
    let updated = 0;
    for (const record of records.values()) for (const entry of record.ledger) {
      if (entry.queryOnly || ['manual', 'not-incurred'].includes(entry.costState) || entry.status === 'processing') continue;
      if (pendingOnly && entry.costState === 'calculated' && entry.calculation?.completeness === 'complete' && !(entry.calculation.nativeCurrency === 'USD' && entry.calculation.cnyAmount === undefined)) continue;
      const attempt = record.run.attempts.find(item => item.id === entry.workflowAttemptId);
      const usage = entry.usage || attempt?.usage;
      if (!usage) continue;
      const observed = { usage: entry.usage, calculation: entry.calculation, state: entry.costState, status: entry.status, cents: entry.costCents };
      const cost = await costFor(record, entry, attempt, usage);
      if (entry.usage !== observed.usage || entry.calculation !== observed.calculation || entry.costState !== observed.state || entry.status !== observed.status || entry.costCents !== observed.cents) continue;
      if (entry.costState === 'manual' || entry.status === 'processing') continue;
      if (!cost.calculation || cost.calculation.completeness !== 'complete') continue;
      if (entry.costState === cost.costState && entry.costCents === cost.costCents && JSON.stringify(entry.calculation) === JSON.stringify(cost.calculation)) continue;
      entry.costRevisions ||= [];
      entry.costRevisions.push({ at: now(), reason: '使用保存的接口用量自动复算，未调用模型。', previous: { costCents: entry.costCents, costState: entry.costState, calculation: entry.calculation, usage: observed.usage ? structuredClone(observed.usage) : undefined } });
      Object.assign(entry, { usage: cost.usage, costCents: cost.costCents, costState: cost.costState, calculation: cost.calculation, costReason: cost.reason });
      if (attempt) Object.assign(attempt, { usage: cost.usage, costCents: cost.costCents, costState: cost.costState, calculation: cost.calculation });
      mark(record);
      updated++;
    }
    return { updated };
  }
  async function inputFor(record, step, index) {
    const previous = step.inputSource === 'previous' ? latestBefore(record.run, index) : undefined;
    let input = previous?.summary || record.run.input;
    const attachmentIds = [...new Set([...record.request.attachmentIds, ...(step.inputSource === 'previous' && previous ? (previous.artifacts || []).map(item => item.id) : [])])];
    const attachments = await artifactStore.list(attachmentIds);
    const illustrations = illustrationAssets(record, step, latestBefore(record.run, index), attachments);
    if (step.inputSource === 'project') {
      let referenceLength = 0;
      for (const attachment of attachments.filter(item => ['text', 'office'].includes(item.kind))) {
        const file = await artifactStore.read(attachment.id);
        let content;
        try { content = await extractReferenceText(file); }
        catch (error) { throw Object.assign(new Error('参考文字无法提取'), { publicMessage: error.message, requestStarted: false }); }
        referenceLength += content.length;
        if (referenceLength > 100000) throw Object.assign(new Error('参考文本过长'), { publicMessage: '参考文本超过 10 万字，请拆分文件后运行。', requestStarted: false });
        input += `\n\n参考资料《${attachment.name}》：\n${content}`;
      }
    }
    if (illustrations.length) input += `\n\n图文排版要求：本次另有 ${illustrations.length} 张真实插图，由本地排版器安排。` + '请生成完整正文，保持详细内容、事实和页数。不要把图片当成已核实的真实照片；不需要输出图片ID、图片占位符或图片制作说明。';
    if (illustrations.length && record.request.project.kind === 'ppt') input += `\n若用户未指定总页数，请至少安排 ${illustrations.length} 页，以每页一张图承载本次插图。用户指定了页数时保留其要求，不擅自追加页面；配图多于页面时本地排版会保留原图并提示调整。`;
    return { input, illustrations, attachments: attachments.filter(item => !['text', 'office'].includes(item.kind)) };
  }
  async function finishFailure(record, attempt, error) {
    const cancelled = record.run.status === 'cancelled' || shuttingDown;
    attempt.status = cancelled ? 'cancelled' : 'failed';
    attempt.error = typeof error.publicMessage === 'string' ? error.publicMessage.slice(0, 500) : error.name === 'ModelRuntimeError' || (!modelStep(record.run.snapshot.steps[record.run.stepIndex]) && /[\u3400-\u9fff]/.test(error.message || '')) ? error.message.slice(0, 500) : '当前步骤未完成，请检查连接、凭证、模型权限或服务状态。';
    attempt.summary = error.partialText ? `${attempt.error}\n\n已收到的部分实际结果：\n${String(error.partialText).slice(0, 100000)}` : attempt.error;
    if (Array.isArray(error.artifacts)) attempt.artifacts = error.artifacts;
    const entry = ledgerFor(record, attempt);
    if (entry) {
      if (error.usage && !entry.queryOnly) {
        if (error.billingRequestSnapshot) { entry.billingRequestSnapshot = structuredClone(error.billingRequestSnapshot); attempt.billingRequestSnapshot = structuredClone(error.billingRequestSnapshot); }
        const usage = { ...error.usage, providerRequestId: error.providerRequestId };
        const cost = await costFor(record, entry, attempt, usage);
        Object.assign(entry, { usage: cost.usage, costCents: cost.costCents, costState: cost.costState, calculation: cost.calculation, costReason: cost.reason, status: cancelled ? 'cancelled' : 'failed' });
        Object.assign(attempt, { usage: cost.usage, costCents: cost.costCents, costState: cost.costState, calculation: cost.calculation, providerRequestId: error.providerRequestId });
      }
      if (entry.queryOnly) { entry.status = cancelled ? 'cancelled' : 'failed'; entry.costCents = 0; entry.costState = 'not-incurred'; attempt.providerRequestId = error.providerRequestId || attempt.providerRequestId; }
      else if (!['calculated', 'manual'].includes(entry.costState)) { entry.status = cancelled ? 'cancelled' : 'failed'; entry.costState = error.requestStarted === false ? 'not-incurred' : 'unknown'; }
      attempt.costState = entry.costState;
    }
    update(record, { status: shuttingDown ? 'interrupted' : cancelled ? 'cancelled' : 'failed', error: attempt.error, pauseRequested: false });
    controllers.delete(record.run.id);
    await persist();
  }
  async function pump(id) {
    if (controllers.has(id)) return;
    const record = records.get(id);
    const controller = new AbortController(); controllers.set(id, controller);
    try {
      while (!shuttingDown && record.run.status === 'running') {
        const run = record.run;
        if (run.pauseRequested) { update(record, { status: 'paused', pauseRequested: false }); controllers.delete(id); await persist(); break; }
        const step = run.snapshot.steps[run.stepIndex];
        if (!step) { update(record, { status: 'complete', pauseRequested: false }); controllers.delete(id); await persist(); break; }
        if (!step.enabled) { run.stepIndex++; continue; }
        const attempt = { id: randomUUID(), stepId: step.id, stepName: step.name, modelLabel: '人工步骤', status: 'running', costCents: 0, costState: 'not-incurred', summary: '正在执行。', input: '', prompt: replaceVariables(step.prompt || '', run.variables).content, action: actionFor(step, run.retryStepOnly), artifacts: [], startedAt: now() };
        run.attempts.push(attempt); update(record, { error: undefined }); await persist();
        try {
          const context = await inputFor(record, step, run.stepIndex); attempt.input = context.input;
          if (step.kind === 'manual-review') { attempt.status = 'waiting-review'; attempt.summary = '请检查上一步实际结果，确认后继续。'; update(record, { status: 'waiting-review' }); controllers.delete(id); await persist(); break; }
          if (step.kind === 'export') {
            const results = validResults(run).filter(item => run.snapshot.steps.findIndex(candidate => candidate.id === item.stepId) < run.stepIndex);
            const textResult = step.contentSourceStepId ? results.find(item => item.stepId === step.contentSourceStepId) : [...results].reverse().find(item => item.summary && run.snapshot.steps.some(source => source.id === item.stepId && ['text', 'transcription'].includes(source.kind)));
            const assets = [...results.flatMap(item => item.artifacts || []), ...context.attachments].filter(item => item.kind === 'image');
            const body = step.contentSourceStepId ? textResult?.summary || '' : step.inputSource === 'project' ? context.input : textResult?.summary || context.input;
            const media = results.flatMap(item => item.artifacts || []).filter(item => ['audio', 'video'].includes(item.kind));
            if (record.request.project.kind === 'image' && !assets.length) attempt.artifacts = [await artifactStore.write({ name: `${record.request.project.name}-实际结果.md`, mimeType: 'text/markdown', text: body, runId: run.id, projectId: run.projectId }), ...media];
            else attempt.artifacts = [...await artifactStore.exportOffice({ kind: record.request.project.kind, title: record.request.project.name, text: body, assets, runId: run.id, projectId: run.projectId }), ...media];
            if (!attempt.artifacts.length) throw new Error('交付步骤没有产生文件。');
            attempt.summary = `已生成 ${attempt.artifacts.length} 份实际交付文件，请打开检查。`;
          } else {
            const model = record.request.models.find(item => item.id === step.modelConfigId);
            const connection = record.request.connections.find(item => item.id === model?.connectionId);
            const previousTask = step.kind === 'video-generation' && connection.providerId === 'siliconflow' && !run.retryStepOnly ? run.attempts.slice(0, -1).findLast(item => item.stepId === step.id && item.providerRequestId && ['failed', 'cancelled'].includes(item.status)) : undefined;
            const fx = await fxRates?.get(attempt.startedAt);
            const estimate = estimateCost(model, step, `${attempt.prompt}\n${context.input}`, { modelId: model.modelId, connection, operation: step.kind, startedAt: attempt.startedAt, fx });
            if (!previousTask && (cnyKnown(estimate) && (step.budgetCents != null && estimate.costCents > step.budgetCents || record.request.project.budgetCents != null && projectCost(record) + estimate.costCents > record.request.project.budgetCents) || !cnyKnown(estimate) && (step.budgetCents === 0 || record.request.project.budgetCents === 0))) throw Object.assign(new Error('预算不足'), { publicMessage: '当前步骤估算超过已设置的上限，或零元上限下费用无法确定，未发送新请求。', requestStarted: false });
            attempt.modelLabel = `${model.name} · ${model.modelId}`;
            const entry = { id: randomUUID(), projectId: run.projectId, projectName: record.request.project.name, action: attempt.action, model: `${step.name} / ${attempt.modelLabel}`, costCents: 0, costState: 'unknown', billingMode: 'live', time: now(), status: 'processing', quantity: step.count || 1, workflowRunId: run.id, workflowStepId: step.id, workflowAttemptId: attempt.id, pricingSnapshot: structuredClone(model.pricing), modelId: model.modelId, operation: step.kind, billingConnectionSnapshot: structuredClone(connection), fxSnapshot: fx, billingRuleSnapshot: resolveOfficialBillingRule({ modelId: model.modelId, connection, operation: step.kind, startedAt: attempt.startedAt }, model.pricing) };
            record.ledger.push(entry); mark(record); await persist();
            if (previousTask) { entry.queryOnly = true; entry.costState = 'not-incurred'; attempt.costState = 'not-incurred'; }
            const result = await modelRuntime.execute({ requestId: attempt.id, runId: run.id, projectId: run.projectId, connection, model, credentialId: step.credentialId, kind: step.kind, prompt: attempt.prompt, input: context.input, attachments: context.attachments, options: { maxOutputTokens: step.maxOutputTokens || 2048, size: step.imageSize || (step.kind === 'video-generation' ? '1280x720' : '1024x1024'), background: step.imageBackground || 'auto', voice: step.voice || 'alloy', count: step.count || 1, existingTaskId: previousTask?.providerRequestId } }, { signal: controller.signal, onProgress: progress => {
              if (attempt.status !== 'running') return;
              attempt.summary = progress.message || '模型正在处理。'; revision++;
              if (progress.providerRequestId && attempt.providerRequestId !== progress.providerRequestId) {
                attempt.providerRequestId = progress.providerRequestId; entry.usage = { ...entry.usage, providerRequestId: progress.providerRequestId };
                mark(record);
                void persist().catch(() => { run.pauseRequested = true; });
              }
            } });
            attempt.summary = result.text || `已生成 ${result.artifacts.length} 个实际文件。`;
            const usage = { ...result.usage, providerRequestId: result.providerRequestId };
            attempt.artifacts = result.artifacts || []; attempt.usage = usage; attempt.providerRequestId = result.providerRequestId;
            if (result.billingRequestSnapshot) { entry.billingRequestSnapshot = structuredClone(result.billingRequestSnapshot); attempt.billingRequestSnapshot = structuredClone(result.billingRequestSnapshot); }
            const original = previousTask && ledgerFor(record, previousTask);
            const cost = await costFor(record, original || entry, previousTask || attempt, usage);
            attempt.costCents = cost.costCents; attempt.costState = cost.costState; attempt.calculation = cost.calculation; attempt.usage = cost.usage;
            Object.assign(entry, { costCents: cost.costCents, costState: cost.costState, calculation: cost.calculation, costReason: cost.reason, usage: cost.usage, status: 'complete' });
            if (previousTask) {
              if (original && original.costState !== 'manual') { Object.assign(original, { costCents: cost.costCents, costState: cost.costState, calculation: cost.calculation, usage: cost.usage }); previousTask.costCents = cost.costCents; previousTask.costState = cost.costState; previousTask.calculation = cost.calculation; previousTask.usage = cost.usage; }
              Object.assign(entry, { costCents: 0, costState: 'not-incurred', calculation: undefined }); attempt.costCents = 0; attempt.costState = 'not-incurred'; attempt.calculation = undefined;
            }
            if (!previousTask && (cnyKnown(cost) && (step.budgetCents != null && cost.costCents > step.budgetCents || record.request.project.budgetCents != null && projectCost(record) > record.request.project.budgetCents) || !cnyKnown(cost) && (step.budgetCents === 0 || record.request.project.budgetCents === 0))) run.pauseRequested = true;
            const illustrationConsumer = run.snapshot.steps.some(candidate => candidate.enabled && candidate.documentImageStepIds?.includes(step.id));
            if (illustrationConsumer && attempt.artifacts.filter(file => file.kind === 'image').length !== (step.count || 1)) throw Object.assign(new Error('配图数量与请求不一致'), { publicMessage: '配图接口未返回约定数量的实际图片，已停止后续生成；请检查当前步骤，已发生费用和现有图片保留。' });
            if (context.illustrations.length) {
              const document = composeDocumentImages(record.request.project.kind, record.request.project.name, attempt.summary, context.illustrations);
              const text = JSON.stringify({ editorDocument: document });
              const source = await artifactStore.write({ name: `${document.title}-图文编辑源.json`, mimeType: 'application/json', text, runId: run.id, projectId: run.projectId });
              attempt.summary = text; attempt.artifacts.push(source);
            }
          }
          attempt.status = 'complete'; attempt.completedAt = now();
          if (run.status === 'cancelled') { await persist(); break; }
          run.stepIndex = run.retryStepOnly ? run.snapshot.steps.length : run.stepIndex + 1;
          const paused = !!run.pauseRequested;
          if (paused) { update(record, { status: 'paused', pauseRequested: false }); controllers.delete(id); }
          else update(record, {});
          await persist();
          if (paused) break;
        } catch (error) { await finishFailure(record, attempt, error); break; }
      }
    } finally { if (controllers.get(id) === controller) controllers.delete(id); }
  }
  function launchPump(id) {
    const task = Promise.resolve().then(() => pump(id)).catch(async () => {
      const record = records.get(id);
      if (record) update(record, { status: shuttingDown ? 'interrupted' : 'failed', error: '运行记录无法保存，已停止后续步骤。' });
      await persist().catch(() => undefined);
    });
    pumps.set(id, task);
    void task.finally(() => { if (pumps.get(id) === task) pumps.delete(id); }).catch(() => undefined);
  }
  async function drain() {
    await ready;
    while (true) {
      const writing = writes;
      await Promise.allSettled([...pumps.values(), ...projectMutations.values(), writing]);
      if (!pumps.size && !projectMutations.size && writing === writes) return;
    }
  }
  function interruptRunning() {
    for (const record of records.values()) if (record.run.status === 'running') update(record, { status: 'interrupted', error: '应用关闭，远端可能已处理请求，继续前请核对费用。' });
    for (const controller of controllers.values()) controller.abort();
  }
  return {
    drain, flush: drain,
    preflight: validation,
    async start(input) {
      return mutateProject(input?.project?.id, async () => {
        await ready;
        if (shuttingDown) throw new Error('应用正在退出。');
        const request = safeRequest(input);
        const expectedReplacement = records.get(request.replaceWaitingReviewRunId);
        const expectedReviewId = expectedReplacement?.run.status === 'waiting-review' ? expectedReplacement.run.attempts.findLast(attempt => attempt.stepId === expectedReplacement.run.snapshot.steps[expectedReplacement.run.stepIndex]?.id && attempt.status === 'waiting-review')?.id : undefined;
        const check = await validation(request);
        if (!check.ok) throw new Error(check.errors.join('\n'));
        if (shuttingDown) throw new Error('应用正在退出，未开始新的模型请求。');
        if (!request.acknowledgePaidCalls || (check.unknownCost && !request.acknowledgeUnknownCost)) throw new Error('请确认真实调用及待核对费用后再开始。');
        const replacementId = request.replaceWaitingReviewRunId;
        const replacement = replacementId === undefined ? undefined : records.get(replacementId);
        const pending = replacement?.run.attempts.findLast(attempt => attempt.stepId === replacement.run.snapshot.steps[replacement.run.stepIndex]?.id && attempt.status === 'waiting-review');
        if (replacementId !== undefined && (typeof replacementId !== 'string' || !replacement || replacement.run.projectId !== request.project.id || replacement.run.workspaceId !== request.project.workspaceId || replacement.run.snapshot.outputKind !== request.project.kind || replacement.run.status !== 'waiting-review' || replacement.run.hiddenAt || replacement.run.trashedAt || replacement.run.snapshot.steps[replacement.run.stepIndex]?.kind !== 'manual-review' || !expectedReviewId || pending?.id !== expectedReviewId || controllers.has(replacementId) || replacement.run.attempts.some(attempt => attempt.status === 'running'))) throw new Error('待检查任务已变化，请刷新当前结果后再开始新一轮创作。');
        if ([...records.values()].some(item => item !== replacement && item.run.projectId === request.project.id && (ACTIVE.has(item.run.status) || controllers.has(item.run.id)))) throw new Error('这个项目已有真实运行任务，请先完成或取消。');
        const time = now();
        const run = { id: randomUUID(), mode: 'live', workspaceId: request.workflow.workspaceId, projectId: request.project.id, workflowId: request.workflow.id, workflowName: request.workflow.name, snapshot: request.workflow, status: 'running', stepIndex: 0, attempts: [], variables: request.variables, input: request.input, attachmentIds: request.attachmentIds, createdAt: time, updatedAt: time };
        const nextRecord = { run, request, ledger: [], legacyBaseCostCents: Math.max(0, request.project.costCents - projectLedgerCost(run.projectId)) };
        const replacementChanges = { status: 'cancelled', pauseRequested: false, error: undefined, updatedAt: time, supersededByRunId: run.id };
        const reviewChanges = { status: 'cancelled', summary: '已由新一轮创作替代，原始结果、产物与费用保留；后续步骤未执行。' };
        if (replacement) {
          run.supersedesRunId = replacementId;
        }
        try {
          // Stage only review state; commit patches preserve concurrent ledger and attempt cost updates.
          await persist({ changedIds: [run.id, ...(replacementId ? [replacementId] : [])], records: current => [...current.map(item => {
            if (item !== replacement) return item;
            const next = structuredClone(item.run);
            Object.assign(next, replacementChanges); Object.assign(next.attempts.find(attempt => attempt.id === pending.id), reviewChanges);
            return { ...item, run: next };
          }), nextRecord], commit: () => {
            if (replacement) { Object.assign(replacement.run, replacementChanges); Object.assign(pending, reviewChanges); }
            records.set(run.id, nextRecord);
          } });
        } catch { throw new Error('启动状态无法保存，未开始新请求；原有任务、结果与费用保留。'); }
        launchPump(run.id);
        return structuredClone(run);
      });
    },
    async snapshot(afterRevision, { summaryOnly = false } = {}) { await ready; if (Number.isSafeInteger(afterRevision) && afterRevision >= revision) return null; return structuredClone({ revision, runs: [...records.values()].map(item => summaryOnly ? { ...runSummary(item.run), detailVersion: detailVersions.get(item.run.id) || 0 } : item.run).reverse(), ledger: [...records.values()].flatMap(item => item.ledger).sort((a, b) => b.time.localeCompare(a.time)) }); },
    async runDetail(id) { await ready; const record = records.get(id); if (!record) throw new Error('运行记录不存在。'); return structuredClone({ ...record.run, detailVersion: detailVersions.get(id) || 0 }); },
    async exportRecords(projectIds) { await ready; await writes; return structuredClone([...records.values()].filter(item => projectIds.includes(item.run.projectId))); },
    async importRecords(added) {
      await ready; validateRecords(added);
      if (shuttingDown) throw new Error('应用正在退出，未导入历史。');
      if (added.some(item => records.has(item.run.id) && !(item.importOrigin?.backupId && item.importOrigin.backupId === records.get(item.run.id).importOrigin?.backupId && item.importOrigin.sourceRunId === records.get(item.run.id).importOrigin?.sourceRunId) && JSON.stringify(records.get(item.run.id)) !== JSON.stringify(item))) throw new Error('导入运行编号与现有历史冲突。');
      const missing = added.filter(item => !records.has(item.run.id));
      if (!missing.length) return;
      await persist({ changedIds: missing.map(item => item.run.id), records: current => [...current, ...missing], commit: () => { for (const record of missing) records.set(record.run.id, structuredClone(record)); } });
    },
    async refreshArtifactLocations() {
      await ready;
      const trash = new Map((await artifactStore.listTrash()).map(artifact => [artifact.id, artifact]));
      let changed = false;
      for (const record of records.values()) for (const attempt of record.run.attempts) for (const artifact of attempt.artifacts || []) {
        try {
          const current = trash.get(artifact.id) || (await artifactStore.list([artifact.id]))[0];
          if (current && JSON.stringify(current) !== JSON.stringify(artifact)) { if (current.trashedAt === undefined) delete artifact.trashedAt; Object.assign(artifact, current); changed = true; mark(record); }
        } catch { /* A missing file remains in history; do not remove its ID or cost. */ }
      }
      if (changed) await persist();
    },
    async manageRun({ id, action }) {
      await ready;
      const record = records.get(id);
      if (!record || !['hide', 'trash', 'restore'].includes(action)) throw new Error('任务或整理操作无效。');
      if (controllers.has(id) || ACTIVE.has(record.run.status)) throw new Error('请先完成或取消任务，再隐藏或移入回收站。');
      const previous = { ...record.run };
      if (action === 'restore') { delete record.run.hiddenAt; delete record.run.trashedAt; }
      else if (action === 'hide') { if (record.run.trashedAt) throw new Error('请先从任务回收站恢复。'); record.run.hiddenAt ||= now(); }
      else { record.run.trashedAt ||= now(); delete record.run.hiddenAt; }
      mark(record);
      try { await persist(); } catch (error) { record.run = previous; mark(record); throw error; }
    },
    async recordLocalExport({ projectId, workspaceId, name, kind, sourceRevision, artifacts, sourceArtifactIds = [] }) {
      return mutateProject(projectId, async () => {
        await ready;
        if (!projectId || !workspaceId || !['ppt', 'word', 'excel'].includes(kind) || !Number.isSafeInteger(sourceRevision) || !Array.isArray(artifacts) || !artifacts.length || artifacts.some(artifact => artifact.projectId !== projectId)) throw new Error('编辑导出记录无效，文件仍保留在项目目录。');
        const id = artifacts[0].runId || randomUUID(), timestamp = now();
        if (records.has(id)) return structuredClone(records.get(id).run);
        const step = { id: `${id}-export`, name: '保存编辑后的文件', kind: 'export', prompt: '', inputSource: 'project', enabled: true };
        const project = { id: projectId, workspaceId, name, kind, costCents: 0 };
        const workflow = { id, workspaceId, name: `${name} · 编辑导出`, outputKind: kind, steps: [step], updatedAt: timestamp };
        const run = { id, mode: 'live', workspaceId, projectId, workflowId: id, workflowName: workflow.name, snapshot: workflow, status: 'complete', stepIndex: 1, variables: {}, input: '', createdAt: timestamp, updatedAt: timestamp, sourceRevision, attempts: [{ id: randomUUID(), stepId: step.id, stepName: step.name, modelLabel: '本地编辑', status: 'complete', costCents: 0, costState: 'not-incurred', summary: `编辑版本 ${sourceRevision} 已导出；未调用模型。`, input: '', prompt: '', action: 'AI 精修', artifacts, sourceRevision }] };
        const reviewed = [];
        for (const record of records.values()) {
          if (controllers.has(record.run.id)) continue;
          const next = finishEditedReview(record.run, { projectId, kind, sourceRevision, artifacts, sourceArtifactIds, exportRunId: id, completedAt: timestamp });
          if (next) { reviewed.push({ record, before: record.run }); record.run = next; mark(record); }
        }
        records.set(id, { run, request: { project, workflow, connections: [], models: [], variables: {}, input: '', attachmentIds: [] }, ledger: [], legacyBaseCostCents: 0 });
        mark(records.get(id));
        try { await persist(); } catch (error) { records.delete(id); for (const { record, before } of reviewed) record.run = before; throw error; }
        return structuredClone(run);
      });
    },
    async control({ id, action, stepId, stepBudgetCents, project, connections, models }) {
      await ready;
      const target = records.get(id); if (!target) throw new Error('运行记录不存在。');
      return mutateProject(target.run.projectId, async () => {
        if (shuttingDown && action !== 'cancel') throw new Error('应用正在退出，未继续执行模型请求。');
        const record = records.get(id); if (!record) throw new Error('运行记录不存在。');
        if (record.run.hiddenAt || record.run.trashedAt) throw new Error('请先恢复这条任务记录，再继续执行。');
        const run = record.run;
        if (stepBudgetCents !== undefined) {
          if (!['resume', 'continue'].includes(action) || !['paused', 'failed', 'interrupted', 'waiting-review'].includes(run.status)) throw new Error('只能在暂停、失败、中断或人工确认阶段调整当前步骤金额上限。');
          if (stepBudgetCents !== null && (!Number.isSafeInteger(stepBudgetCents) || stepBudgetCents < 0)) throw new Error('当前步骤金额上限无效，请填写非负金额或留空。');
          if (!run.snapshot.steps[run.stepIndex]) throw new Error('当前没有可调整金额上限的步骤。');
        }
        if (action === 'cancel' && ACTIVE.has(run.status)) {
          update(record, { status: 'cancelled', pauseRequested: false });
          for (const attempt of run.attempts) if (attempt.status === 'waiting-review') { attempt.status = 'cancelled'; attempt.summary = '人工检查已取消，既有结果和费用保留。'; }
          controllers.get(id)?.abort(); await persist(); return;
        }
        if (action === 'pause' && run.status === 'running') { if (controllers.has(id)) update(record, { pauseRequested: true }); else update(record, { status: 'paused' }); await persist(); return; }
        if (controllers.has(id)) throw new Error('当前请求仍在取消或收尾，请稍后继续。');
        if (project && (project.id !== run.projectId || project.kind !== run.snapshot.outputKind)) throw new Error('续跑项目与原运行不匹配。');
        const nextRequest = safeRequest({ ...record.request, project: project || record.request.project, connections: connections || record.request.connections, models: models || record.request.models });
        const nextRun = structuredClone(run);
        if (stepBudgetCents !== undefined) nextRun.snapshot.steps[nextRun.stepIndex].budgetCents = stepBudgetCents ?? undefined;
        if (project && project.workspaceId !== run.workspaceId) { nextRun.originWorkspaceId ||= run.workspaceId; nextRun.workspaceId = project.workspaceId; nextRun.snapshot.workspaceId = project.workspaceId; nextRequest.workflow = nextRun.snapshot; }
        if (action === 'resume' && run.status === 'waiting-review') {
          const attempt = nextRun.attempts.findLast(item => item.stepId === nextRun.snapshot.steps[nextRun.stepIndex]?.id && item.status === 'waiting-review');
          if (attempt) { attempt.status = 'complete'; attempt.summary = '人工检查已通过。'; }
          nextRun.stepIndex++;
        } else if (action === 'retry') {
          if (ACTIVE.has(run.status)) throw new Error('请先完成或取消当前运行。');
          const index = nextRun.snapshot.steps.findIndex(step => step.id === stepId && modelStep(step));
          if (index < 0) throw new Error('请选择可重试的模型步骤。');
          nextRun.stepIndex = index; nextRun.retryStepOnly = true;
        } else if (!(['resume', 'continue'].includes(action) && ['paused', 'failed', 'interrupted'].includes(run.status))) throw new Error('当前状态不能执行这个操作。');
        if ([...records.values()].some(item => item !== record && item.run.projectId === run.projectId && ACTIVE.has(item.run.status))) throw new Error('项目已有其它真实任务。');
        nextRequest.workflow = nextRun.snapshot;
        const nextBaseline = project ? Math.max(record.legacyBaseCostCents || 0, project.costCents - projectLedgerCost(project.id)) : record.legacyBaseCostCents || 0;
        const remaining = nextRun.snapshot.steps.map((step, index) => ({ ...step, enabled: step.enabled && (nextRun.retryStepOnly ? index === nextRun.stepIndex : index >= nextRun.stepIndex) }));
        const first = remaining.find(step => step.enabled);
        if (first) {
          first.inputSource = 'project';
          const completedImageStepIds = new Set();
          const neededImageIds = new Set(remaining.filter(step => step.enabled && Array.isArray(step.documentImageStepIds)).flatMap(step => step.documentImageStepIds));
          for (const sourceId of neededImageIds) {
            const source = remaining.find(step => step.id === sourceId);
            if (!source || source.enabled) continue;
            const result = nextRun.attempts.filter(attempt => attempt.stepId === sourceId && attempt.status === 'complete').at(-1);
            const pictures = result?.artifacts?.filter(file => file.kind === 'image') || [];
            if (pictures.length !== (source.count || 1)) throw new Error('已完成的配图来源不完整，请先检查对应步骤；未发送新请求。');
            for (const picture of pictures) {
              const file = await artifactStore.read(picture.id);
              if (file.projectId !== run.projectId || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw new Error('已有配图文件不可用，未继续调用模型。');
            }
            completedImageStepIds.add(sourceId);
          }
          const continuingVideo = !nextRun.retryStepOnly && first.kind === 'video-generation' && nextRun.attempts.some(attempt => attempt.stepId === first.id && attempt.providerRequestId && ['failed', 'cancelled'].includes(attempt.status));
          const check = await validation({ ...nextRequest, project: { ...nextRequest.project, costCents: Math.max(projectCost(record), nextBaseline + projectLedgerCost(run.projectId)) }, workflow: { ...nextRun.snapshot, steps: remaining } }, continuingVideo ? first.id : undefined, completedImageStepIds);
          if (check.errors.length) throw new Error(check.errors.join('\n'));
          if (shuttingDown) throw new Error('应用正在退出，未继续执行模型请求。');
        }
        const previous = { run: structuredClone(run), request: record.request, legacyBaseCostCents: record.legacyBaseCostCents };
        record.request = nextRequest; record.legacyBaseCostCents = nextBaseline;
        Object.assign(run, nextRun); update(record, { status: 'running', error: undefined, pauseRequested: false });
        try { await persist(); }
        catch {
          record.run = previous.run; record.request = previous.request; record.legacyBaseCostCents = previous.legacyBaseCostCents;
          mark(record);
          try { await persist(); } catch { /* Preserve the last durable record when storage remains unavailable. */ }
          throw new Error('续跑状态无法保存，未开始新请求；原有步骤参数和费用保留。');
        }
        launchPump(id);
      });
    },
    async reconcile({ entryId, costCents }) {
      await ready;
      if (!Number.isSafeInteger(costCents) || costCents < 0 || costCents > 100000000) throw new Error('补录费用无效。');
      for (const record of records.values()) {
        const entry = record.ledger.find(item => item.id === entryId);
        if (entry) {
          if (entry.status === 'processing') throw new Error('请求尚未结束，请稍后核对费用。');
          entry.costBeforeReconciliation = entry.costCents; entry.reconciledAt = now(); entry.costCents = costCents; entry.costState = 'manual';
          const attempt = record.run.attempts.find(item => item.id === entry.workflowAttemptId);
          if (attempt) { attempt.costCents = costCents; attempt.costState = 'manual'; }
          mark(record);
          await persist(); return;
        }
      }
      throw new Error('找不到待核对的费用记录。');
    },
    recalculateCosts({ pendingOnly = false, signal } = {}) {
      if (recalculation) return recalculation;
      const task = (async () => { await ready; await fxRates?.refresh({ signal }); const result = await recalculateStored({ pendingOnly }); if (result.updated) await persist(); return result; })();
      recalculation = task;
      void task.finally(() => { if (recalculation === task) recalculation = undefined; }).catch(() => undefined);
      return task;
    },
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      shuttingDown = true;
      shutdownPromise = (async () => { await ready; interruptRunning(); await drain(); interruptRunning(); await persist(); await drain(); })().catch(error => { shutdownPromise = undefined; throw error; });
      return shutdownPromise;
    },
  };
}
module.exports = { createLiveWorkflowEngine, latestBefore, safeRequest };
