const core = require('./bead-market.runtime.cjs');
const isBeadMarketPath = relative => /(?:^|\/)\.xuzuo\/bead-market(?:-marker)?-v1\.json$/.test(relative);
function validateBeadMarketBackup(value, relative, projectId) {
  if (!isBeadMarketPath(relative)) return false;
  if (relative.endsWith('/bead-market-marker-v1.json')) { if (!value || value.version !== 1 || !core.beadMarketId(value.projectId) || projectId && value.projectId !== projectId) throw Error('材料报价保存标记不属于当前项目。'); }
  else core.checkedBeadMarketState(value, projectId);
  return true;
}
function beadMarketAfterRestore(input) {
  const state = core.checkedBeadMarketState(input);
  if (state.lastQuery) {
    state.lastQuery = { ...state.lastQuery, fingerprint: '', status: 'cancelled', finishedAt: new Date().toISOString(), sources: Object.fromEntries(Object.entries(state.lastQuery.sources).map(([key, source]) => [key, { ...source, status: 'cancelled', message: '报价来自备份，原采集时间保留；尚未重新查询平台。' }])) };
  }
  return core.checkedBeadMarketState(state);
}
function remapBeadMarketBackup(input, ids, relative) {
  if (!isBeadMarketPath(relative)) return input;
  const map = value => Object.hasOwn(ids, value) ? ids[value] : value;
  if (relative.endsWith('/bead-market-marker-v1.json')) return { version: 1, projectId: map(input.projectId) };
  const state = core.checkedBeadMarketState(input);
  state.projectId = map(state.projectId);
  state.spec.paletteId = map(state.spec.paletteId);
  state.offers = state.offers.map(offer => ({ ...offer, id: map(offer.id), evidence: { ...offer.evidence, ...(offer.evidence.artifactId ? { artifactId: map(offer.evidence.artifactId) } : {}) } }));
  state.selections = Object.fromEntries(Object.entries(state.selections).map(([code, id]) => [code, map(id)]));
  if (state.lastQuery) state.lastQuery.id = map(state.lastQuery.id);
  return beadMarketAfterRestore(state);
}
module.exports = { isBeadMarketPath, validateBeadMarketBackup, remapBeadMarketBackup, beadMarketAfterRestore };
