import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url), fixtures = require('./incremental-backup-fixtures.cjs');
const { profile, meta, repository, destination, addHistory, addMaterials, patternFile, close, workspaceId, projectId, ownerId, PNG } = fixtures;
const { fileIdentity } = require('../../electron/incremental-backup-paths.cjs');
const { validateManifest } = require('../../electron/backup-format.cjs');
const { createBackupScheduler } = require('../../electron/backup-scheduler.cjs');
const profiles = [];
function memorySample() { const value = process.memoryUsage(); return { rss: value.rss, heapUsed: value.heapUsed, external: value.external, arrayBuffers: value.arrayBuffers }; }
function measureMemory() {
  const baseline = memorySample(), peak = { ...baseline }, phases = {}; let phase = 'fixture', samples = 0;
  const sample = () => { const value = memorySample(); samples++; phases[phase] ||= { ...value }; for (const key of Object.keys(peak)) { peak[key] = Math.max(peak[key], value[key]); phases[phase][key] = Math.max(phases[phase][key], value[key]); } };
  const timer = setInterval(sample, 50); timer.unref?.(); sample();
  return { phase(value) { sample(); phase = value; sample(); }, finish() { clearInterval(timer); sample(); return { baseline, peak, end: memorySample(), phases, sampleIntervalMs: 50, samples, deltaPeak: Object.fromEntries(Object.keys(peak).map(key => [key, peak[key] - baseline[key]])) }; } };
}
async function recordLargeBackupPerformance(value) {
  const requested = process.env.XUZUO_ACCEPTANCE_OUTPUT, directory = path.resolve(requested || path.join(process.cwd(), 'work'));
  if (!requested) await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('Acceptance output must be an ordinary owned directory');
  const sources = {};
  for (const name of ['project-backup.cjs', 'incremental-backup-store.cjs', 'incremental-backup-paths.cjs', 'chat-snapshot-sources.cjs', 'template-snapshot-sources.cjs']) sources['electron/' + name] = createHash('sha256').update(await fs.readFile(new URL('../../electron/' + name, import.meta.url))).digest('hex');
  const filename = path.join(directory, 'incremental-backup-performance-' + randomUUID() + '.json');
  await fs.writeFile(filename, JSON.stringify({ kind: 'xuzuo-incremental-backup-performance', version: 1, measuredAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, localDiagnostic: process.env.GITHUB_ACTIONS !== 'true', producerSourceSha256: createHash('sha256').update(await fs.readFile(new URL('./incremental-backup-native.test.js', import.meta.url))).digest('hex'), fixtureSourceSha256: createHash('sha256').update(await fs.readFile(new URL('./incremental-backup-fixtures.cjs', import.meta.url))).digest('hex'), syntheticFixture: true, realFilesystem: true, sources, ...value }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ largeBackupPerformance: filename, passed: value.passed, inputBytes: value.inputBytes, restoredBytes: value.restoredBytes, peakRss: value.memory.peak.rss, deltaRss: value.memory.deltaPeak.rss }));
}
async function open() { const f = await profile(); profiles.push(f); return f; }
afterEach(async () => {
  for (const f of profiles.splice(0).reverse()) {
    await close(f); const real = await fs.realpath(f.directory), temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(real).toLowerCase() !== temporary.toLowerCase() || !path.basename(real).startsWith('xuzuo-production-')) throw Error('Unowned incremental native fixture');
    await fs.rm(real, { recursive: true, force: true });
  }
});

