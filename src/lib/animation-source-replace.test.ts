import { describe, expect, it } from 'vitest';
import { newAnimationDocument } from './animation-document';
import { replaceAnimationSource } from './animation-source-replace';
import { adoptExistingAnimationSources } from '../components/animation/animation-ui';
function fixture() {
  const document = newAnimationDocument('project'); document.width = 32; document.height = 32; document.loopMs = 500;
  document.referenceArtifactIds = ['old-atlas']; document.acceptedSampleId = document.entries[0].id;
  document.entries[0] = { ...document.entries[0], status: 'ready', outputArtifactId: 'old-gif', coverArtifactId: 'old-cover', sourceHash: 'a'.repeat(64), renderedHash: 'b'.repeat(64), frames: [{ id: 'first', atlasArtifactId: 'old-atlas', grid: [2, 1], cell: [0, 0], crop: [0, 0, 32, 32], durationMs: 200 }, { id: 'second', atlasArtifactId: 'old-atlas', grid: [2, 1], cell: [1, 0], durationMs: 300 }] };
  document.entries.push({ ...document.entries[0], id: 'other', frames: [{ id: 'other-frame', atlasArtifactId: 'other-atlas', grid: [1, 1], cell: [0, 0], durationMs: 500 }] }); return document;
}
describe('模板兼容图集和精确源帧替换', () => {
  it('真实替换清标记，重新采用同一模板占位不能伪装成已生成源稿', () => {
    const value = fixture(); value.entries[0].frames = value.entries[0].frames.map(frame => ({ ...frame, templatePlaceholder: true }));
    const replaced = replaceAnimationSource(value, { projectId: 'project', oldArtifactId: 'old-atlas', newArtifactId: 'actual-new-source', width: 64, height: 32 }); expect(replaced.entries[0].frames.every(frame => !frame.templatePlaceholder)).toBe(true); expect(value.entries[0].frames.every(frame => frame.templatePlaceholder)).toBe(true);
    expect(() => adoptExistingAnimationSources(value, 'sequence', value.entries[0].id)).toThrow('模板占位'); expect(() => replaceAnimationSource(value, { projectId: 'project', oldArtifactId: 'old-atlas', newArtifactId: 'old-atlas', width: 64, height: 32, entryId: value.entries[0].id, frameId: 'first' })).toThrow('模板占位');
  });
  it('兼容图集替换保留真正网格/裁切/动作顺序/停顿，旧文档与无关条目保持', () => {
    const original = fixture(), before = structuredClone(original), result = replaceAnimationSource(original, { projectId: 'project', oldArtifactId: 'old-atlas', newArtifactId: 'new-atlas', width: 64, height: 32 });
    expect(original).toEqual(before); expect(result.entries[0].frames.map(frame => frame.durationMs)).toEqual([200, 300]); expect(result.entries[0].frames[0].crop).toEqual([0, 0, 32, 32]); expect(result.entries[0].frames[1].cell).toEqual([1, 0]); expect(result.entries[0].frames.every(frame => frame.atlasArtifactId === 'new-atlas')).toBe(true); expect(result.entries[1]).toEqual(original.entries[1]); expect(result.referenceArtifactIds).toEqual(['new-atlas']); expect(result.acceptedSampleId).toBeUndefined(); expect(result.entries[0].outputArtifactId).toBeUndefined();
  });
  it('仅替换所选静态关键帧，不复制出不存在的新动作，也不动其他帧或参考', () => {
    const original = fixture(), result = replaceAnimationSource(original, { projectId: 'project', oldArtifactId: 'old-atlas', newArtifactId: 'single-pose', width: 40, height: 80, entryId: original.entries[0].id, frameId: 'first' });
    expect(result.entries[0].frames).toHaveLength(2); expect(result.entries[0].frames[0]).toMatchObject({ atlasArtifactId: 'single-pose', cell: [0, 0], grid: [1, 1], durationMs: 200 }); expect(result.entries[0].frames[0].crop).toBeUndefined(); expect(result.entries[0].frames[1]).toEqual(original.entries[0].frames[1]); expect(result.entries[1]).toEqual(original.entries[1]); expect(result.referenceArtifactIds).toEqual(original.referenceArtifactIds);
  });
  it('拒绝跨项目和不兼容原裁切，保持原源画面', () => { const original = fixture(); expect(() => replaceAnimationSource(original, { projectId: 'wrong', oldArtifactId: 'old-atlas', newArtifactId: 'new', width: 64, height: 32 })).toThrow('本项目'); expect(() => replaceAnimationSource(original, { projectId: 'project', oldArtifactId: 'old-atlas', newArtifactId: 'new', width: 16, height: 16 })).toThrow('不兼容'); expect(original.entries[0].frames[0].atlasArtifactId).toBe('old-atlas'); });
});
