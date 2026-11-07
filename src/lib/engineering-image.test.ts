import { describe, expect, it } from 'vitest';
import { ENGINEERING_IMAGE_PROMPT, engineeringImagePrompt } from './engineering-image';

describe('engineering image editing foundation', () => {
  it('uses the first original as the canvas and keeps later references auxiliary', () => {
    expect(ENGINEERING_IMAGE_PROMPT).toContain('第1张原图');
    expect(ENGINEERING_IMAGE_PROMPT).toContain('主画布');
    expect(ENGINEERING_IMAGE_PROMPT).toContain('其他参考图');
    expect(ENGINEERING_IMAGE_PROMPT).toContain('不能替代主画布');
  });
  it('covers photographs, drawings and renderings without inventing construction details', () => {
    for (const word of ['工程照片', '图纸', '效果图', '结构', '透视', '纹理', '材质', '线条', '尺寸标注', '编号', '现有文字']) expect(ENGINEERING_IMAGE_PROMPT).toContain(word);
    expect(ENGINEERING_IMAGE_PROMPT).toContain('不凭空增删工程构件');
    expect(ENGINEERING_IMAGE_PROMPT).toContain('不清楚');
    expect(ENGINEERING_IMAGE_PROMPT).toContain('不补编');
  });
  it('preserves framing and requests image output without adding a new design or explanatory UI', () => {
    for (const word of ['像素尺寸', '画幅', '比例', '不裁切', '边框', '留白', '重新设计', '手机界面', '说明文字']) expect(ENGINEERING_IMAGE_PROMPT).toContain(word);
    expect(ENGINEERING_IMAGE_PROMPT).not.toMatch(/保证.*(?:无损|零损|零误差)|已通过.*(?:认证|审核)/);
  });
  it('keeps the reusable foundation and this exact user instruction in separate sections', () => {
    const instruction = '只把现场照片右侧蓝色围挡改为白色，保留其他细节。';
    const result = engineeringImagePrompt(`  ${instruction}\n`);
    expect(result.startsWith(ENGINEERING_IMAGE_PROMPT)).toBe(true);
    expect(result.slice(ENGINEERING_IMAGE_PROMPT.length)).toBe(`\n\n【本次用户编辑要求】\n${instruction}`);
    expect(result.split(instruction)).toHaveLength(2);
  });
  it('allows an explicit requested annotation edit to override the default preservation rule', () => {
    const instruction = '将图纸中编号A-03改为A-07，尺寸标注1200改为1500，其余不动。';
    const result = engineeringImagePrompt(instruction);
    expect(ENGINEERING_IMAGE_PROMPT).toContain('用户明确要求');
    expect(ENGINEERING_IMAGE_PROMPT).toContain('优先于默认保留规则');
    expect(result.endsWith(instruction)).toBe(true);
    expect(result).not.toMatch(/无论.*(?:用户|要求).*不得修改|任何情况下.*禁止修改/);
  });
  it.each(['', ' ', '\n\t'])('rejects an empty edit locally instead of inventing a task: %j', instruction => {
    expect(() => engineeringImagePrompt(instruction)).toThrow('请说明需要修改的位置和内容');
  });
});
