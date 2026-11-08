import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { animationHash } from './animation-hash';
import { ANIMATION_STYLES, animationArtHash, animationGenerationPrompt, animationRenderHash, animationSourceBackground, checkedAnimationDocument, newAnimationDocument, resizeAnimationEntries } from './animation-document';

const clock = () => Date.parse('2026-11-08T06:00:00.000Z');
const document = () => newAnimationDocument('project-one', 'gif', clock);
describe('角色图集和GIF共享工程规则', () => {
  it('同步SHA256与Node真实哈希一致，包含中文、空字符串及多块输入', () => {
    for (const value of ['', 'abc', '同一角色，清晰动作。', '角色🙂'.repeat(2000)]) expect(animationHash(value)).toBe(createHash('sha256').update(value).digest('hex'));
  });
  it('九种路线的默认规格都有效，轻动效真实12.5fps/1920ms不是24fps', () => {
    expect(ANIMATION_STYLES).toHaveLength(9); expect(new Set(ANIMATION_STYLES.map(style => style.id)).size).toBe(9);
    for (const style of ANIMATION_STYLES) expect(() => checkedAnimationDocument({ ...document(), style: style.id, ...style.defaults, columns: style.grid[0], rows: style.grid[1] })).not.toThrow();
    expect(ANIMATION_STYLES.find(style => style.id === 'photo-people')?.defaults).toMatchObject({ fps: 12.5, loopMs: 1920 });
    expect(ANIMATION_STYLES.find(style => style.id === 'lenticular')?.defaults).toMatchObject({ width: 480, height: 720, fps: 20, loopMs: 6000 });
  });
  it('只保留工程白名单字段，不带入Key、账本或任意运行状态；跨项目明确拒绝', () => {
    const value = checkedAnimationDocument({ ...document(), apiKey: 'do-not-copy', ledger: [{ costCents: 50 }], job: { autoRetry: true }, entries: document().entries.map(entry => ({ ...entry, secret: 'do-not-copy' })) });
    expect(JSON.stringify(value)).not.toMatch(/apiKey|ledger|secret|autoRetry/); expect(() => checkedAnimationDocument(value, 'other-project')).toThrow('不属于');
    expect(value.revision).toBe(0); expect(newAnimationDocument('project-two', 'atlas', clock).mode).toBe('atlas');
    for (const id of ['../', 'a:b', 'a.b', 'a_b']) expect(() => checkedAnimationDocument({ ...value, projectId: id })).toThrow();
  });
  it('数量自由调整至100，保留已有条目与样片，删除样片时清理悬空认可编号', () => {
    const before = { ...document(), acceptedSampleId: 'entry-1' }; const expanded = resizeAnimationEntries(before, 100); expect(expanded.entries).toHaveLength(100); expect(expanded.entries[0]).toEqual(before.entries[0]); expect(new Set(expanded.entries.map(entry => entry.id)).size).toBe(100);
    const narrowed = resizeAnimationEntries({ ...expanded, acceptedSampleId: expanded.entries[99].id }, 2); expect(narrowed.entries).toHaveLength(2); expect(narrowed.acceptedSampleId).toBeUndefined();
    for (const count of [0, 101, 2.5, NaN]) expect(() => resizeAnimationEntries(before, count)).toThrow();
  });
  it('拒绝超120帧、48M累计像素、非有限参数、重复编号及越格裁切', () => {
    for (const change of [{ fps: NaN }, { fps: Infinity }, { loopMs: 6050 }, { loopMs: 101 }, { style: 'pixel-light', fps: 50, loopMs: 6000 }, { style: 'pixel-light', width: 2048, height: 2048, fps: 20, loopMs: 6000 }, { columns: 17 }, { rows: 16, columns: 16 }]) expect(() => checkedAnimationDocument({ ...document(), ...change })).toThrow();
    const frame = { id: 'frame-1', atlasArtifactId: 'atlas-one', cell: [0, 0], grid: [1, 1], durationMs: 100 };
    for (const frames of [[{ ...frame, cell: [1, 0] }], [{ ...frame, crop: [10, 0, 5, 4] }], [{ ...frame, durationMs: 13 }], [frame, frame], Array.from({ length: 121 }, (_, index) => ({ ...frame, id: 'frame-' + index }))]) expect(() => checkedAnimationDocument({ ...document(), entries: [{ ...document().entries[0], frames }] })).toThrow();
  });
  it('GIF遵循3840边长与实际格式面积门，静态图集可保留4096像素，检查报告不改变编辑指纹', () => {
    const doc = document(); expect(() => checkedAnimationDocument({ ...doc, width: 4096, height: 512, fps: 1, loopMs: 100 })).toThrow();
    expect(checkedAnimationDocument({ ...doc, mode: 'atlas', width: 4096, height: 4096 }).width).toBe(4096);
    const report = { width: 512, height: 512, frames: 6, loopMs: 1800, transparent: true, warnings: ['需人工检查角色身份'] }, inspected = checkedAnimationDocument({ ...doc, entries: [{ ...doc.entries[0], inspection: report }] }); expect(inspected.entries[0].inspection).toEqual(report); expect(animationRenderHash(inspected)).toBe(animationRenderHash(doc)); expect(animationArtHash(inspected)).toBe(animationArtHash(doc));
    expect(() => checkedAnimationDocument({ ...doc, entries: [{ ...doc.entries[0], inspection: { ...report, warnings: Array(21).fill('过多') } }] })).toThrow();
  });
  it('本地改文字、速度、运动、尺寸、裁切只改变渲染指纹；修改源需求/参考/模型会改变制图指纹', () => {
    const doc = document(), art = animationArtHash(doc), rendered = animationRenderHash(doc);
    for (const changed of [{ ...doc, entries: [{ ...doc.entries[0], caption: '谢谢', motion: 'nod' as const }] }, { ...doc, fps: 8, loopMs: 2000 }, { ...doc, width: 480, height: 480 }, { ...doc, background: 'opaque' as const }]) { expect(animationArtHash(changed)).toBe(art); expect(animationRenderHash(changed)).not.toBe(rendered); }
    for (const changed of [{ ...doc, prompt: '请加一顶红帽子' }, { ...doc, mode: 'atlas' as const }, { ...doc, referenceArtifactIds: ['reference-one'] }, { ...doc, modelConfigId: 'another-model' }, { ...doc, entries: [{ ...doc.entries[0], description: '双手比心' }] }]) expect(animationArtHash(changed)).not.toBe(art);
    expect(animationArtHash({ ...doc, revision: 9, updatedAt: '2026-11-09T00:00:00.000Z' })).toBe(art);
  });
  it('全局已有图集布局不影响制图指纹，实际源帧的grid/crop改变仍会使渲染指纹变化', () => {
    const doc = document(), layout = { ...doc, columns: 2, rows: 3 }; expect(animationArtHash(layout)).toBe(animationArtHash(doc));
    const source = { ...doc, entries: [{ ...doc.entries[0], frames: [{ id: 'source-frame', atlasArtifactId: 'source-atlas', cell: [0, 0] as [number, number], grid: [3, 2] as [number, number], durationMs: 100 }] }] };
    for (const changed of [{ ...source, entries: [{ ...source.entries[0], frames: [{ ...source.entries[0].frames[0], grid: [2, 3] as [number, number] }] }] }, { ...source, entries: [{ ...source.entries[0], frames: [{ ...source.entries[0].frames[0], crop: [0, 0, 20, 20] as [number, number, number, number] }] }] }]) { expect(animationArtHash(changed)).toBe(animationArtHash(source)); expect(animationRenderHash(changed)).not.toBe(animationRenderHash(source)); }
  });
  it('部分条目指纹隔离其它条目修改，选择未知或重复条目明确拒绝', () => {
    const doc = resizeAnimationEntries(document(), 2), selected = [doc.entries[0].id], before = animationArtHash(doc, selected); doc.entries[1].description = '其它条目改成跳舞'; expect(animationArtHash(doc, selected)).toBe(before);
    expect(() => animationArtHash(doc, ['missing'])).toThrow(); expect(() => animationRenderHash(doc, [selected[0], selected[0]])).toThrow();
  });
  it('图集/轻动效使用本次真实网格和条目顺序，内置规范与用户描述分别叠加，不画文案', () => {
    const doc = resizeAnimationEntries({ ...document(), mode: 'atlas', columns: 2, rows: 1, prompt: '戴红围巾，在冬天使用。' }, 2); doc.entries[0].description = '挥手问好'; doc.entries[1].description = '低头感谢';
    const prompt = animationGenerationPrompt(doc, doc.entries); expect(prompt).toContain('2 列 × 1 行'); expect(prompt.indexOf('挥手问好')).toBeLessThan(prompt.indexOf('低头感谢')); expect(prompt).toContain('戴红围巾'); expect(prompt).toContain('只生成静态 PNG'); expect(prompt).toContain('不要生成汉字'); expect(prompt).toContain('身份锚点');
    expect(animationGenerationPrompt({ ...doc, mode: 'gif', style: 'pixel-light' }, doc.entries)).toContain('2 列 × 1 行');
  });
  it('完整动作要求同条目连续姿态，光栅要对齐，不把不同表情串成动作', () => {
    const doc = document(), prompt = animationGenerationPrompt(doc, doc.entries); expect(prompt).toContain('头、身体、肩膀和手协调'); expect(prompt).toContain('6 个关键状态'); expect(prompt).toContain('不把不同表情条目混成连续动作');
    const lenticular = ANIMATION_STYLES.find(style => style.id === 'lenticular')!; expect(animationGenerationPrompt({ ...doc, style: lenticular.id, ...lenticular.defaults, columns: 2, rows: 1 }, doc.entries)).toContain('眼鼻下巴');
  });
  it('源稿背景按路线固定，修改本地成品背景不会悄悄改变制图请求', () => {
    const doc = document(), opaqueOutput = { ...doc, background: 'opaque' as const };
    expect(animationSourceBackground(doc)).toBe('transparent'); expect(animationSourceBackground(opaqueOutput)).toBe('transparent'); expect(animationGenerationPrompt(doc, doc.entries)).toBe(animationGenerationPrompt(opaqueOutput, opaqueOutput.entries));
    const card = { ...doc, style: 'lenticular' as const }; expect(animationSourceBackground(card)).toBe('opaque'); expect(animationSourceBackground({ ...card, mode: 'atlas' })).toBe('transparent');
  });
  it('单帧修复只生成一个关键姿态，不要求整张图集，修复指令不改变用户原需求', () => {
    const doc = document(); doc.entries[0].frames = [{ id: 'frame-one', atlasArtifactId: 'atlas-one', cell: [0, 0], grid: [3, 2], durationMs: 300 }];
    const before = JSON.stringify(doc), prompt = animationGenerationPrompt(doc, doc.entries, { refineInstruction: '修好左手', frameId: 'frame-one' }); expect(prompt).toContain('不输出图集'); expect(prompt).not.toContain('图集按'); expect(prompt).toContain('修好左手'); expect(prompt).toContain('保留未选条目'); expect(JSON.stringify(doc)).toBe(before);
    expect(() => animationGenerationPrompt(doc, doc.entries, { frameId: 'missing' })).toThrow('不属于');
  });
  it.each([4, 7])('整条目精修保留现有%d个源状态的顺序与重复停顿，不强制重画默认六状态', count => {
    const doc = document(); doc.columns = count === 4 ? 2 : 3; doc.rows = count === 4 ? 2 : 3; doc.prompt = '保留已经确认的红围巾。';
    doc.entries[0].frames = Array.from({ length: count }, (_, index) => ({ id: `frame-${index}`, atlasArtifactId: 'source-atlas', cell: [index % 3, Math.floor(index / 3)] as [number, number], grid: [3, 3] as [number, number], durationMs: index === 1 ? 200 : 100 })); doc.entries[0].frames[1].cell = [...doc.entries[0].frames[0].cell];
    const original = JSON.stringify(doc), prompt = animationGenerationPrompt(doc, doc.entries, { refineInstruction: '只修手部，不改变停顿和顺序' });
    expect(prompt).toContain(`现有条目的 ${count} 个源状态`); expect(prompt).toContain(`恰好 ${count} 个源状态`); expect(prompt).toContain(`${doc.columns} 列 × ${doc.rows} 行等分网格`); expect(prompt).not.toContain('6 个关键状态'); expect(prompt).not.toContain('准备、启动、过渡'); expect(prompt).toContain('复制帧和重复停顿'); expect(prompt).toContain('不按默认动作模板补帧'); expect(prompt).toContain('1. 参考图 1'); expect(prompt).toContain('2. 参考图 1'); expect(prompt).toContain('200 毫秒停顿'); expect(prompt).toContain('只修手部'); expect(prompt).toContain('保留已经确认的红围巾'); expect(prompt).toContain('不要生成汉字'); expect(JSON.stringify(doc)).toBe(original);
  });
});