describe('增量备份的真实服务与独立恢复', () => {
  it('实际模板图片、聊天附件、项目文件和原生费用整体恢复，旧Buffer导出未调用且重复恢复不重记费', async () => {
    const source = await open(); await addHistory(source); const materials = await addMaterials(source), root = await repository(source);
    await fs.writeFile(path.join(source.workspace, 'credentials-v1.json'), '{"apiKey":"SYNTHETIC_FILE_KEY_NOT_FOR_EXPORT"}');
    const chatBufferExport = vi.spyOn(source.chat, 'exportWorkspace'), templateBufferExport = vi.spyOn(source.templates, 'exportWorkspace');
    const result = await source.backup.exportSnapshot({ meta: meta(source), workspaceIds: [workspaceId], repository: root, ownerId });
    expect(chatBufferExport).not.toHaveBeenCalled(); expect(templateBufferExport).not.toHaveBeenCalled();
    const encoded = await fs.readFile(result.snapshotPath, 'utf8'), snapshot = JSON.parse(encoded);
    expect(encoded).not.toContain('SYNTHETIC_METADATA_KEY_NOT_FOR_EXPORT'); expect(encoded).not.toContain('SYNTHETIC_BACKUP_SECRET_NOT_FOR_EXPORT');
    expect(snapshot.manifest.files.some(file => /credentials-v1\.json/.test(file.path))).toBe(false);
    expect(snapshot.manifest.files.some(file => file.path.startsWith('templates/'))).toBe(true); expect(snapshot.manifest.files.some(file => /chat\/.*\/attachments\//.test(file.path))).toBe(true);
    expect((await source.backup.inspectSnapshot(result.snapshotPath)).chatConversations).toBe(1);
    const target = await open(), restore = await destination(target), imported = await target.backup.importSnapshot({ filePath: result.snapshotPath, directory: restore });
    const restoredWorkspace = imported.idMap[workspaceId], restoredProject = imported.idMap[projectId];
    expect(restoredWorkspace).not.toBe(workspaceId); expect(restoredProject).not.toBe(projectId);
    expect(imported.meta.ledger.map(entry => entry.costCents)).toEqual([17]); expect(imported.meta.projects[0].costCents).toBe(17);
    expect((await target.engine.snapshot()).ledger.map(entry => entry.costCents)).toEqual([17]);
    const restored = await target.chat.read({ workspaceId: restoredWorkspace, conversationId: imported.idMap['source-chat'] }), attachment = restored.turns[0].attachments[0];
    expect((await target.chat.previewAttachment({ workspaceId: restoredWorkspace, conversationId: restored.id, attachmentId: attachment.id })).dataUrl).toBe('data:image/png;base64,' + PNG.toString('base64'));
    const chatFees = await target.chat.ledger(restoredWorkspace); expect(chatFees.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(5);
    const [template] = await target.templates.list(restoredWorkspace); expect(template.id).toBe(imported.idMap[materials.template.id]);
    await target.workspaceStorage.ensureProject({ projectId: 'independent-template-copy', workspaceId: restoredWorkspace, name: '模板恢复后可继续复制' });
    const copied = await target.templates.instantiate({ workspaceId: restoredWorkspace, targetProjectId: 'independent-template-copy', templateId: template.id, mode: 'template', kind: 'image', name: '恢复后的独立作品' });
    expect((await target.artifactStore.read(copied.artifacts[0].id)).buffer.equals(PNG)).toBe(true);
    const receipt = JSON.parse(await fs.readFile(imported.receiptPath, 'utf8')); expect(receipt.streamed).toBe(true); expect(JSON.stringify(receipt)).not.toContain('SYNTHETIC_BACKUP_SECRET_NOT_FOR_EXPORT'); expect(receipt.chats[0].attachmentFiles[0].buffer).toBeUndefined();
    await target.backup.importSnapshot({ filePath: result.snapshotPath, directory: restore });
    expect(await target.chat.ledger(restoredWorkspace)).toEqual(chatFees); expect((await target.engine.snapshot()).ledger.map(entry => entry.costCents)).toEqual([17]);
    expect(source.chatCalls).toHaveLength(1); expect(source.calls).toHaveLength(0); expect(target.chatCalls).toHaveLength(0); expect(target.calls).toHaveLength(0);
  }, 30000);
  it('实际保存并恢复576MiB不同字节的数据，分卷真实总量超过512MiB且旧ZIP仍拒绝相同大清单', async () => {
    const source = await open(), expected = [], memory = measureMemory(), timings = {}, started = performance.now();
    let saved, target, restoredBytes = 0, passed = false, failure;
    try {
      const fixtureStarted = performance.now();
      for (let index = 0; index < 6; index++) { const name = `large-${index}.bin`; expected.push({ name, ...await patternFile(path.join(source.project.directory, name), 96 * 1024 * 1024, index + 1) }); }
      timings.fixtureMs = performance.now() - fixtureStarted; memory.phase('backup'); const backupStarted = performance.now();
      const root = await repository(source); saved = await source.backup.exportSnapshot({ meta: meta(source), workspaceIds: [workspaceId], repository: root, ownerId }); timings.backupMs = performance.now() - backupStarted;
      expect(saved.bytes).toBeGreaterThan(512 * 1024 * 1024); expect(saved.newBytes).toBeGreaterThan(512 * 1024 * 1024); expect(saved.verification.peakReadBytes).toBe(256 * 1024);
      const value = JSON.parse(await fs.readFile(saved.snapshotPath, 'utf8')); expect(() => validateManifest(value.manifest)).toThrow('超限');
      memory.phase('restore'); const restoreStarted = performance.now(); target = await open();
      const imported = await target.backup.importSnapshot({ filePath: saved.snapshotPath, directory: await destination(target) }); timings.restoreMs = performance.now() - restoreStarted;
      const location = imported.locations.projects.find(item => item.projectId === imported.idMap[projectId]); memory.phase('verify'); const verifyStarted = performance.now();
      for (const item of expected) { expect(await fileIdentity(fs, path.join(location.directory, item.name))).toEqual({ bytes: item.bytes, sha256: item.sha256 }); restoredBytes += item.bytes; }
      timings.verifyMs = performance.now() - verifyStarted; expect(saved.verification.verifiedBytes).toBe(saved.bytes); expect(target.calls).toHaveLength(0); expect(target.chatCalls).toHaveLength(0); passed = true;
    } catch (error) { failure = String(error?.message || error).slice(0, 2000); throw error; }
    finally {
      const measured = memory.finish(); timings.totalMs = performance.now() - started;
      await recordLargeBackupPerformance({ passed, failure, inputBytes: 576 * 1024 * 1024, actualWrittenInputBytes: expected.reduce((sum, file) => sum + file.bytes, 0), inputFiles: expected, inputDescriptorSha256: createHash('sha256').update(JSON.stringify(expected)).digest('hex'), backupBytes: saved?.bytes, physicalNewBlobBytes: saved?.newBytes, actualVerifiedBackupBytes: saved?.verification?.verifiedBytes, restoredBytes, readBlockBoundBytes: saved?.verification?.peakReadBytes, actualApiCalls: source.calls.length + source.chatCalls.length + (target?.calls.length || 0) + (target?.chatCalls.length || 0), memory: measured, timings });
    }
  }, 180000);
  it('缺失或损坏分卷在创建恢复目录之前拒绝，已成功备份和现有项目保持原样', async () => {
    const source = await open(); await addHistory(source); const root = await repository(source), saved = await source.backup.exportSnapshot({ meta: meta(source), workspaceIds: [workspaceId], repository: root, ownerId });
    const value = JSON.parse(await fs.readFile(saved.snapshotPath, 'utf8')), first = value.files.flatMap(file => file.parts)[0], filename = path.join(root, 'blobs', first.sha256.slice(0, 2), first.sha256 + '.bin');
    await fs.writeFile(filename, Buffer.alloc(first.bytes, 20)); const target = await open(), restore = await destination(target), before = await target.workspaceStorage.list();
    await expect(target.backup.importSnapshot({ filePath: saved.snapshotPath, directory: restore })).rejects.toThrow(/哈希|分卷/);
    expect(await fs.readdir(restore)).toEqual([]); expect(await target.workspaceStorage.list()).toEqual(before); expect((await target.engine.snapshot()).ledger).toEqual([]);
    expect(await fs.readFile(saved.snapshotPath, 'utf8')).toBe(JSON.stringify(value) + '\n');
  }, 15000);
  it('真实空闲调度生成可恢复快照，忙碌和暂停不复制，关闭无新模型或后台写入', async () => {
    const source = await open(), target = path.join(source.directory, 'scheduled-backups'); await fs.mkdir(target); let idle = false;
    const scheduler = createBackupScheduler({ directory: source.directory, backupManager: source.backup, isIdle: () => idle, intervalMs: 20, settleMs: 15 });
    scheduler.start();
    try {
      await scheduler.sync({ workspaceId, meta: meta(source) }); const configured = await scheduler.configure({ workspaceId, enabled: true, directory: target });
      await new Promise(resolve => setTimeout(resolve, 60)); expect(JSON.parse(await fs.readFile(path.join(configured.repository, 'index.json'), 'utf8')).snapshots).toEqual([]);
      idle = true; const deadline = Date.now() + 5000; let status;
      do { status = await scheduler.status({ workspaceId }); if (status.lastSuccess && !status.running) break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
      expect(status.lastSuccess).toBeTruthy(); const inspection = await source.backup.inspectSnapshot(status.lastSnapshot); expect(inspection.projects).toHaveLength(1);
      await scheduler.configure({ workspaceId, enabled: false }); scheduler.markDirty(workspaceId); await new Promise(resolve => setTimeout(resolve, 60));
      expect(JSON.parse(await fs.readFile(path.join(configured.repository, 'index.json'), 'utf8')).snapshots).toHaveLength(1); expect(source.calls).toHaveLength(0); expect(source.chatCalls).toHaveLength(0);
    } finally { await scheduler.shutdown(); }
  }, 15000);
  it('拒绝把工作区恢复进分卷库，允许备份父目录下的独立同级位置且后续仍可备份', async () => {
    const source = await open(), root = await repository(source), saved = await source.backup.exportSnapshot({ meta: meta(source), workspaceIds: [workspaceId], repository: root, ownerId });
    const before = await fs.readFile(path.join(root, 'index.json')), names = await fs.readdir(root), locations = await source.workspaceStorage.list();
    await expect(source.backup.importSnapshot({ filePath: saved.snapshotPath, directory: root })).rejects.toThrow('备份文件夹以外');
    expect((await fs.readFile(path.join(root, 'index.json'))).equals(before)).toBe(true); expect(await fs.readdir(root)).toEqual(names); expect(await source.workspaceStorage.list()).toEqual(locations);
    const imported = await source.backup.importSnapshot({ filePath: saved.snapshotPath, directory: path.dirname(root) });
    expect(imported.locations.workspaces[0].directory.startsWith(root + path.sep)).toBe(false); expect(path.dirname(path.dirname(imported.locations.workspaces[0].directory))).toBe(path.dirname(root));
    const later = await source.backup.exportSnapshot({ meta: meta(source), workspaceIds: [workspaceId], repository: root, ownerId }); expect(later.saved).toBe(true); expect(source.calls).toHaveLength(0); expect(source.chatCalls).toHaveLength(0);
  }, 15000);
});
