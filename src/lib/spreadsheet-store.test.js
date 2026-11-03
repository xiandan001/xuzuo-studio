import { it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createSpreadsheetStore } = require('../../electron/spreadsheet-store.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const staged = path.join(root, 'work/ui-build/package.json'), dependencies = createRequire(existsSync(staged) ? staged : path.join(root, 'package.json'));
const ExcelJS = dependencies('exceljs'), JSZip = dependencies('jszip');
function doc(cells = {}) { return { schemaVersion: 1, kind: 'excel', title: '隔离真实表格', sheets: [{ id: 'sheet-one', name: '明细', rowCount: 10, columnCount: 6, cells: { A1: { value: 2 }, B1: { value: 3 }, C1: { value: 9999, formula: 'SUM(A1:B1)', bold: true, format: 'currency' }, ...cells } }] }; }
function input(document = doc(), expectedRevision = 0) { return { projectId: 'project-one', expectedRevision, document }; }
async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-workbook-tests-')), workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  const workspaceStorage = createWorkspaceStorage({ directory: path.join(directory, 'control') });
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage, loadModule: dependencies });
  workspaceStorage.setArtifactMigrator((id, target) => artifactStore.migrateProject(id, target));
  await workspaceStorage.bindRoot({ workspaceId: 'workspace-one', name: '隔离工作区', directory: workspace, projects: [] });
  const project = await workspaceStorage.ensureProject({ projectId: 'project-one', workspaceId: 'workspace-one', name: '表格项目' });
  const options = { workspaceStorage, artifactStore, loadModule: dependencies, fileSystem };
  return { directory, project, workspaceStorage, artifactStore, options, store: createSpreadsheetStore(options) };
}

