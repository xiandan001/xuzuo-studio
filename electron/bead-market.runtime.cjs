// Generated from shared bead market helpers; run scripts/build-bead-market-runtime.mjs.
'use strict';
const factories = {
"./bead-market": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beadMarketMoneyCents = exports.normalizeBeadMarketRows = exports.beadMarketComparison = exports.beadMarketCart = exports.beadMarketOfferPrice = exports.beadMarketDemand = exports.beadMarketSpecForDocument = exports.newBeadMarketState = exports.checkedBeadMarketState = exports.checkedBeadMarketOffer = exports.checkedBeadMaterialSpec = exports.beadMarketPlatformUrl = exports.beadMarketDiameter = exports.beadMarketNormalized = exports.beadMarketId = exports.BEAD_MARKET_STATE_BYTES = void 0;
var bead_market_validation_1 = require("./bead-market-validation");
Object.defineProperty(exports, "BEAD_MARKET_STATE_BYTES", { enumerable: true, get: function () { return bead_market_validation_1.BEAD_MARKET_STATE_BYTES; } });
Object.defineProperty(exports, "beadMarketId", { enumerable: true, get: function () { return bead_market_validation_1.beadMarketId; } });
Object.defineProperty(exports, "beadMarketNormalized", { enumerable: true, get: function () { return bead_market_validation_1.beadMarketNormalized; } });
Object.defineProperty(exports, "beadMarketDiameter", { enumerable: true, get: function () { return bead_market_validation_1.beadMarketDiameter; } });
Object.defineProperty(exports, "beadMarketPlatformUrl", { enumerable: true, get: function () { return bead_market_validation_1.beadMarketPlatformUrl; } });
Object.defineProperty(exports, "checkedBeadMaterialSpec", { enumerable: true, get: function () { return bead_market_validation_1.checkedBeadMaterialSpec; } });
Object.defineProperty(exports, "checkedBeadMarketOffer", { enumerable: true, get: function () { return bead_market_validation_1.checkedBeadMarketOffer; } });
Object.defineProperty(exports, "checkedBeadMarketState", { enumerable: true, get: function () { return bead_market_validation_1.checkedBeadMarketState; } });
var bead_market_pricing_1 = require("./bead-market-pricing");
Object.defineProperty(exports, "newBeadMarketState", { enumerable: true, get: function () { return bead_market_pricing_1.newBeadMarketState; } });
Object.defineProperty(exports, "beadMarketSpecForDocument", { enumerable: true, get: function () { return bead_market_pricing_1.beadMarketSpecForDocument; } });
Object.defineProperty(exports, "beadMarketDemand", { enumerable: true, get: function () { return bead_market_pricing_1.beadMarketDemand; } });
Object.defineProperty(exports, "beadMarketOfferPrice", { enumerable: true, get: function () { return bead_market_pricing_1.beadMarketOfferPrice; } });
Object.defineProperty(exports, "beadMarketCart", { enumerable: true, get: function () { return bead_market_pricing_1.beadMarketCart; } });
Object.defineProperty(exports, "beadMarketComparison", { enumerable: true, get: function () { return bead_market_pricing_1.beadMarketComparison; } });
var bead_market_import_1 = require("./bead-market-import");
Object.defineProperty(exports, "normalizeBeadMarketRows", { enumerable: true, get: function () { return bead_market_import_1.normalizeBeadMarketRows; } });
Object.defineProperty(exports, "beadMarketMoneyCents", { enumerable: true, get: function () { return bead_market_import_1.beadMarketMoneyCents; } });

},
"./bead-market-validation": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beadMarketNormalized = exports.beadMarketId = exports.BEAD_MARKET_STATE_BYTES = void 0;
exports.beadMarketDiameter = beadMarketDiameter;
exports.beadMarketPlatformUrl = beadMarketPlatformUrl;
exports.checkedBeadMaterialSpec = checkedBeadMaterialSpec;
exports.checkedBeadMarketOffer = checkedBeadMarketOffer;
exports.checkedBeadMarketState = checkedBeadMarketState;
exports.BEAD_MARKET_STATE_BYTES = 8 * 1024 * 1024;
const beadMarketId = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
exports.beadMarketId = beadMarketId;
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit, empty = true) => typeof value === 'string' && value.length <= limit && (empty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const integer = (value, min = 0, max = 1000000000) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const instant = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && /T/.test(value);
const beadMarketNormalized = (value) => value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[®™]/g, '').replace(/\s+/g, ' ');
exports.beadMarketNormalized = beadMarketNormalized;
function beadMarketDiameter(value) { const plain = value.normalize('NFKC').trim().replace(/\s*(?:mm|毫米)$/i, ''); return /^\d{1,2}(?:\.\d{1,3})?$/.test(plain) && Number(plain) > 0 && Number(plain) <= 20 ? String(Number(plain)) : ''; }
function beadMarketPlatformUrl(input, productOnly = true) {
    try {
        const url = new URL(input);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || input.length > 3000)
            return;
        const host = url.hostname.toLowerCase(), platform = host === '1688.com' || host.endsWith('.1688.com') ? '1688' : host === 'taobao.com' || host.endsWith('.taobao.com') || host === 'tmall.com' || host.endsWith('.tmall.com') ? 'taobao' : host === 'yangkeduo.com' || host.endsWith('.yangkeduo.com') || host === 'pinduoduo.com' || host.endsWith('.pinduoduo.com') ? 'pdd' : undefined;
        if (!platform)
            return;
        const product = platform === '1688' ? host === 'detail.1688.com' && /^\/offer\/\d+\.html?$/.test(url.pathname) : platform === 'taobao' ? ['item.taobao.com', 'detail.tmall.com', 'h5.m.taobao.com', 'item.m.taobao.com', 'detail.m.tmall.com'].includes(host) && /\/(?:item|detail)\.htm[l]?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('id') || '') : ['mobile.yangkeduo.com', 'mobile.pinduoduo.com'].includes(host) && /^\/(?:goods|goods1|goods2)\.html?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('goods_id') || '');
        if (productOnly && !product)
            return;
        url.hash = '';
        if (product) {
            const kept = new URLSearchParams();
            for (const name of ['id', 'goods_id', 'skuId', 'sku_id']) {
                const value = url.searchParams.get(name);
                if (value !== null)
                    kept.set(name, value);
            }
            url.search = kept.toString();
        }
        return { platform, url: url.href };
    }
    catch {
        return;
    }
}
function checkedBeadMaterialSpec(input) {
    if (!object(input) || !text(input.brand, 120) || !text(input.series, 120) || !text(input.diameterMm, 30) || input.diameterMm && !beadMarketDiameter(input.diameterMm) || !text(input.paletteId, 160) || !text(input.paletteVersion, 160) || typeof input.allowCompatible !== 'boolean')
        throw Error('请核对品牌、系列、珠径和当前色卡。');
    return { brand: input.brand.trim(), series: input.series.trim(), diameterMm: input.diameterMm ? beadMarketDiameter(input.diameterMm) : '', paletteId: input.paletteId, paletteVersion: input.paletteVersion, allowCompatible: input.allowCompatible };
}
function checkedBeadMarketOffer(input) {
    if (!object(input) || !(0, exports.beadMarketId)(input.id) || !['1688', 'taobao', 'pdd'].includes(String(input.platform)) || !text(input.url, 3000) || !text(input.title, 500) || !text(input.sellerId, 240) || !text(input.sellerName, 240) || !text(input.brand, 120) || !text(input.series, 120) || !text(input.diameterMm, 30) || input.diameterMm && !beadMarketDiameter(input.diameterMm) || !text(input.code, 40) || input.code && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(input.code) || !['solid', 'transparent', 'special'].includes(String(input.beadKind)))
        throw Error('报价商品或规格字段无效。');
    if (input.compatibleWith !== undefined && !text(input.compatibleWith, 120))
        throw Error('兼容色卡品牌无效。');
    const link = input.url ? beadMarketPlatformUrl(input.url) : undefined;
    if (input.url && (!link || link.platform !== input.platform))
        throw Error('请使用对应平台的真实商品详情链接，搜索页不是商品链接。');
    for (const field of ['packCount', 'priceCents'])
        if (input[field] !== undefined && !integer(input[field], 1))
            throw Error('每包粒数和商品金额需为正整数，金额以分保存。');
    for (const field of ['shippingCents', 'freeShippingAboveCents'])
        if (input[field] !== undefined && !integer(input[field]))
            throw Error('运费和满免门槛需为非负整数分，未知时留空。');
    if (!integer(input.minPacks, 1, 1000000) || !Array.isArray(input.tiers) || input.tiers.length > 30 || input.tiers.some(tier => !object(tier) || !integer(tier.minPacks, 1, 1000000) || !integer(tier.priceCents, 1)) || new Set(input.tiers.map(tier => tier.minPacks)).size !== input.tiers.length)
        throw Error('请核对起订包数与阶梯价。');
    if (input.packWeightGrams !== undefined && (!text(input.packWeightGrams, 30) || !/^\d+(?:\.\d{1,3})?$/.test(input.packWeightGrams) || Number(input.packWeightGrams) <= 0))
        throw Error('按重量包装请填写正数克数，不自动推算粒数。');
    if (!['regular', 'conditional', 'range', 'unknown'].includes(String(input.priceKind)) || !Array.isArray(input.conditions) || input.conditions.length > 20 || input.conditions.some(value => !text(value, 500, false)) || typeof input.conditionsAccepted !== 'boolean' || !['candidate', 'reviewed', 'page', 'api'].includes(String(input.verification)) || input.reviewedAt !== undefined && !instant(input.reviewedAt))
        throw Error('报价条件或核对状态无效。');
    const evidence = input.evidence;
    if (!object(evidence) || !['page', 'link', 'image', 'table', 'manual'].includes(String(evidence.kind)) || !instant(evidence.capturedAt) || evidence.expiresAt !== undefined && !instant(evidence.expiresAt) || evidence.artifactId !== undefined && !(0, exports.beadMarketId)(evidence.artifactId) || evidence.sha256 !== undefined && (typeof evidence.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)) || evidence.text !== undefined && !text(evidence.text, 20000) || evidence.url !== undefined && (!text(evidence.url, 3000) || !beadMarketPlatformUrl(evidence.url, false)))
        throw Error('报价证据与采集时间无效。');
    return { id: input.id, platform: input.platform, url: link?.url || '', title: input.title.trim(), sellerId: input.sellerId.trim(), sellerName: input.sellerName.trim(), brand: input.brand.trim(), ...(input.compatibleWith ? { compatibleWith: input.compatibleWith } : {}), series: input.series.trim(), diameterMm: input.diameterMm ? beadMarketDiameter(input.diameterMm) : '', code: input.code.toUpperCase(), beadKind: input.beadKind, ...(input.packCount !== undefined ? { packCount: input.packCount } : {}), ...(input.packWeightGrams ? { packWeightGrams: input.packWeightGrams } : {}), ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}), minPacks: input.minPacks, tiers: input.tiers.map(row => ({ minPacks: row.minPacks, priceCents: row.priceCents })).sort((a, b) => a.minPacks - b.minPacks), ...(input.shippingCents !== undefined ? { shippingCents: input.shippingCents } : {}), ...(input.freeShippingAboveCents !== undefined ? { freeShippingAboveCents: input.freeShippingAboveCents } : {}), priceKind: input.priceKind, conditions: [...input.conditions], conditionsAccepted: input.conditionsAccepted, verification: input.verification, ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}), evidence: { kind: evidence.kind, capturedAt: evidence.capturedAt, ...(evidence.url ? { url: beadMarketPlatformUrl(evidence.url, false).url } : {}), ...(evidence.artifactId ? { artifactId: evidence.artifactId } : {}), ...(evidence.sha256 ? { sha256: evidence.sha256 } : {}), ...(evidence.text ? { text: evidence.text } : {}), ...(evidence.expiresAt ? { expiresAt: evidence.expiresAt } : {}) } };
}
function checkedBeadMarketState(input, projectId) {
    if (!object(input) || input.version !== 1 || !(0, exports.beadMarketId)(input.projectId) || projectId && input.projectId !== projectId || !integer(input.revision, 0) || !Array.isArray(input.offers) || input.offers.length > 1500 || !object(input.selections))
        throw Error('材料报价资料无效或不属于当前项目。');
    const offers = input.offers.map(checkedBeadMarketOffer), known = new Set(offers.map(row => row.id));
    if (known.size !== offers.length)
        throw Error('报价编号重复。');
    const selections = Object.entries(input.selections);
    if (selections.length > 512 || selections.some(([code, id]) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(code) || typeof id !== 'string' || !known.has(id)))
        throw Error('采购选择关联了无效色号或已移除报价。');
    const next = { version: 1, projectId: input.projectId, revision: input.revision, spec: checkedBeadMaterialSpec(input.spec), offers, selections: Object.fromEntries(selections) };
    if (input.lastQuery !== undefined) {
        const query = input.lastQuery;
        if (!object(query) || !(0, exports.beadMarketId)(query.id) || !text(query.fingerprint, 128000) || !['idle', 'querying', 'complete', 'needs-login', 'restricted', 'failed', 'cancelled'].includes(String(query.status)) || !instant(query.startedAt) || query.finishedAt !== undefined && !instant(query.finishedAt) || !Array.isArray(query.platforms) || query.platforms.length > 3 || query.platforms.some(p => !['1688', 'taobao', 'pdd'].includes(p)) || !Array.isArray(query.codes) || query.codes.length > 512 || query.codes.some(code => !text(code, 40, false)) || !object(query.sources))
            throw Error('材料查询状态无效。');
        for (const [platform, source] of Object.entries(query.sources))
            if (!['1688', 'taobao', 'pdd'].includes(platform) || !object(source) || !['idle', 'querying', 'complete', 'needs-login', 'restricted', 'failed', 'cancelled'].includes(String(source.status)) || !text(source.message, 2000) || !instant(source.updatedAt) || !integer(source.count, 0, 1500) || source.searchUrl !== undefined && (!text(source.searchUrl, 3000) || beadMarketPlatformUrl(source.searchUrl, false)?.platform !== platform))
                throw Error('平台来源状态无效。');
        next.lastQuery = structuredClone(query);
    }
    if (new TextEncoder().encode(JSON.stringify(next)).length > exports.BEAD_MARKET_STATE_BYTES)
        throw Error('材料报价资料超过8MB，请清理过期候选后再保存。');
    return next;
}

},
"./bead-market-pricing": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newBeadMarketState = newBeadMarketState;
exports.beadMarketSpecForDocument = beadMarketSpecForDocument;
exports.beadMarketDemand = beadMarketDemand;
exports.beadMarketOfferPrice = beadMarketOfferPrice;
exports.beadMarketCart = beadMarketCart;
exports.beadMarketComparison = beadMarketComparison;
const bead_procurement_1 = require("./bead-procurement");
const bead_validation_1 = require("./bead-validation");
const bead_market_validation_1 = require("./bead-market-validation");
const nowValue = (now) => typeof now === 'number' ? now : now ? Date.parse(now) : Date.now();
function newBeadMarketState(projectId, document) { return { version: 1, projectId, revision: 0, spec: { brand: document?.pattern.palette.brand || '', series: '', diameterMm: '', paletteId: document?.pattern.palette.id || '', paletteVersion: document?.pattern.palette.version || '', allowCompatible: false }, offers: [], selections: {} }; }
function beadMarketSpecForDocument(spec, document) { const palette = document.pattern.palette; return { ...spec, brand: palette.brand, series: (0, bead_market_validation_1.beadMarketNormalized)(spec.brand) === (0, bead_market_validation_1.beadMarketNormalized)(palette.brand) ? spec.series : '', paletteId: palette.id, paletteVersion: palette.version }; }
function beadMarketDemand(document, input) {
    const issue = (0, bead_validation_1.beadDocumentIssue)(document);
    if (issue)
        throw Error(issue);
    const spec = (0, bead_market_validation_1.checkedBeadMaterialSpec)(beadMarketSpecForDocument(input, document)), rows = (0, bead_procurement_1.beadUsage)(document.pattern, document.procurement).filter(row => row.shortage > 0);
    return { documentId: document.id, documentRevision: document.revision, spec, rows, fingerprint: JSON.stringify([document.id, document.revision, spec.brand, spec.series, spec.diameterMm, spec.paletteId, spec.paletteVersion, spec.allowCompatible, rows.map(row => [row.code, row.kind, row.shortage, row.packSize])]) };
}
function matchingIssues(offer, demand, row, now) {
    const issues = [], spec = demand.spec, brand = (0, bead_market_validation_1.beadMarketNormalized)(offer.brand), wanted = (0, bead_market_validation_1.beadMarketNormalized)(spec.brand);
    if (!row)
        issues.push('色号不在当前缺料清单');
    if (!wanted || brand !== wanted) {
        if (!(spec.allowCompatible && wanted && (0, bead_market_validation_1.beadMarketNormalized)(offer.compatibleWith || '') === wanted))
            issues.push('品牌不一致或尚未核实，兼容料需明确允许');
    }
    if (!(0, bead_market_validation_1.beadMarketDiameter)(spec.diameterMm))
        issues.push('请先选择豆子珠径');
    if (!offer.diameterMm || (0, bead_market_validation_1.beadMarketDiameter)(offer.diameterMm) !== (0, bead_market_validation_1.beadMarketDiameter)(spec.diameterMm))
        issues.push('豆子珠径不一致或未提供');
    if (spec.series && (0, bead_market_validation_1.beadMarketNormalized)(spec.series) !== (0, bead_market_validation_1.beadMarketNormalized)(offer.series))
        issues.push('系列不一致或未提供');
    if (row && offer.beadKind !== row.kind)
        issues.push('普通、透明或特殊珠种不一致');
    if (!offer.url)
        issues.push('缺少可打开的商品详情链接');
    if (!offer.packCount)
        issues.push(offer.packWeightGrams ? '按重量销售，缺少明确粒数，不能推算包数' : '缺少每包粒数');
    if (offer.verification === 'candidate')
        issues.push('候选报价尚未核对具体SKU');
    if (offer.verification === 'reviewed' && !offer.reviewedAt)
        issues.push('缺少人工核对时间');
    if (['image', 'table'].includes(offer.evidence.kind) && !offer.evidence.artifactId)
        issues.push('缺少原始截图或报价表证据');
    if (offer.priceKind === 'range' || offer.priceKind === 'unknown')
        issues.push('尚无所选规格的确定单价');
    if ((offer.priceKind === 'conditional' || offer.conditions.length > 0) && !offer.conditionsAccepted)
        issues.push('优惠或购买条件尚未确认可用');
    if (offer.priceCents === undefined && !offer.tiers.length)
        issues.push('缺少确定商品价格');
    const captured = Date.parse(offer.evidence.capturedAt), expires = offer.evidence.expiresAt ? Date.parse(offer.evidence.expiresAt) : captured + 24 * 60 * 60 * 1000;
    if (captured > now + 5 * 60 * 1000 || expires <= now || captured + 24 * 60 * 60 * 1000 <= now)
        issues.push('报价已过期或采集时间异常，请重新核对');
    return issues;
}
function beadMarketOfferPrice(input, demand, now) {
    const offer = (0, bead_market_validation_1.checkedBeadMarketOffer)(input), row = demand.rows.find(row => row.code.toUpperCase() === offer.code.toUpperCase()), reasons = matchingIssues(offer, demand, row, nowValue(now));
    const result = { offerId: offer.id, code: offer.code, eligible: false, reasons, warnings: [] };
    if (reasons.length || !row || !offer.packCount)
        return result;
    const packs = Math.max(Math.ceil(row.shortage / offer.packCount), offer.minPacks), tier = offer.tiers.filter(item => item.minPacks <= packs).at(-1), price = tier?.priceCents ?? offer.priceCents;
    if (price === undefined) {
        reasons.push('实际采购包数未达到任何已知价格档位');
        return result;
    }
    const materialCents = packs * price, beads = packs * offer.packCount;
    if (![packs, materialCents, beads].every(Number.isSafeInteger) || materialCents > 1000000000000) {
        reasons.push('采购数量或金额超过安全计算范围');
        return result;
    }
    const shippingCents = offer.freeShippingAboveCents !== undefined && materialCents >= offer.freeShippingAboveCents ? 0 : offer.shippingCents;
    Object.assign(result, { eligible: true, packs, beads, materialCents, perThousandCents: price * 1000 / offer.packCount, ...(shippingCents !== undefined ? { shippingCents, totalCents: materialCents + shippingCents } : {}) });
    if (shippingCents === undefined)
        result.warnings.push('运费未核实，只能比较材料小计');
    if ((0, bead_market_validation_1.beadMarketNormalized)(offer.brand) !== (0, bead_market_validation_1.beadMarketNormalized)(demand.spec.brand))
        result.warnings.push('兼容色卡材料，并非所选品牌正品');
    if (offer.priceKind === 'conditional')
        result.warnings.push('按已确认购买条件使用优惠价');
    return result;
}
const storeKey = (offer) => `${offer.platform}:${offer.sellerId ? 'id:' + offer.sellerId : 'unconfirmed:' + offer.id}`;
function quoteIssues(offers) {
    const groups = new Map(), issues = new Map();
    for (const offer of offers) {
        let identity = offer.id;
        if (offer.url) {
            const url = new URL(offer.url);
            identity = JSON.stringify([offer.platform, url.hostname, url.pathname, url.searchParams.get('id') || url.searchParams.get('goods_id'), url.searchParams.get('skuId') || url.searchParams.get('sku_id'), offer.sellerId, (0, bead_market_validation_1.beadMarketNormalized)(offer.brand), (0, bead_market_validation_1.beadMarketNormalized)(offer.compatibleWith || ''), (0, bead_market_validation_1.beadMarketNormalized)(offer.series), offer.diameterMm, offer.code, offer.beadKind, offer.packCount, offer.packWeightGrams, offer.priceKind, [...offer.conditions].sort()]);
        }
        groups.set(identity, [...(groups.get(identity) || []), offer]);
    }
    for (const group of groups.values()) {
        const latest = Math.max(...group.map(offer => Date.parse(offer.evidence.capturedAt))), current = group.filter(offer => Date.parse(offer.evidence.capturedAt) === latest), amounts = new Set(current.map(offer => JSON.stringify([offer.priceCents, offer.minPacks, offer.tiers, offer.shippingCents, offer.freeShippingAboveCents])));
        for (const offer of group)
            if (Date.parse(offer.evidence.capturedAt) < latest)
                issues.set(offer.id, '同一商品规格已有更新报价，请采用或核对新记录');
        if (amounts.size > 1)
            for (const offer of current)
                issues.set(offer.id, '同一商品规格在相同时间有冲突价格，请核实后移除错误报价');
    }
    return issues;
}
function buildCart(demand, offers, selections, now, cached) {
    const byId = new Map(offers.map(offer => [offer.id, offer])), rows = new Map(demand.rows.map(row => [row.code, row]));
    const lines = [], missingCodes = [];
    for (const code of rows.keys()) {
        const selected = byId.get(selections[code]), price = selected && (cached?.get(selected.id) || beadMarketOfferPrice(selected, demand, now));
        if (price?.eligible && selected?.code === code)
            lines.push(price);
        else
            missingCodes.push(code);
    }
    const groups = new Map();
    for (const line of lines) {
        const offer = byId.get(line.offerId);
        const key = storeKey(offer);
        groups.set(key, [...(groups.get(key) || []), offer]);
    }
    const warnings = [], stores = [];
    for (const [key, group] of groups) {
        const offerIds = group.map(offer => offer.id), materialCents = lines.filter(line => offerIds.includes(line.offerId)).reduce((sum, line) => sum + line.materialCents, 0), fees = new Set(group.map(offer => offer.shippingCents)), thresholds = new Set(group.map(offer => offer.freeShippingAboveCents));
        let shippingCents;
        if (group.length > 1 && !group[0].sellerId)
            warnings.push('店铺身份不明确，未自动跨商品合并运费');
        if (thresholds.size === 1 && group[0].freeShippingAboveCents !== undefined && materialCents >= group[0].freeShippingAboveCents)
            shippingCents = 0;
        else if (fees.size === 1 && group[0].shippingCents !== undefined)
            shippingCents = group[0].shippingCents;
        else
            warnings.push(`${group[0].sellerName || group[0].platform}运费缺失或不同报价不一致，需核实合单运费`);
        stores.push({ key, platform: group[0].platform, sellerName: group[0].sellerName || '店铺待核实', materialCents, ...(shippingCents !== undefined ? { shippingCents } : {}), offerIds });
    }
    const materialCents = lines.reduce((sum, line) => sum + line.materialCents, 0), shippingKnown = stores.every(store => store.shippingCents !== undefined), shippingCents = shippingKnown ? stores.reduce((sum, store) => sum + store.shippingCents, 0) : undefined;
    if (!Number.isSafeInteger(materialCents) || materialCents > 1000000000000)
        throw Error('整单金额超出安全计算范围。');
    if (missingCodes.length)
        warnings.push(`${missingCodes.length}个色号尚无可采用报价`);
    const complete = !missingCodes.length && shippingKnown;
    return { lines, materialCents, ...(shippingCents !== undefined ? { shippingCents } : {}), ...(complete ? { totalCents: materialCents + shippingCents } : {}), complete, missingCodes, warnings: [...new Set([...warnings, ...lines.flatMap(line => line.warnings)])], stores };
}
function pricedOffers(offers, demand, now) {
    const superseded = quoteIssues(offers);
    return offers.map(offer => { const price = beadMarketOfferPrice(offer, demand, now), reason = superseded.get(offer.id); return { offer, price: reason ? { ...price, eligible: false, reasons: [reason, ...price.reasons] } : price }; });
}
function plannedCart(demand, offers, priced, selections, strategy, now) {
    const eligible = priced.filter(item => item.price.eligible), automatic = {};
    const cached = new Map(priced.map(item => [item.offer.id, item.price]));
    const ranked = [...eligible].sort((a, b) => a.price.materialCents - b.price.materialCents || (a.price.shippingCents ?? Infinity) - (b.price.shippingCents ?? Infinity) || a.offer.id.localeCompare(b.offer.id));
    for (const row of demand.rows) {
        const best = ranked.find(item => item.offer.code === row.code);
        if (best)
            automatic[row.code] = best.offer.id;
    }
    if (strategy === 'material')
        return buildCart(demand, offers, { ...automatic, ...selections }, now, cached);
    const candidates = [automatic];
    const coverage = new Map();
    for (const item of eligible) {
        const key = storeKey(item.offer);
        if (!coverage.has(key))
            coverage.set(key, new Set());
        coverage.get(key).add(item.offer.code);
    }
    const relevantStores = [...coverage].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 24).map(([key]) => key);
    for (const key of relevantStores) {
        const next = { ...automatic };
        for (const row of demand.rows) {
            const preferred = ranked.find(item => item.offer.code === row.code && storeKey(item.offer) === key);
            if (preferred)
                next[row.code] = preferred.offer.id;
        }
        candidates.push(next);
    }
    const scored = candidates.map(candidate => buildCart(demand, offers, { ...candidate, ...selections }, now, cached));
    scored.sort((a, b) => a.missingCodes.length - b.missingCodes.length || a.stores.length - b.stores.length || Number(b.complete) - Number(a.complete) || (a.totalCents ?? a.materialCents) - (b.totalCents ?? b.materialCents));
    return scored[0];
}
function beadMarketCart(demand, offers, selections = {}, strategy = 'material', now) { return plannedCart(demand, offers, pricedOffers(offers, demand, now), selections, strategy, now); }
function beadMarketComparison(input, document, now) {
    const state = (0, bead_market_validation_1.checkedBeadMarketState)(input);
    if (!document)
        return { state, prices: [] };
    const demand = beadMarketDemand(document, state.spec), priced = pricedOffers(state.offers, demand, now), prices = priced.map(item => item.price), material = plannedCart(demand, state.offers, priced, {}, 'material', now);
    return { state, demand, prices, cart: Object.keys(state.selections).length ? plannedCart(demand, state.offers, priced, state.selections, 'material', now) : material, suggestions: { material, fewStores: plannedCart(demand, state.offers, priced, {}, 'few-stores', now) } };
}

},
"./bead-market-import": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beadMarketMoneyCents = beadMarketMoneyCents;
exports.normalizeBeadMarketRows = normalizeBeadMarketRows;
const bead_market_validation_1 = require("./bead-market-validation");
const aliases = {
    platform: ['平台', '来源平台', 'platform'], url: ['商品链接', '商品URL', '购买链接', '链接', 'url'], title: ['商品名称', '标题', '商品', 'title'], sellerId: ['店铺ID', '商家ID', 'sellerId'], sellerName: ['店铺', '店铺名称', '商家', 'sellerName'], brand: ['品牌', 'brand'], compatibleWith: ['兼容品牌', '兼容色卡', 'compatibleWith'], series: ['系列', 'series'], diameterMm: ['珠径', '豆子尺寸', '珠径mm', '尺寸', 'diameterMm'], code: ['色号', '颜色编号', 'code'], beadKind: ['珠种', '类型', '材质', 'beadKind'], packCount: ['每包粒数', '每袋粒数', '包装粒数', '粒数', 'packCount'], packWeightGrams: ['每包克数', '重量g', '克数', 'packWeightGrams'], price: ['价格', '单价', '每包价格', '袋价', '售价', '价格元', 'price'], priceCents: ['价格分', 'priceCents'], minPacks: ['起订包数', '起订量', 'minPacks'], shipping: ['运费', '运费元', 'shipping'], shippingCents: ['运费分', 'shippingCents'], freeShippingAbove: ['包邮门槛', '满免金额', 'freeShippingAbove'], freeShippingAboveCents: ['包邮门槛分', 'freeShippingAboveCents'], priceKind: ['价格类型', 'priceKind'], conditions: ['使用条件', '优惠条件', '条件', 'conditions'], capturedAt: ['报价时间', '采集时间', '查询时间', 'capturedAt'], expiresAt: ['有效期至', '失效时间', 'expiresAt'], tiers: ['阶梯价', 'tiers'],
};
function pick(row, field) { const found = aliases[field].filter(alias => row[alias] !== undefined && row[alias] !== null && row[alias] !== ''); if (found.length > 1 && new Set(found.map(alias => String(row[alias]).trim())).size > 1)
    throw Error(`同义字段“${found.join('/')}”内容不一致，请只保留准确的一列`); return found.length ? row[found[0]] : undefined; }
