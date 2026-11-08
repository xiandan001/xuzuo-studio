const { checkedCommerceDocument } = require('./commerce-image-document.cjs');
async function unclaimedBusinessRuns({ state, order, artifactIds, workspaceStorage, artifactStore, liveEngine }) {
  const projects = new Set((await workspaceStorage.list()).projects.filter(project => project.workspaceId === state.workspaceId).map(project => project.projectId));
  const snapshot = await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: [...projects] }), runs = new Map(snapshot.runs.filter(run => run.workspaceId === state.workspaceId).map(run => [run.id, run]));
  const charged = new Set(snapshot.ledger.filter(entry => entry.billingMode === 'live' && !entry.queryOnly && entry.costState !== 'not-incurred').map(entry => entry.workflowRunId));
  const claimedElsewhere = new Set(state.orders.filter(item => item.id !== order.id).flatMap(item => item.runIds));
  const metadata = new Map(snapshot.runs.flatMap(run => run.attempts.flatMap(attempt => attempt.artifacts || [])).map(file => [file.id, file]));
  const pending = [...artifactIds], visitedFiles = new Set(), visitedRuns = new Set(), result = [];
  const enqueue = values => { for (const id of values || []) if (typeof id === 'string' && !visitedFiles.has(id)) pending.push(id); };
  while (pending.length) {
    if (visitedFiles.size >= 256 || visitedRuns.size >= 128) throw Error('所选成品的来源链超过安全范围，请分批关联制作费用。');
    const id = pending.shift(); if (visitedFiles.has(id)) continue; visitedFiles.add(id);
    let file = metadata.get(id);
    if (!file) { try { file = (await artifactStore.list([id]))[0]; } catch { continue; } }
    if (!file || !projects.has(file.projectId)) continue;
    const run = runs.get(file.runId);
    if (!run || visitedRuns.has(run.id) || claimedElsewhere.has(run.id)) continue;
    visitedRuns.add(run.id); if (charged.has(run.id)) result.push(run.id);
    enqueue(run.attachmentIds);
    for (const step of run.snapshot?.steps || []) enqueue(step.referenceArtifactIds);
    for (const attempt of run.attempts) enqueue(attempt.sourceArtifactIds);
    const proof = run.localImageProof;
    enqueue([proof?.wallpaperExport?.sourceArtifactId, proof?.beadExport?.sourceArtifactId, proof?.commerceExport?.originalSourceArtifactId]);
    if (proof?.beadExport?.sourceArtifactId) {
      const source = await artifactStore.read(proof.beadExport.sourceArtifactId);
      if (source.projectId !== run.projectId || source.runId !== run.id || !source.mimeType.startsWith('application/json') || source.buffer.length > 8 * 1024 * 1024) throw Error('本地拼豆来源链不一致，未随意分摊其他项目费用。');
      const document = require('./bead-document.cjs').checkedBeadDocument(JSON.parse(source.buffer.toString('utf8'))); enqueue([document.referenceId]);
    }
    const sceneId = proof?.commerceExport?.sourceArtifactId;
    if (sceneId) {
      const source = await artifactStore.read(sceneId);
      if (source.projectId !== run.projectId || source.runId !== run.id || source.mimeType !== 'application/json' || source.buffer.length > 2 * 1024 * 1024) throw Error('本地图层来源链不一致，未随意分摊其他项目费用。');
      const document = checkedCommerceDocument(JSON.parse(source.buffer.toString('utf8')));
      enqueue([document.sourceArtifactId, document.protectionSourceArtifactId, document.protectedMaskArtifactId]); enqueue(document.layers.filter(layer => layer.type === 'image').map(layer => layer.artifactId));
    }
  }
  return [...new Set(result)];
}
module.exports = { unclaimedBusinessRuns };
