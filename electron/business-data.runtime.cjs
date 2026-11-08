// Generated from shared business data helpers; run scripts/build-business-runtime.mjs.
'use strict';
const factories = {
"./business-data": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessRecordIdentity = exports.normalizeBusinessRows = exports.businessMetrics = exports.businessEconomics = exports.newBusinessState = exports.checkedBusinessState = exports.businessStateIssue = exports.businessId = exports.BUSINESS_STATE_BYTES = void 0;
var business_validation_1 = require("./business-validation");
Object.defineProperty(exports, "BUSINESS_STATE_BYTES", { enumerable: true, get: function () { return business_validation_1.BUSINESS_STATE_BYTES; } });
Object.defineProperty(exports, "businessId", { enumerable: true, get: function () { return business_validation_1.businessId; } });
Object.defineProperty(exports, "businessStateIssue", { enumerable: true, get: function () { return business_validation_1.businessStateIssue; } });
Object.defineProperty(exports, "checkedBusinessState", { enumerable: true, get: function () { return business_validation_1.checkedBusinessState; } });
Object.defineProperty(exports, "newBusinessState", { enumerable: true, get: function () { return business_validation_1.newBusinessState; } });
var business_economics_1 = require("./business-economics");
Object.defineProperty(exports, "businessEconomics", { enumerable: true, get: function () { return business_economics_1.businessEconomics; } });
Object.defineProperty(exports, "businessMetrics", { enumerable: true, get: function () { return business_economics_1.businessMetrics; } });
var business_import_1 = require("./business-import");
Object.defineProperty(exports, "normalizeBusinessRows", { enumerable: true, get: function () { return business_import_1.normalizeBusinessRows; } });
Object.defineProperty(exports, "businessRecordIdentity", { enumerable: true, get: function () { return business_import_1.businessRecordIdentity; } });

},
"./business-validation": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessId = exports.BUSINESS_STATE_BYTES = void 0;
exports.newBusinessState = newBusinessState;
exports.businessStateIssue = businessStateIssue;
exports.checkedBusinessState = checkedBusinessState;
exports.BUSINESS_STATE_BYTES = 8 * 1024 * 1024;
const businessId = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
exports.businessId = businessId;
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (message) => { throw Error(message); };
const text = (value, limit = 10000, required = false) => typeof value === 'string' && value.length <= limit && (!required || !!value.trim()) && !value.includes('\0');
const integer = (value, max = 1_000_000_000_000) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const minutes = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const optional = (value, test) => value === undefined || test(value);
const time = (value) => text(value, 80, true) && Number.isFinite(Date.parse(value)) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) === value);
const list = (value, test, limit = 5000) => Array.isArray(value) && value.length <= limit && Array.from(value).every(test);
const ids = (value, limit = 5000) => list(value, exports.businessId, limit) && new Set(value).size === value.length;
const one = (value, values) => typeof value === 'string' && values.includes(value);
const object = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const facts = (value) => plain(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => text(key, 100, true) && !['__proto__', 'constructor', 'prototype'].includes(key) && text(item, 4000));
const projectKinds = ['image', 'ppt', 'word', 'excel'];
const timestampFields = (value) => time(value.createdAt) && time(value.updatedAt);
function validate(input) {
    if (!object(input, ['version', 'workspaceId', 'revision', 'brands', 'products', 'orders', 'feedback', 'transactions', 'metrics']))
        fail('业务资料包含不支持的字段，未保存。');
    const value = input;
    if (value.version !== 1 || !(0, exports.businessId)(value.workspaceId) || !integer(value.revision, Number.MAX_SAFE_INTEGER - 1))
        fail('工作区或业务资料版本无效。');
    const limits = { brands: 200, products: 2000, orders: 1000, feedback: 5000, transactions: 20000, metrics: 20000 };
    for (const [key, max] of Object.entries(limits)) {
        const rows = value[key];
        if (!Array.isArray(rows) || rows.length > max || Array.from(rows).some(row => !plain(row) || !(0, exports.businessId)(row.id)) || new Set(rows.map(row => row.id)).size !== rows.length)
            fail('业务记录编号重复、记录不完整或超过容量。');
    }
    for (const b of value.brands)
        if (!object(b, ['id', 'name', 'contact', 'projectId', 'logoArtifactId', 'colors', 'font', 'voice', 'forbiddenClaims', 'approvedSampleIds', 'updatedAt']) || !text(b.name, 200, true) || !text(b.contact, 1000) || !optional(b.projectId, exports.businessId) || !optional(b.logoArtifactId, exports.businessId) || !list(b.colors, color => typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color), 16) || !text(b.font, 100) || !text(b.voice, 4000) || !list(b.forbiddenClaims, row => text(row, 400), 100) || !ids(b.approvedSampleIds, 100) || !time(b.updatedAt))
            fail('客户品牌资料格式无效。');
    for (const p of value.products)
        if (!object(p, ['id', 'sku', 'name', 'projectId', 'referenceArtifactIds', 'facts', 'factsConfirmedAt', 'updatedAt']) || !text(p.sku, 100, true) || !text(p.name, 200, true) || !(0, exports.businessId)(p.projectId) || !ids(p.referenceArtifactIds, 16) || !facts(p.facts) || !optional(p.factsConfirmedAt, time) || !time(p.updatedAt))
            fail('商品资料格式无效。');
    if (new Set(value.products.map(p => p.projectId + '\0' + p.sku.normalize('NFKC').trim().toLowerCase())).size !== value.products.length)
        fail('同一项目的商品编号重复。');
    const brandIds = new Set(value.brands.map(row => row.id)), productIds = new Set(value.products.map(row => row.id)), orderIds = new Set(value.orders.map(row => row.id)), runOwners = new Map();
    for (const o of value.orders) {
        if (!object(o, ['id', 'name', 'recipe', 'sourceProjectId', 'brandId', 'brief', 'productIds', 'projectIds', 'runIds', 'outputIds', 'includedRevisions', 'deadline', 'status', 'factsRevision', 'facts', 'factsConfirmedAt', 'outputKinds', 'imageCount', 'sizes', 'tasks', 'bindings', 'createdAt', 'updatedAt', 'error', 'preparedHash', 'deliveries', 'referenceArtifactIds']) || !text(o.name, 200, true) || !one(o.recipe, ['merchant', 'digital', 'documents']) || !(0, exports.businessId)(o.sourceProjectId) || !optional(o.brandId, id => (0, exports.businessId)(id) && brandIds.has(id)) || !text(o.brief) || !ids(o.productIds, 2000) || o.productIds.some(id => !productIds.has(id)) || !ids(o.projectIds, 5000) || !ids(o.runIds, 10000) || !ids(o.outputIds, 20000) || !optional(o.referenceArtifactIds, row => ids(row, 20)) || !integer(o.includedRevisions, 100) || !optional(o.deadline, time) || !one(o.status, ['draft', 'ready', 'running', 'sample-review', 'review', 'complete', 'paused', 'failed', 'archived']) || !integer(o.factsRevision, Number.MAX_SAFE_INTEGER - 1) || !facts(o.facts) || !optional(o.factsConfirmedAt, time) || !ids(o.outputKinds, 4) || !o.outputKinds.length || o.outputKinds.some(kind => !projectKinds.includes(kind)) || !integer(o.imageCount, 20) || o.imageCount < 1 || !list(o.sizes, row => object(row, ['width', 'height', 'label']) && integer(row.width, 8192) && Number(row.width) >= 64 && integer(row.height, 8192) && Number(row.height) >= 64 && Number(row.width) * Number(row.height) <= 16000000 && text(row.label, 100), 16) || !Array.isArray(o.tasks) || o.tasks.length > 5000 || !plain(o.bindings) || !timestampFields(o) || !optional(o.error, row => text(row, 4000)) || !optional(o.preparedHash, row => typeof row === 'string' && /^[a-f0-9]{64}$/i.test(row)))
            fail('制作单资料或关联格式无效。');
        if (o.deliveries !== undefined && (!Array.isArray(o.deliveries) || o.deliveries.length > 1000 || Array.from(o.deliveries).some(row => !plain(row) || !(0, exports.businessId)(row.id)) || new Set(o.deliveries.map(row => row.id)).size !== o.deliveries.length))
            fail('交付回执重复或超过容量。');
        for (const receipt of o.deliveries || [])
            if (!object(receipt, ['id', 'confirmedAt', 'factsRevision', 'files', 'checks']) || !(0, exports.businessId)(receipt.id) || !time(receipt.confirmedAt) || !integer(receipt.factsRevision, Number.MAX_SAFE_INTEGER - 1) || !list(receipt.files, file => object(file, ['artifactId', 'projectId', 'name', 'sha256', 'bytes']) && (0, exports.businessId)(file.artifactId) && (0, exports.businessId)(file.projectId) && text(file.name, 500, true) && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(file.sha256) && integer(file.bytes, 100 * 1024 * 1024) && Number(file.bytes) > 0, 1000) || !receipt.files.length || !object(receipt.checks, ['content', 'rights', 'format']) || !['content', 'rights', 'format'].every(key => typeof receipt.checks[key] === 'boolean'))
                fail('制作单交付回执格式无效。');
        for (const [kind, binding] of Object.entries(o.bindings))
            if (!['text', 'vision', 'image-generation', 'image-editing'].includes(kind) || !object(binding, ['modelConfigId', 'credentialId']) || !optional(binding.modelConfigId, exports.businessId) || !optional(binding.credentialId, exports.businessId))
                fail('业务制作模型绑定无效。');
        if (new Set(o.tasks.map(t => t.id)).size !== o.tasks.length)
            fail('制作任务编号重复。');
        for (const t of o.tasks) {
            const task = t;
            if (!object(t, ['id', 'label', 'kind', 'productId', 'projectId', 'runId', 'status', 'artifactIds', 'factsRevision', 'error', 'operation', 'referenceArtifactIds', 'dispatchKey', 'submittedAt', 'inputHash']) || !(0, exports.businessId)(t.id) || !text(t.label, 200, true) || !projectKinds.includes(t.kind) || !optional(t.productId, id => (0, exports.businessId)(id) && o.productIds.includes(id)) || !optional(t.projectId, exports.businessId) || !optional(t.runId, exports.businessId) || !one(t.status, ['pending', 'running', 'review', 'complete', 'failed', 'cancelled', 'stale']) || !ids(t.artifactIds, 200) || !integer(t.factsRevision, Number.MAX_SAFE_INTEGER - 1) || !optional(t.error, row => text(row, 4000)) || !optional(task.operation, row => one(row, ['cutout', 'background', 'compose', 'document'])) || !optional(task.referenceArtifactIds, row => ids(row, 20)) || !optional(task.dispatchKey, row => typeof row === 'string' && /^[a-f0-9]{64}$/i.test(row)) || !optional(task.submittedAt, time) || !optional(task.inputHash, row => typeof row === 'string' && /^[a-f0-9]{64}$/i.test(row)))
                fail('制作任务格式无效。');
        }
        for (const id of o.runIds) {
            if (runOwners.has(id) && runOwners.get(id) !== o.id)
                fail('同一次模型运行不能重复归入多个制作单。');
            runOwners.set(id, o.id);
        }
    }
    for (const f of value.feedback)
        if (!object(f, ['id', 'orderId', 'round', 'target', 'text', 'tasks', 'status', 'runIds', 'additionalQuoteCents', 'createdAt', 'updatedAt']) || !orderIds.has(f.orderId) || !integer(f.round, 10000) || f.round < 1 || !object(f.target, ['projectId', 'artifactId', 'pageId', 'blockId', 'selectedText']) || !(0, exports.businessId)(f.target.projectId) || !optional(f.target.artifactId, exports.businessId) || !optional(f.target.pageId, row => text(row, 200)) || !optional(f.target.blockId, row => text(row, 200)) || !optional(f.target.selectedText, row => text(row, 10000)) || !text(f.text, 10000, true) || !list(f.tasks, row => text(row, 2000, true), 100) || !one(f.status, ['open', 'approved', 'applied', 'confirmed']) || !ids(f.runIds, 1000) || !optional(f.additionalQuoteCents, integer) || !timestampFields(f))
            fail('客户返修记录格式无效。');
    for (const t of value.transactions)
        if (!object(t, ['id', 'orderId', 'productId', 'kind', 'amountCents', 'quantity', 'minutes', 'hourlyRateCents', 'occurredAt', 'note', 'source', 'externalId', 'voidedAt']) || !orderIds.has(t.orderId) || !optional(t.productId, id => (0, exports.businessId)(id) && value.orders.find(o => o.id === t.orderId).productIds.includes(id)) || !one(t.kind, ['receipt', 'refund', 'fee', 'expense', 'labor']) || !integer(t.amountCents) || !optional(t.quantity, row => integer(row) && Number(row) > 0) || t.quantity !== undefined && !['receipt', 'refund'].includes(t.kind) || !optional(t.minutes, minutes) || !optional(t.hourlyRateCents, integer) || (t.minutes === undefined) !== (t.hourlyRateCents === undefined) || t.kind !== 'labor' && t.minutes !== undefined || !time(t.occurredAt) || !text(t.note, 4000) || !optional(t.source, row => text(row, 200, true)) || !optional(t.externalId, row => text(row, 200, true)) || !optional(t.voidedAt, time))
            fail('实收或费用流水格式无效，金额必须使用非负整数分，件数仅允许收款或退款的正整数。');
    for (const m of value.metrics)
        if (!object(m, ['id', 'orderId', 'artifactId', 'evidenceArtifactId', 'platform', 'variant', 'publishedAt', 'period', 'impressions', 'clicks', 'inquiries', 'orders', 'revenueCents', 'source', 'externalId', 'createdAt']) || !orderIds.has(m.orderId) || !optional(m.artifactId, exports.businessId) || !optional(m.evidenceArtifactId, exports.businessId) || !text(m.platform, 100, true) || !text(m.variant, 200, true) || !optional(m.publishedAt, time) || !text(m.period, 100, true) || !['impressions', 'clicks', 'inquiries', 'orders', 'revenueCents'].every(key => optional(m[key], integer)) || !text(m.source, 200, true) || !optional(m.externalId, row => text(row, 200, true)) || !time(m.createdAt))
            fail('平台表现记录格式无效，缺失指标请留空，不要填造数据。');
    const externalKeys = value.transactions.filter(row => !row.voidedAt && row.externalId).map(row => JSON.stringify([row.source || '表格导入', row.kind, row.externalId]));
    if (new Set(externalKeys).size !== externalKeys.length)
        fail('相同来源和类型的外部流水号重复，不能重复计入实收。');
    if (JSON.stringify(value).length > exports.BUSINESS_STATE_BYTES || new TextEncoder().encode(JSON.stringify(value)).length > exports.BUSINESS_STATE_BYTES)
        fail('业务资料超过8MB，请按工作区拆分；原记录保留。');
    return value;
}
function newBusinessState(workspaceId) {
    if (!(0, exports.businessId)(workspaceId))
        fail('请选择有效工作区。');
    return { version: 1, workspaceId, revision: 0, brands: [], products: [], orders: [], feedback: [], transactions: [], metrics: [] };
}
function businessStateIssue(value) { try {
    validate(value);
    return '';
}
catch (error) {
    return error instanceof Error ? error.message : '业务资料格式无效。';
} }
function checkedBusinessState(value, workspaceId) { const state = validate(value); if (workspaceId !== undefined && state.workspaceId !== workspaceId)
    fail('业务资料不属于当前工作区。'); return structuredClone(state); }

},
"./business-economics": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessEconomics = businessEconomics;
exports.businessMetrics = businessMetrics;
const cost_display_1 = require("./cost-display");
const safe = (value) => { const result = Number(value); if (!Number.isSafeInteger(result))
    throw Error('汇总金额超过安全计算范围。'); return result; };
