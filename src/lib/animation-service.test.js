import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { fixture, deferred, png } = require('./animation-integration-fixtures.cjs'), core = require('../../electron/animation-document.runtime.cjs');
const active = [];
async function setup(changes) { const f = await fixture(changes); active.push(f); return f; }
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });

describe('角色/GIF服务：真实原生FS/引擎/费用，模型与合成器为明确替身', () => {
  it('双击启动共用原生任务，最终只有一个模型请求及一份有效成品', async () => {
    const f = await setup(), first = f.service.generate({ ...f.input, sampleOnly: true }), duplicate = f.service.generate({ ...f.input, sampleOnly: true }); expect(f.service.isProjectBusy(f.project.id)).toBe(true);
    const [a, b] = await Promise.all([first, duplicate]); expect(a.job.id).toBe(b.job.id); const result = await f.completed();
    expect(result.job.status).toBe('complete'); expect(result.document.entries[0].status).toBe('ready'); expect(f.calls).toHaveLength(1); expect(f.tools).toHaveLength(1); expect(f.service.isProjectBusy(f.project.id)).toBe(false);
    const actual = await f.artifactStore.read(result.document.entries[0].outputArtifactId); expect(actual.mimeType).toBe('image/gif'); expect(actual.buffer.subarray(0, 6).toString()).toBe('GIF89a');
  });
  it('选中第二条先做样片，仅该条目有源帧和成品，不误处理第一条或破坏任务编号', async () => {
    const f = await setup(); await f.store.mutate(f.project.id, document => core.resizeAnimationEntries(document, 2)); await f.service.generate({ ...f.input, sampleOnly: true, entryIds: ['entry-2'] }); const result = await f.completed();
    expect(result.job.status).toBe('complete'); expect(result.job.entryIds).toEqual(['entry-2']); expect(result.job.completedEntryIds).toEqual(['entry-2']); expect(result.document.entries[0].frames).toEqual([]); expect(result.document.entries[0].outputArtifactId).toBeUndefined(); expect(result.document.entries[1].frames).toHaveLength(1); expect(result.document.entries[1].status).toBe('ready'); expect(f.calls).toHaveLength(1); expect(f.tools[0].entries.map(entry => entry.id)).toEqual(['entry-2']);
  });
  it('工具不可用在模型之前报错，清除busy且不会新增run或费用', async () => {
    const f = await setup(); f.controls.unavailable = true; await expect(f.service.generate(f.input)).rejects.toThrow('工具不可用'); expect(f.calls).toHaveLength(0); expect(f.tools).toHaveLength(0); expect(f.service.isProjectBusy(f.project.id)).toBe(false); expect((await f.engine.snapshot()).ledger).toEqual([]); expect((await f.journal.read(f.project.id)).jobs).toEqual([]);
  });
  it('相同源稿继续制作不收费，改字与改速只重新本地合成；恢复版本不减少原生费用', async () => {
    const f = await setup(); await f.service.generate(f.input); const initial = await f.completed(), ledger = structuredClone((await f.engine.snapshot()).ledger);
    await f.service.generate(f.input); await f.completed(); expect(f.calls).toHaveLength(1); expect(f.tools).toHaveLength(1);
    const changed = { ...initial.document, fps: 5, loopMs: 400, entries: initial.document.entries.map(entry => ({ ...entry, caption: '谢谢你' })) }; await f.service.save({ ...f.input, expectedRevision: initial.document.revision, document: changed }); await f.service.compose(f.input);
    expect(f.calls).toHaveLength(1); expect(f.tools).toHaveLength(2); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    const current = await f.service.read(f.input), original = current.history.find(row => row.label === '保存生成角色源稿'); await f.service.restore({ ...f.input, versionId: original.id, expectedRevision: current.document.revision }); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
  });
  it('已保存源图后取消合成，继续只合成本地，不重生图或重记费用', async () => {
    const f = await setup(), gate = deferred(); f.controls.toolGate = gate.promise; f.releases.push(gate.resolve); await f.service.generate(f.input);
    await f.until(async () => f.tools.length, value => value === 1); const source = await f.store.read(f.input), ledger = structuredClone((await f.engine.snapshot()).ledger); expect(source.entries[0].frames).toHaveLength(1);
    const cancelled = await f.service.control({ ...f.input, action: 'cancel' }); expect(cancelled.job.status).toBe('cancelled'); expect(cancelled.document.entries[0].frames).toEqual(source.entries[0].frames);
    f.controls.toolGate = undefined; gate.resolve(); await f.service.control({ ...f.input, action: 'continue' }); const continued = await f.completed(); expect(continued.job.status).toBe('complete'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
  });
  it('从单姿态图集切到轻动效GIF直接沿用素材，不重发模型', async () => {
    const f = await setup(); let document = await f.store.read(f.input); document = { ...document, mode: 'atlas' }; const source = await f.source(document); await f.store.save({ ...f.input, expectedRevision: document.revision, document: { ...document, entries: [source.entry] } }); await f.service.compose(f.input);
    const before = await f.service.read(f.input), switched = await f.service.save({ ...f.input, expectedRevision: before.document.revision, document: { ...before.document, mode: 'gif' } }); expect(switched.document.entries[0].sourceHash).toBe(core.animationArtHash(switched.document, ['entry-1']));
    await f.service.generate(f.input); const result = await f.completed(); expect(result.job.status).toBe('complete'); expect(result.document.entries[0].frames[0].atlasArtifactId).toBe(source.artifact.id); expect(f.calls).toHaveLength(0); expect(f.tools).toHaveLength(2);
  });
  it('局部精修只替换所选源帧，其它帧与源文件保持，实际新增一笔模型费用', async () => {
    const f = await setup(); const initial = await f.store.read(f.input), doc = { ...initial, style: 'illustrated-actions', columns: 3, rows: 2 }, source = await f.source(doc, doc.entries[0], 2); await f.store.save({ ...f.input, expectedRevision: doc.revision, document: { ...doc, entries: [source.entry] } });
    await f.store.mutate(f.project.id, current => { current.entries[0].frames[0].crop = [0, 0, 32, 32]; return current; });
    const before = await f.store.read(f.input), preserved = structuredClone(before.entries[0].frames[1]), raw = (await f.artifactStore.read(source.artifact.id)).buffer;
    await f.service.refine({ ...f.input, entryId: 'entry-1', frameId: before.entries[0].frames[0].id, instruction: '只修好第一帧的左手' }); const result = await f.completed(); expect(result.job.status).toBe('complete');
    expect(result.document.entries[0].frames[0].atlasArtifactId).not.toBe(source.artifact.id); expect(result.document.entries[0].frames[0].crop).toBeUndefined(); expect(result.document.entries[0].frames[1]).toEqual(preserved); expect((await f.artifactStore.read(source.artifact.id)).buffer).toEqual(raw); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1); expect(f.calls[0].kind).toBe('image-editing');
  });
  it('关闭和取消覆盖启动预检查，迟返回的helper不派发模型，最终shutdown后不能再启动', async () => {
    const f = await setup(), gate = deferred(); f.controls.statusGate = gate.promise; f.releases.push(gate.resolve);
    const pending = f.service.generate(f.input), rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError'); let exited = false; const closing = f.service.prepareClose().then(() => { exited = true; }); await Promise.resolve(); expect(exited).toBe(false); gate.resolve(); await closing; await rejected;
    expect(f.calls).toHaveLength(0); expect(f.tools).toHaveLength(0); expect(f.service.isProjectBusy(f.project.id)).toBe(false); await f.service.shutdown(); expect(() => f.service.generate(f.input)).toThrow('退出');
  });
  it('缺失或外项目源图不能合成/导出，不登记虚假成品', async () => {
    const f = await setup(), doc = await f.store.read(f.input); await f.workspaceStorage.ensureProject({ projectId: 'foreign-project', workspaceId: f.project.workspaceId, name: '外项目素材' }); const foreign = await f.artifactStore.write({ projectId: 'foreign-project', name: '外项目.png', mimeType: 'image/png', buffer: png() });
    const entry = { ...doc.entries[0], frames: [{ id: 'frame-one', atlasArtifactId: foreign.id, cell: [0, 0], grid: [1, 1], durationMs: 200 }] }; await f.store.save({ ...f.input, expectedRevision: doc.revision, document: { ...doc, entries: [entry] } }); const result = await f.service.compose(f.input); expect(result.job.status).toBe('failed'); expect(result.job.error).toMatch(/不可用/); expect(f.exported).toHaveLength(0); expect(f.tools).toHaveLength(0);
    await expect(f.service.export({ ...f.input, format: 'atlas' })).rejects.toThrow(/不可用/); const current = await f.store.read(f.input); current.entries[0].frames[0].atlasArtifactId = 'missing-source'; await f.store.save({ ...f.input, expectedRevision: current.revision, document: current }); const missing = await f.service.compose(f.input); expect(missing.job.status).toBe('failed'); expect(f.exported).toHaveLength(0); expect(f.calls).toHaveLength(0);
  });
  it('合法短时完整动作的每个源帧时长仍正数，不能收费后因末帧0ms丢掉结果', async () => {
    const f = await setup(); await f.store.mutate(f.project.id, doc => ({ ...doc, style: 'illustrated-actions', columns: 3, rows: 2, loopMs: 100, fps: 10 })); await f.service.generate(f.input); const result = await f.completed(); expect(result.job.status).toBe('complete'); expect(result.document.entries[0].frames).toHaveLength(6); expect(result.document.entries[0].frames.every(frame => frame.durationMs > 0)).toBe(true); expect(result.document.entries[0].frames.reduce((total, frame) => total + frame.durationMs, 0)).toBe(100); expect(f.calls).toHaveLength(1);
  });
  it('模型已执行时关闭会取消原run且保留费用流水，不继续合成或再派发', async () => {
    const f = await setup(), gate = deferred(); f.controls.modelGate = gate.promise; f.releases.push(gate.resolve); await f.service.generate(f.input);
    await f.until(async () => f.calls.length, value => value === 1); const before = (await f.engine.snapshot()).ledger; expect(before).toHaveLength(1);
    await f.service.prepareClose(); const result = await f.service.read(f.input); expect(result.job.status).toBe('cancelled'); expect(f.calls).toHaveLength(1); expect(f.tools).toHaveLength(0); const after = (await f.engine.snapshot()).ledger; expect(after).toHaveLength(1); expect(after[0].id).toBe(before[0].id); expect(f.service.isProjectBusy(f.project.id)).toBe(false);
  });
  it('合成期间的新编辑不会被迟到结果覆盖，重新合成仍不重生图', async () => {
    const f = await setup(), gate = deferred(); f.controls.toolGate = gate.promise; f.releases.push(gate.resolve); await f.service.generate(f.input); await f.until(async () => f.tools.length, value => value === 1);
    const pending = await f.store.read(f.input), updated = { ...pending, entries: pending.entries.map(entry => ({ ...entry, caption: '正在编辑的新文字' })) }; await f.service.save({ ...f.input, expectedRevision: pending.revision, document: updated }); f.controls.toolGate = undefined; gate.resolve(); const result = await f.completed();
    expect(result.job.status).toBe('failed'); expect(result.job.error).toMatch(/内容已改变/); expect(result.document.entries[0].caption).toBe('正在编辑的新文字'); expect(f.exported).toHaveLength(0);
    const composed = await f.service.compose(f.input); expect(composed.job.status).toBe('complete'); expect(composed.document.entries[0].caption).toBe('正在编辑的新文字'); expect(f.calls).toHaveLength(1); expect(f.tools.at(-1).entries[0].caption).toBe('正在编辑的新文字');
  });
  it('实际GIF/图集/帧ZIP和工程可导出，拆帧与导出不新增原生费用', async () => {
    const f = await setup(); await f.service.generate(f.input); const initial = await f.completed(), ledger = structuredClone((await f.engine.snapshot()).ledger);
    const gif = await f.service.export({ ...f.input, format: 'gif' }); expect(gif.artifact.id).toBe(initial.document.entries[0].outputArtifactId); const atlas = await f.service.export({ ...f.input, format: 'atlas' }); expect(atlas.artifact.id).toBe(initial.document.entries[0].frames[0].atlasArtifactId);
    const Zip = require('./production-test-fixtures.cjs').dependencies('jszip'), zipped = await f.service.export({ ...f.input, format: 'zip' }), zip = await Zip.loadAsync((await f.artifactStore.read(zipped.artifact.id)).buffer, { checkCRC32: true }); expect(Object.keys(zip.files).some(name => name.endsWith('.gif'))).toBe(true); expect(zip.file('使用说明.txt')).not.toBeNull();
    const frames = await f.service.export({ ...f.input, format: 'frames' }), frameZip = await Zip.loadAsync((await f.artifactStore.read(frames.artifact.id)).buffer, { checkCRC32: true }); expect(Object.keys(frameZip.files).filter(name => name.endsWith('.png'))).toHaveLength(2);
    const project = await f.service.export({ ...f.input, format: 'project' }), projectZip = await Zip.loadAsync((await f.artifactStore.read(project.artifact.id)).buffer, { checkCRC32: true }), content = JSON.parse(await projectZip.file('project.json').async('string')); expect(content.document.projectId).toBe(f.project.id); expect(content.document.entries[0].frames).toHaveLength(1); expect(content.sources).toHaveLength(1); expect(projectZip.file(content.sources[0].name)).not.toBeNull(); expect(content.ledger).toBeUndefined(); expect((await f.engine.snapshot()).ledger).toEqual(ledger); expect(f.calls).toHaveLength(1);
    const beforeImport = await f.store.read(f.input), imported = await f.service.importProject({ ...f.input, artifactId: project.artifact.id, expectedRevision: beforeImport.revision }); expect(imported.document.entries[0].frames[0].atlasArtifactId).not.toBe(content.document.entries[0].frames[0].atlasArtifactId); expect(imported.document.entries[0].sourceHash).toBeUndefined(); expect(imported.document.entries[0].inspection).toBeUndefined(); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    await expect(f.service.export({ ...f.input, format: 'unknown' })).rejects.toThrow('请选择');
  });
  it('备份恢复的生成记录不会由继续按钮重新收费派发，但已有源帧可以继续本地合成', async () => {
    const f = await setup(), { remapAnimationJournal } = require('../../electron/animation-journal.cjs'), document = await f.store.read(f.input), source = await f.source(document); await f.store.save({ ...f.input, expectedRevision: document.revision, document: { ...document, entries: [source.entry] } });
    await f.job(); const restored = remapAnimationJournal(await f.journal.read(f.project.id), {}); await f.journal.mutate(f.project.id, () => restored);
    await expect(f.service.control({ ...f.input, action: 'continue' })).rejects.toThrow(/备份恢复|不会重派发/); expect(f.calls).toHaveLength(0);
    await f.journal.mutate(f.project.id, state => { state.jobs[0].stage = 'composing'; return state; }); const local = await f.service.control({ ...f.input, action: 'continue' }); expect(local.job.status).toBe('complete'); expect(f.calls).toHaveLength(0); expect(f.tools).toHaveLength(1);
  });
  it('局部精修丢回包后continue/retry保持refine与选中帧，裁切PNG临时ID变化不重复收费', async () => {
    const holder = {}; const f = await setup({ start: async input => { await holder.value.engine.start(input); throw Error('Synthetic refine response lost'); } }); holder.value = f;
    const document = { ...await f.store.read(f.input), style: 'pixel-actions' }, source = await f.source(document, document.entries[0], 2); await f.store.save({ ...f.input, expectedRevision: document.revision, document: { ...document, entries: [source.entry] } });
    const original = await f.store.read(f.input), frameId = original.entries[0].frames[0].id, preserved = structuredClone(original.entries[0].frames[1]), lookup = f.engine.lookupStart.bind(f.engine); f.engine.lookupStart = async () => { throw Error('Synthetic lookup unavailable'); };
    await f.service.refine({ ...f.input, entryId: 'entry-1', frameId, instruction: '只修好选中帧手部' }); const failed = await f.completed(); expect(failed.job.status).toBe('failed'); await f.until(() => f.engine.snapshot(), value => value.runs.some(run => run.status === 'complete')); const ledger = structuredClone((await f.engine.snapshot()).ledger); expect(f.calls).toHaveLength(1);
    await f.service.control({ ...f.input, action: 'continue' }); const uncertain = await f.completed(); expect(uncertain.job.status).toBe('failed'); expect(f.calls).toHaveLength(1);
    await f.service.control({ ...f.input, action: 'retry' }); const retry = await f.completed(); expect(retry.job.status).toBe('failed'); expect(f.calls).toHaveLength(1); expect((await f.journal.read(f.project.id)).jobs.at(-1).kind).toBe('refine');
    f.engine.lookupStart = lookup; await f.service.control({ ...f.input, action: 'continue' }); const recovered = await f.completed(); expect(recovered.job.status).toBe('complete'); expect(recovered.document.entries[0].frames[0].atlasArtifactId).not.toBe(source.artifact.id); expect(recovered.document.entries[0].frames[1]).toEqual(preserved); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(ledger);
    const jobs = (await f.journal.read(f.project.id)).jobs; expect(jobs.at(-1).kind).toBe('refine'); expect(jobs.at(-1).request).toMatchObject({ entryId: 'entry-1', frameId, instruction: '只修好选中帧手部' });
  });
});
