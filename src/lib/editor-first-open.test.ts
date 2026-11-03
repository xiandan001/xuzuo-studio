import { describe, expect, it } from 'vitest';
import type { EditorRecord } from '../editor-types';
import { emptyEditorDocument, newWordBlock } from './editor-document';
import { editorFromText, editorMissingInputs } from './editor-generated';
import { canAutoLoadEditorSource, isPristineEditorDocument } from './editor-first-open';
import { conflictKey, loadProtectedEditorRecovery, preserveEditorDraft, readRecovery, recoveryDrafts, recoveryKey } from './editor-recovery';

describe('生成文档结构完整保留', () => {
  it('前言与单个JSON围栏的七章Word直接变正文，末尾与缺资料附录保留', () => {
    const source = { title: '完整交付文件', sections: Array.from({ length: 7 }, (_, index) => ({ heading: `第${index + 1}章`, paragraphs: [`完整正文${index + 1}${index === 6 ? '-END' : ''}`] })), meta: { missingInputs: ['需提供实际客户名称'] } };
    const doc = editorFromText('word', '原标题', `以下是完整文档：\n\`\`\`json\n${JSON.stringify(source)}\n\`\`\`\n请核对所列资料。`);
    expect(doc.kind).toBe('word'); if (doc.kind !== 'word') throw new Error('wrong kind');
    expect(doc.blocks.filter(item => item.type === 'heading')).toHaveLength(8);
    expect(doc.blocks.map(item => item.text)).toContain('完整正文7-END');
    expect(editorMissingInputs(doc)).toEqual(['待补充：需提供实际客户名称']);
    expect(doc.blocks.some(item => item.text.includes('"sections"'))).toBe(false);
  });
  it('完整canonical和editorDocument wrapper保留Word格式、图片和PPT页序/备注/主题', () => {
    const word = { ...emptyEditorDocument('word', 'Word'), blocks: [{ ...newWordBlock('image', '插图说明'), imageId: 'picture-one', fontSize: 16, bold: true, align: 'center' as const }] };
    expect(editorFromText('word', '项目', JSON.stringify({ editorDocument: word }))).toEqual(word);
    const ppt = { schemaVersion: 1, kind: 'ppt', title: '忠实页序', theme: 'forest', slides: [{ id: 'slide-two', title: '二', body: '左栏\n---\n右栏', notes: '原备注', layout: 'two-columns', fontSize: 24, align: 'right' }, { id: 'slide-one', title: '一', body: '图片说明', imageId: 'picture-one', notes: '', layout: 'image-full', fontSize: 16, align: 'left' }] };
    expect(editorFromText('ppt', '项目', JSON.stringify(ppt))).toEqual(ppt);
  });
  it('六条要点保持一页，meta放备注不增页，再载入不重复附录', () => {
    const doc = editorFromText('ppt', '项目', JSON.stringify({ title: 'PPT', slides: [{ title: '第一页', bullets: ['一', '二', '三', '四', '五', '六'], notes: '原讲解' }], meta: { missingInputs: ['需要提供数据依据'] } }));
    if (doc.kind !== 'ppt') throw new Error('wrong kind');
    expect(doc.slides).toHaveLength(1); expect(doc.slides[0].body).toBe('一\n二\n三\n四\n五\n六'); expect(doc.slides[0].notes).toContain('原讲解');
    expect(editorMissingInputs(doc)).toEqual(['待补充：需要提供数据依据']);
    expect(editorFromText('ppt', '项目', JSON.stringify({ editorDocument: doc, meta: { missingInputs: ['需要提供数据依据'] } }))).toEqual(doc);
  });
  it.each(['{"title":"未闭合"', '```json\n{"title":"未闭合"', '{"title":"报告","checks":["一"]}', '{"sections":[{"heading":"一","paragraphs":[{"text":"不能变object"}]}]}', '{"slides":[{"title":"错类型","bullets":[{"body":"内容"}]}]}'])('错误或不完整结构不会落成源码段落：%s', raw => {
    expect(() => editorFromText(raw.includes('slides') ? 'ppt' : 'word', '原文保留', raw)).toThrow();
  });
  it('Word Markdown标题与正文不粘连，也不截断最后一段', () => {
    const doc = editorFromText('word', '标题', '# 第一章\n完整段落\n\n- 列表一\n- 列表二\n\n最后-END');
    if (doc.kind !== 'word') throw new Error('wrong kind');
    expect(doc.blocks.map(item => [item.type, item.text])).toEqual([['heading', '第一章'], ['paragraph', '完整段落'], ['bullet', '列表一'], ['bullet', '列表二'], ['paragraph', '最后-END']]);
  });
  it('图片缺编号、歧义正文和追加后超长资料均在载入前拒绝', () => {
    expect(() => editorFromText('word', '项目', JSON.stringify({ blocks: [newWordBlock('image')] }))).toThrow('imageId');
    expect(() => editorFromText('word', '项目', JSON.stringify({ sections: [{ paragraphs: ['正文'] }], body: '另一份正文' }))).toThrow('多种正文');
    expect(() => editorFromText('word', '项目', '长'.repeat(20001))).toThrow('单段');
    expect(() => editorFromText('ppt', '项目', JSON.stringify({ slides: [{ title: '一页', bullets: ['正文'], notes: '原备注' }], meta: { missingInputs: ['长'.repeat(10000)] } }))).toThrow('备注');
  });
});

