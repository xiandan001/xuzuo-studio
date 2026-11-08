const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const select = (value, keys) => value && Object.fromEntries(keys.map(key => [key, value[key]]));
const brandFields = ['name', 'projectId', 'logoArtifactId', 'colors', 'font', 'voice', 'forbiddenClaims', 'approvedSampleIds'];
const productFields = ['sku', 'name', 'projectId', 'referenceArtifactIds', 'facts'];
const orderFields = ['name', 'recipe', 'sourceProjectId', 'brandId', 'brief', 'productIds', 'facts', 'outputKinds', 'imageCount', 'sizes', 'bindings', 'referenceArtifactIds'];
function invalidateBusinessInputs(before, next) {
  const oldBrands = new Map(before.brands.map(row => [row.id, row])), oldProducts = new Map(before.products.map(row => [row.id, row]));
  const changedBrands = new Set(next.brands.filter(row => stable(select(row, brandFields)) !== stable(select(oldBrands.get(row.id), brandFields))).map(row => row.id));
  const changedProducts = new Set(next.products.filter(row => stable(select(row, productFields)) !== stable(select(oldProducts.get(row.id), productFields))).map(row => row.id));
  const oldOrders = new Map(before.orders.map(row => [row.id, row]));
  for (const order of next.orders) {
    const old = oldOrders.get(order.id); if (!old) continue;
    const changed = stable(select(old, orderFields)) !== stable(select(order, orderFields)) || changedBrands.has(order.brandId) || order.productIds.some(id => changedProducts.has(id));
    if (!changed) continue;
    if (old.status === 'running' || old.tasks.some(task => task.status === 'running')) throw Error('制作单“' + old.name + '”仍有正在执行的步骤，请暂停并等待已提交步骤结束后再修改资料。');
    order.factsRevision = old.factsRevision + 1;
    delete order.preparedHash; delete order.factsConfirmedAt;
    if (order.status !== 'archived') order.status = 'draft';
    order.error = '制作资料已更新，请确认资料并重新准备；旧产物和已发生费用保留。';
  }
  return next;
}
module.exports = { invalidateBusinessInputs };
