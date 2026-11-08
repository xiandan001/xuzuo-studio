const { randomUUID } = require('node:crypto');
const { createAnimationJournal } = require('./animation-journal.cjs');
const { createAnimationProduction } = require('./animation-production.cjs');
const { createAnimationComposition } = require('./animation-composition.cjs');
const core = require('./animation-document.runtime.cjs');
const aborted = () => Object.assign(Error('动画任务已取消，源稿与费用保留。'), { name: 'AbortError' });
function createAnimationService(options) {
  const { store, artifactStore, workspaceStorage, tool, onExport = async () => undefined, onChanged = () => undefined } = options;
  const journal = options.journal || createAnimationJournal(options), production = createAnimationProduction({ ...options, core, journal });
  const composition = createAnimationComposition({ ...options, core }), jobs = new Map(), workflowJobs = new Map(), snapshotCache = new Map(), writeFailures = new Map(); let closing = false, tail = Promise.resolve(), status;
  const changed = projectId => { try { onChanged({ projectId }); } catch { /* Saved files survive a renderer close. */ } };
  async function jobUpdate(projectId, id, patch) { await journal.mutate(projectId, value => { const job = value.jobs.find(row => row.id === id); if (!job) throw Error('动画任务记录已改变。'); Object.assign(job, patch, { updatedAt: new Date().toISOString() }); return value; }); changed(projectId); }
  function selected(document, ids) { if (ids === undefined) return document.entries; if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !document.entries.some(entry => entry.id === id))) throw Error('请选择本项目的有效角色条目。'); return document.entries.filter(entry => ids.includes(entry.id)); }
  const requested = (document, input) => input.sampleOnly ? selected(document, input.entryIds).slice(0, 1) : selected(document, input.entryIds);
  async function read({ projectId }) {
    const document = await store.read({ projectId }), cached = snapshotCache.get(projectId), sameRevision = cached?.revision === document.revision;
    const history = sameRevision ? cached.history : await store.history({ projectId }), state = await journal.read(projectId);
    const job = state.jobs.at(-1); const publicJob = job && { ...job, status: job.status === 'running' && !jobs.has(projectId) ? 'interrupted' : job.status }; if (publicJob) { delete publicJob.operations; delete publicJob.request; delete publicJob.kind; delete publicJob.requiresExplicitRestart; }
    if (publicJob && writeFailures.has(projectId)) { publicJob.status = 'failed'; publicJob.error = '动画保存尚未完成：' + writeFailures.get(projectId).message; }
    const all = sameRevision && Date.now() - cached.at < 1000 ? cached.artifacts : await artifactStore.listProject(projectId), relevant = new Set([...document.referenceArtifactIds, ...document.entries.flatMap(entry => [entry.outputArtifactId, entry.coverArtifactId, ...entry.frames.map(frame => frame.atlasArtifactId)])]);
    snapshotCache.delete(projectId); snapshotCache.set(projectId, { revision: document.revision, history, artifacts: all, at: sameRevision && Date.now() - cached.at < 1000 ? cached.at : Date.now() }); if (snapshotCache.size > 6) snapshotCache.delete(snapshotCache.keys().next().value);
    status ||= tool.status().catch(error => ({ available: false, reason: error.message }));
    const helper = await status; if (!helper.available) status = undefined;
    return { document, history, ...(publicJob ? { job: publicJob } : {}), artifacts: all.filter(file => relevant.has(file.id)), helper };
  }
  async function publish(document, entries, signal, parentRunId) {
    if (signal?.aborted) throw aborted();
    if (entries.length > 1) { let current = document; for (const entry of entries) current = await publish(current, selected(current, [entry.id]), signal, parentRunId); return current; }
    const current = entries[0];
    if (!parentRunId && current?.outputArtifactId && current.coverArtifactId && current.renderedHash === core.animationRenderHash(document, [current.id])) {
      try { for (const id of new Set([current.outputArtifactId, current.coverArtifactId])) { const file = await artifactStore.read(id); if (file.projectId !== document.projectId || file.trashedAt || file.unavailable) throw Error('unavailable'); } return document; } catch { /* A missing cached result is rebuilt locally from its preserved sources. */ }
    }
    const result = await composition.render(document, entries, { signal, runId: parentRunId });
    if (signal?.aborted) throw aborted();
    const saved = await store.mutate(document.projectId, current => {
      if (signal?.aborted) throw aborted();
      for (const output of result.outputs) { const entry = current.entries.find(row => row.id === output.entryId); if (!entry || core.animationRenderHash(current, [entry.id]) !== output.renderedHash) throw Error('合成期间内容已改变，新文件已保留，请按当前设置重新合成。'); const { width, height, frames, loopMs, transparent, warnings } = output.report; Object.assign(entry, output, { status: 'ready', inspection: { width, height, frames, loopMs, transparent, warnings } }); delete entry.entryId; delete entry.report; delete entry.error; }
      return current;
    }, { label: '保存本地动画合成' });
    if (!parentRunId) for (const group of result.groups) await onExport({ projectId: document.projectId, document: saved, sourceRevision: saved.revision, artifacts: group.artifacts, animationExport: { version: 1, projectId: document.projectId, entryIds: group.entryIds, mode: group.mode, renderHash: group.renderHash, sources: group.sources } });
    changed(document.projectId); return saved;
  }
  async function generateGroups(document, targets, job, input) {
    const style = core.animationStyle(document.style), singlePose = document.mode === 'atlas' || style.route === 'light';
    const maximum = singlePose ? style.appearance === 'pixel' ? 16 : 4 : 1;
    for (let offset = 0; offset < targets.length; offset += maximum) {
      if (job.controller.signal.aborted || closing) throw aborted();
      const group = targets.slice(offset, offset + maximum), columns = singlePose ? Math.ceil(Math.sqrt(group.length)) : style.grid[0], rows = singlePose ? Math.ceil(group.length / columns) : style.grid[1];
      const request = core.checkedAnimationDocument({ ...document, columns, rows });
      const referenceIds = [...new Set([...(input.sampleAnchorId ? [input.sampleAnchorId] : []), ...document.referenceArtifactIds])];
      const generated = await production.generate({ document: request, entries: group, jobId: job.id, signal: job.controller.signal, retry: input.retry, referenceIds, resumeJobId: input.resumeJobId });
      document = await store.mutate(document.projectId, current => {
        for (const [index, original] of group.entries()) {
          const entry = current.entries.find(row => row.id === original.id); if (!entry || core.animationArtHash(current, [entry.id]) !== core.animationArtHash(document, [entry.id])) throw Error('生成期间角色需求已改变，模型结果保留在项目文件中，请重新选择采用。');
          const count = singlePose ? 1 : style.framesPerEntry, duration = Math.max(10, Math.floor(document.loopMs / count / 10) * 10);
          entry.frames = Array.from({ length: count }, (_, frameIndex) => { const cellIndex = singlePose ? index : frameIndex; return { id: randomUUID(), atlasArtifactId: generated.artifact.id, cell: [cellIndex % columns, Math.floor(cellIndex / columns)], grid: [columns, rows], durationMs: frameIndex === count - 1 ? document.loopMs - duration * (count - 1) : duration }; });
          entry.sourceHash = core.animationArtHash(current, [entry.id]); entry.status = 'stale'; delete entry.error;
          if (current.acceptedSampleId === entry.id) delete current.acceptedSampleId;
        }
        return current;
      }, { label: '保存生成角色源稿' });
      await jobUpdate(document.projectId, job.id, { stage: 'composing' });
      document = await publish(document, selected(document, group.map(row => row.id)), job.controller.signal);
      await jobUpdate(document.projectId, job.id, { stage: 'generating', completedEntryIds: [...(await journal.read(document.projectId)).jobs.find(row => row.id === job.id).completedEntryIds, ...group.map(row => row.id)] });
    }
  }
  async function execute(projectId, job, input, kind) {
    if (job.controller.signal.aborted || closing) throw aborted();
    let document = await store.read({ projectId }), targets = selected(document, input.entryIds);
    if (kind === 'generate') {
      if (input.sampleOnly) targets = targets.slice(0, 1);
      targets = targets.filter(entry => input.retry || !entry.frames.length || entry.sourceHash !== core.animationArtHash(document, [entry.id]));
      if (document.mode === 'gif' && targets.length > 1 && !document.entries.some(entry => entry.id === document.acceptedSampleId && entry.frames.length)) throw Error('请先生成并认可一个样片，再按同一角色批量制作；现有图集仍可免费本地合成。');
      await generateGroups(document, targets, job, input);
      document = await store.read({ projectId });
      const pending = requested(document, input).filter(entry => entry.frames.length && entry.renderedHash !== core.animationRenderHash(document, [entry.id]));
      if (pending.length) await publish(document, pending, job.controller.signal);
    } else if (kind === 'refine') {
      const entry = document.entries.find(row => row.id === input.entryId), frame = input.frameId ? entry?.frames.find(row => row.id === input.frameId) : undefined;
      if (!entry || !entry.frames.length || input.frameId && !frame || typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 4000) throw Error('请选择要精修的条目或关键帧，并填写修改要求。');
      const route = core.animationStyle(document.style).route;
      if (document.mode === 'gif' && (route === 'light' && entry.frames.length !== 1 || ['lenticular', 'poster'].includes(route) && entry.frames.length !== 2)) throw Error('当前风格的源状态数量不匹配，请先调整源画面或切换连续动作风格，再精修；未调用模型。');
      if (!frame && (entry.frames.length > 16 || new Set(entry.frames.map(row => row.atlasArtifactId)).size > 12)) throw Error('当前条目有较多独立源画面，请选择具体关键帧精修；其它帧与已发生费用会保留。');
      let references = [...document.referenceArtifactIds];
      if (frame) { const reference = await composition.frameReference(document, entry, frame, { signal: job.controller.signal }); references = [reference.id, ...references.filter(id => id !== reference.id)]; }
      else references = [...new Set([...entry.frames.map(row => row.atlasArtifactId), ...references])];
      if (references.length > 16) throw Error('这项精修需要的参考图超过16张，请选择具体帧或减少额外参考；未调用模型。');
      const style = core.animationStyle(document.style), count = frame ? 1 : entry.frames.length, columns = frame ? 1 : count === style.framesPerEntry && document.mode === 'gif' && style.route !== 'light' ? style.grid[0] : Math.ceil(Math.sqrt(count)), grid = [columns, Math.ceil(count / columns)];
      const generated = await production.generate({ document: { ...document, columns: grid[0], rows: grid[1] }, entries: [entry], jobId: job.id, signal: job.controller.signal, retry: input.retry, refineInstruction: input.instruction, frameId: input.frameId, referenceIds: references, resumeJobId: input.resumeJobId });
      document = await store.mutate(projectId, current => { const target = current.entries.find(row => row.id === entry.id); if (!target || core.animationArtHash(current, [entry.id]) !== core.animationArtHash(document, [entry.id])) throw Error('精修期间角色需求已改变，新结果保留，未覆盖当前修改。'); target.frames = require('./animation-frame-merge.cjs').mergeGeneratedFrames(target.frames, entry.frames, generated.artifact.id, grid, frame?.id); target.status = 'stale'; if (current.acceptedSampleId === entry.id) delete current.acceptedSampleId; return current; }, { label: frame ? '精修选中关键帧' : '精修选中角色' });
      await jobUpdate(projectId, job.id, { stage: 'composing' }); await publish(document, selected(document, [entry.id]), job.controller.signal);
    } else await publish(document, targets, job.controller.signal);
  }
  function startJob(input, kind, wait = false) {
    if (closing || !core.animationId(input?.projectId)) throw Error('应用或项目正在退出，未开始新动画任务。');
    if (workflowJobs.has(input.projectId)) throw Error('当前项目的动画流程正在合成，可先取消该任务再继续编辑。');
    const existing = jobs.get(input.projectId); if (existing) return Promise.resolve(existing.start).then(() => wait ? existing.running : undefined).then(() => read(input));
    const id = randomUUID(), job = { id, controller: new AbortController() };
    jobs.set(input.projectId, job);
    const setup = (async () => {
      await options.assertAdmission?.(input.projectId);
      const location = (await workspaceStorage.list()).projects.find(row => row.projectId === input.projectId); if (!location) throw Error('动画项目未登记。'); job.workspaceId = location.workspaceId;
      const helper = await tool.status(); if (!helper.available) throw Error(helper.reason || '动画合成工具尚不可用，未开始收费生成。');
      let document = await store.read(input); selected(document, input.entryIds);
      const sample = document.entries.find(entry => entry.id === document.acceptedSampleId); if (kind === 'generate' && !input.sampleAnchorId && sample?.frames[0]) input = { ...input, sampleAnchorId: sample.frames[0].atlasArtifactId };
      if (kind === 'generate' && document.mode === 'gif' && core.animationStyle(document.style).route !== 'light' && document.loopMs < core.animationStyle(document.style).framesPerEntry * 10) throw Error('连续动作的每个关键姿态至少需要10毫秒，请先增加循环时长。');
      if (kind === 'generate') document = await store.mutate(input.projectId, current => { for (const entry of requested(current, input)) if (!entry.description.trim()) entry.description = `用清楚、与其它条目不同的表情和姿态表达“${entry.caption || '角色反应'}”，主体完整。`; return current; }, { label: '准备角色动作需求' });
      if (closing || job.controller.signal.aborted) throw aborted();
      const timestamp = new Date().toISOString(), entryIds = kind === 'refine' ? [input.entryId] : requested(document, input).map(row => row.id);
      if (kind === 'refine' && !document.entries.some(row => row.id === input.entryId)) throw Error('请选择本项目需要精修的条目。');
      await journal.mutate(input.projectId, value => {
        for (const previous of value.jobs) if (previous.status === 'running') previous.status = 'interrupted';
        if (value.jobs.length >= 30) {
          const pending = new Map();
          for (const previous of value.jobs) for (const operation of previous.operations) if (['submitting', 'running', 'unknown'].includes(operation.status) && !pending.has(operation.dispatchKey)) pending.set(operation.dispatchKey, previous);
          if (pending.size >= 30) throw Error('有较多动画派发结果待核对，请先恢复已有任务。');
          // Resume copies share one dispatch; preserve its first owner rather than every failed copy.
          const protectedJobs = new Set(pending.values()), origin = input.resumeJobId && value.jobs.find(row => row.id === input.resumeJobId);
          if (origin) protectedJobs.add(origin);
          if (protectedJobs.size >= 30) throw Error('有较多动画派发结果待核对，请先恢复已有任务。');
          const open = value.jobs.filter(row => protectedJobs.has(row)), keep = 29 - open.length;
          value.jobs = [...open, ...(keep ? value.jobs.filter(row => !protectedJobs.has(row)).slice(-keep) : [])];
        }
        const request = { projectId: input.projectId, ...(input.entryIds ? { entryIds: input.entryIds } : {}), ...(input.sampleOnly ? { sampleOnly: true } : {}), ...(input.resumeJobId ? { resumeJobId: input.resumeJobId } : {}), ...(input.sampleAnchorId ? { sampleAnchorId: input.sampleAnchorId } : {}), ...(kind === 'refine' ? { entryId: input.entryId, ...(input.frameId ? { frameId: input.frameId } : {}), instruction: input.instruction } : {}) };
        value.jobs.push({ id, projectId: input.projectId, kind, request, status: 'running', stage: kind === 'compose' ? 'composing' : 'generating', entryIds, completedEntryIds: [], runIds: [], operations: [], createdAt: timestamp, updatedAt: timestamp }); return value;
      });
      const task = tail.then(() => execute(input.projectId, job, input, kind)).then(() => jobUpdate(input.projectId, id, { status: 'complete', stage: 'complete', completedEntryIds: entryIds }), error => jobUpdate(input.projectId, id, { status: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.message })).finally(() => { if (jobs.get(input.projectId) === job) jobs.delete(input.projectId); changed(input.projectId); });
      job.running = task; tail = task.then(() => { writeFailures.delete(input.projectId); }, error => { writeFailures.set(input.projectId, error); changed(input.projectId); }); changed(input.projectId);
      if (wait) await task; return read(input);
    })().catch(error => { if (!job.running && jobs.get(input.projectId) === job) jobs.delete(input.projectId); throw error; });
    job.start = setup; return setup;
  }
  async function exportFiles(input) {
    if (closing || jobs.has(input.projectId) || workflowJobs.has(input.projectId)) throw Error('请等待当前动画任务结束后再导出。');
    if (!['atlas', 'frames', 'gif', 'zip', 'project'].includes(input.format)) throw Error('请选择图集、拆分PNG、GIF、ZIP或动画工程。');
    const document = await store.read(input), entries = selected(document, input.entryIds);
    if (input.format === 'project') return { artifact: await require('./animation-project.cjs').exportAnimationProject(document, entries, artifactStore) };
    if (input.format === 'frames') return { artifact: await composition.exportFrames(document, entries) };
    const ids = input.format === 'atlas' ? [...new Set(entries.flatMap(entry => entry.frames.map(frame => frame.atlasArtifactId)))] : entries.map(entry => { if (!entry.outputArtifactId || entry.renderedHash !== core.animationRenderHash(document, [entry.id])) throw Error('当前设置尚未合成，请先点击本地重新合成。'); return entry.outputArtifactId; });
    if (!ids.length) throw Error('当前没有可导出的实际图集或成品。');
    if (input.format === 'gif' && document.mode !== 'gif') throw Error('当前是静态图集，请切换 GIF 用途并合成后导出。');
    const files = []; for (const id of ids) { const file = await artifactStore.read(id); if (file.projectId !== input.projectId || file.trashedAt || file.unavailable) throw Error('有导出文件不可用，请先恢复或重新合成。'); files.push(file); }
    if (files.length === 1 && input.format !== 'zip') return { artifact: files[0] };
    const Zip = require('jszip'), zip = new Zip(); let total = 0;
    for (const [index, file] of files.entries()) { if ((total += file.buffer.length) > 100 * 1024 * 1024) throw Error('当前成品超过100MB，请选部分条目分批导出。'); zip.file(`${String(index + 1).padStart(3, '0')}-${file.name}`, file.buffer); }
    zip.file('使用说明.txt', '此包包含选中的角色图集或动画成品。请按素材、角色和字体的实际授权使用。技术检查不能替代内容与视觉验收。\n');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true }); return { artifact: await artifactStore.write({ name: `${document.title}-${input.format === 'atlas' ? '角色图集' : 'GIF成品'}.zip`, mimeType: 'application/zip', buffer, projectId: input.projectId }) };
  }
  const api = {
    read,
    executeWorkflowStep(input) {
      const { projectId } = input;
      if (closing || jobs.has(projectId) || workflowJobs.has(projectId)) throw Error('当前动画工程仍有制作任务，请结束后再执行此流程。');
      const job = { runId: input.runId, controller: new AbortController() }, abort = () => job.controller.abort();
      workflowJobs.set(projectId, job); input.signal?.addEventListener('abort', abort, { once: true }); if (input.signal?.aborted) abort();
      job.task = workflowBody({ ...input, signal: job.controller.signal }, job).finally(() => { input.signal?.removeEventListener('abort', abort); if (workflowJobs.get(projectId) === job) workflowJobs.delete(projectId); });
      return job.task;
    },
    async save(input) {
      const before = await store.read(input), document = core.checkedAnimationDocument(input.document, input.projectId);
      if (before.mode !== document.mode && core.animationArtHash({ ...document, mode: before.mode }) === core.animationArtHash(before)) for (const entry of document.entries) { const original = before.entries.find(row => row.id === entry.id), style = core.animationStyle(document.style); if (original?.sourceHash === core.animationArtHash(before, [entry.id]) && (document.mode === 'atlas' || style.route === 'light' || entry.frames.length >= style.framesPerEntry)) entry.sourceHash = core.animationArtHash(document, [entry.id]); }
      await store.save({ ...input, document });
      const accepted = document.entries.find(entry => entry.id === document.acceptedSampleId);
      if (!closing && accepted?.outputArtifactId && before.acceptedSampleId !== accepted.id && accepted.renderedHash === core.animationRenderHash(document, [accepted.id])) {
        const runs = (await options.liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: [input.projectId] })).runs;
        for (const run of runs.filter(row => row.status === 'waiting-review' && row.snapshot.steps.some(step => step.kind === 'animation-compose'))) { const detail = await options.liveEngine.runDetail(run.id); if (detail?.projectId === input.projectId && detail.snapshot.steps[detail.stepIndex]?.kind === 'manual-review' && !detail.snapshot.steps.slice(detail.stepIndex + 1).some(step => step.enabled) && detail.attempts.some(attempt => attempt.artifacts?.some(file => file.id === accepted.outputArtifactId))) await options.liveEngine.control({ id: detail.id, action: 'continue' }); }
      }
      return read(input);
    },
    async restore(input) { if (closing || jobs.has(input.projectId) || workflowJobs.has(input.projectId)) throw Error('当前有动画任务，请结束后再恢复版本。'); await store.restore(input); return read(input); },
    generate: input => startJob(input, 'generate'), refine: input => startJob(input, 'refine'), compose: input => startJob(input, 'compose', true), export: exportFiles,
    async importProject(input) { if (closing || jobs.has(input.projectId) || workflowJobs.has(input.projectId)) throw Error('请先结束当前动画任务再导入工程。'); await require('./animation-project.cjs').importAnimationProject(input, { artifactStore, store }); changed(input.projectId); return read(input); },
    status: () => tool.status(),
    async control(input) {
      if (input.action === 'cancel') { const job = jobs.get(input.projectId), workflow = workflowJobs.get(input.projectId); job?.controller.abort(); workflow?.controller.abort(); if (workflow) await options.liveEngine.control({ id: workflow.runId, action: 'cancel' }).catch(() => undefined); await Promise.allSettled([job?.start, job?.running, workflow?.task].filter(Boolean)); return read(input); }
      if (!['continue', 'retry'].includes(input.action)) throw Error('请选择有效动画任务操作。');
      const previous = (await journal.read(input.projectId)).jobs.at(-1); if (!previous) throw Error('当前没有可继续的动画任务。'); if (previous.status === 'complete') return read(input);
      const local = ['composing', 'checking'].includes(previous.stage), kind = local ? 'compose' : previous.kind || 'generate';
      if (previous.requiresExplicitRestart && !local) throw Error('这份任务来自备份恢复，不会重派发旧请求；可用已有源帧本地合成，或明确创建新的生成任务。');
      return startJob({ ...previous.request, projectId: input.projectId, ...(local ? { entryIds: previous.entryIds } : {}), retry: input.action === 'retry', resumeJobId: previous.request?.resumeJobId || previous.id }, kind, local);
    },
    isProjectBusy: id => jobs.has(id) || workflowJobs.has(id),
    isWorkspaceBusy: workspaceId => [...jobs.values(), ...workflowJobs.values()].some(job => !job.workspaceId || job.workspaceId === workspaceId),
    async drain() { const active = [...jobs.values()], workflows = [...workflowJobs.values()]; await Promise.allSettled(active.map(job => job.start).filter(Boolean)); await Promise.allSettled([...active.map(job => job.running), ...workflows.map(job => job.task)].filter(Boolean)); await Promise.all([store.drain(), journal.drain(), tool.drain()]); if (writeFailures.size) throw Error('有动画文件或任务记录未能保存，请恢复可写位置后继续；已有源稿与费用仍保留。'); },
    async prepareClose() { closing = true; try { for (const job of [...jobs.values(), ...workflowJobs.values()]) job.controller.abort(); const controls = [...workflowJobs.values()].map(job => options.liveEngine.control({ id: job.runId, action: 'cancel' }).catch(() => undefined)); await tool.prepareClose(); await api.drain(); await Promise.allSettled(controls); } finally { closing = false; } },
    async shutdown() { await api.prepareClose(); closing = true; await tool.shutdown(); },
  };
  async function workflowBody({ projectId, runId, step, assets, signal, input }, job) {
      await options.assertAdmission?.(projectId); if (closing || signal?.aborted) throw aborted();
      const location = (await workspaceStorage.list()).projects.find(row => row.projectId === projectId); if (!location) throw Error('动画流程项目未登记。'); job.workspaceId = location.workspaceId;
      const settings = core.checkedAnimationWorkflowSettings(step.animation), style = core.animationStyle(settings.style);
      if (!Array.isArray(assets) || assets.length !== 1) throw Error('本地动画步骤需要一张明确的PNG角色图集。');
      const file = await artifactStore.read(assets[0].id); if (file.projectId !== projectId || file.trashedAt || file.unavailable || file.mimeType !== 'image/png') throw Error('动画流程的PNG来源不属于当前项目或不可读。');
      if (signal?.aborted) throw aborted();
      const current = await store.read({ projectId }), parent = await options.liveEngine.runDetail(runId), sourceStep = parent?.snapshot.steps.find(row => row.id === step.imageSourceStepId);
      if (closing || signal?.aborted) throw aborted();
      if (!parent || parent.projectId !== projectId || parent.workspaceId !== location.workspaceId || parent.status !== 'running' || parent.snapshot.steps[parent.stepIndex]?.id !== step.id || parent.snapshot.steps[parent.stepIndex]?.kind !== 'animation-compose') throw Error('本地动画执行与当前流程归属或步骤不匹配。');
      const simple = settings.mode === 'atlas' || style.route === 'light', definitions = settings.entries || [{ caption: '你好', description: '', motion: 'sway' }];
      const document = core.checkedAnimationDocument({ ...core.newAnimationDocument(projectId, settings.mode), ...settings, projectId, revision: current.revision, title: current.title, prompt: (parent?.input || input || '').slice(0, 20000), modelConfigId: sourceStep?.modelConfigId || current.modelConfigId, credentialId: sourceStep?.credentialId || current.credentialId, referenceArtifactIds: [file.id], entries: definitions.map((definition, index) => { const count = simple ? 1 : style.framesPerEntry, duration = Math.max(10, Math.floor(settings.loopMs / count / 10) * 10); return { id: `entry-${index + 1}`, caption: definition.caption, description: definition.description || '', motion: definition.motion || 'sway', status: 'stale', frames: Array.from({ length: count }, (_, frameIndex) => { const cell = simple ? index : frameIndex; return { id: randomUUID(), atlasArtifactId: file.id, cell: [cell % settings.columns, Math.floor(cell / settings.columns)], grid: [settings.columns, settings.rows], durationMs: frameIndex === count - 1 ? settings.loopMs - duration * (count - 1) : duration }; }) }; }) });
      for (const entry of document.entries) entry.sourceHash = core.animationArtHash(document, [entry.id]);
      if (closing || signal?.aborted) throw aborted(); const saved = await store.save({ projectId, expectedRevision: current.revision, document, label: '采用自动化角色图集' });
      if (signal?.aborted) throw aborted(); await publish(saved, saved.entries, signal, runId);
      const output = await store.read({ projectId }), ids = output.entries.flatMap(entry => [entry.outputArtifactId, entry.coverArtifactId]).filter(Boolean), artifacts = await artifactStore.list([...new Set(ids)]);
      return { artifacts, summary: `已在本地保存${output.entries.length}项${output.mode === 'gif' ? '真实GIF动画' : '角色PNG'}，未调用模型；请检查实际播放与角色一致性。` };
  }
  return api;
}
module.exports = { createAnimationService };
