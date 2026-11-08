import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { createAnimationJournal, checkedAnimationJournal, remapAnimationJournal, isAnimationJournalPath } = require('../../electron/animation-journal.cjs');
const stamp = '2026-11-08T06:00:00.000Z', owned = [];
function job(change = {}) { return { id: 'job-one', projectId: 'project-one', status: 'running', stage: 'generating', entryIds: ['entry-one'], completedEntryIds: [], runIds: ['run-one'], operations: [{ entryId: 'entry-one', entryIds: ['entry-one'], sourceHash: 'a'.repeat(64), dispatchKey: 'b'.repeat(64), status: 'running', runId: 'run-one' }], createdAt: stamp, updatedAt: stamp, ...change }; }
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-animation-journal-')); await fs.mkdir(path.join(directory, '.xuzuo')); const workspaceStorage = { async projectDirectory(id) { if (id !== 'project-one') throw Error('unknown project'); return directory; } }, journal = createAnimationJournal({ workspaceStorage }); const f = { directory, workspaceStorage, journal, filename: path.join(directory, '.xuzuo/animation-jobs-v1.json') }; owned.push(f); return f; }
afterEach(async () => { for (const f of owned.splice(0)) { await f.journal.drain(); const actual = await fs.realpath(f.directory); expect(path.dirname(actual)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(actual)).toMatch(/^xuzuo-animation-journal-/); await fs.rm(actual, { recursive: true, force: true }); } });

describe('原生动画派发日志（真实FS，零网络/模型/GUI）', () => {
  it('空记录只读不制造任务，并发原子更新不丢任务，重启可读', async () => {
    const f = await fixture(); expect(await f.journal.read('project-one')).toEqual({ version: 1, projectId: 'project-one', jobs: [] }); await expect(fs.stat(f.filename)).rejects.toHaveProperty('code', 'ENOENT');
    await Promise.all(Array.from({ length: 3 }, (_, index) => f.journal.mutate('project-one', state => { state.jobs.push(job({ id: 'job-' + index })); return state; }))); const latest = await f.journal.read('project-one'); expect(latest.jobs).toHaveLength(3); const reloaded = createAnimationJournal({ workspaceStorage: f.workspaceStorage }); expect(await reloaded.read('project-one')).toEqual(latest); await reloaded.drain();
  });
  it('坏文件与跨项目归属明确拒绝，原始字节不被空记录覆盖', async () => {
    const f = await fixture(); await fs.writeFile(f.filename, '{broken'); await expect(f.journal.read('project-one')).rejects.toThrow(); await expect(f.journal.mutate('project-one', state => state)).rejects.toThrow(); expect(await fs.readFile(f.filename, 'utf8')).toBe('{broken');
    const foreign = JSON.stringify({ version: 1, projectId: 'other-project', jobs: [] }); await fs.writeFile(f.filename, foreign); await expect(f.journal.read('project-one')).rejects.toThrow('原文件保留'); expect(await fs.readFile(f.filename, 'utf8')).toBe(foreign);
  });
  it('拒绝重复任务、非法派发哈希与不属于原任务的完成条目', () => {
    const state = { version: 1, projectId: 'project-one', jobs: [job()] }; expect(() => checkedAnimationJournal(state, 'project-one')).not.toThrow();
    for (const change of [{ jobs: [job(), job()] }, { jobs: [job({ projectId: 'foreign' })] }, { jobs: [job({ completedEntryIds: ['foreign-entry'] })] }, { jobs: [job({ operations: [{ ...job().operations[0], dispatchKey: 'invalid' }] })] }]) expect(() => checkedAnimationJournal({ ...state, ...change }, 'project-one')).toThrow();
  });
  it('时间戳必须是字符串，不能让数值0被Date.parse误当日期', () => {
    const state = { version: 1, projectId: 'project-one', jobs: [job({ createdAt: 0 })] }; expect(() => checkedAnimationJournal(state, 'project-one')).toThrow();
  });
  it('认可样片的引用按artifact重映射，恢复任务身份保持原样，非法引用拒绝', () => {
    const state = { version: 1, projectId: 'project-one', jobs: [job({ kind: 'generate', request: { projectId: 'project-one', sampleAnchorId: 'sample-source', resumeJobId: 'prior-job' } })] };
    const mapped = remapAnimationJournal(state, { 'project-one': 'new-project', 'sample-source': 'new-sample', 'prior-job': 'must-not-change-job' });
    expect(mapped.jobs[0].request).toEqual({ projectId: 'new-project', sampleAnchorId: 'new-sample', resumeJobId: 'prior-job' });
    state.jobs[0].request.sampleAnchorId = '../foreign'; expect(() => checkedAnimationJournal(state)).toThrow('续作操作');
  });
  it('备份只映射项目、run和artifact，运行态变interrupted/unknown，不能自动恢复派发', () => {
    const state = { version: 1, projectId: 'project-one', jobs: [job({ kind: 'refine', request: { projectId: 'project-one', entryId: 'entry-one', frameId: 'frame-one', instruction: '仅修所选手部' }, operations: [{ ...job().operations[0], status: 'complete', artifactId: 'source-one' }, { ...job().operations[0], dispatchKey: 'c'.repeat(64), status: 'submitting' }] })] }, before = structuredClone(state);
    const result = remapAnimationJournal(state, { 'project-one': 'restored-project', 'run-one': 'restored-run', 'source-one': 'restored-source', 'entry-one': 'must-not-change-entry' }); expect(state).toEqual(before); expect(result).toMatchObject({ projectId: 'restored-project', jobs: [{ projectId: 'restored-project', status: 'interrupted', requiresExplicitRestart: true, request: { projectId: 'restored-project', entryId: 'entry-one', frameId: 'frame-one', instruction: '仅修所选手部' }, entryIds: ['entry-one'], runIds: ['restored-run'] }] }); expect(result.jobs[0].operations[0]).toMatchObject({ status: 'complete', artifactId: 'restored-source', runId: 'restored-run', entryId: 'entry-one' }); expect(result.jobs[0].operations[1].status).toBe('unknown');
    expect(isAnimationJournalPath('workspaces/w/p/.xuzuo/animation-jobs-v1.json')).toBe(true); expect(isAnimationJournalPath('workspaces/w/p/.xuzuo/animation-v1.json')).toBe(false);
  });
});
