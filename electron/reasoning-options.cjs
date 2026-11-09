// Generated from src/lib/reasoning-options.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REASONING_SOURCES = void 0;
exports.reasoningOptions = reasoningOptions;
exports.isReasoningEffort = isReasoningEffort;
exports.normalizeReasoningEffort = normalizeReasoningEffort;
exports.reasoningRequestFields = reasoningRequestFields;
// Official model-specific effort tables, checked 2026-11-09. Unknown models keep their provider default.
exports.REASONING_SOURCES = ['https://developers.openai.com/api/docs/guides/reasoning', 'https://platform.claude.com/docs/en/build-with-claude/effort', 'https://ai.google.dev/gemini-api/docs/thinking', 'https://platform.minimax.io/docs/api-reference/text-openai-api'];
const levels = {
    auto: { label: '自动', description: '使用模型默认设置' }, none: { label: '快速', description: '不启用额外推理，适合简单沟通' },
    minimal: { label: '极轻', description: '尽量减少思考时间' }, low: { label: '轻度', description: '适合日常问答、改写与提取' },
    medium: { label: '标准', description: '平衡速度、效果与消耗' }, high: { label: '深入', description: '适合复杂问题，通常更慢、消耗更多' },
    xhigh: { label: '更深入', description: '用于难题，等待与消耗通常更高' }, max: { label: '最高', description: '最大推理强度，适合确有必要的复杂任务' },
};
const balanced = ['low', 'medium', 'high'];
const extended = [...balanced, 'xhigh', 'max'];
function supported(connection, model) {
    const id = (model?.modelId || '').replace(/^models\//, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
    if (connection?.providerId === 'openai' && ['openai-chat', 'openai-responses'].includes(connection.protocol || '')) {
        if (/^gpt-(?:6-astra|6\.1-sol)$/.test(id))
            return extended;
        if (/^gpt-(?:6-sol|6-luna|6\.1-terra)$/.test(id))
            return ['none', ...extended];
        if (/^gpt-(?:5\.[245]|5\.4-(?:mini|nano))$/.test(id))
            return ['none', ...balanced, 'xhigh'];
        if (id === 'gpt-5.1')
            return ['none', ...balanced];
        if (/^gpt-5(?:-(?:mini|nano))?$/.test(id))
            return ['minimal', ...balanced];
        if (/^(?:o3|o3-mini|o4-mini)$/.test(id))
            return balanced;
    }
    if (connection?.protocol === 'anthropic') {
        if (/^claude-(?:(?:fable|mythos)-5(?:-1)?|(?:opus|sonnet)-5(?:-5)?|haiku-5-5|opus-4-[78])(?:-\d{8})?$/.test(id))
            return extended;
        if (/^claude-(?:opus|sonnet)-4-6(?:-\d{8})?$/.test(id))
            return [...balanced, 'max'];
    }
    if (connection?.protocol === 'gemini') {
        if (/^gemini-3-pro-preview$/.test(id))
            return ['low', 'high'];
        if (/^gemini-(?:3\.1-pro-preview|3\.[78]-flash)$/.test(id))
            return balanced;
        if (/^gemini-(?:3-flash-preview|3\.[56]-flash|3\.5-flash-lite)$/.test(id))
            return ['minimal', ...balanced];
    }
    if (connection?.providerId === 'minimax' && connection.protocol === 'openai-chat' && id === 'MiniMax-M3.1-Flash')
        return extended;
    return [];
}
function reasoningOptions(connection, model) {
    return ['auto', ...supported(connection, model)].map(value => ({ value, ...levels[value] }));
}
function isReasoningEffort(value) { return typeof value === 'string' && Object.hasOwn(levels, value); }
function normalizeReasoningEffort(connection, model, value) {
    return isReasoningEffort(value) && reasoningOptions(connection, model).some(option => option.value === value) ? value : 'auto';
}
function reasoningRequestFields(connection, model, effort = 'auto') {
    if (effort === undefined || effort === 'auto')
        return {};
    if (!isReasoningEffort(effort) || !supported(connection, model).includes(effort))
        throw Error('当前模型或接口不支持所选推理强度，请改为“自动”或选择可用等级。');
    if (connection.protocol === 'openai-responses')
        return { reasoning: { effort } };
    if (connection.protocol === 'openai-chat')
        return { reasoning_effort: effort };
    if (connection.protocol === 'anthropic')
        return { thinking: { type: 'adaptive' }, output_config: { effort } };
    if (connection.protocol === 'gemini')
        return { generationConfig: { thinkingConfig: { thinkingLevel: effort } } };
    return {};
}
