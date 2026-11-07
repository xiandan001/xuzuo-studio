import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { createRevisionStore } = require('../../electron/revision-store.cjs');
const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) { expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir())); expect(path.basename(directory).startsWith('xuzuo-retention-')).toBe(true); await fs.rm(directory, { recursive: true, force: true }); } });
async function fixture(maxRevisions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-retention-')); directories.push(root);
  const directory = path.join(root, '.xuzuo'); await fs.mkdir(directory);
  const filename = path.join(directory, 'bead-v1.json');
  const location = async () => ({ directory, filename, project: root });
  const store = createRevisionStore({ fileSystem: fs, location, prefix: 'bead', maxBytes: 100000, maxRevisions, validateRecord(value, projectId) {
    if (!value || value.version !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.revision) || typeof value.value !== 'string') throw Error('Invalid test revision');
    return { version: 1, projectId, revision: value.revision, value: value.value };
  } });
  async function save(revision) { const raw = await store.raw('project'); return store.commit('project', { version: 1, projectId: 'project', revision, value: `图纸修订${revision}` }, raw); }
  return { root, directory, filename, store, save, snapshots: path.join(directory, 'bead-revisions-v1') };
}
describe('opt-in bounded automatic revision recovery', () => {
  it('keeps the latest recovery points and high-water revision while preserving explicit exports and unrelated files', async () => {
    const f = await fixture(3); await f.save(1);
    const note = path.join(f.snapshots, 'user-note.txt'), before = path.join(f.directory, 'bead-before-restore-owned.json'), exported = path.join(f.root, '用户明确导出的版本.json');
    for (const file of [note, before, exported]) await fs.writeFile(file, 'KEEP');
    for (let revision = 2; revision <= 7; revision++) await f.save(revision);
    expect((await f.store.list('project')).map(record => record.revision)).toEqual([7, 6, 5]);
    expect((await fs.readdir(f.snapshots)).filter(name => /^revision-/.test(name))).toHaveLength(3);
    expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).revision).toBe(7);
    const index = JSON.parse(await fs.readFile(path.join(f.snapshots, 'index-v1.json'), 'utf8'));
    expect(index.highWater).toBe(7); expect(index.entries).toHaveLength(3); expect(await f.store.nextRevision('project')).toBe(8);
    for (const file of [note, before, exported]) expect(await fs.readFile(file, 'utf8')).toBe('KEEP');
    expect(f.store.retentionStatus().error).toBeUndefined();
  });
  it('leaves existing document and spreadsheet history behaviour unchanged unless retention is explicitly configured', async () => {
    const f = await fixture(undefined); for (let revision = 1; revision <= 7; revision++) await f.save(revision);
    expect(await f.store.list('project')).toHaveLength(7); expect((await fs.readdir(f.snapshots)).filter(name => /^revision-/.test(name))).toHaveLength(7);
  });
  it('does not turn a history cleanup failure into a failed current-document save', async () => {
    const f = await fixture(1); await f.save(1);
    const snapshots = await fs.readdir(f.snapshots), prior = snapshots.find(name => /^revision-/.test(name));
    const value = JSON.parse(await fs.readFile(path.join(f.snapshots, prior), 'utf8')); value.hash = '0'.repeat(64); await fs.writeFile(path.join(f.snapshots, prior), JSON.stringify(value));
    await f.save(2);
    expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).revision).toBe(2);
    expect(f.store.retentionStatus().error).toContain('校验'); expect(await fs.readFile(path.join(f.snapshots, prior), 'utf8')).toContain('00000000');
  });
});
