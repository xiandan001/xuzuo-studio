import type { BusinessCategory, ImageUseTemplate, ModelConfiguration, ModelConnection, ModelPricing, StudioAction, WorkflowDefinition } from '../configuration-types';
import { INITIAL_CONNECTIONS, INITIAL_MODELS } from '../model-presets';
import { readImageUseTemplates } from './image-use-templates';

export interface ConfigurationState { categories: BusinessCategory[]; workflows: WorkflowDefinition[]; connections: ModelConnection[]; models: ModelConfiguration[]; studioActions: StudioAction[]; useTemplates: ImageUseTemplate[]; }
export function initialConfiguration(): ConfigurationState {
  return { categories: [], workflows: [], connections: structuredClone(INITIAL_CONNECTIONS), models: structuredClone(INITIAL_MODELS), studioActions: [], useTemplates: [] };
}
export interface ConfigurationRead { state: ConfigurationState; issue?: { code: 'parse' | 'schema'; message: string }; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringFields = (value: unknown, fields: string[]) => object(value) && fields.every(field => typeof value[field] === 'string');
function configurationShape(value: unknown): value is ConfigurationState {
  if (!object(value) || ![value.categories, value.workflows, value.connections, value.models].every(Array.isArray)) return false;
  if (!(value.categories as unknown[]).every(item => object(item) && stringFields(item, ['id', 'workspaceId', 'name']) && typeof item.archived === 'boolean')) return false;
  if (!(value.workflows as unknown[]).every(item => object(item) && stringFields(item, ['id', 'workspaceId', 'name', 'description', 'outputKind', 'updatedAt']) && Array.isArray(item.steps) && item.steps.every(step => object(step) && stringFields(step, ['id', 'name', 'kind', 'prompt', 'inputSource']) && typeof step.enabled === 'boolean'))) return false;
  if (!(value.connections as unknown[]).every(item => object(item) && stringFields(item, ['id', 'name', 'providerId', 'protocol', 'baseUrl']) && typeof item.enabled === 'boolean')) return false;
  if (!(value.models as unknown[]).every(item => object(item) && stringFields(item, ['id', 'name', 'modelId', 'connectionId']) && Array.isArray(item.capabilities) && item.capabilities.every(capability => typeof capability === 'string') && typeof item.enabled === 'boolean' && stringFields(item.pricing, ['unit', 'currency', 'input', 'output']))) return false;
  return value.studioActions === undefined || Array.isArray(value.studioActions) && value.studioActions.every(item => object(item) && stringFields(item, ['id', 'workspaceId', 'name', 'description', 'studio', 'outputKind', 'workflowId']) && typeof item.enabled === 'boolean');
}
export function readConfigurationResult(raw: string | null): ConfigurationRead {
  if (raw === null) return { state: initialConfiguration() };
  let state: unknown;
  try { state = JSON.parse(raw); }
  catch { return { state: initialConfiguration(), issue: { code: 'parse', message: '模型与工作流配置无法解析，原始内容未被覆盖。请先导出原始内容，再重新读取或显式重置。' } }; }
  if (!configurationShape(state) || state.useTemplates !== undefined && (!Array.isArray(state.useTemplates) || readImageUseTemplates(state.useTemplates).length !== state.useTemplates.length)) return { state: initialConfiguration(), issue: { code: 'schema', message: '模型与工作流配置结构异常，原始内容未被覆盖。请先导出原始内容，再重新读取或显式重置。' } };
  return { state: { ...state, studioActions: state.studioActions || [], useTemplates: readImageUseTemplates(state.useTemplates), workflows: state.workflows.map(flow => ({ ...flow, steps: flow.steps.map(step => ({ ...step, budgetCents: step.budgetCents ?? undefined })) })) } };
}
export function readConfiguration(raw: string | null): ConfigurationState { return readConfigurationResult(raw).state; }
export function activeCategories(categories: BusinessCategory[]): BusinessCategory[] {
  return categories.filter(item => !item.archived && (!item.parentId || categories.some(parent => parent.id === item.parentId && !parent.archived)));
}
export function categoryMatches(categories: BusinessCategory[], selected: string, assigned?: string): boolean {
  return selected === 'all' || (!selected ? !assigned : assigned === selected || categories.some(item => item.id === assigned && item.parentId === selected));
}
export function categoryError(categories: BusinessCategory[], workspaceId: string, draft: { name: string; parentId?: string }, id?: string): string {
  const name = draft.name.trim();
  if (!name || name.length > 30) return '分类名称需要填写，最多 30 个字。';
  const local = categories.filter(item => item.workspaceId === workspaceId);
  if (id && !local.some(item => item.id === id)) return '分类不属于当前工作区。';
  if (local.some(item => item.id !== id && item.parentId === draft.parentId && item.name === name)) return '同一层级已有这个名称，请换一个名称。';
  if (draft.parentId) {
    const parent = local.find(item => item.id === draft.parentId);
    if (!parent || parent.parentId || parent.archived || parent.id === id) return '小分类必须属于当前工作区中启用的大分类。';
    if (id && local.some(item => item.parentId === id)) return '这个大分类已有小分类，不能再移入另一个大分类。';
  }
  return '';
}
export function connectionError(connection: Pick<ModelConnection, 'name' | 'baseUrl' | 'protocol'>): string {
  if (!connection.name.trim()) return '请填写连接名称。';
  if (connection.protocol === 'demo') return '本地演示连接不需要修改。';
  try {
    const url = new URL(connection.baseUrl);
    if (url.username || url.password || url.search || url.hash) return '接口地址不能包含密码、查询参数或锚点，请把 Key 填入专用密钥框。';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return '使用 HTTPS 接口地址；本机测试接口可使用 HTTP。';
  } catch { return '请填写完整的接口地址，例如 https://api.example.com/v1。'; }
  return '';
}
export function modelError(model: Omit<ModelConfiguration, 'id'>, connections: ModelConnection[]): string {
  if (!model.name.trim() || !model.modelId.trim()) return '请填写模型名称和供应商提供的模型 ID。';
  if (!connections.some(item => item.id === model.connectionId)) return '请选择一个有效连接。';
  if (!model.capabilities.length) return '至少选择一种模型能力。';
  if ([model.pricing.input, model.pricing.output].some(value => value.trim() && (!/^\d+(?:\.\d{1,6})?$/.test(value.trim()) || Number(value) > 100_000_000))) return '价格请填非负数字，最多 6 位小数；未知时可以留空。';
  if (model.pricing.referenceOnly !== undefined && typeof model.pricing.referenceOnly !== 'boolean') return '参考价状态需要是明确的启用或关闭状态。';
  if (model.pricing.referenceNote !== undefined && (typeof model.pricing.referenceNote !== 'string' || model.pricing.referenceNote.length > 2000)) return '价格说明请填写不超过 2000 字的文字。';
  if (model.pricing.verifiedAt !== undefined && model.pricing.verifiedAt !== '' && !verifiedDate(model.pricing.verifiedAt)) return '价格核对日期请使用有效的 YYYY-MM-DD 日期。';
  if (model.pricing.officialUrl !== undefined && model.pricing.officialUrl !== '') {
    try {
      if (typeof model.pricing.officialUrl !== 'string' || model.pricing.officialUrl.length > 2048) return '官方来源链接格式无效。';
      const url = new URL(model.pricing.officialUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '官方来源请使用不含账号、查询参数或锚点的 HTTPS 地址。';
    } catch { return '请填写有效的官方来源 HTTPS 地址。'; }
  }
  return '';
}
export function belongsToCategory(categories: BusinessCategory[], workspaceId: string, id?: string): boolean {
  return !id || categories.some(item => item.id === id && item.workspaceId === workspaceId);
}
function verifiedDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function publicUrl(value: unknown, allowLocalHttp = false): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return undefined;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString();
  } catch { return undefined; }
}
export function publicModelPricing(pricing: ModelPricing): ModelPricing {
  const officialUrl = publicUrl(pricing.officialUrl);
  return { unit: pricing.unit, currency: pricing.currency, input: pricing.input, output: pricing.output, exchangeRate: pricing.exchangeRate,
    ...(pricing.referenceOnly !== undefined ? { referenceOnly: pricing.referenceOnly !== false } : {}),
    ...(typeof pricing.referenceNote === 'string' && pricing.referenceNote.length <= 2000 ? { referenceNote: pricing.referenceNote } : {}),
    ...(officialUrl ? { officialUrl } : {}),
    ...(verifiedDate(pricing.verifiedAt) ? { verifiedAt: pricing.verifiedAt } : {}),
  };
}
export function publicConfiguration(connections: ModelConnection[], models: ModelConfiguration[]) {
  return {
    type: 'xuzuo-model-configuration', version: 1, realApiVerified: false,
    connections: connections.filter(item => !item.demo).map(({ id, name, providerId, protocol, baseUrl, enabled, status }) => ({ id, name, providerId, protocol, baseUrl: publicUrl(baseUrl, true) || '', enabled, status })),
    models: models.filter(item => !item.demo).map(({ id, name, modelId, connectionId, capabilities, pricing, enabled }) => ({ id, name, modelId, connectionId, capabilities, pricing: publicModelPricing(pricing), enabled })),
  };
}
