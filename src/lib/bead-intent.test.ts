import { describe, expect, it } from 'vitest';
import { BEAD_WORKSPACE_NOTICE, isBeadPatternRequest } from './bead-intent';

describe('local bead-pattern intent before paid image planning', () => {
  it.each([
    { text: '做64×64拼豆图纸，要色号采购', expected: true },
    { text: '做拼豆', expected: true },
    { text: '帮我制作拼豆', expected: true },
    { text: '拼豆', expected: true },
    { text: '拼豆图纸', expected: true },
    { text: '把这张图转成拼豆', expected: true },
    { text: '参考图转拼豆', expected: true },
    { text: '将参考图片转换为48x64拼豆图纸', expected: true },
    { text: '按底图做拼豆，需要每种色号用量和采购清单', expected: true },
    { text: '做拼豆店的色号用量采购表', expected: true },
    { text: 'Perler pattern', expected: true },
    { text: 'Create a 64x64 Perler bead pattern from this photo', expected: true },
    { text: 'turn this image into fuse beads', expected: true },
    { text: '做64×64拼豆图纸和一张宣传海报', expected: true },
    { text: '制作宣传海报和拼豆图纸', expected: true },
    { text: '做拼豆图纸+宣传海报', expected: true },
    { text: '做拼豆图纸，并做一张海报', expected: true },
    { text: '先制作拼豆店宣传海报，然后把参考图转成拼豆图纸', expected: true },
    { text: '不要做海报，只做64×64拼豆图纸', expected: true },
    { text: '不做拼豆店广告，而是做64×64拼豆图纸', expected: true },
    { text: '做拼豆店宣传海报', expected: false },
    { text: '给拼豆店做宣传海报，介绍64×64格、色号与采购说明', expected: false },
    { text: '设计拼豆色号用量采购说明海报', expected: false },
    { text: '做一张拼豆图纸宣传海报', expected: false },
    { text: '制作拼豆经营PPT', expected: false },
    { text: '做一份拼豆教学PPT，讲解MARD色号和用量', expected: false },
    { text: '写拼豆营销文案', expected: false },
    { text: '写海报文案：“64×64拼豆图纸，色号和采购一应俱全”', expected: false },
    { text: '做一张以拼豆图纸和采购色号为卖点的海报', expected: false },
    { text: '介绍拼豆图纸与色号采购怎么做', expected: false },
    { text: 'Perler shop marketing poster with color codes', expected: false },
    { text: 'Make a Perler pattern and a poster', expected: true },
    { text: '不要制作拼豆图纸', expected: false },
    { text: '这次不做64×64拼豆图纸', expected: false },
    { text: '不要把这张图转成拼豆', expected: false },
    { text: '拼豆图纸不用做', expected: false },
    { text: '不要做拼豆图纸，做拼豆店宣传海报', expected: false },
    { text: "Don't make a Perler pattern", expected: false },
    { text: 'no bead pattern', expected: false },
    { text: '制作64×64像素风头像', expected: false },
    { text: '生成拼豆风格头像，不要真实图纸', expected: false },
    { text: 'a perler-style avatar', expected: false },
    { text: 'Create a bead necklace photo', expected: false },
    { text: '', expected: false },
  ])('$text → $expected', ({ text, expected }) => {
    expect(isBeadPatternRequest(text)).toBe(expected);
  });
  it('describes the required original and real local colour/count pipeline without promising paid AI output', () => {
    expect(BEAD_WORKSPACE_NOTICE).toContain('底图'); expect(BEAD_WORKSPACE_NOTICE).toContain('真实色卡'); expect(BEAD_WORKSPACE_NOTICE).toContain('采购表'); expect(BEAD_WORKSPACE_NOTICE).toContain('本地制图不收费');
  });
});
