import { describe, expect, it } from 'vitest';
import { BEAD_PREPARATION_PROMPT, beadPreparationPrompt } from './bead-image';

describe('bead image preparation foundation and user overlay', () => {
  it('keeps the reference subject and clear contours while simplifying noisy near-colours', () => {
    for (const word of ['参考图', '主体', '轮廓', '近色', '阴影', '色块']) expect(BEAD_PREPARATION_PROMPT).toContain(word);
    expect(BEAD_PREPARATION_PROMPT).not.toMatch(/保证.*(?:无损|零损|实物一致)/);
  });
  it('prepares only the source artwork and delegates all codes and statistics to later local computation', () => {
    for (const word of ['不得绘制网格', '色号', '用量', '采购', '本地']) expect(BEAD_PREPARATION_PROMPT).toContain(word);
    expect(BEAD_PREPARATION_PROMPT).toContain('底图');
  });
  it('expresses exact requested grid proportions while separating user instructions', () => {
    const instruction = '保留参考图左侧红色小屋，不要增加其他物体。';
    const result = beadPreparationPrompt({ columns: 80, rows: 52 }, `  ${instruction}\n`);
    expect(result.startsWith(BEAD_PREPARATION_PROMPT)).toBe(true); expect(result).toContain('80 列 × 52 行'); expect(result).toContain('20:13');
    expect(result.endsWith(`【本次补充要求】\n${instruction}`)).toBe(true); expect(result.split(instruction)).toHaveLength(2);
  });
  it.each([undefined, '', '  '])('keeps a useful baseline for %j without inventing an object or a task', instruction => {
    const result = beadPreparationPrompt({ columns: 52, rows: 52 }, instruction);
    expect(result).toContain(BEAD_PREPARATION_PROMPT); expect(result).toContain('52 列 × 52 行'); expect(result).toContain('1:1'); expect(result).not.toContain('【本次补充要求】');
    for (const invented of ['猫咪', '房子', '卡通人物']) expect(result).not.toContain(invented);
  });
  it.each([{ columns: 7, rows: 52 }, { columns: 257, rows: 52 }, { columns: 52, rows: 1.5 }, { columns: NaN, rows: 52 }])('rejects an invalid requested grid before any model request: %j', settings => {
    expect(() => beadPreparationPrompt(settings)).toThrow('8–256');
  });
});
