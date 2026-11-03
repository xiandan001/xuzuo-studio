import { describe, expect, it } from 'vitest';
import { writeRecoveryDraft } from './recovery-draft';

describe('恢复写失败可重试且不替换原恢复串', () => {
  it('配额失败保留原串，成功重试后完整正文及来源可读取', () => {
    const key = 'qa-recovery', original = '{"document":"旧原串"}', next = JSON.stringify({ document: { title: '新稿', body: '最后正文-END' }, sourceArtifactIds: ['actual-source'], baseRevision: 2 });
    let saved = original, fail = true;
    const storage = { setItem: (_key: string, value: string) => { if (fail) throw new Error('quota'); saved = value; } };
    expect(writeRecoveryDraft(storage, key, next)).toContain('下载恢复稿'); expect(saved).toBe(original);
    fail = false; expect(writeRecoveryDraft(storage, key, next)).toBe(''); expect(JSON.parse(saved).document.body).toBe('最后正文-END'); expect(JSON.parse(saved).sourceArtifactIds).toEqual(['actual-source']);
  });
});
