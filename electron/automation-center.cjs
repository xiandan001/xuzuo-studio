const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { safeRequest } = require('./live-workflow-engine.cjs');
const { exportAutomationBackup, mergeAutomationBackup } = require('./automation-backup.cjs');
const { ruleCreationFingerprint } = require('./automation-rule-identity.cjs');
const { normalizePreparation, assertPreparation } = require('./automation-rule-preparation.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const active = run => ['running', 'paused', 'waiting-review'].includes(run.status);
const triggers = new Set(['manual', 'schedule', 'reference-imported', 'run-completed']);
const validCreationIdentity = rules => rules.every(rule => rule.creationKey === undefined || validId(rule.creationKey) && (rule.creationFingerprint === undefined || /^[a-f0-9]{64}$/.test(rule.creationFingerprint))) && new Set(rules.map(rule => rule.creationKey).filter(Boolean)).size === rules.filter(rule => rule.creationKey).length;
const empty = () => ({ version: 1, revision: 0, context: { workspaces: [], projects: [], workflows: [], connections: [], models: [] }, rules: [], events: [], jobs: [], decisions: [], memories: [], projectArchives: [], projectOwners: [] });

function createAutomationCenter({ directory, liveEngine, assertAdmission = async () => true, start, control, fileSystem = fs, clock = () => Date.now(), onChanged = () => undefined }) {
  let purgeGuard = () => false, purgeReady = Promise.resolve();
  const filename = path.join(path.resolve(directory), 'automation-center-v1.json');
  let state = empty(), issue = '', writes = Promise.resolve(), pumping, closed = false, timer, contextSynced = false;
  let runtimeRevision = -1, watched = ''; const runtimeRuns = new Map();
  const reservations = new Map(), dispatchClaims = new Map();
  const readinessEpochs = new Map();
  const now = () => new Date(clock()).toISOString();
  function setIssue(message) { if (issue === message) return; issue = message; try { onChanged({ revision: state.revision }); } catch { /* Read-only UI feedback cannot alter the journal. */ } }
  const validate = value => value?.version === 1 && Number.isSafeInteger(value.revision) && ['rules', 'events', 'jobs', 'decisions', 'memories'].every(key => Array.isArray(value[key])) && value.context && value.rules.every(rule => validId(rule.id) && validId(rule.workspaceId) && validId(rule.projectId) && typeof rule.enabled === 'boolean' && triggers.has(rule.trigger)) && validCreationIdentity(value.rules) && value.jobs.every(job => validId(job.id) && validId(job.projectId) && /^[a-f0-9]{64}$/.test(job.dispatchKey));
  async function load() {
    await checkedDirectory(fileSystem, path.dirname(filename), true);
    try { await checkedFile(fileSystem, filename); const stat = await fileSystem.stat(filename); if (stat.size > 32 * 1024 * 1024) throw Error('size'); const value = JSON.parse(await fileSystem.readFile(filename, 'utf8')); if (!validate(value) || ['projectArchives', 'projectOwners'].some(key => value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !validId(item.projectId) || !validId(item.workspaceId))))) throw Error('shape'); for (const rule of [...value.rules, ...value.jobs.map(job => job.ruleSnapshot).filter(Boolean)]) normalizePreparation(rule.preparation); state = { ...value, projectArchives: value.projectArchives || [], projectOwners: value.projectOwners || [] }; for (const job of state.jobs) if (job.status === 'complete' && !job.cancelRequestedAt) delete job.error; setIssue(''); }
    catch (error) { if (error.code === 'ENOENT') { state = empty(); setIssue(''); } else { setIssue('自动化记录无法可靠读取，原文件未覆盖；请检查原文件或恢复备份后重新读取。'); throw Error(issue); } }
  }
  const ready = load(); void ready.catch(() => undefined);
  function mutate(change) {
    const task = writes.then(async () => {
      await ready.catch(() => undefined); await purgeReady; if (issue) throw Error(issue);
      const next = structuredClone(state), result = await change(next); if (result === false) return false;
      next.revision++; const size = Buffer.byteLength(JSON.stringify(next, null, 2) + '\n'); if (size > 32 * 1024 * 1024) throw Error('自动化记录超过本地容量，未执行新的任务。');
      try { await atomicJson(fileSystem, filename, next); } catch (cause) { setIssue('自动化修改未能保存，已停止派工；请检查磁盘后重新读取。'); throw Error(issue, { cause }); }
      state = next; try { onChanged({ revision: state.revision }); } catch { /* Notification does not change the durable queue. */ } return result;
    }); writes = task.catch(() => undefined); return task;
  }
  const contextFor = (value, rule) => {
    const project = value.context.projects.find(item => item.id === rule.projectId && item.workspaceId === rule.workspaceId && !item.trashedAt);
    const workflow = value.context.workflows.find(item => item.id === rule.workflowId && item.workspaceId === rule.workspaceId);
    if (!project || !workflow || project.kind !== workflow.outputKind) throw Error('项目、工作流或输出类型已变化，请在自动化规则中重新选择。');
    return { project, workflow };
  };
  const archived = (value, projectId) => purgeGuard(projectId) || value.projectArchives.some(item => item.projectId === projectId) || !value.context.projects.some(project => project.id === projectId && !project.trashedAt && value.context.workspaces.some(workspace => workspace.id === project.workspaceId && !workspace.removedAt));
  function jobContext(value, job) {
    const project = value.context.projects.find(item => item.id === job.projectId && item.workspaceId === job.workspaceId && !item.trashedAt);
    const frozen = job.workflowSnapshot || value.context.workflows.find(item => item.id === job.ruleSnapshot?.workflowId && item.workspaceId === job.workspaceId);
    if (!project || !frozen || frozen.outputKind !== project.kind || archived(value, project.id)) throw Error('项目已整理、移动尚未同步或输出类型变化，请先恢复有效项目。');
    return { project, workflow: { ...structuredClone(frozen), workspaceId: project.workspaceId } };
  }
  const nativeRun = (runs, job) => runs.find(run => run.projectId === job.projectId && (run.id === job.runId || run.dispatchKey === job.dispatchKey));
  const reviewPending = (value, projectId, exceptJobId) => value.decisions.some(card => card.projectId === projectId && card.kind === 'review' && !card.resolvedAt && card.jobId !== exceptJobId && value.jobs.some(job => job.id === card.jobId && !['complete', 'cancelled'].includes(job.status)));
  function resolveCards(value, jobId, action) { for (const card of value.decisions.filter(card => card.jobId === jobId && !card.resolvedAt)) { card.resolvedAt = now(); card.action = action; } }
  function terminalJob(value, job, run) {
    if (job.runId === run.id && job.nativeStatus === run.status && !job.cancellationPending && job.status === (run.status === 'complete' ? 'complete' : 'cancelled') && !value.decisions.some(card => card.jobId === job.id && !card.resolvedAt)) return false;
    job.runId = run.id; job.nativeStatus = run.status; job.cancellationPending = false; delete job.cancelError; job.status = run.status === 'complete' ? 'complete' : 'cancelled'; job.updatedAt = now();
    if (job.cancelRequestedAt) job.error = run.status === 'complete' ? '后台任务已经完成，已发生的费用与产物保留；取消没有撤回这次执行。' : `已停止本平台继续执行，后台状态为 ${run.status}；已发生费用保留。`;
    else delete job.error;
    resolveCards(value, job.id, run.status === 'complete' ? 'refresh' : 'reject');
    return true;
  }
  function cancellationCard(value, job, detail) {
    const card = value.decisions.find(item => item.jobId === job.id && !item.resolvedAt);
    if (job.cancellationPending && job.status === 'decision' && job.error === detail && card?.detail === detail && card.runId === job.runId) return false;
    job.cancellationPending = true; job.status = 'decision'; job.error = detail; job.updatedAt = now();
    if (card) Object.assign(card, { runId: job.runId, kind: 'uncertain', title: '取消尚未确认', detail });
    else value.decisions.push({ id: randomUUID(), jobId: job.id, runId: job.runId, workspaceId: job.workspaceId, projectId: job.projectId, kind: 'uncertain', title: '取消尚未确认', detail, createdAt: now() });
    return true;
  }
  async function runsFor(projectId) { const snapshot = await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: [projectId] }); if (!snapshot || !Array.isArray(snapshot.runs)) throw Error('后台状态尚未可靠读取，未确认取消或目录操作。'); return snapshot.runs; }
  async function confirmCancellation(jobId, retry = false, knownRuns) {
    let job = state.jobs.find(item => item.id === jobId); if (!job?.cancelRequestedAt) return;
    let run, failure;
    try { run = nativeRun(knownRuns || await runsFor(job.projectId), job); }
    catch (error) { failure = error; }
    if (run) await mutate(next => { const current = next.jobs.find(item => item.id === jobId); if (current.runId === run.id && current.nativeStatus === run.status) return false; current.runId = run.id; current.nativeStatus = run.status; });
    job = state.jobs.find(item => item.id === jobId);
    if (run && ['complete', 'cancelled', 'failed', 'interrupted'].includes(run.status)) { await mutate(next => terminalJob(next, next.jobs.find(item => item.id === jobId), run)); return; }
    if (!failure && !run && !job.runId && !dispatchClaims.has(job.projectId)) { await mutate(next => { const current = next.jobs.find(item => item.id === jobId); current.status = 'cancelled'; current.cancellationPending = false; current.updatedAt = now(); resolveCards(next, jobId, 'reject'); }); return; }
    if (run && active(run) && (retry || job.cancelAttemptRunId !== run.id)) {
      await mutate(next => { next.jobs.find(item => item.id === jobId).cancelAttemptRunId = run.id; });
      try { await control({ id: run.id, action: 'cancel' }); await mutate(next => { const current = next.jobs.find(item => item.id === jobId); if (!current.cancelError) return false; delete current.cancelError; }); const latest = nativeRun(await runsFor(job.projectId), { ...job, runId: run.id }); if (latest && ['complete', 'cancelled', 'failed', 'interrupted'].includes(latest.status)) { await mutate(next => terminalJob(next, next.jobs.find(item => item.id === jobId), latest)); return; } run = latest || run; }
      catch (error) { failure = error; try { const latest = nativeRun(await runsFor(job.projectId), { ...job, runId: run.id }); if (latest && ['complete', 'cancelled', 'failed', 'interrupted'].includes(latest.status)) { await mutate(next => terminalJob(next, next.jobs.find(item => item.id === jobId), latest)); return; } run = latest || run; } catch { /* Keep the failed cancellation pending until a later verified read. */ } }
    }
    if (failure) await mutate(next => { const current = next.jobs.find(item => item.id === jobId), text = String(failure.message).slice(0, 1800); if (current.cancelError === text) return false; current.cancelError = text; });
    const cancelError = state.jobs.find(item => item.id === jobId)?.cancelError;
    const detail = cancelError ? `取消未能确认：${cancelError}。已绑定的运行记录与费用保留；可重新读取或再次请求取消。` : run ? `取消请求正在等待后台确认，当前状态为 ${run.status}。不会重新派工，也不会撤回已发生费用。` : job.runId ? '已关联的后台运行记录暂未找到，尚不能确认取消。请重新读取或恢复原记录；不会重新派工。' : '派工仍未返回运行编号，正在等待关联记录后确认取消；不会重新派工。';
    await mutate(next => { const current = next.jobs.find(item => item.id === jobId); return !['complete', 'cancelled'].includes(current.status) || current.cancellationPending ? cancellationCard(next, current, detail) : false; });
    if (failure && retry) throw Error(detail);
  }
  async function acquireProject(projectId, allowReview = false) {
    if (!validId(projectId)) throw Error('项目编号无效。');
    if (reservations.has(projectId) || dispatchClaims.has(projectId)) throw Error('自动化派工或项目目录操作正在进行，请稍后重试。');
    const token = Symbol(projectId); reservations.set(projectId, token);
    try {
      await ready.catch(() => undefined); await writes; if (issue) throw Error(issue);
      const runs = await runsFor(projectId), jobs = state.jobs.filter(job => job.projectId === projectId);
      const busy = jobs.some(job => job.cancellationPending || job.status === 'dispatching' || job.status === 'running' && (!nativeRun(runs, job) || !['complete', 'cancelled', 'failed', 'interrupted', ...(allowReview ? ['waiting-review'] : [])].includes(nativeRun(runs, job).status)));
      if (busy || runs.some(run => run.projectId === projectId && (allowReview ? ['running', 'paused'].includes(run.status) : active(run))) || !allowReview && reviewPending(state, projectId)) throw Error('项目仍有运行、待检查或取消待确认的任务，请先处理后再整理目录。');
      return async location => {
        try { if (location?.workspaceId) { if (!validId(location.workspaceId)) throw Error('目录登记工作区无效。'); await mutate(next => { const previousOwner = next.projectOwners.find(item => item.projectId === projectId); migrateOwner(next, projectId, location.workspaceId); next.projectOwners = [...next.projectOwners.filter(item => item.projectId !== projectId), { ...previousOwner, projectId, workspaceId: location.workspaceId, registeredAt: now() }]; }); } }
        finally { if (reservations.get(projectId) === token) reservations.delete(projectId); tick(); }
      };
    } catch (error) { if (reservations.get(projectId) === token) reservations.delete(projectId); throw error; }
  }
  function migrateOwner(value, projectId, workspaceId) {
    const project = value.context.projects.find(item => item.id === projectId); if (project) project.workspaceId = workspaceId;
    const guard = value.projectArchives.find(item => item.projectId === projectId); if (guard) guard.workspaceId = workspaceId;
    for (const key of ['rules', 'events', 'jobs', 'decisions', 'memories']) for (const item of value[key].filter(item => item.projectId === projectId && item.workspaceId !== workspaceId)) {
      item.originWorkspaceId ||= item.workspaceId; item.workspaceId = workspaceId;
      if (key === 'rules') { item.enabled = false; item.updatedAt = now(); item.lastTriggeredAt = now(); }
      if (key === 'jobs' && item.status === 'queued') { item.status = 'cancelled'; item.updatedAt = now(); resolveCards(value, item.id, 'reject'); }
    }
  }
  function acceptedKind(file, workflow) {
    if (file.kind === undefined) return true;
    if (file.mimeType === 'application/pdf') return false;
    if (['text', 'office'].includes(file.kind)) return true;
    const steps = workflow.steps.filter(step => step.enabled);
    if (file.kind === 'image') return workflow.outputKind === 'image' || steps.some(step => ['vision', 'image-generation', 'image-editing', 'video-understanding'].includes(step.kind) || step.documentImageSource === 'references');
    if (file.kind === 'audio') return steps.some(step => step.kind === 'transcription');
    if (file.kind === 'video') return steps.some(step => step.kind === 'video-understanding');
    return false;
  }
  function completionInputs(run, target) {
    const steps = run.snapshot?.steps || [], attempts = run.attempts.filter(attempt => attempt.status === 'complete');
    const exported = [...steps].reverse().filter(step => step.enabled && step.kind === 'export').map(step => attempts.findLast(attempt => attempt.stepId === step.id)).find(Boolean);
    const sourceFiles = exported ? exported.artifacts || [] : steps.filter(step => step.enabled && !['planner', 'reviewer'].includes(step.role) && !['manual-review', 'export'].includes(step.kind)).flatMap(step => attempts.findLast(attempt => attempt.stepId === step.id)?.artifacts || []);
    const customer = exported ? sourceFiles.filter(file => ['office','image','audio','video'].includes(file.kind) || file.mimeType === 'application/pdf') : sourceFiles.filter(file => !(file.kind === 'text' && /\.json$/i.test(file.name || '') && /检查|质检|核对|review|check/i.test(file.name || '')));
    const candidates = customer.length || !exported ? customer : sourceFiles.filter(file => !(file.mimeType === 'application/json' || /\.json$/i.test(file.name || '')));
    const unique = [...new Map(candidates.map(file => [file.id, file])).values()];
    const invalid = unique.find(file => !validId(file.id) || file.trashedAt || file.unavailable || file.projectId && file.projectId !== run.projectId || !acceptedKind(file, target));
    return { attachmentIds: unique.map(file => file.id), ...(invalid ? { inputIssue: '来源成品包含不可用、跨项目或当前流程不能读取的文件。请调整规则/资料后重新触发，未自动丢弃文件或调用模型。' } : unique.length > 16 ? { inputIssue: `来源成品共 ${unique.length} 份，超过单次16份参考资料上限。请先整理或分批处理，未静默截断。` } : {}) };
  }
  function requestAttachments(job, project, workflow) {
    if (job.inputIssue) throw Object.assign(Error(job.inputIssue), { code: 'AUTOMATION_INPUTS' });
    const saved = (project.referenceFiles || []).filter(file => ['text', 'office'].includes(file.kind) || file.kind === 'image' && acceptedKind(file, workflow));
    const ids = [...new Set([...(job.attachmentIds || []), ...saved.map(file => file.id)])];
    if (ids.some(id => !validId(id)) || ids.length > 16) throw Object.assign(Error(`本次事件与项目参考资料合计 ${ids.length} 份，最多16份。请先整理资料，未静默删除任何输入。`), { code: 'AUTOMATION_INPUTS' });
    return ids;
  }
  function readiness(value, rule) {
    assertPreparation(rule);
    const context = contextFor(value, rule);
    if (archived(value, rule.projectId) || reservations.has(rule.projectId)) throw Error('项目正在整理或已回收，请恢复后再运行。');
    const request = safeRequest({ ...context, models: value.context.models, connections: value.context.connections, input: rule.input, variables: rule.variables || {}, attachmentIds: typeof liveEngine.preflight === 'function' ? requestAttachments({}, context.project, context.workflow) : [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
    return { request, signature: hash(JSON.stringify({ request, epoch: readinessEpochs.get(rule.id) || 0, preparation: rule.preparation, trigger: rule.trigger, intervalMinutes: rule.intervalMinutes, sourceWorkflowId: rule.sourceWorkflowId, stored: value.rules.filter(item => item.id === rule.id).map(({ updatedAt, lastTriggeredAt, ...item }) => item) })) };
  }
  async function checkReadiness(rule, allowFutureAttachments) {
    await ready; await writes; const captured = readiness(state, rule);
    if (typeof liveEngine.preflight === 'function') {
      const check = await liveEngine.preflight(captured.request);
      if (!check.ok) {
        const deferred = new Set(allowFutureAttachments && !captured.request.attachmentIds.length ? (check.issues || []).filter(item => ['attachments', 'inputSource'].includes(item.field) && /需要参考图片|需要添加音频参考|需要添加视频文件|请选择当前项目的/.test(item.message)).map(item => item.message) : []);
        const errors = (check.errors || []).filter(message => !deferred.has(message));
        if (errors.length || !(check.errors || []).length) throw Error(`当前规则还不能运行，请补齐调用设置或资料：${errors.join('；') || '预检未通过'}`);
      }
    }
    return captured.signature;
  }
  function verifyReadiness(value, rule, signature) { if (readiness(value, rule).signature !== signature) throw Error('规则或项目配置在检查期间已变化，请重新检查后再运行。'); }
  function scopedContext(previous, incoming, workspaceId) {
    const ids = new Set(incoming.map(item => item.id));
    const retained = workspaceId ? previous.filter(item => item.workspaceId !== workspaceId && !ids.has(item.id)) : [];
    return [...new Map([...retained, ...incoming].map(item => [item.id, item])).values()];
  }
  async function continueJob(job, action) {
    if (reservations.has(job.projectId) || dispatchClaims.has(job.projectId) || archived(state, job.projectId) || reviewPending(state, job.projectId, job.id)) throw Error('项目正在整理目录或等待其他检查，请完成后再继续。');
    const claim = Symbol(job.projectId); dispatchClaims.set(job.projectId, claim);
    try {
      const current = state.jobs.find(item => item.id === job.id); if (current.cancelRequestedAt) throw Error('此任务已请求取消，不能继续或重新派工；请先核对取消结果。');
      assertPreparation(current.ruleSnapshot || state.rules.find(rule => rule.id === current.ruleId) || {});
      const candidates = await runsFor(job.projectId), run = nativeRun(candidates, current);
      if (candidates.some(other => other.projectId === job.projectId && other.id !== run?.id && active(other))) throw Error('项目已有其他运行或待检查任务，未执行续跑。');
      if (!run) {
        if (current.runId) throw Error('原运行记录暂时找不到，请先重新读取或恢复原记录，未重新派工。');
        if (action !== 'continue') throw Error('请先重新核对派工状态，再明确继续。');
        jobContext(state, current);
        if (current.configurationPending) await mutate(next => {
          const target = next.jobs.find(item => item.id === job.id), fresh = next.context.workflows.find(workflow => workflow.id === target.workflowSnapshot?.id && workflow.workspaceId === target.workspaceId);
          if (fresh) { const project = next.context.projects.find(project => project.id === target.projectId); if (fresh.outputKind !== project.kind) throw Error('最新流程的作品类型已改变，请为原任务重新选择兼容流程。'); target.workflowSnapshot = structuredClone(fresh); target.configurationRefreshedAt = now(); }
          const rule = next.rules.find(rule => rule.id === target.ruleId);
          if (rule && target.ruleSnapshot) { const variables = { ...target.ruleSnapshot.variables }; for (const [name, value] of Object.entries(rule.variables || {})) if (!variables[name]?.trim() && typeof value === 'string' && value.trim()) variables[name] = value; target.ruleSnapshot.variables = variables; }
          delete target.configurationPending;
        });
        return { status: 'queued' };
      }
      await mutate(next => { const target = next.jobs.find(item => item.id === job.id); if (target.runId === run.id && target.nativeStatus === run.status) return false; target.runId = run.id; target.nativeStatus = run.status; });
      if (['complete', 'cancelled'].includes(run.status)) return { status: run.status, run };
      if (run.status === 'running') return { status: 'running', run };
      if (run.status === 'waiting-review' && action !== 'approve') throw Error('后台正在等待人工检查，请重新读取后明确验收，未执行续跑。');
      if (action === 'approve' && run.status !== 'waiting-review') throw Error('后台已不处于等待检查状态，请重新读取结果后再处理。');
      const context = jobContext(state, state.jobs.find(item => item.id === job.id));
      await control({ id: run.id, action: action === 'approve' ? 'resume' : 'continue', ...context, connections: state.context.connections, models: state.context.models });
      const latest = nativeRun(await runsFor(job.projectId), { ...current, runId: run.id });
      return { status: latest && ['complete', 'cancelled'].includes(latest.status) ? latest.status : latest && ['failed', 'interrupted', 'paused', 'waiting-review'].includes(latest.status) ? 'decision' : 'running', run: latest || run };
    } finally { if (dispatchClaims.get(job.projectId) === claim) dispatchClaims.delete(job.projectId); }
  }
  function addDecision(value, job, kind, title, detail) {
    const existing = value.decisions.find(item => item.jobId === job.id && !item.resolvedAt);
    if (existing) { if (existing.kind === kind && existing.title === title && existing.detail === String(detail).slice(0,3000) && job.status === 'decision' && job.error === detail) return false; Object.assign(existing, { runId: job.runId, kind, title, detail: String(detail).slice(0,3000) }); job.status = 'decision'; job.error = detail; job.updatedAt = now(); return true; }
    job.status = 'decision'; job.error = detail; job.updatedAt = now();
    value.decisions.push({ id: randomUUID(), jobId: job.id, runId: job.runId, workspaceId: job.workspaceId, projectId: job.projectId, kind, title, detail: String(detail).slice(0, 3000), createdAt: now() });
    return true;
  }
  function enqueue(value, rule, event, chain = []) {
    if (reservations.has(rule.projectId) || archived(value, rule.projectId)) return undefined;
    if (chain.includes(rule.id) || chain.length >= 8) return undefined;
    const dispatchKey = hash(`${rule.id}\0${rule.updatedAt}\0${event.id}`), existing = value.jobs.find(job => job.dispatchKey === dispatchKey);
    if (existing) return existing;
    if (value.jobs.filter(job => ['queued', 'dispatching', 'running'].includes(job.status)).length >= 100) throw Error('待执行任务已达100项，请先处理队列。');
    if (!value.events.some(item => item.id === event.id)) value.events.push(event);
    const job = { id: randomUUID(), ruleId: rule.id, ruleSnapshot: structuredClone(rule), workflowSnapshot: structuredClone(contextFor(value, rule).workflow), workspaceId: rule.workspaceId, projectId: rule.projectId, eventId: event.id, dispatchKey, status: 'queued', createdAt: now(), updatedAt: now(), attachmentIds: event.attachmentIds || [], ...(event.inputIssue ? { inputIssue: event.inputIssue } : {}), input: [rule.input, event.input].filter(Boolean).join('\n\n'), ruleChain: [...chain, rule.id] };
    value.jobs.push(job); rule.lastTriggeredAt = now(); return job;
  }
  async function pump() {
    await ready.catch(() => undefined); if (closed || issue || !contextSynced) return;
    if (!state.rules.some(rule => rule.enabled) && !state.jobs.some(job => ['queued', 'dispatching', 'running'].includes(job.status) || job.cancellationPending || job.status === 'decision' && job.runId)) return;
    const projectIds = [...new Set([...state.rules.filter(rule => rule.enabled).map(rule => rule.projectId), ...state.jobs.filter(job => ['queued', 'dispatching', 'running'].includes(job.status) || job.cancellationPending || job.status === 'decision' && job.runId).map(job => job.projectId)])].sort();
    const signature = projectIds.join(','); if (signature !== watched) { watched = signature; runtimeRevision = -1; runtimeRuns.clear(); }
    const incoming = await liveEngine.snapshot(runtimeRevision, { summaryOnly: true, delta: true, projectIds });
    if (incoming) { if (!incoming.delta) runtimeRuns.clear(); for (const run of incoming.runs) runtimeRuns.set(run.id, run); runtimeRevision = incoming.revision ?? -1; }
    const snapshot = { runs: [...runtimeRuns.values()] };
    await mutate(next => {
      let changed = false;
      for (const rule of next.rules.filter(rule => rule.enabled && rule.trigger === 'schedule')) {
        if (clock() - Date.parse(rule.lastTriggeredAt || rule.updatedAt) < rule.intervalMinutes * 60000) continue;
        const before = next.jobs.length; enqueue(next, rule, { id: hash(`schedule:${rule.id}:${Math.floor(clock() / (rule.intervalMinutes * 60000))}`), trigger: 'schedule', sourceId: rule.id, workspaceId: rule.workspaceId, projectId: rule.projectId, createdAt: now() }); if (next.jobs.length !== before) changed = true;
      }
      for (const job of next.jobs.filter(job => ['running', 'dispatching'].includes(job.status) || job.status === 'decision' && job.runId || job.cancellationPending)) {
        const run = snapshot.runs.find(run => run.id === job.runId || run.dispatchKey === job.dispatchKey);
        if (!run) { if (!job.cancellationPending && job.status === 'dispatching' && !dispatchClaims.has(job.projectId)) changed = addDecision(next, job, 'uncertain', '派工尚未确认', '未找到已保存的运行记录。仅读取不会重新派工；请核对后明确继续或取消。') || changed; continue; }
        if (job.runId !== run.id || job.nativeStatus !== run.status) { job.runId = run.id; job.nativeStatus = run.status; changed = true; }
        if (job.cancellationPending) { if (['complete', 'cancelled', 'failed', 'interrupted'].includes(run.status)) changed = terminalJob(next, job, run) || changed; continue; }
        if (run.status === 'complete' || run.status === 'cancelled') { changed = terminalJob(next, job, run) || changed; }
        else if (['waiting-review', 'failed', 'interrupted', 'paused'].includes(run.status)) { changed = addDecision(next, job, run.status === 'waiting-review' ? 'review' : 'failure', run.status === 'waiting-review' ? '检查这次实际结果' : '这项任务需要处理', run.error || (run.status === 'paused' ? '任务已暂停，请检查预算或当前步骤后继续。' : '请检查已保存结果、费用和错误，再决定继续或拒绝。')) || changed; }
        else if (job.status !== 'running') { job.status = 'running'; resolveCards(next, job.id, 'refresh'); changed = true; }
      }
      for (const run of (incoming?.runs || []).filter(run => run.status === 'complete' && !run.trashedAt && run.purpose !== 'automation-plan')) {
        const completedAt = run.completedAt || [...run.attempts].reverse().find(attempt => attempt.completedAt)?.completedAt || run.createdAt;
        for (const rule of next.rules.filter(rule => rule.enabled && rule.trigger === 'run-completed' && rule.workspaceId === run.workspaceId && rule.projectId === run.projectId && rule.sourceWorkflowId === run.workflowId && Date.parse(completedAt) >= Date.parse(rule.updatedAt))) {
          const parent = next.jobs.find(job => job.runId === run.id), event = { id: hash(`completion:${run.id}:${run.attempts.at(-1)?.id || run.updatedAt}`), trigger: 'run-completed', sourceId: run.id, workspaceId: rule.workspaceId, projectId: rule.projectId, createdAt: now(), ...completionInputs(run, contextFor(next, rule).workflow) };
          const previous = next.jobs.length; enqueue(next, rule, event, parent?.ruleChain || []); if (next.jobs.length !== previous) changed = true;
        }
      }
      return changed;
    });
    for (const job of state.jobs.filter(job => job.cancellationPending)) await confirmCancellation(job.id, false, snapshot.runs);
    for (const pending of state.jobs.filter(job => job.status === 'queued')) {
      if (closed || issue || !contextSynced) break;
      if (new Set([...snapshot.runs.filter(run => run.status === 'running').map(run => run.id), ...state.jobs.filter(job => ['dispatching', 'running'].includes(job.status)).map(job => job.runId || job.id)]).size >= 2) break;
      if (reservations.has(pending.projectId) || dispatchClaims.has(pending.projectId) || archived(state, pending.projectId) || reviewPending(state, pending.projectId, pending.id) || snapshot.runs.some(run => run.projectId === pending.projectId && active(run)) || state.jobs.some(job => job.id !== pending.id && job.projectId === pending.projectId && (['dispatching', 'running'].includes(job.status) || job.cancellationPending))) continue;
      let request; const claim = Symbol(pending.projectId); dispatchClaims.set(pending.projectId, claim);
      try {
        const rule = pending.ruleSnapshot || state.rules.find(rule => rule.id === pending.ruleId); if (!rule) throw Error('来源规则不存在。');
        const context = jobContext(state, pending); if (!await assertAdmission(context.project)) continue;
        const memories = state.memories.filter(memory => memory.workspaceId === pending.workspaceId && memory.projectId === pending.projectId).slice(-20);
        const remembered = memories.length ? `\n\n【用户明确保存的本项目偏好与决定】\n${memories.map(memory => `${memory.createdAt}：${memory.note}`).join('\n')}` : '';
        assertPreparation(rule);
        request = safeRequest({ ...context, models: state.context.models, connections: state.context.connections, input: pending.input + remembered, variables: rule.variables, attachmentIds: requestAttachments(pending, context.project, context.workflow), dispatchKey: pending.dispatchKey, acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
        const claimed = await mutate(next => { const job = next.jobs.find(job => job.id === pending.id); if (!contextSynced || !job || job.status !== 'queued' || job.cancelRequestedAt || reservations.has(job.projectId) || dispatchClaims.get(job.projectId) !== claim || archived(next, job.projectId) || reviewPending(next, job.projectId, job.id)) return false; jobContext(next, job); job.status = 'dispatching'; job.updatedAt = now(); return true; });
        if (!claimed) continue;
        if (closed || !contextSynced || reservations.has(pending.projectId) || state.jobs.find(job => job.id === pending.id)?.cancelRequestedAt || archived(state, pending.projectId)) continue;
        const run = await start(request);
        if (!run || !validId(run.id) || run.projectId !== pending.projectId || run.dispatchKey && run.dispatchKey !== pending.dispatchKey) throw Error('派工返回的运行编号或项目归属无效，请重新读取后台记录。');
        await mutate(next => { const job = next.jobs.find(job => job.id === pending.id); job.runId = run.id; job.nativeStatus = run.status; if (job.cancelRequestedAt) cancellationCard(next, job, '已关联运行记录，正在核对取消结果。'); else if (run.status === 'complete' || run.status === 'cancelled') terminalJob(next, job, run); else if (['waiting-review', 'failed', 'interrupted', 'paused'].includes(run.status)) addDecision(next, job, run.status === 'waiting-review' ? 'review' : 'failure', '检查这次执行结果', run.error || `后台状态：${run.status}`); else job.status = 'running'; job.updatedAt = now(); });
        if (state.jobs.find(job => job.id === pending.id)?.cancelRequestedAt) await confirmCancellation(pending.id);
      } catch (error) { await mutate(next => { const job = next.jobs.find(job => job.id === pending.id); if (job.cancelRequestedAt) return cancellationCard(next, job, `派工或取消尚未确认：${String(error.message).slice(0, 2000)}。不会重新派工，已保存的记录与费用保留。`); if (job.status === 'cancelled') return false; if (error.code === 'PROJECT_BUSY') { job.status = 'queued'; job.updatedAt = now(); return; } if (error.code === 'WORKFLOW_PREFLIGHT') job.configurationPending = true; else delete job.configurationPending; return addDecision(next, job, ['AUTOMATION_INPUTS', 'WORKFLOW_PREFLIGHT'].includes(error.code) ? 'failure' : 'uncertain', error.code === 'WORKFLOW_PREFLIGHT' ? '流程配置需要处理' : error.code === 'AUTOMATION_INPUTS' ? '参考资料需要处理' : '派工未能确认', error.message); }); }
      finally { if (dispatchClaims.get(pending.projectId) === claim) dispatchClaims.delete(pending.projectId); if (state.jobs.find(job => job.id === pending.id)?.cancellationPending) await confirmCancellation(pending.id); }
    }
  }
  function tick() { if (!pumping && !closed) { pumping = pump().catch(error => { if (!issue) setIssue(`自动化已停止派工：${error.message}`); }).finally(() => { pumping = undefined; }); } return pumping; }
  const api = {
    setProjectPurgeGuard(guard, ready) { purgeGuard = guard; purgeReady = ready; },
    async getProjectPurgeContext({ projectId, workspaceId }) {
      await ready; await purgeReady; await writes;
      const project = state.context.projects.find(item => item.id === projectId && item.workspaceId === workspaceId && item.trashedAt);
      if (issue || !validId(projectId) || !validId(workspaceId) || !project || purgeGuard(projectId)) throw Error('请选择当前工作区回收站内尚未永久移除的项目。');
      return structuredClone(project);
    },
    async sealProjectPurge({ projectId, workspaceId }) {
      await mutate(next => {
        const project = next.context.projects.find(item => item.id === projectId);
        if (project && project.workspaceId !== workspaceId) throw Error('项目永久移除归属不匹配。');
        next.context.projects = next.context.projects.filter(item => item.id !== projectId);
        for (const rule of next.rules.filter(item => item.projectId === projectId)) { rule.enabled = false; rule.updatedAt = now(); }
        for (const job of next.jobs.filter(item => item.projectId === projectId && item.status === 'queued')) { job.status = 'cancelled'; job.updatedAt = now(); resolveCards(next, job.id, 'reject'); }
      });
    },
    async snapshot(workspaceId) { await ready.catch(() => undefined); const local = key => state[key].filter(item => item.workspaceId === workspaceId && !archived(state, item.projectId)); return structuredClone({ revision: state.revision, rules: local('rules'), events: local('events').slice(-500).reverse(), jobs: local('jobs').slice(-500).reverse(), decisions: local('decisions').reverse(), memories: local('memories').reverse(), available: !issue, ...(issue ? { issue } : {}) }); },
    async isProjectBusy(projectId) {
      if (!validId(projectId)) throw Error('项目编号无效。'); if (reservations.has(projectId) || dispatchClaims.has(projectId)) return true;
      await ready.catch(() => undefined); await writes; if (issue) throw Error(issue); const runs = await runsFor(projectId);
      return reservations.has(projectId) || dispatchClaims.has(projectId) || runs.some(run => run.projectId === projectId && active(run)) || reviewPending(state, projectId) || state.jobs.some(job => job.projectId === projectId && (job.cancellationPending || job.status === 'dispatching' || job.status === 'running' && (!nativeRun(runs, job) || active(nativeRun(runs, job)))));
    },
    reserveProject: (projectId, options) => acquireProject(projectId, options?.allowReview === true),
    async backupEntries(scope) { await ready; await writes; if (issue) throw Error(issue); return exportAutomationBackup(state, scope); },
    async importEntries(input) {
      await ready; await writes; if (issue) throw Error(issue);
      const availableRuns = (await liveEngine.snapshot(undefined, { summaryOnly: true })).runs;
      const idMap = input.idMap instanceof Map ? Object.fromEntries(input.idMap) : input.idMap;
      return mutate(next => { const result = mergeAutomationBackup(next, { ...input, idMap, availableRuns, now: now() }); if (!result.changed) return false; Object.assign(next, result.state); return { imported: true }; });
    },
    async prepareProjectArchive({ projectId, workspaceId } = {}) {
      const release = await acquireProject(projectId, true);
      try { await mutate(next => {
        const project = next.context.projects.find(item => item.id === projectId && item.workspaceId === workspaceId); if (!project) throw Error('项目不属于当前工作区。');
        const owner = next.projectOwners.find(item => item.projectId === projectId); if (owner) delete owner.restoredAt;
        if (!next.projectArchives.some(item => item.projectId === projectId)) next.projectArchives.push({ projectId, workspaceId, preparedAt: now() });
        project.trashedAt ||= now();
        for (const rule of next.rules.filter(rule => rule.projectId === projectId)) { rule.enabled = false; rule.updatedAt = now(); }
        for (const job of next.jobs.filter(job => job.projectId === projectId && job.status === 'queued')) { job.status = 'cancelled'; job.updatedAt = now(); resolveCards(next, job.id, 'reject'); }
      }); } finally { await release(); }
    },
    async restoreProjectArchive({ projectId, workspaceId } = {}) {
      await purgeReady; if (purgeGuard(projectId)) throw Error('此项目已永久移除，不能从回收站恢复。');
      if (!validId(projectId) || !validId(workspaceId)) throw Error('项目恢复归属无效。');
      await mutate(next => {
        const project = next.context.projects.find(item => item.id === projectId), guard = next.projectArchives.find(item => item.projectId === projectId), owner = next.projectOwners.find(item => item.projectId === projectId);
        if ((project?.workspaceId || guard?.workspaceId || owner?.workspaceId) !== workspaceId) throw Error('项目不属于当前工作区，未恢复其他项目。');
        next.projectArchives = next.projectArchives.filter(item => item.projectId !== projectId);
        if (project) { delete project.trashedAt; project.updatedAt = now(); }
        next.projectOwners = [...next.projectOwners.filter(item => item.projectId !== projectId), { ...owner, projectId, workspaceId, restoredAt: now() }];
        for (const rule of next.rules.filter(rule => rule.projectId === projectId)) { rule.enabled = false; rule.updatedAt = now(); }
      }); tick();
    },
    async reload() { if (pumping) await pumping; await writes; await load(); tick(); },
    async syncContext(input) {
      contextSynced = false;
      if (!input || !['workspaces', 'projects', 'workflows', 'models', 'connections'].every(key => Array.isArray(input[key]))) throw Error('自动化上下文不完整。');
      const incoming = { workspaces: input.workspaces.map(({ id, name, removedAt }) => ({ id, name, removedAt })), projects: input.projects.map(({ id, workspaceId, kind, name, description, costCents, budgetCents, trashedAt, referenceFiles, updatedAt }) => ({ id, workspaceId, kind, name, description, costCents, budgetCents, trashedAt, referenceFiles, updatedAt })), workflows: structuredClone(input.workflows), connections: safeRequest({ project: {}, workflow: { steps: [] }, connections: input.connections, models: input.models }).connections, models: safeRequest({ project: {}, workflow: { steps: [] }, connections: input.connections, models: input.models }).models };
      await mutate(next => {
        const clean = { ...incoming, projects: scopedContext(next.context.projects, incoming.projects, input.workspaceId).filter(project => !purgeGuard(project.id) && !input.projects.find(item => item.id === project.id)?.purgedAt), workflows: scopedContext(next.context.workflows, incoming.workflows, input.workspaceId) };
        for (const owner of next.projectOwners) { const project = clean.projects.find(item => item.id === owner.projectId); if (project) { project.workspaceId = owner.workspaceId; if (owner.restoredAt) { delete project.trashedAt; if (!project.updatedAt || Date.parse(project.updatedAt) < Date.parse(owner.restoredAt)) project.updatedAt = owner.restoredAt; } } }
        let changed = JSON.stringify(next.context) !== JSON.stringify(clean);
        for (const project of clean.projects) {
          if (['rules','events','jobs','decisions','memories'].some(key => next[key].some(item => item.projectId === project.id && item.workspaceId !== project.workspaceId))) { migrateOwner(next, project.id, project.workspaceId); changed = true; }
          const guard = next.projectArchives.find(item => item.projectId === project.id);
          if (guard) {
            guard.workspaceId = project.workspaceId;
            if (project.trashedAt) { const updatedAt = project.updatedAt || project.trashedAt; if (!guard.confirmedAt || guard.archivedUpdatedAt !== updatedAt) changed = true; guard.confirmedAt ||= now(); guard.archivedUpdatedAt = updatedAt; }
            else if (guard.confirmedAt && Number.isFinite(Date.parse(project.updatedAt)) && Date.parse(project.updatedAt) > Date.parse(guard.archivedUpdatedAt || guard.confirmedAt)) { next.projectArchives = next.projectArchives.filter(item => item !== guard); changed = true; }
          }
        }
        next.context = clean;
        for (const rule of next.rules) if (archived(next, rule.projectId) || !clean.workflows.some(workflow => workflow.id === rule.workflowId && workflow.workspaceId === rule.workspaceId)) {
          if (rule.enabled) changed = true;
          rule.enabled = false;
          for (const job of next.jobs.filter(job => job.ruleId === rule.id && job.status === 'queued')) { job.status = 'cancelled'; job.updatedAt = now(); resolveCards(next, job.id, 'reject'); changed = true; }
        }
        return changed;
      }); contextSynced = true; tick();
    },
    async getPlanningContext({ workspaceId, projectId } = {}) {
      await ready; await writes;
      if (issue || !contextSynced) throw Error(issue || '请等待项目与模型配置同步后再规划。');
      if (!validId(workspaceId) || !validId(projectId) || !state.context.workspaces.some(workspace => workspace.id === workspaceId && !workspace.removedAt) || archived(state, projectId)) throw Error('请先选择当前工作区内可用的项目。');
      const project = state.context.projects.find(project => project.id === projectId && project.workspaceId === workspaceId && !project.trashedAt);
      if (!project || reservations.has(projectId)) throw Error('项目不属于当前工作区或正在整理。');
      return structuredClone({ project, workflows: state.context.workflows.filter(workflow => workflow.workspaceId === workspaceId), models: state.context.models, connections: state.context.connections });
    },
    async saveRule(draft) {
      if (!draft || !validId(draft.workspaceId) || !validId(draft.projectId) || !validId(draft.workflowId) || !String(draft.name || '').trim() || String(draft.name).length > 80 || !triggers.has(draft.trigger) || typeof draft.enabled !== 'boolean' || typeof draft.input !== 'string' || draft.input.length > 100000 || draft.trigger === 'schedule' && (!Number.isSafeInteger(draft.intervalMinutes) || draft.intervalMinutes < 1 || draft.intervalMinutes > 10080) || draft.trigger === 'run-completed' && !validId(draft.sourceWorkflowId)) throw Error('请完整填写规则名称、项目、流程和有效触发条件。');
      await ready; await writes;
      const previous = draft.id ? state.rules.find(rule => rule.id === draft.id && rule.workspaceId === draft.workspaceId) : undefined;
      if (previous) readinessEpochs.set(previous.id, (readinessEpochs.get(previous.id) || 0) + 1);
      const preparation = normalizePreparation(draft.preparation === undefined ? previous?.preparation : draft.preparation);
      draft = { ...draft, ...(preparation ? { preparation } : {}) };
      const checked = draft.enabled ? await checkReadiness(draft, draft.trigger === 'reference-imported') : undefined;
      let result; await mutate(next => {
        if (!next.context.workspaces.some(workspace => workspace.id === draft.workspaceId && !workspace.removedAt)) throw Error('工作区不可用。');
        contextFor(next, draft); if (archived(next, draft.projectId)) throw Error('项目回收状态尚未同步，请先恢复有效项目。'); const old = draft.id ? next.rules.find(rule => rule.id === draft.id && rule.workspaceId === draft.workspaceId) : undefined; if (draft.id && !old) throw Error('规则不属于当前工作区。');
        if (draft.creationKey !== undefined && !validId(draft.creationKey)) throw Error('规则创建编号无效。');
        if (old && draft.creationKey && draft.creationKey !== old.creationKey) throw Error('已有规则的创建编号不能更改。');
        const creationKey = old ? old.creationKey : draft.creationKey;
        const creationFingerprint = creationKey ? old?.creationFingerprint || ruleCreationFingerprint(draft) : undefined;
        if (draft.creationKey && !draft.id) { const existing = next.rules.find(rule => rule.creationKey === draft.creationKey); if (existing) { if ((existing.creationFingerprint || ruleCreationFingerprint(existing)) !== creationFingerprint) throw Error('同一规则创建编号的项目、流程或内容已变化，请使用原始方案重试。'); result = existing; return false; } if (draft.enabled) throw Error('AI规划创建的规则必须先保存为未启用。'); }
        const variables = draft.variables || {}; if (Object.values(variables).some(value => typeof value !== 'string' || value.length > 10000)) throw Error('规则变量需要为有效文字。');
        if (checked) verifyReadiness(next, draft, checked);
        result = { id: old?.id || randomUUID(), ...(preparation ? { preparation } : {}), ...(creationKey ? { creationKey, creationFingerprint } : {}), ...(old?.originWorkspaceId ? { originWorkspaceId: old.originWorkspaceId } : {}), workspaceId: draft.workspaceId, projectId: draft.projectId, workflowId: draft.workflowId, name: draft.name.trim(), enabled: draft.enabled, trigger: draft.trigger, intervalMinutes: draft.intervalMinutes, sourceWorkflowId: draft.sourceWorkflowId, input: draft.input, variables: structuredClone(variables), updatedAt: now(), lastTriggeredAt: now() };
        next.rules = old ? next.rules.map(rule => rule.id === old.id ? result : rule) : [...next.rules, result];
      }); tick(); return structuredClone(result);
    },
    async setEnabled({ id, enabled }) { if (typeof enabled !== 'boolean') throw Error('启用状态无效。'); await ready; await writes; const original = state.rules.find(rule => rule.id === id); if (!original) throw Error('规则不存在。'); readinessEpochs.set(id, (readinessEpochs.get(id) || 0) + 1); const checked = enabled ? await checkReadiness(original, original.trigger === 'reference-imported') : undefined; await mutate(next => { const rule = next.rules.find(rule => rule.id === id); if (!rule) throw Error('规则不存在。'); if (checked) verifyReadiness(next, rule, checked); rule.enabled = enabled; rule.updatedAt = now(); rule.lastTriggeredAt = now(); if (!enabled) for (const job of next.jobs.filter(job => job.ruleId === id && job.status === 'queued')) { job.status = 'cancelled'; job.updatedAt = now(); } }); tick(); },
    async trigger({ ruleId }) { await ready; await writes; const original = state.rules.find(rule => rule.id === ruleId); if (!original) throw Error('规则不存在。'); const checked = await checkReadiness(original, false); let result; await mutate(next => { const rule = next.rules.find(rule => rule.id === ruleId); if (!rule) throw Error('规则不存在。'); verifyReadiness(next, rule, checked); result = next.jobs.find(job => job.ruleId === rule.id && ['queued', 'dispatching', 'running', 'decision'].includes(job.status)) || enqueue(next, rule, { id: randomUUID(), workspaceId: rule.workspaceId, projectId: rule.projectId, trigger: 'manual', sourceId: rule.id, createdAt: now() }); }); tick(); return structuredClone(result); },
    async referenceImported({ projectId, workspaceId, files }) { if (!validId(projectId) || !validId(workspaceId) || !Array.isArray(files) || files.some(file => !validId(file.id))) throw Error('参考资料事件无效。'); await mutate(next => { let changed = false; for (const rule of next.rules.filter(rule => rule.enabled && rule.trigger === 'reference-imported' && rule.projectId === projectId && rule.workspaceId === workspaceId)) { const previous = next.jobs.length, workflow = contextFor(next, rule).workflow; enqueue(next, rule, { id: hash(`import:${projectId}:${files.map(file => file.id).sort().join(',')}`), workspaceId, projectId, trigger: 'reference-imported', sourceId: projectId, attachmentIds: files.map(file => file.id), ...(files.some(file => !acceptedKind(file, workflow)) ? { inputIssue: '新导入资料含当前流程不能读取的类型，请调整规则或资料后重新触发。' } : {}), createdAt: now() }); if (next.jobs.length !== previous) changed = true; } return changed; }); tick(); },
    async cancelJob(id) { await ready.catch(() => undefined); await writes; if (issue) throw Error(issue); const job = state.jobs.find(job => job.id === id); if (!job) throw Error('任务不存在。'); if (['complete', 'cancelled'].includes(job.status) && !job.cancellationPending) return; await mutate(next => { const current = next.jobs.find(job => job.id === id); current.cancelRequestedAt ||= now(); return cancellationCard(next, current, '已请求取消，正在核对后台记录；已发生费用保留。'); }); await confirmCancellation(id, true); },
    async resolve({ id, action, note = '', remember = false }) {
      if (!['approve', 'continue', 'reject', 'refresh'].includes(action) || typeof note !== 'string' || note.length > 3000) throw Error('请选择有效处理方式。');
      if (remember && /(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})/.test(note)) throw Error('记忆中不能填写 API Key；请只保存偏好或决定。');
      const decision = state.decisions.find(item => item.id === id && !item.resolvedAt); if (!decision) throw Error('待办已处理或不存在。');
      if (action === 'approve' && decision.kind !== 'review') throw Error('此待办需要先核对错误，不能直接标记验收通过。');
      const job = state.jobs.find(job => job.id === decision.jobId), rule = state.rules.find(rule => rule.id === job.ruleId);
      if (job.cancelRequestedAt && ['approve', 'continue'].includes(action)) throw Error('取消尚未确认或任务已停止，不能继续或重新派工；请先重新读取取消结果。');
      if (action === 'refresh') {
        if (job.cancelRequestedAt) { await confirmCancellation(job.id); return; }
        const run = nativeRun(await runsFor(job.projectId), job);
        await mutate(next => { const current = next.jobs.find(item => item.id === job.id), card = next.decisions.find(item => item.id === id); if (!run) { card.detail = '尚未找到已保存的运行记录，仅读取不会重新派工。确认后可选择“明确继续”，或拒绝此任务。'; return; } current.runId = run.id; current.nativeStatus = run.status; if (['complete', 'cancelled'].includes(run.status)) terminalJob(next, current, run); else if (run.status === 'running') { current.status = 'running'; delete current.error; resolveCards(next, job.id, 'refresh'); } else addDecision(next, current, run.status === 'waiting-review' ? 'review' : 'failure', run.status === 'waiting-review' ? '检查这次实际结果' : '这项任务需要处理', run.error || `当前状态：${run.status}。请检查结果后决定。`); }); return;
      }
      const outcome = action === 'reject' ? (await api.cancelJob(job.id), undefined) : await continueJob(job, action);
      await mutate(next => { const current = next.decisions.find(item => item.id === id), currentJob = next.jobs.find(item => item.id === job.id); if ((action !== 'reject' || !currentJob.cancellationPending) && outcome?.status !== 'decision') { current.resolvedAt = now(); current.action = action; } current.note = note; if (outcome) { if (outcome.run) { currentJob.runId = outcome.run.id; currentJob.nativeStatus = outcome.run.status; } currentJob.status = outcome.status; if (outcome.status !== 'decision') delete currentJob.error; else addDecision(next, currentJob, outcome.run?.status === 'waiting-review' ? 'review' : 'failure', '后台仍需要处理', outcome.run?.error || `后台状态：${outcome.run?.status}`); } if (remember && note.trim() && !next.memories.some(memory => memory.decisionId === id && memory.note === note.trim() && memory.action === action)) next.memories.push({ id: randomUUID(), workspaceId: currentJob.workspaceId, projectId: job.projectId, ruleId: rule?.id || job.ruleId, decisionId: id, action, note: note.trim(), createdAt: now() }); }); tick();
    },
    tick,
    start() { if (!timer && !closed) { timer = setInterval(tick, 2000); timer.unref?.(); tick(); } },
    async shutdown() { closed = true; clearInterval(timer); if (pumping) await pumping; await writes; },
  };
  return api;
}
module.exports = { createAutomationCenter };
