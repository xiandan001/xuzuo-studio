import { describe, expect, it } from 'vitest';
import { emptyEditorDocument, newWordBlock } from './editor-document';
import { newWordTable } from './word-table';
import { applyDocumentRefinement, applySpreadsheetRefinement, documentRefinementTargets, refinementDiff, spreadsheetRefinementTargets } from './local-refinement';
import type { RefinementContext } from './local-refinement';
import type { SpreadsheetDocument } from '../spreadsheet-types';

describe('scoped edits', () => {
  it('changes only a selected table cell while retaining table IDs, image and formatting', () => {
    const doc = emptyEditorDocument('word', '说明'); if (doc.kind !== 'word') throw new Error('word');
    const paragraph = newWordBlock('paragraph', '保留正文');
    const table = { ...newWordBlock('paragraph', ''), type: 'table' as const, table: newWordTable(), bold: true };
    table.table.rows[1].cells[0].text = '原文'; doc.blocks = [paragraph, table];
    const targets = documentRefinementTargets(doc, table.id, table.table.rows[1].cells[0].id);
    const context: RefinementContext = { version: 1, kind: 'word', targets, instruction: '润色' };
    const diff = refinementDiff(context, JSON.stringify({ changes: [{ id: targets[0].id, value: '完整修订正文' }] }));
    const result = applyDocumentRefinement(doc, diff); if (result.kind !== 'word') throw new Error('word');
    expect(result.blocks[0]).toBe(paragraph); expect(result.blocks[1].bold).toBe(true);
    expect(result.blocks[1].table?.rows[1].cells[0]).toEqual({ id: table.table.rows[1].cells[0].id, text: '完整修订正文' });
    expect(() => applyDocumentRefinement(result, diff)).toThrow('已有变化');
  });
  it('rejects unknown, duplicate IDs and nontext document patches', () => {
    const context: RefinementContext = { version: 1, kind: 'ppt', instruction: '改标题', targets: [{ id: 'slide/title', label: '标题', value: '原文' }] };
    expect(() => refinementDiff(context, '{"changes":[{"id":"other/title","value":"改文"}]}')).toThrow('范围外');
    expect(() => refinementDiff(context, '{"changes":[{"id":"slide/title","value":3}]}')).toThrow('无效');
    expect(() => refinementDiff(context, 'invalid')).toThrow('有效');
  });
  it('edits values without losing styles or formulas, with formula changes explicitly opt in', () => {
    const doc: SpreadsheetDocument = { schemaVersion: 1, kind: 'excel', title: '费用', sheets: [{ id: 'sheet', name: '项目', rowCount: 20, columnCount: 5, cells: { A1: { value: '原文', bold: true }, B1: { value: null, formula: 'SUM(A2:A3)', format: 'currency' }, A2: { value: 1 } } }] };
    const targets = spreadsheetRefinementTargets(doc, 'sheet', 'A1:B1'); expect(targets).toHaveLength(1);
    const diff = refinementDiff({ version: 1, kind: 'excel', targets, instruction: '润色' }, '{"changes":[{"id":"sheet/A1","value":"修订"}]}');
    const result = applySpreadsheetRefinement(doc, diff);
    expect(result.sheets[0].cells.A1).toEqual({ value: '修订', bold: true }); expect(result.sheets[0].cells.B1).toBe(doc.sheets[0].cells.B1);
    expect(spreadsheetRefinementTargets(doc, 'sheet', 'A1:B1', true)).toHaveLength(2);
    expect(() => spreadsheetRefinementTargets(doc, 'sheet', 'BAD')).toThrow('区域');
  });
});
