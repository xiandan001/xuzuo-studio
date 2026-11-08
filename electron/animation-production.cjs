const { createHash, randomUUID } = require('node:crypto');
const { startChecked, lookupStart } = require('./live-start.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
const abortError = () => Object.assign(Error('动画制作已取消，源稿与已发生费用保留。'), { name: 'AbortError' });
function createAnimationProduction({ workspaceStorage, artifactStore, liveEngine, getContext, assertAdmission = async () => undefined, start, journal, core }) {
  async function update(projectId, jobId, dispatchKey, patch) { return journal.mutate(projectId, value => { const owner = value.jobs.find(row => row.id === jobId); if (!owner?.operations.some(row => row.dispatchKey === dispatchKey)) throw Error('动画派发记录不可用，未重发请求。'); for (const job of value.jobs) for (const operation of job.operations.filter(row => row.dispatchKey === dispatchKey)) { Object.assign(operation, patch); if (patch.runId && !job.runIds.includes(patch.runId)) job.runIds.push(patch.runId); job.updatedAt = new Date().toISOString(); } return value; }); }
  async function contextFor(document, referenceIds) {
    await assertAdmission(document.projectId);
    const place = (await workspaceStorage.list()).projects.find(row => row.projectId === document.projectId);
    if (!place) throw Error('动画项目尚未连接本地文件夹。');
    await workspaceStorage.assertProject(document.projectId, place.workspaceId);
    const context = await getContext({ workspaceId: place.workspaceId, projectId: document.projectId });
    if (context.project?.id !== document.projectId || context.project.workspaceId !== place.workspaceId || context.project.kind !== 'image' || context.project.trashedAt) throw Error('请选择当前可用的图片项目。');
    const capability = referenceIds.length ? 'image-editing' : 'image-generation';
    const models = context.models.filter(row => row.enabled && !row.demo && row.capabilities.includes(capability) && context.connections.some(connection => connection.id === row.connectionId && connection.enabled && !connection.demo));
    const model = models.find(row => row.id === document.modelConfigId) || (!document.modelConfigId && models.length === 1 ? models[0] : undefined);
    const keys = (context.credentials || []).filter(row => row.enabled && row.connectionId === model?.connectionId), key = keys.find(row => row.id === document.credentialId) || (!document.credentialId && keys.length === 1 ? keys[0] : undefined);
    if (!model || !key) throw Error(referenceIds.length ? '请选择支持参考图编辑的图片模型及对应 Key。' : '请选择已启用的图片生成模型及对应 Key。');
    const sources = [];
    for (const id of referenceIds) { const file = await artifactStore.read(id); if (file.projectId !== document.projectId || file.trashedAt || file.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || file.buffer.length > 32 * 1024 * 1024) throw Error('参考图需要是当前项目可读取的 PNG、JPEG 或 WebP（32MB以内）。'); const actual = imageType(file.buffer), size = rasterDimensions(file.buffer); if (actual.mimeType !== file.mimeType || size.width * size.height > 16777216) throw Error('参考图实际类型或像素超出可用范围，未开始收费生成。'); sources.push({ id, sha256: hash(file.buffer) }); }
    return { context, capability, model, key, sources };
  }
  async function generate({ document, entries, jobId, signal, retry = false, refineInstruction, frameId, referenceIds = document.referenceArtifactIds, resumeJobId }) {
    const cancelled = () => { if (signal?.aborted) throw abortError(); }; cancelled();
    const { context, capability, model, key, sources } = await contextFor(document, referenceIds); cancelled();
    let prompt = core.animationGenerationPrompt(document, entries, { refineInstruction, frameId });
    if (refineInstruction && !frameId) prompt += '\n\n现有源状态顺序：\n' + entries[0].frames.map((frame, index) => { const reference = referenceIds.indexOf(frame.atlasArtifactId); if (reference < 0) throw Error('现有源画面数量超过本次参考范围，请改为单帧精修。'); return `${index + 1}. 参考图${reference + 1}，${frame.grid[0]}列${frame.grid[1]}行中的第${frame.cell[0] + 1}列第${frame.cell[1] + 1}行${frame.crop ? `，原像素裁切${frame.crop.join(',')}` : ''}；保持该状态的主体与姿态，仅按修改要求处理。`; }).join('\n');
    const sourceHash = hash([core.animationArtHash(document, entries.map(row => row.id)), document.columns, document.rows, core.animationSourceBackground(document), prompt, sources.map(row => row.sha256), model.modelId, context.connections.find(row => row.id === model.connectionId)?.baseUrl, refineInstruction || '', frameId || '', 'gif-factory-v1']);
    const history = await journal.read(document.projectId);
    const original = resumeJobId && history.jobs.find(job => job.id === resumeJobId)?.operations.findLast(row => row.entryId === entries[0].id);
    if (original && original.sourceHash !== sourceHash) throw Error('原任务之后源稿或需求已改变，未将恢复操作变成新收费请求；请先查看原任务结果，或明确发起新的精修。');
    let operation = history.jobs.flatMap(job => job.operations).findLast(row => row.sourceHash === sourceHash && row.entryId === entries[0].id);
    if (refineInstruction && !resumeJobId && operation?.status === 'complete') operation = undefined;
    if (operation && retry) {
      const previous = operation.runId ? await liveEngine.runDetail(operation.runId) : undefined;
      if (!previous && operation.status !== 'failed' || previous && ['running', 'paused', 'waiting-review'].includes(previous.status) || operation.status === 'unknown') throw Error('原请求仍在运行或结果未知，先查看已有任务，未再次收费派发。');
      operation = undefined;
    }
    const existed = Boolean(operation);
    operation = operation ? structuredClone(operation) : { entryId: entries[0].id, entryIds: entries.map(row => row.id), sourceHash, dispatchKey: hash([document.projectId, jobId, randomUUID()]), status: 'submitting' };
    await journal.mutate(document.projectId, value => { const job = value.jobs.find(row => row.id === jobId); if (!job) throw Error('动画任务已变化，未开始生成。'); if (!job.operations.some(row => row.dispatchKey === operation.dispatchKey)) job.operations.push(operation); return value; });
    let run;
    if (operation.runId) { run = await liveEngine.runDetail(operation.runId); if (!run) throw Error('此前生成记录暂不可读，没有自动重发。'); }
    else if (existed) { const found = await lookupStart(liveEngine, { projectId: document.projectId, workspaceId: context.project.workspaceId, dispatchKey: operation.dispatchKey }); if (found.status !== 'started') throw Error('此前派发结果未知，请恢复原任务，未自动重新生成。'); run = found.run; }
    else {
      if (signal?.aborted) { await update(document.projectId, jobId, operation.dispatchKey, { status: 'failed' }); throw abortError(); }
      const owned = new Set(document.entries.flatMap(entry => [entry.outputArtifactId, ...entry.frames.map(frame => frame.atlasArtifactId)]).filter(Boolean));
      const previousRuns = (await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: [document.projectId] })).runs;
      for (const pending of previousRuns.filter(row => row.status === 'waiting-review' && row.snapshot?.steps.some(step => step.kind === 'animation-compose'))) {
        const detail = await liveEngine.runDetail(pending.id), step = detail?.snapshot.steps[detail.stepIndex];
        if (detail?.projectId === document.projectId && detail.workspaceId === context.project.workspaceId && step?.kind === 'manual-review' && !detail.snapshot.steps.slice(detail.stepIndex + 1).some(row => row.enabled) && detail.attempts.some(attempt => attempt.artifacts?.some(file => owned.has(file.id)))) await liveEngine.control({ id: detail.id, action: 'cancel' });
      }
      const snapshot = await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: [document.projectId] });
      const costCents = snapshot.ledger.filter(row => row.projectId === document.projectId && row.billingMode === 'live').reduce((sum, row) => sum + row.costCents, 0);
      const step = { id: 'animation-atlas', name: frameId ? '精修选中动画帧' : refineInstruction ? '精修选中角色' : '生成角色图集', kind: capability, role: 'producer', prompt, inputSource: 'project', referenceArtifactIds: referenceIds, enabled: true, modelConfigId: model.id, credentialId: key.id, imageSize: document.columns > document.rows ? '1536x1024' : document.rows > document.columns ? '1024x1536' : '1024x1024', imageBackground: core.animationSourceBackground(document), imageOutputFormat: 'png', count: 1 };
      const workflow = { id: 'animation-' + randomUUID(), workspaceId: context.project.workspaceId, name: `${document.title || context.project.name} · ${step.name}`, description: JSON.stringify({ type: 'xuzuo-animation-source', jobId, entryIds: entries.map(row => row.id), sourceHash }), outputKind: 'image', steps: [step], updatedAt: new Date().toISOString() };
      const request = { project: { ...context.project, costCents }, workflow, connections: context.connections, models: context.models, input: document.prompt.trim() || '按内置角色一致性规范制作指定姿态图集。', variables: {}, attachmentIds: referenceIds, dispatchKey: operation.dispatchKey, acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
      if (signal?.aborted) { await update(document.projectId, jobId, operation.dispatchKey, { status: 'failed' }); throw abortError(); } const result = await startChecked(liveEngine, start || (input => liveEngine.start(input)), request);
      if (result.status !== 'started') { await update(document.projectId, jobId, operation.dispatchKey, { status: result.status === 'unknown' ? 'unknown' : 'failed' }); throw Error(result.error || '生成未开始，已有素材保留。'); } run = result.run;
    }
    if (!run || run.projectId !== document.projectId || run.workspaceId !== context.project.workspaceId || run.dispatchKey !== operation.dispatchKey) throw Error('已有生成任务与当前项目或派发记录不匹配，未读取或取消其它任务。');
    await update(document.projectId, jobId, operation.dispatchKey, { runId: run.id, status: run.status === 'complete' ? 'complete' : 'running' });
    const stop = () => { void liveEngine.control({ id: run.id, action: 'cancel' }).catch(() => undefined); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const until = Date.now() + 10 * 60 * 1000;
      while (true) {
        if (signal?.aborted) { await liveEngine.control({ id: run.id, action: 'cancel' }).catch(() => undefined); throw abortError(); }
        run = await liveEngine.runDetail(run.id);
        if (run.status === 'complete') {
          const artifact = run.attempts.filter(row => row.status === 'complete').flatMap(row => row.artifacts || []).find(row => row.mimeType === 'image/png');
          if (!artifact) throw Error('模型没有返回实际 PNG 图集，费用保留，请检查原任务。');
          const file = await artifactStore.read(artifact.id); if (file.projectId !== document.projectId || file.trashedAt || file.unavailable) throw Error('生成的图集不可读取，未改用历史图片。');
          await update(document.projectId, jobId, operation.dispatchKey, { status: 'complete', artifactId: artifact.id });
          return { artifact, runId: run.id, sourceHash };
        }
        if (['failed', 'cancelled', 'interrupted', 'paused', 'waiting-review'].includes(run.status)) { await update(document.projectId, jobId, operation.dispatchKey, { status: 'failed' }); throw Error(run.error || '图集生成未完成，原稿与调用费用保留。'); }
        if (Date.now() >= until) { stop(); throw Error('生成等待已超时，已请求停止原任务，未再次调用模型。'); }
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    } finally { signal?.removeEventListener('abort', stop); if (signal?.aborted) { try { const final = await liveEngine.runDetail(run.id); if (final?.projectId === document.projectId && final.dispatchKey === operation.dispatchKey && ['complete', 'failed', 'cancelled', 'interrupted'].includes(final.status)) { const artifact = final.attempts?.flatMap(row => row.artifacts || []).find(row => row.mimeType === 'image/png'); await update(document.projectId, jobId, operation.dispatchKey, { status: final.status === 'complete' ? 'complete' : 'failed', ...(artifact ? { artifactId: artifact.id } : {}) }); } } catch { /* Unreadable completion keeps the original request identity for explicit recovery. */ } } }
  }
  return { generate };
}
module.exports = { createAnimationProduction };
