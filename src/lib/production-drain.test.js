import { readLiveHistory } from './live-history-test-helper';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createEditorStore } = require('../../electron/editor-store.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createSerialQueue } = require('../../electron/queue-lifecycle.cjs');
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve }; };
const wait = time => new Promise(resolve => setTimeout(resolve, time));
const word = { schemaVersion: 1, kind: 'word', title: '关闭屏障固定稿', blocks: [{ id: 'body', type: 'paragraph', text: '保留完整正文', fontSize: 14, bold: false, italic: false, align: 'left' }] };
function request() {
  return { project: { id: 'project', workspaceId: 'workspace', name: '隔离测试', kind: 'word', costCents: 0 }, workflow: { id: 'flow', workspaceId: 'workspace', name: '仅固定数据', outputKind: 'word', steps: [{ id: 'text', name: '固定内存', kind: 'text', prompt: '固定', modelConfigId: 'model', credentialId: 'metadata', inputSource: 'project', enabled: true }] }, connections: [{ id: 'connection', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1', enabled: true }], models: [{ id: 'model', name: '固定内存', modelId: 'fixture', connectionId: 'connection', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' } }], input: '仅fixture', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
}
describe('退出持久化屏障', () => {
  it('串行队列drain等待所有已入队操作，前一项失败不丢后续任务', async () => {
    const queue = createSerialQueue(), gate = deferred(), entered = deferred(); let complete = false;
    const first = queue.run('project', async () => { entered.resolve(); await gate.promise; throw new Error('fixture failure'); });
    void first.catch(() => undefined);
    const second = queue.run('project', async () => 'saved');
    await entered.promise; const draining = queue.drain().then(() => { complete = true; }); await wait(10); expect(complete).toBe(false);
    gate.resolve(); await expect(first).rejects.toThrow('fixture failure'); expect(await second).toBe('saved'); await draining; expect(complete).toBe(true);
  });
  it('editor.flush等待整个保存及修订索引，返回后没有晚到写入', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-editor-drain-')); await fs.mkdir(path.join(root, '.xuzuo'));
    const gate = deferred(), entered = deferred(); let delayed = false, drained = false, lateWrites = 0;
    const fileSystem = { ...fs, writeFile: async (filename, ...args) => { if (!delayed && path.basename(filename).startsWith('revision-')) { delayed = true; entered.resolve(); await gate.promise; } if (drained) lateWrites++; return fs.writeFile(filename, ...args); } };
    const store = createEditorStore({ workspaceStorage: { projectDirectory: async () => root }, artifactStore: {}, fileSystem });
    const saving = store.save({ projectId: 'project', expectedRevision: 0, document: word }); await entered.promise;
    let returned = false; const flushing = store.flush().then(() => { returned = true; }); await wait(10); expect(returned).toBe(false);
    gate.resolve(); await saving; await flushing; drained = true; await wait(20); expect(lateWrites).toBe(0);
    expect((await store.load({ projectId: 'project', kind: 'word' })).revision).toBe(1);
  });
  it('artifact.drain覆盖进入内部串行队列前的目录解析等待', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-artifact-drain-')), project = path.join(root, 'project'); await fs.mkdir(project);
    const gate = deferred(), entered = deferred(); let delay = true;
    const store = createArtifactStore({ directory: path.join(root, 'control'), workspaceStorage: { projectDirectory: async () => { if (delay) { entered.resolve(); await gate.promise; } return project; }, validateDirectory: async directory => directory } });
    const saving = store.write({ projectId: 'project', name: 'fixture.txt', mimeType: 'text/plain', text: '保存完整结果' }); await entered.promise;
    let drained = false; const draining = store.drain().then(() => { drained = true; }); await wait(10); expect(drained).toBe(false);
    delay = false; gate.resolve(); const file = await saving; await draining; expect((await store.read(file.id)).buffer.toString()).toBe('保存完整结果');
  });
  it.each(['success', 'failure'])('engine.shutdown等待%s执行收尾、最终usage与持久化，重复关闭不重发', async mode => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-engine-drain-')), gate = deferred(), entered = deferred();
    let calls = 0, abortObserved = false, returned = false, lateWrites = 0;
    const engine = createLiveWorkflowEngine({ directory: root, fileSystem: { ...fs, writeFile: async (...args) => { if (returned) lateWrites++; return fs.writeFile(...args); } }, artifactStore: { list: async () => [] }, credentials: { list: async () => [{ id: 'metadata', connectionId: 'connection', enabled: true }] }, modelRuntime: { supports: () => true, execute: async (_input, { signal }) => { calls++; signal.addEventListener('abort', () => { abortObserved = true; }, { once: true }); entered.resolve(); await gate.promise; if (mode === 'failure') throw Object.assign(new Error('fixture cancelled'), { usage: { inputTokens: 30, outputTokens: 10 }, requestStarted: true, name: 'ModelRuntimeError' }); return { text: '完整固定结果', usage: { inputTokens: 30, outputTokens: 10 }, artifacts: [] }; } } });
    await engine.start(request()); await entered.promise;
    let closed = false; const closing = engine.shutdown().then(() => { closed = true; }); await wait(10); expect(closed).toBe(false); expect(abortObserved).toBe(true);
    gate.resolve(); await closing; returned = true; await engine.shutdown(); await engine.flush(); await wait(20);
    const snapshot = await engine.snapshot(); expect(snapshot.runs[0].status).toBe('interrupted'); expect(snapshot.runs[0].attempts[0].status).not.toBe('running'); expect(snapshot.ledger).toHaveLength(1); expect(snapshot.ledger[0].usage.inputTokens).toBe(30); expect(calls).toBe(1); expect(lateWrites).toBe(0);
    await expect(engine.start(request())).rejects.toThrow('退出');
  });
  it('开始任务仍在等待预检时关闭，预检返回后也不能启动模型调用', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-close-validation-')), gate = deferred(), entered = deferred(); let calls = 0;
    const engine = createLiveWorkflowEngine({ directory: root, artifactStore: { list: async () => [] }, credentials: { list: async () => { entered.resolve(); await gate.promise; return [{ id: 'metadata', connectionId: 'connection', enabled: true }]; } }, modelRuntime: { supports: () => true, execute: async () => { calls++; return { text: '不应执行', artifacts: [], usage: {} }; } } });
    const starting = engine.start(request()); void starting.catch(() => undefined); await entered.promise;
    let closed = false; const closing = engine.shutdown().then(() => { closed = true; }); await wait(10); expect(closed).toBe(false);
    gate.resolve(); await expect(starting).rejects.toThrow('退出'); await closing;
    expect(calls).toBe(0); expect((await engine.snapshot()).runs).toEqual([]);
  });
  it('关闭最后一次落盘失败可显式重试关闭，不会永久缓存失败或重新请求模型', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-close-retry-')); let denied = true;
    const engine = createLiveWorkflowEngine({ directory: root, fileSystem: { ...fs, rename: async (from, to) => { if (denied && path.basename(to) === 'index-v2.json') { denied = false; throw new Error('final persistence denied'); } return fs.rename(from, to); } }, artifactStore: { list: async () => [] }, credentials: {}, modelRuntime: {} });
    await expect(engine.shutdown()).rejects.toThrow('final persistence denied'); await engine.shutdown();
    expect((await readLiveHistory(root)).records).toEqual([]);
  });
});
