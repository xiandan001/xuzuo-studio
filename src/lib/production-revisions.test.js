import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createEditorStore } = require('../../electron/editor-store.cjs');
const { createSpreadsheetStore } = require('../../electron/spreadsheet-store.cjs');
function document(kind, text = '第一版完整正文') {
  if (kind === 'excel') return { schemaVersion: 1, kind, title: '独立修订', sheets: [{ id: 'sheet-one', name: '明细', rowCount: 10, columnCount: 5, cells: { A1: { value: 2 }, B1: { value: 3 }, C1: { value: 9999, formula: 'SUM(A1:B1)' }, A2: { value: text } } }] };
  if (kind === 'ppt') return { schemaVersion: 1, kind, title: '独立修订', theme: 'forest', slides: [{ id: 'slide-one', title: '第一页', body: text, notes: '保留演讲备注', layout: 'title-body', fontSize: 20, align: 'left' }] };
  return { schemaVersion: 1, kind, title: '独立修订', blocks: [{ id: 'body-one', type: 'paragraph', text, bold: false, italic: false, fontSize: 14, align: 'left' }] };
}
const textFrom = record => record.document.kind === 'excel' ? record.document.sheets[0].cells.A2.value : record.document.kind === 'ppt' ? record.document.slides[0].body : record.document.blocks[0].text;
async function fixture(kind = 'word', fileSystem = fs) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-independent-revisions-')), directory = path.join(root, '.xuzuo');
  await fs.mkdir(directory);
  const workspaceStorage = { projectDirectory: async id => { if (id !== 'project-one') throw new Error('项目未登记'); return root; } };
  const create = kind === 'excel' ? createSpreadsheetStore : createEditorStore;
  const options = { workspaceStorage, artifactStore: {}, fileSystem };
  const store = create(options), prefix = kind === 'excel' ? 'workbook' : 'editor';
  const input = (text, expectedRevision = 0) => ({ projectId: 'project-one', document: document(kind, text), expectedRevision, sourceArtifactIds: [] });
  return { root, directory, store, options, create, kind, prefix, input, filename: path.join(directory, `${prefix}-v1.json`), snapshots: path.join(directory, `${prefix}-revisions-v1`), load: () => store.load({ projectId: 'project-one', kind }) };
}
const history = f => f.store.history({ projectId: 'project-one' });
const version = (f, revision) => f.store.loadVersion({ projectId: 'project-one', revision });
const restore = (f, revision) => f.store.restore({ projectId: 'project-one', revision });
const snapshotFiles = async f => (await fs.readdir(f.snapshots)).filter(name => name.startsWith('revision-'));

