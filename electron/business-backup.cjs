const core = require('./business-data.runtime.cjs');
const { createHash } = require('node:crypto');
const isBusinessPath = relative => /(?:^|\/)\.xuzuo-business\/(?:state-v1|state-marker-v1)\.json$/.test(relative);
const isBusinessStatePath = relative => /(?:^|\/)\.xuzuo-business\/state-v1\.json$/.test(relative);
function validateBusinessBackup(value, relative) {
  if (!isBusinessPath(relative)) return false;
  const expected = relative.split('/')[1];
  if (isBusinessStatePath(relative)) core.checkedBusinessState(value, expected);
  else if (!value || value.version !== 1 || value.workspaceId !== expected) throw Error('业务保存标记与备份工作区不一致。');
  return true;
}
function businessForSelection(input, projectIds, artifactIds) {
  const state = core.checkedBusinessState(input);
  if (!projectIds) {
    if (state.orders.some(row => row.status === 'running')) throw Error('请等待当前业务制作结束或暂停后再备份。');
    return state;
  }
  if ((state.costAllocations || []).length) throw Error('存在聊天费用分摊历史，请按完整工作区备份，保留原聊天账本与费用归属。');
  const selected = new Set(projectIds), files = new Set(artifactIds || []), products = new Map(state.products.map(row => [row.id, row]));
  const orders = state.orders.filter(order => [order.sourceProjectId, ...order.projectIds, ...order.tasks.map(task => task.projectId)].some(id => selected.has(id)));
  for (const order of orders) {
    const brand = state.brands.find(row => row.id === order.brandId);
    const linked = [order.sourceProjectId, ...order.projectIds, ...order.tasks.map(task => task.projectId), ...order.productIds.map(id => products.get(id)?.projectId), brand?.projectId, ...state.feedback.filter(row => row.orderId === order.id).map(row => row.target.projectId)].filter(Boolean);
    if (linked.some(id => !selected.has(id))) throw Error('制作单“' + order.name + '”关联多个项目，请选中该单全部项目（含品牌素材项目），或选择整个工作区备份，避免丢失费用和原图关联。');
    if ([brand?.logoArtifactId, ...(brand?.approvedSampleIds || [])].filter(Boolean).some(id => !files.has(id))) throw Error('制作单“' + order.name + '”的品牌素材来自其它项目，请包含素材项目或按整个工作区备份。');
    if (order.status === 'running') throw Error('请等待当前业务制作结束或暂停后再备份。');
  }
  const keptOrders = new Set(orders.map(row => row.id)), keptBrands = new Set(orders.map(row => row.brandId).filter(Boolean));
  state.orders = orders;
  state.products = state.products.filter(row => selected.has(row.projectId));
  state.brands = state.brands.filter(row => keptBrands.has(row.id) || selected.has(row.projectId)).map(row => ({ ...row, approvedSampleIds: row.approvedSampleIds.filter(id => files.has(id)) }));
  state.feedback = state.feedback.filter(row => keptOrders.has(row.orderId));
  state.transactions = state.transactions.filter(row => keptOrders.has(row.orderId));
  state.metrics = state.metrics.filter(row => keptOrders.has(row.orderId));
  return core.checkedBusinessState(state);
}
function businessAfterRestore(value, runs = []) {
  const state = core.checkedBusinessState(value);
  for (const order of state.orders) {
    if (order.status !== 'archived') order.status = 'paused';
    order.error = '从备份恢复，旧交付和费用已保留；请核对来源、模型和Key后明确继续，未自动重发。';
    delete order.preparedHash;
    for (const task of order.tasks) {
      if (task.submittedAt && !task.runId && task.dispatchKey) {
        const known = runs.find(run => run.dispatchKey === task.dispatchKey && run.projectId === (task.projectId || order.sourceProjectId));
        if (known) { task.runId = known.id; order.runIds = [...new Set([...order.runIds, known.id])]; }
      }
      delete task.dispatchKey; if (task.runId) delete task.submittedAt; delete task.inputHash;
      if (['pending', 'running'].includes(task.status)) { task.status = 'stale'; task.error = '备份恢复后未自动执行，请检查已提交的模型运行。'; }
    }
  }
  return core.checkedBusinessState(state);
}
function remapBusinessAssistMarkers(input, ids) {
  const records = structuredClone(input);
  for (const record of records) {
    if (record.run?.purpose !== 'business-assist' || typeof record.run.snapshot?.description !== 'string') continue;
    const original = record.run.snapshot.description; let marker;
    try { marker = JSON.parse(original); } catch { continue; }
    if (!marker || marker.type !== 'xuzuo-business-assist' || !core.businessId(marker.workspaceId) || !core.businessId(marker.orderId) || !['listing', 'feedback', 'performance', 'intake'].includes(marker.purpose) || !core.businessId(marker.requestId)) continue;
    marker.workspaceId = Object.hasOwn(ids, marker.workspaceId) ? ids[marker.workspaceId] : marker.workspaceId;
    marker.orderId = Object.hasOwn(ids, marker.orderId) ? ids[marker.orderId] : marker.orderId;
    const serialized = JSON.stringify(marker), workflowId = 'bizassist-' + createHash('sha256').update(marker.orderId).digest('hex').slice(0, 24) + '-' + marker.requestId;
    record.run.workflowId = workflowId; record.run.snapshot.id = workflowId; record.run.snapshot.description = serialized;
    if (record.request?.workflow?.description === original) { record.request.workflow.id = workflowId; record.request.workflow.description = serialized; }
  }
  return records;
}
module.exports = { isBusinessPath, isBusinessStatePath, validateBusinessBackup, businessForSelection, businessAfterRestore, remapBusinessAssistMarkers };
