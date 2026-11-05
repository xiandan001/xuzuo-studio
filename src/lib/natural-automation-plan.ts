import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { Project } from '../types';
import type { ProjectReference } from '../asset-types';
import type { StudioConfiguration, WorkflowDraft, WorkflowStep } from '../configuration-types';
import { automationRecipe } from './automation-recipes';
import { withCreationFoundation } from './creation-quality';
import { CREATION_PROFILES } from './creation-profiles';
import { documentIllustrationSteps, DOCUMENT_IMAGE_LIMIT, DOCUMENT_REFERENCE_IMAGE_LIMIT } from './document-illustrations';
import { extractVariables } from './prompt-variables';

type Capability = NaturalAutomationPlan['steps'][number]['kind'];
export type NaturalAutomationBindings = Partial<Record<Capability, { modelConfigId?: string; credentialId?: string }>>;
export interface NaturalAutomationCompileOptions { allowPreparationQuestions?: boolean; calendarResolved?: boolean; }
type Configuration = Pick<StudioConfiguration, 'models' | 'connections' | 'credentials' | 'workflows'>;
const capabilities: Capability[] = ['text', 'vision', 'image-generation', 'image-editing'];
const labels: Record<Capability, string> = { text: '文字制作', vision: '图片检查', 'image-generation': '图片生成', 'image-editing': '图片精修' };
const rootKeys = ['version', 'name', 'objective', 'outputKind', 'trigger', 'steps', 'illustrations', 'acceptance', 'constraints', 'maxRepairs', 'questions', 'unsupported'];
const usableReference = (file: ProjectReference) => !('trashedAt' in file && file.trashedAt) && !('unavailable' in file && file.unavailable);
const stringListSchema = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 2000 } } as const;

export const NATURAL_AUTOMATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: [...rootKeys],
  properties: {
    version: { const: 1 }, name: { type: 'string', minLength: 1, maxLength: 80 }, objective: { type: 'string', minLength: 1, maxLength: 10000 },
    outputKind: { enum: ['word', 'ppt', 'excel', 'image'] },
    trigger: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { enum: ['manual', 'schedule', 'reference-imported', 'run-completed'] }, intervalMinutes: { type: 'integer', minimum: 1, maximum: 10080 }, sourceWorkflowId: { type: 'string', minLength: 1, maxLength: 160 } }, description: 'schedule仅表示应用运行期间每隔指定分钟；不支持每天9点、星期、cron等日历时间，遇到这些要求必须写入questions/unsupported。只有run-completed可填写已有sourceWorkflowId。' },
    steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['kind', 'name', 'instruction'], properties: { kind: { enum: [...capabilities] }, name: { type: 'string', minLength: 1, maxLength: 80 }, instruction: { type: 'string', minLength: 1, maxLength: 10000 } } }, description: '只描述文字、看图、生成图片、编辑图片；不提供代码、接口URL、价格或凭证。检查并精修图片时列出image-generation、vision、image-editing。' },
    illustrations: { type: 'object', additionalProperties: false, required: ['mode', 'count'], properties: { mode: { enum: ['none', 'references', 'generate'] }, count: { type: 'integer', minimum: 0, maximum: DOCUMENT_IMAGE_LIMIT } }, description: '仅Word/PPT使用文档配图：none时count=0；generate为1–20张；references表示至少需要1–12张项目参考图，实际使用项目提供的参考图。' },
    acceptance: { ...stringListSchema, minItems: 1 }, constraints: stringListSchema, maxRepairs: { type: 'integer', minimum: 0, maximum: 3 }, questions: stringListSchema, unsupported: stringListSchema,
  },
} as const;