describe('首次自动载入仅适用于未编辑空稿', () => {
  const title = '新项目';
  it('全空v1和全空恢复稿可自动载入，已有历史或来源不能静默替换', () => {
    const doc = emptyEditorDocument('word', title), record: EditorRecord = { version: 1, projectId: 'project', revision: 1, savedAt: '', document: doc, sourceArtifactIds: [] };
    expect(canAutoLoadEditorSource(doc, title, record, [], 0)).toBe(true);
    expect(canAutoLoadEditorSource(doc, title, null, [], 0)).toBe(true);
    expect(canAutoLoadEditorSource(doc, title, { ...record, revision: 2 }, [], 0)).toBe(false);
    expect(canAutoLoadEditorSource(doc, title, record, ['old-source'], 0)).toBe(false);
    expect(canAutoLoadEditorSource(doc, title, record, [], 1)).toBe(false);
  });
  it('仅改标题、空段落样式、图片或结构均属于人工稿', () => {
    const doc = emptyEditorDocument('word', title); if (doc.kind !== 'word') throw new Error('wrong kind');
    for (const item of [{ ...doc, title: '人工标题' }, { ...doc, blocks: [{ ...doc.blocks[0], bold: true }] }, { ...doc, blocks: [{ ...doc.blocks[0], fontSize: 16 }] }, { ...doc, blocks: [newWordBlock('image')] }, { ...doc, blocks: [...doc.blocks, newWordBlock()] }]) expect(isPristineEditorDocument(item, title)).toBe(false);
    const ppt = emptyEditorDocument('ppt', title); if (ppt.kind !== 'ppt') throw new Error('wrong kind');
    expect(isPristineEditorDocument(ppt, title)).toBe(true);
    expect(isPristineEditorDocument({ ...ppt, theme: 'forest' }, title)).toBe(false);
    expect(isPristineEditorDocument({ ...ppt, slides: [{ ...ppt.slides[0], notes: '人工备注' }] }, title)).toBe(false);
  });
});

describe('一次切换新稿先可靠保留旧稿', () => {
  function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }
  const draft = (content: string) => ({ document: { ...emptyEditorDocument('word', '项目'), blocks: [newWordBlock('paragraph', content)] }, sourceArtifactIds: [], baseRevision: 1 });
  it('坏恢复原串无保存源时阻断，有保存源时先成功保留唯一原串副本', () => {
    const disk = storage(), raw = '{"document":"未闭合原文'; disk.values.set(recoveryKey('project'), raw);
    expect(() => loadProtectedEditorRecovery(disk, 'project', 'word', false)).toThrow('没有项目保存版本');
    expect(disk.values.size).toBe(1); expect(disk.getItem(recoveryKey('project'))).toBe(raw);
    const result = loadProtectedEditorRecovery(disk, 'project', 'word', true);
    expect(result.draft).toBeUndefined(); expect(result.notice).toContain('原始副本'); expect(result.backupKey).toContain('.invalid.'); expect(disk.getItem(result.backupKey!)).toBe(raw); expect(disk.getItem(recoveryKey('project'))).toBe(raw);
  });
  it('原串备份失败不换稿，恢复栈的坏条目也不被静默过滤', () => {
    const disk = storage(), raw = '{bad'; disk.values.set(recoveryKey('project'), raw);
    expect(() => loadProtectedEditorRecovery({ ...disk, setItem: () => { throw new Error('quota'); } }, 'project', 'word', true)).toThrow('副本未能成功保存'); expect(disk.getItem(recoveryKey('project'))).toBe(raw);
    disk.values.set(recoveryKey('project'), JSON.stringify({ ...draft('正文'), previousDrafts: [{ invalid: true }] })); expect(readRecovery(disk, 'project', 'word')).toBeUndefined();
    let reads = 0; const result = loadProtectedEditorRecovery({ getItem: () => { reads++; return raw; }, setItem: () => undefined }, 'project', 'word', true); expect(reads).toBe(1); expect(result.backupKey).toBeTruthy();
  });
  it('多次切换保留所有不同草稿并可读取，重复备份不丢前稿', () => {
    const disk = storage(), one = draft('人工稿一'), two = draft('人工稿二');
    preserveEditorDraft(disk, 'project', one); preserveEditorDraft(disk, 'project', two); preserveEditorDraft(disk, 'project', two);
    expect(recoveryDrafts(readRecovery(disk, 'project', 'word', conflictKey('project'))).map(item => item.document.kind === 'word' ? item.document.blocks[0].text : '')).toEqual(['人工稿二', '人工稿一']);
  });
  it('写入失败或旧副本损坏时抛错，不替换已有恢复内容', () => {
    const disk = storage(); preserveEditorDraft(disk, 'project', draft('旧稿')); const original = disk.getItem(conflictKey('project'));
    expect(() => preserveEditorDraft({ ...disk, setItem: () => { throw new Error('disk full'); } }, 'project', draft('新稿'))).toThrow('disk full');
    expect(disk.getItem(conflictKey('project'))).toBe(original);
    disk.values.set(conflictKey('project'), '{bad'); expect(() => preserveEditorDraft(disk, 'project', draft('新稿'))).toThrow('恢复副本'); expect(disk.getItem(conflictKey('project'))).toBe('{bad');
  });
});
