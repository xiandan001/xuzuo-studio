// Generated from src/lib/natural-automation-plan.ts and its shared helpers; run scripts/build-spreadsheet-runtime.mjs.
'use strict';
const factories = {
"./natural-automation-plan": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NATURAL_AUTOMATION_SCHEMA = void 0;
exports.parseNaturalAutomationPlan = parseNaturalAutomationPlan;
exports.naturalAutomationRequestIssues = naturalAutomationRequestIssues;
exports.naturalAutomationPreparationNotes = naturalAutomationPreparationNotes;
exports.appendNaturalPreparationNotes = appendNaturalPreparationNotes;
exports.adjustNaturalImageRefinements = adjustNaturalImageRefinements;
exports.compileNaturalAutomationPlan = compileNaturalAutomationPlan;
const automation_recipes_1 = require("./automation-recipes");
const creation_quality_1 = require("./creation-quality");
const creation_profiles_1 = require("./creation-profiles");
const document_illustrations_1 = require("./document-illustrations");
const prompt_variables_1 = require("./prompt-variables");
const capabilities = ['text', 'vision', 'image-generation', 'image-editing'];
const labels = { text: '文字制作', vision: '图片检查', 'image-generation': '图片生成', 'image-editing': '图片精修' };
const rootKeys = ['version', 'name', 'objective', 'outputKind', 'trigger', 'steps', 'illustrations', 'acceptance', 'constraints', 'maxRepairs', 'questions', 'unsupported'];
const usableReference = (file) => !('trashedAt' in file && file.trashedAt) && !('unavailable' in file && file.unavailable);
const stringListSchema = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 2000 } };
exports.NATURAL_AUTOMATION_SCHEMA = {
    type: 'object', additionalProperties: false, required: [...rootKeys],
    properties: {
        version: { const: 1 }, name: { type: 'string', minLength: 1, maxLength: 80 }, objective: { type: 'string', minLength: 1, maxLength: 10000 },
        outputKind: { enum: ['word', 'ppt', 'excel', 'image'] },
        trigger: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { enum: ['manual', 'schedule', 'reference-imported', 'run-completed'] }, intervalMinutes: { type: 'integer', minimum: 1, maximum: 10080 }, sourceWorkflowId: { type: 'string', minLength: 1, maxLength: 160 } }, description: 'schedule仅表示应用运行期间每隔指定分钟；不支持每天9点、星期、cron等日历时间，遇到这些要求必须写入questions/unsupported。只有run-completed可填写已有sourceWorkflowId。' },
        steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['kind', 'name', 'instruction'], properties: { kind: { enum: [...capabilities] }, name: { type: 'string', minLength: 1, maxLength: 80 }, instruction: { type: 'string', minLength: 1, maxLength: 10000 } } }, description: '只描述文字、看图、生成图片、编辑图片；不提供代码、接口URL、价格或凭证。检查并精修图片时列出image-generation、vision、image-editing。' },
        illustrations: { type: 'object', additionalProperties: false, required: ['mode', 'count'], properties: { mode: { enum: ['none', 'references', 'generate'] }, count: { type: 'integer', minimum: 0, maximum: document_illustrations_1.DOCUMENT_IMAGE_LIMIT } }, description: '仅Word/PPT使用文档配图：none时count=0；generate为1–20张；references表示至少需要1–12张项目参考图，实际使用项目提供的参考图。' },
        acceptance: { ...stringListSchema, minItems: 1 }, constraints: stringListSchema, maxRepairs: { type: 'integer', minimum: 0, maximum: 3 }, questions: stringListSchema, unsupported: stringListSchema,
    },
};
function object(value, field, allowed, required = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
        throw Error(`方案的${field}必须是JSON对象。`);
    const result = value;
    if (Object.keys(result).some(key => !allowed.includes(key)))
        throw Error(`方案的${field}包含不支持的字段。`);
    if (required.some(key => !Object.hasOwn(result, key)))
        throw Error(`方案的${field}缺少必填字段。`);
    return result;
}
function text(value, field, limit) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
        throw Error(`方案的${field}需要填写1–${limit}字的有效文字。`);
    return value.trim();
}
function integer(value, field, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum)
        throw Error(`方案的${field}必须是${minimum}–${maximum}的整数。`);
    return value;
}
function texts(value, field, minimum = 0) {
    if (!Array.isArray(value) || value.length < minimum || value.length > 20)
        throw Error(`方案的${field}必须包含${minimum}–20项。`);
    return value.map(item => text(item, field, 2000));
}
function validate(value) {
    const source = object(value, '根结构', rootKeys);
    if (source.version !== 1)
        throw Error('方案版本不受支持。');
    const outputKind = source.outputKind;
    if (!['word', 'ppt', 'excel', 'image'].includes(outputKind))
        throw Error('方案的产物类型不受支持。');
    const trigger = object(source.trigger, '触发方式', ['type', 'intervalMinutes', 'sourceWorkflowId'], ['type']);
    if (!['manual', 'schedule', 'reference-imported', 'run-completed'].includes(trigger.type))
        throw Error('方案的触发方式不受支持。');
    if (trigger.type !== 'schedule' && trigger.intervalMinutes !== undefined || trigger.type !== 'run-completed' && trigger.sourceWorkflowId !== undefined)
        throw Error('方案的触发参数与触发方式不一致。');
    const normalizedTrigger = { type: trigger.type };
    if (trigger.type === 'schedule')
        normalizedTrigger.intervalMinutes = integer(trigger.intervalMinutes, '间隔分钟', 1, 10080);
    if (trigger.type === 'run-completed')
        normalizedTrigger.sourceWorkflowId = text(trigger.sourceWorkflowId, '来源流程', 160);
    if (!Array.isArray(source.steps) || source.steps.length < 1 || source.steps.length > 12)
        throw Error('方案需要1–12个制作步骤。');
    const steps = source.steps.map(item => {
        const step = object(item, '制作步骤', ['kind', 'name', 'instruction']);
        if (!capabilities.includes(step.kind))
            throw Error('方案步骤只支持文字、图片检查、图片生成和图片精修。');
        return { kind: step.kind, name: text(step.name, '步骤名称', 80), instruction: text(step.instruction, '步骤说明', 10000) };
    });
    const pictures = object(source.illustrations, '文档配图', ['mode', 'count']);
    if (!['none', 'references', 'generate'].includes(pictures.mode))
        throw Error('方案的文档配图方式无效。');
    const count = integer(pictures.count, '文档配图数量', 0, pictures.mode === 'references' ? document_illustrations_1.DOCUMENT_REFERENCE_IMAGE_LIMIT : document_illustrations_1.DOCUMENT_IMAGE_LIMIT);
    if (pictures.mode === 'none' && count !== 0 || pictures.mode !== 'none' && count < 1)
        throw Error('方案的配图方式与数量不一致。');
    return { version: 1, name: text(source.name, '方案名称', 80), objective: text(source.objective, '目标', 10000), outputKind: outputKind, trigger: normalizedTrigger, steps, illustrations: { mode: pictures.mode, count }, acceptance: texts(source.acceptance, '验收要求', 1), constraints: texts(source.constraints, '约束'), maxRepairs: integer(source.maxRepairs, '修订轮次', 0, 3), questions: texts(source.questions, '待澄清问题'), unsupported: texts(source.unsupported, '不支持事项') };
}
function isolatedJsonObject(source) {
    let content = source.trim();
    const firstFence = content.indexOf('```'), firstObject = content.indexOf('{');
    if (firstFence >= 0 && (firstObject < 0 || firstFence < firstObject)) {
        const fence = /^([\s\S]*?)```(?:json)?[ \t]*(?:\r?\n|(?=\{))([\s\S]*)```([\s\S]*)$/i.exec(content);
        if (!fence)
            throw Error('AI方案的JSON围栏不完整或不唯一。');
        content = `${fence[1]}${fence[2]}${fence[3]}`;
    }
    let start = -1, end = -1, depth = 0, quoted = false, escaped = false, objects = 0;
    for (let index = 0; index < content.length; index++) {
        const character = content[index];
        if (!depth) {
            if (character === '[' || character === ']' || character === '}')
                throw Error('AI方案不是独立的JSON对象。');
            if (character === '{') {
                start = index;
                depth = 1;
            }
            continue;
        }
        if (quoted) {
            if (escaped)
                escaped = false;
            else if (character === '\\')
                escaped = true;
            else if (character === '"')
                quoted = false;
            continue;
        }
        if (character === '"')
            quoted = true;
        else if (character === '{')
            depth++;
        else if (character === '}' && --depth === 0) {
            end = index + 1;
            objects++;
        }
    }
    if (depth || quoted || objects !== 1 || start < 0 || end < 0)
        throw Error('AI方案必须包含唯一完整的JSON对象。');
    const surrounding = content.slice(0, start) + content.slice(end);
    if (surrounding.length > 1000 || /"(?:[^"\\]|\\.)*"\s*:|```/.test(surrounding))
        throw Error('AI方案对象外包含过多说明或额外配置。');
    return JSON.parse(content.slice(start, end));
}
function normalizeModelPlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
    const source = value, normalized = { ...source };
    for (const key of ['constraints', 'questions', 'unsupported'])
        if (!Object.hasOwn(source, key))
            normalized[key] = [];
    if (!Object.hasOwn(source, 'trigger'))
        normalized.trigger = { type: 'manual' };
    if (source.trigger && typeof source.trigger === 'object' && !Array.isArray(source.trigger)) {
        const trigger = { ...source.trigger };
        if (trigger.type !== 'schedule' && (trigger.intervalMinutes === null || typeof trigger.intervalMinutes === 'number' && Number.isFinite(trigger.intervalMinutes)))
            delete trigger.intervalMinutes;
        if (trigger.type !== 'run-completed' && trigger.sourceWorkflowId === null)
            delete trigger.sourceWorkflowId;
        normalized.trigger = trigger;
    }
    if (source.illustrations && typeof source.illustrations === 'object' && !Array.isArray(source.illustrations)) {
        const pictures = { ...source.illustrations };
        if (pictures.mode === 'none' && !Object.hasOwn(pictures, 'count'))
            pictures.count = 0;
        normalized.illustrations = pictures;
    }
    return normalized;
}
function parseNaturalAutomationPlan(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 100000)
        throw Error('AI方案为空或超过100000字，请保留原始结果并检查。');
    let parsed;
    try {
        parsed = JSON.parse(input.trim());
    }
    catch {
        try {
            parsed = isolatedJsonObject(input);
        }
        catch {
            throw Error('AI没有返回唯一完整的JSON方案，原始结果与已发生费用保留，未自动重试。');
        }
    }
    return validate(normalizeModelPlan(parsed));
}
const calendarMessage = '当前仅支持间隔触发，不能配置每天几点、每周或cron时间，请先澄清触发方式。';
function positiveRequestClauses(input) {
    const negation = /^\s*(?:(?:请|我|我们|也|并且|并|而且|还|同时|且)\s*)*(?:不需要|不必|不用|不要|不得|不能|禁止|无需|不允许|不支持|切勿|勿|不(?:会|应|再|自动|进行|触发|执行|运行|发送|发|发布|上传|生成|制作|读取|访问|监听|监控|监视))/;
    return input.split(/[。；;\n，,]/).flatMap(value => value.split(/(?:但是|但|不过|而是)/)).flatMap(value => value.split(/(?=(?:也|并且|并)?(?:不需要|不必|不用|不要|不得|不能|禁止|无需|切勿|勿|不(?:会|应|再|自动|进行|触发|执行|运行|发送|发|发布|上传|读取|访问|监听|监控|监视)))/)).filter(value => value.trim() && !negation.test(value));
}
function requestsCalendarTrigger(value) {
    const clause = value.replace(/https?:\/\/[^\s<>"'，。；、！？]+/gi, '');
    const daily = /(?:每天|每日|每晚|每早)[^。；\n]{0,18}(?:\d{1,2}\s*(?:[:：点时])|早上|上午|中午|下午|晚上)/.exec(clause);
    const weekly = /(?:每周|每星期|星期|周)[一二三四五六日天]/.exec(clause), cron = /\bcron\b/i.exec(clause), token = daily || weekly || cron;
    if (!token)
        return false;
    if (/(?:主题|标题|标语|台词|说明|描述)/.test(clause.slice(0, token.index)) || /(?:为|作)(?:主题|标题|标语)|这几个字/.test(clause))
        return false;
    if (/(?:写|制作|起草|编辑|设计).{0,30}(?:教程|说明|文案|草稿|模板)/.test(clause) && !/(?:然后|再|同时|直接).{0,8}(?:自动|定时|触发|执行|运行)/.test(clause))
        return false;
    if (daily || cron)
        return true;
    return /^\s*(?:每周|每星期|星期|周)[一二三四五六日天]\s*$/.test(clause) || /(?:每周|每星期|星期|周)[一二三四五六日天].{0,16}(?:自动|定时|触发|执行|运行|生成|制作|发送|发布|导出|出图|检查|产出|给我|帮我|我要)/.test(clause) || /(?:定时|触发|执行|运行|安排在|计划在).{0,12}(?:每周|每星期|星期|周)[一二三四五六日天]/.test(clause);
}
function calendarOnlyIssue(issue) {
    return /(?:日历|cron|每天|每日|每周|星期|周[一二三四五六日天]|固定.{0,5}(?:时间|时刻)|几点|间隔触发)/i.test(issue) && !/(?:邮件|短信|发布|上传|音频|视频|音乐|语音|脚本|命令|网页|抓取|爬取|监听|监控|监视|\bKey\b|密钥|凭证|\bAPI\b|\bURL\b|网址|链接|操作系统|任意文件|路径)/i.test(issue);
}
function naturalAutomationRequestIssues(input) {
    if (typeof input !== 'string')
        return ['请填写有效的文字需求。'];
    const clauses = positiveRequestClauses(input), issues = [];
    if (clauses.some(requestsCalendarTrigger))
        issues.push(calendarMessage);
    const actionClauses = clauses.filter(value => !/(?:写|制作|生成|起草|编辑|设计).{0,18}(?:文案|草稿|模板|教程|说明|方案|脚本)/.test(value) || /(?:并|再|然后|同时|自动|直接).{0,5}(?:发送|发布|上传|执行|运行)/.test(value)).join('；').replace(/https?:\/\/[^\s<>"'，。；、！？]+/gi, '');
    if (/(?:自动发送|发送|群发|投递|发).{0,8}(?:邮件|短信)|自动发布|(?:发布到|上传到).{0,20}(?:平台|网站|小红书|抖音|公众号|微博|Twitter|YouTube)|(?:生成|制作|剪辑|合成|配音).{0,8}(?:视频|音频|语音|音乐)|(?:转成|转为|转换为).{0,5}(?:语音|音频|视频)|(?:执行|运行).{0,8}(?:脚本|命令|powershell|shell)|(?:监听|监控|监视).{0,8}(?:文件夹|目录)/i.test(actionClauses))
        issues.push('此入口尚未支持发送、发布、音视频、脚本执行或目录监听操作，请先调整目标。');
    if (clauses.some(value => /(?:抓取|爬取|访问|读取|打开)\s*(?:https?:\/\/|(?:这个|该|提供的)?(?:网页|网站|链接|网址))/i.test(value) && !/(?:文案|草稿|模板|教程|说明|方案)/.test(value)))
        issues.push('此入口不会自动读取网页，请先导入资料或粘贴网页内容。');
    return issues;
}
function naturalAutomationPreparationNotes(plan) {
    return [...new Set(plan.questions.map(value => value.trim()).filter(Boolean))];
}
function appendNaturalPreparationNotes(description, notes) {
    const lines = [...new Set(notes.map(value => value.trim()).filter(Boolean))].map(value => `- ${value}`), existing = new Set(description.split('\n').map(value => value.trim())), added = lines.filter(line => !existing.has(line));
    if (!added.length)
        return description;
    const heading = '运行前待准备/确认（未自动补全）：';
    return `${description.trim()}\n\n${description.includes(heading) ? '' : `${heading}\n`}${added.join('\n')}`.trim();
}
function adjustNaturalImageRefinements(input, rounds) {
    const plan = validate(input);
    integer(rounds, '计划内精修轮次', 0, 3);
    if (plan.outputKind !== 'image')
        return { ...plan, maxRepairs: rounds };
    if (!rounds && !plan.steps.some(step => step.kind === 'image-generation'))
        throw Error('当前方案以参考图编辑作为首次制作，不能直接移除全部制作步骤；请保留一次编辑或先生成初稿。');
    const originalEdits = plan.steps.filter(step => step.kind === 'image-editing'), originalChecks = plan.steps.filter(step => step.kind === 'vision');
    const checkInstructions = [...new Set(originalChecks.map(step => step.instruction))].join('\n');
    const opinion = () => ({ kind: 'vision', name: '独立检查并提出精修意见', instruction: text(`依据实际图片列出可操作的修改意见，交给下一步保留实际原图进行精修。${checkInstructions ? `\n${checkInstructions}` : ''}`, '图片检查要求', 10000) });
    const finalCheck = () => ({ kind: 'vision', name: '检查最终图片', instruction: text(`独立检查最终实际图片是否满足目标与验收要求，不声称检查了未提供的图片。${checkInstructions ? `\n${checkInstructions}` : ''}`, '图片检查要求', 10000) });
    const editNumber = new Map();
    let count = 0;
    plan.steps.forEach((step, index) => { if (step.kind === 'image-editing')
        editNumber.set(index, ++count); });
    const steps = [];
    for (const [index, step] of plan.steps.entries()) {
        if (step.kind === 'image-editing') {
            if (editNumber.get(index) > rounds)
                continue;
            if (steps.at(-1)?.kind !== 'vision')
                steps.push(opinion());
            steps.push({ ...step });
            continue;
        }
        if (step.kind === 'vision') {
            let following = index + 1;
            while (plan.steps[following]?.kind === 'vision')
                following++;
            if (plan.steps[following]?.kind === 'image-editing' && editNumber.get(following) > rounds)
                continue;
            if (steps.at(-1)?.kind === 'vision') {
                const previous = steps.at(-1);
                previous.instruction = text(`${previous.instruction}\n${step.instruction}`, '图片检查要求', 10000);
            }
            else
                steps.push({ ...step });
            continue;
        }
        steps.push({ ...step });
    }
    while (steps.at(-1)?.kind === 'vision')
        steps.pop();
    let edits = steps.filter(step => step.kind === 'image-editing').length;
    while (edits < rounds) {
        if (steps.at(-1)?.kind !== 'vision')
            steps.push(opinion());
        steps.push({ kind: 'image-editing', name: `精修实际图片 ${edits + 1}/${rounds}`, instruction: text(`${originalEdits.at(-1)?.instruction || '保留原图主体及已经确认的要求，依据独立检查意见精修实际原图。'}\n使用前一步实际图片及检查意见，保留未要求修改的内容。`, '图片精修要求', 10000) });
        edits++;
    }
    steps.push(finalCheck());
    if (steps.length > 12)
        throw Error('调整精修轮次后超过12个制作步骤，请减少其它步骤。');
    return validate({ ...plan, steps, maxRepairs: rounds });
}
function bindingResolver(configuration, bindings, missing) {
    object(bindings, '模型选择', capabilities, []);
    for (const [kind, value] of Object.entries(bindings)) {
        const entry = object(value, `${labels[kind]}模型选择`, ['modelConfigId', 'credentialId'], []);
        for (const name of ['modelConfigId', 'credentialId'])
            if (entry[name] !== undefined)
                text(entry[name], '模型或Key编号', 160);
    }
    const cache = new Map();
    return (kind) => {
        if (cache.has(kind))
            return cache.get(kind);
        const protocols = kind === 'image-generation' || kind === 'image-editing' ? ['image', 'openai-chat', 'openai-responses'] : ['openai-chat', 'openai-responses', 'anthropic', 'gemini'];
        const available = configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(kind) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo && protocols.includes(connection.protocol)));
        const chosen = bindings[kind], model = chosen?.modelConfigId ? available.find(model => model.id === chosen.modelConfigId) : available.length === 1 ? available[0] : undefined;
        const result = { modelConfigId: undefined, credentialId: undefined };
        if (!model)
            missing.add(`${labels[kind]}：${chosen?.modelConfigId ? '所选模型不可用，请重新选择' : available.length ? '请选择一个模型' : '请添加可用的真实模型'}`);
        else {
            result.modelConfigId = model.id;
            const keys = configuration.credentials.filter(key => key.enabled && key.connectionId === model.connectionId);
            const credential = chosen?.credentialId ? keys.find(key => key.id === chosen.credentialId) : keys.length === 1 ? keys[0] : undefined;
            if (credential)
                result.credentialId = credential.id;
            else
                missing.add(`${labels[kind]}：${chosen?.credentialId ? '所选Key不可用，请重新选择' : keys.length ? '请选择一个Key' : '请添加此模型连接的Key'}`);
        }
        cache.set(kind, result);
        return result;
    };
}
function compileNaturalAutomationPlan(input, project, configuration, bindings = {}, options = {}) {
    const plan = validate(input);
    const calendarResolved = options.calendarResolved === true && ['manual', 'schedule'].includes(plan.trigger.type);
    const unsupported = plan.unsupported.filter(issue => !calendarResolved || !calendarOnlyIssue(issue));
    if ((!options.allowPreparationQuestions && plan.questions.length) || unsupported.length)
        throw Error(`请先处理方案中的待澄清问题或不支持事项：${[...(!options.allowPreparationQuestions ? plan.questions : []), ...unsupported].join('；')}`);
    const requestIssues = naturalAutomationRequestIssues([plan.objective, ...plan.steps.map(step => step.instruction)].join('\n')).filter(issue => !calendarResolved || !calendarOnlyIssue(issue));
    if (requestIssues.length)
        throw Error(requestIssues.join('；'));
    const preparationNotes = options.allowPreparationQuestions ? naturalAutomationPreparationNotes(plan) : [];
    if (!project?.id || !project.workspaceId || project.trashedAt)
        throw Error('请选择当前工作区内可用的项目。');
    if (plan.outputKind !== project.kind)
        throw Error('方案产物类型与项目类型不一致，请更换匹配项目或调整方案。');
    if (plan.trigger.type === 'run-completed' && !configuration.workflows.some(workflow => workflow.id === plan.trigger.sourceWorkflowId && workflow.workspaceId === project.workspaceId && workflow.outputKind === project.kind))
        throw Error('来源流程不存在、不属于当前工作区或与项目类型不匹配。');
    if (!['word', 'ppt'].includes(project.kind) && plan.illustrations.mode !== 'none')
        throw Error('文档配图仅用于Word或PPT，请调整方案的配图设置。');
    const missing = new Set(), select = bindingResolver(configuration, bindings, missing);
    const references = (project.referenceFiles || []).filter(file => file.kind === 'image' && usableReference(file));
    const base = (0, automation_recipes_1.automationRecipe)(project.kind, plan.name, { objective: plan.objective, deliverables: [project.kind], acceptance: plan.acceptance, constraints: plan.constraints, knownInputs: (project.referenceFiles || []).filter(usableReference).map(file => file.name) }, configuration, plan.maxRepairs);
    const planner = { ...base.steps[0], ...select('text') }, steps = [planner];
    const imageOutputs = [];
    let latestImage, lastText, edits = 0;
    const add = (step) => { steps.push(step); return step; };
    const opinion = () => add({ id: crypto.randomUUID(), name: '独立检查并提出精修意见', role: 'reviewer', kind: 'vision', prompt: `依据用户目标检查实际图片，列出可操作的精修意见。不要只写通过或自评，不声称检查了未提供的图片。\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}`, inputSource: 'previous', enabled: true, maxOutputTokens: 2048, ...select('vision') });
    const imageStep = (kind, name, instruction) => {
        if (kind === 'image-editing' && latestImage && steps.at(-1)?.kind !== 'vision')
            opinion();
        if (kind === 'image-editing' && !latestImage && !references.length)
            missing.add('图片精修：请为项目添加实际参考图片');
        const step = add({ id: crypto.randomUUID(), name, role: 'producer', kind, prompt: `${instruction}\n\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}\n约束：${plan.constraints.join('；')}`, inputSource: 'previous', enabled: true, count: 1, imageSize: 'auto', imageBackground: 'auto', ...select(kind), ...(kind === 'image-editing' && latestImage ? { imageSourceStepId: latestImage } : {}) });
        if (kind === 'image-editing') {
            edits++;
            if (latestImage)
                imageOutputs[imageOutputs.lastIndexOf(latestImage)] = step.id;
            else
                imageOutputs.push(step.id);
        }
        else
            imageOutputs.push(step.id);
        latestImage = step.id;
        return step;
    };
    const generationCount = plan.steps.filter(step => step.kind === 'image-generation').length;
    if (plan.illustrations.mode === 'generate') {
        if (plan.steps[0].kind === 'image-editing' && generationCount < plan.illustrations.count)
            throw Error('直接精修参考图与自动补图的来源不明确，请先调整制作步骤。');
        for (const picture of (0, document_illustrations_1.documentIllustrationSteps)(Math.max(0, plan.illustrations.count - generationCount), plan.objective)) {
            add({ ...picture, role: 'producer', ...select('image-generation') });
            imageOutputs.push(picture.id);
            latestImage = picture.id;
        }
    }
    for (const proposed of plan.steps) {
        if (proposed.kind === 'image-generation' || proposed.kind === 'image-editing')
            imageStep(proposed.kind, proposed.name, proposed.instruction);
        else if (proposed.kind === 'vision') {
            if (!latestImage && !references.length)
                missing.add('图片检查：请添加参考图片或先生成实际图片');
            add({ id: crypto.randomUUID(), name: proposed.name, role: 'reviewer', kind: 'vision', prompt: `${proposed.instruction}\n依据实际提供的图片给出独立、可操作的意见，不编造不可见细节。`, inputSource: 'previous', enabled: true, maxOutputTokens: 2048, ...select('vision') });
        }
        else {
            lastText = add({ id: crypto.randomUUID(), name: proposed.name, role: 'producer', kind: 'text', prompt: `${proposed.instruction}\n\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}\n约束：${plan.constraints.join('；')}`, inputSource: ['image-generation', 'image-editing'].includes(steps.at(-1)?.kind || '') ? 'project' : 'previous', enabled: true, maxOutputTokens: creation_profiles_1.CREATION_PROFILES[project.kind].outputTokens, ...select('text') });
        }
    }
    if (project.kind === 'image') {
        if (!latestImage)
            throw Error('图片方案必须包含图片生成或图片精修步骤。');
        if (edits > plan.maxRepairs)
            throw Error('图片精修步骤数量超过计划内精修轮次，请调整步骤或精修轮次。');
        while (edits < plan.maxRepairs)
            imageStep('image-editing', `按独立检查精修图片 ${edits + 1}/${plan.maxRepairs}`, '保留原图主体及已经确认的要求，依据前一步独立检查意见精修实际原图。');
    }
    else {
        if (plan.steps.at(-1)?.kind !== 'text')
            throw Error('文档最后一个制作步骤需要输出完整正文，请将检查意见放在正文制作之前。');
        if (!lastText)
            throw Error('文档方案必须包含完整正文的文字制作步骤。');
        if (plan.illustrations.mode === 'references') {
            if (imageOutputs.length)
                throw Error('参考配图与图片制作步骤同时存在，请明确使用哪种文档配图方式。');
            if (references.length < plan.illustrations.count)
                missing.add(`文档配图：请添加至少${plan.illustrations.count}张项目参考图片`);
            if (references.length > document_illustrations_1.DOCUMENT_REFERENCE_IMAGE_LIMIT)
                throw Error(`参考配图最多支持${document_illustrations_1.DOCUMENT_REFERENCE_IMAGE_LIMIT}张，请调整项目参考图片。`);
            lastText.documentImageSource = 'references';
        }
        else if (plan.illustrations.mode === 'generate') {
            if (imageOutputs.length !== plan.illustrations.count)
                throw Error('图片制作步骤与配图数量不一致，请调整方案，避免额外生成或遗漏图片。');
            lastText.documentImageSource = 'previous';
            lastText.documentImageStepIds = [...imageOutputs];
        }
        else if (imageOutputs.length)
            throw Error('文档含有图片制作步骤，请明确选择生成配图，避免产生未使用的收费图片。');
    }
    const sourceId = project.kind === 'image' ? latestImage : lastText.id;
    const existingFinalReview = project.kind === 'image' && steps.at(-1)?.kind === 'vision' ? steps.pop() : undefined;
    const reviewer = { ...base.steps[2], ...(existingFinalReview ? { id: existingFinalReview.id, name: existingFinalReview.name, prompt: `本次检查要求：${existingFinalReview.prompt}\n\n${base.steps[2].prompt}` } : {}), ...select(project.kind === 'image' ? 'vision' : 'text'), qualityGate: { ...(project.kind === 'image' ? {} : { repairStepId: sourceId }), maxRepairs: project.kind === 'image' ? 0 : plan.maxRepairs, minScore: 80 } };
    add(reviewer);
    add({ ...base.steps[3], contentSourceStepId: sourceId });
    add(base.steps[4]);
    if (steps.length > 40)
        throw Error('本地展开后的流程超过40步，请减少步骤或配图数量。');
    const workflow = (0, creation_quality_1.withCreationFoundation)({ ...base, id: 'natural-preview', workspaceId: project.workspaceId, updatedAt: '', steps });
    const unfilledVariables = new Set([plan.objective, ...workflow.steps.map(step => step.prompt)].flatMap(prompt_variables_1.extractVariables));
    for (const name of unfilledVariables)
        missing.add(`方案仍有未填变量“${name}”，请在目标或步骤要求里改成真实内容`);
    const description = project.kind === 'image' ? workflow.description.replace(/最多 \d 轮自动修订，人工确认后交付。$/, `计划内精修${plan.maxRepairs}轮，最终检查不再自动增加精修，等待人工确认。`) : workflow.description;
    const calendarNote = calendarResolved ? `执行时机已确认改为${plan.trigger.type === 'manual' ? '手动运行' : `应用运行期间每隔${plan.trigger.intervalMinutes}分钟运行`}；原描述的固定日历时间不再作为执行要求。` : '';
    const draft = { name: workflow.name, description: appendNaturalPreparationNotes([description, calendarNote].filter(Boolean).join('\n'), preparationNotes), outputKind: workflow.outputKind, steps: workflow.steps, goalBrief: workflow.goalBrief, foundationVersion: workflow.foundationVersion };
    const { type, ...triggerDetails } = plan.trigger;
    return { workflow: draft, missing: [...missing], preparationNotes, rule: { trigger: type, ...triggerDetails, name: plan.name, input: [plan.objective, ...(calendarNote ? [calendarNote] : []), `验收要求：${plan.acceptance.join('；')}`, ...(plan.constraints.length ? [`约束：${plan.constraints.join('；')}`] : [])].join('\n'), variables: {} }, stepsSummary: workflow.steps.map((step, index) => `${index + 1}. ${step.name}${step.kind === 'image-editing' ? '（使用实际原图）' : step.kind === 'manual-review' ? '（等待你确认）' : ''}`) };
}

},
"./automation-recipes": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTOMATION_FOUNDATION_VERSION = void 0;
exports.automationRecipe = automationRecipe;
const studio_run_1 = require("./studio-run");
const creation_profiles_1 = require("./creation-profiles");
const creation_quality_1 = require("./creation-quality");
exports.AUTOMATION_FOUNDATION_VERSION = '2026-11-03-v1';
function automationRecipe(kind, name, brief, configuration, maxRepairs = 1) {
    const bind = (step) => {
        const model = (0, studio_run_1.studioModel)(configuration.models.filter(model => !model.demo && model.enabled && model.capabilities.includes(step.kind) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo)));
        const credentialId = (0, studio_run_1.studioCredential)(configuration.credentials, model?.connectionId);
        return { ...step, modelConfigId: model?.id, credentialId };
    };
    const planner = bind({ id: crypto.randomUUID(), name: '明确目标、资料和验收要求', role: 'planner', kind: 'text', enabled: true, inputSource: 'project', maxOutputTokens: 2048, prompt: '你是任务规划员。依据用户目标与真实参考资料整理任务书，只返回JSON：{"objective":"目标","deliverables":[],"knownFacts":[],"missingInputs":[],"constraints":[],"acceptance":[]}。缺失事实如实列出，不编造客户、价格、日期或数据。任务书供后续制作使用，不冒充成品。' });
    const producer = bind({ id: crypto.randomUUID(), name: kind === 'image' ? '制作实际图片' : '制作完整文档', role: 'producer', kind: kind === 'image' ? 'image-generation' : 'text', enabled: true, inputSource: 'previous', maxOutputTokens: creation_profiles_1.CREATION_PROFILES[kind].outputTokens, count: 1, imageSize: 'auto', prompt: `根据用户目标和上一阶段任务书制作完整${{ word: 'Word文档', ppt: '演示文稿', excel: '业务工作簿', image: '图像' }[kind]}。\n验收要求：${brief.acceptance.join('；')}\n边界：${brief.constraints.join('；')}\n已提供资料：${brief.knownInputs.join('；')}。缺项按规范保留为待核实信息，不编造事实。` });
    const reviewer = bind({ id: crypto.randomUUID(), name: '独立检查实际结果', role: 'reviewer', kind: kind === 'image' ? 'vision' : 'text', enabled: true, inputSource: 'previous', maxOutputTokens: 2048, qualityGate: { repairStepId: producer.id, maxRepairs: Math.max(0, Math.min(3, maxRepairs)), minScore: 80 }, prompt: `你是独立验收员，不能以作者自评代替检查。依据用户目标及实际提供的内容检查完整性、事实边界、可用性、明显格式/图像问题；无法从当前材料核实的项必须列出。验收标准：${brief.acceptance.join('；')}。仅返回JSON：{"passed":true,"score":0,"issues":["可操作的问题"],"summary":"检查证据与尚未核实项"}；score为0到100。明显占位、关键要求遗漏或虚构事实不能通过。不声称已打开实际未渲染的Office文件，也不声称素材已获授权。` });
    const exporter = { id: crypto.randomUUID(), name: '生成实际交付文件', kind: 'export', enabled: true, inputSource: 'previous', prompt: '', ...(kind !== 'image' ? { contentSourceStepId: producer.id } : {}) };
    const check = { id: crypto.randomUUID(), name: '检查并确认实际交付', kind: 'manual-review', enabled: true, inputSource: 'previous', prompt: '' };
    const flow = { id: 'recipe-preview', workspaceId: '', updatedAt: '', name: name.trim(), description: `目标：${brief.objective}\n验收：${brief.acceptance.join('；')}\n最多 ${maxRepairs} 轮自动修订，人工确认后交付。`, outputKind: kind, goalBrief: brief, foundationVersion: exports.AUTOMATION_FOUNDATION_VERSION, steps: [planner, producer, reviewer, exporter, check] };
    const normalized = (0, creation_quality_1.withCreationFoundation)(flow);
    return { name: normalized.name, description: normalized.description, outputKind: normalized.outputKind, steps: normalized.steps, goalBrief: brief, foundationVersion: exports.AUTOMATION_FOUNDATION_VERSION };
}

},
"./creation-quality": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationQualityInstructions = generationQualityInstructions;
exports.creationPrompt = creationPrompt;
exports.withCreationFoundation = withCreationFoundation;
const creation_profiles_1 = require("./creation-profiles");
function generationQualityInstructions(kind, capability = 'text', options = {}) {
    if (['vision', 'video-understanding', 'transcription'].includes(capability))
        return '检查实际提供的内容，区分可见事实、推断和无法核实之处；列出可操作的修改建议，不声称已完成实际未执行的检查。';
    const factual = '以可交付成品为目标。保留用户确认的事实、名称、数字和约束，不编造业绩、资质、客户评价、来源或承诺。信息缺失时使用不虚构具体数据的通用表达；确实必需的缺项单列在 meta.missingInputs 数组，不在正文放 XXX、请填写、示例数据等占位。用户明确要求可填写模板时，保留清楚的规范字段标识，示例数字须明确标注，不能冒充真实数据。不要把写作说明、分析过程或自评写入成品。';
    if (kind === 'image' && ['image-generation', 'image-editing'].includes(capability))
        return [
            '制作可供实际宣传或设计交付的完整画面；优先满足用户的用途、风格、比例与主体要求，不自行加入装饰性水印或无关标识。',
            options.purpose ? `目标用途：${options.purpose}。` : '', options.imageSize ? `目标输出尺寸：${options.imageSize}；主体和重要文字保持安全边距。` : '',
            '主体清晰，构图有层级，光影、透视和材质统一；检查人物肢体、商品结构、轮廓与背景衔接。只使用用户明确给出的文字，尽量简短清晰，不新增虚构宣传数据。',
            options.hasReferences ? '依据参考图保持商品、人物、服装及用户要求保留的细节；不要擅自改动包装、商标、款式或文字。' : '缺少品牌或人物参考时使用原创通用主体，不假称与某品牌、人物或作品存在授权关系。',
            options.imageBackground === 'transparent' ? '输出真正带 Alpha 透明通道的 PNG，背景不绘制棋盘格或白底，主体边缘干净，避免杂色、缺口和残留阴影。' : '背景服务于主体和排版，保持自然完整；需要文案位置时预留明确留白。',
        ].filter(Boolean).join('\n');
    if (kind === 'ppt')
        return `${factual}\n必须返回可解析的 JSON 对象 {"title":"演示标题","slides":[{"title":"每页标题","bullets":["可直接上版的完整正文要点"],"notes":"补充讲解与数据依据"}],"meta":{"missingInputs":[]}}，不要 Markdown 围栏。${options.pageCount ? `目标为 ${options.pageCount} 页，遵守用户明确要求的页数。` : '严格遵守用户指定页数；未指定时根据内容组织完整的适量页面。'}每页围绕一个明确结论，通常 2–5 条简洁要点；避免长段堆砌、只有提纲或页码标题。形成封面、背景/问题、核心方案、执行计划与结论的连贯叙事，按用途调整；不要凭空增加无关章节。精修时返回完整修订文稿，保留未要求修改的内容。`;
    if (kind === 'word')
        return `${factual}\n必须返回可解析的 JSON 对象，不要 Markdown 围栏。纯文字文稿使用 {"title":"文档标题","sections":[{"heading":"章节标题","paragraphs":["可直接交付的完整正文段落"]}],"meta":{"missingInputs":[]}}。需要表格时改用 {"schemaVersion":1,"kind":"word","title":"文档标题","blocks":[{"id":"body-1","type":"paragraph","text":"完整正文","fontSize":12,"align":"left","bold":false,"italic":false},{"id":"table-1","type":"table","text":"","fontSize":12,"align":"left","bold":false,"italic":false,"table":{"columns":[{"id":"column-1"},{"id":"column-2"}],"rows":[{"id":"row-1","cells":[{"id":"cell-1","text":"表头一"},{"id":"cell-2","text":"表头二"}]},{"id":"row-2","cells":[{"id":"cell-3","text":"实际内容"},{"id":"cell-4","text":"实际内容"}]}],"header":true,"borders":true}}],"meta":{"missingInputs":[]}}。blocks 与 sections 只选一种；标题段落 type 为 heading，项目列表为 bullet，均保留同样样式字段。表格必须是原生 table 结构，禁止用图片或竖线文本代替；每表 1–30 行、1–12 列，各行单元格数与 columns 一致，表内行/列/单元格 id 唯一且精修时保留，text 始终为空。章节有清晰层级，段落完整、术语一致，明确目的、范围、安排和结论；根据用户用途取舍，不输出空泛提纲或重复套话。事实来源和需要客户提供的信息单列在 meta，不假造引文。精修时返回整份修订正文，保留未要求修改的表格与稳定编号。`;
    if (kind === 'excel')
        return `${factual}\n返回可解析的 JSON 对象 {"title":"表格标题","sheets":[{"name":"工作表名","columns":["列名"],"rows":[["实际数据",0,{"formula":"SUM(B2:B3)"}]],"formatting":{"boldRanges":["A1:C1"],"columnWidths":{"A":18},"numberFormats":{"B2":"0.00"}}}]}，不要 Markdown 围栏。软件会将 JSON 写入真实 XLSX 并重算，不要声称交付不能包含表格文件。列名、单位、数据类型明确，逐行数据完整，公式仅引用真实存在的单元格；不要用演示金额冒充用户数据。columns 定义的表头由软件默认加粗；可用 formatting.boldRanges 指定加粗区域、columnWidths 指定8.43–90字符列宽、numberFormats 指定 General、0、0.00 或0.00%格式，每类最多200个区域。也可用 {"value":200,"bold":true,"format":"currency"} 形式指定单元格，format仅支持 general、integer、number、currency、percent；公式对象可带同样样式字段。不要输出其他未支持的格式指令，不能把样式要求只写在文字说明。公式结果由软件在交付前重算核验，不能声称已执行实际未执行的计算。`;
    return factual;
}
const FOUNDATION_MARKER = '【序作内置创作规范 ·';
function creationPrompt(kind, userPrompt, capability = 'text', options = {}) {
    if (userPrompt.startsWith(FOUNDATION_MARKER))
        return userPrompt;
    if (['vision', 'video-understanding', 'transcription'].includes(capability))
        return `${FOUNDATION_MARKER}内容检查 · ${creation_profiles_1.CREATION_FOUNDATION_VERSION}】\n${generationQualityInstructions(kind, capability, options)}\n\n【用户本次要求】\n${userPrompt.trim()}`;
    if (['image-generation', 'image-editing'].includes(capability))
        kind = 'image';
    const profile = creation_profiles_1.CREATION_PROFILES[kind];
    return `${FOUNDATION_MARKER}${profile.name} · ${creation_profiles_1.CREATION_FOUNDATION_VERSION}】\n${profile.instructions}\n${generationQualityInstructions(kind, capability, options)}\n\n【用户本次要求】\n${userPrompt.trim()}`;
}
function withCreationFoundation(workflow) {
    const enabled = workflow.steps.filter(step => step.enabled);
    const exporter = enabled.filter(step => step.kind === 'export').at(-1);
    const finalText = exporter?.contentSourceStepId || enabled.filter(step => step.kind === 'text').at(-1)?.id;
    return { ...workflow, steps: workflow.steps.map(step => {
            if (step.role === 'planner' || step.role === 'reviewer')
                return step;
            if (!step.enabled || step.prompt.startsWith(FOUNDATION_MARKER))
                return step;
            const image = ['image-generation', 'image-editing'].includes(step.kind);
            const document = workflow.outputKind !== 'image' && step.kind === 'text' && step.id === finalText;
            if (!image && !document)
                return step;
            const report = /(?:复核|审查|检查报告|检查清单|review|audit)/i.test(step.name) && !/(?:修订|重写|精修|完整成品)/.test(step.prompt);
            if (report)
                return step;
            return { ...step, prompt: creationPrompt(image ? 'image' : workflow.outputKind, step.prompt, step.kind, { imageSize: step.imageSize, imageBackground: step.imageBackground }) };
        }) };
}

},
"./creation-profiles": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREATION_PROFILES = exports.CREATION_FOUNDATION_VERSION = void 0;
exports.CREATION_FOUNDATION_VERSION = '2026-10-30-v2';
const DOCUMENT_COMMON = '先在内部整理受众、用途、已知事实、范围、交付物和验收标准，再撰写完整成品，最后检查章节覆盖、前后矛盾、遗漏和重复。只返回最终成品，不输出内部分析。用户要求的篇幅、页数、章节和资料优先于默认建议。完整性取决于任务覆盖和具体内容，不靠套话或重复凑字数。不能把几句概括、目录或写作建议冒充完成稿。';
exports.CREATION_PROFILES = {
    word: { name: '商业文档主笔与编辑', outputTokens: 12288, instructions: `${DOCUMENT_COMMON}
未指定篇幅时，面向完整方案/项目说明/报告撰写约1800–3000汉字的实质正文，通常6–10个适用章节；用户要求短文、邮件或简介时按其用途缩短。每节交代具体内容、执行方式、交付物或判断依据，通常至少两个展开段落，避免每节仅一句。
按实际用途组织：方案应说明问题、目标、范围边界、方案细节、执行阶段、角色与所需输入、交付清单、可检查的验收标准、风险/变更和下一步；报告应说明事实依据、分析、结论及建议；SOP应写清触发条件、步骤、检查点和异常处理。不要机械套入无关章节。
需要计划或验收时写清“做什么、由什么角色完成、输出什么、怎样确认完成”；没有提供具体日期、金额、负责人姓名时使用相对阶段/角色/规则，不编造现实承诺。资料不足时完成可成立的部分，把阻碍最终交付的缺项列入meta.missingInputs，不能声称已形成无须核对的定稿。` },
    ppt: { name: '演示叙事策划与逐页撰稿', outputTokens: 12288, instructions: `${DOCUMENT_COMMON}
未指定页数时，完整提案/汇报默认10–12页；短演示按用户要求。先形成连贯叙事：封面、核心结论、背景问题、具体方案/分析、执行计划、资源与风险、验收或行动建议，按用途取舍。每页承担一个明确结论，标题表达观点，不能只有“第一部分”等空标题。
正文通常3–5条能直接上版的实质要点，每条约15–40汉字；细节、执行逻辑、推导依据、例子和讲解放入notes，内容页通常80–160汉字。封面、过渡页和结尾按需简短。既不能只给目录，也不能把长文章塞进画布。
计划写明阶段、角色、产出与检查点；对比应给明确维度和依据；图表没有真实数据时说明需要的数据，不能伪造增长曲线。逐页核对承接关系、用户页数、正文与备注完整性。` },
    excel: { name: '业务表格设计与公式校核', outputTokens: 12288, instructions: `${DOCUMENT_COMMON}
先识别业务目的和数据颗粒度，再组织字段、单位、数据类型、输入区、明细与汇总关系。复杂业务通常包含使用说明/输入或参数/业务明细/汇总等2–4张适用表，不为简单清单强行增加工作表。
用户提供的数据逐行保留，不抽样、不省略、不写“其余类似”。金额与数量区分，日期格式一致，必要时提供状态、责任角色、校验字段与统计口径。无真实数据而要求可复用工具时明确做可填写模板：输入金额/日期留空，说明需要填写的字段；不得编造客户收入、订单或费用。展示示例时必须显式标示且与实际明细分离。
公式用对象{"formula":"SUM(B2:B10)"}表示，公式文字不含前导等号。只使用本地支持的四则、比较、百分数、同书A1/范围和跨表引用，以及SUM/AVERAGE/MIN/MAX/COUNT/ROUND/IF。引用必须存在，零分母和空输入用IF处理；禁止外链、宏、动态外部函数。不要填写伪造公式缓存或声称已计算。字符串以=开头仍是普通文字，不能据此偷偷执行公式。
在说明表写明用途、字段/单位、输入位置、计算口径和操作顺序；汇总与明细能追溯。元资料缺项放meta.missingInputs。` },
    image: { name: '视觉策划与制作检查', outputTokens: 4096, instructions: '先根据用途确定构图、主体、风格、尺寸、安全边距和文字层级，再完成画面。宣传图强调主视觉和信息留白；头像强调小尺寸识别与裁切安全；表情包/卡通图强调表情动作和角色一致；透明PNG素材强调独立主体、完整轮廓与干净Alpha边缘；试衣图依据人物和服装参考保持身份、姿态、衣服结构和材质。没有提供的价格、促销、认证、品牌或广告文字不能自行编造。精修只改用户指定部分，保留要求不变的主体和细节。' },
};

},
"./document-illustrations": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validDocumentImageCount = exports.DOCUMENT_REFERENCE_IMAGE_LIMIT = exports.DOCUMENT_IMAGE_LIMIT = void 0;
exports.documentImageModels = documentImageModels;
exports.documentIllustrationSteps = documentIllustrationSteps;
exports.illustratedDocumentSteps = illustratedDocumentSteps;
const creation_quality_1 = require("./creation-quality");
const studio_run_1 = require("./studio-run");
exports.DOCUMENT_IMAGE_LIMIT = 20;
exports.DOCUMENT_REFERENCE_IMAGE_LIMIT = 12;
const validDocumentImageCount = (count) => Number.isInteger(count) && count >= 1 && count <= exports.DOCUMENT_IMAGE_LIMIT;
exports.validDocumentImageCount = validDocumentImageCount;
function documentImageModels(configuration, capability = 'image-generation') {
    return configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(capability) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
}
function documentIllustrationSteps(count, brief) {
    if (count === 0)
        return [];
    if (!(0, exports.validDocumentImageCount)(count))
        throw new Error(`配图数量请填写 1–${exports.DOCUMENT_IMAGE_LIMIT} 的整数。`);
    return Array.from({ length: count }, (_, index) => ({ id: crypto.randomUUID(), name: `制作文档插图 ${index + 1}/${count}`, kind: 'image-generation', inputSource: 'project', enabled: true, count: 1, imageSize: '1024x1024', imageBackground: 'opaque', prompt: (0, creation_quality_1.creationPrompt)('image', `为以下文档需求制作可独立使用的配图素材。本次制作第 ${index + 1} 张，共 ${count} 张；按需求中的不同内容角度组织本张画面，与同组插图保持风格统一。只生成插图，不要把整页文档、PPT、表格或正文渲染成图片，不添加文字、图标水印或虚构品牌。配图用于内容说明，保留自然留白。用户未提供真实商品或人物参考时，不假称图片是真实商品实拍或人物照片。\n\n文档需求：${brief}`, 'image-generation') }));
}
function illustratedDocumentSteps(first, tail, options, configuration, brief) {
    if (!['references', 'generate'].includes(options.mode))
        throw new Error('请选择有效的配图方式。');
    if (options.mode === 'generate' && !(0, exports.validDocumentImageCount)(options.count))
        throw new Error(`配图数量请填写 1–${exports.DOCUMENT_IMAGE_LIMIT} 的整数。`);
    const text = { ...first, documentImageSource: options.mode === 'references' ? 'references' : 'previous', inputSource: 'project' };
    if (options.mode === 'references')
        return [text, ...tail];
    const model = (0, studio_run_1.studioModel)(documentImageModels(configuration), options.modelConfigId);
    if (!model)
        throw new Error('请先选择一个真实图片生成模型。');
    const credentialId = (0, studio_run_1.studioCredential)(configuration.credentials, model.connectionId, options.credentialId);
    const pictures = documentIllustrationSteps(options.count, brief).map(step => ({ ...step, modelConfigId: model.id, credentialId }));
    return [...pictures, { ...text, documentImageStepIds: pictures.map(picture => picture.id) }, ...tail];
}

},
"./studio-run": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_OUTPUT_MAX = exports.WORKFLOW_OUTPUT_MIN = void 0;
exports.studioCredential = studioCredential;
exports.studioModel = studioModel;
exports.workflowStepSelection = workflowStepSelection;
exports.workflowSelections = workflowSelections;
exports.workflowPublicError = workflowPublicError;
function studioCredential(credentials, connectionId, preferredId) {
    const available = credentials.filter(item => item.enabled && item.connectionId === connectionId);
    if (available.some(item => item.id === preferredId))
        return preferredId;
    return available.length === 1 ? available[0].id : undefined;
}
function studioModel(models, preferredId) {
    const available = models.filter(model => model.enabled);
    const preferred = available.find(model => model.id === preferredId);
    if (preferred)
        return preferred;
    const real = available.filter(model => !model.demo);
    return real.length === 1 ? real[0] : undefined;
}
function workflowStepSelection(step, configuration) {
    if (['manual-review', 'export'].includes(step.kind))
        return step;
    const available = configuration.models.filter(model => model.enabled && model.capabilities.includes(step.kind) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled));
    const model = studioModel(available, step.modelConfigId);
    return { ...step, modelConfigId: model?.id, credentialId: model && !model.demo ? studioCredential(configuration.credentials, model.connectionId, step.credentialId) : undefined };
}
function workflowSelections(workflow, configuration) {
    return { ...workflow, steps: workflow.steps.map(step => workflowStepSelection(step, configuration)) };
}
exports.WORKFLOW_OUTPUT_MIN = 16;
exports.WORKFLOW_OUTPUT_MAX = 16384;
function workflowPublicError(error, fallback) {
    return error instanceof Error && error.message.trim() ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;
}

},
"./prompt-variables": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractVariables = extractVariables;
exports.resolvePrompt = resolvePrompt;
const variablePattern = () => /{{\s*([^{}\r\n]+?)\s*}}/g;
/** 按首次出现顺序提取变量，同名变量只需要填写一次。 */
function extractVariables(content) {
    const names = [...content.matchAll(variablePattern())].map(match => match[1].trim());
    return [...new Set(names.filter(Boolean))];
}
/** 缺失字段保留原占位符；调用方必须检查 complete 后再应用。 */
function resolvePrompt(content, values) {
    const names = extractVariables(content);
    const valueFor = (name) => Object.prototype.hasOwnProperty.call(values, name) && typeof values[name] === 'string' ? values[name].trim() : '';
    const missing = names.filter(name => !valueFor(name));
    const resolved = content.replace(variablePattern(), (placeholder, name) => valueFor(name.trim()) || placeholder);
    return { content: resolved, missing, complete: missing.length === 0 };
}

}
};
const cache = Object.create(null);
function load(id) {
  if (!Object.hasOwn(factories, id)) throw new Error('Unknown natural automation dependency');
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} };
  factories[id](module, module.exports, load);
  return module.exports;
}
module.exports = load('./natural-automation-plan');