function object(value: unknown, field: string, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error(`方案的${field}必须是JSON对象。`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw Error(`方案的${field}包含不支持的字段。`);
  if (required.some(key => !Object.hasOwn(result, key))) throw Error(`方案的${field}缺少必填字段。`);
  return result;
}
function text(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(`方案的${field}需要填写1–${limit}字的有效文字。`);
  return value.trim();
}
function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw Error(`方案的${field}必须是${minimum}–${maximum}的整数。`);
  return value as number;
}
function texts(value: unknown, field: string, minimum = 0): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 20) throw Error(`方案的${field}必须包含${minimum}–20项。`);
  return value.map(item => text(item, field, 2000));
}
function validate(value: unknown): NaturalAutomationPlan {
  const source = object(value, '根结构', rootKeys);
  if (source.version !== 1) throw Error('方案版本不受支持。');
  const outputKind = source.outputKind;
  if (!['word', 'ppt', 'excel', 'image'].includes(outputKind as string)) throw Error('方案的产物类型不受支持。');
  const trigger = object(source.trigger, '触发方式', ['type', 'intervalMinutes', 'sourceWorkflowId'], ['type']);
  if (!['manual', 'schedule', 'reference-imported', 'run-completed'].includes(trigger.type as string)) throw Error('方案的触发方式不受支持。');
  if (trigger.type !== 'schedule' && trigger.intervalMinutes !== undefined || trigger.type !== 'run-completed' && trigger.sourceWorkflowId !== undefined) throw Error('方案的触发参数与触发方式不一致。');
  const normalizedTrigger: NaturalAutomationPlan['trigger'] = { type: trigger.type as NaturalAutomationPlan['trigger']['type'] };
  if (trigger.type === 'schedule') normalizedTrigger.intervalMinutes = integer(trigger.intervalMinutes, '间隔分钟', 1, 10080);
  if (trigger.type === 'run-completed') normalizedTrigger.sourceWorkflowId = text(trigger.sourceWorkflowId, '来源流程', 160);
  if (!Array.isArray(source.steps) || source.steps.length < 1 || source.steps.length > 12) throw Error('方案需要1–12个制作步骤。');
  const steps = source.steps.map(item => {
    const step = object(item, '制作步骤', ['kind', 'name', 'instruction']);
    if (!capabilities.includes(step.kind as Capability)) throw Error('方案步骤只支持文字、图片检查、图片生成和图片精修。');
    return { kind: step.kind as Capability, name: text(step.name, '步骤名称', 80), instruction: text(step.instruction, '步骤说明', 10000) };
  });
  const pictures = object(source.illustrations, '文档配图', ['mode', 'count']);
  if (!['none', 'references', 'generate'].includes(pictures.mode as string)) throw Error('方案的文档配图方式无效。');
  const count = integer(pictures.count, '文档配图数量', 0, pictures.mode === 'references' ? DOCUMENT_REFERENCE_IMAGE_LIMIT : DOCUMENT_IMAGE_LIMIT);
  if (pictures.mode === 'none' && count !== 0 || pictures.mode !== 'none' && count < 1) throw Error('方案的配图方式与数量不一致。');
  return { version: 1, name: text(source.name, '方案名称', 80), objective: text(source.objective, '目标', 10000), outputKind: outputKind as NaturalAutomationPlan['outputKind'], trigger: normalizedTrigger, steps, illustrations: { mode: pictures.mode as NaturalAutomationPlan['illustrations']['mode'], count }, acceptance: texts(source.acceptance, '验收要求', 1), constraints: texts(source.constraints, '约束'), maxRepairs: integer(source.maxRepairs, '修订轮次', 0, 3), questions: texts(source.questions, '待澄清问题'), unsupported: texts(source.unsupported, '不支持事项') };
}

function isolatedJsonObject(source: string): unknown {
  let content = source.trim();
  const firstFence = content.indexOf('```'), firstObject = content.indexOf('{');
  if (firstFence >= 0 && (firstObject < 0 || firstFence < firstObject)) {
    const fence = /^([\s\S]*?)```(?:json)?[ \t]*(?:\r?\n|(?=\{))([\s\S]*)```([\s\S]*)$/i.exec(content);
    if (!fence) throw Error('AI方案的JSON围栏不完整或不唯一。');
    content = `${fence[1]}${fence[2]}${fence[3]}`;
  }
  let start = -1, end = -1, depth = 0, quoted = false, escaped = false, objects = 0;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (!depth) {
      if (character === '[' || character === ']' || character === '}') throw Error('AI方案不是独立的JSON对象。');
      if (character === '{') { start = index; depth = 1; }
      continue;
    }
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) { end = index + 1; objects++; }
  }
  if (depth || quoted || objects !== 1 || start < 0 || end < 0) throw Error('AI方案必须包含唯一完整的JSON对象。');
  const surrounding = content.slice(0, start) + content.slice(end);
  if (surrounding.length > 1000 || /"(?:[^"\\]|\\.)*"\s*:|```/.test(surrounding)) throw Error('AI方案对象外包含过多说明或额外配置。');
  return JSON.parse(content.slice(start, end));
}

function normalizeModelPlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>, normalized = { ...source };
  for (const key of ['constraints', 'questions', 'unsupported']) if (!Object.hasOwn(source, key)) normalized[key] = [];
  if (!Object.hasOwn(source, 'trigger')) normalized.trigger = { type: 'manual' };
  if (source.trigger && typeof source.trigger === 'object' && !Array.isArray(source.trigger)) {
    const trigger = { ...source.trigger } as Record<string, unknown>;
    if (trigger.type !== 'schedule' && (trigger.intervalMinutes === null || typeof trigger.intervalMinutes === 'number' && Number.isFinite(trigger.intervalMinutes))) delete trigger.intervalMinutes;
    if (trigger.type !== 'run-completed' && trigger.sourceWorkflowId === null) delete trigger.sourceWorkflowId;
    normalized.trigger = trigger;
  }
  if (source.illustrations && typeof source.illustrations === 'object' && !Array.isArray(source.illustrations)) {
    const pictures = { ...source.illustrations } as Record<string, unknown>;
    if (pictures.mode === 'none' && !Object.hasOwn(pictures, 'count')) pictures.count = 0;
    normalized.illustrations = pictures;
  }
  return normalized;
}

export function parseNaturalAutomationPlan(input: string): NaturalAutomationPlan {
  if (typeof input !== 'string' || !input.trim() || input.length > 100000) throw Error('AI方案为空或超过100000字，请保留原始结果并检查。');
  let parsed: unknown;
  try { parsed = JSON.parse(input.trim()); }
  catch { try { parsed = isolatedJsonObject(input); } catch { throw Error('AI没有返回唯一完整的JSON方案，原始结果与已发生费用保留，未自动重试。'); } }
  return validate(normalizeModelPlan(parsed));
}