const plain = (value) => value === undefined || value === null ? '' : String(value).trim();
function beadMarketMoneyCents(value) {
    if (value === undefined || value === null || value === '')
        return;
    const text = String(value).normalize('NFKC').trim().replace(/^(?:¥|￥|CNY|人民币)\s*/i, '').replace(/\s*元(?:\s*\/\s*(?:袋|包))?$/, '').replace(/\s*\/\s*(?:袋|包)$/, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(text))
        return;
    const [whole, fraction = ''] = text.split('.'), result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return result <= 1000000000n ? Number(result) : undefined;
}
function quantity(value, suffix = '(?:粒|颗|个|包|袋)') { const text = plain(value).normalize('NFKC').replace(new RegExp('\\s*' + suffix + '$'), ''); return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) <= 1000000000 ? Number(text) : undefined; }
function timestamp(value, fallback) { if (!plain(value))
    return fallback; let text = plain(value); if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text))
    text = text.replace(' ', 'T') + '+08:00'; if (!/T/.test(text) || !Number.isFinite(Date.parse(text)))
    throw Error('报价时间需填写含日期和时区的有效时间'); return new Date(text).toISOString(); }
function platform(value) { const text = plain(value).toLowerCase(); return /^(?:1688|阿里巴巴)$/.test(text) ? '1688' : /^(?:taobao|淘宝|天猫|tmall)$/.test(text) ? 'taobao' : /^(?:pdd|拼多多|pinduoduo)$/.test(text) ? 'pdd' : undefined; }
function normalizeBeadMarketRows(rows, context) {
    if (!Array.isArray(rows) || rows.length > 500)
        throw Error('报价表一次最多500行。');
    const now = context.now || new Date().toISOString(), offers = [], issues = [], warnings = [], seen = new Set();
    rows.forEach((row, index) => {
        try {
            if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value => typeof value === 'string' && value.length > 20000))
                throw Error('行内容无效或过长');
            const rawUrl = plain(pick(row, 'url')), link = rawUrl ? (0, bead_market_validation_1.beadMarketPlatformUrl)(rawUrl) : undefined, explicitPlatform = platform(pick(row, 'platform')), chosen = explicitPlatform || link?.platform;
            if (!chosen)
                throw Error('请填写平台或真实商品详情链接');
            if (explicitPlatform && link && explicitPlatform !== link.platform)
                throw Error('平台和商品链接不对应');
            if (rawUrl && !link)
                warnings.push(`第${index + 2}行链接不是可识别的官方商品详情，已留空，需先解析短链接或更正`);
            const priceRaw = pick(row, 'price'), centsRaw = pick(row, 'priceCents'), priceCents = centsRaw !== undefined ? quantity(centsRaw, '分') : beadMarketMoneyCents(priceRaw), shippingRaw = pick(row, 'shipping'), shippingCentRaw = pick(row, 'shippingCents'), shippingCents = shippingCentRaw !== undefined ? quantity(shippingCentRaw, '分') : /^(包邮|免运费|免费|free)$/i.test(plain(shippingRaw)) ? 0 : beadMarketMoneyCents(shippingRaw);
            if (priceRaw !== undefined && centsRaw !== undefined && beadMarketMoneyCents(priceRaw) !== priceCents || shippingRaw !== undefined && shippingCentRaw !== undefined && beadMarketMoneyCents(shippingRaw) !== shippingCents)
                throw Error('同一金额的元/分字段不一致，请核对单位');
            if ((priceRaw !== undefined || centsRaw !== undefined) && priceCents === undefined)
                warnings.push(`第${index + 2}行价格未识别为确定金额，已留空`);
            if ((shippingRaw !== undefined || shippingCentRaw !== undefined) && shippingCents === undefined)
                warnings.push(`第${index + 2}行运费无法识别，已留空，不按0处理`);
            const conditionsValue = pick(row, 'conditions'), conditions = (Array.isArray(conditionsValue) ? conditionsValue.map(plain) : plain(conditionsValue).split(/[\n；;]/)).filter(Boolean), kind = plain(pick(row, 'beadKind'));
            const beadKind = /^(?:透明|透明珠|transparent)$/.test(kind) ? 'transparent' : /^(?:特殊|特殊材质|special)$/.test(kind) ? 'special' : 'solid';
            if (kind && !/^(?:普通|普通实心|实心|solid|透明|透明珠|transparent|特殊|特殊材质|special)$/.test(kind))
                warnings.push(`第${index + 2}行珠种“${kind}”请人工核对`);
            const rawKind = plain(pick(row, 'priceKind')), priceKind = /^(?:conditional|条件价|优惠价)$/.test(rawKind) || conditions.length ? 'conditional' : /^(?:range|区间|起价)$/.test(rawKind) || /[~～至]|\d\s*[-－]\s*\d|起/.test(plain(priceRaw)) ? 'range' : priceCents !== undefined ? 'regular' : 'unknown';
            const packCountRaw = pick(row, 'packCount'), packCount = quantity(packCountRaw, '(?:粒|颗|个)'), weight = plain(pick(row, 'packWeightGrams')).replace(/\s*(?:g|克)$/i, ''), diameterRaw = plain(pick(row, 'diameterMm'));
            if (packCountRaw !== undefined && (!packCount || packCount <= 0))
                warnings.push(`第${index + 2}行每包粒数无效，已留空`);
            if (diameterRaw && !(0, bead_market_validation_1.beadMarketDiameter)(diameterRaw))
                warnings.push(`第${index + 2}行珠径无效，需填写例如2.6或5`);
            const thresholdRaw = pick(row, 'freeShippingAbove'), thresholdCents = pick(row, 'freeShippingAboveCents'), freeShippingAboveCents = thresholdCents !== undefined ? quantity(thresholdCents, '分') : beadMarketMoneyCents(thresholdRaw), minRaw = pick(row, 'minPacks'), minPacks = minRaw === undefined ? 1 : quantity(minRaw, '(?:包|袋)');
            if (!minPacks)
                throw Error('起订包数需为正整数');
            const tiersValue = pick(row, 'tiers'), tiersRaw = typeof tiersValue === 'string' && tiersValue.trim() ? JSON.parse(tiersValue) : tiersValue || [];
            if (!Array.isArray(tiersRaw))
                throw Error('阶梯价需为JSON数组');
            const tiers = tiersRaw.map(tier => ({ minPacks: quantity(tier.minPacks, '(?:包|袋)'), priceCents: tier.priceCents !== undefined ? quantity(tier.priceCents, '分') : beadMarketMoneyCents(tier.price) }));
            const offer = (0, bead_market_validation_1.checkedBeadMarketOffer)({ id: context.idFactory?.() || crypto.randomUUID(), platform: chosen, url: link?.url || '', title: plain(pick(row, 'title')), sellerId: plain(pick(row, 'sellerId')), sellerName: plain(pick(row, 'sellerName')), brand: plain(pick(row, 'brand')), compatibleWith: plain(pick(row, 'compatibleWith')) || undefined, series: plain(pick(row, 'series')), diameterMm: (0, bead_market_validation_1.beadMarketDiameter)(diameterRaw), code: plain(pick(row, 'code')).toUpperCase(), beadKind, ...(packCount && packCount > 0 ? { packCount } : {}), ...(weight ? { packWeightGrams: weight } : {}), ...(priceCents !== undefined && priceCents > 0 ? { priceCents } : {}), minPacks, tiers, ...(shippingCents !== undefined ? { shippingCents } : {}), ...(freeShippingAboveCents !== undefined ? { freeShippingAboveCents } : {}), priceKind, conditions, conditionsAccepted: false, verification: 'candidate', evidence: { kind: 'table', capturedAt: timestamp(pick(row, 'capturedAt'), now), ...(pick(row, 'expiresAt') ? { expiresAt: timestamp(pick(row, 'expiresAt'), now) } : {}), ...(context.artifactId ? { artifactId: context.artifactId } : {}), ...(link ? { url: link.url } : {}) } });
            const identity = JSON.stringify({ ...offer, id: '' });
            if (seen.has(identity)) {
                warnings.push(`第${index + 2}行与本表已有报价重复，已跳过`);
                return;
            }
            seen.add(identity);
            offers.push(offer);
        }
        catch (cause) {
            issues.push(`第${index + 2}行：${cause instanceof Error ? cause.message : '无法读取报价'}`);
        }
    });
    return { offers, issues, warnings };
}

},
"./bead-procurement": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beadTotals = beadTotals;
exports.beadUsage = beadUsage;
exports.editBeadCells = editBeadCells;
exports.replaceBeadColor = replaceBeadColor;
const bead_validation_1 = require("./bead-validation");
function colorCounts(pattern) {
    const issue = (0, bead_validation_1.beadPatternIssue)(pattern);
    if (issue)
        throw Error(issue);
    const counts = new Uint32Array(pattern.palette.colors.length + 1);
    for (const cell of pattern.cells)
        counts[cell]++;
    return counts;
}
function beadTotals(pattern) {
    const counts = colorCounts(pattern), totalCells = pattern.cells.length;
    return { totalCells, beads: totalCells - counts[0], emptyCells: counts[0], colorsUsed: [...counts].slice(1).filter(count => count > 0).length };
}
function beadUsage(pattern, procurement) {
    const issue = (0, bead_validation_1.beadProcurementIssue)(procurement);
    if (issue)
        throw Error(issue);
    const counts = colorCounts(pattern), basisPoints = Math.round(procurement.lossPercent * 100);
    return pattern.palette.colors.flatMap((color, index) => {
        const cells = counts[index + 1];
        if (!cells)
            return [];
        const required = cells * procurement.copies, reserve = Math.floor((required * basisPoints + 9999) / 10000);
        const stock = procurement.stock[color.code] ?? 0, shortage = Math.max(0, required + reserve - stock), packSize = procurement.packSizes[color.code] ?? procurement.defaultPackSize;
        return [{ code: color.code, name: color.name, hex: color.hex, kind: color.kind, cells, required, reserve, stock, shortage, packSize, bags: Math.ceil(shortage / packSize) }];
    }).sort((first, second) => second.cells - first.cells || first.code.localeCompare(second.code, 'en', { numeric: true }));
}
function editBeadCells(pattern, edits) {
    const issue = (0, bead_validation_1.beadPatternIssue)(pattern);
    if (issue)
        throw Error(issue);
    if (!Array.isArray(edits) || edits.length > pattern.cells.length * 2)
        throw Error('需要修改的格子或色号无效。');
    for (const edit of edits)
        if (!edit || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index >= pattern.cells.length || !Number.isSafeInteger(edit.value) || edit.value < 0 || edit.value > pattern.palette.colors.length)
            throw Error('需要修改的格子或色号无效。');
    if (!edits.length)
        return pattern;
    const cells = [...pattern.cells];
    for (const edit of edits)
        cells[edit.index] = edit.value;
    return { ...pattern, cells };
}
function replaceBeadColor(pattern, from, to) {
    const issue = (0, bead_validation_1.beadPatternIssue)(pattern);
    if (issue)
        throw Error(issue);
    if (![from, to].every(value => Number.isInteger(value) && value >= 0 && value <= pattern.palette.colors.length))
        throw Error('请选择有效的原色和替换色，0 表示空格。');
    return from === to ? pattern : { ...pattern, cells: pattern.cells.map(value => value === from ? to : value) };
}

},
"./bead-validation": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BEAD_PROCUREMENT = exports.DEFAULT_BEAD_SETTINGS = void 0;
exports.beadSettingsIssue = beadSettingsIssue;
exports.beadPaletteIssue = beadPaletteIssue;
exports.beadPatternIssue = beadPatternIssue;
exports.beadProcurementIssue = beadProcurementIssue;
exports.beadDocumentIssue = beadDocumentIssue;
exports.DEFAULT_BEAD_SETTINGS = { columns: 64, rows: 64, fit: 'contain', maxColors: 32, alphaThreshold: 128, boardColumns: 52, boardRows: 52 };
exports.DEFAULT_BEAD_PROCUREMENT = { copies: 1, lossPercent: 5, defaultPackSize: 1000, stock: {}, packSizes: {} };
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, maximum, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,11}$/;
const idPattern = /^[A-Za-z0-9-]{1,120}$/;
function beadSettingsIssue(value) {
    if (!object(value))
        return '请填写拼豆格数和制图设置。';
    const settings = value;
    if (!integer(settings.columns, 8, 256) || !integer(settings.rows, 8, 256))
        return '列数和行数都请输入 8–256 的整数。';
    if (!['cover', 'contain'].includes(settings.fit))
        return '请选择完整保留或铺满裁切。';
    if (!integer(settings.maxColors, 0, 512))
        return '最多用色请输入 1–512 的整数，0 表示使用整套色卡。';
    if (!integer(settings.alphaThreshold, 0, 255))
        return '透明阈值请输入 0–255 的整数。';
    if (!integer(settings.boardColumns, 1, 256) || !integer(settings.boardRows, 1, 256))
        return '底板列数和行数都请输入 1–256 的整数。';
}
function beadPaletteIssue(value) {
    if (!object(value))
        return '请选择有效的拼豆色卡。';
    const palette = value;
    if (typeof palette.id !== 'string' || !idPattern.test(palette.id) || !text(palette.name, 120) || !text(palette.brand, 120) || !text(palette.version, 160))
        return '色卡名称、品牌、版本或编号无效。';
    if (!text(palette.sourceUrl, 1000, true) || palette.sourceUrl && !/^https:\/\/[^\s]+$/.test(palette.sourceUrl) || !text(palette.sourceNote, 4000, true) || !text(palette.license, 8000))
        return '色卡来源和许可信息无效，请重新导入。';
    if (!Array.isArray(palette.colors) || !palette.colors.length || palette.colors.length > 512)
        return '色卡需要包含 1–512 个颜色。';
    const codes = new Set();
    let automatic = 0;
    for (const color of palette.colors) {
        if (!object(color) || typeof color.code !== 'string' || !codePattern.test(color.code) || codes.has(color.code) || !text(color.name, 80) || typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.hex))
            return '色号需唯一且为 1–12 位大写字母、数字或横线；颜色名称和六位 Hex 需有效。';
        codes.add(color.code);
        if (!Array.isArray(color.rgb) || color.rgb.length !== 3)
            return `色号 ${color.code} 的 RGB 与 Hex 不一致。`;
        for (let index = 0; index < 3; index++)
            if (!integer(color.rgb[index], 0, 255) || color.rgb[index] !== parseInt(color.hex.slice(1 + index * 2, 3 + index * 2), 16))
                return `色号 ${color.code} 的 RGB 与 Hex 不一致。`;
        if (!['solid', 'transparent', 'special'].includes(color.kind) || typeof color.automatic !== 'boolean' || color.kind !== 'solid' && color.automatic)
            return `色号 ${color.code} 的材质或自动匹配设置无效。`;
        if (color.kind === 'solid' && color.automatic)
            automatic++;
    }
    if (!automatic)
        return '色卡至少需要一种可自动匹配的普通实心色。';
}
function beadPatternIssue(value) {
    if (!object(value))
        return '拼豆图纸内容无效。';
    const pattern = value;
    if (pattern.type !== 'xuzuo-bead-pattern' || pattern.version !== 1 || !integer(pattern.columns, 8, 256) || !integer(pattern.rows, 8, 256))
        return '图纸版本或格数无效。';
    const paletteIssue = beadPaletteIssue(pattern.palette);
    if (paletteIssue)
        return paletteIssue;
    if (!Array.isArray(pattern.cells) || pattern.cells.length !== pattern.columns * pattern.rows)
        return '图纸格子数量或色号索引无效，原文件保留。';
    for (const cell of pattern.cells)
        if (!integer(cell, 0, pattern.palette.colors.length))
            return '图纸格子数量或色号索引无效，原文件保留。';
}
function beadProcurementIssue(value) {
    if (!object(value))
        return '请填写有效的用量与采购设置。';
    const settings = value;
    if (!integer(settings.copies, 1, 10000))
        return '制作份数请输入 1–10000 的整数。';
    if (!Number.isFinite(settings.lossPercent) || settings.lossPercent < 0 || settings.lossPercent > 100 || Math.abs(Math.round(settings.lossPercent * 100) / 100 - settings.lossPercent) > 1e-9)
        return '预留损耗请输入 0–100%，最多两位小数。';
    if (!integer(settings.defaultPackSize, 1, 10000000))
        return '每包数量请输入 1–10000000 的整数。';
    for (const [name, map] of [['库存', settings.stock], ['每色包装量', settings.packSizes]]) {
        if (!object(map) || Object.keys(map).length > 512)
            return `${name}记录无效。`;
        for (const [code, count] of Object.entries(map))
            if (!codePattern.test(code) || !integer(count, name === '库存' ? 0 : 1, name === '库存' ? 1000000000 : 10000000))
                return `${name}中的 ${code} 需要有效的整数数量。`;
    }
}
function beadDocumentIssue(value) {
    if (!object(value))
        return '拼豆工程内容无效。';
    const document = value;
    if (document.type !== 'xuzuo-bead-document' || document.version !== 1 || typeof document.id !== 'string' || !idPattern.test(document.id) || typeof document.projectId !== 'string' || !idPattern.test(document.projectId) || !integer(document.revision, 0, Number.MAX_SAFE_INTEGER) || !text(document.title, 120))
        return '拼豆工程版本、名称或保存编号无效。';
    if (document.referenceId !== undefined && (typeof document.referenceId !== 'string' || !idPattern.test(document.referenceId)) || document.sourceSha256 !== undefined && (typeof document.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(document.sourceSha256)) || !text(document.updatedAt, 60) || !Number.isFinite(Date.parse(document.updatedAt)))
        return '拼豆工程的底图来源或时间无效。';
    const issue = beadSettingsIssue(document.settings) || beadPatternIssue(document.pattern) || beadProcurementIssue(document.procurement);
    if (issue)
        return issue;
    if (document.settings.columns !== document.pattern.columns || document.settings.rows !== document.pattern.rows)
        return '制图设置与实际网格大小不一致。';
}

}
};
const cache = Object.create(null);
function load(id) {
  if (!Object.hasOwn(factories, id)) throw Error('Unknown bead market runtime dependency');
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} }; factories[id](module, module.exports, load); return module.exports;
}
module.exports = load('./bead-market');
