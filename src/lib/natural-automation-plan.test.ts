import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { Project } from '../types';
import type { ModelCapability, StudioConfiguration } from '../configuration-types';
import { adjustNaturalImageRefinements, appendNaturalPreparationNotes, compileNaturalAutomationPlan, naturalAutomationPreparationNotes, naturalAutomationRequestIssues, NATURAL_AUTOMATION_SCHEMA, parseNaturalAutomationPlan } from './natural-automation-plan';
import { documentIllustrationSteps, illustratedDocumentSteps } from './document-illustrations';

const require = createRequire(import.meta.url);
type Configuration = Pick<StudioConfiguration, 'models' | 'connections' | 'credentials' | 'workflows'>;
const kinds = ['text', 'vision', 'image-generation', 'image-editing'] as const;
function configuration(): Configuration {
  return {
    connections: kinds.map(kind => ({ id: `connection-${kind}`, name: kind, providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' })),
    models: kinds.map(kind => ({ id: `model-${kind}`, name: kind, modelId: `actual-${kind}`, connectionId: `connection-${kind}`, capabilities: [kind] as ModelCapability[], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } })),
    credentials: kinds.map(kind => ({ id: `key-${kind}`, name: '仅凭证元数据', connectionId: `connection-${kind}`, enabled: true, lastFour: '0000', updatedAt: '' })), workflows: [],
  };
}
const project = (kind: Project['kind'] = 'image'): Project => ({ id: 'project', workspaceId: 'workspace', name: '真实项目', kind, description: '', status: 'draft', version: 3, costCents: 17, accent: 'purple', updatedAt: '' });
function imagePlan(): NaturalAutomationPlan {
  return { version: 1, name: '产品宣传图', objective: '制作产品宣传图，检查并精修一轮', outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '制作初稿', instruction: '制作清楚的产品宣传图' }, { kind: 'vision', name: '检查初稿', instruction: '独立检查实际图片并提出修改意见' }, { kind: 'image-editing', name: '精修原图', instruction: '保留原图产品并依据意见精修' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['主体清晰', '产品结构保持一致'], constraints: ['不编造促销数据'], maxRepairs: 1, questions: [], unsupported: [] };
}
function wordPlan(): NaturalAutomationPlan { return { ...imagePlan(), name: '完整说明文档', objective: '制作完整说明文档', outputKind: 'word', steps: [{ kind: 'text', name: '完整正文', instruction: '依据资料完成完整说明文档' }], maxRepairs: 2 }; }
const compileImage = (plan = imagePlan(), config = configuration()) => compileNaturalAutomationPlan(plan, project(), config);

it('文字与看图制作保存推理强度，切换至不支持的型号回退默认且native结果一致', () => {
  const config = configuration(); config.connections = config.connections.map(connection => ({ ...connection, providerId: 'openai' })); config.models = config.models.map(model => ({ ...model, modelId: model.capabilities.includes('text') || model.capabilities.includes('vision') ? 'gpt-6.1-terra' : model.modelId }));
  const bindings = { text: { modelConfigId: 'model-text', credentialId: 'key-text', reasoningEffort: 'high' as const }, vision: { modelConfigId: 'model-vision', credentialId: 'key-vision', reasoningEffort: 'low' as const } };
  const word = compileNaturalAutomationPlan(wordPlan(), project('word'), config, bindings);
  expect(word.workflow.steps.filter(step => step.kind === 'text').every(step => step.reasoningEffort === 'high')).toBe(true);
  const image = compileNaturalAutomationPlan(imagePlan(), project(), config, bindings);
  expect(image.workflow.steps.filter(step => step.kind === 'vision').every(step => step.reasoningEffort === 'low')).toBe(true);
  expect(image.workflow.steps.filter(step => step.kind.startsWith('image-')).every(step => step.reasoningEffort === undefined)).toBe(true);
  const native = require('../../electron/natural-automation-plan.runtime.cjs').compileNaturalAutomationPlan(wordPlan(), project('word'), config, bindings);
  expect(native.workflow.steps.map((step: { reasoningEffort?: string }) => step.reasoningEffort)).toEqual(word.workflow.steps.map(step => step.reasoningEffort));
  config.models = config.models.map(model => ({ ...model, modelId: 'gpt-4.1' }));
  expect(compileNaturalAutomationPlan(wordPlan(), project('word'), config, bindings).workflow.steps.filter(step => step.kind === 'text').every(step => step.reasoningEffort === 'auto')).toBe(true);
});

describe('自然语言自动化严格解析', () => {
  it('只接受完整JSON对象并返回独立有界结构，schema不暴露自由连接或执行字段', () => {
    const plan = imagePlan(), parsed = parseNaturalAutomationPlan(` \n${JSON.stringify(plan)}\n`);
    expect(parsed).toEqual(plan); parsed.acceptance.push('独立修改'); expect(plan.acceptance).toHaveLength(2);
    expect(NATURAL_AUTOMATION_SCHEMA.additionalProperties).toBe(false); expect(NATURAL_AUTOMATION_SCHEMA.properties.steps.items.additionalProperties).toBe(false);
  });
  it.each(['', '{}', '[]', 'null', '```json\n{}\n```', '{"version":1', 'x'.repeat(100001)])('错误JSON或过长结果不自动修复：%s', value => { expect(() => parseNaturalAutomationPlan(value)).toThrow(); });
  it.each([
    ['根多余字段', (plan: any) => { plan.enabled = true; }],
    ['缺少必需目标', (plan: any) => { delete plan.objective; }],
    ['隐式类型转换', (plan: any) => { plan.version = '1'; }],
    ['原型字段', (plan: any) => { Object.defineProperty(plan, '__proto__', { value: {}, enumerable: true }); }],
    ['步骤自由URL', (plan: any) => { plan.steps[0].baseUrl = 'https://unknown.invalid'; }],
    ['步骤价格', (plan: any) => { plan.steps[0].price = 0; }],
    ['步骤脚本', (plan: any) => { plan.steps[0].command = 'execute'; }],
    ['步骤音视频', (plan: any) => { plan.steps[0].kind = 'speech'; }],
    ['定时cron', (plan: any) => { plan.trigger = { type: 'schedule', intervalMinutes: 30, cron: '0 9 * * *' }; }],
    ['触发参数错误类型', (plan: any) => { plan.trigger = { type: 'manual', intervalMinutes: { command: 'run' } }; }],
    ['过多步骤', (plan: any) => { plan.steps = Array(13).fill(plan.steps[0]); }],
    ['空验收标准', (plan: any) => { plan.acceptance = []; }],
    ['空文字', (plan: any) => { plan.name = '  '; }],
    ['过长文字', (plan: any) => { plan.objective = 'x'.repeat(10001); }],
    ['小数次数', (plan: any) => { plan.maxRepairs = 1.5; }],
    ['修订上限', (plan: any) => { plan.maxRepairs = 4; }],
    ['none配图非零', (plan: any) => { plan.illustrations.count = 1; }],
    ['配图小数', (plan: any) => { plan.illustrations = { mode: 'generate', count: 1.5 }; }],
    ['参考图超限', (plan: any) => { plan.illustrations = { mode: 'references', count: 13 }; }],
  ])('%s立即拒绝', (_label, mutate) => { const plan = imagePlan(); mutate(plan); expect(() => parseNaturalAutomationPlan(JSON.stringify(plan))).toThrow(); });
  it('间隔及配图边界合法；合法的澄清问题留在可见方案但不能编译保存', () => {
    for (const minutes of [1, 10080]) expect(parseNaturalAutomationPlan(JSON.stringify({ ...wordPlan(), trigger: { type: 'schedule', intervalMinutes: minutes }, illustrations: { mode: 'generate', count: 20 } })).trigger.intervalMinutes).toBe(minutes);
    for (const minutes of [0, 10081, '30']) expect(() => parseNaturalAutomationPlan(JSON.stringify({ ...wordPlan(), trigger: { type: 'schedule', intervalMinutes: minutes } }))).toThrow();
    const plan = parseNaturalAutomationPlan(JSON.stringify({ ...imagePlan(), questions: ['需要确认产品素材'] })); expect(plan.questions).toHaveLength(1); expect(() => compileImage(plan)).toThrow('待澄清');
    expect(() => compileImage({ ...imagePlan(), unsupported: ['不支持邮件发送'] })).toThrow('不支持事项');
  });
  it('完整围栏和唯一JSON对象外少量说明在本地免费取出，字符串括号/转义不影响边界', () => {
    const plan = imagePlan(); plan.steps[0].instruction += '；文字里有{以及}与"引号"，代码围栏```只是引用资料'; const json = JSON.stringify(plan);
    for (const response of [`\`\`\`json\n${json}\n\`\`\``, `\`\`\`\n${json}\n\`\`\``, `方案如下：\n${json}\n请先查看这份方案。`, `方案如下：\n\`\`\`json\n${json}\n\`\`\`\n请先查看。`]) expect(parseNaturalAutomationPlan(response)).toEqual(plan);
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'); expect(runtime.parseNaturalAutomationPlan(`\`\`\`json\n${json}\n\`\`\``)).toEqual(plan);
  });
  it('只补省略的可选空字段和无效于当前触发方式的默认值，不吞真实错误来源', () => {
    const source: any = imagePlan(); delete source.constraints; delete source.questions; delete source.unsupported; delete source.illustrations.count; source.trigger = { type: 'manual', intervalMinutes: 60, sourceWorkflowId: null };
    expect(parseNaturalAutomationPlan(JSON.stringify(source))).toEqual({ ...imagePlan(), constraints: [] });
    source.trigger.intervalMinutes = null; expect(parseNaturalAutomationPlan(JSON.stringify(source)).trigger).toEqual({ type: 'manual' });
    for (const trigger of [{ type: 'manual', sourceWorkflowId: 'real-but-inapplicable' }, { type: 'schedule', intervalMinutes: null }, { type: 'run-completed', sourceWorkflowId: null }, { type: 'manual', intervalMinutes: '60' }]) expect(() => parseNaturalAutomationPlan(JSON.stringify({ ...imagePlan(), trigger }))).toThrow();
    expect(() => parseNaturalAutomationPlan(JSON.stringify({ ...imagePlan(), constraints: null }))).toThrow();
  });
  it('省略整个trigger只安全默认手动，不让原句的日历或邮件要求变成已支持动作', () => {
    const source: any = imagePlan(); delete source.trigger; const parsed = parseNaturalAutomationPlan(JSON.stringify(source)); expect(parsed.trigger).toEqual({ type: 'manual' }); expect(compileImage(parsed).rule).not.toHaveProperty('enabled');
    expect(() => parseNaturalAutomationPlan(JSON.stringify({ ...source, trigger: null }))).toThrow();
    for (const original of ['每天9点自动生成宣传图', '自动发送邮件给客户']) {
      const unsupported = naturalAutomationRequestIssues(original); expect(unsupported.length).toBeGreaterThan(0); expect(() => compileNaturalAutomationPlan({ ...parsed, unsupported }, project(), configuration(), {}, { allowPreparationQuestions: true })).toThrow();
    }
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'); expect(runtime.parseNaturalAutomationPlan(JSON.stringify(source)).trigger).toEqual({ type: 'manual' });
  });
  it('免费格式规范化不接受多个对象、残缺围栏、数组外壳或暗藏的执行字段', () => {
    const json = JSON.stringify(imagePlan());
    for (const response of [`${json}\n${json}`, `\`\`\`json\n${json}`, `\`\`\`javascript\n${json}\n\`\`\``, `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``, `[${json}]`, `说明[${json}]`, `${json},"enabled":true`, `x${'{'.repeat(2)}${json}`, `${'说'.repeat(1001)}${json}`]) expect(() => parseNaturalAutomationPlan(response)).toThrow();
    for (const value of [{ ...imagePlan(), enabled: true }, { ...imagePlan(), apiKey: 'unsafe' }, { ...imagePlan(), baseUrl: 'https://arbitrary.invalid' }, { ...imagePlan(), steps: [{ ...imagePlan().steps[0], command: 'execute' }] }]) expect(() => parseNaturalAutomationPlan(`方案：${JSON.stringify(value)}`)).toThrow();
  });
});

describe('本地编译与真实配置选择', () => {
  it('产品图→独立意见→实际原图编辑→最终检查→最终图片导出→人工确认，只有明确一轮编辑', () => {
    const plan = imagePlan(), target = project(), config = configuration(), before = JSON.stringify({ plan, target, config });
    const result = compileNaturalAutomationPlan(plan, target, config), steps = result.workflow.steps;
    expect(steps.map(step => step.kind)).toEqual(['text', 'image-generation', 'vision', 'image-editing', 'vision', 'export', 'manual-review']);
    expect(steps[0].role).toBe('planner'); expect(steps[2].qualityGate).toBeUndefined(); expect(steps[3].imageSourceStepId).toBe(steps[1].id); expect(steps[3].inputSource).toBe('previous');
    expect(steps[4].qualityGate).toEqual({ maxRepairs: 0, minScore: 80 }); expect(steps[5].contentSourceStepId).toBe(steps[3].id);
    expect(steps[1].prompt).toContain('序作内置创作规范'); expect(steps[3].prompt).toContain('序作内置创作规范'); expect(result.missing).toEqual([]); expect(result.rule.variables).toEqual({}); expect(result.rule).not.toHaveProperty('enabled');
    expect(result.stepsSummary.join('\n')).toContain('实际原图'); expect(JSON.stringify({ plan, target, config })).toBe(before);
  });
  it('AI遗漏意见或计划内精修时本地补齐有上限的实际步骤，不额外重试最终检查', () => {
    const result = compileImage({ ...imagePlan(), steps: [imagePlan().steps[0]], maxRepairs: 3 }), steps = result.workflow.steps;
    expect(steps.filter(step => step.kind === 'image-editing')).toHaveLength(3); expect(steps.filter(step => step.kind === 'vision')).toHaveLength(4);
    const images = steps.filter(step => ['image-generation', 'image-editing'].includes(step.kind)); for (let index = 1; index < images.length; index++) expect(images[index].imageSourceStepId).toBe(images[index - 1].id);
    expect(steps.at(-3)?.qualityGate?.maxRepairs).toBe(0); expect(steps.at(-2)?.contentSourceStepId).toBe(images.at(-1)?.id);
    expect(() => compileImage({ ...imagePlan(), maxRepairs: 0 })).toThrow('超过计划内');
  });
  it('已有末尾看图检查复用为最终门，不增加第二次相同检查请求', () => {
    const result = compileImage({ ...imagePlan(), steps: imagePlan().steps.slice(0, 2), maxRepairs: 0 });
    expect(result.workflow.steps.map(step => step.kind)).toEqual(['text', 'image-generation', 'vision', 'export', 'manual-review']); expect(result.workflow.steps[2].qualityGate?.maxRepairs).toBe(0);
  });
  it('图片编辑前独立意见不会阻塞有限修订，跨文字准备仍引用最近实际图片', () => {
    const result = compileImage({ ...imagePlan(), steps: [imagePlan().steps[0], { kind: 'text', name: '组织画面文字', instruction: '围绕已确认信息精炼文案' }, imagePlan().steps[2]] });
    const edit = result.workflow.steps.find(step => step.kind === 'image-editing')!, position = result.workflow.steps.indexOf(edit);
    expect(result.workflow.steps[position - 1]).toMatchObject({ kind: 'vision', role: 'reviewer' }); expect(result.workflow.steps[position - 1].qualityGate).toBeUndefined(); expect(edit.imageSourceStepId).toBe(result.workflow.steps[1].id);
  });
  it('能力缺项只列一次并保留可保存为停用草稿的结构，不使用演示模型', () => {
    const result = compileImage(imagePlan(), { models: [], connections: [], credentials: [], workflows: [] }); expect(result.missing).toHaveLength(4);
    expect(result.workflow.steps.filter(step => ['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind)).every(step => step.modelConfigId === undefined && step.credentialId === undefined)).toBe(true);
    const demo = configuration(); demo.models.forEach(model => { model.demo = true; }); expect(compileImage(imagePlan(), demo).missing).toHaveLength(4);
  });
  it('目标和步骤的未填变量列为缺项并去重，不静默替换为真实内容或假称就绪', () => {
    const plan = imagePlan(); plan.objective = '为{{ 产品名称 }}制作宣传图'; plan.steps[0].instruction += '；画面中使用{{产品名称}}与{{活动名称}}';
    const result = compileImage(plan); expect(result.missing).toHaveLength(2); expect(result.missing[0]).toContain('产品名称'); expect(result.missing[1]).toContain('活动名称'); expect(result.missing.every(item => item.includes('真实内容'))).toBe(true);
    expect(result.rule.variables).toEqual({}); expect(result.rule.input).toContain('{{ 产品名称 }}'); expect(result.workflow.steps[1].prompt).toContain('{{产品名称}}');
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'); expect(runtime.compileNaturalAutomationPlan(plan, project(), configuration()).missing).toEqual(result.missing);
  });
  it('多个模型或Key不随机选，按能力显式绑定一次应用到所有相应步骤', () => {
    const config = configuration(); config.models.push({ ...config.models[1], id: 'other-vision' }); config.credentials.push({ ...config.credentials[1], id: 'other-vision-key' });
    const unresolved = compileImage(imagePlan(), config); expect(unresolved.missing).toEqual(['图片检查：请选择一个模型']);
    const modelOnly = compileNaturalAutomationPlan(imagePlan(), project(), config, { vision: { modelConfigId: 'other-vision' } }); expect(modelOnly.missing).toEqual(['图片检查：请选择一个Key']);
    const selected = compileNaturalAutomationPlan(imagePlan(), project(), config, { vision: { modelConfigId: 'other-vision', credentialId: 'other-vision-key' } }); expect(selected.missing).toEqual([]); expect(selected.workflow.steps.filter(step => step.kind === 'vision').every(step => step.modelConfigId === 'other-vision' && step.credentialId === 'other-vision-key')).toBe(true);
  });
  it('无效显式选择不偷偷退回另一个供应商，拒绝模型自由连接字段', () => {
    const result = compileNaturalAutomationPlan(imagePlan(), project(), configuration(), { text: { modelConfigId: 'missing' }, vision: { credentialId: 'key-text' } }); expect(result.missing).toEqual(['文字制作：所选模型不可用，请重新选择', '图片检查：所选Key不可用，请重新选择']);
    expect(result.workflow.steps[0].modelConfigId).toBeUndefined(); expect(() => compileNaturalAutomationPlan(imagePlan(), project(), configuration(), { text: { baseUrl: 'https://arbitrary.invalid' } } as never)).toThrow('不支持的字段');
  });
  it.each(['每天9点制作产品图', '每周一生成图片', '按照cron执行', '自动发送邮件给客户', '自动发布到小红书', '生成宣传视频', '运行shell脚本', '监听文件夹新增图片'])('不能把不支持需求偷换为已配置：%s', objective => { expect(() => compileImage({ ...imagePlan(), objective })).toThrow(); });
  it('正常9:00活动内容及禁止发送等约束不会被误当成已配置日历或发送动作', () => {
    expect(() => compileNaturalAutomationPlan({ ...wordPlan(), objective: '制作9:00开始的活动议程，不要发送邮件' }, project('word'), configuration())).not.toThrow();
  });
  it('否定动作和PPT周一主题不是自动触发，正向日历请求仍会阻止', () => {
    for (const sentence of ['帮我制作宣传图，不需要自动发送邮件，也不要每天9点触发', '不自动发送邮件，不会每天9点执行；请勿发布到小红书', 'PPT主题每周一见', '制作一个PPT，主题为每周一见，说明产品每周一上新', '以每天9点见为主题制作PPT', '写一份cron表达式说明']) expect(naturalAutomationRequestIssues(sentence)).toEqual([]);
    for (const sentence of ['每天9点自动生成报告', '周一生成报告', '每周一我要一张宣传图', '不要发短信，但每天9点执行', '不要每天9点执行，但自动发送邮件', '不锈钢杯每天9点自动发布']) expect(naturalAutomationRequestIssues(sentence).length).toBeGreaterThan(0);
  });
  it('原句检测不依赖模型删减后的objective，商品URL和纯文案不被一律拦截', () => {
    for (const sentence of ['每天9点自动制作宣传图', '周一生成报告', '按cron运行', '制作文案然后发布到小红书', '发送邮件给客户', '发邮件给客户', '自动发布文档', '把文档转成语音', '读取https://example.invalid/product']) expect(naturalAutomationRequestIssues(sentence).length).toBeGreaterThan(0);
    for (const sentence of ['用这段商品资料写文案 https://shop.invalid/cron-product', '帮我写发布到小红书的文案', '写一份发送邮件的说明文档', '制作Word说明，不要发送邮件']) expect(naturalAutomationRequestIssues(sentence)).toEqual([]);
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'); expect(runtime.naturalAutomationRequestIssues('每天9点生成')).toEqual(naturalAutomationRequestIssues('每天9点生成'));
  });
  it('只有适配的真实连接可自动绑定，演示或未适配协议不能冒充已就绪', () => {
    const config = configuration(); config.connections[0].protocol = 'demo'; config.connections[1].protocol = 'custom'; expect(compileImage(imagePlan(), config).missing).toEqual(['文字制作：请添加可用的真实模型', '图片检查：请添加可用的真实模型']);
  });
  it('匹配项目类型、当前范围来源流程，拒绝未知或跨区来源', () => {
    expect(() => compileNaturalAutomationPlan(imagePlan(), project('word'), configuration())).toThrow('类型不一致');
    expect(() => compileNaturalAutomationPlan(imagePlan(), { ...project(), trashedAt: 'now' }, configuration())).toThrow('可用的项目');
    const config = configuration(), plan = { ...imagePlan(), trigger: { type: 'run-completed' as const, sourceWorkflowId: 'source' } };
    expect(() => compileImage(plan, config)).toThrow('来源流程'); config.workflows.push({ id: 'source', workspaceId: 'other', name: '源', outputKind: 'image', description: '', steps: [], updatedAt: '' }); expect(() => compileImage(plan, config)).toThrow('当前工作区'); config.workflows[0].workspaceId = 'workspace'; expect(compileImage(plan, config).rule.sourceWorkflowId).toBe('source');
  });
});

describe('创建停用方案与免费本地调整', () => {
  it('仅creation选项允许准备问题变成可见备注，缺模型/图片仍返回提醒且不伪造成已补全', () => {
    const plan = { ...imagePlan(), questions: ['请提供产品图片', '请确认品牌名称', '请提供产品图片'] }, empty: Configuration = { models: [], credentials: [], connections: [], workflows: [] };
    expect(() => compileNaturalAutomationPlan(plan, project(), empty)).toThrow('待澄清');
    const compiled = compileNaturalAutomationPlan(plan, project(), empty, {}, { allowPreparationQuestions: true }); expect(compiled.preparationNotes).toEqual(['请提供产品图片', '请确认品牌名称']); expect(compiled.missing).toHaveLength(4); expect(compiled.workflow.description).toContain('未自动补全'); expect(compiled.workflow.description).toContain('请提供产品图片'); expect(compiled.rule.variables).toEqual({}); expect(compiled.rule).not.toHaveProperty('enabled'); expect(plan.questions).toHaveLength(3);
    expect(naturalAutomationPreparationNotes(plan)).toEqual(compiled.preparationNotes); const text = appendNaturalPreparationNotes('原方案', compiled.preparationNotes); expect(appendNaturalPreparationNotes(text, compiled.preparationNotes)).toBe(text);
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'), native = runtime.compileNaturalAutomationPlan(plan, project(), empty, {}, { allowPreparationQuestions: true }); expect(native.preparationNotes).toEqual(compiled.preparationNotes); expect(native.missing).toEqual(compiled.missing); expect(native.workflow.description).toBe(compiled.workflow.description);
  });
  it('用户明确改为手动/间隔后只解除日历限制，不能清除邮件发布等真正能力边界', () => {
    const plan = { ...imagePlan(), objective: '每天9点自动生成宣传图', unsupported: ['不支持每天9点的日历触发'] };
    expect(() => compileNaturalAutomationPlan(plan, project(), configuration(), {}, { allowPreparationQuestions: true })).toThrow();
    for (const trigger of [{ type: 'manual' as const }, { type: 'schedule' as const, intervalMinutes: 60 }]) { const resolved = compileNaturalAutomationPlan({ ...plan, trigger }, project(), configuration(), {}, { allowPreparationQuestions: true, calendarResolved: true }); expect(resolved.rule.trigger).toBe(trigger.type); expect(resolved.rule.input).toContain('执行时机已确认改为'); expect(resolved.rule.input).toContain('固定日历时间不再作为执行要求'); }
    for (const unsupported of [['发送邮件'], ['每天9点并发送邮件'], ['不支持发布到小红书'], ['每天9点并读取本机Key'], ['每天9点操作任意文件路径']]) expect(() => compileNaturalAutomationPlan({ ...plan, unsupported }, project(), configuration(), {}, { allowPreparationQuestions: true, calendarResolved: true })).toThrow();
    expect(() => compileNaturalAutomationPlan({ ...plan, objective: '每天9点自动生成并发送邮件', unsupported: [] }, project(), configuration(), {}, { calendarResolved: true })).toThrow('发送');
    expect(() => compileNaturalAutomationPlan({ ...plan, trigger: { type: 'reference-imported' } }, project(), configuration(), {}, { calendarResolved: true })).toThrow();
  });
  it.each([0, 1, 2, 3])('精修改为%d轮免费重排真实原图链，只有一项最终检查且不修改原方案', rounds => {
    const original = imagePlan(), before = JSON.stringify(original), adjusted = adjustNaturalImageRefinements(original, rounds), result = compileImage(adjusted), stages = result.workflow.steps;
    expect(adjusted.maxRepairs).toBe(rounds); expect(adjusted.steps.filter(step => step.kind === 'image-editing')).toHaveLength(rounds); expect(stages.filter(step => step.kind === 'image-generation')).toHaveLength(1); expect(stages.filter(step => step.kind === 'vision')).toHaveLength(rounds + 1);
    const images = stages.filter(step => ['image-generation', 'image-editing'].includes(step.kind)); for (let index = 1; index < images.length; index++) expect(images[index].imageSourceStepId).toBe(images[index - 1].id);
    expect(stages.at(-3)?.qualityGate).toEqual({ maxRepairs: 0, minScore: 80 }); expect(stages.at(-2)?.contentSourceStepId).toBe(images.at(-1)?.id); expect(adjusted.steps.find(step => step.kind === 'image-generation')?.instruction).toBe(original.steps[0].instruction); if (rounds) expect(adjusted.steps.find(step => step.kind === 'image-editing')?.instruction).toContain(original.steps[2].instruction); expect(JSON.stringify(original)).toBe(before);
    expect(result.workflow.description).toContain(`计划内精修${rounds}轮`);
  });
  it('降低多轮精修会移除孤立检查，不把编辑替换为重新生图，参考图首次编辑不能静默消失', () => {
    const many = adjustNaturalImageRefinements(imagePlan(), 3), zero = adjustNaturalImageRefinements(many, 0); expect(zero.steps.map(step => step.kind)).toEqual(['image-generation', 'vision']);
    expect(() => adjustNaturalImageRefinements(imagePlan(), 4)).toThrow(); expect(() => adjustNaturalImageRefinements({ ...imagePlan(), steps: [imagePlan().steps[2]] }, 0)).toThrow('首次制作');
    const document = wordPlan(); expect(adjustNaturalImageRefinements(document, 0).steps).toEqual(document.steps);
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'); expect(runtime.adjustNaturalImageRefinements(imagePlan(), 0)).toEqual(adjustNaturalImageRefinements(imagePlan(), 0));
  });
  it('默认rule input保持旧版本格式，已有creationKey重试不会因共享层升级改变指纹', () => {
    const plan = imagePlan(); expect(compileImage(plan).rule.input).toBe(`${plan.objective}\n验收要求：${plan.acceptance.join('；')}\n约束：${plan.constraints.join('；')}`);
  });
});

describe('图文文档及共享runtime', () => {
  it('Word/PPT/Excel使用完整正文规范和有限条件修订，导出不引用检查JSON', () => {
    for (const kind of ['word', 'ppt', 'excel'] as const) {
      const result = compileNaturalAutomationPlan({ ...wordPlan(), outputKind: kind }, project(kind), configuration()), producer = result.workflow.steps[1], review = result.workflow.steps[2];
      expect(producer.prompt).toContain('返回可解析的 JSON'); expect(producer.inputSource).toBe('previous'); expect(review.qualityGate).toMatchObject({ repairStepId: producer.id, maxRepairs: 2 }); expect(result.workflow.steps[3].contentSourceStepId).toBe(producer.id);
    }
    expect(() => compileNaturalAutomationPlan({ ...wordPlan(), steps: [{ kind: 'vision', name: '检查', instruction: '检查提供图片' }] }, project('word'), configuration())).toThrow('最后一个制作步骤');
  });
  it('生成配图复用纯插图factory，缺图片模型仍有完整可见草稿，已绑定时图片与正文引用一致', () => {
    const plan = { ...wordPlan(), illustrations: { mode: 'generate' as const, count: 3 } }, config = configuration(), result = compileNaturalAutomationPlan(plan, project('word'), config), pictures = result.workflow.steps.filter(step => step.kind === 'image-generation'), body = result.workflow.steps.find(step => step.kind === 'text' && step.role === 'producer')!;
    expect(pictures).toHaveLength(3); expect(body.documentImageStepIds).toEqual(pictures.map(step => step.id)); expect(body.documentImageSource).toBe('previous'); expect(pictures.every(step => step.modelConfigId === 'model-image-generation')).toBe(true); expect(result.workflow.steps.at(-2)?.contentSourceStepId).toBe(body.id);
    config.models = config.models.filter(model => !model.capabilities.includes('image-generation')); const missing = compileNaturalAutomationPlan(plan, project('word'), config); expect(missing.missing).toEqual(['图片生成：请添加可用的真实模型']); expect(missing.workflow.steps.filter(step => step.kind === 'image-generation')).toHaveLength(3);
    expect(() => illustratedDocumentSteps(body, [], { mode: 'generate', count: 1 }, config, '实际需求')).toThrow('真实图片生成模型'); expect(documentIllustrationSteps(0, '目标')).toEqual([]); expect(() => documentIllustrationSteps(21, '目标')).toThrow();
  });
  it('显式配图精修只插入最后真实图，不重复插入初稿或额外生成', () => {
    const plan = { ...wordPlan(), illustrations: { mode: 'generate' as const, count: 1 }, steps: [...imagePlan().steps, wordPlan().steps[0]] }, result = compileNaturalAutomationPlan(plan, project('word'), configuration()), edit = result.workflow.steps.find(step => step.kind === 'image-editing')!, body = result.workflow.steps.find(step => step.kind === 'text' && step.role === 'producer')!;
    expect(result.workflow.steps.filter(step => step.kind === 'image-generation')).toHaveLength(1); expect(body.documentImageStepIds).toEqual([edit.id]);
  });
  it('参考图缺项/超限和非文档配图明确处理，避免不使用的收费图片', () => {
    const plan = { ...wordPlan(), illustrations: { mode: 'references' as const, count: 2 } }; expect(compileNaturalAutomationPlan(plan, project('word'), configuration()).missing).toEqual(['文档配图：请添加至少2张项目参考图片']);
    const reference = { id: 'ref', name: '真实参考.png', kind: 'image' as const, mimeType: 'image/png', bytes: 10, createdAt: '', path: 'owned/reference.png' }, target = { ...project('word'), referenceFiles: [reference, { ...reference, id: 'ref-two' }] };
    const result = compileNaturalAutomationPlan(plan, target, configuration()); expect(result.missing).toEqual([]); expect(result.workflow.steps[1].documentImageSource).toBe('references');
    expect(() => compileNaturalAutomationPlan(plan, { ...target, referenceFiles: Array.from({ length: 13 }, (_, index) => ({ ...reference, id: `ref-${index}` })) }, configuration())).toThrow('最多支持12');
    expect(() => compileImage({ ...imagePlan(), illustrations: { mode: 'generate', count: 1 } })).toThrow('仅用于Word或PPT');
    expect(() => compileNaturalAutomationPlan({ ...wordPlan(), steps: [...imagePlan().steps, wordPlan().steps[0]] }, project('word'), configuration())).toThrow('未使用的收费图片');
  });
  it('展开后的操作仍受40步上限约束', () => {
    const plan = { ...wordPlan(), illustrations: { mode: 'generate' as const, count: 20 }, steps: [wordPlan().steps[0], ...Array.from({ length: 10 }, () => imagePlan().steps[2]), wordPlan().steps[0]] }; expect(() => compileNaturalAutomationPlan(plan, project('word'), configuration())).toThrow('超过40步');
  });
  it('生成的native CJS runtime与前端共享严格schema、解析和步骤图语义', () => {
    const runtime = require('../../electron/natural-automation-plan.runtime.cjs'); expect(runtime.NATURAL_AUTOMATION_SCHEMA).toEqual(NATURAL_AUTOMATION_SCHEMA);
    expect(runtime.parseNaturalAutomationPlan(JSON.stringify(imagePlan()))).toEqual(imagePlan()); expect(() => runtime.parseNaturalAutomationPlan('{')).toThrow('JSON');
    const native = runtime.compileNaturalAutomationPlan(imagePlan(), project(), configuration()), browser = compileImage(); expect(native.workflow.steps.map((step: any) => step.kind)).toEqual(browser.workflow.steps.map(step => step.kind)); expect(native.rule).toEqual(browser.rule); expect(native.missing).toEqual([]); expect(native.workflow.steps[3].imageSourceStepId).toBe(native.workflow.steps[1].id); expect(native.workflow.steps.at(-2).contentSourceStepId).toBe(native.workflow.steps[3].id);
  });
});
