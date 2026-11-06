const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { safeRequest } = require('./live-workflow-engine.cjs');
const { replaceVariables } = require('./live-validation.cjs');
const { parseBatchImport, MAX_ROWS } = require('./batch-import.cjs');
const { validateImageGroupCounts, validateImageGroupTemplate, validateImageGroupRecord, imageGroupRequest, imageGroupOutputError } = require('./image-group-batch.cjs');
const active = status => ['running', 'paused', 'waiting-review'].includes(status);
const terminal = status => ['complete', 'failed', 'cancelled', 'interrupted'].includes(status);
const now = () => new Date().toISOString();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
function quickReviewTail(run) {
  const steps = run.snapshot.steps, index = run.stepIndex;
  const allowed = new Set(['id', 'name', 'kind', 'prompt', 'inputSource', 'budgetCents', 'enabled']);
  const unchanged = (step, kind) => step.kind === kind && step.name === (kind === 'export' ? '生成实际交付文件' : '人工检查实际结果') && step.prompt === '' && step.inputSource === 'previous' && step.budgetCents === undefined && step.enabled && Object.keys(step).every(key => allowed.has(key));
  if (!run.workflowId.startsWith('quick-') || steps.length !== 3 || !steps.every(step => step.enabled)) return false;
  const document = ['word', 'ppt', 'excel'].includes(run.snapshot.outputKind) && steps[0].kind === 'text';
  const image = run.snapshot.outputKind === 'image' && ['image-generation', 'image-editing'].includes(steps[0].kind);
  if (index === 2) return document && unchanged(steps[1], 'export') && unchanged(steps[2], 'manual-review');
  return index === 1 && (document || image) && unchanged(steps[1], 'manual-review') && unchanged(steps[2], 'export');
}
function createBatchProduction({ directory, workspaceStorage, liveEngine, artifactStore, loadModule = require, fileSystem = fs, assertAdmission = async () => undefined, withProjectWrite = async (_id, action) => action() }) {
  const root = path.join(path.resolve(directory), 'batches-v1'), records = new Map();
  const snapshot = () => liveEngine.snapshot(undefined, { summaryOnly: true });
  let queue = Promise.resolve(), closing = false, pumping;
  const serial = action => { const task = queue.then(action); queue = task.catch(() => undefined); return task; };
  const filename = id => { if (!validId(id)) throw new Error('批次编号无效。'); return path.join(root, `${id}.json`); };
  async function write(record) { if (Buffer.byteLength(JSON.stringify(record)) > 16 * 1024 * 1024) throw new Error('批量记录超过16MB，请减少数据行。'); await atomicJson(fileSystem, filename(record.id), record); records.set(record.id, record); }
  const ready = (async () => {
    await checkedDirectory(fileSystem, root, true);
    for (const file of await fileSystem.readdir(root)) {
      if (!/^[A-Za-z0-9-]+\.json$/.test(file)) continue;
      const target = path.join(root, file); await checkedFile(fileSystem, target);
      let record; try { record = JSON.parse(await fileSystem.readFile(target, 'utf8')); } catch { throw new Error('批量记录无法读取，原文件已保留，未自动提交任务。'); }
      if (record.version !== 1 || !validId(record.id) || file !== `${record.id}.json` || !Array.isArray(record.items) || !record.request || record.items.some(item => !validId(item.id) || !item.project || !Array.isArray(item.attempts))) throw new Error('批量记录结构异常，原文件已保留。');
      validateImageGroupRecord(record);
      if (['running', 'waiting-review'].includes(record.status) || record.items.some(item => ['submitting', 'running'].includes(item.status))) {
        record.status = 'interrupted'; record.error = '应用已重启，未自动重发已提交请求。请查看各项目任务，再明确继续队列或重试单项。';
        for (const item of record.items) if (['submitting', 'running'].includes(item.status)) { item.status = 'interrupted'; item.error = '上次请求可能已提交，请检查项目记录；不会自动再次收费。'; }
        record.updatedAt = now(); await write(record);
      } else records.set(record.id, record);
    }
  })();
  void ready.catch(() => undefined);
  async function mutate(id, update) { return serial(async () => { await ready; const before = records.get(id); if (!before) throw new Error('批次不存在。'); const next = structuredClone(before); update(next); next.updatedAt = now(); await write(next); return next; }); }
  function indexSnapshot(snapshot) {
    const ledgerByProject = new Map(), runsById = new Map();
    for (const entry of snapshot.ledger) {
      const projectId = entry.projectId, entries = ledgerByProject.get(projectId);
      if (entries) entries.push(entry); else ledgerByProject.set(projectId, [entry]);
    }
    for (const run of snapshot.runs) if (!runsById.has(run.id)) runsById.set(run.id, run);
    return { ledgerByProject, runsById };
  }
  async function publicRecord(record, snapshot, index = indexSnapshot(snapshot)) {
    const { request: _request, projectNameTemplate: _template, ...result } = structuredClone(record);
    const { ledgerByProject, runsById } = index;
    for (const item of result.items) {
      const entries = ledgerByProject.get(item.project.id)?.slice() || []; item.ledger = entries; item.costCents = entries.reduce((sum, entry) => sum + entry.costCents, 0); item.unknownCost = entries.some(entry => entry.costState === 'unknown' || entry.calculation && entry.calculation.nativeCurrency === 'USD' && entry.calculation.cnyAmount === undefined);
      item.project.costCents = item.costCents;
      const run = runsById.get(item.runId);
      if (run) { item.artifacts = run.attempts.flatMap(attempt => attempt.artifacts || []); if (item.status !== 'queued' && item.status !== 'submitting') item.status = run.status === 'paused' ? 'interrupted' : run.status; const outputError = imageGroupOutputError(record, item, run); if (outputError) { item.status = 'failed'; item.error = outputError; } else if (record.kind === 'image-groups' && run.status === 'complete') { const exporter = run.snapshot.steps.filter(step => step.enabled && step.kind === 'export').at(-1); item.artifacts = run.attempts.filter(attempt => attempt.stepId === exporter?.id && attempt.status === 'complete').at(-1)?.artifacts || item.artifacts; } }
    }
    return result;
  }
  async function admission(project) { if (closing) throw new Error('应用正在关闭，未提交后续批量项。'); await assertAdmission(project); await workspaceStorage.assertProject(project.id, project.workspaceId); }
  async function linkedRun(item) {
    const current = await snapshot();
    return current.runs.find(run => run.id === item.runId) || current.runs.find(run => run.projectId === item.project.id && run.createdAt >= (item.attempts.at(-1)?.submittedAt || '9999'));
  }
  async function submit(id, itemId) {
    const projectId = records.get(id).items.find(item => item.id === itemId).project.id;
    return withProjectWrite(projectId, () => submitLocked(id, itemId));
  }
  async function submitLocked(id, itemId) {
    let record = records.get(id), item = record.items.find(item => item.id === itemId);
    await admission(item.project);
    const location = { directory: await workspaceStorage.projectDirectory(item.project.id) };
    await admission(item.project);
    const variables = { ...record.request.variables, ...item.variables }, resolution = replaceVariables(record.request.input, variables);
    const request = imageGroupRequest(record, item, { ...record.request, project: { ...item.project, directory: location.directory }, input: resolution.content, variables });
    const previousRun = item.retryExisting ? await linkedRun(item) : undefined;
    if (previousRun && active(previousRun.status)) throw new Error('这项已有运行、暂停或待检查请求，请先处理该任务。');
    const continuing = previousRun && ['failed', 'interrupted'].includes(previousRun.status);
    if (!continuing) { const check = await liveEngine.preflight(request); if (!check.ok || resolution.missing.length) throw new Error([...check.errors, ...(resolution.missing.length ? [`本行缺少变量：${resolution.missing.join('、')}`] : [])].join('\n')); }
    await mutate(id, next => { if (next.status !== 'running') throw new Error('批次已暂停，未提交新请求。'); const row = next.items.find(item => item.id === itemId); row.project.directory = location.directory; row.status = 'submitting'; row.error = undefined; row.attempts.push({ ordinal: row.attempts.length + 1, submittedAt: now() }); });
    await admission(request.project);
    if (closing) throw new Error('应用正在关闭，未提交新请求。');
    let run;
    if (continuing) { await liveEngine.control({ id: previousRun.id, action: 'continue', project: request.project, connections: request.connections, models: request.models }); run = (await snapshot()).runs.find(item => item.id === previousRun.id); }
    else run = await liveEngine.start(request);
    const cancelled = records.get(id).status === 'cancelled' || records.get(id).items.find(item => item.id === itemId).status === 'cancelled';
    await mutate(id, next => { const row = next.items.find(item => item.id === itemId); row.runId = run.id; row.attempts.at(-1).runId = run.id; row.status = cancelled ? 'cancelled' : run.status; delete row.retryExisting; });
    if (cancelled && active(run.status)) await liveEngine.control({ id: run.id, action: 'cancel' });
  }
  async function pump(id) {
    let tracked;
    while (!closing) {
      const record = records.get(id); if (!record || record.status === 'cancelled') break;
      const item = record.items.find(item => ['submitting', 'running', 'waiting-review'].includes(item.status)) || (record.status === 'running' ? record.items.find(item => item.status === 'queued') : undefined);
      if (!item) { if (record.status === 'running') await mutate(id, next => { next.status = next.items.some(item => ['failed', 'interrupted'].includes(item.status)) ? 'paused' : 'complete'; }); break; }
      try {
        if (item.status === 'queued') { tracked = undefined; await submit(id, item.id); continue; }
        if (tracked?.itemId !== item.id || tracked.projectId !== item.project.id) tracked = { itemId: item.id, projectId: item.project.id, runs: [] };
        const incoming = await liveEngine.snapshot(tracked.revision, { summaryOnly: true, projectIds: [item.project.id] });
        if (incoming) { tracked.revision = Number.isSafeInteger(incoming.revision) ? incoming.revision : undefined; tracked.runs = incoming.runs; }
        const run = tracked.runs.find(run => run.id === item.runId) || tracked.runs.find(run => run.projectId === item.project.id && run.createdAt >= (item.attempts.at(-1)?.submittedAt || '9999'));
        if (!run) { await mutate(id, next => { const row = next.items.find(row => row.id === item.id); row.status = 'interrupted'; row.error = '已记录提交标记但尚未确认运行编号，未自动重发；请检查项目任务。'; next.status = 'paused'; }); break; }
        if (run.status === 'waiting-review') {
          const detailed = liveEngine.runDetail ? await liveEngine.runDetail(run.id) : run;
          if (['running', 'paused'].includes(record.status) && quickReviewTail(detailed)) { await admission(item.project); await liveEngine.control({ id: run.id, action: 'resume' }); continue; }
          await mutate(id, next => { next.items.find(row => row.id === item.id).status = 'waiting-review'; next.status = 'waiting-review'; }); break;
        }
        if (terminal(run.status) || run.status === 'paused') {
          const outputError = imageGroupOutputError(record, item, run);
          await mutate(id, next => { const row = next.items.find(row => row.id === item.id); row.runId = run.id; row.artifacts = run.attempts.flatMap(attempt => attempt.artifacts || []); if ((next.status === 'cancelled' || row.status === 'cancelled') && run.status !== 'complete') { row.status = 'cancelled'; return; } row.status = outputError ? 'failed' : run.status === 'paused' ? 'interrupted' : run.status; row.error = outputError || run.error; if (next.status !== 'cancelled' && (run.status !== 'complete' || outputError)) next.status = 'paused'; });
          if (records.get(id).status !== 'running') break; continue;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        const cancelled = records.get(id); if (cancelled?.status === 'cancelled') break; if (cancelled?.items.find(row => row.id === item.id)?.status === 'cancelled') continue;
        await mutate(id, next => { const row = next.items.find(row => row.id === item.id); if (next.status === 'cancelled' || row.status === 'cancelled') return; row.status = row.status === 'submitting' ? 'interrupted' : 'failed'; row.error = `${error.message || '本项未完成'}${row.status === 'interrupted' ? '；请求状态不确定，不会自动重发。' : ''}`; next.status = 'paused'; }).catch(() => undefined); break;
      }
    }
  }
  function launch(id) { if (pumping) return; const task = pump(id); pumping = { id, task }; void task.finally(() => { if (pumping?.task === task) pumping = undefined; }).catch(() => undefined); }
  async function reconcileTrackedRuns(id) {
    const current = await snapshot(), known = new Map(current.runs.map(run => [run.id, run]));
    await mutate(id, next => {
      for (const row of next.items.filter(item => !['queued', 'cancelled', 'complete'].includes(item.status))) {
        const run = known.get(row.runId); if (!run) continue;
        const outputError = imageGroupOutputError(next, row, run);
        if (run.status === 'complete') { row.status = outputError ? 'failed' : 'complete'; row.error = outputError; row.artifacts = run.attempts.flatMap(attempt => attempt.artifacts || []); }
        else if (active(run.status)) row.status = run.status === 'waiting-review' ? 'waiting-review' : 'running';
      }
    });
  }
  async function noOtherBatch(id) { if (pumping && pumping.id !== id) throw new Error('另一个批次仍在处理，请先暂停并等待当前项结束。'); const current = await snapshot(); if ([...records.values()].some(record => record.id !== id && record.items.some(item => current.runs.some(run => run.id === item.runId && active(run.status))))) throw new Error('其它批次仍有活动任务，请先处理后再开始。'); }
  return {
    parse(input) { return parseBatchImport(input, loadModule); },
    async create(input) {
      await ready; if (closing) throw new Error('应用正在退出。');
      if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_ROWS || input.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 50 || Object.entries(row).some(([key, value]) => key.length > 100 || typeof value !== 'string' || value.length > 10000))) throw new Error('批量名称或数据行无效。');
      const { workflow, project, connections, models, variables, attachmentIds } = input.request || {};
      if (!workflow || !project || workflow.workspaceId !== project.workspaceId || workflow.outputKind !== project.kind || !validId(project.workspaceId)) throw new Error('批量项目与工作区或流程类型不匹配。');
      if (!(await workspaceStorage.list()).workspaces.some(item => item.workspaceId === project.workspaceId)) throw new Error('请先为批量目标工作区绑定本地文件夹。');
      if (attachmentIds?.length) { const locations = await workspaceStorage.list(); for (const file of await artifactStore.list(attachmentIds)) if (!locations.projects.some(item => item.projectId === file.projectId && item.workspaceId === project.workspaceId)) throw new Error('共享参考文件必须属于本工作区。'); }
      const request = safeRequest({ workflow, project, connections, models, input: input.request.input, variables: variables || {}, attachmentIds: attachmentIds || [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
      const grouped = input.imageGroupCounts !== undefined;
      if (grouped) { validateImageGroupTemplate(request); validateImageGroupCounts(input.imageGroupCounts, input.rows.length); }
      const time = now(), id = randomUUID(), template = typeof input.projectNameTemplate === 'string' ? input.projectNameTemplate.slice(0, 200) : `${input.name} · {{序号}}`;
      const items = input.rows.map((values, index) => { const row = { ...values, 序号: String(index + 1) }, name = replaceVariables(template, { ...request.variables, ...row }).content.trim().slice(0, 100) || `${input.name} ${index + 1}`; return { id: randomUUID(), row: index + 1, variables: row, project: { id: randomUUID(), workspaceId: project.workspaceId, name, kind: project.kind, description: request.input, status: 'draft', costCents: 0, ...(project.budgetCents == null ? {} : { budgetCents: project.budgetCents }), version: 0, updatedAt: time, accent: project.accent || 'blue' }, status: 'queued', attempts: [], artifacts: [] }; });
      if (grouped) items.forEach((item, index) => { const resolved = replaceVariables(request.input, { ...request.variables, ...item.variables }); if (resolved.missing.length || !resolved.content.trim()) throw new Error('有分组需求为空或缺少变量，未创建项目或发送请求。'); item.imageCount = input.imageGroupCounts[index]; item.project.description = resolved.content; });
      for (const item of items) { await assertAdmission(item.project); const place = await workspaceStorage.ensureProject({ projectId: item.project.id, workspaceId: item.project.workspaceId, name: item.project.name }); item.project.directory = place.directory; }
      const record = { version: 1, id, name: input.name.trim(), workspaceId: project.workspaceId, status: 'queued', createdAt: time, updatedAt: time, items, request, projectNameTemplate: template, ...(grouped ? { kind: 'image-groups' } : {}) };
      await serial(() => write(record)); return publicRecord(record, await snapshot());
    },
    async list() { await ready; const current = await snapshot(), items = [...records.values()].reverse(); if (!items.length) return []; const index = indexSnapshot(current); return Promise.all(items.map(record => publicRecord(record, current, index))); },
    async get({ id }) { await ready; const record = records.get(id); if (!record) throw new Error('批次不存在。'); return publicRecord(record, await snapshot()); },
    async exportRecords(projectIds) { await ready; await queue; const ids = new Set(projectIds); return [...records.values()].filter(record => record.items.some(item => ids.has(item.project.id))).map(record => ({ ...structuredClone(record), items: structuredClone(record.items.filter(item => ids.has(item.project.id))) })); },
    async importRecords(incoming, { idMap, backupId } = {}) {
      await ready; if (!Array.isArray(incoming)) throw new Error('备份批量记录无效。');
      const remap = value => typeof value === 'string' ? (idMap?.get?.(value) || idMap?.[value] || value) : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)])) : value;
      return serial(async () => {
        const imported = [];
        for (const raw of incoming) {
          const record = remap(structuredClone(raw));
          if (record.version !== 1 || !validId(record.id) || !record.request || !Array.isArray(record.items) || !record.items.length || record.items.some(item => !validId(item.id) || !validId(item.project?.id) || !Array.isArray(item.attempts))) throw new Error('备份中的批次结构无效。');
          validateImageGroupRecord(record);
          const existing = records.get(record.id); if (existing) { if (backupId && existing.importedBackupId === backupId) { imported.push(record.id); continue; } throw new Error('恢复的批次编号与现有记录冲突，未覆盖。'); }
          record.importedBackupId = backupId; record.updatedAt = now(); record.status = record.items.every(item => item.status === 'complete') ? 'complete' : 'interrupted'; record.error = record.status === 'complete' ? undefined : '从备份恢复的批次未自动执行，请检查已提交任务后明确继续。';
          delete record.request.project.directory;
          for (const item of record.items) { delete item.project.directory; if (['submitting', 'running', 'waiting-review'].includes(item.status)) { item.status = 'interrupted'; item.error = '恢复后未自动重发请求，请核对项目运行记录。'; } }
          await write(record); imported.push(record.id);
        }
        return { imported };
      });
    },
    async control({ id, action, itemId }) {
      await ready; if (closing) throw new Error('应用正在退出。'); const record = records.get(id); if (!record) throw new Error('批次不存在。');
      const item = itemId ? record.items.find(item => item.id === itemId) : undefined;
      if (['retry-item', 'cancel-item', 'resume-review'].includes(action) && !item) throw new Error('请选择该批次中的一项。');
      if (action === 'start') { await noOtherBatch(id); if (record.status === 'complete' || record.status === 'cancelled') throw new Error('批次已结束，请明确重试需要处理的单项。'); await reconcileTrackedRuns(id); await mutate(id, next => { next.status = 'running'; next.error = undefined; }); launch(id); }
      else if (action === 'pause') await mutate(id, next => { next.status = 'paused'; });
      else if (action === 'cancel' || action === 'cancel-item') {
        const targets = action === 'cancel' ? record.items : [item]; for (const row of targets) { const run = await linkedRun(row); if (run && active(run.status)) await liveEngine.control({ id: run.id, action: 'cancel' }); }
        await mutate(id, next => { if (action === 'cancel') next.status = 'cancelled'; for (const row of next.items) if ((action === 'cancel' || row.id === itemId) && row.status !== 'complete') row.status = 'cancelled'; });
      } else if (action === 'retry-item') {
        await noOtherBatch(id); const run = await linkedRun(item); if (run && active(run.status) || !['failed', 'interrupted', 'cancelled'].includes(item.status)) throw new Error('请先处理当前活动任务；只有失败、中断或取消项可明确重试。');
        await mutate(id, next => { const row = next.items.find(row => row.id === itemId); row.status = 'queued'; row.retryExisting = true; row.error = undefined; next.status = 'running'; }); launch(id);
      } else if (action === 'resume-review') {
        await noOtherBatch(id); const run = await linkedRun(item); if (!run || run.status !== 'waiting-review') throw new Error('该项不在等待人工检查阶段。'); await withProjectWrite(item.project.id, async () => { await admission(item.project); await liveEngine.control({ id: run.id, action: 'resume' }); }); await mutate(id, next => { next.items.find(row => row.id === itemId).status = 'running'; next.status = 'running'; }); launch(id);
      } else throw new Error('批量操作无效。');
      return publicRecord(records.get(id), await snapshot());
    },
    async shutdown() { closing = true; await ready; for (const record of [...records.values()]) if (['running', 'waiting-review'].includes(record.status)) await mutate(record.id, next => { next.status = 'interrupted'; next.error = '应用关闭，后续批量项未提交；重开后请明确继续。'; }); await pumping?.task.catch(() => undefined); await queue; },
    async drain() { await queue; },
  };
}
module.exports = { createBatchProduction, quickReviewTail };
