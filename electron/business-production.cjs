const { randomUUID, createHash } = require('node:crypto');
const { startChecked, lookupStart } = require('./live-start.cjs');
const { nativeBusinessProjects, BUSINESS_OFFICE_MIME } = require('./business-production-projects.cjs');
const planner = require('./business-production.runtime.cjs');
const { validateBusinessFormalArtifact } = require('./business-formal.cjs');
const { unclaimedBusinessRuns } = require('./business-production-lineage.cjs');
const { createBusinessRevisionAdopter } = require('./business-revision-adoption.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const unique = items => [...new Set(items)];
const terminal = status => ['complete', 'failed', 'cancelled', 'interrupted', 'paused'].includes(status);

function createBusinessProduction(options) {
  const { businessStore, workspaceStorage, artifactStore, liveEngine, commerceImages } = options;
  const projects = nativeBusinessProjects(options), jobs = new Map(), starting = new Map(), preparing = new Map(), preparingScopes = new Map(), recovered = new Set();
  let closing = false, quiescing = false, queue = Promise.resolve();
  const read = workspaceId => businessStore.snapshot(workspaceId);
  const orderFrom = (state, orderId) => { const order = state.orders.find(item => item.id === orderId); if (!order) throw Error('制作单不存在或已移除。'); return order; };
  const keyFor = input => { if (!validId(input?.workspaceId) || !validId(input?.orderId)) throw Error('请使用当前工作区的有效制作单。'); return `${input.workspaceId}/${input.orderId}`; };
  const writable = () => { if (closing || quiescing) throw Error('应用正在保存并退出，未开始新制作。'); };
  async function update(input, transform) {
    return businessStore.mutate(input.workspaceId, state => { const order = orderFrom(state, input.orderId); transform(order, state); order.updatedAt = stamp(); return state; });
  }
  async function recover(workspaceId) {
    if (recovered.has(workspaceId)) return; recovered.add(workspaceId);
    try { await businessStore.mutate(workspaceId, state => { for (const order of state.orders.filter(item => item.status === 'running')) { order.status = 'paused'; order.error = '上次制作已中断，请查询已有任务再明确继续；没有自动重发模型请求。'; for (const task of order.tasks.filter(item => item.status === 'running')) { task.status = 'failed'; task.error = order.error; } } return state; }); }
    catch (error) { recovered.delete(workspaceId); throw error; }
  }
  async function validFiles(ids, workspaceId, expectedProject, expectedCount) {
    if (!Array.isArray(ids) || ids.length !== expectedCount) return false;
    const allowed = new Set((await workspaceStorage.list()).projects.filter(item => item.workspaceId === workspaceId).map(item => item.projectId));
    try { for (const id of ids) { const file = await artifactStore.read(id); if (!allowed.has(file.projectId) || expectedProject && file.projectId !== expectedProject || file.trashedAt || file.unavailable) return false; } return true; } catch { return false; }
  }
  function expectedCount(order, task) { return task.operation === 'background' ? order.imageCount - 1 : task.operation === 'compose' ? order.imageCount * order.sizes.length : task.operation === 'document' && task.kind === 'image' ? order.sizes.length : 1; }
  async function inputHash(order, state, task, context, planned) {
    const dependencies = [];
    if (task.operation === 'cutout' || task.operation === 'document') {
      const ids = task.productId ? state.products.find(product => product.id === task.productId)?.referenceArtifactIds || [] : projects.documentReferenceIds(order, state);
      for (const file of await projects.referenceFiles(state.workspaceId, unique(ids).slice(0, task.operation === 'document' ? 20 : 16), task.operation === 'cutout')) dependencies.push(file.sha256);
    }
    if (task.operation === 'compose') for (const producer of planned.filter(item => item.productId === task.productId && ['cutout', 'background'].includes(item.operation))) {
      if (producer.status === 'complete') for (const id of producer.artifactIds) dependencies.push(sha((await artifactStore.read(id)).buffer));
      else dependencies.push(`pending:${producer.id}:${producer.inputHash}`);
    }
    return sha(JSON.stringify({ sourceProjectId: order.sourceProjectId, dependency: planner.businessTaskDependencySource(order, state, task), dependencies }));
  }
  async function reusable(order, state, proposed, context, planned, candidates = order.tasks) {
    proposed.inputHash = await inputHash(order, state, proposed, context, planned);
    for (const previous of candidates.filter(item => item.operation === proposed.operation && item.kind === proposed.kind && (item.inputHash === proposed.inputHash && ['complete', 'stale'].includes(item.status) || !item.inputHash && item.status === 'complete' && item.factsRevision === order.factsRevision && item.productId === proposed.productId))) {
      if (await validFiles(previous.artifactIds, state.workspaceId, proposed.operation === 'document' ? previous.projectId : order.sourceProjectId, expectedCount(order, proposed))) return { ...proposed, id: previous.id, projectId: previous.projectId, ...(previous.runId ? { runId: previous.runId } : {}), ...(previous.referenceArtifactIds ? { referenceArtifactIds: previous.referenceArtifactIds } : {}), status: 'complete', artifactIds: [...previous.artifactIds], ...(previous.dispatchKey ? { dispatchKey: previous.dispatchKey } : {}), ...(previous.submittedAt ? { submittedAt: previous.submittedAt } : {}) };
    }
    return proposed;
  }
  async function allProjects(state, order) {
    const result = []; for (const task of order.tasks.filter(item => item.operation === 'document' && item.projectId)) result.push(await projects.projectMetadata(state.workspaceId, order, task)); return result;
  }
  async function prepare(input) {
    writable(); const key = keyFor(input); await recover(input.workspaceId);
    if (jobs.has(key)) throw Error('制作仍在运行，请暂停并等待当前项结束后再更新资料。');
    if (preparing.has(key)) return preparing.get(key);
    const task = (async () => {
      const before = await read(input.workspaceId), order = orderFrom(before, input.orderId), issue = planner.businessProductionIssue(order, before);
      if (issue) throw Error(issue);
      const context = await projects.context(input.workspaceId, order), preparedHash = sha(planner.businessPreparationSource(order, before));
      const brand = before.brands.find(item => item.id === order.brandId); if (brand?.logoArtifactId) await projects.sourceFiles(input.workspaceId, [brand.logoArtifactId]);
      preparingScopes.set(key, new Set([order.sourceProjectId, ...order.projectIds]));
      if (order.recipe !== 'documents' && context.project.kind !== 'image') throw Error('商家图片或数字商品请使用图片项目保存。');
      if (order.preparedHash === preparedHash && order.tasks.length && order.tasks.every(item => item.status !== 'stale')) return { state: before, projects: await allProjects(before, order) };
      const planned = [], created = [], approvedBackgrounds = order.recipe === 'merchant' ? await projects.approvedBackgrounds(before, order) : [];
      for (const proposed of planner.businessPlanTasks(order, before)) {
        writable(); let next = await reusable(order, before, proposed, context, planned);
        if (next.status !== 'complete') {
          if (next.operation === 'background') {
            next.referenceArtifactIds = [...approvedBackgrounds];
            if (approvedBackgrounds.length === order.imageCount - 1) { next.status = 'complete'; next.artifactIds = [...approvedBackgrounds]; next.label += ' · 沿用品牌已确认背景'; }
            else if (before.brands.find(brand => brand.id === order.brandId)?.approvedSampleIds.length && !approvedBackgrounds.length && order.facts.newScene !== 'true') next.label += ' · 样稿无独立背景，按场景说明制作';
          }
          if (next.operation === 'document') {
            const previous = next.kind === 'image' ? order.tasks.find(task => task.kind === 'image' && task.operation === 'document' && task.runId) : undefined;
            let background;
            if (previous) { try { const run = await nativeRun({ ...previous, workspaceId: input.workspaceId }, previous.projectId), first = run.snapshot.steps[0]; if (run.status === 'complete' && first.kind === 'image-generation' && run.input === planner.businessTaskInput(order, before, next) && first.prompt === planner.businessTaskPrompt(order, before, next) && (!order.bindings['image-generation']?.modelConfigId || order.bindings['image-generation'].modelConfigId === first.modelConfigId)) background = previous; } catch { /* An unavailable old request is never silently resubmitted. */ } }
            if (background) { next.projectId = background.projectId; next.runId = background.runId; next.dispatchKey = background.dispatchKey; next.submittedAt = background.submittedAt; }
            else { const project = await projects.createProject(input.workspaceId, order, next); next.projectId = project.id; created.push(project); preparingScopes.get(key).add(project.id); }
            next.referenceArtifactIds = await projects.copyReferences(input.workspaceId, projects.documentReferenceIds(order, before), next.projectId, false);
          }
          else if (next.operation === 'cutout' || next.operation === 'compose') next.referenceArtifactIds = await projects.copyReferences(input.workspaceId, before.products.find(product => product.id === next.productId).referenceArtifactIds, order.sourceProjectId);
        }
        planned.push(next);
      }
      const state = await update(input, (current, latest) => {
        if (sha(planner.businessPreparationSource(current, latest)) !== preparedHash) throw Error('准备期间资料已改变，已创建的独立文件保留；请重新准备当前资料。');
        current.tasks = planned; current.preparedHash = preparedHash; current.projectIds = unique([...current.projectIds, order.sourceProjectId, ...planned.map(item => item.projectId).filter(Boolean)]); current.status = order.recipe === 'digital' ? 'ready' : planned.every(item => item.status === 'complete') ? 'review' : 'ready'; if (order.recipe !== 'digital') current.outputIds = planned.filter(item => item.operation === 'compose' || item.operation === 'document').flatMap(item => item.artifactIds); delete current.error;
      });
      return { state, projects: [...created, ...await allProjects(state, orderFrom(state, input.orderId))].filter((project, index, values) => values.findIndex(item => item.id === project.id) === index) };
    })().finally(() => { preparing.delete(key); preparingScopes.delete(key); }); preparing.set(key, task); return task;
  }
  async function nativeRun(task, projectId) {
    if (task.runId) { const run = liveEngine.runDetail ? await liveEngine.runDetail(task.runId) : (await liveEngine.snapshot(undefined, { summaryOnly: false, projectIds: [projectId] })).runs.find(item => item.id === task.runId); if (run) return run; }
    if (task.dispatchKey) { const result = await lookupStart(liveEngine, { projectId, workspaceId: task.workspaceId, dispatchKey: task.dispatchKey }); if (result.status === 'started') return result.run; }
    return undefined;
  }
  async function budgetProject(order, context, project) {
    const budget = context.project.budgetCents; if (budget === undefined || budget === null) return project;
    const snapshot = await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: unique([...order.projectIds, project.id]) }), own = new Set(order.runIds), entries = [...new Map(snapshot.ledger.map(entry => [entry.id, entry])).values()].filter(entry => entry.billingMode === 'live');
    const related = entries.filter(entry => own.has(entry.workflowRunId));
    if (related.some(entry => entry.costState === 'unknown' || entry.calculation?.nativeCurrency === 'USD' && entry.calculation.cnyAmount === undefined)) throw Error('制作单有计费依据待补齐；已设置总上限，先核对原费用再继续，未发送新请求。');
    const spent = related.reduce((total, entry) => total + entry.costCents, 0), remaining = budget - spent;
    if (remaining <= 0) throw Error('本制作单已到填写的总调用上限，已有成果与费用保留。');
    const targetCost = entries.filter(entry => entry.projectId === project.id).reduce((total, entry) => total + entry.costCents, 0);
    return { ...project, costCents: targetCost, budgetCents: targetCost + remaining };
  }
  async function executeModel(input, state, order, task, job) {
    const context = await projects.context(input.workspaceId, order), project = task.operation === 'document' ? await projects.projectMetadata(input.workspaceId, order, task) : { ...context.project };
    let current = await nativeRun({ ...task, workspaceId: input.workspaceId }, project.id);
    const bound = current?.status === 'complete' ? project : await budgetProject(order, context, project);
    if (current && current.workspaceId !== input.workspaceId || current && current.projectId !== project.id) throw Error('已提交请求的归属与制作单不一致，未替换或重新提交。');
    if (!current) {
      if (task.submittedAt) throw Error('本项提交结果尚未确认，未自动重新发送；请读取原任务或恢复运行记录。');
      task.dispatchKey = sha(JSON.stringify({ orderId: order.id, taskId: task.id, inputHash: task.inputHash, projectId: project.id }));
      const request = await projects.request(order, state, task, context, bound);
      if (job.stop || closing || quiescing) throw Error('制作已暂停，未发送新请求。');
      task.submittedAt = stamp();
      await update(input, target => { const next = target.tasks.find(item => item.id === task.id); Object.assign(next, { status: 'running', dispatchKey: task.dispatchKey, submittedAt: task.submittedAt }); });
      if (job.stop || closing || quiescing) { await update(input, target => { const next = target.tasks.find(item => item.id === task.id); delete next.dispatchKey; delete next.submittedAt; }); throw Error('制作已暂停，未发送新请求。'); }
      const started = await startChecked(liveEngine, request => liveEngine.start(request), request);
      if (started.status !== 'started') {
        if (started.status === 'rejected') await update(input, target => { const next = target.tasks.find(item => item.id === task.id); delete next.submittedAt; delete next.dispatchKey; });
        throw Error(started.error || '启动状态未确认，未自动重发。');
      } current = started.run;
      await update(input, target => { target.tasks.find(item => item.id === task.id).runId = current.id; target.runIds = unique([...target.runIds, current.id]); });
    } else if (['failed', 'interrupted', 'paused'].includes(current.status)) await liveEngine.control({ id: current.id, action: 'continue', project: bound, models: context.models, connections: context.connections });
    else if (current.status === 'cancelled') throw Error('该模型请求已取消，请重新准备独立任务；已有费用保留。');
    await update(input, target => { target.tasks.find(item => item.id === task.id).runId = current.id; target.runIds = unique([...target.runIds, current.id]); });
    job.runId = current.id; job.projectId = project.id;
    if (job.stop === 'cancel' && !terminal(current.status)) await liveEngine.control({ id: current.id, action: 'cancel' });
    if (job.stop === 'pause' && current.status === 'running') await liveEngine.control({ id: current.id, action: 'pause' });
    while (true) {
      const snapshot = await liveEngine.snapshot(job.snapshotRevision, { summaryOnly: true, projectIds: [project.id] });
      if (snapshot) { job.snapshotRevision = snapshot.revision; current = snapshot.runs.find(item => item.id === current.id) || current; }
      if (terminal(current.status) || current.status === 'waiting-review') break;
      await wait(250);
    }
    if (current.status !== 'complete') throw Error(current.error || (current.status === 'paused' ? '当前项已暂停，明确继续后从已有进度恢复。' : '当前项未完成，请重试具体失败项；原费用保留。'));
    const detail = liveEngine.runDetail ? await liveEngine.runDetail(current.id) : current;
    const artifacts = detail.attempts.filter(attempt => attempt.status === 'complete').flatMap(attempt => attempt.artifacts || []).filter(file => file.kind === 'image');
    if (task.operation === 'cutout') {
      if (artifacts.length !== 1) throw Error('抠图步骤没有返回单张真实图片，未继续生成场景。');
      let result;
      try { result = await commerceImages.applyAlpha({ projectId: project.id, sourceArtifactId: task.referenceArtifactIds[0], alphaArtifactId: artifacts[0].id }); }
      catch (error) { if (/透明|Alpha|蒙版/i.test(error.message || '')) throw Error(`[需重新抠图]${error.message}`); throw error; }
      return [result.artifact.id];
    }
    if (task.operation === 'background') { const ids = [...(task.referenceArtifactIds || []), ...artifacts.map(file => file.id)]; if (ids.length !== order.imageCount - 1) throw Error('实际场景图数量不足，已停在本项，原费用保留。'); return ids; }
    if (task.kind === 'image') return (await projects.savePoster(order, state, task, detail)).artifacts.filter(file => file.mimeType === 'image/png').map(file => file.id);
    const exported = await projects.saveDocument(order, task, detail);
    if (typeof liveEngine.recordLocalExport === 'function') await liveEngine.recordLocalExport({ projectId: project.id, workspaceId: input.workspaceId, name: exported.record.document.title, kind: task.kind, sourceRevision: exported.record.revision, sourceArtifactIds: exported.record.sourceArtifactIds, artifacts: exported.artifacts });
    return exported.artifacts.map(file => file.id);
  }
  async function compose(input, state, order, task, job) {
    const product = state.products.find(item => item.id === task.productId), cutout = order.tasks.find(item => item.productId === task.productId && item.operation === 'cutout'), background = order.tasks.find(item => item.productId === task.productId && item.operation === 'background');
    if (!cutout || cutout.status !== 'complete' || background && background.status !== 'complete') throw Error('请先完成该商品的抠图与场景步骤，不会重新调用已完成步骤。');
    const brand = state.brands.find(item => item.id === order.brandId), logo = brand?.logoArtifactId ? (await projects.copyReferences(input.workspaceId, [brand.logoArtifactId], order.sourceProjectId))[0] : undefined;
    const caption = [product.name, product.facts.售价 || product.facts.价格 || product.facts.price || '', product.facts.卖点 || product.facts.特点 || product.facts.tagline || ''].filter(Boolean).join('\n');
    if (caption.length > 150) throw Error('商品展示文字超过150字，请缩短名称或卖点后本地重排，未重新生图。');
    if (brand?.forbiddenClaims.some(value => value.trim() && caption.includes(value.trim()))) throw Error('商品文案包含客户禁用表达，请修改确认资料后再本地排版。');
    const results = [], variants = [undefined, ...(background?.artifactIds || [])];
    for (let index = 0; index < variants.length; index++) {
      if (job.stop || closing || quiescing) throw Error('本地排版已停止，原图、已生成文件和费用保留。');
      const result = await commerceImages.compose({ projectId: order.sourceProjectId, sourceArtifactId: task.referenceArtifactIds[0], alphaArtifactId: cutout.artifactIds[0], ...(variants[index] ? { backgroundArtifactId: variants[index] } : {}), ...(logo ? { logoArtifactId: logo } : {}), text: caption, fontFamily: brand?.font || 'Microsoft YaHei', title: `${product.sku} · ${index === 0 ? '白底图' : `场景${index}`}`, sizes: order.sizes });
      results.push(...result.artifacts.filter(file => file.mimeType === 'image/png').map(file => file.id));
    }
    if (results.length !== expectedCount(order, task)) throw Error('本地排版结果不完整，已生成文件保留；请重试本项，不会重新生图。');
    return results;
  }
  async function pump(input, job) {
    try {
      await update(input, order => { order.status = 'running'; delete order.error; });
      let sampleProduct;
      while (!job.stop && !closing && !quiescing) {
        const state = await read(input.workspaceId), order = orderFrom(state, input.orderId);
        if (sha(planner.businessPreparationSource(order, state)) !== order.preparedHash) throw Error('制作资料已改变，已停止后续模型请求；请重新确认并准备，已完成文件和费用保留。');
        const task = order.tasks.find(item => item.status !== 'complete' && (!job.selected || job.selected.has(item.id) || item.status === 'pending' && item.productId && job.selectedProducts.has(item.productId)));
        if (!task) break;
        if (task.status === 'stale') throw Error('该任务资料已过期，请重新准备当前资料。');
        if (job.sampleOnly && sampleProduct && task.productId !== sampleProduct) break;
        sampleProduct ||= task.productId;
        const context = await projects.context(input.workspaceId, order);
        if (task.operation === 'background' || task.operation === 'compose') {
          const cached = await reusable(order, state, { ...task }, context, order.tasks);
          if (cached.status === 'complete') { await update(input, current => { Object.assign(current.tasks.find(item => item.id === task.id), { status: 'complete', artifactIds: cached.artifactIds, inputHash: cached.inputHash, ...(cached.runId ? { runId: cached.runId } : {}) }); }); continue; }
        }
        job.taskId = task.id; job.runId = task.runId; job.projectId = task.projectId;
        await update(input, current => { current.tasks.find(item => item.id === task.id).status = 'running'; });
        let files;
        try { files = task.operation === 'compose' ? await compose(input, state, order, task, job) : await executeModel(input, state, order, task, job); }
        catch (error) { await update(input, current => { const row = current.tasks.find(item => item.id === task.id); row.status = job.stop === 'cancel' ? 'cancelled' : 'failed'; row.error = String(error.message || error).slice(0, 1000); }); throw error; }
        const latest = await read(input.workspaceId), current = orderFrom(latest, input.orderId), currentTask = current.tasks.find(item => item.id === task.id);
        if (!currentTask || sha(planner.businessPreparationSource(current, latest)) !== current.preparedHash) { await update(input, target => { const row = target.tasks.find(item => item.id === task.id); if (row) Object.assign(row, { status: 'stale', artifactIds: files }); }); throw Error('制作期间资料已变，刚生成的独立文件及费用保留，请准备当前版本再继续。'); }
        const actualHash = task.operation === 'compose' ? await inputHash(current, latest, currentTask, context, current.tasks) : task.inputHash;
        await update(input, target => { const row = target.tasks.find(item => item.id === task.id); Object.assign(row, { status: 'complete', artifactIds: files, inputHash: actualHash }); delete row.error; target.outputIds = target.tasks.filter(item => ['compose', 'document'].includes(item.operation) && item.status === 'complete').flatMap(item => item.artifactIds); });
      }
      await update(input, order => { order.status = job.stop ? 'paused' : order.tasks.every(task => task.status === 'complete') ? 'review' : job.sampleOnly ? 'sample-review' : 'ready'; if (job.stop) order.error = job.stop === 'cancel' ? '本轮制作已取消，已发生费用与成果保留。' : '制作已暂停，当前已提交项的费用保留。'; });
    } catch (error) { await update(input, order => { order.status = job.stop ? 'paused' : 'failed'; order.error = String(error.message || error).slice(0, 1000); }).catch(() => undefined); }
  }
  async function performStart(input) {
    writable(); const key = keyFor(input); if (jobs.has(key)) return { state: await read(input.workspaceId), projects: [] };
    const prepared = await prepare(input), state = prepared.state, order = orderFrom(state, input.orderId); writable();
    if (order.recipe === 'digital') return prepared;
    if (input.taskIds && (!Array.isArray(input.taskIds) || !input.taskIds.length || input.taskIds.some(id => !order.tasks.some(task => task.id === id)))) throw Error('请选择本制作单需要重试的任务。');
    const selected = input.taskIds ? new Set(input.taskIds) : undefined;
    if (!selected && order.tasks.some(task => ['failed', 'cancelled'].includes(task.status))) throw Error('有失败或取消项，请选择具体任务重试；不会重新制作已成功的商品。');
    if (order.tasks.every(task => task.status === 'complete')) return prepared;
    try {
      const context = await projects.context(input.workspaceId, order);
      for (const task of order.tasks.filter(task => task.status !== 'complete' && task.operation !== 'compose')) { const previous = task.runId || task.dispatchKey ? await nativeRun({ ...task, workspaceId: input.workspaceId }, task.projectId) : undefined; if (previous?.status !== 'complete') projects.binding(order, context, task.operation === 'cutout' ? 'image-editing' : task.operation === 'background' || task.kind === 'image' ? 'image-generation' : 'text'); }
    } catch (error) { const failed = await update(input, current => { current.status = 'failed'; current.error = String(error.message || error).slice(0, 1000); }); return { state: failed, projects: prepared.projects }; }
    const selectedProducts = new Set(order.tasks.filter(task => selected?.has(task.id)).map(task => task.productId));
    const paidPending = order.tasks.some(task => task.operation !== 'compose' && task.status !== 'complete');
    const sampleOnly = order.recipe === 'merchant' && paidPending && (input.sampleOnly ?? !order.tasks.some(task => task.operation === 'compose' && task.status === 'complete'));
    const job = { input, selected, selectedProducts, sampleOnly, task: undefined, stop: undefined, projectIds: new Set([order.sourceProjectId, ...order.projectIds]) };
    const saved = await update(input, current => { current.status = 'running'; delete current.error; });
    jobs.set(key, job); job.task = queue.then(() => pump(input, job)).finally(() => jobs.delete(key)); queue = job.task.catch(() => undefined);
    return { state: saved, projects: prepared.projects };
  }
  function start(input) {
    writable(); const key = keyFor(input), pending = starting.get(key); if (pending) return pending;
    const task = performStart(input).finally(() => { if (starting.get(key) === task) starting.delete(key); }); starting.set(key, task); return task;
  }
  async function stopRun(id, action) {
    const run = await liveEngine.runDetail(id);
    if (!(action === 'pause' ? run.status === 'running' : ['running', 'paused', 'waiting-review'].includes(run.status))) return;
    try { await liveEngine.control({ id, action }); }
    catch (error) { if (error.message !== '当前状态不能执行这个操作。' || (await liveEngine.runDetail(id)).status !== 'complete') throw error; }
  }
  async function control(input) {
    keyFor(input); const key = keyFor(input), job = jobs.get(key);
    if (input.action === 'pause' || input.action === 'cancel') {
      if (job) { job.stop = input.action; if (job.runId) await stopRun(job.runId, input.action); if (input.action === 'cancel' && job.projectId && commerceImages.cancel) await commerceImages.cancel({ projectId: job.projectId }); }
      const state = await update(input, order => { order.status = 'paused'; order.error = input.action === 'pause' ? '正在暂停，已提交的当前请求完成后停止。' : '已请求取消，已发生费用与已有成果保留。'; }); return { state, projects: [] };
    }
    if (job) throw Error('当前项仍在结束处理中，请稍后继续。');
    if (input.action === 'retry') {
      const state = await read(input.workspaceId), order = orderFrom(state, input.orderId), task = order.tasks.find(item => item.id === input.taskId);
      if (!task || !['failed', 'cancelled'].includes(task.status)) throw Error('请只选择具体失败或取消的任务重试。');
      let id = task.id;
      const previous = task.runId ? await nativeRun({ ...task, workspaceId: input.workspaceId }, task.projectId) : undefined;
      if (task.status === 'cancelled' || task.operation === 'cutout' && task.error?.startsWith('[需重新抠图]') && previous?.status === 'complete') {
        id = randomUUID(); await update(input, target => { const row = target.tasks.find(item => item.id === task.id); row.id = id; row.status = 'pending'; delete row.runId; delete row.dispatchKey; delete row.submittedAt; delete row.error; });
      }
      return start({ ...input, sampleOnly: false, taskIds: [id] });
    }
    if (input.action !== 'continue') throw Error('请选择有效的制作操作。');
    return start({ ...input, sampleOnly: false });
  }
  async function deliveryFiles(input, order, ids) {
    const registry = new Set((await workspaceStorage.list()).projects.filter(project => project.workspaceId === input.workspaceId && order.projectIds.includes(project.projectId)).map(project => project.projectId)), files = [];
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || unique(ids).length !== ids.length) throw Error('请选择1–1000份不重复的正式成品。');
    for (const id of ids) { const file = await artifactStore.read(id); if (!registry.has(file.projectId) || file.trashedAt || file.unavailable) throw Error('成品不属于本制作单的当前工作区项目。'); await validateBusinessFormalArtifact(file, { loadModule: options.loadModule }); files.push({ artifactId: file.id, projectId: file.projectId, name: file.name, bytes: file.buffer.length, sha256: sha(file.buffer) }); }
    return files;
  }
  async function deliver(input) {
    writable(); const key = keyFor(input); if (jobs.has(key) || preparing.has(key)) throw Error('请等待当前制作与文件写入结束再确认交付。');
    if (!input.checks || !['content', 'rights', 'format'].every(field => input.checks[field] === true)) throw Error('请完成内容、授权与文件格式三项实际验收。');
    const state = await read(input.workspaceId), order = orderFrom(state, input.orderId);
    if (!order.factsConfirmedAt || order.tasks.some(task => task.status !== 'complete' || task.factsRevision !== order.factsRevision) || order.recipe !== 'digital' && sha(planner.businessPreparationSource(order, state)) !== order.preparedHash) throw Error('资料或产物尚未完成/已过期，请先准备并检查当前版本。');
    const files = await deliveryFiles(input, order, order.outputIds), receipt = { id: randomUUID(), confirmedAt: stamp(), factsRevision: order.factsRevision, files, checks: { content: true, rights: true, format: true } };
    const result = await update(input, current => { if (current.factsRevision !== order.factsRevision || JSON.stringify(current.outputIds) !== JSON.stringify(order.outputIds)) throw Error('检查期间当前版本已改变，请刷新后重新检查。'); current.deliveries = [...(current.deliveries || []), receipt]; current.status = 'complete'; }); return { state: result, projects: [] };
  }
  async function adopt(input) {
    writable(); const key = keyFor(input); if (jobs.has(key)) throw Error('请先等待当前制作结束。');
    const state = await read(input.workspaceId), order = orderFrom(state, input.orderId), task = input.taskId ? order.tasks.find(item => item.id === input.taskId) : undefined;
    if (input.taskId && !task) throw Error('所选任务不属于当前制作单。');
    const files = await deliveryFiles(input, order, input.artifactIds);
    if (task && files.some(file => file.projectId !== task.projectId)) throw Error('采用文件必须属于该任务的项目。');
    if (task?.kind && task.kind !== 'image') for (const file of files) if ((await artifactStore.read(file.artifactId)).mimeType !== BUSINESS_OFFICE_MIME[task.kind]) throw Error('采用的文件类型与当前任务不匹配。');
    const ancestorRuns = await unclaimedBusinessRuns({ state, order, artifactIds: input.artifactIds, workspaceStorage, artifactStore, liveEngine });
    const result = await update(input, (current, latest) => {
      const otherRuns = new Set(latest.orders.filter(item => item.id !== current.id).flatMap(item => item.runIds));
      current.runIds = unique([...current.runIds, ...ancestorRuns.filter(id => !otherRuns.has(id))]);
      if (task) { Object.assign(current.tasks.find(item => item.id === task.id), { status: 'complete', artifactIds: input.artifactIds, factsRevision: current.factsRevision }); current.outputIds = current.tasks.filter(item => ['compose', 'document'].includes(item.operation) && item.status === 'complete').flatMap(item => item.artifactIds); }
      else current.outputIds = [...input.artifactIds];
      if (current.recipe === 'digital') {
        if (input.artifactIds.length > 200) throw Error('单套数字商品最多200份正式文件，请分套上架。');
        current.factsRevision = Math.max(1, current.factsRevision); current.factsConfirmedAt ||= stamp();
        current.tasks = [{ id: randomUUID(), label: '本地整理正式作品', kind: 'image', operation: 'compose', projectId: current.sourceProjectId, status: 'complete', artifactIds: [...input.artifactIds], factsRevision: current.factsRevision, inputHash: sha(JSON.stringify(files)) }];
        current.preparedHash = sha(planner.businessPreparationSource(current, latest));
      }
      current.status = 'review';
    }); return { state: result, projects: [] };
  }
  const api = {
    prepare, start, control, deliver, adopt,
    adoptRevision: createBusinessRevisionAdopter({ ...options, deliveryFiles, allProjects, writable, busy: key => jobs.has(key) || starting.has(key) || preparing.has(key) }),
    isProjectBusy: projectId => [...jobs.values()].some(job => job.projectIds.has(projectId)) || [...preparingScopes.values()].some(ids => ids.has(projectId)),
    isWorkspaceBusy: workspaceId => [...jobs.keys(), ...starting.keys(), ...preparing.keys()].some(key => key.startsWith(workspaceId + '/')),
    async drain() { await Promise.allSettled([...starting.values(), ...preparing.values(), ...[...jobs.values()].map(job => job.task)]); },
    async prepareClose() { quiescing = true; try { for (const job of [...jobs.values()]) await control({ ...job.input, action: 'cancel' }); await api.drain(); } finally { quiescing = false; } },
    async shutdown() { closing = true; for (const job of [...jobs.values()]) await control({ ...job.input, action: 'cancel' }); await api.drain(); },
  };
  return api;
}
module.exports = { createBusinessProduction };
