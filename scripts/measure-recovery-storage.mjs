import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Recovery renderer measurement is CI-only');
assert.equal(process.platform, 'win32', 'The owned renderer measurement expects the Windows runner');
assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
assert(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(path.join(root, 'package.json'));
const { validateEditorDocument } = require('./electron/editor-document.cjs');
const { validateSpreadsheetDocument } = require('./electron/spreadsheet-engine.cjs');
const ts = require('typescript'), nonce = randomUUID(), temporary = await fs.realpath(process.env.RUNNER_TEMP);
const fixture = await fs.mkdtemp(path.join(temporary, 'xuzuo-recovery-measurement-'));
assert.equal(path.dirname(fixture), temporary); assert(!(await fs.lstat(fixture)).isSymbolicLink());

function wordTable(prefix) {
  return { columns: [0, 1].map(index => ({ id: `${prefix}-column-${index}` })), rows: [0, 1].map(row => ({ id: `${prefix}-row-${row}`, cells: [0, 1].map(column => ({ id: `${prefix}-cell-${row}-${column}`, text: row ? String(column * 10) : column ? '金额' : '数量' })) })), header: true, borders: true };
}
function wordCase(characters, count) {
  const block = (id, type, text) => ({ id, type, text, fontSize: 12, bold: false, italic: false, align: 'left' });
  const paragraphs = Array.from({ length: count }, (_, index) => block(`word-p-${index}`, 'paragraph', ''));
  const document = { schemaVersion: 1, kind: 'word', title: '恢复测量合成文稿', blocks: [...paragraphs, { ...block('first-table', 'table', ''), table: wordTable('first') }, { ...block('image-block', 'image', ''), imageId: 'fixture-image-reference' }, { ...block('second-table', 'table', ''), table: wordTable('second') }] };
  const budget = characters - JSON.stringify({ editorDocument: document }).length; assert(budget > 0);
  for (const item of paragraphs) item.text = '测'.repeat(Math.floor(budget / count));
  return { id: `word-${characters}-characters`, payload: { document: validateEditorDocument(document), sourceArtifactIds: ['fixture-source'], baseRevision: 7 }, edit: { kind: 'word', blockId: paragraphs[0].id } };
}
function workbookCase() {
  const cells = {};
  for (let row = 1; row <= 512; row++) {
    cells[`A${row}`] = { value: '', align: 'left', format: 'general' };
    cells[`B${row}`] = { value: row - 1, format: 'currency' };
    cells[`C${row}`] = { value: null, formula: `B${row}*2`, bold: true };
  }
  const document = { schemaVersion: 1, kind: 'excel', title: '恢复测量合成工作簿', sheets: [{ id: 'data-sheet', name: '数据', rowCount: 512, columnCount: 3, cells, columnWidths: { A: 240, B: 120, C: 120 }, view: { header: false } }, { id: 'summary-sheet', name: '汇总', rowCount: 2, columnCount: 2, cells: { A1: { value: null, formula: 'SUM(数据!B1:B512)' }, B1: { value: false } } }] };
  const budget = 2 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(document));
  for (let row = 1; row <= 512; row++) cells[`A${row}`].value = 'A'.repeat(Math.floor(budget / 512));
  return { id: 'excel-near-2MiB', payload: { document: validateSpreadsheetDocument(document), sourceArtifactIds: ['fixture-workbook-source'], baseRevision: 9 }, edit: { kind: 'excel', sheetId: 'data-sheet', address: 'A1' } };
}
const cases = [wordCase(24000, 32), wordCase(180000, 400), workbookCase()];
await fs.mkdir(path.join(fixture, 'profile'));
await fs.writeFile(path.join(fixture, 'owner.json'), JSON.stringify({ kind: 'xuzuo-recovery-measurement', commit: process.env.GITHUB_SHA, nonce }) + '\n', { flag: 'wx' });
await fs.writeFile(path.join(fixture, 'fixtures.mjs'), 'export default ' + JSON.stringify({ nonce, cases }) + ';\n', { flag: 'wx' });
const sources = {};
for (const [source, destination] of [['src/lib/snapshot-serialization.ts', 'snapshot.mjs'], ['src/lib/recovery-draft.ts', 'recovery.mjs']]) {
  const text = await fs.readFile(path.join(root, source), 'utf8');
  sources[source] = createHash('sha256').update(text).digest('hex');
  await fs.writeFile(path.join(fixture, destination), ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText, { flag: 'wx' });
}
await fs.copyFile(path.join(root, 'scripts/fixtures/recovery-storage-renderer.mjs'), path.join(fixture, 'measure.mjs'));
await fs.writeFile(path.join(fixture, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Isolated recovery measurement</title></head><body><script type="module" src="./measure.mjs"></script></body></html>', { flag: 'wx' });

async function run(mode) {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(root, 'scripts/measure-recovery-storage-main.cjs'), fixture, mode, `--user-data-dir=${path.join(fixture, 'profile')}`], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let timedOut = false, stderr = '';
  child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString().slice(0, 8192 - stderr.length); });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000); timer.unref();
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearTimeout(timer); }
  let result;
  try { result = JSON.parse(await fs.readFile(path.join(fixture, `${mode}-result.json`), 'utf8')); } catch { /* A crash may prevent the owned result file. */ }
  if (code !== 0 && result) console.log('RECOVERY_STORAGE_PARTIAL ' + JSON.stringify(result));
  assert(!timedOut, 'Owned measurement process exceeded its 90-second deadline'); assert.equal(code, 0, result?.error || stderr || 'Isolated renderer failed');
  assert(result, 'Isolated renderer produced no result file');
  assert.equal(result.passed, true); assert.equal(result.phase, mode === 'measure' ? 'measured' : 'verified'); return result;
}
const measured = await run('measure'), verified = await run('verify');
assert.equal(measured.samples.length, cases.length); assert.equal(verified.verifiedCases, cases.length);
const report = { passed: true, commit: process.env.GITHUB_SHA, sources, fixture, validatedFixtures: cases.map(item => ({ id: item.id, characters: JSON.stringify(item.payload).length, utf8Bytes: Buffer.byteLength(JSON.stringify(item.payload)) })), measured, verified, scope: 'Real Chromium localStorage primitives in an isolated hidden CI renderer; not production editing/input/IME or user-machine performance', productionRecoveryChanged: false, normalApplicationStarted: false, userProfileAccessed: false, providerCalls: 0 };
await fs.writeFile(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log('RECOVERY_STORAGE_MEASUREMENT ' + JSON.stringify(report));