it('保存源稿和版本到所属项目，重开最新内容，加载旧版不会覆盖新版本', async () => {
  const f = await fixture(); assert.equal(await f.store.load({ projectId: 'project-one' }), null);
  const first = await f.store.save(input()); assert.equal(first.revision, 1); assert.equal(first.calculation.cells['sheet-one'].C1.value, 5);
  const second = await f.store.save(input(doc({ A1: { value: 10 } }), 1)); assert.equal(second.revision, 2); assert.equal(second.calculation.cells['sheet-one'].C1.value, 13);
  const reopened = createSpreadsheetStore(f.options); assert.equal((await reopened.load({ projectId: 'project-one' })).revision, 2);
  const old = await reopened.loadVersion({ projectId: 'project-one', revision: 1 }); assert.equal(old.document.sheets[0].cells.A1.value, 2); assert.equal((await reopened.load({ projectId: 'project-one' })).revision, 2);
  assert.deepEqual((await reopened.history({ projectId: 'project-one' })).map(item => item.revision), [2, 1]);
  assert.ok((await fs.readFile(path.join(f.project.directory, '.xuzuo', 'workbook-v1.json'), 'utf8')).includes('SUM(A1:B1)'));
});
it('过期版本、危险公式和源写入失败不提前增加revision或覆盖原源', async () => {
  let fail = false;
  const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'workbook-v1.json') throw new Error('source write denied'); return fs.rename(from, to); } };
  const f = await fixture(fileSystem); await f.store.save(input());
  const before = await fs.readFile(path.join(f.project.directory, '.xuzuo', 'workbook-v1.json'), 'utf8');
  await assert.rejects(f.store.save(input()), /另一处更新/);
  await assert.rejects(f.store.save(input(doc({ C1: { value: null, formula: 'WEBSERVICE("https://example.com")' } }), 1)), /外部/);
  fail = true; await assert.rejects(f.store.save(input(doc({ A1: { value: 50 } }), 1)), /source write denied/);
  assert.equal(await fs.readFile(path.join(f.project.directory, '.xuzuo', 'workbook-v1.json'), 'utf8'), before); assert.equal((await f.store.load({ projectId: 'project-one' })).revision, 1);
});
it('实际XLSX有可信公式缓存/格式/重算标记，客户端9999缓存不进入成品', async () => {
  const f = await fixture(); const exported = await f.store.export(input(doc({ D1: { value: '=SUM(A1:B1)' }, E1: { value: '00123' }, F1: { value: 'TRUE' } }))); assert.equal(exported.record.revision, 1); assert.equal(exported.artifacts.length, 2);
  const xlsx = exported.artifacts.find(item => item.name.endsWith('.xlsx')); assert.equal(path.dirname(xlsx.path), path.join(f.project.directory, 'files'));
  const buffer = (await f.artifactStore.read(xlsx.id)).buffer, workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  const cell = workbook.getWorksheet('明细').getCell('C1'); assert.equal(cell.formula, 'SUM(A1:B1)'); assert.equal(cell.result, 5); assert.equal(cell.font.bold, true); assert.ok(cell.numFmt.includes('¥'));
  assert.equal(workbook.getWorksheet('明细').getCell('D1').value, '=SUM(A1:B1)'); assert.equal(workbook.getWorksheet('明细').getCell('D1').formula, undefined); assert.equal(workbook.getWorksheet('明细').getCell('E1').value, '00123'); assert.equal(workbook.getWorksheet('明细').getCell('F1').value, 'TRUE');
  const zip = await JSZip.loadAsync(buffer); assert.match(await zip.file('xl/workbook.xml').async('string'), /fullCalcOnLoad="1"/);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string'); assert.match(xml, /<f>SUM\(A1:B1\)<\/f><v>5<\/v>/); assert.ok(!xml.includes('9999'));
  const report = JSON.parse((await f.artifactStore.read(exported.artifacts.find(item => item.name.endsWith('.json')).id)).buffer.toString()); assert.equal(report.allFormulasValid, true); assert.equal(report.sourceRevision, 1);
});
it('未知/除0公式保留但无假0缓存，语法错误保留为文字并附批注/报告', async () => {
  const f = await fixture(); const exported = await f.store.export(input(doc({ C1: { value: 999, formula: 'SQRT(A1)' }, D1: { value: 888, formula: 'A1/0' }, E1: { value: null, formula: 'SUM(' } })));
  const file = exported.artifacts.find(item => item.name.endsWith('.xlsx')), buffer = (await f.artifactStore.read(file.id)).buffer;
  const zip = await JSZip.loadAsync(buffer), xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const address of ['C1', 'D1']) { const cell = xml.match(new RegExp(`<c[^>]*r="${address}"[^>]*>[\\s\\S]*?<\\/c>`))[0]; assert.ok(cell.includes('<f>')); assert.ok(!cell.includes('<v>')); }
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); assert.equal(workbook.getWorksheet('明细').getCell('E1').value, '=SUM(');
  assert.ok(workbook.getWorksheet('明细').getCell('C1').note); assert.equal(exported.record.calculation.allFormulasValid, false); assert.equal(exported.record.calculation.issues.length, 3);
});
it('后端load也重新计算，不相信磁盘上可被手改的result缓存', async () => {
  const f = await fixture(); await f.store.save(input()); const filename = path.join(f.project.directory, '.xuzuo', 'workbook-v1.json');
  const source = JSON.parse(await fs.readFile(filename, 'utf8')); source.calculation.cells['sheet-one'].C1.value = 999999; await fs.writeFile(filename, JSON.stringify(source), 'utf8');
  assert.equal((await f.store.load({ projectId: 'project-one' })).calculation.cells['sheet-one'].C1.value, 5);
});
it('导出依赖或报告写失败不会提前提交新的编辑版本', async () => {
  const f = await fixture(); await f.store.save(input());
  const broken = createSpreadsheetStore({ ...f.options, loadModule: () => { throw new Error('export dependency failed'); } });
  await assert.rejects(broken.export(input(doc({ A1: { value: 99 } }), 1)), /export dependency failed/);
  const noReport = createSpreadsheetStore({ ...f.options, artifactStore: { ...f.artifactStore, write: async value => { if (value.mimeType === 'application/json') throw new Error('report denied'); return f.artifactStore.write(value); } } });
  await assert.rejects(noReport.export(input(doc({ A1: { value: 99 } }), 1)), /未提前更新/);
  const record = await f.store.load({ projectId: 'project-one' }); assert.equal(record.revision, 1); assert.equal(record.document.sheets[0].cells.A1.value, 2);
});
it('导出源提交失败保留上一revision及已生成文件，不伪称已保存', async () => {
  let fail = false; const fileSystem = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'workbook-v1.json') throw new Error('commit denied'); return fs.rename(from, to); } };
  const f = await fixture(fileSystem); await f.store.save(input()); fail = true;
  await assert.rejects(f.store.export(input(doc({ A1: { value: 20 } }), 1)), /未提前更新/);
  assert.equal((await f.store.load({ projectId: 'project-one' })).revision, 1);
});
it('工作区移动后源/版本跟随项目，费用文件不被表格store读写', async () => {
  const f = await fixture(); await f.store.save(input());
  const ledger = path.join(f.directory, 'cost-record-fixture.json'); await fs.writeFile(ledger, '{"fee":42}\n');
  const second = path.join(f.directory, 'workspace-two'); await fs.mkdir(second); await f.workspaceStorage.bindRoot({ workspaceId: 'workspace-two', name: '第二工作区', directory: second, projects: [] });
  const moved = await f.workspaceStorage.moveProject({ projectId: 'project-one', workspaceId: 'workspace-two', name: '表格项目' });
  const reopened = createSpreadsheetStore(f.options); assert.equal((await reopened.load({ projectId: 'project-one' })).revision, 1); assert.ok((await fs.readFile(path.join(moved.directory, '.xuzuo', 'workbook-v1.json'), 'utf8')).includes('隔离真实表格'));
  assert.equal(await fs.readFile(ledger, 'utf8'), '{"fee":42}\n');
});
