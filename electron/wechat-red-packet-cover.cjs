// Generated from src/lib/wechat-red-packet-cover.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WECHAT_RED_PACKET_COVER_HEIGHT = exports.WECHAT_RED_PACKET_COVER_WIDTH = exports.WECHAT_RED_PACKET_COVER = void 0;
exports.redPacketCoverGenerationSize = redPacketCoverGenerationSize;
exports.redPacketCoverPrompt = redPacketCoverPrompt;
exports.redPacketCoverProviderPrompt = redPacketCoverProviderPrompt;
exports.isRedPacketCoverWorkflow = isRedPacketCoverWorkflow;
const red_packet_cover_layout_json_1 = require("./red-packet-cover-layout.json");
const image_output_options_1 = require("./image-output-options.cjs");
exports.WECHAT_RED_PACKET_COVER = '微信红包封面';
exports.WECHAT_RED_PACKET_COVER_WIDTH = red_packet_cover_layout_json_1.canvas.width;
exports.WECHAT_RED_PACKET_COVER_HEIGHT = red_packet_cover_layout_json_1.canvas.height;
function redPacketCoverGenerationSize(modelId) {
    if ((0, image_output_options_1.isModernImage)(modelId))
        return '960x1280';
    if (modelId === 'dall-e-3')
        return '1024x1792';
    if (!modelId || /^gpt-image-1(?:\.5)?(?:-mini)?$/.test(modelId))
        return '1024x1536';
    return '1024x1024';
}
const percent = (value) => Number((100 * value).toFixed(1)) + '%';
const composition = [
    '【微信红包封面构图】',
    '制作单张竖版满幅插画，优先沿用已避开遮挡的构图；主体要大，角色有舒展空间。以连续的环境、色彩和纹理贯穿整幅，顶部适当留白；不要把整张插画缩成居中小贴纸，不画红包下摆、封口弧线或内嵌卡片。',
    `按最终裁切后的画面定位：只保护主体的识别锚点：人物或动物取脸和双眼，物品取主要结构或标志性细节。把锚点放在无遮挡区域，例如纵向 ${percent(red_packet_cover_layout_json_1.protectedBand.top)}–${percent(red_packet_cover_layout_json_1.protectedBand.bottom)} 的中下部，与遮挡区错开；身体、耳朵、爪子和环境可在无遮挡的两侧与下方充分展开。需绘制的短题字独立于角色排版，可用顶部 ${percent(red_packet_cover_layout_json_1.titleBand.top)}–${percent(red_packet_cover_layout_json_1.titleBand.bottom)} 的无遮挡标题区，或靠近脸部的无障碍侧区。不要将角色与所有文字一并压入窄横带。`,
    `上部居中（横向 ${percent(red_packet_cover_layout_json_1.identity.left)}–${percent(red_packet_cover_layout_json_1.identity.right)}、纵向 ${percent(red_packet_cover_layout_json_1.identity.top)}–${percent(red_packet_cover_layout_json_1.identity.bottom)}）供系统头像、昵称及祝福语叠加；底边中央约 ${percent(red_packet_cover_layout_json_1.button.diameterRatio)} 画宽的开红包按钮和底部两角也须避开。以上遮挡区仅延续低细节背景。`,
    '不绘制微信界面、系统头像昵称、金额、开按钮、水印或样机。仅在用户明确要求画文字时使用其原文。参考角色保留辨识特征，主题、风格和修改要求均在上述构图范围内实现。',
].join('\n');
function redPacketCoverPrompt(description) {
    return composition + '\n\n【用户本次要求】\n' + description.trim();
}
// Image APIs take one prompt. Append the locked contract after every editable
// input, including workflow variables, review feedback and text attachments.
function redPacketCoverProviderPrompt(combined) {
    const creative = combined.replaceAll(composition, '').trim();
    return creative + '\n\n【固定交付规则 · 适用于生成与精修】\n' + composition;
}
function isRedPacketCoverWorkflow(workflow, projectId) {
    if (workflow.outputKind !== 'image')
        return false;
    return workflow.imagePreset === exports.WECHAT_RED_PACKET_COVER
        || workflow.id === `quick-${projectId}-image-generation-red-packet-cover`
        || workflow.id === `quick-${projectId}-image-editing-red-packet-cover`;
}
