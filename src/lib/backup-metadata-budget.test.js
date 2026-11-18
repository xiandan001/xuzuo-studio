import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url), fixtures = require('./incremental-backup-fixtures.cjs');
const { metadataBytes, fileIdentity } = require('../../electron/incremental-backup-paths.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs');
const profiles = [];
afterEach(async () => {
  for (const profile of profiles.splice(0)) {
    await fixtures.close(profile);
    const actual = await fs.realpath(profile.directory), temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(actual).toLowerCase() !== temporary.toLowerCase() || !path.basename(actual).startsWith('xuzuo-production-')) throw Error('Unowned metadata-budget fixture');
    await fs.rm(actual, { recursive: true, force: true });
  }
});

describe('流式备份元数据的提前预算', () => {
  it('真实JSON字节包含中文、转义和代理字符，预算不足在访问下一条正文前停止', () => {
    const value = { text: '中文\n"\\\t😀\ud800x\udfff\u0001', array: [1, -0, 1e-7, null, undefined, true], ignored: undefined };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    expect(metadataBytes(value, bytes)).toBe(bytes);
    expect(() => metadataBytes(value, bytes - 1)).toThrow(/快照未完成/);
    let nextRead = false;
    const record = { first: 'x'.repeat(100), get second() { nextRead = true; throw Error('Must not read the next body'); } };
    expect(() => metadataBytes(record, 30)).toThrow(/快照未完成/); expect(nextRead).toBe(false);
  });
  it('实际文件快照先扣header再传聊天剩余预算，超限不写正文或替换好快照，费用和原记录保留', async () => {
    const source = await fixtures.profile(); profiles.push(source);
    const chatText = 'Synthetic bounded chat body '.repeat(300); expect(chatText.length).toBeLessThanOrEqual(10000);
    await fixtures.addMaterials(source, { chatText });
    const repository = await fixtures.repository(source), good = await source.backup.exportSnapshot({ meta: fixtures.meta(source), workspaceIds: [fixtures.workspaceId], repository, ownerId: fixtures.ownerId });
    const before = await fileIdentity(fs, good.snapshotPath), record = await source.chat.read({ workspaceId: fixtures.workspaceId, conversationId: 'source-chat' }), fees = await source.chat.ledger(fixtures.workspaceId), calls = source.chatCalls.length;
    const exported = vi.spyOn(source.chat, 'exportWorkspaceSources');
    const limited = maximum => createProjectBackup({ directory: source.directory, workspaceStorage: source.workspaceStorage, artifactStore: source.artifactStore, liveEngine: source.engine, chatProvider: source.chat, templateProvider: source.templates, metadataLimitBytes: maximum });
    await expect(limited(8192).exportSnapshot({ meta: fixtures.meta(source), workspaceIds: [fixtures.workspaceId], repository, ownerId: fixtures.ownerId })).rejects.toThrow(/本次快照未完成/);
    expect(exported).toHaveBeenCalledTimes(1); expect(exported.mock.calls[0][1].metadataLimitBytes).toBeGreaterThan(0); expect(exported.mock.calls[0][1].metadataLimitBytes).toBeLessThan(8192);
    await expect(limited(1).exportSnapshot({ meta: fixtures.meta(source), workspaceIds: [fixtures.workspaceId], repository, ownerId: fixtures.ownerId })).rejects.toThrow(/本次快照未完成/);
    expect(exported).toHaveBeenCalledTimes(1);
    expect(await fileIdentity(fs, good.snapshotPath)).toEqual(before); expect(JSON.parse(await fs.readFile(path.join(repository, 'index.json'), 'utf8')).snapshots).toHaveLength(1);
    const incomplete = await fs.readdir(path.join(repository, '.incomplete'));
    const failed = (await Promise.all(incomplete.map(id => fs.readFile(path.join(repository, '.incomplete', id, 'state.json'), 'utf8').then(JSON.parse)))).filter(state => state.phase === 'failed');
    expect(failed).toHaveLength(2); expect(failed.every(state => state.files === 0 && state.bytes === 0)).toBe(true);
    expect(await source.chat.read({ workspaceId: fixtures.workspaceId, conversationId: 'source-chat' })).toEqual(record); expect(await source.chat.ledger(fixtures.workspaceId)).toEqual(fees); expect(source.chatCalls).toHaveLength(calls); expect(source.calls).toHaveLength(0);
  }, 15000);
  it('合法旧产物补全真实hash后再次检查总预算，不能提交下次无法恢复的边界快照', async () => {
    const source = await fixtures.profile(); profiles.push(source);
    const artifact = await source.artifactStore.write({ projectId: fixtures.projectId, name: 'legacy-source.txt', mimeType: 'text/plain', text: 'Synthetic legacy bytes' });
    const manager = maximum => createProjectBackup({ directory: source.directory, workspaceStorage: source.workspaceStorage, artifactStore: source.artifactStore, liveEngine: source.engine, ...(maximum === undefined ? {} : { metadataLimitBytes: maximum }) });
    const repository = await fixtures.repository(source), input = { meta: fixtures.meta(source), workspaceIds: [fixtures.workspaceId], repository, ownerId: fixtures.ownerId };
    const good = await manager().exportSnapshot(input), before = await fileIdentity(fs, good.snapshotPath), snapshot = JSON.parse(await fs.readFile(good.snapshotPath, 'utf8'));
    const actualArtifact = await fileIdentity(fs, artifact.path), indexPath = path.join(source.directory, 'artifacts-v1', 'manifest-v1.json'), index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    const persistedLegacy = index.artifacts.find(entry => entry.id === artifact.id); expect(persistedLegacy.sha256).toBe(actualArtifact.sha256); delete persistedLegacy.sha256;
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n'); const legacyIndex = await fileIdentity(fs, indexPath);
    const maximum = metadataBytes(snapshot.manifest) - 1, original = source.artifactStore.backupEntries; let legacy;
    vi.spyOn(source.artifactStore, 'backupEntries').mockImplementation(async ids => { const entries = await original(ids); legacy = entries.find(entry => entry.id === artifact.id); expect(legacy.sha256).toBeUndefined(); return entries; });
    await expect(manager(maximum).exportSnapshot(input)).rejects.toMatchObject({ code: 'BACKUP_METADATA_LIMIT' });
    expect(legacy.sha256).toBe(actualArtifact.sha256); expect(await fileIdentity(fs, artifact.path)).toEqual(actualArtifact); expect(await fileIdentity(fs, indexPath)).toEqual(legacyIndex);
    const states = await Promise.all((await fs.readdir(path.join(repository, '.incomplete'))).map(id => fs.readFile(path.join(repository, '.incomplete', id, 'state.json'), 'utf8').then(JSON.parse)));
    expect(states.some(state => state.phase === 'failed' && state.files > 0)).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(repository, 'index.json'), 'utf8')).snapshots).toHaveLength(1); expect(await fileIdentity(fs, good.snapshotPath)).toEqual(before);
    expect((await source.engine.snapshot()).ledger).toEqual([]); expect(source.chatCalls).toHaveLength(0); expect(source.calls).toHaveLength(0);
  }, 15000);
});
