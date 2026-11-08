import { describe, expect, it } from 'vitest';
import { checkedAnimationDocument, newAnimationDocument } from './animation-document';
describe('动画生成收费前的实际路由资源准入', () => {
  it('轻动效采样不足两个实际画面时提前拒绝', () => { expect(() => checkedAnimationDocument({ ...newAnimationDocument('project'), style: 'pixel-light', fps: 1, loopMs: 100 })).toThrow('帧数'); });
  it('静态图集不会按无关的帧率和循环时长虚构300帧预算', () => { expect(checkedAnimationDocument({ ...newAnimationDocument('project', 'atlas'), style: 'pixel-light', width: 4096, height: 4096, fps: 50, loopMs: 6000 })).toMatchObject({ mode: 'atlas', width: 4096, height: 4096 }); });
  it('连续动作按真实六姿态准入，不把未使用的fps当成新增姿态', () => { expect(checkedAnimationDocument({ ...newAnimationDocument('project'), fps: 50, loopMs: 6000 })).toMatchObject({ style: 'illustrated-actions', loopMs: 6000 }); });
  it('尚无源帧时也提前核对完整动作六姿态总像素，避免收费后才失败', () => { expect(() => checkedAnimationDocument({ ...newAnimationDocument('project'), width: 3840, height: 2160, fps: 1, loopMs: 100 })).toThrow('累计像素'); });
});