const calendarMessage = '当前仅支持间隔触发，不能配置每天几点、每周或cron时间，请先澄清触发方式。';
function positiveRequestClauses(input: string): string[] {
  const negation = /^\s*(?:(?:请|我|我们|也|并且|并|而且|还|同时|且)\s*)*(?:不需要|不必|不用|不要|不得|不能|禁止|无需|不允许|不支持|切勿|勿|不(?:会|应|再|自动|进行|触发|执行|运行|发送|发|发布|上传|生成|制作|读取|访问|监听|监控|监视))/;
  return input.split(/[。；;\n，,]/).flatMap(value => value.split(/(?:但是|但|不过|而是)/)).flatMap(value => value.split(/(?=(?:也|并且|并)?(?:不需要|不必|不用|不要|不得|不能|禁止|无需|切勿|勿|不(?:会|应|再|自动|进行|触发|执行|运行|发送|发|发布|上传|读取|访问|监听|监控|监视)))/)).filter(value => value.trim() && !negation.test(value));
}
function requestsCalendarTrigger(value: string): boolean {
  const clause = value.replace(/https?:\/\/[^\s<>"'，。；、！？]+/gi, '');
  const daily = /(?:每天|每日|每晚|每早)[^。；\n]{0,18}(?:\d{1,2}\s*(?:[:：点时])|早上|上午|中午|下午|晚上)/.exec(clause);
  const weekly = /(?:每周|每星期|星期|周)[一二三四五六日天]/.exec(clause), cron = /\bcron\b/i.exec(clause), token = daily || weekly || cron;
  if (!token) return false;
  if (/(?:主题|标题|标语|台词|说明|描述)/.test(clause.slice(0, token.index)) || /(?:为|作)(?:主题|标题|标语)|这几个字/.test(clause)) return false;
  if (/(?:写|制作|起草|编辑|设计).{0,30}(?:教程|说明|文案|草稿|模板)/.test(clause) && !/(?:然后|再|同时|直接).{0,8}(?:自动|定时|触发|执行|运行)/.test(clause)) return false;
  if (daily || cron) return true;
  return /^\s*(?:每周|每星期|星期|周)[一二三四五六日天]\s*$/.test(clause) || /(?:每周|每星期|星期|周)[一二三四五六日天].{0,16}(?:自动|定时|触发|执行|运行|生成|制作|发送|发布|导出|出图|检查|产出|给我|帮我|我要)/.test(clause) || /(?:定时|触发|执行|运行|安排在|计划在).{0,12}(?:每周|每星期|星期|周)[一二三四五六日天]/.test(clause);
}
function calendarOnlyIssue(issue: string): boolean {
  return /(?:日历|cron|每天|每日|每周|星期|周[一二三四五六日天]|固定.{0,5}(?:时间|时刻)|几点|间隔触发)/i.test(issue) && !/(?:邮件|短信|发布|上传|音频|视频|音乐|语音|脚本|命令|网页|抓取|爬取|监听|监控|监视|\bKey\b|密钥|凭证|\bAPI\b|\bURL\b|网址|链接|操作系统|任意文件|路径)/i.test(issue);
}
export function naturalAutomationRequestIssues(input: string): string[] {
  if (typeof input !== 'string') return ['请填写有效的文字需求。'];
  const clauses = positiveRequestClauses(input), issues: string[] = [];
  if (clauses.some(requestsCalendarTrigger)) issues.push(calendarMessage);
  const actionClauses = clauses.filter(value => !/(?:写|制作|生成|起草|编辑|设计).{0,18}(?:文案|草稿|模板|教程|说明|方案|脚本)/.test(value) || /(?:并|再|然后|同时|自动|直接).{0,5}(?:发送|发布|上传|执行|运行)/.test(value)).join('；').replace(/https?:\/\/[^\s<>"'，。；、！？]+/gi, '');
  if (/(?:自动发送|发送|群发|投递|发).{0,8}(?:邮件|短信)|自动发布|(?:发布到|上传到).{0,20}(?:平台|网站|小红书|抖音|公众号|微博|Twitter|YouTube)|(?:生成|制作|剪辑|合成|配音).{0,8}(?:视频|音频|语音|音乐)|(?:转成|转为|转换为).{0,5}(?:语音|音频|视频)|(?:执行|运行).{0,8}(?:脚本|命令|powershell|shell)|(?:监听|监控|监视).{0,8}(?:文件夹|目录)/i.test(actionClauses)) issues.push('此入口尚未支持发送、发布、音视频、脚本执行或目录监听操作，请先调整目标。');
  if (clauses.some(value => /(?:抓取|爬取|访问|读取|打开)\s*(?:https?:\/\/|(?:这个|该|提供的)?(?:网页|网站|链接|网址))/i.test(value) && !/(?:文案|草稿|模板|教程|说明|方案)/.test(value))) issues.push('此入口不会自动读取网页，请先导入资料或粘贴网页内容。');
  return issues;
}

export function naturalAutomationPreparationNotes(plan: Pick<NaturalAutomationPlan, 'questions'>): string[] {
  return [...new Set(plan.questions.map(value => value.trim()).filter(Boolean))];
}
export function appendNaturalPreparationNotes(description: string, notes: readonly string[]): string {
  const lines = [...new Set(notes.map(value => value.trim()).filter(Boolean))].map(value => `- ${value}`), existing = new Set(description.split('\n').map(value => value.trim())), added = lines.filter(line => !existing.has(line));
  if (!added.length) return description;
  const heading = '运行前待准备/确认（未自动补全）：';
  return `${description.trim()}\n\n${description.includes(heading) ? '' : `${heading}\n`}${added.join('\n')}`.trim();
}

export function adjustNaturalImageRefinements(input: NaturalAutomationPlan, rounds: number): NaturalAutomationPlan {
  const plan = validate(input); integer(rounds, '计划内精修轮次', 0, 3);
  if (plan.outputKind !== 'image') return { ...plan, maxRepairs: rounds };
  if (!rounds && !plan.steps.some(step => step.kind === 'image-generation')) throw Error('当前方案以参考图编辑作为首次制作，不能直接移除全部制作步骤；请保留一次编辑或先生成初稿。');
  const originalEdits = plan.steps.filter(step => step.kind === 'image-editing'), originalChecks = plan.steps.filter(step => step.kind === 'vision');
  const checkInstructions = [...new Set(originalChecks.map(step => step.instruction))].join('\n');
  const opinion = (): NaturalAutomationPlan['steps'][number] => ({ kind: 'vision', name: '独立检查并提出精修意见', instruction: text(`依据实际图片列出可操作的修改意见，交给下一步保留实际原图进行精修。${checkInstructions ? `\n${checkInstructions}` : ''}`, '图片检查要求', 10000) });
  const finalCheck = (): NaturalAutomationPlan['steps'][number] => ({ kind: 'vision', name: '检查最终图片', instruction: text(`独立检查最终实际图片是否满足目标与验收要求，不声称检查了未提供的图片。${checkInstructions ? `\n${checkInstructions}` : ''}`, '图片检查要求', 10000) });
  const editNumber = new Map<number, number>(); let count = 0;
  plan.steps.forEach((step, index) => { if (step.kind === 'image-editing') editNumber.set(index, ++count); });
  const steps: NaturalAutomationPlan['steps'] = [];
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind === 'image-editing') {
      if (editNumber.get(index)! > rounds) continue;
      if (steps.at(-1)?.kind !== 'vision') steps.push(opinion());
      steps.push({ ...step }); continue;
    }
    if (step.kind === 'vision') {
      let following = index + 1; while (plan.steps[following]?.kind === 'vision') following++;
      if (plan.steps[following]?.kind === 'image-editing' && editNumber.get(following)! > rounds) continue;
      if (steps.at(-1)?.kind === 'vision') {
        const previous = steps.at(-1)!; previous.instruction = text(`${previous.instruction}\n${step.instruction}`, '图片检查要求', 10000);
      } else steps.push({ ...step });
      continue;
    }
    steps.push({ ...step });
  }
  while (steps.at(-1)?.kind === 'vision') steps.pop();
  let edits = steps.filter(step => step.kind === 'image-editing').length;
  while (edits < rounds) {
    if (steps.at(-1)?.kind !== 'vision') steps.push(opinion());
    steps.push({ kind: 'image-editing', name: `精修实际图片 ${edits + 1}/${rounds}`, instruction: text(`${originalEdits.at(-1)?.instruction || '保留原图主体及已经确认的要求，依据独立检查意见精修实际原图。'}\n使用前一步实际图片及检查意见，保留未要求修改的内容。`, '图片精修要求', 10000) }); edits++;
  }
  steps.push(finalCheck());
  if (steps.length > 12) throw Error('调整精修轮次后超过12个制作步骤，请减少其它步骤。');
  return validate({ ...plan, steps, maxRepairs: rounds });
}
function bindingResolver(configuration: Configuration, bindings: NaturalAutomationBindings, missing: Set<string>) {
  object(bindings, '模型选择', capabilities, []);
  for (const [kind, value] of Object.entries(bindings)) {
    const entry = object(value, `${labels[kind as Capability]}模型选择`, ['modelConfigId', 'credentialId'], []);
    for (const name of ['modelConfigId', 'credentialId']) if (entry[name] !== undefined) text(entry[name], '模型或Key编号', 160);
  }
  const cache = new Map<Capability, { modelConfigId?: string; credentialId?: string }>();
  return (kind: Capability) => {
    if (cache.has(kind)) return cache.get(kind)!;
    const protocols = kind === 'image-generation' || kind === 'image-editing' ? ['image', 'openai-chat', 'openai-responses'] : ['openai-chat', 'openai-responses', 'anthropic', 'gemini'];
    const available = configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(kind) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo && protocols.includes(connection.protocol)));
    const chosen = bindings[kind], model = chosen?.modelConfigId ? available.find(model => model.id === chosen.modelConfigId) : available.length === 1 ? available[0] : undefined;
    const result: { modelConfigId?: string; credentialId?: string } = { modelConfigId: undefined, credentialId: undefined };
    if (!model) missing.add(`${labels[kind]}：${chosen?.modelConfigId ? '所选模型不可用，请重新选择' : available.length ? '请选择一个模型' : '请添加可用的真实模型'}`);
    else {
      result.modelConfigId = model.id;
      const keys = configuration.credentials.filter(key => key.enabled && key.connectionId === model.connectionId);
      const credential = chosen?.credentialId ? keys.find(key => key.id === chosen.credentialId) : keys.length === 1 ? keys[0] : undefined;
      if (credential) result.credentialId = credential.id;
      else missing.add(`${labels[kind]}：${chosen?.credentialId ? '所选Key不可用，请重新选择' : keys.length ? '请选择一个Key' : '请添加此模型连接的Key'}`);
    }
    cache.set(kind, result); return result;
  };
}

