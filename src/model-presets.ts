import type { ApiProtocol, ModelCapability, ModelConfiguration, ModelConnection } from './configuration-types';

export interface ProviderPreset {
  id: string;
  name: string;
  region: string;
  protocol: ApiProtocol;
  baseUrl: string;
  docsUrl: string;
  note: string;
}

export const PROTOCOL_LABELS: Record<ApiProtocol, string> = {
  demo: '本地演示',
  'openai-chat': 'OpenAI Chat 兼容',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
  gemini: 'Gemini 原生',
  image: 'OpenAI Images 兼容',
  audio: 'OpenAI Audio 兼容',
  video: '视频专用接口',
  custom: '其他专用协议',
};

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text: '文字生成',
  vision: '图像理解',
  'image-generation': '图片生成',
  'image-editing': '图片编辑',
  transcription: '语音识别',
  speech: '语音合成',
  'video-understanding': '视频理解',
  'video-generation': '视频生成',
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', region: '国际', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', docsUrl: 'https://platform.openai.com/docs/api-reference/responses', note: '按实际模型配置能力。Responses、图像和音频的参数与返回格式不同；可执行已适配协议；具体模型、网络、区域与账户权限仍需验证。' },
  { id: 'anthropic', name: 'Anthropic · Claude', region: '国际', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', docsUrl: 'https://platform.claude.com/docs/en/api/overview', note: '使用 Messages 协议及版本头，不能直接复用 Chat 请求体。已实现 Messages 请求格式，具体型号与账户权限需实际验证。' },
  { id: 'google', name: 'Google · Gemini', region: '国际', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', docsUrl: 'https://ai.google.dev/gemini-api/docs/openai', note: '原生协议与 OpenAI 兼容层分开配置。兼容 Chat 的地址为 https://generativelanguage.googleapis.com/v1beta/openai/；高级能力需独立适配。' },
  { id: 'deepseek', name: 'DeepSeek', region: '国内', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', docsUrl: 'https://api-docs.deepseek.com/', note: '支持兼容协议，模型 ID 以控制台为准。图像理解与图片生成是不同能力，不能按厂商名称自动推断。' },
  { id: 'aliyun', name: '阿里百炼 · Qwen', region: '国内 / 国际', protocol: 'openai-chat', baseUrl: '', docsUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope', note: '请从控制台复制当前业务空间与地域的 Base URL。官方推荐业务空间专属域名，API Key 与地域需一致；按量与订阅凭证不混用。' },
  { id: 'volcengine', name: '火山方舟 · 豆包', region: '国内', protocol: 'openai-chat', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', docsUrl: 'https://docs.volcengine.com/docs/ark/integrate-third-party-tools?lang=zh', note: '模型 ID 或接入点以控制台为准。按量 API 与 Agent Plan 的地址、Key、模型及计费不同；图片和异步视频需独立适配。' },
  { id: 'tencent', name: '腾讯混元 · TokenHub', region: '国内 / 国际', protocol: 'openai-chat', baseUrl: 'https://tokenhub.tencentmaas.com/v1', docsUrl: 'https://cloud.tencent.com/document/product/1823/130079', note: '这里预填广州按量接口；其他站点或 Token Plan 请改为控制台地址。站点 Key 不互通，Responses 等协议支持度取决于具体模型。' },
  { id: 'zhipu', name: '智谱 · GLM', region: '国内', protocol: 'openai-chat', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction', note: '兼容接口仍有参数差异。普通 API 与 Coding Plan 配置分别保存，图像和视频模型按其专用文档适配。' },
  { id: 'moonshot', name: 'Kimi · Moonshot', region: '国内', protocol: 'openai-chat', baseUrl: 'https://api.moonshot.cn/v1', docsUrl: 'https://platform.kimi.com/docs/get-api-key', note: '模型 ID 由你填写，协议支持按型号确认。图片输入并不代表图片输出；普通 API 与订阅服务地址应分别配置。' },
  { id: 'minimax', name: 'MiniMax', region: '国内 / 国际', protocol: 'openai-chat', baseUrl: 'https://api.minimax.cn/v1', docsUrl: 'https://platform.minimax.cn/docs/api-reference/text-openai-api', note: '国内按量接口预设；国际站可改为 https://api.minimax.io/v1。部分兼容参数会被忽略，音频与视频生成使用专用接口。' },
  { id: 'siliconflow', name: '硅基流动', region: '国内', protocol: 'openai-chat', baseUrl: 'https://api.siliconflow.cn/v1', docsUrl: 'https://docs.siliconflow.cn/docs/userguide/quickstart', note: '模型名称需包含平台要求的完整标识。图像、音频和视频有独立接口；视频先提交任务，再查询状态与结果。' },
  { id: 'custom', name: '自定义服务', region: '自定义', protocol: 'openai-chat', baseUrl: '', docsUrl: '', note: '填写你信任的服务地址与实际协议。支持保存配置不等于已完成接口适配，真实模式只执行已适配协议，未适配能力会在预检时拦截。' },
];

export const INITIAL_CONNECTIONS: ModelConnection[] = [
  { id: 'demo-local', name: '本地演示引擎', providerId: 'demo', protocol: 'demo', baseUrl: '', enabled: true, status: 'format-checked', demo: true },
];

const unknownPricing = () => ({ unit: 'million-tokens' as const, currency: 'CNY' as const, input: '', output: '' });

export const INITIAL_MODELS: ModelConfiguration[] = [
  { id: 'demo-text', name: '文本模型 · 演示', modelId: 'demo-text', connectionId: 'demo-local', capabilities: ['text'], pricing: unknownPricing(), enabled: true, demo: true },
  { id: 'demo-image', name: '图像模型 · 演示', modelId: 'demo-image', connectionId: 'demo-local', capabilities: ['image-generation', 'image-editing'], pricing: { ...unknownPricing(), unit: 'image' }, enabled: true, demo: true },
  { id: 'demo-vision', name: '视觉模型 · 演示', modelId: 'demo-vision', connectionId: 'demo-local', capabilities: ['vision', 'video-understanding'], pricing: unknownPricing(), enabled: true, demo: true },
];