describe('独立不可变修订与显式恢复', () => {
  it.each(['word', 'ppt', 'excel'])('%s主稿损坏后仍能读取完整历史，显式恢复为新修订并保留坏原串', async kind => {
    const f = await fixture(kind);
    await f.store.save(f.input('第一版-END')); await f.store.save(f.input('第二版-END', 1));
    expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).history).toEqual([]);
    const files = await snapshotFiles(f), originals = await Promise.all(files.map(name => fs.readFile(path.join(f.snapshots, name))));
    const broken = '{仅本fixture坏主稿'; await fs.writeFile(f.filename, broken);
    await expect(f.load()).rejects.toThrow(/损坏|无法读取/);
    expect((await history(f)).map(item => item.revision)).toEqual([2, 1]);
    expect(textFrom(await version(f, 1))).toBe('第一版-END'); expect(textFrom(await version(f, 2))).toBe('第二版-END');
    expect(await fs.readFile(f.filename, 'utf8')).toBe(broken);
    const recovered = await restore(f, 1); expect(recovered.revision).toBe(3); expect(textFrom(recovered)).toBe('第一版-END');
    expect(textFrom(await f.load())).toBe('第一版-END');
    const backup = (await fs.readdir(f.directory)).find(name => name.startsWith(`${f.prefix}-before-restore-`));
    expect(await fs.readFile(path.join(f.directory, backup), 'utf8')).toBe(broken);
    for (let index = 0; index < files.length; index++) expect(await fs.readFile(path.join(f.snapshots, files[index]))).toEqual(originals[index]);
    if (kind === 'excel') expect(recovered.calculation.cells['sheet-one'].C1.value).toBe(5);
    const next = await f.store.save(f.input('恢复后继续编辑', 3)); expect(next.revision).toBe(4);
    expect(textFrom(await version(f, 2))).toBe('第二版-END');
  });
  it.each(['word', 'excel'])('%s主稿缺失不会冒充空项目，重开后仍能显式恢复', async kind => {
    const f = await fixture(kind); await f.store.save(f.input('必须保留'));
    await fs.rename(f.filename, `${f.filename}.fixture-removed`);
    const reopened = f.create(f.options);
    await expect(reopened.load({ projectId: 'project-one', kind })).rejects.toThrow('缺失');
    await expect(reopened.save(f.input('不能覆盖缺失主稿'))).rejects.toThrow('缺失');
    expect((await reopened.history({ projectId: 'project-one' })).map(item => item.revision)).toEqual([1]);
    const restored = await reopened.restore({ projectId: 'project-one', revision: 1 }); expect(restored.revision).toBe(2); expect(textFrom(restored)).toBe('必须保留');
  });
  it.each(['word', 'excel'])('%s兼容旧单文件历史，下一次保存迁移旧修订后不再累积主文件history', async kind => {
    const f = await fixture(kind), sourceOne = { version: 1, projectId: 'project-one', revision: 1, savedAt: '2026-10-01T00:00:00Z', sourceArtifactIds: [], document: document(kind, '旧第一版') };
    const sourceTwo = { ...sourceOne, revision: 2, savedAt: '2026-10-02T00:00:00Z', document: document(kind, '旧第二版') };
    await fs.writeFile(f.filename, JSON.stringify({ ...sourceTwo, history: [sourceOne] }));
    expect((await history(f)).map(item => item.revision)).toEqual([2, 1]);
    const next = await f.store.save(f.input('新第三版', 2)); expect(next.revision).toBe(3);
    expect((await snapshotFiles(f)).length).toBe(3);
    expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).history).toEqual([]);
    expect(textFrom(await version(f, 1))).toBe('旧第一版'); expect(textFrom(await version(f, 2))).toBe('旧第二版');
  });
  it.each(['word', 'excel'])('%s旧文件首次操作直接恢复也迁移全部已保存历史，不把旧版本隐去', async kind => {
    const f = await fixture(kind), first = { version: 1, projectId: 'project-one', revision: 1, savedAt: '2026-10-01T00:00:00Z', sourceArtifactIds: [], document: document(kind, '旧版一') };
    await fs.writeFile(f.filename, JSON.stringify({ ...first, revision: 2, document: document(kind, '旧版二'), history: [first] }));
    expect((await restore(f, 1)).revision).toBe(3);
    expect((await history(f)).map(item => item.revision)).toEqual([3, 2, 1]); expect(textFrom(await version(f, 2))).toBe('旧版二');
  });
  it('坏索引和单个坏快照不阻断其他有效修订，修复保存保留原坏索引', async () => {
    const f = await fixture(); await f.store.save(f.input('第一版')); await f.store.save(f.input('第二版', 1));
    const first = (await snapshotFiles(f)).find(name => name.startsWith('revision-1-'));
    await fs.writeFile(path.join(f.snapshots, first), '{broken snapshot');
    await fs.writeFile(path.join(f.snapshots, 'index-v1.json'), '{broken index'); await fs.writeFile(f.filename, '{broken main');
    const items = await history(f); expect(items.map(item => item.revision)).toEqual([2]); expect(items[0].recoveryState).toBe('unverified');
    expect((await restore(f, 2)).revision).toBe(3);
    const savedIndex = (await fs.readdir(f.snapshots)).find(name => name.startsWith('index-invalid-'));
    expect(await fs.readFile(path.join(f.snapshots, savedIndex), 'utf8')).toBe('{broken index');
    expect(await fs.readFile(path.join(f.snapshots, first), 'utf8')).toBe('{broken snapshot');
  });
  it('快照写失败不替换主稿，也不宣称新修订成功', async () => {
    let fail = false;
    const io = { ...fs, writeFile: async (filename, ...args) => { if (fail && path.basename(filename).startsWith('revision-2-')) throw new Error('snapshot denied'); return fs.writeFile(filename, ...args); } };
    const f = await fixture('word', io); await f.store.save(f.input('旧稿')); const before = await fs.readFile(f.filename); fail = true;
    await expect(f.store.save(f.input('新稿', 1))).rejects.toThrow('snapshot denied'); expect(await fs.readFile(f.filename)).toEqual(before);
    fail = false; expect((await f.store.save(f.input('重试新稿', 1))).revision).toBe(2);
  });
  it.each(['index', 'main'])('%s提交失败保留主稿，保留可辨识候选且之后不会复用其revision', async failure => {
    let fail = false;
    const io = { ...fs, rename: async (from, to) => { if (fail && (failure === 'index' ? path.basename(to) === 'index-v1.json' : path.basename(to) === 'editor-v1.json')) throw new Error('commit denied'); return fs.rename(from, to); } };
    const f = await fixture('word', io); await f.store.save(f.input('旧稿')); const before = await fs.readFile(f.filename); fail = true;
    await expect(f.store.save(f.input('候选第二版', 1))).rejects.toThrow('commit denied'); expect(await fs.readFile(f.filename)).toEqual(before);
    expect(textFrom(await version(f, 2))).toBe('候选第二版'); expect((await history(f))[0].recoveryState).not.toBe('saved');
    fail = false; const next = await f.store.save(f.input('实际第三版', 1)); expect(next.revision).toBe(3); expect(textFrom(await version(f, 2))).toBe('候选第二版');
  });
  it('主稿已提交但最后索引提交失败时不倒退主稿，重读可确定已保存修订', async () => {
    let fail = false, writes = 0;
    const io = { ...fs, rename: async (from, to) => { if (fail && path.basename(to) === 'index-v1.json' && ++writes === 2) throw new Error('final index denied'); return fs.rename(from, to); } };
    const f = await fixture('word', io); await f.store.save(f.input('旧稿')); fail = true;
    await expect(f.store.save(f.input('已实际保存的新稿', 1))).rejects.toThrow('final index denied');
    expect((await f.load()).revision).toBe(2); expect((await history(f))[0].recoveryState).toBe('saved');
    fail = false; expect((await f.store.save(f.input('下一稿', 2))).revision).toBe(3);
  });
  it('坏原稿备份失败时不替换它，显式恢复可再次重试', async () => {
    let fail = false;
    const io = { ...fs, writeFile: async (filename, ...args) => { if (fail && path.basename(filename).startsWith('editor-before-restore-')) throw new Error('backup denied'); return fs.writeFile(filename, ...args); } };
    const f = await fixture('word', io); await f.store.save(f.input('可恢复原稿')); await fs.writeFile(f.filename, '{broken'); fail = true;
    await expect(restore(f, 1)).rejects.toThrow('backup denied'); expect(await fs.readFile(f.filename, 'utf8')).toBe('{broken');
    fail = false; const next = await restore(f, 1); expect(next.revision).toBe(3); expect(textFrom(next)).toBe('可恢复原稿');
  });
  it('损坏的非UTF8主稿先逐字节备份，再显式恢复；不会因解码替换而破坏原串', async () => {
    const f = await fixture(); await f.store.save(f.input('完整有效历史'));
    const original = Buffer.from([255, 254, 123, 0, 1, 2, 128]); await fs.writeFile(f.filename, original);
    await expect(f.load()).rejects.toThrow('无法安全读取'); expect((await history(f)).map(item => item.revision)).toEqual([1]);
    expect((await restore(f, 1)).revision).toBe(2);
    const backup = (await fs.readdir(f.directory)).find(name => name.startsWith('editor-before-restore-'));
    expect(await fs.readFile(path.join(f.directory, backup))).toEqual(original);
  });
  it('旧计算引擎的Excel快照按原始字节结构验校验和，再按当前引擎重算，不误判全部历史损坏', async () => {
    const f = await fixture('excel'); await f.store.save(f.input('旧引擎历史'));
    const name = (await snapshotFiles(f))[0], file = path.join(f.snapshots, name);
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    value.record.calculation.engineVersion = 'historical-engine'; value.record.calculation.cells['sheet-one'].C1.value = 999999;
    value.hash = createHash('sha256').update(JSON.stringify(value.record)).digest('hex');
    const migratedName = `revision-1-${value.hash}.json`; await fs.rename(file, path.join(f.snapshots, migratedName)); await fs.writeFile(path.join(f.snapshots, migratedName), JSON.stringify(value));
    const indexFile = path.join(f.snapshots, 'index-v1.json'), index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
    Object.assign(index.entries[0], { fileName: migratedName, hash: value.hash }); await fs.writeFile(indexFile, JSON.stringify(index)); await fs.writeFile(f.filename, '{broken');
    expect((await version(f, 1)).calculation.cells['sheet-one'].C1.value).toBe(5);
    expect((await history(f)).map(item => item.revision)).toEqual([1]);
  });
  it('快照目录被替换为junction时拒绝访问，不读取或覆盖外部目录', async () => {
    const f = await fixture(); await f.store.save(f.input('原稿'));
    const outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), '保持原样');
    await fs.rename(f.snapshots, `${f.snapshots}-original`); await fs.symlink(outside, f.snapshots, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(history(f)).rejects.toThrow(/junction|链接/); await expect(f.store.save(f.input('新稿', 1))).rejects.toThrow(/junction|链接/);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('保持原样'); expect(await fs.readdir(outside)).toEqual(['keep.txt']);
  });
  it('多次较大Word修订累计超过4MB仍可保存，主稿只包含当前修订', async () => {
    const f = await fixture(); const body = '正文'.repeat(7000);
    let revision = 0;
    for (let index = 0; index < 11; index++) {
      const value = document('word'); value.blocks = Array.from({ length: 12 }, (_, id) => ({ ...value.blocks[0], id: `block-${id}`, text: body }));
      revision = (await f.store.save({ projectId: 'project-one', expectedRevision: revision, document: value })).revision;
    }
    const files = await snapshotFiles(f); let total = 0; for (const name of files) total += (await fs.stat(path.join(f.snapshots, name))).size;
    expect(total).toBeGreaterThan(4 * 1024 * 1024); expect((await fs.stat(f.filename)).size).toBeLessThan(4 * 1024 * 1024); expect((await history(f)).length).toBe(11);
  });
  it('Excel独立修订累计超过16MB时继续保存，单个工作簿和重算仍有效', async () => {
    const f = await fixture('excel'), value = document('excel');
    value.sheets[0].rowCount = 100; value.sheets[0].columnCount = 30;
    for (let row = 1; row <= 100; row++) for (let column = 0; column < 26; column++) value.sheets[0].cells[`${String.fromCharCode(65 + column)}${row}`] = { value: '固定数据'.repeat(45) };
    let revision = 0;
    for (let index = 0; index < 7; index++) revision = (await f.store.save({ projectId: 'project-one', expectedRevision: revision, document: value })).revision;
    let total = 0; for (const name of await snapshotFiles(f)) total += (await fs.stat(path.join(f.snapshots, name))).size;
    expect(total).toBeGreaterThan(16 * 1024 * 1024); expect((await fs.stat(f.filename)).size).toBeLessThan(16 * 1024 * 1024); expect((await f.load()).revision).toBe(7);
  });
});
