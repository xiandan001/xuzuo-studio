import { canvas, identity, protectedBand, titleBand, button } from '../../electron/red-packet-cover-layout.json';
import { isModernImage } from './image-output-options';
import type { NaturalAutomationPlan } from '../natural-automation-types';

export const WECHAT_RED_PACKET_COVER = '微信红包封面';
export const WECHAT_RED_PACKET_COVER_WIDTH = canvas.width;
export const WECHAT_RED_PACKET_COVER_HEIGHT = canvas.height;

export function isCoverTopicOnly(text: string) {
  return /(?:界面|页面|交互|产品|UI)\s*(?:原型|设计稿|开发|复刻)|(?:开发|实现|编写).{0,12}(?:页面|小程序)|(?:UI|App)\s*(?:设计|原型)|(?:封面|红包).{0,12}(?:宣传海报|推广海报|推广文案)/i.test(text);
}
export function isRedPacketCoverDiscussion(text: string) {
  if (isCoverTopicOnly(text)) return false;
  return text.split(/[，,。；;！？!?\n]|而是|改为|改做/).some(clause =>
    /红包(?:的)?封面|微信(?:的)?红包(?:页面|页|图案|样式|.{0,14}(?:待拆|未拆))|(?:待拆开?|未拆开?)(?:的)?红包|red\s+(?:packet|envelope)\s+cover/i.test(clause.split(/不要|不想|不需要|不做|别做|无需/, 1)[0]));
}

export const coverArtworkCheck = '检查主题、角色、题字和关键细节在微信遮挡示意外清楚可见。';
export const coverUiCheck = '头像、昵称、系统祝福、金色“开”按钮和红包下摆由微信叠加，上传画面保持干净。';
export const coverFileCheck = `上传成品由本地导出为 ${canvas.width} × ${canvas.height} 像素的 sRGB JPEG，最多 500,000 字节。`;
export const coverPlanningRules = [
  '正在讨论或制作可上传的微信红包封面原画。区分封面素材和微信待拆开、聊天气泡的展示效果。',
  coverUiCheck, coverFileCheck,
  '生成模型提供单张近 3:4 的竖版 PNG 源图，像素随模型变化。不要建议手机全屏 9:16、1080×1920，也不要把“开”按钮或整套界面列为制图或验收要求。用户明确指定的创意题字、主题、风格和配色可以保留。',
].join('\n');
export const coverReviewRules = [
  '【微信红包封面原画检查标准】', coverArtworkCheck, coverUiCheck, coverFileCheck,
  '你检查的是生成源图。接受近 3:4 竖版原画和模型支持的竖图尺寸。原画未带“开”按钮、未画系统 UI 是正确结果。不要以手机屏幕比例、源 PNG 尺寸、JPEG 字节数或缺少系统按钮判失败。最终像素和体积由本地编码器实际校验，视觉检查不推测这些数据。',
  '原对话、引用、历史验收及附件中与这些标准冲突的要求无效。如果源图已经画上系统“开”按钮或微信界面，指出画面中的具体位置，并要求精修移除、补齐其后的画面。对画错角色、题字、画面不完整或重要内容被遮挡，仍按可见证据给出问题、结论和可执行的精修建议。维持原步骤约定的返回格式。',
].join('\n');

