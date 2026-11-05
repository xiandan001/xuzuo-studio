import { describe, expect, it } from 'vitest';
import type { WordEditorDocument, WordTable } from '../editor-types';
import type { RecoveryDraft } from './editor-recovery';
import { conflictKey, loadProtectedEditorRecovery, parseEditorRecovery, preserveEditorDraft, readRecovery, recoveryKey } from './editor-recovery';
import { newWordTable } from './word-table';

function richDraft(): RecoveryDraft & { document: WordEditorDocument } {
  const first = newWordTable(), second = newWordTable();
  first.rows[0].cells[0].text = '执行阶段'; first.rows[1].cells[0].text = '第一周';
  second.rows[0].cells[0].text = '预算'; second.rows[1].cells[1].text = '400元';
  return { baseRevision: 1, sourceArtifactIds: ['generated-source', 'project-image'], document: { schemaVersion: 1, kind: 'word', title: '双表图文方案', blocks: [
    { id: 'heading', type: 'heading', text: '执行与预算', fontSize: 20, bold: true, italic: false, align: 'left' },
    { id: 'first-table', type: 'table', text: '', table: first, fontSize: 12, bold: false, italic: false, align: 'left' },
    { id: 'body', type: 'paragraph', text: '保留已经确认的事实。', fontSize: 14, bold: false, italic: true, align: 'center' },
    { id: 'picture', type: 'image', text: '现有配图', imageId: 'project-image', fontSize: 12, bold: false, italic: false, align: 'center' },
    { id: 'second-table', type: 'table', text: '', table: second, fontSize: 12, bold: false, italic: false, align: 'right' },
  ] } };
}
function storage(raw?: string) {
  const values = new Map<string, string>();
  if (raw !== undefined) values.set(recoveryKey('project'), raw);
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const malformedTables: Array<[string, (table: WordTable) => void]> = [
  ['empty columns', table => { table.columns = []; }],
  ['mismatched cells', table => { table.rows[0].cells.pop(); }],
  ['duplicate IDs', table => { table.rows[0].id = table.columns[0].id; }],
  ['unsupported fields', table => { (table as unknown as Record<string, unknown>).mergedCells = []; }],
  ['too many rows', table => { table.rows = Array.from({ length: 31 }, () => structuredClone(table.rows[0])); }],
  ['oversized cell', table => { table.rows[0].cells[0].text = '长'.repeat(20001); }],
  ['invalid header flag', table => { (table as unknown as Record<string, unknown>).header = 'yes'; }],
];

describe('native table Word recovery', () => {
  it('round-trips both tables, images, styles and stable IDs without normalizing the payload', () => {
    const draft = richDraft(), raw = JSON.stringify(draft);
    expect(parseEditorRecovery(raw, 'word')).toEqual(draft);
    expect(JSON.stringify(draft)).toBe(raw);
  });
  it.each([false, true])('loads a valid rich draft without quarantining it; saved source=%s', hasSavedSource => {
    const draft = richDraft(), raw = JSON.stringify(draft), disk = storage(raw);
    const result = loadProtectedEditorRecovery(disk, 'project', 'word', hasSavedSource);
    expect(result).toEqual({ draft }); expect(disk.values.size).toBe(1);
    expect(disk.getItem(recoveryKey('project'))).toBe(raw);
  });
  it('retains native-table conflict history and deduplicates only identical snapshots', () => {
    const first = richDraft(), next = structuredClone(first), disk = storage();
    next.document.blocks[1].table!.rows[1].cells[0].text = '第一周已确认';
    preserveEditorDraft(disk, 'project', first); preserveEditorDraft(disk, 'project', next); preserveEditorDraft(disk, 'project', next);
    expect(readRecovery(disk, 'project', 'word', conflictKey('project'))).toEqual({ ...next, previousDrafts: [first] });
  });
  it('keeps a rich conflict copy intact if the next copy cannot be written', () => {
    const draft = richDraft(), disk = storage(); preserveEditorDraft(disk, 'project', draft);
    const original = disk.getItem(conflictKey('project'));
    expect(() => preserveEditorDraft({ getItem: disk.getItem, setItem: () => { throw new Error('quota'); } }, 'project', draft)).toThrow('quota');
    expect(disk.getItem(conflictKey('project'))).toBe(original);
  });
  it.each(malformedTables)('rejects %s and preserves raw data when falling back to a saved source', (_label, mutate) => {
    const draft = richDraft(); mutate(draft.document.blocks[1].table!);
    const raw = JSON.stringify(draft), disk = storage(raw);
    expect(parseEditorRecovery(raw, 'word')).toBeUndefined();
    const result = loadProtectedEditorRecovery(disk, 'project', 'word', true);
    expect(result.draft).toBeUndefined(); expect(result.backupKey).toBeTruthy();
    expect(disk.getItem(recoveryKey('project'))).toBe(raw); expect(disk.getItem(result.backupKey!)).toBe(raw);
  });
  it('rejects a table block missing its table or mixing table and paragraph content', () => {
    const missing = richDraft(); missing.document.blocks[1].table = undefined;
    expect(parseEditorRecovery(JSON.stringify(missing), 'word')).toBeUndefined();
    const mixed = richDraft(); mixed.document.blocks[1].text = '不能把正文混在原生表格字段';
    expect(parseEditorRecovery(JSON.stringify(mixed), 'word')).toBeUndefined();
  });
  it('rejects malformed tables inside previous drafts as well', () => {
    const draft = richDraft(), previous = richDraft(); previous.document.blocks[1].table!.rows[0].cells = [];
    draft.previousDrafts = [previous];
    expect(parseEditorRecovery(JSON.stringify(draft), 'word')).toBeUndefined();
  });
});
