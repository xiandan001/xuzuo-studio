import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { chatFileDocument, chatNodeText } from './chat-file-document';
import { parseChatMarkdown } from './chat-markdown';
import { validateSpreadsheetDocument } from './spreadsheet-engine';
import type { EditorDocument } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
const require = createRequire(import.meta.url);
const { validateEditorDocument } = require('../../electron/editor-document.cjs') as { validateEditorDocument: (document: unknown) => EditorDocument };
const { fixture, dependencies, request, until, word } = require('./production-test-fixtures.cjs');
const resources: { directory: string; engine: { shutdown: () => Promise<void> } }[] = [];
afterEach(async () => { for (const item of resources.splice(0)) { await item.engine.shutdown(); await fs.rm(item.directory, { recursive: true, force: true }); } });
const brokenUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('已有聊天回复转换成真实Office编辑源', () => {
  it('实际export-only工作流不调用模型，不覆盖已有人工稿，预览从本轮文件来源读取完整正文', async () => {
    const f = await fixture(); resources.push(f); const input = request();
    await f.workspaceStorage.ensureProject({ projectId: input.project.id, workspaceId: input.project.workspaceId, name: input.project.name, kind: input.project.kind });
    const original = await f.editorStore.save({ projectId: input.project.id, expectedRevision: 0, document: word('必须保留的人工草稿') });
    const source = '# 回复文稿\n\nLOCAL-EXPORT-END', document = chatFileDocument(source, 'word', '本地回复');
    input.workflow.steps = [{ id: 'export-only', name: '保存真实Office', kind: 'export', prompt: '', enabled: true, inputSource: 'project', referenceArtifactIds: [] }];
    input.workflow.sourceChat = { conversationId: 'conversation', turnId: 'reply', sha256: 'a'.repeat(64) }; input.input = JSON.stringify(document); input.connections = []; input.models = [];
    const accepted = await f.engine.start(input), snapshot = await until(() => f.engine.snapshot(), (value: { runs: { id: string; status: string }[] }) => value.runs.some(item => item.id === accepted.id && item.status === 'complete'));
    const run = await f.engine.runDetail(accepted.id), artifact = run.attempts.flatMap((item: { artifacts?: ArtifactMetadata[] }) => item.artifacts || []).find((item: ArtifactMetadata) => item.kind === 'office');
    expect(artifact).toBeTruthy(); expect(run.snapshot.sourceChat).toEqual(input.workflow.sourceChat); expect(f.calls).toEqual([]); expect(snapshot.ledger).toEqual([]);
    expect(await f.editorStore.load({ projectId: input.project.id, kind: 'word' })).toEqual(original);
    const preview = require('../../electron/artifact-document-preview.cjs').createDocumentArtifactPreview({ liveEngine: f.engine, editorStore: f.editorStore, spreadsheetStore: f.spreadsheetStore });
    const bound = await preview(artifact); expect(JSON.parse(bound.text)).toEqual(document); expect(bound.text).toContain('LOCAL-EXPORT-END');
  });
  it('Word保留标题、段落、嵌套列表、勾选、表格、代码与链接，满足正式editor schema', () => {
    const source = '# 客户交付\n\n完整正文 **重点** 与 [来源](https://example.com/source?q=1)。\n\n- 外层\n  - 内层\n- [x] 已确认\n\n| 项目 | 内容 |\n| --- | --- |\n| 编号 | 00123 |\n\n```js\nconst formula = "=SUM(A1:A2)";\n```';
    const output = chatFileDocument(source, 'word', '客户文稿'); expect(output.kind).toBe('word'); if (output.kind !== 'word') throw Error('expected word');
    expect(validateEditorDocument(output)).toEqual(output); const text = output.blocks.map(block => block.text).join('\n');
    expect(text).toContain('客户交付'); expect(text).toContain('完整正文 重点 与 来源（https://example.com/source?q=1）'); expect(text).toContain('外层'); expect(text).toContain('内层'); expect(text).toContain('☑ 已确认'); expect(text).toContain('const formula = "=SUM(A1:A2)";');
    expect(output.blocks.find(block => block.type === 'table')?.table?.rows[1].cells[1].text).toBe('00123');
  });
  it('Word长段落按schema上限完整分块，跨边界emoji不产生孤立代理项', () => {
    const text = '字'.repeat(19999) + '😀' + '尾'.repeat(20003) + 'END-WORD'; const output = chatFileDocument(text, 'word', '长段落');
    if (output.kind !== 'word') throw Error('expected word'); expect(validateEditorDocument(output)).toEqual(output);
    expect(output.blocks.map(block => block.text).join('')).toBe(text); expect(output.blocks.every(block => block.text.length <= 20000 && !brokenUnicode.test(block.text))).toBe(true);
  });
  it('PPT长段落续页、超长标题与emoji不丢字，末段和链接仍在真实提纲', () => {
    const heading = '题'.repeat(109) + '😀' + '余题', body = '文'.repeat(649) + '😀' + '后文'.repeat(700) + 'END-PPT';
    const output = chatFileDocument(`# ${heading}\n\n${body}\n\n[资料](https://example.com/full)`, 'ppt', '完整演示');
    if (output.kind !== 'ppt') throw Error('expected ppt'); expect(validateEditorDocument(output)).toEqual(output); expect(output.slides.length).toBeGreaterThan(2);
    const content = output.slides.map(slide => slide.body).join('').replace(/\s/g, ''); expect(content).toContain(heading); expect(content).toContain(body); expect(content).toContain('资料（https://example.com/full）');
    expect(output.slides.some(slide => slide.title.includes('续'))).toBe(true); expect(output.slides.every(slide => slide.body.length <= 650 && !brokenUnicode.test(slide.title + '\n' + slide.body))).toBe(true);
  });
  it('PPT列表中的段落与嵌套项保持可读分隔，不把两段文字粘连', () => {
    const source = '- 第一段\n\n  第二段\n\n  - 子项\n\n- 另一项'; const text = parseChatMarkdown(source).map(chatNodeText).join('\n');
    expect(text).toContain('第一段\n第二段'); expect(text).toContain('第二段\n子项'); expect(text).not.toContain('第一段第二段');
    const output = chatFileDocument('# 安排\n\n' + source, 'ppt', '安排'); if (output.kind !== 'ppt') throw Error('expected ppt'); expect(output.slides.map(slide => slide.body).join('\n')).toContain('第一段\n第二段');
  });
  it('Excel只转换明确表格，编号、0/false和公式样式字符串保留为文本，不执行外部公式', () => {
    const source = '| 项目 | 原文 |\n| --- | --- |\n| 编号 | 00123 |\n| 数量 | 0 |\n| 状态 | false |\n| 公式样式 | =HYPERLINK("https://example.com","打开") |\n| 普通公式样式 | =SUM(A1:A2) |';
    const output = chatFileDocument(source, 'excel', '文本资料'); if (output.kind !== 'excel') throw Error('expected excel'); expect(validateSpreadsheetDocument(output)).toEqual(output);
    expect(output.sheets[0].cells.B2.value).toBe('00123'); expect(output.sheets[0].cells.B3.value).toBe('0'); expect(output.sheets[0].cells.B4.value).toBe('false'); expect(output.sheets[0].cells.B5.value).toBe('=HYPERLINK("https://example.com","打开")');
    expect(Object.values(output.sheets[0].cells).every(cell => cell.formula === undefined)).toBe(true); expect(() => chatFileDocument('只有一段普通文字', 'excel', '资料')).toThrow('表格');
  });
  it('将三种规范编辑源真正导出并重新读取OOXML，公式样式仍是字符串，原聊天不变且不调用模型', async () => {
    const f = await fixture(); resources.push(f); await f.workspaceStorage.ensureProject({ projectId: 'chat-file-project', workspaceId: 'production-workspace', name: '聊天文件' });
    const source = '# 完整客户方案\n\n正文-END-WORD\n\n## 交付\n\n末页-END-PPT\n\n| 项目 | 内容 |\n| --- | --- |\n| 编号 | 00123 |\n| 表达式 | =1+1 |';
    for (const kind of ['word', 'ppt', 'excel'] as const) {
      const document = chatFileDocument(source, kind, '聊天完整资料'), artifacts = await f.artifactStore.exportOffice({ kind, title: document.title, text: JSON.stringify(document), projectId: 'chat-file-project', assets: [] });
      const office = artifacts.find((file: ArtifactMetadata) => file.kind === 'office'); expect(office).toBeTruthy(); const saved = await f.artifactStore.read(office.id), zip = await dependencies('jszip').loadAsync(saved.buffer);
      if (kind === 'word') expect(await zip.file('word/document.xml').async('string')).toContain('正文-END-WORD');
      else if (kind === 'ppt') { const pages = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)); expect(pages.length).toBeGreaterThan(1); expect((await Promise.all(pages.map(name => zip.file(name).async('string')))).join('')).toContain('末页-END-PPT'); }
      else { const Excel = dependencies('exceljs'), workbook = new Excel.Workbook(); await workbook.xlsx.load(saved.buffer); expect(workbook.worksheets[0].getCell('B2').value).toBe('00123'); expect(workbook.worksheets[0].getCell('B3').value).toBe('=1+1'); expect(workbook.worksheets[0].getCell('B3').formula).toBeUndefined(); }
    }
    expect(source).toContain('正文-END-WORD'); expect(f.calls).toEqual([]); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('超过范围明确报错，避免静默截断部分回复', () => {
    expect(() => chatFileDocument('文本', 'word', ' ')).toThrow('标题'); expect(() => chatFileDocument('字'.repeat(120001), 'word', '过长')).toThrow('拆分');
    const tooManyRows = '| A |\n| --- |\n' + Array.from({ length: 31 }, (_, index) => `| ${index} |`).join('\n'); expect(() => chatFileDocument(tooManyRows, 'word', '表格')).toThrow('Excel');
  });
});
