import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), core = require('../../electron/animation-document.runtime.cjs');
const { createAnimationStore } = require('../../electron/animation-store.cjs');
const { isAnimationPath, isAnimationOpaquePath, validateAnimationBackup, remapAnimationBackup } = require('../../electron/animation-backup.cjs');
const owned = [], stamp = '2026-11-08T06:00:00.000Z';
async function fixture(change = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-animation-data-')), locations = new Map();
  for (const id of ['project-one', 'project-two']) { const project = path.join(directory, id); await fs.mkdir(path.join(project, '.xuzuo'), { recursive: true }); locations.set(id, project); }
  const workspaceStorage = { async projectDirectory(id) { if (!locations.has(id)) throw Error('unknown project'); return locations.get(id); } }, events = [];
  const store = createAnimationStore({ workspaceStorage, clock: () => Date.parse(stamp), onChanged: value => events.push(value), ...change });
  const value = { directory, store, workspaceStorage, events, filename: path.join(locations.get('project-one'), '.xuzuo/animation-v1.json'), historyDirectory: path.join(locations.get('project-one'), '.xuzuo/animation-revisions-v1') }; owned.push(value); return value;
}
afterEach(async () => { for (const value of owned.splice(0)) { await value.store.drain(); const directory = await fs.realpath(value.directory); expect(path.dirname(directory)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-animation-data-/); await fs.rm(directory, { recursive: true, force: true }); } });
describe('角色动画工程原子保存、恢复与备份（真实临时FS）', () => {
  it('首次读取默认草稿但不写文件，保存后CAS拒旧版本、原生重读与事件一致', async () => {
    const f = await fixture(), draft = await f.store.read({ projectId: 'project-one' }); expect(draft.revision).toBe(0); await expect(fs.stat(f.filename)).rejects.toHaveProperty('code', 'ENOENT');
    const saved = await f.store.save({ projectId: draft.projectId, expectedRevision: 0, document: { ...draft, prompt: '第一个源稿' }, label: '样片源稿' }); expect(saved.revision).toBe(1);
    await expect(f.store.save({ projectId: draft.projectId, expectedRevision: 0, document: draft })).rejects.toHaveProperty('code', 'ANIMATION_CONFLICT');
    const reloaded = createAnimationStore({ workspaceStorage: f.workspaceStorage }); expect(await reloaded.read({ projectId: draft.projectId })).toEqual(saved); await reloaded.drain();
    expect(await f.store.history({ projectId: draft.projectId })).toEqual([{ id: 'animation-r1', label: '样片源稿', revision: 1, createdAt: stamp }]); expect(f.events).toEqual([{ projectId: draft.projectId, revision: 1 }]);
  });
  it('排队异步更新不丢条目，不同项目隔离，重复读取和无变化保存不增加版本', async () => {
    const f = await fixture(); await Promise.all(Array.from({ length: 6 }, (_, index) => f.store.mutate('project-one', async doc => { await Promise.resolve(); doc.prompt += `${index},`; })));
    const saved = await f.store.read({ projectId: 'project-one' }); expect(saved.prompt).toBe('0,1,2,3,4,5,'); expect(saved.revision).toBe(6); expect((await f.store.read({ projectId: 'project-two' })).revision).toBe(0);
    const before = f.events.length; await f.store.save({ projectId: saved.projectId, expectedRevision: saved.revision, document: saved }); await f.store.read({ projectId: saved.projectId }); expect(f.events).toHaveLength(before);
    await expect(f.store.save({ projectId: 'project-two', expectedRevision: saved.revision, document: saved })).rejects.toThrow('不属于');
  });
  it('损坏及删掉的保存指针保留原始记录，不静默创建空稿；显式恢复新增版本并保留坏文件', async () => {
    const f = await fixture(); const first = await f.store.mutate('project-one', doc => ({ ...doc, prompt: '应恢复的原稿' })); await f.store.mutate('project-one', doc => ({ ...doc, prompt: '第二稿' }));
    await fs.writeFile(f.filename, '{broken'); await expect(f.store.read({ projectId: 'project-one' })).rejects.toThrow('原文件保留'); expect(await fs.readFile(f.filename, 'utf8')).toBe('{broken');
    await expect(f.store.save({ projectId: 'project-one', expectedRevision: 0, document: core.newAnimationDocument('project-one') })).rejects.toThrow('原文件保留');
    const restored = await f.store.restore({ projectId: 'project-one', versionId: 'animation-r1', expectedRevision: 2 }); expect(restored.revision).toBe(3); expect(restored.prompt).toBe(first.prompt);
    const internal = path.dirname(f.filename), backup = (await fs.readdir(internal)).find(name => name.startsWith('animation-before-restore-')); expect(await fs.readFile(path.join(internal, backup), 'utf8')).toBe('{broken');
    await fs.unlink(f.filename); await expect(f.store.read({ projectId: 'project-one' })).rejects.toThrow('文件缺失'); await expect(fs.stat(f.filename)).rejects.toHaveProperty('code', 'ENOENT');
    const afterDeletion = await f.store.restore({ projectId: 'project-one', versionId: 'animation-r1', expectedRevision: 3 }); expect(afterDeletion.revision).toBe(4); expect(afterDeletion.prompt).toBe(first.prompt);
  });
  it('恢复只增加内容版本，不写账本，不覆盖不可变历史，拒绝过期的恢复基准', async () => {
    const f = await fixture(), ledger = path.join(f.directory, 'ledger.json'), bytes = Buffer.from('[{"costCents":123,"requestId":"request-one"}]\n'); await fs.writeFile(ledger, bytes);
    await f.store.mutate('project-one', doc => ({ ...doc, prompt: '初稿' })); const historyFile = (await fs.readdir(f.historyDirectory)).find(name => name.startsWith('revision-1-')), original = await fs.readFile(path.join(f.historyDirectory, historyFile));
    await f.store.mutate('project-one', doc => ({ ...doc, prompt: '改稿' })); await expect(f.store.restore({ projectId: 'project-one', versionId: 'animation-r1', expectedRevision: 1 })).rejects.toHaveProperty('code', 'ANIMATION_CONFLICT');
    await f.store.restore({ projectId: 'project-one', versionId: 'animation-r1', expectedRevision: 2 }); expect(await fs.readFile(path.join(f.historyDirectory, historyFile))).toEqual(original); expect(await fs.readFile(ledger)).toEqual(bytes);
  });
  it('写入失败不自动采纳prepared快照，继续新保存不重复版本编号', async () => {
    let fail = false; const f = await fixture({ fileSystem: { ...fs, async rename(from, to) { if (fail && path.basename(to) === 'animation-v1.json') { fail = false; throw Error('controlled write failure'); } return fs.rename(from, to); } } });
    await f.store.mutate('project-one', doc => ({ ...doc, prompt: '已保存' })); fail = true; await expect(f.store.mutate('project-one', doc => ({ ...doc, prompt: '失败稿' }))).rejects.toThrow('controlled');
    expect((await f.store.read({ projectId: 'project-one' })).prompt).toBe('已保存'); expect((await f.store.history({ projectId: 'project-one' })).some(row => row.label.includes('未完成保存恢复点'))).toBe(true);
    const saved = await f.store.mutate('project-one', doc => ({ ...doc, prompt: '继续保存' })); expect(saved.revision).toBe(3);
  });
  it('独立版本保留上限30仍保留单调版本编号，原工程与历史都能再读取', async () => {
    const f = await fixture(); for (let index = 0; index < 33; index++) await f.store.mutate('project-one', doc => ({ ...doc, prompt: '版本 ' + index }));
    const history = await f.store.history({ projectId: 'project-one' }); expect(history).toHaveLength(30); expect(history[0].revision).toBe(33); expect(history.at(-1).revision).toBe(4); expect((await f.store.read({ projectId: 'project-one' })).revision).toBe(33);
  }, 30000);
  it('备份只重映射项目/产物，保留条目ID与绑定提示，旧渲染指纹失效但不自动请求模型', async () => {
    const f = await fixture(); await f.store.mutate('project-one', doc => ({ ...doc, modelConfigId: 'model-meta', credentialId: 'key-meta', referenceArtifactIds: ['reference-one'], entries: [{ ...doc.entries[0], frames: [{ id: 'frame-one', atlasArtifactId: 'atlas-one', cell: [0, 0], grid: [1, 1], durationMs: 100 }], sourceHash: 'a'.repeat(64), renderedHash: 'b'.repeat(64), outputArtifactId: 'gif-one', coverArtifactId: 'cover-one', status: 'ready' }] }));
    const record = JSON.parse(await fs.readFile(f.filename, 'utf8')), relative = 'workspace/project/.xuzuo/animation-v1.json'; expect(validateAnimationBackup(record, relative, 'project-one')).toBe(true); expect(() => validateAnimationBackup(record, relative, 'project-two')).toThrow();
    const remapped = remapAnimationBackup(record, { 'project-one': 'restored-project', 'reference-one': 'restored-reference', 'atlas-one': 'restored-atlas', 'gif-one': 'restored-gif', 'cover-one': 'restored-cover', 'entry-1': 'must-not-remap-entry', 'model-meta': 'must-not-remap-model', 'key-meta': 'must-not-remap-key' }, relative);
    expect(remapped.document).toMatchObject({ projectId: 'restored-project', referenceArtifactIds: ['restored-reference'], modelConfigId: 'model-meta', credentialId: 'key-meta' }); expect(remapped.document.entries[0]).toMatchObject({ id: 'entry-1', status: 'stale', outputArtifactId: 'restored-gif', coverArtifactId: 'restored-cover', frames: [{ id: 'frame-one', atlasArtifactId: 'restored-atlas' }] }); expect(remapped.document.entries[0].sourceHash).toBeUndefined(); expect(remapped.document.entries[0].renderedHash).toBeUndefined(); expect(remapped.job).toBeUndefined();
    const versionName = (await fs.readdir(f.historyDirectory)).find(name => name.startsWith('revision-1-')), snapshot = JSON.parse(await fs.readFile(path.join(f.historyDirectory, versionName), 'utf8')), revisionPath = 'project/.xuzuo/animation-revisions-v1/' + versionName; expect(validateAnimationBackup(snapshot, revisionPath, 'project-one')).toBe(true); const revised = remapAnimationBackup(snapshot, { 'project-one': 'restored-project' }, revisionPath); expect(revised.hash).not.toBe(snapshot.hash); expect(revised.record.document.projectId).toBe('restored-project');
    expect(isAnimationPath(relative)).toBe(true); expect(isAnimationPath('project/.xuzuo/other.json')).toBe(false); expect(isAnimationOpaquePath('project/.xuzuo/animation-before-restore-11111111-1111-4111-8111-111111111111.json')).toBe(true);
  });
});
