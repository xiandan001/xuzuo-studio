const { createHash } = require('node:crypto');
const { BUSINESS_OFFICE_MIME } = require('./business-production-projects.cjs');
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function createBusinessRevisionAdopter({ businessStore, artifactStore, editorStore, spreadsheetStore, deliveryFiles, allProjects, busy, writable }) {
  return async function adoptRevision(input) {
    writable();
    if (!input || ![input.workspaceId, input.orderId, input.feedbackId, input.sourceArtifactId].every(id) || !/^[a-f0-9]{64}$/.test(input.sourceSha256) || !Number.isSafeInteger(input.exportRevision) || input.exportRevision < 1 || input.sourceRevision !== undefined && (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1) || !Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > 20 || input.artifactIds.some(item => !id(item)) || new Set(input.artifactIds).size !== input.artifactIds.length) throw Error('返修采用信息不完整，请重新选择原文件与本轮导出。');
    if (busy(`${input.workspaceId}/${input.orderId}`)) throw Error('制作仍在运行，请等待当前项结束后采用修订。');
    const state = await businessStore.mutate(input.workspaceId, async state => {
      const order = state.orders.find(row => row.id === input.orderId), feedback = state.feedback.find(row => row.id === input.feedbackId && row.orderId === input.orderId);
      if (!order || !feedback || order.status === 'archived' || order.status === 'running') throw Error('制作单或返修记录不可采用，请先结束当前制作。');
      if (feedback.revisionAdoption) {
        const previous = feedback.revisionAdoption;
        if (previous.sourceArtifactId === input.sourceArtifactId && previous.sourceSha256 === input.sourceSha256 && previous.exportRevision === input.exportRevision && sameIds(previous.artifactIds, input.artifactIds)) return state;
        throw Error('这轮返修已采用其他导出，原采用记录保留。');
      }
      if (feedback.status === 'confirmed' || feedback.target.artifactId !== input.sourceArtifactId || feedback.sourceSha256 && feedback.sourceSha256 !== input.sourceSha256 || feedback.sourceRevision !== undefined && feedback.sourceRevision !== input.sourceRevision) throw Error('当前原文件与本轮反馈不一致，未采用任何修订。');
      const source = await artifactStore.read(input.sourceArtifactId), kind = Object.keys(BUSINESS_OFFICE_MIME).find(kind => BUSINESS_OFFICE_MIME[kind] === source.mimeType);
      if (!kind || source.projectId !== feedback.target.projectId || source.trashedAt || source.unavailable || digest(source.buffer) !== input.sourceSha256) throw Error('返修原文件已改变或不可用，请核对反馈对应原版。');
      const expectedRun = `${kind === 'excel' ? 'spreadsheet' : 'editor'}-${source.projectId}-${input.exportRevision}`;
      if (input.sourceRevision !== undefined && source.runId !== `${kind === 'excel' ? 'spreadsheet' : 'editor'}-${source.projectId}-${input.sourceRevision}`) throw Error('反馈原文件与原修订号不一致。');
      const store = kind === 'excel' ? spreadsheetStore : editorStore;
      if (!store?.loadVersion) throw Error('当前版本缺少文档修订核对模块。');
      const record = await store.loadVersion({ projectId: source.projectId, revision: input.exportRevision });
      if (record.document.kind !== kind || !record.sourceArtifactIds.includes(input.sourceArtifactId)) throw Error('本轮导出没有绑定返修原文件，请载入返修原版后保存并导出。');
      await deliveryFiles(input, order, input.artifactIds);
      for (const artifactId of input.artifactIds) {
        const file = await artifactStore.read(artifactId);
        if (file.projectId !== source.projectId || file.mimeType !== source.mimeType || file.runId !== expectedRun || file.trashedAt || file.unavailable) throw Error('请选择本轮修订真正导出的同格式文件，未采用其他文件。');
      }
      const task = order.tasks.find(row => row.projectId === source.projectId && row.kind === kind && row.operation === 'document');
      const replacedIds = new Set([input.sourceArtifactId, ...(task?.artifactIds || [])]);
      if (task) { task.artifactIds = [...input.artifactIds]; task.status = 'complete'; task.factsRevision = order.factsRevision; delete task.error; }
      order.outputIds = [...new Set([...order.outputIds.filter(artifactId => !replacedIds.has(artifactId)), ...input.artifactIds])];
      order.status = 'review'; order.updatedAt = new Date().toISOString();
      feedback.status = 'confirmed'; feedback.updatedAt = order.updatedAt;
      feedback.revisionAdoption = { sourceArtifactId: input.sourceArtifactId, sourceSha256: input.sourceSha256, exportRevision: input.exportRevision, artifactIds: [...input.artifactIds], adoptedAt: order.updatedAt };
      return state;
    });
    return { state, projects: await allProjects(state, state.orders.find(row => row.id === input.orderId)) };
  };
}
module.exports = { createBusinessRevisionAdopter };
