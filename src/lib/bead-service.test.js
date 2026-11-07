import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { fixture, dependencies } = require('./bead-native-fixtures.cjs'), { PNG } = dependencies('pngjs'), JSZip = dependencies('jszip');
const { createDeliverySource } = require('../../electron/delivery-source.cjs');
const active = [], hash = buffer => createHash('sha256').update(buffer).digest('hex');
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw Error('Native bead operations cannot call providers'); })));
afterEach(async () => { for (const f of active.splice(0)) { expect(f.providerCalls).toHaveLength(0); await f.close(); } expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function setup() { const f = await fixture(); active.push(f); return f; }
describe('本地拼豆真实来源、后台制图与版本保存', () => {
  it('uses registered same-project source SHA and bounded BGRA sampling, then quantizes and saves in the real worker', async () => {
    const f = await setup(), source = f.references['project-a'], original = (await f.artifactStore.read(source.id)).buffer, preview = await f.service.source({ projectId: 'project-a', referenceId: source.id });
    expect(preview.sourceSha256).toBe(hash(original)); expect([preview.originalWidth, preview.originalHeight]).toEqual([8, 8]); expect(PNG.sync.read(Buffer.from(preview.dataUrl.split(',')[1], 'base64')).width).toBeLessThanOrEqual(512);
    const document = await f.service.generate(f.input()); expect(document.revision).toBe(1); expect(document.sourceSha256).toBe(hash(original)); expect(f.core.beadTotals(document.pattern)).toMatchObject({ totalCells: 64, beads: 64, emptyCells: 0 });
    const call = f.calls.find(item => item.task === 'bead'); expect(call.input.raster).toMatchObject({ format: 'bgra', premultiplied: true }); expect(call.input.raster.pixels.byteLength).toBeLessThanOrEqual(1024 * 1024 * 4);
    expect(await f.service.read({ projectId: 'project-a' })).toEqual(document); const place = await f.workspaceStorage.projectDirectory('project-a'); expect(JSON.parse(await fs.readFile(path.join(place, '.xuzuo', 'bead-v1.json'), 'utf8')).document.id).toBe(document.id);
    expect(f.service.sourceStats().entries).toBeLessThanOrEqual(2); expect(f.service.sourceStats().bytes).toBeLessThanOrEqual(8 * 1024 * 1024); expect(hash((await f.artifactStore.read(source.id)).buffer)).toBe(hash(original));
  });
  it('rejects foreign sources and invalid settings without starting quantization', async () => {
    const f = await setup(); await expect(f.service.source({ projectId: 'project-a', referenceId: f.references['project-b'].id })).rejects.toThrow('本项目');
    await expect(f.service.generate({ ...f.input(), settings: { ...f.settings, columns: 257 } })).rejects.toThrow(); expect(f.calls).toHaveLength(0); expect(await f.service.read({ projectId: 'project-a' })).toBeUndefined();
  });
  it('keeps the document id across regenerate and uses optimistic revision checks instead of overwriting another save', async () => {
    const f = await setup(), first = await f.service.generate(f.input()), second = await f.service.generate({ ...f.input('project-a', first.revision), settings: { ...f.settings, columns: 16 } });
    expect(second.id).toBe(first.id); expect(second.revision).toBeGreaterThan(first.revision);
    const left = { ...second, title: '保存A' }, right = { ...second, title: '保存B' };
    const results = await Promise.allSettled([f.service.save({ projectId: 'project-a', document: left, expectedRevision: second.revision }), f.service.save({ projectId: 'project-a', document: right, expectedRevision: second.revision })]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter(item => item.status === 'rejected')).toHaveLength(1); expect((await f.service.read({ projectId: 'project-a' })).title).toBe('保存A');
  });
  it('cancelled generation cannot write a late result, and another project remains independently usable', async () => {
    const f = await setup(); let entered, release; const gate = new Promise(resolve => { release = resolve; }), admission = new Promise(resolve => { entered = resolve; });
    f.setTaskHook(async (task, _input, _options, execute) => { if (task === 'bead') { entered(); await gate; } return execute(); });
    const pending = f.service.generate(f.input()).catch(error => error); await admission; await f.service.cancel({ projectId: 'project-a' }); release(); expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(await f.service.read({ projectId: 'project-a' })).toBeUndefined(); f.setTaskHook(undefined); const other = await f.service.generate(f.input('project-b')); expect(other.projectId).toBe('project-b'); expect((await f.service.read({ projectId: 'project-b' })).id).toBe(other.id);
  });
  it('allows editing and exporting a stored grid after its original reference disappeared', async () => {
    const f = await setup(), document = await f.service.generate(f.input()), source = f.references['project-a']; expect(source.path.startsWith(f.directory + path.sep)).toBe(true); await fs.unlink(source.path);
    await expect(f.service.source({ projectId: 'project-a', referenceId: source.id })).rejects.toThrow(); const changed = { ...document, pattern: f.core.editBeadCells(document.pattern, [{ index: 0, value: 3 }]) };
    const saved = await f.service.save({ projectId: 'project-a', document: changed, expectedRevision: document.revision }); expect(f.core.beadUsage(saved.pattern, saved.procurement).find(row => row.code === 'T1').cells).toBe(1);
    const output = await f.service.export({ projectId: 'project-a', format: 'csv', expectedRevision: saved.revision }); expect(output.artifact.mimeType).toBe('text/csv'); const csv = (await f.artifactStore.read(output.artifact.id)).buffer.toString('utf8'); expect(csv).toContain('T1'); expect(output.sourceRevision).toBe(saved.revision);
    const snapshot = await f.engine.snapshot(); expect(snapshot.ledger).toEqual([]); expect(snapshot.runs[0].localImageProof.kind).toBe('bead'); expect(snapshot.runs[0].attempts[0].modelLabel).toBe('本地拼豆');
  });
});
describe('拼豆导入、损坏恢复、导出与交付', () => {
  it('imports foreign self-contained documents without a base image while retaining the current project id and revision lineage', async () => {
    const f = await setup(), original = await f.service.generate(f.input()), imported = { ...original, id: 'external-document', projectId: 'external-project', revision: 400, referenceId: 'external-reference', title: '外部完整图纸' }, filename = path.join(f.directory, 'portable.json'); await fs.writeFile(filename, JSON.stringify(imported));
    f.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); const saved = await f.service.importDocument({ projectId: 'project-a' }); expect(saved.projectId).toBe('project-a'); expect(saved.id).toBe(original.id); expect(saved.referenceId).toBeUndefined(); expect(saved.revision).toBeGreaterThan(original.revision); expect(saved.pattern.cells).toEqual(original.pattern.cells);
    expect((await f.service.export({ projectId: 'project-a', format: 'json', expectedRevision: saved.revision })).artifact.mimeType).toBe('application/json');
  });
  it('does not overwrite corrupt or missing state automatically; restores a saved record explicitly with a higher revision', async () => {
    const f = await setup(), original = await f.service.generate(f.input()), place = await f.workspaceStorage.projectDirectory('project-a'), filename = path.join(place, '.xuzuo', 'bead-v1.json'); await fs.writeFile(filename, 'BROKEN-SAVED-BEAD');
    await expect(f.service.read({ projectId: 'project-a' })).rejects.toThrow(); await expect(f.service.generate(f.input())).rejects.toThrow(); expect(await fs.readFile(filename, 'utf8')).toBe('BROKEN-SAVED-BEAD');
    const history = await f.service.history({ projectId: 'project-a' }); expect(history[0]).toMatchObject({ revision: original.revision, columns: 8, rows: 8 }); expect(history[0]).not.toHaveProperty('pattern');
    const restored = await f.service.restore({ projectId: 'project-a', revision: original.revision }); expect(restored.id).toBe(original.id); expect(restored.revision).toBeGreaterThan(original.revision); const preserved = (await fs.readdir(path.dirname(filename))).find(name => name.startsWith('bead-before-restore-')); expect(await fs.readFile(path.join(path.dirname(filename), preserved), 'utf8')).toBe('BROKEN-SAVED-BEAD');
    await fs.unlink(filename); await expect(f.service.read({ projectId: 'project-a' })).rejects.toThrow('缺失'); await expect(f.service.generate(f.input())).rejects.toThrow('缺失');
  });
  it('blocks an import selected against an older raw version if another save finished while its dialog was open', async () => {
    const f = await setup(), original = await f.service.generate(f.input()), filename = path.join(f.directory, 'import.json'); await fs.writeFile(filename, JSON.stringify({ ...original, title: '旧导入' })); let choose;
    f.dialog.showOpenDialog = () => new Promise(resolve => { choose = resolve; }); const pending = f.service.importDocument({ projectId: 'project-a' }).catch(error => error); await vi.waitFor(() => expect(choose).toBeTypeOf('function'));
    const saved = await f.service.save({ projectId: 'project-a', document: { ...original, title: '新手绘' }, expectedRevision: original.revision }); choose({ canceled: false, filePaths: [filename] }); expect(await pending).toBeInstanceOf(Error); expect((await f.service.read({ projectId: 'project-a' })).revision).toBe(saved.revision); expect((await f.service.read({ projectId: 'project-a' })).title).toBe('新手绘');
  });
  it('exports one real ZIP suite with a shared saved revision and no original, key, ledger or prompt data', async () => {
    const f = await setup(), document = await f.service.generate(f.input()), output = await f.service.export({ projectId: 'project-a', format: 'bundle', expectedRevision: document.revision });
    expect(output.artifact.mimeType).toBe('application/zip'); const zip = await JSZip.loadAsync((await f.artifactStore.read(output.artifact.id)).buffer), entries = Object.keys(zip.files); expect(entries.some(name => name.endsWith('.png'))).toBe(true); expect(entries.some(name => name.endsWith('.pdf'))).toBe(true); expect(entries.some(name => name.endsWith('.csv'))).toBe(true); expect(entries.some(name => name.endsWith('.xlsx'))).toBe(true); const jsonName = entries.find(name => name.endsWith('.json')); expect(JSON.parse(await zip.file(jsonName).async('string')).revision).toBe(document.revision);
    for (const name of entries) expect(name).not.toMatch(/底图|key|ledger|prompt/i); const source = createDeliverySource({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, readBeadDocument: id => f.store.read({ projectId: id }) }); const inspected = await source({ projectId: 'project-a', kind: 'image', artifactIds: [output.artifact.id] }); expect(inspected.errors).toEqual([]); expect(inspected.checks.some(check => check.status === 'manual')).toBe(true);
    await f.service.save({ projectId: 'project-a', expectedRevision: document.revision, document: { ...document, pattern: f.core.editBeadCells(document.pattern, [{ index: 0, value: 1 }]) } }); await expect(source({ projectId: 'project-a', kind: 'image', artifactIds: [output.artifact.id] })).rejects.toThrow(); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('retains real partial files and the saved document when printing or final ZIP preparation fails', async () => {
    const f = await setup(), document = await f.service.generate(f.input()); f.setPrintHook(async () => { throw Error('打印未完成'); });
    const failure = await f.service.export({ projectId: 'project-a', format: 'bundle', expectedRevision: document.revision }).catch(error => error); expect(failure.artifacts).toHaveLength(4); expect(failure.message).toContain('保存在项目文件');
    for (const artifact of failure.artifacts) expect((await f.artifactStore.read(artifact.id)).buffer.length).toBeGreaterThan(0); expect((await f.service.read({ projectId: 'project-a' })).revision).toBe(document.revision); expect((await f.engine.snapshot()).runs).toEqual([]); expect(f.changes.length).toBeGreaterThanOrEqual(4);
  });
  it('keeps a pre-existing paid ledger unchanged through local generation, edited-grid saves and export recording', async () => {
    const f = await setup(), workflow = { id: 'paid-workflow', workspaceId: 'workspace', name: '既有AI底图', outputKind: 'image', steps: [{ id: 'paid-step', name: '既有生成', kind: 'image-generation', prompt: 'PRIOR-PRIVATE-PROMPT', inputSource: 'project', enabled: true }] };
    const prior = { run: { id: 'prior-paid-run', mode: 'live', workspaceId: 'workspace', projectId: 'project-a', workflowId: workflow.id, workflowName: workflow.name, snapshot: workflow, status: 'complete', stepIndex: 1, input: '', variables: {}, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', attempts: [{ id: 'prior-paid-attempt', stepId: 'paid-step', stepName: '既有生成', modelLabel: '既有模型', status: 'complete', costCents: 345, costState: 'manual', action: '初次生成', input: '', prompt: '', summary: '', artifacts: [] }] }, request: { project: { id: 'project-a', workspaceId: 'workspace', name: '已付费项目', kind: 'image', costCents: 345 }, workflow, connections: [], models: [], input: '', variables: {}, attachmentIds: [] }, ledger: [{ id: 'prior-paid-entry', projectId: 'project-a', projectName: '已付费项目', workflowRunId: 'prior-paid-run', workflowAttemptId: 'prior-paid-attempt', workflowStepId: 'paid-step', action: '初次生成', model: '既有模型', quantity: 1, time: '2026-11-07T00:00:00Z', status: 'complete', billingMode: 'live', costCents: 345, costState: 'manual' }], legacyBaseCostCents: 0 };
    await f.engine.importRecords([prior]); const ledger = (await f.engine.snapshot()).ledger, document = await f.service.generate(f.input()), edited = await f.service.save({ projectId: 'project-a', document: { ...document, pattern: f.core.editBeadCells(document.pattern, [{ index: 0, value: 1 }]) }, expectedRevision: document.revision });
    await f.service.export({ projectId: 'project-a', format: 'png', expectedRevision: edited.revision }); expect((await f.engine.snapshot()).ledger).toEqual(ledger); expect((await f.engine.snapshot()).ledger[0].costCents).toBe(345);
  });
  it('saves empty JSON drafts but refuses empty commercial outputs without inventing bead counts', async () => {
    const f = await setup(), document = await f.service.generate(f.input()), blank = { ...document, pattern: { ...document.pattern, cells: document.pattern.cells.map(() => 0) } }, saved = await f.service.save({ projectId: 'project-a', expectedRevision: document.revision, document: blank });
    for (const format of ['png', 'pdf', 'csv', 'xlsx', 'bundle']) await expect(f.service.export({ projectId: 'project-a', format, expectedRevision: saved.revision })).rejects.toThrow('空白');
    const exported = await f.service.export({ projectId: 'project-a', format: 'json', expectedRevision: saved.revision }); expect(JSON.parse((await f.artifactStore.read(exported.artifact.id)).buffer).pattern.cells.every(cell => cell === 0)).toBe(true); expect((await f.engine.snapshot()).runs).toEqual([]);
  });
  it('exports the current unsaved memory recovery JSON even while the project directory is offline, without moving native state', async () => {
    const f = await setup(), document = await f.service.generate(f.input()), changed = { ...document, pattern: f.core.editBeadCells(document.pattern, [{ index: 0, value: 1 }]) }, recovery = path.join(f.directory, 'recovery.json'), projectDirectory = f.workspaceStorage.projectDirectory;
    f.workspaceStorage.projectDirectory = async () => { throw Error('U盘断开'); }; f.dialog.showSaveDialog = async () => ({ canceled: false, filePath: recovery });
    expect(await f.service.exportRecovery({ projectId: 'project-a', document: changed })).toMatchObject({ saved: true }); expect(JSON.parse(await fs.readFile(recovery, 'utf8')).pattern.cells[0]).toBe(1);
    f.workspaceStorage.projectDirectory = projectDirectory; expect((await f.service.read({ projectId: 'project-a' })).pattern.cells[0]).toBe(document.pattern.cells[0]); await expect(f.service.exportRecovery({ projectId: 'project-a', document: changed })).rejects.toThrow();
  });
});