export function compileNaturalAutomationPlan(input: NaturalAutomationPlan, project: Project, configuration: Configuration, bindings: NaturalAutomationBindings = {}, options: NaturalAutomationCompileOptions = {}): {
  workflow: WorkflowDraft; missing: string[]; preparationNotes: string[]; rule: { trigger: NaturalAutomationPlan['trigger']['type']; intervalMinutes?: number; sourceWorkflowId?: string; name: string; input: string; variables: Record<string, string> }; stepsSummary: string[];
} {
  const plan = validate(input);
  const calendarResolved = options.calendarResolved === true && ['manual', 'schedule'].includes(plan.trigger.type);
  const unsupported = plan.unsupported.filter(issue => !calendarResolved || !calendarOnlyIssue(issue));
  if ((!options.allowPreparationQuestions && plan.questions.length) || unsupported.length) throw Error(`请先处理方案中的待澄清问题或不支持事项：${[...(!options.allowPreparationQuestions ? plan.questions : []), ...unsupported].join('；')}`);
  const requestIssues = naturalAutomationRequestIssues([plan.objective, ...plan.steps.map(step => step.instruction)].join('\n')).filter(issue => !calendarResolved || !calendarOnlyIssue(issue)); if (requestIssues.length) throw Error(requestIssues.join('；'));
  const preparationNotes = options.allowPreparationQuestions ? naturalAutomationPreparationNotes(plan) : [];
  if (!project?.id || !project.workspaceId || project.trashedAt) throw Error('请选择当前工作区内可用的项目。');
  if (plan.outputKind !== project.kind) throw Error('方案产物类型与项目类型不一致，请更换匹配项目或调整方案。');
  if (plan.trigger.type === 'run-completed' && !configuration.workflows.some(workflow => workflow.id === plan.trigger.sourceWorkflowId && workflow.workspaceId === project.workspaceId && workflow.outputKind === project.kind)) throw Error('来源流程不存在、不属于当前工作区或与项目类型不匹配。');
  if (!['word', 'ppt'].includes(project.kind) && plan.illustrations.mode !== 'none') throw Error('文档配图仅用于Word或PPT，请调整方案的配图设置。');
  const missing = new Set<string>(), select = bindingResolver(configuration, bindings, missing);
  const references = (project.referenceFiles || []).filter(file => file.kind === 'image' && usableReference(file));
  const base = automationRecipe(project.kind, plan.name, { objective: plan.objective, deliverables: [project.kind], acceptance: plan.acceptance, constraints: plan.constraints, knownInputs: (project.referenceFiles || []).filter(usableReference).map(file => file.name) }, configuration as StudioConfiguration, plan.maxRepairs);
  const planner = { ...base.steps[0], ...select('text') }, steps: WorkflowStep[] = [planner];
  const imageOutputs: string[] = []; let latestImage: string | undefined, lastText: WorkflowStep | undefined, edits = 0;
  const add = (step: WorkflowStep) => { steps.push(step); return step; };
  const opinion = () => add({ id: crypto.randomUUID(), name: '独立检查并提出精修意见', role: 'reviewer', kind: 'vision', prompt: `依据用户目标检查实际图片，列出可操作的精修意见。不要只写通过或自评，不声称检查了未提供的图片。\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}`, inputSource: 'previous', enabled: true, maxOutputTokens: 2048, ...select('vision') });
  const imageStep = (kind: 'image-generation' | 'image-editing', name: string, instruction: string) => {
    if (kind === 'image-editing' && latestImage && steps.at(-1)?.kind !== 'vision') opinion();
    if (kind === 'image-editing' && !latestImage && !references.length) missing.add('图片精修：请为项目添加实际参考图片');
    const step = add({ id: crypto.randomUUID(), name, role: 'producer', kind, prompt: `${instruction}\n\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}\n约束：${plan.constraints.join('；')}`, inputSource: 'previous', enabled: true, count: 1, imageSize: 'auto', imageBackground: 'auto', ...select(kind), ...(kind === 'image-editing' && latestImage ? { imageSourceStepId: latestImage } : {}) });
    if (kind === 'image-editing') { edits++; if (latestImage) imageOutputs[imageOutputs.lastIndexOf(latestImage)] = step.id; else imageOutputs.push(step.id); }
    else imageOutputs.push(step.id);
    latestImage = step.id; return step;
  };
  const generationCount = plan.steps.filter(step => step.kind === 'image-generation').length;
  if (plan.illustrations.mode === 'generate') {
    if (plan.steps[0].kind === 'image-editing' && generationCount < plan.illustrations.count) throw Error('直接精修参考图与自动补图的来源不明确，请先调整制作步骤。');
    for (const picture of documentIllustrationSteps(Math.max(0, plan.illustrations.count - generationCount), plan.objective)) {
      add({ ...picture, role: 'producer', ...select('image-generation') }); imageOutputs.push(picture.id); latestImage = picture.id;
    }
  }
  for (const proposed of plan.steps) {
    if (proposed.kind === 'image-generation' || proposed.kind === 'image-editing') imageStep(proposed.kind, proposed.name, proposed.instruction);
    else if (proposed.kind === 'vision') {
      if (!latestImage && !references.length) missing.add('图片检查：请添加参考图片或先生成实际图片');
      add({ id: crypto.randomUUID(), name: proposed.name, role: 'reviewer', kind: 'vision', prompt: `${proposed.instruction}\n依据实际提供的图片给出独立、可操作的意见，不编造不可见细节。`, inputSource: 'previous', enabled: true, maxOutputTokens: 2048, ...select('vision') });
    } else {
      lastText = add({ id: crypto.randomUUID(), name: proposed.name, role: 'producer', kind: 'text', prompt: `${proposed.instruction}\n\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}\n约束：${plan.constraints.join('；')}`, inputSource: ['image-generation', 'image-editing'].includes(steps.at(-1)?.kind || '') ? 'project' : 'previous', enabled: true, maxOutputTokens: CREATION_PROFILES[project.kind].outputTokens, ...select('text') });
    }
  }
  if (project.kind === 'image') {
    if (!latestImage) throw Error('图片方案必须包含图片生成或图片精修步骤。');
    if (edits > plan.maxRepairs) throw Error('图片精修步骤数量超过计划内精修轮次，请调整步骤或精修轮次。');
    while (edits < plan.maxRepairs) imageStep('image-editing', `按独立检查精修图片 ${edits + 1}/${plan.maxRepairs}`, '保留原图主体及已经确认的要求，依据前一步独立检查意见精修实际原图。');
  } else {
    if (plan.steps.at(-1)?.kind !== 'text') throw Error('文档最后一个制作步骤需要输出完整正文，请将检查意见放在正文制作之前。');
    if (!lastText) throw Error('文档方案必须包含完整正文的文字制作步骤。');
    if (plan.illustrations.mode === 'references') {
      if (imageOutputs.length) throw Error('参考配图与图片制作步骤同时存在，请明确使用哪种文档配图方式。');
      if (references.length < plan.illustrations.count) missing.add(`文档配图：请添加至少${plan.illustrations.count}张项目参考图片`);
      if (references.length > DOCUMENT_REFERENCE_IMAGE_LIMIT) throw Error(`参考配图最多支持${DOCUMENT_REFERENCE_IMAGE_LIMIT}张，请调整项目参考图片。`);
      lastText.documentImageSource = 'references';
    } else if (plan.illustrations.mode === 'generate') {
      if (imageOutputs.length !== plan.illustrations.count) throw Error('图片制作步骤与配图数量不一致，请调整方案，避免额外生成或遗漏图片。');
      lastText.documentImageSource = 'previous'; lastText.documentImageStepIds = [...imageOutputs];
    } else if (imageOutputs.length) throw Error('文档含有图片制作步骤，请明确选择生成配图，避免产生未使用的收费图片。');
  }
  const sourceId = project.kind === 'image' ? latestImage! : lastText!.id;
  const existingFinalReview = project.kind === 'image' && steps.at(-1)?.kind === 'vision' ? steps.pop() : undefined;
  const reviewer: WorkflowStep = { ...base.steps[2], ...(existingFinalReview ? { id: existingFinalReview.id, name: existingFinalReview.name, prompt: `本次检查要求：${existingFinalReview.prompt}\n\n${base.steps[2].prompt}` } : {}), ...select(project.kind === 'image' ? 'vision' : 'text'), qualityGate: { ...(project.kind === 'image' ? {} : { repairStepId: sourceId }), maxRepairs: project.kind === 'image' ? 0 : plan.maxRepairs, minScore: 80 } };
  add(reviewer); add({ ...base.steps[3], contentSourceStepId: sourceId }); add(base.steps[4]);
  if (steps.length > 40) throw Error('本地展开后的流程超过40步，请减少步骤或配图数量。');
  const workflow = withCreationFoundation({ ...base, id: 'natural-preview', workspaceId: project.workspaceId, updatedAt: '', steps });
  const unfilledVariables = new Set([plan.objective, ...workflow.steps.map(step => step.prompt)].flatMap(extractVariables));
  for (const name of unfilledVariables) missing.add(`方案仍有未填变量“${name}”，请在目标或步骤要求里改成真实内容`);
  const description = project.kind === 'image' ? workflow.description.replace(/最多 \d 轮自动修订，人工确认后交付。$/, `计划内精修${plan.maxRepairs}轮，最终检查不再自动增加精修，等待人工确认。`) : workflow.description;
  const calendarNote = calendarResolved ? `执行时机已确认改为${plan.trigger.type === 'manual' ? '手动运行' : `应用运行期间每隔${plan.trigger.intervalMinutes}分钟运行`}；原描述的固定日历时间不再作为执行要求。` : '';
  const draft: WorkflowDraft = { name: workflow.name, description: appendNaturalPreparationNotes([description, calendarNote].filter(Boolean).join('\n'), preparationNotes), outputKind: workflow.outputKind, steps: workflow.steps, goalBrief: workflow.goalBrief, foundationVersion: workflow.foundationVersion };
  const { type, ...triggerDetails } = plan.trigger;
  return { workflow: draft, missing: [...missing], preparationNotes, rule: { trigger: type, ...triggerDetails, name: plan.name, input: [plan.objective, ...(calendarNote ? [calendarNote] : []), `验收要求：${plan.acceptance.join('；')}`, ...(plan.constraints.length ? [`约束：${plan.constraints.join('；')}`] : [])].join('\n'), variables: {} }, stepsSummary: workflow.steps.map((step, index) => `${index + 1}. ${step.name}${step.kind === 'image-editing' ? '（使用实际原图）' : step.kind === 'manual-review' ? '（等待你确认）' : ''}`) };
}
