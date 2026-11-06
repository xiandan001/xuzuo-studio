import fixtures from './fixtures.mjs';
import { serializeImmutableSnapshot } from './snapshot.mjs';
import { writeRecoveryDraft } from './recovery.mjs';

const iterations = 8, fillerSize = 64 * 1024, samples = [];
const encoder = new TextEncoder();
const namespace = `xuzuo-recovery-measurement:${fixtures.nonce}`;
const markerKey = `${namespace}:complete`, quotaKey = `${namespace}:quota`;
const caseKey = item => `${namespace}:case:${item.id}`;
const scope = 'Isolated Chromium localStorage primitives; not production input/IME or user-machine performance';

function check(condition, code) {
  if (!condition) throw new Error(code);
}

function textAt(payload, edit) {
  if (edit.kind === 'word') {
    const block = payload.document.blocks.find(item => item.id === edit.blockId);
    check(block && typeof block.text === 'string' && block.type === 'paragraph', 'WORD_EDIT_TARGET');
    return block.text;
  }
  check(edit.kind === 'excel', 'EDIT_KIND');
  const cell = payload.document.sheets.find(item => item.id === edit.sheetId)?.cells[edit.address];
  check(cell && typeof cell.value === 'string' && !cell.formula, 'EXCEL_EDIT_TARGET');
  return cell.value;
}

function replaceText(payload, edit, text) {
  textAt(payload, edit);
  const document = edit.kind === 'word'
    ? { ...payload.document, blocks: payload.document.blocks.map(block => block.id === edit.blockId ? { ...block, text } : block) }
    : { ...payload.document, sheets: payload.document.sheets.map(sheet => sheet.id === edit.sheetId
      ? { ...sheet, cells: { ...sheet.cells, [edit.address]: { ...sheet.cells[edit.address], value: text } } }
      : sheet) };
  return { ...payload, document };
}

function editOnce(payload, item, step) {
  return replaceText(payload, item.edit, `${textAt(payload, item.edit)}\nRECOVERY[${fixtures.nonce}/${item.id}/${step}]`);
}

function checkBounds(payload) {
  const text = JSON.stringify(payload.document);
  if (payload.document.kind === 'word') check(text.length <= 200000, 'WORD_SIZE_LIMIT');
  else {
    check(payload.document.kind === 'excel' && encoder.encode(text).byteLength <= 16 * 1024 * 1024, 'EXCEL_SIZE_LIMIT');
    for (const sheet of payload.document.sheets) for (const cell of Object.values(sheet.cells)) {
      check(typeof cell.value !== 'string' || cell.value.length <= 32767, 'EXCEL_CELL_SIZE_LIMIT');
    }
  }
}

function replay(item) {
  let payload = item.payload;
  for (let step = 1; step <= iterations; step++) payload = editOnce(payload, item, step);
  checkBounds(payload);
  return payload;
}

function expandExcel(payload) {
  let changedCells = 0;
  const document = { ...payload.document, sheets: payload.document.sheets.map(sheet => {
    const cells = { ...sheet.cells };
    for (const [address, cell] of Object.entries(cells)) {
      if (/^A[1-9]\d*$/.test(address) && typeof cell.value === 'string' && !cell.formula) {
        cells[address] = { ...cell, value: cell.value + 'Q'.repeat(256) };
        changedCells++;
      }
    }
    return { ...sheet, cells };
  }) };
  check(changedCells > 257, 'QUOTA_EXPANSION_TOO_SMALL');
  const expanded = { ...payload, document };
  checkBounds(expanded);
  return { payload: expanded, changedCells };
}

function measureCase(item) {
  check(localStorage.getItem(caseKey(item)) === null, 'CASE_KEY_ALREADY_EXISTS');
  let payload = item.payload;
  const timings = [];
  for (let step = 1; step <= iterations; step++) {
    const previous = payload, previousText = textAt(previous, item.edit);
    payload = editOnce(previous, item, step);
    check(JSON.stringify(replaceText(payload, item.edit, previousText)) === JSON.stringify(previous), 'UNRELATED_CONTENT_CHANGED');
    checkBounds(payload);
    let started = performance.now();
    const serialized = serializeImmutableSnapshot(payload);
    const serializeMs = performance.now() - started;
    started = performance.now();
    const error = writeRecoveryDraft(localStorage, caseKey(item), serialized);
    const setItemMs = performance.now() - started;
    started = performance.now();
    const latestGetter = () => payload;
    const latest = JSON.stringify(latestGetter());
    const latestGetterMs = performance.now() - started;
    check(!error, 'CASE_WRITE_FAILED');
    check(serialized === latest, 'SERIALIZATION_MISMATCH');
    check(localStorage.getItem(caseKey(item)) === latest, 'STORED_VALUE_MISMATCH');
    timings.push({ step, serializeMs, setItemMs, latestGetterMs, characters: latest.length, utf8Bytes: encoder.encode(latest).byteLength });
  }
  samples.push({ id: item.id, iterations, timings, exactAtEveryStep: true, unrelatedContentPreserved: true });
  return payload;
}

