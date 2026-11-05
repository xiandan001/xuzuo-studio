import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { exportModelReceiptBackup, validateModelReceiptBackup, mergeModelReceiptImport } = require('../../electron/model-receipt-backup.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture() {
  const result = { text: '已有完整内容', artifacts: [{ id: 'artifact-one', projectId: 'project-one', runId: 'run-one', name: 'image.png', kind: 'image', mimeType: 'image/png', bytes: 17, path: 'C:\\original-machine\\image.png', provenance: { author: '作者', origin: 'original', path: 'C:\\original-machine\\license.txt', secret: 'FAKE-SECRET' } }], usage: { inputTokens: 100, outputTokens: 17, totalTokens: 117, secret: 'FAKE-SECRET' }, billingRequestSnapshot: { version: 1, providerId: 'fixture', modelId: 'fixture-model', operation: 'generate', secret: 'FAKE-SECRET' }, headers: { Authorization: 'FAKE-SECRET' } };
  const record = { version: 1, requestId: 'attempt-one', runId: 'run-one', projectId: 'project-one', fingerprint: 'a'.repeat(64), status: 'complete', requestStarted: true, result, resultSha256: hash(result), createdAt: '2026-11-03', completedAt: '2026-11-03', secret: 'FAKE-SECRET' };
  const records = exportModelReceiptBackup([record], { projectIds: ['project-one'] }), idMap = { 'project-one': 'new-project', 'run-one': 'new-run', 'attempt-one': 'new-attempt', 'artifact-one': 'new-artifact' };
  const options = { records, idMap, backupId: 'backup-one', availableRuns: [{ id: 'new-run', projectId: 'new-project', attempts: [{ id: 'new-attempt' }] }], availableArtifacts: [{ id: 'new-artifact', projectId: 'new-project', path: 'D:\\restored\\image.png', name: 'image.png', kind: 'image', mimeType: 'image/png', bytes: 17 }] };
  return { record, records, options };
}
describe('模型回执备份只恢复已有结果，不重发模型', () => {
  it('按项目白名单导出，原哈希先核验，密钥/请求头/原机文件路径都不进入包', () => {
    const f = fixture(), raw = JSON.stringify(f.records); expect(raw).not.toContain('FAKE-SECRET'); expect(raw).not.toContain('original-machine'); expect(raw).not.toContain('headers'); expect(f.records.records[0].resultSha256).toBe(hash(f.records.records[0].result));
    expect(exportModelReceiptBackup([f.record], { projectIds: ['other-project'] })).toBeUndefined(); expect(() => validateModelReceiptBackup(f.records, { projectIds: ['other-project'] })).toThrow('范围');
    expect(() => exportModelReceiptBackup([{ ...f.record, resultSha256: 'b'.repeat(64) }], { projectIds: ['project-one'] })).toThrow('哈希');
  });
  it('仅绑定已恢复的项目/run/attempt和真实产物路径，重算结果哈希并更换执行fingerprint', () => {
    const f = fixture(), original = structuredClone(f.records), next = mergeModelReceiptImport([], f.options).added[0];
    expect(next).toMatchObject({ requestId: 'new-attempt', runId: 'new-run', projectId: 'new-project', originFingerprint: f.record.fingerprint }); expect(next.fingerprint).not.toBe(f.record.fingerprint); expect(next.result.artifacts[0]).toMatchObject({ id: 'new-artifact', projectId: 'new-project', path: 'D:\\restored\\image.png' }); expect(next.resultSha256).toBe(hash(next.result)); expect(f.records).toEqual(original); expect(next.result.usage.totalTokens).toBe(117);
  });
  it('attempt缺映射或不在本次恢复run中时明确失败，不沿用源编号', () => {
    const f = fixture(); delete f.options.idMap['attempt-one']; expect(() => mergeModelReceiptImport([], f.options)).toThrow('编号映射');
    f.options.idMap['attempt-one'] = 'new-attempt'; f.options.availableRuns[0].attempts = []; expect(() => mergeModelReceiptImport([], f.options)).toThrow('请求尝试');
    f.options.availableRuns[0].attempts = [{ id: 'new-attempt' }]; f.options.availableRuns[0].projectId = 'foreign-project'; expect(() => mergeModelReceiptImport([], f.options)).toThrow('请求尝试');
  });
  it('已删除/回收或未随本次选择恢复的图片保留unavailable来源，不伪造路径', () => {
    const f = fixture(); f.options.availableArtifacts = [];
    const missing = mergeModelReceiptImport([], f.options).added[0]; expect(missing.result.artifacts[0]).toMatchObject({ id: 'new-artifact', path: '', unavailable: true }); expect(JSON.stringify(missing)).not.toContain('original-machine'); expect(missing.result.text).toBe('已有完整内容');
    f.options.availableArtifacts = [{ id: 'new-artifact', projectId: 'new-project', path: 'D:\\trash\\image.png', trashedAt: '2026-11-03' }]; expect(mergeModelReceiptImport([], f.options).added[0].result.artifacts[0]).toMatchObject({ path: '', unavailable: true, trashedAt: '2026-11-03' });
    delete f.options.idMap['artifact-one']; const unselected = mergeModelReceiptImport([], f.options).added[0]; expect(unselected.result.artifacts[0].id).not.toBe('artifact-one'); expect(unselected.result.artifacts[0].unavailable).toBe(true); expect(unselected.resultSha256).toBe(hash(unselected.result));
  });
  it('目标产物属于别的项目时不吞错，也不修改现有回执', () => {
    const f = fixture(), existing = [{ ...f.record }], before = structuredClone(existing); f.options.availableArtifacts[0].projectId = 'foreign-project'; expect(() => mergeModelReceiptImport(existing, f.options)).toThrow('不属于'); expect(existing).toEqual(before);
  });
  it('同backupId重复导入幂等并保留已恢复后的结果，冲突绝不覆盖', () => {
    const f = fixture(), next = mergeModelReceiptImport([], f.options).added[0]; next.result.text = '恢复后已核验'; next.resultSha256 = hash(next.result);
    expect(mergeModelReceiptImport([next], f.options)).toEqual({ added: [], skipped: 1 }); expect(next.result.text).toBe('恢复后已核验');
    expect(() => mergeModelReceiptImport([next], { ...f.options, backupId: 'other-backup' })).toThrow('来源冲突');
    const changed = structuredClone(f.options); changed.records.records[0].result.text = '不同来源'; changed.records.records[0].resultSha256 = hash(changed.records.records[0].result); expect(() => mergeModelReceiptImport([next], changed)).toThrow('来源冲突');
  });
  it('未知派发状态仍未知，请求编号映射碰撞明确拒绝，不会让旧请求变可自动执行', () => {
    const f = fixture(), pending = { ...f.record, requestId: 'attempt-two', status: 'started' }; delete pending.result; delete pending.resultSha256;
    f.options.records = exportModelReceiptBackup([f.record, pending], { projectIds: ['project-one'] }); f.options.idMap['attempt-two'] = 'new-attempt'; expect(() => mergeModelReceiptImport([], f.options)).toThrow('映射重复');
    f.options.idMap['attempt-two'] = 'new-attempt-two'; f.options.availableRuns[0].attempts.push({ id: 'new-attempt-two' }); const next = mergeModelReceiptImport([], f.options).added[1]; expect(next.status).toBe('started'); expect(next.requestStarted).toBe(true); expect(next.result).toBeUndefined();
  });
});
