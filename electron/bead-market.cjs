const { randomUUID, createHash } = require('node:crypto');
const core = require('./bead-market.runtime.cjs');
const { createBeadMarketStore } = require('./bead-market-store.cjs');
const { createBeadMarketData } = require('./bead-market-data.cjs');
const { createBeadMarketSources, extractBeadMarketLinks } = require('./bead-market-sources.cjs');
const { createBeadMarketAI } = require('./bead-market-ai.cjs');
const { beadMarketAIRows } = require('./bead-market-ai-rows.cjs');
const platforms = ['1688', 'taobao', 'pdd'];
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const stamp = () => new Date().toISOString();

function createBeadMarket(options) {
  const { readDocument, onChanged, artifactStore, assertAdmission = async () => undefined } = options;
  const store = options.store || createBeadMarketStore({ ...options, onChanged }), data = options.data || createBeadMarketData({ ...options, store });
  const sources = options.sources || createBeadMarketSources(options), ai = options.ai || createBeadMarketAI(options);
  const jobs = new Map(), starts = new Map(), captureTasks = new Map(), completedCaptures = new Set(), cancelEpochs = new Map(), writeFailures = new Map(), pending = new Set(), owners = new Map(); let browser = options.browser, closing = false, quiescing = false;
  async function scope(projectId) { const location = (await options.workspaceStorage.list()).projects.find(row => row.projectId === projectId); if (!location) throw Error('拼豆项目尚未登记到本地工作区。'); owners.set(projectId, location.workspaceId); return location; }
  function ready(projectId) { if (closing || quiescing) throw Object.assign(Error('材料比价正在保存并退出，未开始新查询。'), { name: 'AbortError' }); if (!validId(projectId)) throw Error('请选择当前拼豆项目。'); }
  const track = task => { pending.add(task); void task.finally(() => pending.delete(task)).catch(() => undefined); return task; };
  async function mutate(projectId, transform) {
    try { const result = await store.mutate(projectId, transform); writeFailures.delete(projectId); return result; }
    catch (error) { if (['EIO', 'ENOSPC', 'EROFS', 'EACCES', 'EPERM', 'EBUSY', 'EMFILE', 'BEAD_MARKET_PERSISTENCE'].includes(error?.code)) writeFailures.set(projectId, error); throw error; }
  }
  function checkedResult(platform, result) {
    if (!result || result.platform !== platform || !['complete', 'needs-login', 'restricted', 'failed', 'cancelled'].includes(result.status) || typeof result.message !== 'string' || result.message.length > 2000 || !Array.isArray(result.offers) || result.offers.length > 150) throw Error('平台返回的商品来源或状态无效，未保存错误报价。');
    const offers = result.offers.map(offer => { const value = core.checkedBeadMarketOffer({ ...offer, verification: 'candidate', conditionsAccepted: false, reviewedAt: undefined }); if (value.platform !== platform) throw Error('商品链接与采集平台不一致，未保存。'); return value; });
    return { ...result, offers };
  }
  function appendOffers(state, offers) {
    const chosen = new Set(Object.values(state.selections)), fresh = [], signature = offer => JSON.stringify({ ...offer, id: '' });
    for (const value of offers) {
      if (state.offers.some(item => item.verification === 'candidate' && signature(item) === signature(value)) || fresh.some(item => signature(item) === signature(value))) continue;
      const next = { ...value }; if (state.offers.some(item => item.id === next.id) || fresh.some(item => item.id === next.id)) next.id = randomUUID(); fresh.push(next);
    }
    const all = [...state.offers, ...fresh];
    if (all.length > 1500) { const retained = all.filter(item => item.verification !== 'candidate' || chosen.has(item.id)); if (retained.length >= 1500) throw Error('已保存报价较多，请先移除不用的历史报价。'); const available = 1500 - retained.length; state.offers = [...retained, ...all.filter(item => !retained.includes(item)).slice(-available)]; } else state.offers = all;
    return state;
  }
  async function read(input) {
    const snapshot = await data.read(input);
    if (snapshot.state.lastQuery?.status === 'querying' && !jobs.has(input.projectId) && !starts.has(input.projectId)) { await mutate(input.projectId, state => { if (state.lastQuery?.status === 'querying' && !jobs.has(input.projectId)) { const failed = writeFailures.has(input.projectId); state.lastQuery.status = failed ? 'failed' : 'cancelled'; state.lastQuery.finishedAt = stamp(); for (const source of Object.values(state.lastQuery.sources)) if (source.status === 'querying') { source.status = failed ? 'failed' : 'cancelled'; source.message = failed ? '查询结果未能完整保存，已有报价保留；请检查目录后重试。' : '上次查询已中断，已有报价保留；需要时可重新查询。'; } } return state; }); return data.read(input); }
    return snapshot;
  }
  async function merge(projectId, offers, guard) {
    await mutate(projectId, async state => {
      const document = await readDocument(projectId); if (!document) throw Error('请先生成并保存图纸。'); const demand = core.beadMarketDemand(document, state.spec);
      if (guard && (!guard(state, demand) || demand.fingerprint !== guard.fingerprint)) return state;
      return appendOffers(state, offers);
    });
  }
  async function stopQuery(projectId) { const job = jobs.get(projectId); if (!job) return; job.controller.abort(); await job.initialized; await Promise.allSettled([job.task]); }
  async function capture(input) {
    const { projectId, platform } = input || {}; ready(projectId);
    if (!platforms.includes(platform)) return Promise.reject(Error('请选择正确的采集平台。'));
    const result = checkedResult(platform, input.result), key = createHash('sha256').update(JSON.stringify([projectId, platform, result])).digest('hex');
    if (completedCaptures.has(key)) return data.read({ projectId }); if (captureTasks.has(key)) return captureTasks.get(key).task;
    if (!browser?.isProjectBusy(projectId)) return Promise.reject(Error('请在当前项目对应的平台窗口采集。'));
    const task = track((async () => {
      await scope(projectId); if (await assertAdmission(projectId) === false) throw Error('项目目录正在处理，未保存采集报价。');
      cancelEpochs.set(projectId, (cancelEpochs.get(projectId) || 0) + 1);
      await stopQuery(projectId);
      await Promise.allSettled([starts.get(projectId)]);
      await mutate(projectId, async state => {
        const document = await readDocument(projectId); if (!document) throw Error('请先生成并保存当前图纸。'); const demand = core.beadMarketDemand(document, state.spec);
        appendOffers(state, result.offers);
        state.lastQuery = { id: randomUUID(), fingerprint: demand.fingerprint, status: result.status, startedAt: result.capturedAt || stamp(), finishedAt: stamp(), platforms: [platform], codes: demand.rows.map(row => row.code), sources: { [platform]: { status: result.status, message: result.message, ...(result.searchUrl ? { searchUrl: result.searchUrl } : {}), updatedAt: result.capturedAt || stamp(), count: result.offers.length } } };
        return state;
      });
      completedCaptures.add(key); if (completedCaptures.size > 64) completedCaptures.delete(completedCaptures.values().next().value);
      return data.read({ projectId });
    })().finally(() => captureTasks.delete(key)));
    captureTasks.set(key, { projectId, task }); return task;
  }
  async function query(input, links, epoch) {
    ready(input?.projectId); await scope(input.projectId); if (await assertAdmission(input.projectId) === false) throw Error('项目目录正在处理，请稍后查询。');
    const snapshot = await data.read({ projectId: input.projectId }), demand = snapshot.demand;
    if (!demand) throw Error('请先生成并保存图纸，再计算缺料。'); if (!demand.spec.diameterMm) throw Error('先选择豆子珠径，例如2.6mm或5mm。'); if (!demand.rows.length) throw Error('当前库存已覆盖所有颜色，无需查询采购。');
    const selected = input.platforms || platforms; if (!Array.isArray(selected) || !selected.length || selected.length > 3 || selected.some(platform => !platforms.includes(platform)) || new Set(selected).size !== selected.length) throw Error('请选择有效查询平台。');
    const codes = input.codes || demand.rows.map(row => row.code); if (!Array.isArray(codes) || !codes.length || codes.length > 512 || codes.some(code => !demand.rows.some(row => row.code === code))) throw Error('查询色号不属于当前缺料清单。');
    if ((cancelEpochs.get(input.projectId) || 0) !== epoch) throw Object.assign(Error('材料查询已取消，未开始新请求。'), { name: 'AbortError' });
    const existing = jobs.get(input.projectId), key = JSON.stringify([demand.fingerprint, selected, codes, links || []]); if (existing?.key === key) return { jobId: existing.id }; if (existing) await stopQuery(input.projectId);
    const last = snapshot.state.lastQuery;
    const cacheAge = Date.now() - Date.parse(last?.finishedAt || ''), expired = last && snapshot.state.offers.some(offer => selected.includes(offer.platform) && Date.parse(offer.evidence.capturedAt) >= Date.parse(last.startedAt) && offer.evidence.expiresAt && Date.parse(offer.evidence.expiresAt) <= Date.now());
    if (!links && !input.force && !writeFailures.has(input.projectId) && !expired && last?.status === 'complete' && selected.every(platform => last.sources[platform]?.status === 'complete') && last.fingerprint === demand.fingerprint && JSON.stringify(last.platforms) === JSON.stringify(selected) && JSON.stringify(last.codes) === JSON.stringify(codes) && cacheAge >= 0 && cacheAge < 30 * 60 * 1000) return { jobId: last.id };
    let initialized; const job = { id: randomUUID(), key, controller: new AbortController(), fingerprint: demand.fingerprint, task: undefined, initialized: new Promise(resolve => { initialized = resolve; }) }; jobs.set(input.projectId, job);
    try { await mutate(input.projectId, async state => { const document = await readDocument(input.projectId); if ((cancelEpochs.get(input.projectId) || 0) !== epoch || !document || core.beadMarketDemand(document, state.spec).fingerprint !== demand.fingerprint) throw Object.assign(Error('图纸或查询已变化，未开始新平台请求。'), { code: 'BEAD_MARKET_DEMAND_CHANGED' }); state.lastQuery = { id: job.id, fingerprint: demand.fingerprint, status: 'querying', startedAt: stamp(), platforms: [...selected], codes: [...codes], sources: Object.fromEntries(selected.map(platform => [platform, { status: 'querying', message: links ? '正在解析真实商品链接…' : '正在查询缺料商品…', updatedAt: stamp(), count: 0 }])) }; return state; }); }
    catch (error) { if (jobs.get(input.projectId) === job) jobs.delete(input.projectId); initialized(); throw error; }
    const guard = (state, current) => jobs.get(input.projectId) === job && !job.controller.signal.aborted && state.lastQuery?.id === job.id && current.fingerprint === job.fingerprint; guard.fingerprint = job.fingerprint;
    async function receive(platform, operation) {
      if (job.controller.signal.aborted) return;
      try { const result = checkedResult(platform, await operation()); if (job.controller.signal.aborted || jobs.get(input.projectId) !== job) return; await merge(input.projectId, result.offers, guard); await mutate(input.projectId, async state => { const document = await readDocument(input.projectId); if (document && guard(state, core.beadMarketDemand(document, state.spec))) state.lastQuery.sources[platform] = { status: result.status, message: result.message, ...(result.searchUrl ? { searchUrl: result.searchUrl } : {}), updatedAt: result.capturedAt || stamp(), count: result.offers.length }; return state; }); }
      catch (error) { if (job.controller.signal.aborted || jobs.get(input.projectId) !== job) return; await mutate(input.projectId, state => { if (state.lastQuery?.id === job.id) state.lastQuery.sources[platform] = { status: 'failed', message: String(error.message || '平台查询未完成，已有报价保留。').slice(0, 1900), updatedAt: stamp(), count: 0 }; return state; }); }
    }
    job.task = track((async () => {
      if (links) { for (const url of links) { if (job.controller.signal.aborted) break; const platform = require('./bead-market-sources-url.cjs').platformForUrl(url); await receive(platform, () => sources.details({ url, signal: job.controller.signal })); } }
      else await Promise.all(selected.map(platform => receive(platform, () => sources.search({ platform, spec: demand.spec, codes, signal: job.controller.signal }))));
      await mutate(input.projectId, async state => { if (state.lastQuery?.id !== job.id) return state; const document = await readDocument(input.projectId), current = document && core.beadMarketDemand(document, state.spec), statuses = Object.values(state.lastQuery.sources).map(row => row.status); state.lastQuery.status = job.controller.signal.aborted || current?.fingerprint !== job.fingerprint ? 'cancelled' : statuses.every(status => status === 'complete') ? 'complete' : statuses.some(status => status === 'needs-login') ? 'needs-login' : statuses.some(status => status === 'restricted') ? 'restricted' : 'failed'; state.lastQuery.finishedAt = stamp(); for (const source of Object.values(state.lastQuery.sources)) if (source.status === 'querying') { source.status = 'cancelled'; source.message = '资料或查询已变化，已有报价保留；可按当前缺料重新查询。'; } return state; });
    })().catch(error => { if (error?.name !== 'AbortError') writeFailures.set(input.projectId, error); throw error; }).finally(() => { if (jobs.get(input.projectId) === job) jobs.delete(input.projectId); }));
    initialized(); return { jobId: job.id };
  }
  function startQuery(input, links) {
    const projectId = input?.projectId, epoch = cancelEpochs.get(projectId) || 0, previous = starts.get(projectId), task = track((previous || Promise.resolve()).then(() => query(input, links, epoch)).finally(() => { if (starts.get(projectId) === task) starts.delete(projectId); }));
    starts.set(projectId, task); return task;
  }
  async function cancel(input) { if (!validId(input?.projectId)) throw Error('项目编号无效。'); const projectId = input.projectId; cancelEpochs.set(projectId, (cancelEpochs.get(projectId) || 0) + 1); await stopQuery(projectId); await Promise.allSettled([starts.get(projectId)]); await ai.cancel(input); }
  const api = {
    read, save: input => { ready(input?.projectId); return track(data.save(input).then(result => { writeFailures.delete(input.projectId); return result; })); }, query: input => startQuery(input),
    importLinks: input => { const links = extractBeadMarketLinks(input?.text); if (!links.length) return Promise.reject(Error('请粘贴真实商品链接。')); const selected = [...new Set(links.map(url => require('./bead-market-sources-url.cjs').platformForUrl(url)))]; return startQuery({ ...input, platforms: selected, force: true }, links); },
    cancel,
    openSource(input) { ready(input?.projectId); return track((async () => { await scope(input.projectId); if (!platforms.includes(input.platform) || !browser) throw Error('平台浏览窗口尚未连接。'); const snapshot = await data.read({ projectId: input.projectId }), offer = input.offerId && snapshot.state.offers.find(row => row.id === input.offerId && row.platform === input.platform); if (input.offerId && !offer) throw Error('商品不属于本项目或所选平台。'); ready(input.projectId); return browser.open({ projectId: input.projectId, platform: input.platform, ...(offer?.url ? { url: offer.url } : {}), spec: snapshot.state.spec, codes: snapshot.demand?.rows.map(row => row.code) || [] }); })()); },
    captureSource(input) { ready(input?.projectId); return track((async () => { await scope(input.projectId); if (!platforms.includes(input.platform) || !browser?.capture) throw Error('请先打开对应的平台窗口。'); ready(input.projectId); const result = await browser.capture(input); return capture({ ...input, result }); })()); },
    importFile: input => { ready(input?.projectId); return track(data.importFile(input)); }, commitImport: input => { ready(input?.projectId); return track(data.commitImport(input).then(result => { writeFailures.delete(input.projectId); return result; })); }, export: input => { ready(input?.projectId); return track(data.export(input)); },
    extractImage(input) { ready(input?.projectId); return track((async () => { await scope(input.projectId); if (input.platform !== undefined && !platforms.includes(input.platform)) throw Error('请选择截图的实际来源平台。'); const snapshot = await data.read({ projectId: input.projectId }); ready(input.projectId); const result = await ai.extract(input), current = await data.read({ projectId: input.projectId }); if (snapshot.demand?.fingerprint !== current.demand?.fingerprint) throw Error('识读期间图纸或采购规格已改变，结果与费用保留在任务中心；可再次读取已完成结果，不会重复收费。'); return data.createPreview(beadMarketAIRows(result, { core, projectId: input.projectId, spec: current.state.spec, artifactId: input.artifactId, platform: input.platform })); })()); },
    acceptCapture: capture, setBrowser: value => { browser = value; },
    isProjectBusy: projectId => Boolean(jobs.has(projectId) || starts.has(projectId) || [...captureTasks.values()].some(row => row.projectId === projectId) || ai.isProjectBusy(projectId) || browser?.isProjectBusy(projectId)),
    isWorkspaceBusy: workspaceId => [...owners].some(([projectId, owner]) => owner === workspaceId && api.isProjectBusy(projectId)),
    async drain() { while (pending.size) await Promise.allSettled([...pending]); await Promise.all([ai.drain(), browser?.drain(), sources.drain(), data.drain()]); if (writeFailures.size) throw Error('材料查询结果尚未完整保存，请检查项目目录后重试；已有报价保留。'); },
    async prepareClose() { quiescing = true; try { for (const projectId of new Set([...starts.keys(), ...jobs.keys()])) cancelEpochs.set(projectId, (cancelEpochs.get(projectId) || 0) + 1); for (const job of jobs.values()) job.controller.abort(); await ai.prepareClose(); await browser?.prepareClose(); await sources.prepareClose(); await api.drain(); } finally { quiescing = false; } },
    async shutdown() { closing = true; for (const projectId of new Set([...starts.keys(), ...jobs.keys()])) cancelEpochs.set(projectId, (cancelEpochs.get(projectId) || 0) + 1); for (const job of jobs.values()) job.controller.abort(); await ai.shutdown(); await browser?.shutdown(); await sources.shutdown(); try { await api.drain(); } finally { await data.shutdown(); } },
    store,
  }; return api;
}
module.exports = { createBeadMarket };
