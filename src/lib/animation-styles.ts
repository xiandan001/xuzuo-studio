import type { AnimationStyle } from '../animation-types';

export interface AnimationStyleDefinition {
  id: AnimationStyle; name: string; description: string;
  route: 'light' | 'keyframes' | 'lenticular' | 'poster'; appearance: 'pixel' | 'illustration' | 'photographic' | 'clay';
  framesPerEntry: number; grid: [number, number];
  defaults: { width: number; height: number; fps: number; loopMs: number; background: 'transparent' | 'opaque' };
}
const hd = { width: 512, height: 512, fps: 12.5, loopMs: 1920, background: 'transparent' as const };
const poster = { width: 480, height: 720, fps: 20, loopMs: 6000, background: 'opaque' as const };
export const ANIMATION_STYLES: readonly AnimationStyleDefinition[] = [
  { id: 'pixel-light', name: '像素轻动效', description: '保留像素边缘，以轻弹、点头和摇摆表现反应。', route: 'light', appearance: 'pixel', framesPerEntry: 1, grid: [1, 1], defaults: { ...hd, width: 320, height: 320 } },
  { id: 'pixel-actions', name: '像素完整动作', description: '连续姿态组成完整动作，保留清楚的像素轮廓。', route: 'keyframes', appearance: 'pixel', framesPerEntry: 6, grid: [3, 2], defaults: { ...hd, width: 320, height: 320, fps: 10, loopMs: 1800 } },
  { id: 'illustrated-actions', name: '插画角色动作', description: '用真实连续姿态表现头、身体和手的配合。', route: 'keyframes', appearance: 'illustration', framesPerEntry: 6, grid: [3, 2], defaults: { ...hd, fps: 10, loopMs: 1800 } },
  { id: 'photo-people', name: '真人轻动效', description: '保留照片人物的长相、服饰与光线，采用克制的轻动效。', route: 'light', appearance: 'photographic', framesPerEntry: 1, grid: [1, 1], defaults: { ...hd } },
  { id: 'photo-pets', name: '宠物拟人', description: '保留宠物毛色和面部特征，用不同姿态表达反应。', route: 'light', appearance: 'photographic', framesPerEntry: 1, grid: [1, 1], defaults: { ...hd } },
  { id: 'clay-mascot', name: '粘土吉祥物', description: '保持粘土体积、材质和光线，以连续关键姿态制作动作。', route: 'keyframes', appearance: 'clay', framesPerEntry: 6, grid: [3, 2], defaults: { ...hd, fps: 10, loopMs: 1800 } },
  { id: 'lenticular', name: '双状态光栅卡', description: '对齐同一角色或产品的两种状态，制作固定构图的变画。', route: 'lenticular', appearance: 'illustration', framesPerEntry: 2, grid: [2, 1], defaults: { ...poster } },
  { id: 'type-linked', name: '人物与字体联动', description: '角色状态与可编辑文字节奏一起变化。', route: 'poster', appearance: 'illustration', framesPerEntry: 2, grid: [2, 1], defaults: { ...poster } },
  { id: 'comic-fusion', name: '漫画印刷整体融合', description: '限定色、墨线和网点组成有明显状态反差的动态海报。', route: 'poster', appearance: 'illustration', framesPerEntry: 2, grid: [2, 1], defaults: { ...poster } },
];
export function animationStyle(id: AnimationStyle): AnimationStyleDefinition { const value = ANIMATION_STYLES.find(item => item.id === id); if (!value) throw Error('请选择支持的动画风格。'); return value; }
