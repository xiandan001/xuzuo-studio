import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = createRequire(path.join(root, 'work/ui-build/package.json'));
const ts = dependencies('typescript'), loaded = new Map();
function source(filename) {
  const absolute = path.resolve(root, filename), cached = loaded.get(absolute);
  if (cached) return cached.exports;
  const module = { exports: {} }; loaded.set(absolute, module);
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => {
    if (!name.startsWith('.')) return dependencies(name);
    if (name.endsWith('.css')) return {};
    const relative = path.resolve(path.dirname(absolute), name);
    const resolved = ['.ts', '.tsx', '.cjs', '.js'].map(extension => relative + extension).find(candidate => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Benchmark module not found: ${name}`);
    return resolved.endsWith('.cjs') ? dependencies(resolved) : source(resolved);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}
const measure = (count, action) => {
  const begin = performance.now(); for (let index = 0; index < count; index++) action(index);
  const elapsed = performance.now() - begin;
  return { iterations: count, elapsedMs: Number(elapsed.toFixed(3)), meanMs: Number((elapsed / count).toFixed(4)) };
};
const { newWordBlock } = source('src/lib/editor-document.ts');
const { serializeImmutableSnapshot } = source('src/lib/snapshot-serialization.ts');
const { emptyEditHistory, recordEdit } = source('src/lib/edit-history.ts');
const { editorTypingGroup } = source('src/lib/editor-typing-group.ts');
const { wordBlockViewPropsEqual } = source('src/components/WordBlockView.tsx');
const engine = source('src/lib/spreadsheet-engine.ts');
const { createSpreadsheetCalculationCache } = source('src/lib/spreadsheet-calculation-cache.ts');
const { createArtifactPreviewCache } = source('src/lib/artifact-preview-cache.ts');
const noop = () => undefined;
const initialWord = { schemaVersion: 1, kind: 'word', title: '固定300段压测', blocks: Array.from({ length: 300 }, (_, index) => ({ ...newWordBlock('paragraph', `第${index + 1}段：${'固定压测正文，保留全部原文。'.repeat(20)}`), id: `block-${index}` })) };
let word = initialWord, history = emptyEditHistory();
const wordHistoryTyping = measure(200, index => {
  const next = { ...word, blocks: word.blocks.map((block, position) => position === 150 ? { ...block, text: `${block.text}字` } : block) };
  history = recordEdit(history, { document: word }, { document: next }, editorTypingGroup(word, next), 1000 + index * 20); word = next;
});
const beforeProps = initialWord.blocks.map((block, blockIndex) => ({ block, blockIndex, selected: blockIndex === 150, onSelect: noop, onUpdate: noop, onTableChange: noop }));
const skipped = beforeProps.filter((props, index) => wordBlockViewPropsEqual(props, { ...props, block: word.blocks[index] })).length;
const payload = { document: word, sourceArtifactIds: ['fixture'], baseRevision: 1 };
serializeImmutableSnapshot(payload);
const serialization = { ordinary: measure(1000, () => JSON.stringify(payload)), sharedSnapshot: measure(1000, () => serializeImmutableSnapshot(payload)) };

const cells = {};
for (let row = 1; row <= 1000; row++) for (let column = 1; column <= 10; column++) cells[`${engine.columnLabel(column)}${row}`] = column === 10 ? { value: null, formula: `SUM(A${row}:I${row})` } : { value: row + column };
const initialWorkbook = { schemaVersion: 1, kind: 'excel', title: '固定10000格压测', sheets: [{ id: 'sheet-fixed', name: '业务', rowCount: 1000, columnCount: 10, cells }] };
let validationCalls = 0, calculationCalls = 0;
const cache = createSpreadsheetCalculationCache({ validate(input) { validationCalls++; return engine.validateSpreadsheetDocument(input); }, calculate(input) { calculationCalls++; return engine.calculateValidatedSpreadsheet(input); } });
let workbook = initialWorkbook;
const firstCalculation = measure(1, () => cache.calculate(workbook));
const initialValidationCalls = validationCalls, initialCalculationCalls = calculationCalls;
const styleChanges = measure(20, index => {
  const sheet = workbook.sheets[0];
  workbook = cache.validate({ ...workbook, sheets: [{ ...sheet, cells: { ...sheet.cells, A1: { ...sheet.cells.A1, bold: index % 2 === 0, align: index % 2 === 0 ? 'right' : 'left' } } }] });
  cache.calculate(workbook);
});
const styleValidationCalls = validationCalls - initialValidationCalls, styleCalculationCalls = calculationCalls - initialCalculationCalls;
const stableRerenders = measure(1000, () => cache.calculate(workbook));
const beforeValueChange = calculationCalls;
const valueChange = measure(1, () => { const sheet = workbook.sheets[0]; workbook = cache.validate({ ...workbook, sheets: [{ ...sheet, cells: { ...sheet.cells, A1: { value: 500 } } }] }); cache.calculate(workbook); });
const result = cache.calculate(workbook);
const previewCache = createArtifactPreviewCache(); let previewReads = 0;
const read = async () => { previewReads++; return { mimeType: 'text/plain', text: 'synthetic fixture' }; };
await Promise.all(Array.from({ length: 20 }, () => previewCache.preview('fixture', 'artifact', read)));
const previewConcurrentReads = previewReads; await previewCache.preview('fixture', 'artifact', read);
if (skipped !== 299 || history.past.length !== 1 || styleValidationCalls !== 20 || styleCalculationCalls !== 0 || calculationCalls - beforeValueChange !== 1 || previewConcurrentReads !== 1 || previewReads !== 2 || result.cells['sheet-fixed'].J1.value !== 552) throw new Error('Editor performance behavior regression.');
const report = {
  generatedAt: new Date().toISOString(), syntheticOnly: true, node: process.version,
  word: { blocks: 300, typing: wordHistoryTyping, undoEntriesAfter200Characters: history.past.length, memoComparatorUnchangedBlocks: skipped, memoComparatorChangedBlocks: 300 - skipped, serialization },
  spreadsheet: { cells: 10000, formulas: result.formulaCount, firstCalculation, styleChanges, styleValidationCalls, styleCalculationCalls, stableRerenders, valueChange, valueCalculationCalls: calculationCalls - beforeValueChange, checkedFormulaResult: result.cells['sheet-fixed'].J1.value },
  preview: { concurrentRequests: 20, concurrentNativeReads: previewConcurrentReads, nativeReadsAfterReopen: previewReads, retainedSettledPayloadBytes: 0 },
  scope: 'Measures synthetic Node data paths and memo comparator eligibility; does not measure GUI paint, Office rendering, or model requests.',
};
const output = path.join(root, 'outputs/editor-performance-2026-11-01.json');
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
