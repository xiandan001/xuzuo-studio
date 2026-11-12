const { randomUUID, webcrypto } = require('node:crypto');
const core = require('./business-data.runtime.cjs');
const now = () => new Date().toISOString();
const sha = async bytes => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
const feedbackSignature = row => JSON.stringify([row.target.projectId, row.target.artifactId, row.target.pageId, row.target.blockId, row.target.selectedText, row.target.sheetId, row.target.cellAddress, row.target.region && [row.target.region.x, row.target.region.y, row.target.region.width, row.target.region.height], row.text, row.sourceSha256, row.sourceRevision]);
function createBusinessLinks({ store, workspaceStorage, artifactStore, getLedger, getRuns = async () => [] }) {
  async function knownProjects(workspaceId) { if (!core.businessId(workspaceId)) throw Error('请选择有效工作区。'); return (await workspaceStorage.list()).projects.filter(row => row.workspaceId === workspaceId); }
  async function allocateCosts(input) {
    if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !core.businessId(input.entryId) || !Array.isArray(input.allocations) || input.allocations.length > 100 || typeof (input.note || '') !== 'string' || (input.note || '').length > 1000) throw Error('请选择费用及有效的归属比例。');
    const projects = new Set((await knownProjects(input.workspaceId)).map(row => row.projectId));
    const source = (await getLedger(input.workspaceId)).find(row => row.id === input.entryId && row.scope === 'chat' && row.workspaceId === input.workspaceId && row.billingMode === 'live');
    if (!source || source.status === 'processing' || source.costState === 'not-incurred') throw Error('只能分配本工作区已结束的真实聊天费用，原账本不变。');
    if (input.allocations.some(row => !row || Object.keys(row).some(key => !['projectId', 'orderId', 'basisPoints'].includes(key)) || !row.projectId && !row.orderId || row.projectId && !projects.has(row.projectId) || row.orderId && !core.businessId(row.orderId) || !Number.isInteger(row.basisPoints) || row.basisPoints < 1 || row.basisPoints > 10000) || input.allocations.reduce((sum, row) => sum + row.basisPoints, 0) > 10000) throw Error('费用目标不属于本工作区，或比例合计超过100%。');
    return store.mutate(input.workspaceId, state => {
      if (state.revision !== input.expectedRevision) throw Object.assign(Error('费用归属已变化，请重新读取后再保存。'), { code: 'BUSINESS_CONFLICT' });
      if (input.allocations.some(row => row.orderId && !state.orders.some(order => order.id === row.orderId))) throw Error('费用归属的制作单已不可用。');
      const targets = input.allocations.map(row => `${row.projectId || ''}/${row.orderId || ''}`); if (new Set(targets).size !== targets.length) throw Error('同一目标不能重复分配。');
      const stamp = now(), rows = state.costAllocations || [], current = rows.filter(row => !row.voidedAt && row.entryId === input.entryId);
      const signature = row => JSON.stringify([row.projectId || '', row.orderId || '', row.basisPoints]);
      if (current.length === input.allocations.length && current.every(row => row.note === (input.note || '')) && current.map(signature).sort().join('|') === input.allocations.map(signature).sort().join('|')) return state;
      state.costAllocations = [...rows.map(row => !row.voidedAt && row.entryId === input.entryId ? { ...row, voidedAt: stamp } : row), ...input.allocations.map(row => ({ id: randomUUID(), entryId: input.entryId, ...row, note: input.note || '', createdAt: stamp }))];
      return state;
    });
  }
  async function linkOutput(input) {
    if (!input || !core.businessId(input.projectId) || !Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > 100 || input.artifactIds.some(id => !core.businessId(id)) || new Set(input.artifactIds).size !== input.artifactIds.length || input.orderId && !core.businessId(input.orderId) || input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200)) throw Error('请选择当前作品的实际文件。');
    const projects = await knownProjects(input.workspaceId); if (!projects.some(row => row.projectId === input.projectId)) throw Error('作品不属于当前工作区。');
    const all = await artifactStore.backupEntries([input.projectId]), files = input.artifactIds.map(id => all.find(file => file.id === id && file.projectId === input.projectId && !file.trashedAt && !file.unavailable));
    if (files.some(file => !file || !file.mimeType?.startsWith('image/') && !/wordprocessingml|presentationml|spreadsheetml/.test(file.mimeType))) throw Error('请选择可用的图片或Office正式成品文件，原文件未移除。');
    const runs = (await getRuns()).filter(run => run.workspaceId === input.workspaceId && run.projectId === input.projectId && run.mode === 'live');
    const sourceRuns = runs.filter(run => run.attempts?.some(attempt => attempt.artifacts?.some(file => input.artifactIds.includes(file.id)))).map(run => run.id);
    const kinds = [...new Set(files.map(file => file.mimeType.includes('wordprocessingml') ? 'word' : file.mimeType.includes('presentationml') ? 'ppt' : file.mimeType.includes('spreadsheetml') ? 'excel' : 'image'))];
    return store.mutate(input.workspaceId, state => {
      const stamp = now(); let order = input.orderId && state.orders.find(order => order.id === input.orderId);
      if (input.orderId && !order) throw Error('制作单已不可用，请重新选择。');
      if (state.orders.some(row => row.id !== order?.id && sourceRuns.some(id => row.runIds.includes(id)))) throw Error('这份作品的模型运行已归属其他制作单，不能重复计算；可到原制作单继续交付。');
      if (!order) { order = { id: randomUUID(), name: input.name?.trim() || files[0].name.slice(0, 200), recipe: kinds.some(kind => kind !== 'image') ? 'documents' : 'digital', sourceProjectId: input.projectId, brief: '由已保存作品创建的交付制作单，尚未确认内容与授权。', productIds: [], projectIds: [input.projectId], runIds: [], outputIds: [], includedRevisions: 2, status: 'review', factsRevision: 1, facts: {}, outputKinds: kinds, imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: stamp, updatedAt: stamp }; state.orders.push(order); }
      order.projectIds = [...new Set([...order.projectIds, input.projectId])]; order.runIds = [...new Set([...order.runIds, ...sourceRuns])]; order.outputIds = [...new Set([...order.outputIds, ...input.artifactIds])]; order.outputKinds = [...new Set([...order.outputKinds, ...kinds])];
      for (const file of files) if (!order.tasks.some(task => task.artifactIds.includes(file.id))) order.tasks.push({ id: randomUUID(), label: file.name, kind: kinds.length === 1 ? kinds[0] : file.mimeType.includes('wordprocessingml') ? 'word' : file.mimeType.includes('presentationml') ? 'ppt' : file.mimeType.includes('spreadsheetml') ? 'excel' : 'image', projectId: input.projectId, status: 'complete', artifactIds: [file.id], factsRevision: order.factsRevision });
      if (!['running', 'archived'].includes(order.status)) order.status = 'review'; order.updatedAt = stamp; return state;
    });
  }
  async function importProofFeedback(input) {
    if (!input || input.orderId !== undefined && !core.businessId(input.orderId) || !core.businessId(input.packageId) || !Array.isArray(input.annotations) || !input.annotations.length || input.annotations.length > 500) throw Error('校样反馈内容无效。');
    const projects = new Set((await knownProjects(input.workspaceId)).map(row => row.projectId));
    if (new Set(input.annotations.map(row => row.id)).size !== input.annotations.length) throw Error('校样反馈编号重复，未导入。');
    const proofKinds = new Set();
    for (const row of input.annotations) {
      if (!core.businessId(row.id) || !row.target || !core.businessId(row.target.artifactId) || !projects.has(row.target.projectId) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 10000 || !/^[a-f0-9]{64}$/.test(row.sourceSha256 || '')) throw Error('校样反馈位置或来源无效。');
      const file = await artifactStore.read(row.target.artifactId); if (file.projectId !== row.target.projectId || file.trashedAt || await sha(file.buffer) !== row.sourceSha256) throw Error('校样文件已改变或不属于当前项目，请使用对应版本反馈。');
      proofKinds.add(file.mimeType.includes('wordprocessingml') ? 'word' : file.mimeType.includes('presentationml') ? 'ppt' : file.mimeType.includes('spreadsheetml') ? 'excel' : 'image');
    }
    const proofProjectIds = [...new Set(input.annotations.map(row => row.target.projectId))], proofIds = [...new Set(input.annotations.map(row => row.target.artifactId))];
    const proofRuns = (await getRuns()).filter(run => run.workspaceId === input.workspaceId && proofProjectIds.includes(run.projectId) && run.mode === 'live' && run.attempts?.some(attempt => attempt.artifacts?.some(file => proofIds.includes(file.id)))).map(run => run.id);
    return store.mutate(input.workspaceId, state => {
      let order = input.orderId && state.orders.find(order => order.id === input.orderId);
      if (input.orderId && !order) throw Error('校样制作单不存在。');
      if (!order) {
        const owners = state.orders.filter(row => proofRuns.some(id => row.runIds.includes(id)));
        if (owners.length > 1) throw Error('所选校样属于不同制作单，请分别导入，避免混入客户反馈。');
        order = owners[0] || state.orders.find(row => row.status !== 'archived' && proofIds.every(id => row.outputIds.includes(id)));
        if (!order) {
          if (proofProjectIds.length !== 1) throw Error('请先把多项目校样关联到同一制作单。');
          const stamp = now(); order = { id: randomUUID(), name: (input.title || '客户校样返修').slice(0, 200), recipe: [...proofKinds].some(kind => kind !== 'image') ? 'documents' : 'digital', sourceProjectId: proofProjectIds[0], brief: '从客户校样导入的返修制作单，尚未生成或收费。', productIds: [], projectIds: proofProjectIds, runIds: proofRuns, outputIds: proofIds, includedRevisions: 2, status: 'review', factsRevision: 1, facts: {}, outputKinds: [...proofKinds], imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: stamp, updatedAt: stamp }; state.orders.push(order);
        } else { order.projectIds = [...new Set([...order.projectIds, ...proofProjectIds])]; order.outputIds = [...new Set([...order.outputIds, ...proofIds])]; }
      }
      if (input.annotations.some(row => ![order.sourceProjectId, ...order.projectIds].includes(row.target.projectId) || !order.outputIds.includes(row.target.artifactId))) throw Error('反馈文件不属于这份制作单。');
      const stamp = now(); const round = Math.max(0, ...state.feedback.filter(row => row.orderId === order.id).map(row => row.round)) + 1;
      for (const row of input.annotations) { const old = state.feedback.find(old => old.proofPackageId === input.packageId && old.proofAnnotationId === row.id); if (old && (old.orderId !== order.id || feedbackSignature(old) !== feedbackSignature(row))) throw Error('同一条校样反馈已导入且归属或内容不同，请导出新的反馈文件。'); if (!old) state.feedback.push({ id: randomUUID(), orderId: order.id, round, target: row.target, text: row.text, tasks: [], status: 'open', runIds: [], proofPackageId: input.packageId, proofAnnotationId: row.id, sourceSha256: row.sourceSha256, ...(row.sourceRevision ? { sourceRevision: row.sourceRevision } : {}), createdAt: stamp, updatedAt: stamp }); }
      return state;
    });
  }
  return { allocateCosts, linkOutput, importProofFeedback };
}
module.exports = { createBusinessLinks };
