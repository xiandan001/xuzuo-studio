const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { parseBatchImport } = require('./batch-import.cjs');
const { checkedFile } = require('./workspace-paths.cjs');
const { createOperationTracker } = require('./queue-lifecycle.cjs');
const { createBeadMarketExport } = require('./bead-market-export.cjs');
const core = require('./bead-market.runtime.cjs');
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
function createBeadMarketData({ store, artifactStore, readDocument, dialog, getWindow = () => undefined, loadModule = require, fileSystem = fsDefault, clock = () => Date.now() }) {
  const fs = fileSystem, tracker = createOperationTracker(), previews = new Map(); let closing = false;
  const track = action => closing ? Promise.reject(Error('材料采购正在保存并退出。')) : tracker.track(action);
  async function evidenceMetadata(ids) {
    if (!ids.length) return new Map();
    try { return new Map((await artifactStore.list(ids)).map(file => [file.id, file])); }
    catch {
      const files = [];
      for (let at = 0; at < ids.length; at += 8) { const batch = await Promise.allSettled(ids.slice(at, at + 8).map(id => artifactStore.list([id]))); for (const result of batch) if (result.status === 'fulfilled') files.push(...result.value); }
      return new Map(files.map(file => [file.id, file]));
    }
  }
  async function snapshot(projectId) {
    const state = await store.read(projectId), document = await readDocument(projectId), ids = [...new Set(state.offers.map(offer => offer.evidence.artifactId).filter(Boolean))], metadata = await evidenceMetadata(ids), missing = new Set();
    const effective = { ...state, offers: state.offers.map(offer => { const id = offer.evidence.artifactId, file = id && metadata.get(id); if (id && (!file || file.projectId !== projectId || file.trashedAt || file.unavailable)) { missing.add(offer.id); return { ...offer, verification: 'candidate' }; } return offer; }) };
    const comparison = core.beadMarketComparison(effective, document, clock());
    comparison.prices = comparison.prices.map(price => missing.has(price.offerId) ? { ...price, reasons: ['原始截图或报价表证据已不可读取，请恢复或重新导入。', ...price.reasons] } : price);
    return { ...comparison, state };
  }
  async function createPreview(input) {
    if (!input || !core.beadMarketId(input.projectId) || !['table', 'image', 'links'].includes(input.source) || !Array.isArray(input.offers) || input.offers.length > 500 || input.rawText !== undefined && (typeof input.rawText !== 'string' || input.rawText.length > 20000)) throw Error('报价预览内容无效或超过500行。');
    const current = await snapshot(input.projectId), token = randomUUID(); let evidence;
    if (input.artifactId) { const file = await artifactStore.read(input.artifactId); if (file.projectId !== input.projectId || file.trashedAt || file.unavailable || input.source === 'image' && !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || file.buffer.length > (input.source === 'image' ? 32 : 8) * 1024 * 1024) throw Error('报价证据文件不属于当前项目或格式/容量不支持。'); evidence = { artifactId: file.id, sha256: hash(file.buffer) }; }
    const offers = input.offers.map(offer => core.checkedBeadMarketOffer({ ...offer, verification: 'candidate', conditionsAccepted: false, reviewedAt: undefined, evidence: { ...offer.evidence, kind: input.source === 'links' ? 'link' : input.source, ...evidence } }));
    if (new Set(offers.map(offer => offer.id)).size !== offers.length) throw Error('导入报价编号重复，请重新预览。');
    for (const [id, preview] of previews) if (preview.expires <= clock()) previews.delete(id); if (previews.size >= 16) previews.delete(previews.keys().next().value);
    const result = { token, source: input.source, ...(input.artifactId ? { artifactId: input.artifactId } : {}), offers, issues: input.issues || [], warnings: input.warnings || [], ...(input.rawText ? { rawText: input.rawText } : {}) };
    previews.set(token, { projectId: input.projectId, fingerprint: current.demand?.fingerprint, spec: JSON.stringify(current.state.spec), offers, expires: clock() + 15 * 60 * 1000 }); return result;
  }
  async function importFile(input) {
    if (!input || !['table', 'image'].includes(input.kind)) throw Error('请选择报价表或截图。');
    const current = await snapshot(input.projectId), image = input.kind === 'image', chosen = await dialog.showOpenDialog(getWindow(), { title: image ? '导入商品报价截图' : '导入材料报价表', properties: ['openFile'], filters: [{ name: image ? 'PNG/JPEG/WebP截图' : 'CSV UTF-8或Excel报价表', extensions: image ? ['png', 'jpg', 'jpeg', 'webp'] : ['csv', 'xlsx'] }] });
    if (chosen.canceled || !chosen.filePaths?.length) return undefined;
    const filename = chosen.filePaths[0]; if (!path.isAbsolute(filename)) throw Error('请选择本机报价文件。'); const before = await checkedFile(fs, filename); if (!before.size || before.size > (image ? 32 : 8) * 1024 * 1024) throw Error(image ? '截图最多32MB，请压缩后导入。' : '报价表最多8MB、500行。');
    const buffer = await fs.readFile(filename), after = await checkedFile(fs, filename); if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || buffer.length !== before.size) throw Error('文件读取期间已变化，请重新选择。');
    let table; if (!image) table = await parseBatchImport({ name: filename, buffer }, loadModule); else { const actual = require('./image-output-formats.cjs').imageType(buffer); if (!['image/png', 'image/jpeg', 'image/webp'].includes(actual.mimeType)) throw Error('截图必须是实际PNG、JPEG或WebP静态图片。'); }
    const extension = path.extname(filename).toLowerCase(), mimeType = image ? require('./image-output-formats.cjs').imageType(buffer).mimeType : extension === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', artifact = await artifactStore.write({ projectId: input.projectId, name: path.basename(filename), mimeType, buffer, preserveOriginalName: true });
    if (image) return createPreview({ projectId: input.projectId, source: 'image', artifactId: artifact.id, offers: [], warnings: ['截图已保留在当前项目；选择视觉模型识读后，仍需核对具体规格与价格。'] });
    const normalized = core.normalizeBeadMarketRows(table.rows, { projectId: input.projectId, spec: current.state.spec, artifactId: artifact.id, now: new Date(clock()).toISOString(), idFactory: randomUUID });
    return createPreview({ projectId: input.projectId, source: 'table', artifactId: artifact.id, ...normalized, warnings: [...table.warnings, ...normalized.warnings] });
  }
  async function commitImport(input) {
    const preview = previews.get(input?.token); if (!preview || preview.projectId !== input.projectId || preview.expires <= clock()) throw Error('报价预览已过期或不属于当前项目，请重新导入。');
    if (!Array.isArray(input.offers) || !input.offers.length || input.offers.length > preview.offers.length) throw Error('请至少保留一条要核对保存的报价。');
    const current = await snapshot(input.projectId); if (current.demand?.fingerprint !== preview.fingerprint || JSON.stringify(current.state.spec) !== preview.spec) throw Object.assign(Error('图纸、珠径或需求已改变，请重新导入当前采购表。'), { code: 'BEAD_MARKET_DEMAND_CHANGED' });
    const original = new Map(preview.offers.map(offer => [offer.id, offer]));
    const offers = input.offers.map(value => { const prior = original.get(value.id); if (!prior || JSON.stringify(value.evidence) !== JSON.stringify(prior.evidence)) throw Error('导入报价的原始证据不能替换，请重新采集来源。'); return core.checkedBeadMarketOffer({ ...value, verification: 'reviewed', reviewedAt: new Date(clock()).toISOString(), evidence: prior.evidence }); });
    if (new Set(offers.map(offer => offer.id)).size !== offers.length) throw Error('导入报价编号重复。');
    const state = { ...current.state, offers: [...current.state.offers.filter(offer => !offers.some(next => next.id === offer.id)), ...offers] };
    await store.save({ projectId: input.projectId, expectedRevision: input.expectedRevision, state }); previews.delete(input.token); return snapshot(input.projectId);
  }
  async function exportFile(input) {
    const current = await snapshot(input.projectId), document = await readDocument(input.projectId), result = await createBeadMarketExport({ snapshot: current, format: input.format, title: document?.title }, loadModule), latest = await snapshot(input.projectId);
    if (latest.state.revision !== current.state.revision || latest.demand?.fingerprint !== current.demand?.fingerprint) throw Error('导出期间图纸或报价已变化，请按最新资料重新导出；未覆盖旧文件。');
    const artifact = await artifactStore.write({ projectId: input.projectId, name: `${document?.title || '拼豆'}-材料比价采购清单.${result.extension}`, mimeType: result.mimeType, buffer: result.buffer }); return { artifact };
  }
  return { read: input => track(() => snapshot(input.projectId)), save: input => track(async () => { await store.save(input); return snapshot(input.projectId); }), createPreview: input => track(() => createPreview(input)), importFile: input => track(() => importFile(input)), commitImport: input => track(() => commitImport(input)), export: input => track(() => exportFile(input)), async drain() { await tracker.drain(); await store.drain(); }, async shutdown() { closing = true; await tracker.drain(); await store.drain(); previews.clear(); }, store };
}
module.exports = { createBeadMarketData };