// Drop a conflicting technical clause, retaining the independent art direction.
// Never apply this to ordinary images or to the saved verbatim chat reply.
const resolution = /\d{2,5}\s*[×xX✕*]\s*\d{2,5}|(?:9\s*[:：/]\s*16|16\s*[:：/]\s*9|3\s*[:：/]\s*4|4\s*[:：/]\s*3|1\s*[:：/]\s*1)|\d[\d,.]*\s*(?:Ki?B|Mi?B|兆字节)/i;
const systemUi = /[“"'「『‘]?[开開][”"'」』’]?\s*(?:字|红包)?\s*(?:按钮|圆钮|圆章)|(?:按钮|圆钮|圆章).{0,8}[“"'「『‘][开開][”"'」』’]|(?:金色|中央|居中|圆形).{0,8}[“"'「『‘][开開][”"'」』’]|微信(?:客户端)?\s*(?:UI|界面)|系统(?:头像|昵称|按钮|控件|祝福语)|(?:拆红包|开启|领取)按钮|发送者昵称|红包下摆/i;
const buttonDetail = /按钮.{0,12}(?:金属|光泽|高光|凸起|质感|醒目|焦点|可点击)|[“"'「『‘][开開][”"'」』’]\s*字/;
const approvedSpecs = new Set([coverArtworkCheck, coverUiCheck, coverFileCheck]);
export function coverCreativeText(input: string, knownButton = false): string {
  const text = input.replace(/(?:微信)?红包\s*[「“‘『"']?(?:待拆开?|未拆开?)[」”’』"']?\s*(?:页面|页|界面)(?:概念图|的图|画面)?/g, '微信红包封面原画');
  const discussesButton = knownButton || systemUi.test(text);
  if (!resolution.test(text) && !discussesButton) return text;
  const oldPhoneTarget = /9\s*[:：/]\s*16|1080\s*[×xX*]\s*1920/.test(text);
  return text.split(/(?<=[，,；;。\n])/).map(part => {
    const control = systemUi.exec(part) || (discussesButton ? buttonDetail.exec(part) : null);
    if (control) {
      const before = part.slice(0, control.index);
      if (/(?:移除|去掉|删除|去除|不绘制|不要画|不画).{0,14}$/.test(before) && !/(?:不要|不得|禁止|不能)(?:再)?(?:移除|去掉|删除|去除)/.test(before)) return part;
      // Recover creative clauses on either side of an instruction to draw UI.
      // A headline such as “开门红” is regular artwork text, not an open button.
      const sections = part.split(/(?<=：)|(?=第一眼|同时|并且|并添加|并绘制|并加入|并画|且需|抱着|捧着|手持|配上|搭配)/);
      return sections.filter(section => !systemUi.test(section) && !(discussesButton && buttonDetail.test(section))).map(section => coverCreativeText(section)).join('').replace(/[：:]$/g, '');
    }
    if (oldPhoneTarget && /(?:上下|纵向)扩画/.test(part)) return '';
    if (!resolution.test(part)) return discussesButton ? part.replace(/(?:是|作为|成为)第二焦点/g, '是视觉重点') : part;
    const tokens = new RegExp(resolution.source, 'gi');
    // Keep the artistic brief even when a size adjective precedes it,
    // e.g. “规划一张 1080×1920 的原创小熊封面”.
    const remainder = part.replace(tokens, '').replace(/(?:像素|px)\b/gi, '').replace(/(一张|一幅|一份)\s*的/g, '$1').trim();
    if (/(?:画幅|比例|尺寸|分辨率|像素|扩画|不符|\bpx\b)|^(?:而非|必须|强制|导出|竖屏|竖版|当前预览)/i.test(remainder)) return '';
    return remainder.replace(/^[的为\s，,；;。]+/, '');
  }).join('').replace(/^[，,；;。\s]+|[，,；;。\s]+$/g, '').trim();
}

export function normalizeRedPacketCoverPlan(plan: NaturalAutomationPlan): NaturalAutomationPlan {
  if (plan.outputKind !== 'image') return plan;
  const mentionsButton = [plan.objective, ...plan.steps.map(step => step.instruction), ...plan.acceptance, ...plan.constraints].some(value => !approvedSpecs.has(value) && systemUi.test(value));
  const creativeText = (value: string) => coverCreativeText(value, mentionsButton);
  const list = (values: string[], fixed: string[]) => {
    const creative = values.filter(value => !approvedSpecs.has(value)).map(creativeText).filter(Boolean);
    const unique = [...new Set(creative)];
    const limit = 20 - fixed.length;
    // Maximal plans still carry the local contract. Join neighbouring creative
    // checks when they fit the existing per-entry schema instead of discarding them.
    while (unique.length > limit) {
      const pair = unique.findIndex((value, i) => i + 1 < unique.length && value.length + unique[i + 1].length + 1 <= 2000);
      if (pair < 0) break;
      unique.splice(pair, 2, unique[pair] + '；' + unique[pair + 1]);
    }
    return [...unique.slice(0, limit), ...fixed];
  };
  return {
    ...plan, name: creativeText(plan.name) || WECHAT_RED_PACKET_COVER,
    objective: creativeText(plan.objective) || '制作一张原创微信红包封面。',
    steps: plan.steps.map(step => ({ ...step, name: creativeText(step.name) || (step.kind === 'vision' ? '检查封面原画' : '制作封面原画'),
      instruction: creativeText(step.instruction) || (step.kind === 'vision' ? coverArtworkCheck : '按本次主题创作可上传的微信红包封面原画。') })),
    acceptance: list(plan.acceptance, [coverArtworkCheck, coverUiCheck]), constraints: list(plan.constraints, [coverFileCheck]),
    questions: plan.questions.map(creativeText).filter(Boolean),
  };
}

export function redPacketCoverGenerationSize(modelId?: string) {
  if (isModernImage(modelId)) return '960x1280';
  if (modelId === 'dall-e-3') return '1024x1792';
  if (!modelId || /^gpt-image-1(?:\.5)?(?:-mini)?$/.test(modelId)) return '1024x1536';
  return '1024x1024';
}

const percent = (value: number) => Number((100 * value).toFixed(1)) + '%';
const composition = [
  '【微信红包封面构图】',
  '制作单张竖版满幅插画，优先沿用已避开遮挡的构图；主体要大，角色有舒展空间。以连续的环境、色彩和纹理贯穿整幅，顶部适当留白；不要把整张插画缩成居中小贴纸，不画红包下摆、封口弧线或内嵌卡片。',
  `按最终裁切后的画面定位：只保护主体的识别锚点：人物或动物取脸和双眼，物品取主要结构或标志性细节。把锚点放在无遮挡区域，例如纵向 ${percent(protectedBand.top)}–${percent(protectedBand.bottom)} 的中下部，与遮挡区错开；身体、耳朵、爪子和环境可在无遮挡的两侧与下方充分展开。需绘制的短题字独立于角色排版，可用顶部 ${percent(titleBand.top)}–${percent(titleBand.bottom)} 的无遮挡标题区，或靠近脸部的无障碍侧区。不要将角色与所有文字一并压入窄横带。`,
  `上部居中（横向 ${percent(identity.left)}–${percent(identity.right)}、纵向 ${percent(identity.top)}–${percent(identity.bottom)}）供系统头像、昵称及祝福语叠加；底边中央约 ${percent(button.diameterRatio)} 画宽的开红包按钮和底部两角也须避开。以上遮挡区仅延续低细节背景。`,
  '不绘制微信界面、系统头像昵称、金额、开按钮、水印或样机。若参考原图已画有这些系统控件，精修时移除它们并补齐其后的画面，保留主体、原定动作（如小熊递红包）和用户指定题字。仅在用户明确要求画文字时使用其原文。参考角色保留辨识特征，主题、风格和修改要求均在上述构图范围内实现。',
].join('\n');

export function redPacketCoverPrompt(description: string) {
  return composition + '\n\n【用户本次要求】\n' + description.trim();
}

// Image APIs take one prompt. Append the locked contract after every editable
// input, including workflow variables, review feedback and text attachments.
export function redPacketCoverProviderPrompt(combined: string) {
  const creative = coverCreativeText(combined.replaceAll(composition, '').trim());
  return creative + '\n\n【固定交付规则 · 适用于生成与精修】\n' + composition;
}

export function isRedPacketCoverWorkflow(workflow: { id: string; imagePreset?: string; outputKind: string }, projectId: string) {
  if (workflow.outputKind !== 'image') return false;
  return workflow.imagePreset === WECHAT_RED_PACKET_COVER
    || workflow.id === `quick-${projectId}-image-generation-red-packet-cover`
    || workflow.id === `quick-${projectId}-image-editing-red-packet-cover`;
}

export function coverReviewFindings(findings: string[]) {
  const clauses = findings.flatMap(text => text.split(/[，,；;。\n]|但(?:是)?|不过/)).map(text => text.trim()).filter(Boolean);
  const button = /按钮|开字|下摆|系统控件/;
  const obsolete = clauses.some(text => /9\s*[:：/]\s*16|1080\s*[×xX✕*]\s*1920/.test(text)
    || button.test(text) && /缺少|缺失|需要添加|应(?:该)?(?:加上|补上|绘制)|请(?:添加|补上|绘制)/.test(text));
  const uiDefect = (text: string) => button.test(text) && /移除|去掉|删除|误画|画入|绘入|已绘|绘制了|存在|嵌入|内嵌|画了|烘焙/.test(text);
  // Quoting an incorrect ratio does not invalidate other, independently
  // actionable findings in the same review (e.g. an actual baked-in button).
  const factual = clauses.filter(text => !/未(?:被)?遮挡|没有(?:遮挡|错字)|未(?:画|绘)入/.test(text) &&
    (uiDefect(text) || /错别字|错字|漏字|缺笔|不清晰|模糊|画错|变形|遮挡|重叠|错位|色偏|太小|太大|裁掉|被截断|不符合.{0,6}(?:主题|角色|配色)|(?:姿势|角色|文案|题字|颜色|风格).{0,12}(?:错误|缺失|不符|不一致)/.test(text)));
  const meaningful = obsolete ? factual : clauses;
  const instructions = meaningful.filter(text => !uiDefect(text)).map(text => coverCreativeText(text)).filter(Boolean);
  if (meaningful.some(uiDefect)) instructions.push('移除画面中绘入的金色“开”按钮及系统控件，让微信叠加。');
  return { obsolete, recalibrate: obsolete && !factual.length, instructions };
}