function measureQuota(item, payload) {
  const key = caseKey(item), original = localStorage.getItem(key);
  check(original === JSON.stringify(payload), 'QUOTA_ORIGINAL_MISMATCH');
  const expanded = expandExcel(payload), serialized = serializeImmutableSnapshot(expanded.payload);
  check(serialized === JSON.stringify(expanded.payload), 'QUOTA_SERIALIZATION_MISMATCH');
  check(serialized.length - original.length > fillerSize + 1024, 'QUOTA_EXPANSION_MARGIN');
  const filler = 'F'.repeat(fillerSize), keys = [];
  let quotaReached = false, failedWritePreserved = false;
  try {
    for (let index = 0; index < 512; index++) {
      const fillerKey = `${namespace}:filler:${index}`;
      check(localStorage.getItem(fillerKey) === null, 'FILLER_KEY_ALREADY_EXISTS');
      try { localStorage.setItem(fillerKey, filler); keys.push(fillerKey); }
      catch (error) {
        check(error?.name === 'QuotaExceededError', 'UNEXPECTED_FILL_ERROR');
        quotaReached = true;
        break;
      }
    }
    check(quotaReached, 'QUOTA_NOT_REACHED_WITHIN_BOUND');
    const error = writeRecoveryDraft(localStorage, key, serialized);
    check(Boolean(error), 'QUOTA_WRITE_UNEXPECTEDLY_SUCCEEDED');
    failedWritePreserved = localStorage.getItem(key) === original;
    check(failedWritePreserved, 'QUOTA_FAILED_WRITE_CHANGED_OLD_VALUE');
  } finally {
    for (const fillerKey of keys) localStorage.removeItem(fillerKey);
  }
  check(!writeRecoveryDraft(localStorage, key, serialized), 'QUOTA_RETRY_FAILED');
  check(localStorage.getItem(key) === serialized, 'QUOTA_RETRY_VALUE_MISMATCH');
  localStorage.setItem(quotaKey, JSON.stringify({ caseId: item.id, expanded: true }));
  return { quotaReached, fillerBlocks: keys.length, fillerCharactersPerBlock: fillerSize, changedCells: expanded.changedCells,
    failedWritePreserved, retryWroteExpanded: true, expandedCharacters: serialized.length, expandedUtf8Bytes: encoder.encode(serialized).byteLength };
}

function verify() {
  check(localStorage.getItem(markerKey) === fixtures.nonce, 'COLD_MARKER_MISMATCH');
  const quota = JSON.parse(localStorage.getItem(quotaKey));
  const excel = fixtures.cases.find(item => item.edit.kind === 'excel');
  check(quota?.caseId === excel.id && quota.expanded === true, 'COLD_QUOTA_RECEIPT_MISMATCH');
  for (const item of fixtures.cases) {
    let payload = replay(item);
    if (item === excel) payload = expandExcel(payload).payload;
    const expected = JSON.stringify(payload);
    check(serializeImmutableSnapshot(payload) === expected, 'COLD_SERIALIZATION_MISMATCH');
    check(localStorage.getItem(caseKey(item)) === expected, 'COLD_STORED_VALUE_MISMATCH');
  }
  return { phase: 'verified', verifiedCases: fixtures.cases.length, markerMatched: true, allValuesExact: true, quotaExpansionMatched: true };
}

function run() {
  check(typeof fixtures.nonce === 'string' && /^[a-f0-9-]{36}$/i.test(fixtures.nonce), 'FIXTURE_NONCE');
  check(Array.isArray(fixtures.cases) && fixtures.cases.length === 3, 'FIXTURE_CASE_COUNT');
  check(new Set(fixtures.cases.map(item => item.id)).size === 3, 'FIXTURE_CASE_IDS');
  check(fixtures.cases.filter(item => item.edit.kind === 'word').length === 2 && fixtures.cases.filter(item => item.edit.kind === 'excel').length === 1, 'FIXTURE_CASE_KINDS');
  const marker = localStorage.getItem(markerKey);
  if (marker !== null) return verify();
  const completed = fixtures.cases.map(item => measureCase(item));
  const excelIndex = fixtures.cases.findIndex(item => item.edit.kind === 'excel');
  const quota = measureQuota(fixtures.cases[excelIndex], completed[excelIndex]);
  localStorage.setItem(markerKey, fixtures.nonce);
  check(localStorage.getItem(markerKey) === fixtures.nonce, 'FINAL_MARKER_WRITE_FAILED');
  return { phase: 'measured', samples, quota, markerWritten: true };
}

window.recoveryMeasurement = Promise.resolve().then(run).then(result => ({
  passed: true, nonce: fixtures.nonce, scope, productionRecoveryChanged: false, nativeInputLatencyMeasured: false, providerCalls: 0, ...result,
})).catch(error => ({
  passed: false, phase: 'failed', nonce: fixtures.nonce, scope, samples,
  error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'RENDERER_MEASUREMENT_FAILED',
  errorName: String(error?.name || 'Error').slice(0, 80),
}));