function businessEconomics(state, orderId, ledger) {
    const order = state.orders.find(item => item.id === orderId);
    if (!order)
        throw Error('制作单不存在。');
    const transactions = state.transactions.filter(item => item.orderId === orderId && !item.voidedAt), missing = [];
    const sum = (kind) => safe(transactions.filter(item => item.kind === kind).reduce((total, item) => total + BigInt(item.amountCents), 0n));
    const labor = transactions.filter(item => item.kind === 'labor');
    const laborCents = safe(labor.reduce((total, item) => total + (item.minutes === undefined ? BigInt(item.amountCents) : (BigInt(Math.round(item.minutes * 100)) * BigInt(item.hourlyRateCents) + 5999n) / 6000n), 0n));
    const runIds = new Set(order.runIds), fees = [...new Map(ledger.filter(item => item.billingMode === 'live' && item.workflowRunId && runIds.has(item.workflowRunId)).map(item => [item.id, item])).values()], costs = (0, cost_display_1.summarizeCosts)(fees);
    const apiCents = costs.quoteCents ?? (0, cost_display_1.amountToQuoteCents)(costs.cnyAmount) ?? 0;
    if (costs.pendingCount || costs.missingFxCount)
        missing.push('部分API计费依据或人民币换算待补齐');
    if (costs.legacyCount)
        missing.push('部分历史API金额缺少精确计费明细');
    if (runIds.size && !fees.length)
        missing.push('制作运行尚无可关联的计费记录');
    if (order.tasks.some(task => task.submittedAt && !task.runId))
        missing.push('有模型提交结果待确认，不能按零API成本结算');
    if (!labor.length)
        missing.push('尚未记录实际人工，可明确记录0分钟');
    if (!transactions.some(item => item.kind === 'receipt'))
        missing.push('尚未记录实际收款');
    if (order.status !== 'complete' || order.tasks.some(task => task.status !== 'complete'))
        missing.push('制作任务尚未结束，后续制作成本待确认');
    const receiptsCents = sum('receipt'), refundsCents = sum('refund'), feesCents = sum('fee'), expensesCents = sum('expense');
    const quantities = (kind) => { const rows = transactions.filter(item => item.kind === kind && item.quantity !== undefined); return rows.length ? safe(rows.reduce((total, item) => total + BigInt(item.quantity), 0n)) : undefined; };
    const knownBalanceCents = safe(BigInt(receiptsCents) - BigInt(refundsCents) - BigInt(feesCents) - BigInt(expensesCents) - BigInt(laborCents) - BigInt(apiCents));
    return { receiptsCents, refundsCents, feesCents, expensesCents, laborCents, apiCents, receivedQuantity: quantities('receipt'), refundedQuantity: quantities('refund'), knownBalanceCents, complete: !missing.length, missing, approximate: costs.approximate };
}
function businessMetrics(state, orderId) {
    const groups = new Map();
    for (const row of state.metrics.filter(item => item.orderId === orderId)) {
        const key = JSON.stringify([row.platform.trim().toLowerCase(), row.period.trim(), row.variant.trim()]);
        groups.set(key, [...(groups.get(key) || []), row]);
    }
    return [...groups.values()].map(rows => {
        const first = rows[0], result = { platform: first.platform, period: first.period, variant: first.variant };
        for (const field of ['impressions', 'clicks', 'inquiries', 'orders', 'revenueCents'])
            if (rows.every(row => row[field] !== undefined))
                result[field] = safe(rows.reduce((total, row) => total + BigInt(row[field]), 0n));
        if (result.impressions && result.clicks !== undefined)
            result.clickRate = result.clicks / result.impressions;
        if (result.impressions && result.inquiries !== undefined)
            result.inquiryRate = result.inquiries / result.impressions;
        if (result.clicks && result.orders !== undefined)
            result.conversionRate = result.orders / result.clicks;
        return result;
    });
}

},
"./business-import": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessRecordIdentity = businessRecordIdentity;
exports.normalizeBusinessRows = normalizeBusinessRows;
const business_validation_1 = require("./business-validation");
const normalize = (text) => text.normalize('NFKC').trim().toLowerCase();
function businessRecordIdentity(kind, record) {
    if (kind === 'products') {
        const row = record;
        return 'product:' + row.projectId + ':' + normalize(row.sku);
    }
    if (kind === 'transactions') {
        const row = record;
        return row.externalId ? JSON.stringify(['transaction', row.source || '表格导入', row.kind, row.externalId]) : undefined;
    }
    const row = record;
    return JSON.stringify(['metric', row.source, normalize(row.platform), row.externalId || [row.orderId, row.artifactId || '', row.period.trim(), row.variant.trim()]]);
}
const sameRecord = (left, right) => {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
    const clean = (value) => canonical(Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'factsConfirmedAt', 'voidedAt'].includes(key))));
    return JSON.stringify(clean(left)) === JSON.stringify(clean(right));
};
function pick(row, aliases) {
    for (const alias of aliases) {
        const key = Object.keys(row).find(key => normalize(key) === normalize(alias));
        if (key !== undefined && row[key].trim())
            return row[key].trim();
    }
    return '';
}
function money(value) {
    const text = value.replace(/[￥¥,\s]/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(text))
        throw Error('金额需填写人民币数值，最多两位小数');
    const [whole, fraction = ''] = text.split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(result) || result > 1_000_000_000_000)
        throw Error('金额超出可计算范围');
    return result;
}
function count(value) {
    if (!value.trim())
        return undefined;
    const text = value.replace(/[,\s]/g, '');
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 1_000_000_000_000)
        throw Error('指标需使用平台原始整数，不能用“万”等缩略数');
    return Number(text);
}
const date = (value) => {
    if (!value || !Number.isFinite(Date.parse(value)) || /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) !== value)
        throw Error('请填写有效的日期或ISO时间');
    return value;
};
const fields = { sku: ['商品编号', 'SKU', 'sku', '货号'], name: ['商品名称', '商品名', '名称', 'name'], images: ['原图', '参考图', '参考图片', '图片', 'referenceArtifactIds', 'image'], order: ['制作单ID', '制作单'], external: ['流水号', '外部流水号', '交易号', '退款单号', 'externalId', '订单号', '订单ID', '订单编号', 'Order ID', 'order_id', 'orderId'], source: ['来源', '渠道', 'source'], type: ['类型', '交易类型', 'kind'], amount: ['金额', '实收金额', 'amount'], date: ['日期', '交易日期', '发生时间', 'occurredAt', '时间'] };
const factAliases = { material: ['material', '材质', '材料'], dimensions: ['dimensions', '尺寸', '规格'], price: ['price', '价格', '售价', '单价'], features: ['features', '卖点', '特征', '产品卖点'] };
function selectedOrder(row, context) {
    const explicit = pick(row, fields.order);
    if (explicit && context.orderId && !context.state.orders.some(order => order.id === context.orderId && (order.id === explicit || order.name === explicit)))
        throw Error('表格制作单与当前选中制作单不一致');
    const raw = context.orderId || explicit || pick(row, ['orderId']) || '', found = context.state.orders.filter(order => order.id === raw || order.name === raw);
    if (found.length !== 1)
        throw Error('请指定当前工作区中唯一的制作单');
    return found[0].id;
}
function resolveImages(text, projectId, context) {
    if (!text)
        return [];
    const images = (context.artifacts || []).filter(item => item.projectId === projectId && !item.trashedAt && ['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType || ''));
    const exact = images.filter(item => item.id === text || normalize(item.name) === normalize(text));
    const parts = exact.length ? [text] : text.split(/[;；|,\n]/).map(value => value.trim()).filter(Boolean);
    return [...new Set(parts.map(value => {
            const found = images.filter(item => item.id === value || normalize(item.name) === normalize(value));
            if (found.length !== 1)
                throw Error('参考图“' + value + '”未导入当前项目或有同名文件，请先导入原图或使用明确的产物编号');
            return found[0].id;
        }))];
}
function productRow(row, context, id, now) {
    const sku = pick(row, fields.sku), name = pick(row, fields.name), projectId = context.projectId || '';
    if (!sku || !name || !(0, business_validation_1.businessId)(projectId))
        throw Error('商品编号、商品名称和目标图片项目需要填写');
    const facts = {}, reserved = new Set([...fields.sku, ...fields.name, ...fields.images].map(normalize));
    for (const [key, value] of Object.entries(row))
        if (!reserved.has(normalize(key)) && value.trim()) {
            if (['__proto__', 'constructor', 'prototype'].includes(key))
                throw Error('表格包含不支持的字段名称');
            const canonical = Object.entries(factAliases).find(([, aliases]) => aliases.some(alias => normalize(alias) === normalize(key)))?.[0] || key.trim();
            if (facts[canonical] !== undefined && facts[canonical] !== value.trim())
                throw Error('同一商品字段存在不同内容：' + canonical);
            facts[canonical] = value.trim();
        }
    return { id, sku, name, projectId, referenceArtifactIds: resolveImages(pick(row, fields.images), projectId, context), facts, updatedAt: now };
}
function transactionRow(row, context, id) {
    const kindRaw = pick(row, fields.type), kinds = { receipt: 'receipt', 收入: 'receipt', 收款: 'receipt', refund: 'refund', 退款: 'refund', fee: 'fee', 渠道费: 'fee', 手续费: 'fee', expense: 'expense', 其他费用: 'expense', 支出: 'expense', labor: 'labor', 人工: 'labor' }, kind = kinds[kindRaw];
    if (!kind)
        throw Error('类型应为收入、退款、渠道费、其他费用或人工');
    const externalId = pick(row, fields.external);
    if (!externalId)
        throw Error('流水号为必填，以免重复入账');
    const orderId = selectedOrder(row, context), amountRaw = pick(row, fields.amount);
    const minutesRaw = pick(row, ['分钟', '实际分钟', 'minutes']), rateRaw = pick(row, ['时薪', 'hourlyRate']);
    if (minutesRaw && (!/^\d+(?:\.\d{1,2})?$/.test(minutesRaw) || Number(minutesRaw) > 10000000))
        throw Error('人工分钟数最多两位小数');
    const minutes = minutesRaw ? Number(minutesRaw) : undefined, hourlyRateCents = rateRaw ? money(rateRaw) : undefined;
    if ((minutes === undefined) !== (hourlyRateCents === undefined) || kind !== 'labor' && minutes !== undefined)
        throw Error('人工时长与时薪需同时填写，仅用于人工记录');
    const amountCents = amountRaw ? money(kind === 'refund' && amountRaw.startsWith('-') ? amountRaw.slice(1) : amountRaw) : kind === 'labor' && minutes !== undefined ? 0 : money(amountRaw);
    const quantity = count(pick(row, ['件数', '数量', '成交件数', '商品数量', '退货件数', 'quantity']));
    if (quantity !== undefined && (!quantity || !['receipt', 'refund'].includes(kind)))
        throw Error('件数需填写正整数，仅用于收款或退款流水');
    return { id, orderId, kind, amountCents, ...(quantity !== undefined ? { quantity } : {}), ...(minutes !== undefined ? { minutes, hourlyRateCents } : {}), occurredAt: date(pick(row, fields.date)), note: pick(row, ['备注', '说明', 'note']), source: pick(row, fields.source) || '表格导入', externalId };
}
function metricRow(row, context, id, now) {
    const orderId = selectedOrder(row, context), platform = pick(row, ['平台', 'platform']), variant = pick(row, ['版本', '素材版本', '作品名称', '素材名称', 'variant']), period = pick(row, ['周期', '统计周期', '统计日期', '日期', 'period']);
    if (!platform || !variant || !period)
        throw Error('平台、素材版本和统计周期需要填写');
    const result = { id, orderId, platform, variant, period, source: pick(row, fields.source) || '表格导入', createdAt: now };
    const columns = { impressions: ['曝光', '曝光量', 'impressions'], clicks: ['点击', '点击量', 'clicks'], inquiries: ['咨询', '咨询数', 'inquiries'], orders: ['成交', '成交数', 'orders'] };
    for (const [field, aliases] of Object.entries(columns)) {
        const value = count(pick(row, aliases));
        if (value !== undefined)
            result[field] = value;
    }
    const revenue = pick(row, ['收入', '成交金额', 'revenue']);
    if (revenue)
        result.revenueCents = money(revenue);
    const external = pick(row, fields.external);
    if (external)
        result.externalId = external;
    const published = pick(row, ['发布时间', 'publishedAt']);
    if (published)
        result.publishedAt = date(published);
    if (['impressions', 'clicks', 'inquiries', 'orders', 'revenueCents'].every(key => result[key] === undefined))
        throw Error('至少填写一项真实表现指标');
    return result;
}
function normalizeBusinessRows(kind, rows, context) {
    const records = [], issues = [], conflicts = [], matchedIds = [], now = context.now || new Date().toISOString();
    let duplicates = 0;
    if (!['products', 'transactions', 'metrics'].includes(kind) || !Array.isArray(rows) || !rows.length || rows.length > 500)
        return { records, issues: ['请选择1–500行的有效业务表格'], conflicts, duplicates, matchedIds };
    const existing = new Map();
    for (const record of context.state[kind]) {
        const key = businessRecordIdentity(kind, record);
        if (key)
            existing.set(key, record);
    }
    rows.forEach((row, index) => {
        try {
            if (!row || typeof row !== 'object' || Object.keys(row).length > 50 || Object.values(row).some(value => typeof value !== 'string' || value.length > 10000))
                throw Error('表格行内容超过容量或包含非文本值');
            const id = context.idFactory?.() || crypto.randomUUID(), record = kind === 'products' ? productRow(row, context, id, now) : kind === 'transactions' ? transactionRow(row, context, id) : metricRow(row, context, id, now);
            const key = businessRecordIdentity(kind, record);
            const prior = existing.get(key);
            if (prior) {
                if (sameRecord(prior, record)) {
                    duplicates++;
                    matchedIds.push(prior.id);
                }
                else
                    conflicts.push('第' + (index + 2) + '行与已有同号记录内容不同，请先核对，未覆盖原记录');
            }
            else {
                existing.set(key, record);
                records.push(record);
                matchedIds.push(record.id);
            }
        }
        catch (error) {
            issues.push('第' + (index + 2) + '行：' + (error instanceof Error ? error.message : '无法读取该行'));
        }
    });
    return { records, issues, conflicts, duplicates, matchedIds: [...new Set(matchedIds)] };
}

},
"./cost-display": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCostAmounts = addCostAmounts;
exports.formatCostAmount = formatCostAmount;
exports.amountToQuoteCents = amountToQuoteCents;
exports.displayCost = displayCost;
exports.costPrimary = costPrimary;
exports.costSecondary = costSecondary;
exports.summarizeCosts = summarizeCosts;
exports.costSummaryPrimary = costSummaryPrimary;
exports.costSummarySecondary = costSummarySecondary;
exports.attemptCostRecord = attemptCostRecord;
exports.runCostRecords = runCostRecords;
const DECIMAL_PLACES = 42;
const SCALE = 10n ** BigInt(DECIMAL_PLACES);
const DISPLAY_SCALE = 100000000n;
function decimal(value) {
    if (typeof value !== 'string' || !/^\d+(?:\.\d{1,42})?$/.test(value))
        return undefined;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMAL_PLACES, '0'));
}
function decimalString(value) {
    const fraction = (value % SCALE).toString().padStart(DECIMAL_PLACES, '0').replace(/0+$/, '');
    return `${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}
function addCostAmounts(values) {
    return decimalString(values.reduce((sum, value) => { const parsed = decimal(value); if (parsed === undefined)
        throw new Error('无效的十进制费用'); return sum + parsed; }, 0n));
}
function formatCostAmount(value, currency) {
    const amount = decimal(value);
    if (amount === undefined)
        return '金额暂不可用';
    const symbol = currency === 'USD' ? '$' : '¥';
    const precision = SCALE / DISPLAY_SCALE;
    if (amount > 0n && amount < precision)
        return `<${symbol}0.00000001`;
    const rounded = (amount + precision / 2n) / precision;
    const fraction = (rounded % DISPLAY_SCALE).toString().padStart(8, '0').replace(/0+$/, '').padEnd(2, '0');
    return `${symbol}${rounded / DISPLAY_SCALE}.${fraction}`;
}
function amountToQuoteCents(value) {
    const amount = decimal(value);
    if (amount === undefined)
        return undefined;
    const cents = (amount + SCALE / 100n - 1n) / (SCALE / 100n);
    return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}
function recordedAmount(cents) {
    return Number.isSafeInteger(cents) && cents >= 0 ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` : undefined;
}
function displayCost(entry) {
    const base = { pending: false, missingFx: false, approximate: false, legacy: false, partial: false };
    if (entry.billingMode !== 'live' || entry.costState === 'manual' || entry.costState === 'not-incurred') {
        const amount = entry.costState === 'not-incurred' ? '0' : recordedAmount(entry.costCents);
        return { ...base, ...(amount === undefined ? { pending: true } : { nativeCurrency: 'CNY', nativeAmount: amount, cnyAmount: amount }), calculation: entry.calculation };
    }
    const receipt = entry.calculation;
    if (receipt && receipt.version === 1 && ['USD', 'CNY'].includes(receipt.nativeCurrency) && decimal(receipt.nativeAmount) !== undefined) {
        const cny = receipt.nativeCurrency === 'CNY' ? receipt.nativeAmount : decimal(receipt.cnyAmount) !== undefined ? receipt.cnyAmount : undefined;
        const partial = receipt.completeness !== 'complete';
        return { ...base, nativeCurrency: receipt.nativeCurrency, nativeAmount: receipt.nativeAmount, cnyAmount: cny,
            pending: partial || entry.costState !== 'calculated', missingFx: receipt.nativeCurrency === 'USD' && cny === undefined,
            approximate: receipt.nativeCurrency === 'USD' && cny !== undefined, partial, calculation: receipt };
    }
    const legacy = entry.costState === 'calculated' ? recordedAmount(entry.costCents) : undefined;
    return legacy === undefined ? { ...base, pending: true } : { ...base, legacy: true, nativeCurrency: 'CNY', nativeAmount: legacy, cnyAmount: legacy };
}
function costPrimary(entry) {
    const value = displayCost(entry);
    if (!value.nativeCurrency || value.nativeAmount === undefined)
        return '计费依据待补齐';
    return `${formatCostAmount(value.nativeAmount, value.nativeCurrency)}${value.partial ? '（部分）' : value.legacy ? '（历史记录）' : ''}`;
}
function costSecondary(entry) {
    const value = displayCost(entry);
    const details = [];
    if (value.missingFx)
        details.push(`${value.partial ? '已知部分美元费用已保留' : '美元费用已知'}，人民币换算暂不可用`);
    else if (value.approximate && value.cnyAmount !== undefined)
        details.push(`≈${formatCostAmount(value.cnyAmount, 'CNY')}`);
    if (value.pending)
        details.push(`计费依据待补齐：${entry.costReason?.trim() || '用量、单价或适用规则尚未完整确认'}`);
    if (details.length)
        return details.join(' · ');
    if (value.legacy)
        return '旧版分值记录，缺少精确计算明细';
    return entry.costState === 'manual' ? '人工账单校正' : entry.costState === 'not-incurred' ? '未发出收费请求' : '';
}
function summarizeCosts(entries) {
    const values = entries.map(displayCost);
    const sum = (currency) => addCostAmounts(values.filter(value => value.nativeCurrency === currency && value.nativeAmount !== undefined).map(value => value.nativeAmount));
    const cnyAmount = addCostAmounts(values.filter(value => value.cnyAmount !== undefined).map(value => value.cnyAmount));
    const pendingCount = values.filter(value => value.pending).length, missingFxCount = values.filter(value => value.missingFx).length;
    return { usdAmount: sum('USD'), nativeCnyAmount: sum('CNY'), cnyAmount, usdCount: values.filter(value => value.nativeCurrency === 'USD').length, cnyCount: values.filter(value => value.nativeCurrency === 'CNY').length,
        pendingCount, missingFxCount, legacyCount: values.filter(value => value.legacy).length, approximate: values.some(value => value.approximate), count: entries.length,
        ...(!pendingCount && !missingFxCount ? { quoteCents: amountToQuoteCents(cnyAmount) } : {}) };
}
function costSummaryPrimary(summary) {
    const native = [summary.usdCount ? formatCostAmount(summary.usdAmount, 'USD') : '', summary.cnyCount && (!summary.usdCount || decimal(summary.nativeCnyAmount) > 0n) ? formatCostAmount(summary.nativeCnyAmount, 'CNY') : ''].filter(Boolean).join(' + ');
    return native || (summary.pendingCount ? '计费依据待补齐' : '¥0.00');
}
function costSummarySecondary(summary) {
    return [summary.usdCount && !summary.missingFxCount ? `${summary.approximate ? '≈' : ''}${formatCostAmount(summary.cnyAmount, 'CNY')}` : '', summary.missingFxCount ? `${summary.missingFxCount} 笔待换算人民币` : '', summary.pendingCount ? `${summary.pendingCount} 笔计费依据待补齐` : '', summary.legacyCount ? `含 ${summary.legacyCount} 笔历史分值记录` : ''].filter(Boolean).join(' · ');
}
function attemptCostRecord(attempt, ledger, live) {
    return live ? ledger.find(entry => entry.workflowAttemptId === attempt.id) || { ...attempt, billingMode: 'live' } : { ...attempt, billingMode: 'simulation' };
}
function runCostRecords(run, ledger) {
    if (run.mode !== 'live')
        return run.attempts.map(attempt => ({ ...attempt, billingMode: 'simulation' }));
    const entries = ledger.filter(entry => entry.workflowRunId === run.id);
    const missing = run.attempts.filter(attempt => !entries.some(entry => entry.workflowAttemptId === attempt.id) && run.snapshot.steps.some(step => step.id === attempt.stepId && !['manual-review', 'export', 'animation-compose'].includes(step.kind)));
    return [...entries, ...missing.map(attempt => ({ ...attempt, billingMode: 'live' }))];
}

}
};
const cache = Object.create(null);
function load(id) {
  if (!Object.hasOwn(factories, id)) throw Error('Unknown business runtime dependency');
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} }; factories[id](module, module.exports, load); return module.exports;
}
module.exports = load('./business-data');
