import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { fixture, request, dependencies, until } = require('./production-test-fixtures.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createBatchProduction } = require('../../electron/batch-production.cjs');
const { parseBatchImport } = require('../../electron/batch-import.cjs');
const running = []; afterEach(async () => { for (const { batch, engine } of running.splice(0)) { await batch?.shutdown(); await engine?.shutdown(); } });
async function setup(execute, options = {}) { const f = await fixture(execute), batch = createBatchProduction({ ...f, ...options }); running.push({ batch, engine: f.engine }); return { ...f, batch }; }
const create = (f, overrides = {}) => f.batch.create({ name: '客户批次', request: request(), rows: [{ 客户: '甲公司' }, { 客户: '乙公司' }], projectNameTemplate: '{{序号}} · {{客户}}', ...overrides });
const waitBatch = (f, id, predicate) => until(() => f.batch.get({ id }), predicate);
describe('批量导入与独立项目生产', () => {
  it('CSV引号/换行、0与false原样保留；坏表头/未闭引号不能静默丢数据', async () => {
    const result = await parseBatchImport({ name: 'rows.csv', buffer: Buffer.from('\uFEFF客户,数量,启用,说明\n甲,0,false,"含逗号,以及\n下一行"\n') }, dependencies);
    expect(result.rows).toEqual([{ 客户: '甲', 数量: '0', 启用: 'false', 说明: '含逗号,以及\n下一行' }]);
    for (const text of ['客户,客户\n甲,乙', '客户,\n甲,乙', '客户\n"未结束']) await expect(parseBatchImport({ name: 'bad.csv', buffer: Buffer.from(text) }, dependencies)).rejects.toThrow();
  });
  it('XLSX读取第一表并保留0/false和缓存公式，未计算公式明确拒绝', async () => {
    const ExcelJS = dependencies('exceljs'), book = new ExcelJS.Workbook(), sheet = book.addWorksheet('数据'); sheet.addRow(['客户', '数量', '启用', '合计']); sheet.addRow(['甲', 0, false, { formula: '2+3', result: 5 }]); book.addWorksheet('忽略表');
    const imported = await parseBatchImport({ name: 'rows.xlsx', buffer: await book.xlsx.writeBuffer() }, dependencies); expect(imported.rows[0]).toEqual({ 客户: '甲', 数量: '0', 启用: 'false', 合计: '5' }); expect(imported.warnings).toHaveLength(1);
    sheet.getCell('D2').value = { formula: '2+3' }; await expect(parseBatchImport({ name: 'bad.xlsx', buffer: await book.xlsx.writeBuffer() }, dependencies)).rejects.toThrow('公式没有可用缓存');
  });
  it('500项公共列表只线性读取万条账本，费用与未知状态有序且下一快照立即更新', async () => {
    const f = await fixture(), input = request(), time = '2026-11-06T00:00:00.000Z';
    const items = Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}`, row: index + 1, variables: { 客户: `客户${index}` }, project: { ...input.project, id: `project-${index}`, name: `客户${index}`, updatedAt: time }, status: 'complete', attempts: [], artifacts: [] }));
    const record = { version: 1, id: 'ledger-index-batch', name: '账本索引验收', workspaceId: input.project.workspaceId, status: 'complete', createdAt: time, updatedAt: time, items, request: input, projectNameTemplate: '{{客户}}' };
    const directory = path.join(f.directory, 'batches-v1'), filename = path.join(directory, `${record.id}.json`), seed = JSON.stringify(record);
    await fs.mkdir(directory); await fs.writeFile(filename, seed, { flag: 'wx' });
    let projectReads = 0, snapshotCalls = 0;
    const makeLedger = (prefix, cents, unknown) => Array.from({ length: 10000 }, (_, index) => Object.freeze({
      id: `${prefix}-${index}`, get projectId() { projectReads++; return items[index % items.length].project.id; },
      costCents: cents, costState: unknown && index === 9999 ? 'unknown' : 'calculated', status: 'complete',
      ...(index === 0 ? { calculation: Object.freeze({ nativeCurrency: 'USD', nativeAmount: '0.01', ...(unknown ? {} : { cnyAmount: '0.07' }) }) } : {}),
    }));
    const initialLedger = Object.freeze(makeLedger('initial', 1, true)), initialInput = JSON.stringify(initialLedger);
    let ledger = initialLedger;
    const engine = { snapshot: async () => { snapshotCalls++; return { runs: [], ledger }; } };
    const batch = createBatchProduction({ ...f, liveEngine: engine }); running.push({ batch, engine: f.engine });
    await batch.list(); projectReads = 0;
    const [first] = await batch.list(), firstReads = projectReads;
    expect(firstReads).toBeGreaterThan(0); expect(firstReads).toBeLessThanOrEqual(20000);
    const summary = value => value.items.map(item => ({ id: item.id, row: item.row, projectId: item.project.id, status: item.status, costCents: item.costCents, projectCost: item.project.costCents, unknownCost: item.unknownCost, ledgerIds: item.ledger.map(entry => entry.id) }));
    const expected = (prefix, cents, unknown, reverse = false) => items.map((item, index) => ({ id: item.id, row: item.row, projectId: item.project.id, status: 'complete', costCents: cents * 20, projectCost: cents * 20, unknownCost: unknown && (index === 0 || index === 499), ledgerIds: Array.from({ length: 20 }, (_, ordinal) => `${prefix}-${index + (reverse ? 19 - ordinal : ordinal) * 500}`) }));
    expect(summary(first)).toEqual(expected('initial', 1, true)); expect(first.items.reduce((total, item) => total + item.costCents, 0)).toBe(10000);
    expect(JSON.stringify(initialLedger)).toBe(initialInput);
    const nextLedger = Object.freeze(makeLedger('next', 2, false).reverse()), nextInput = JSON.stringify(nextLedger);
    ledger = nextLedger; projectReads = 0;
    const [next] = await batch.list(), nextReads = projectReads;
    expect(nextReads).toBeGreaterThan(0); expect(nextReads).toBeLessThanOrEqual(20000);
    expect(summary(next)).toEqual(expected('next', 2, false, true)); expect(next.items.reduce((total, item) => total + item.costCents, 0)).toBe(20000);
    expect(summary(first)).toEqual(expected('initial', 1, true));
    expect(JSON.stringify(initialLedger)).toBe(initialInput); expect(JSON.stringify(nextLedger)).toBe(nextInput);
    const extraEntries = [], extraSeeds = new Map();
    for (let index = 0; index < 50; index++) {
      const projectId = `many-project-${index}`, id = `many-batch-${index}`;
      const extra = { ...record, id, items: [{ ...items[0], id: `many-item-${index}`, project: { ...items[0].project, id: projectId } }] };
      const target = path.join(directory, `${id}.json`), raw = JSON.stringify(extra); extraSeeds.set(target, raw); await fs.writeFile(target, raw, { flag: 'wx' });
      extraEntries.push(Object.freeze({ id: `many-fee-${index}`, get projectId() { projectReads++; return projectId; }, costCents: 3, costState: 'calculated', status: 'complete' }));
    }
    ledger = Object.freeze([...nextLedger, ...extraEntries]); const allInput = JSON.stringify(ledger);
    const reopened = createBatchProduction({ ...f, liveEngine: engine }); running.push({ batch: reopened }); projectReads = 0;
    const all = await reopened.list(), allReads = projectReads;
    expect(allReads).toBeGreaterThan(0); expect(allReads).toBeLessThanOrEqual(ledger.length * 2); expect(all).toHaveLength(51);
    expect(summary(all.find(item => item.id === record.id))).toEqual(expected('next', 2, false, true));
    for (let index = 0; index < 50; index++) {
      const row = all.find(item => item.id === `many-batch-${index}`).items[0];
      expect(row.project.id).toBe(`many-project-${index}`); expect(row.costCents).toBe(3); expect(row.project.costCents).toBe(3); expect(row.unknownCost).toBe(false); expect(row.ledger.map(entry => entry.id)).toEqual([`many-fee-${index}`]);
    }
    expect(all.flatMap(item => item.items).reduce((sum, item) => sum + item.costCents, 0)).toBe(20150);
    expect(JSON.stringify(ledger)).toBe(allInput); expect(JSON.stringify(initialLedger)).toBe(initialInput); expect(JSON.stringify(nextLedger)).toBe(nextInput);
    for (const [target, raw] of extraSeeds) expect(await fs.readFile(target, 'utf8')).toBe(raw);
    expect(summary(first)).toEqual(expected('initial', 1, true)); expect(await fs.readFile(filename, 'utf8')).toBe(seed); expect(snapshotCalls).toBe(4); expect(f.calls).toHaveLength(0);
  });
  it('两行保存即有独立注册目录，串行产生真实DOCX，引擎只调用两次且账本各记一次', async () => {
    const f = await setup(), record = await create(f);
    expect(f.calls).toHaveLength(0); expect(new Set(record.items.map(item => item.project.directory)).size).toBe(2); for (const item of record.items) await fs.lstat(item.project.directory);
    await f.batch.control({ id: record.id, action: 'start' }); const done = await waitBatch(f, record.id, value => value.status === 'complete'); expect(f.calls).toHaveLength(2);
    for (const item of done.items) { expect(item.status).toBe('complete'); const file = item.artifacts.find(file => file.name.endsWith('.docx')); expect(file).toBeTruthy(); expect(file.path.startsWith(item.project.directory + path.sep)).toBe(true); expect((await fs.readFile(file.path)).subarray(0, 2).toString()).toBe('PK'); expect(item.ledger).toHaveLength(1); }
    expect((await f.engine.snapshot()).ledger).toHaveLength(2); await f.batch.get({ id: record.id }); await f.batch.list(); expect(f.calls).toHaveLength(2);
  });
  it.each(['word', 'ppt', 'excel'])('当前默认%s的text→export→终端review两行顺畅完成且不增加模型次数', async kind => {
    const f = await setup(async request => kind === 'excel' ? JSON.stringify({ title: '客户成品', sheets: [{ name: '明细', columns: ['客户需求', '正文说明'], rows: [[request.input, '完整核对的固定内容']] }] }) : undefined), input = request(); input.project.kind = kind; input.workflow.outputKind = kind; input.workflow.steps = [input.workflow.steps[0], input.workflow.steps[2], input.workflow.steps[1]];
    const record = await create(f, { request: input }); await f.batch.control({ id: record.id, action: 'start' }); const done = await waitBatch(f, record.id, value => value.status === 'complete'); expect(f.calls).toHaveLength(2); expect(done.items.every(item => item.status === 'complete' && item.artifacts.some(file => file.kind === 'office'))).toBe(true); expect((await f.engine.snapshot()).ledger).toHaveLength(2);
  });
  it('自定义终端review不因没有后续模型而自动通过', async () => {
    const f = await setup(), input = request(); input.workflow.steps = [input.workflow.steps[0], input.workflow.steps[2], { ...input.workflow.steps[1], prompt: '客户必须逐页确认后才继续' }];
    const record = await create(f, { request: input }); await f.batch.control({ id: record.id, action: 'start' }); const waiting = await waitBatch(f, record.id, value => value.status === 'waiting-review'); expect(waiting.items[0].status).toBe('waiting-review'); expect(waiting.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(1);
  });
  it('暂停只停止后续项，当前quick免费尾段可落盘，继续后才提交下一项', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }); const f = await setup(async () => { if (f.calls.length === 1) await gate; }), record = await create(f);
    await f.batch.control({ id: record.id, action: 'start' }); await until(async () => f.calls.length, count => count === 1); await f.batch.control({ id: record.id, action: 'pause' }); release();
    const paused = await waitBatch(f, record.id, value => value.items[0].status === 'complete'); expect(paused.status).toBe('paused'); expect(paused.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(1);
    await f.batch.control({ id: record.id, action: 'start' }); await waitBatch(f, record.id, value => value.status === 'complete'); expect(f.calls).toHaveLength(2);
  });
  it('自定义manual-review不会因summary空prompt误跳过，明确resume动作后才继续', async () => {
    const f = await setup(), input = request(); input.workflow.steps[1].prompt = '客户必须先确认本页数据';
    const snapshot = f.engine.snapshot.bind(f.engine), detail = f.engine.runDetail.bind(f.engine); let fullSnapshots = 0, hydrated = 0;
    f.engine.snapshot = (...args) => { if (!args[1]?.summaryOnly) fullSnapshots++; return snapshot(...args); }; f.engine.runDetail = (...args) => { hydrated++; return detail(...args); };
    const record = await create(f, { request: input }); await f.batch.control({ id: record.id, action: 'start' }); const waiting = await waitBatch(f, record.id, value => value.status === 'waiting-review'); expect(waiting.items[0].status).toBe('waiting-review'); expect(waiting.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(1); expect(hydrated).toBeGreaterThan(0); expect(fullSnapshots).toBe(0);
    await f.batch.control({ id: record.id, action: 'resume-review', itemId: waiting.items[0].id }); await waitBatch(f, record.id, value => value.items[0].status === 'complete' && value.items[1].status === 'waiting-review'); expect(f.calls).toHaveLength(2);
  });
  it('提交标记持久化失败不会发送模型请求，恢复后单项显式重试才产生一次调用', async () => {
    let fail = true; const pendingFiles = new Set();
    const fileSystem = { ...fs, writeFile: async (filename, contents, options) => { const value = JSON.parse(contents); if (value.items?.some(item => item.status === 'submitting')) pendingFiles.add(filename); return fs.writeFile(filename, contents, options); }, rename: async (source, target) => { if (fail && pendingFiles.has(source)) throw new Error('owned submission marker failure'); return fs.rename(source, target); } };
    const f = await setup(undefined, { fileSystem }), record = await create(f, { rows: [{ 客户: '甲' }] }); await f.batch.control({ id: record.id, action: 'start' }); const blocked = await waitBatch(f, record.id, value => value.status === 'paused'); expect(blocked.items[0].status).toBe('failed'); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toHaveLength(0);
    fail = false; await f.batch.control({ id: record.id, action: 'retry-item', itemId: record.items[0].id }); await waitBatch(f, record.id, value => value.status === 'complete'); expect(f.calls).toHaveLength(1);
  });
  it('重启不自动重发已提交项或后续项，未提交queued保持原ID与顺序', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }), f = await setup(async () => gate), record = await create(f);
    await f.batch.control({ id: record.id, action: 'start' }); await until(async () => f.calls.length, count => count === 1); await f.batch.shutdown(); release(); await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'waiting-review'); await f.engine.shutdown();
    const engine = createLiveWorkflowEngine(f.engineOptions), batch = createBatchProduction({ ...f, liveEngine: engine }); running.push({ engine, batch }); const restored = await batch.get({ id: record.id }); await new Promise(resolve => setTimeout(resolve, 150)); expect(restored.status).toBe('interrupted'); expect(restored.items[1].id).toBe(record.items[1].id); expect(restored.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(1); expect((await engine.snapshot()).ledger).toHaveLength(1);
  });
  it('工作区锁/关闭准入拒绝时不提交，取消单项不抹掉已发生费用', async () => {
    let denied = false; const f = await setup(undefined, { assertAdmission: async () => { if (denied) throw new Error('owned workspace backup lock'); } }), record = await create(f, { rows: [{ 客户: '甲' }] }); denied = true;
    await f.batch.control({ id: record.id, action: 'start' }); await waitBatch(f, record.id, value => value.status === 'paused'); expect(f.calls).toHaveLength(0); denied = false;
    await f.batch.control({ id: record.id, action: 'retry-item', itemId: record.items[0].id }); await waitBatch(f, record.id, value => value.status === 'complete'); const ledger = (await f.engine.snapshot()).ledger; await f.batch.control({ id: record.id, action: 'cancel-item', itemId: record.items[0].id }); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    await f.batch.shutdown(); await expect(f.batch.control({ id: record.id, action: 'start' })).rejects.toThrow('正在退出');
  });
  it('第二行run缺失时只中断第二行，第一行不能被shadow predicate误改', async () => {
    const f = await fixture(); let count = 0; const runs = [];
    const engine = { preflight: async () => ({ ok: true, errors: [] }), snapshot: async () => ({ runs, ledger: [] }), start: async input => { count++; const run = { id: `run-${count}`, projectId: input.project.id, createdAt: new Date().toISOString(), status: count === 1 ? 'complete' : 'running', attempts: [] }; if (count === 1) runs.push(run); return run; } };
    const batch = createBatchProduction({ ...f, liveEngine: engine }); running.push({ batch, engine: f.engine }); const record = await batch.create({ name: '缺失run验收', request: request(), rows: [{ 客户: '甲' }, { 客户: '乙' }] }); await batch.control({ id: record.id, action: 'start' }); const stopped = await until(() => batch.get({ id: record.id }), value => value.status === 'paused'); expect(stopped.items[0].status).toBe('complete'); expect(stopped.items[1].status).toBe('interrupted'); expect(stopped.items[1].error).toContain('未自动重发');
  });
  it('备份仅导出选定项目的项，恢复幂等且不执行已恢复/排队项目', async () => {
    const f = await setup(), record = await create(f), exported = await f.batch.exportRecords([record.items[1].project.id]); expect(exported).toHaveLength(1); expect(exported[0].items).toHaveLength(1); expect(exported[0].items[0].id).toBe(record.items[1].id);
    const copy = structuredClone(exported[0]); copy.id = crypto.randomUUID(); copy.items[0].status = 'running'; const restored = await f.batch.importRecords([copy], { backupId: 'fixture-backup' }); expect(restored.imported).toEqual([copy.id]); const item = await f.batch.get({ id: copy.id }); expect(item.status).toBe('interrupted'); expect(item.items[0].status).toBe('interrupted'); expect(f.calls).toHaveLength(0); await f.batch.importRecords([copy], { backupId: 'fixture-backup' }); expect((await f.batch.list()).filter(item => item.id === copy.id)).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(0);
  });
});
