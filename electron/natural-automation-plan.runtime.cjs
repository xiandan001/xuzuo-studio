// Generated from src/lib/natural-automation-plan.ts and its shared helpers; run scripts/build-spreadsheet-runtime.mjs.
'use strict';
const factories = {
"./natural-automation-plan": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NATURAL_AUTOMATION_SCHEMA = exports.isBeadPatternRequest = exports.BEAD_WORKSPACE_NOTICE = void 0;
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
const wallpaper_target_1 = require("./wallpaper-target");
const bead_intent_1 = require("./bead-intent");
const animation_workflow_1 = require("./animation-workflow");
const animation_document_1 = require("./animation-document");
var bead_intent_2 = require("./bead-intent");
Object.defineProperty(exports, "BEAD_WORKSPACE_NOTICE", { enumerable: true, get: function () { return bead_intent_2.BEAD_WORKSPACE_NOTICE; } });
Object.defineProperty(exports, "isBeadPatternRequest", { enumerable: true, get: function () { return bead_intent_2.isBeadPatternRequest; } });
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
    if ((0, bead_intent_1.isBeadPatternRequest)(input))
        issues.push(bead_intent_1.BEAD_WORKSPACE_NOTICE);
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
    const wallpaperText = [plan.objective, ...plan.steps.map(step => step.instruction), ...plan.constraints].join('\n');
    const wallpaperRequested = project.kind === 'image' && /壁纸|wallpaper/i.test(wallpaperText) && !/(?:不要|不做|无需|不是).{0,5}壁纸/.test(plan.objective);
    const wallpaperParsed = wallpaperRequested ? (0, wallpaper_target_1.parseWallpaperTarget)(wallpaperText) : undefined;
    const wallpaperTarget = wallpaperParsed?.status === 'resolved' ? wallpaperParsed.target : undefined;
    if (wallpaperRequested && !wallpaperTarget)
        missing.add(`壁纸尺寸：${wallpaperParsed && 'message' in wallpaperParsed ? wallpaperParsed.message : '请选择明确的机型或填写宽×高像素。'}`);
    const references = (project.referenceFiles || []).filter(file => file.kind === 'image' && usableReference(file));
    const animationMode = project.kind === 'image' ? (0, animation_workflow_1.animationRequestMode)(plan.objective) : undefined;
    if (animationMode) {
        if (references.length > 12 || references.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)))
            throw Error('角色动画参考图最多12张，且需要PNG、JPEG或WebP；SVG/GIF请先转换为静态参考图，未自动丢弃原文件。');
        const style = (0, animation_document_1.animationStyle)((0, animation_workflow_1.animationStyleForRequest)(plan.objective)), referenceIds = references.map(file => file.id), capability = referenceIds.length ? 'image-editing' : 'image-generation', binding = select(capability);
        const size = /(\d{2,4})\s*[x×*＊]\s*(\d{2,4})/i.exec(plan.objective), duration = /(\d+(?:\.\d+)?)\s*秒/.exec(plan.objective);
        const document = (0, animation_document_1.checkedAnimationDocument)({ ...(0, animation_document_1.newAnimationDocument)(project.id, animationMode), style: style.id, ...style.defaults, columns: style.grid[0], rows: style.grid[1], title: plan.name, prompt: [plan.objective, `验收：${plan.acceptance.join('；')}`, ...plan.constraints].join('\n'), referenceArtifactIds: referenceIds, modelConfigId: binding.modelConfigId || '', credentialId: binding.credentialId || '', ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}), ...(duration ? { loopMs: Math.round(Number(duration[1]) * 100) * 10 } : {}) });
        const draft = (0, animation_workflow_1.makeAnimationWorkflow)(document, configuration), source = draft.steps[0], compose = draft.steps[1], steps = [source];
        let previous = source.id;
        for (let round = 0; round < plan.maxRepairs; round++) {
            steps.push({ id: `animation-check-${round + 1}`, name: `检查PNG图集 ${round + 1}/${plan.maxRepairs}`, kind: 'vision', role: 'reviewer', inputSource: 'previous', enabled: true, prompt: `依据实际静态PNG图集检查角色身份、姿态、手部、格数、透明边缘和裁切，提出明确修复意见；不要声称看过尚未合成的GIF播放。\n目标：${plan.objective}`, ...select('vision') });
            const editId = `animation-refine-${round + 1}`;
            steps.push({ ...source, id: editId, name: `精修PNG图集 ${round + 1}/${plan.maxRepairs}`, kind: 'image-editing', inputSource: 'previous', imageSourceStepId: previous, referenceArtifactIds: [], prompt: `${(0, animation_document_1.animationGenerationPrompt)({ ...document, columns: compose.animation.columns, rows: compose.animation.rows }, [document.entries[0]])}\n\n保留实际原图与未要求变化的区域，按前一步检查意见精修，仍输出同一布局的静态PNG。`, ...select('image-editing') });
            previous = editId;
        }
        steps.push({ ...compose, imageSourceStepId: previous }, draft.steps[2]);
        const workflow = { ...draft, name: `${plan.name} · 单个样片`, description: appendNaturalPreparationNotes(`${draft.description}\nGIF/图集由本地受限合成步骤产出，不依赖模型直接返回GIF；自动步骤不代表视觉或授权已验收。`, preparationNotes), steps };
        const { type, ...triggerDetails } = plan.trigger;
        return { workflow, missing: [...missing], preparationNotes, rule: { trigger: type, ...triggerDetails, name: plan.name, input: [plan.objective, `验收要求：${plan.acceptance.join('；')}`, ...plan.constraints].join('\n'), variables: {} }, stepsSummary: steps.map((step, index) => `${index + 1}. ${step.name}${step.kind === 'animation-compose' ? '（本地，不调用模型）' : step.kind === 'manual-review' ? '（等待你确认）' : ''}`) };
    }
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
        const selection = select(kind), modelId = configuration.models.find(model => model.id === selection.modelConfigId)?.modelId;
        const step = add({ id: crypto.randomUUID(), name, role: 'producer', kind, prompt: `${instruction}\n\n目标：${plan.objective}\n验收：${plan.acceptance.join('；')}\n约束：${plan.constraints.join('；')}${wallpaperTarget ? `\n\n${(0, wallpaper_target_1.wallpaperPrompt)(wallpaperTarget)}` : ''}`, inputSource: 'previous', enabled: true, count: 1, imageSize: wallpaperTarget ? (0, wallpaper_target_1.wallpaperGenerationSize)(wallpaperTarget, modelId) : 'auto', imageBackground: wallpaperRequested ? 'opaque' : 'auto', ...(wallpaperRequested ? { imageOutputFormat: 'png' } : {}), ...selection, ...(kind === 'image-editing' && latestImage ? { imageSourceStepId: latestImage } : {}) });
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
    const delivery = { ...base.steps[3], contentSourceStepId: sourceId, ...(wallpaperRequested ? { name: '适配设备壁纸', wallpaperTarget: wallpaperTarget || null, contentSourceStepId: undefined, contentSourceStepIds: [...imageOutputs] } : {}) };
    if (wallpaperRequested) {
        add(delivery);
        add(reviewer);
    }
    else {
        add(reviewer);
        add(delivery);
    }
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
exports.CREATION_FOUNDATION_VERSION = '2026-11-06-v3';
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
在说明表写明用途、字段/单位、输入位置、计算口径和操作顺序；汇总与明细能追溯。应用导出的工作表默认冻结首行表头，并支持本规范列出的列宽、加粗、金额与百分比格式；打印时按表宽自动选择A4或A3纸张并适配页面宽度，保留纵向分页。不要在成稿中声称交付格式不支持这些能力，也不要要求用户手工补做已经由软件完成的设置。元资料缺项放meta.missingInputs。` },
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
    if (['manual-review', 'export', 'animation-compose'].includes(step.kind))
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

},
"./wallpaper-target": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallpaperTargetIssue = wallpaperTargetIssue;
exports.readWallpaperTarget = readWallpaperTarget;
exports.searchWallpaperDevices = searchWallpaperDevices;
exports.parseWallpaperTarget = parseWallpaperTarget;
exports.wallpaperPrompt = wallpaperPrompt;
exports.wallpaperGenerationSize = wallpaperGenerationSize;
const wallpaper_devices_1 = require("../data/wallpaper-devices");
const image_output_options_1 = require("./image-output-options");
const MAX_PIXELS = 16_000_000;
const deviceById = new Map(wallpaper_devices_1.WALLPAPER_DEVICES.map(device => [device.id, device]));
const targetKeys = new Set(['width', 'height', 'fit', 'deviceId', 'label']);
function wallpaperTargetIssue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return '请先选择机型，或输入壁纸的宽×高像素。';
    if (Object.keys(value).some(key => !targetKeys.has(key)))
        return '壁纸尺寸设置包含无法识别的内容，请重新选择。';
    const target = value;
    if (!Object.hasOwn(value, 'width') || !Object.hasOwn(value, 'height') || !Number.isInteger(target.width) || !Number.isInteger(target.height) || target.width < 64 || target.height < 64 || target.width > 8192 || target.height > 8192)
        return '宽和高都请输入 64–8192 的整数像素。';
    if (target.width * target.height > MAX_PIXELS)
        return '壁纸总像素不能超过 1600 万，请缩小宽或高。';
    if (!Object.hasOwn(value, 'fit') || !['cover', 'contain'].includes(target.fit))
        return '请选择填满画面或完整保留，不支持拉伸壁纸。';
    if (target.label !== undefined && (typeof target.label !== 'string' || !target.label.trim() || target.label.length > 160 || /[\u0000-\u001f\u007f]/.test(target.label)))
        return '壁纸名称无效，请重新选择设备或输入像素。';
    if (target.deviceId !== undefined) {
        if (typeof target.deviceId !== 'string')
            return '机型信息无效，请重新选择。';
        const device = deviceById.get(target.deviceId);
        if (!device || !(target.width === device.width && target.height === device.height || target.width === device.height && target.height === device.width))
            return '尺寸与所选机型不一致，请重新选择机型，或改为自定义像素。';
    }
}
function readWallpaperTarget(value) {
    if (wallpaperTargetIssue(value))
        return;
    const target = value;
    return { width: target.width, height: target.height, fit: target.fit, ...(target.deviceId ? { deviceId: target.deviceId } : {}), ...(target.label ? { label: target.label.trim() } : {}) };
}
const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/\+/g, 'plus').replace(/英寸/g, ' ').replace(/[^a-z0-9\u3400-\u9fff.]/g, ' ');
const compact = (text) => normalize(text).replace(/\s+/g, '');
const deviceIndex = wallpaper_devices_1.WALLPAPER_DEVICES.map(device => ({ device, aliases: [...new Set(device.aliases.map(compact))] }));
const usefulQuery = (query) => query.replace(/(?:帮我|给我|我想要?|请|生成|制作|一张|适合|我的|手机|壁纸|的)/g, ' ').replace(/\b(?:wallpaper|for|please|make|create|my|phone)\b/gi, ' ').trim();
function searchWallpaperDevices(query) {
    if (typeof query !== 'string' || query.length > 4096)
        return [];
    const key = compact(usefulQuery(query));
    return deviceIndex.filter(item => !key || item.aliases.some(alias => alias.includes(key))).map(item => item.device);
}
function namedDevices(text) {
    const source = normalize(text), positions = [];
    let key = '';
    for (let index = 0; index < source.length; index++)
        if (!/\s/.test(source[index])) {
            key += source[index];
            positions.push(index);
        }
    const matches = [];
    for (const { device, aliases } of deviceIndex)
        for (const alias of aliases) {
            let start = key.indexOf(alias);
            while (start !== -1) {
                const end = start + alias.length, left = source[positions[start] - 1] || '', right = source[positions[end - 1] + 1] || '';
                const tail = source.slice(positions[end - 1] + 1);
                if (!/[a-z0-9]/.test(left) && !/[a-z0-9]/.test(right) && !/^\s*(?:pro|max|ultra|plus|mini|air|fe|se|lite)(?=\s|$|[\u3400-\u9fff])/i.test(tail))
                    matches.push({ start, end, device });
                start = key.indexOf(alias, start + 1);
            }
        }
    const specific = matches.filter(match => !matches.some(other => other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start));
    const ids = new Set(specific.map(match => match.device.id));
    return wallpaper_devices_1.WALLPAPER_DEVICES.filter(device => ids.has(device.id));
}
function ipadCandidates(text) {
    const value = normalize(text), family = value.match(/ipad\s*(pro|air|mini)?\s*(\d+(?:\.\d+)?)?/);
    if (!family || /(?:^|[^a-z])(?:m\d+|a\d+)/.test(value))
        return [];
    const prefix = compact(`iPad ${family[1] || ''}${family[2] || ''}`);
    return deviceIndex.filter(item => item.device.category === 'tablet' && item.aliases.some(alias => alias.startsWith(prefix))).map(item => item.device);
}
function screenCandidates(devices, text) {
    if (!devices.some(device => device.category === 'foldable'))
        return devices;
    const inner = /内屏|主屏|内外屏|\binner\b/i.test(text), cover = /外屏|副屏|\bcover\b/i.test(text);
    if (inner === cover)
        return devices;
    return devices.filter(device => device.category !== 'foldable' || device.screen === (inner ? 'inner' : 'cover'));
}
function pixelPairs(text) {
    const number = '([+-]?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)';
    const patterns = [new RegExp(`${number}\\s*(?:[x×*]|乘以?|\\bby\\b)\\s*${number}`, 'gi'), new RegExp(`(?:宽(?:度)?|width)\\s*(?:为|是|[:：=])?\\s*${number}\\s*(?:像素|px)?\\s*[,，、;；]?\\s*(?:高(?:度)?|height)\\s*(?:为|是|[:：=])?\\s*${number}`, 'gi')];
    const pairs = patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ width: Number(match[1]), height: Number(match[2]), integer: /^\d+$/.test(match[1]) && /^\d+$/.test(match[2]), physical: /^\s*(?:毫米|英寸|mm\b|inches?\b)/i.test(text.slice((match.index || 0) + match[0].length)) })));
    return [...new Map(pairs.map(pair => [`${pair.width}x${pair.height}:${pair.integer}:${pair.physical}`, pair])).values()];
}
function orientation(text) {
    if (/横屏|横向|\blandscape\b/i.test(text))
        return 'landscape';
    if (/竖屏|纵向|\bportrait\b/i.test(text))
        return 'portrait';
}
const fitFromText = (text) => /留边|不(?:要)?裁[剪切]|完整保留(?:画面|图片|图像)/.test(text.replace(/不(?:要)?留边/g, '')) ? 'contain' : 'cover';
function orientTarget(target, text) {
    const direction = orientation(text);
    return direction === 'landscape' && target.width < target.height || direction === 'portrait' && target.width > target.height ? { ...target, width: target.height, height: target.width } : target;
}
function deviceTarget(device, text) { return orientTarget({ width: device.width, height: device.height, fit: fitFromText(text), deviceId: device.id, label: device.name }, text); }
function ambiguous(candidates, message = '找到多个匹配，请选择具体机型或屏幕。') { return { status: 'ambiguous', candidates, message }; }
function parseWallpaperTarget(text) {
    if (typeof text !== 'string' || !text.trim())
        return { status: 'unknown', message: '输入机型或像素即可，例如 iPhone 18 Pro、1170×2532。' };
    if (text.length > 4096)
        return { status: 'invalid', message: '描述过长，请只填写机型名称或宽×高像素。' };
    if (/横屏|横向|\blandscape\b/i.test(text) && /竖屏|纵向|\bportrait\b/i.test(text))
        return { status: 'invalid', message: '同时出现横屏和竖屏，请只保留本次需要的一个方向。' };
    const input = text.normalize('NFKC'), pairs = pixelPairs(input), devices = screenCandidates(namedDevices(input), input);
    if (!pairs.length && /\b(?:4k|uhd)\b/i.test(input)) {
        const direction = orientation(input);
        if (!direction)
            return { status: 'unknown', message: '4K请选择竖屏 2160×3840 或横屏 3840×2160，也可直接输入像素尺寸。' };
        return { status: 'resolved', target: { width: direction === 'portrait' ? 2160 : 3840, height: direction === 'portrait' ? 3840 : 2160, fit: fitFromText(input), label: direction === 'portrait' ? '4K竖屏' : '4K横屏' } };
    }
    if (pairs.length > 1)
        return { status: 'invalid', message: '发现多组像素尺寸，请只保留本次壁纸的宽×高。' };
    if (pairs.length) {
        const pair = pairs[0];
        if (pair.physical)
            return { status: 'unknown', message: '毫米或英寸是物理尺寸，请选择机型或输入屏幕像素分辨率。' };
        const selected = orientTarget({ width: pair.width, height: pair.height, fit: fitFromText(input) }, input), target = { ...selected, label: `自定义 ${selected.width}×${selected.height}` };
        const issue = pair.integer ? wallpaperTargetIssue(target) : '像素尺寸请输入整数，不支持小数、负数或科学记数法。';
        if (issue)
            return { status: 'invalid', message: issue };
        const device = devices.length === 1 ? devices[0] : undefined;
        if (device && (device.width === target.width && device.height === target.height || device.height === target.width && device.width === target.height))
            return { status: 'resolved', device, target: { ...target, deviceId: device.id, label: device.name } };
        return { status: 'resolved', target };
    }
    if (devices.length > 1)
        return ambiguous(devices);
    if (devices.length === 1)
        return { status: 'resolved', device: devices[0], target: deviceTarget(devices[0], input) };
    const ipads = ipadCandidates(input);
    if (ipads.length)
        return ambiguous(ipads, 'iPad 的代际可能影响尺寸，请选择具体型号。');
    if (/^(?:iphone|苹果(?:手机)?|三星|华为|小米|oppo|vivo|荣耀)$/i.test(usefulQuery(input).trim()))
        return ambiguous(searchWallpaperDevices(input));
    return { status: 'unknown', message: /英寸|毫米|\b(?:inch|inches|mm)\b|\b[248]k\b/i.test(input) ? '英寸、机身尺寸或 2K 等级不能确定像素，请选择机型或输入宽×高像素。' : '未找到明确机型，请从列表选择，或输入自定义像素，例如 1170×2532。' };
}
function wallpaperPrompt(target) {
    const issue = wallpaperTargetIssue(target);
    if (issue)
        throw Error(issue);
    return `创作完整的原创设备壁纸，最终成品尺寸为 ${target.width} × ${target.height} 像素，按该长宽比安排构图。主体与关键细节集中在画面中部，顶部为系统时钟留出适量干净空间；不要绘制手机边框、设备样机、时间、应用图标、系统界面、品牌商标或水印。${target.fit === 'contain' ? '完整保留主体和画面边缘，不通过拉伸改变主体比例。' : '画面边缘可以适当裁切，重要主体不要贴边。'}主题、色彩与风格按用户本次要求创作。`;
}
function wallpaperGenerationSize(target, modelId) {
    const issue = wallpaperTargetIssue(target);
    if (issue)
        throw Error(issue);
    if ((0, image_output_options_1.isModernImage)(modelId)) {
        const ratio = Math.min(3, Math.max(1 / 3, target.width / target.height)), area = Math.min(3_686_400, Math.max(1_048_576, target.width * target.height));
        let width = Math.min(3840, Math.floor(Math.sqrt(area * ratio) / 16) * 16), height = Math.min(3840, Math.floor(Math.sqrt(area / ratio) / 16) * 16);
        while (width > height * 3)
            width -= 16;
        while (height > width * 3)
            height -= 16;
        return `${width}x${height}`;
    }
    if (modelId && !/^gpt-image-1(?:\.5)?(?:-mini)?$/.test(modelId))
        return '1024x1024';
    return target.width === target.height ? '1024x1024' : target.width > target.height ? '1536x1024' : '1024x1536';
}

},
"./image-output-options": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageOutputFields = exports.RASTER_IMAGE_TYPES = exports.isModernImage = exports.isImage26 = void 0;
exports.imageFormatModelDisabled = imageFormatModelDisabled;
exports.imageFormatOptions = imageFormatOptions;
exports.effectiveImageOptions = effectiveImageOptions;
exports.imageOutputIssue = imageOutputIssue;
exports.pickImageOutputOptions = pickImageOutputOptions;
exports.readImageOutputOptions = readImageOutputOptions;
const isImage26 = (id = '') => /^gpt-image-2\.6-(sunburst|flare)$/.test(id);
exports.isImage26 = isImage26;
const isModernImage = (id = '') => /^gpt-image-2\.[56]-(sunburst|flare)$/.test(id);
exports.isModernImage = isModernImage;
exports.RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
function imageFormatModelDisabled(format, modelId) {
    return (format === 'svg' || format === 'gif') && !(0, exports.isImage26)(modelId);
}
function imageFormatOptions(modelId, capability) {
    const special = (0, exports.isImage26)(modelId) && capability === 'image-generation';
    const animation = (0, exports.isImage26)(modelId) && ['image-generation', 'image-editing'].includes(capability);
    const reason = !(0, exports.isImage26)(modelId) ? '仅 GPT Image 2.6 Sunburst／Flare 支持' : '仅文字生成可用，精修及参考图生成不支持';
    return [
        { value: 'png', label: 'PNG 图片', description: '默认，支持透明背景' },
        { value: 'jpeg', label: 'JPEG 图片', description: '文件较小，不支持透明背景' },
        { value: 'webp', label: 'WebP 图片', description: '支持透明背景与压缩' },
        { value: 'svg', label: 'SVG 矢量图 · 仅 2.6', disabled: !special, description: special ? '静态矢量，仅生成；费用含图像及作者模型' : reason },
        { value: 'gif', label: 'GIF 动图 · 仅 2.6', disabled: !animation, description: animation ? '支持文字或静态参考图制作，账户需开通 GIF 预览权限' : !(0, exports.isImage26)(modelId) ? reason : '仅图片生成或编辑步骤可用' },
    ];
}
function effectiveImageOptions(options = {}, modelId = '', capability = 'image-generation') {
    const format = options.imageOutputFormat || 'png', result = {};
    if (options.imageOutputFormat)
        result.imageOutputFormat = options.imageOutputFormat;
    if ((0, exports.isModernImage)(modelId) && options.imageQuality)
        result.imageQuality = options.imageQuality;
    if ((0, exports.isImage26)(modelId) && options.imageComplexity)
        result.imageComplexity = options.imageComplexity;
    if (format === 'gif') {
        result.imageFrameCount = options.imageFrameCount ?? 9;
        result.imageFrameDurationMs = Number.isFinite(options.imageFrameDurationMs) ? Math.round(options.imageFrameDurationMs / 10) * 10 : options.imageFrameDurationMs ?? 200;
    }
    if (['jpeg', 'webp'].includes(format) && options.imageCompression !== undefined)
        result.imageCompression = options.imageCompression;
    if (format === 'svg' && options.imageSvgModel) {
        result.imageSvgModel = options.imageSvgModel;
        if (options.imageSvgReasoningEffort)
            result.imageSvgReasoningEffort = options.imageSvgReasoningEffort;
    }
    if (capability === 'image-editing' && (0, exports.isModernImage)(modelId) && options.imageMarkupId)
        result.imageMarkupId = options.imageMarkupId;
    return result;
}
function imageOutputIssue(options = {}, modelId = '', capability = 'image-generation', background = 'auto') {
    const format = options.imageOutputFormat || 'png';
    if (['svg', 'gif'].includes(format) && !(0, exports.isImage26)(modelId))
        return 'SVG、GIF 仅支持 GPT Image 2.6 Sunburst／Flare，请选择对应模型或其他输出格式。';
    if (format === 'svg' && capability !== 'image-generation')
        return 'SVG 仅支持文字生成，精修和带参考图生成请改用 PNG、JPEG、WebP 或 GIF。';
    if (format === 'gif' && !['image-generation', 'image-editing'].includes(capability))
        return 'GIF 仅支持图片生成或编辑步骤。';
    if (format === 'gif' && (!Number.isInteger(options.imageFrameCount ?? 9) || options.imageFrameCount < 2 || options.imageFrameCount > 16))
        return 'GIF 帧数请输入 2–16 的整数。';
    if (format === 'gif' && (!Number.isInteger(options.imageFrameDurationMs ?? 200) || (options.imageFrameDurationMs ?? 200) < 20 || (options.imageFrameDurationMs ?? 200) > 2000))
        return '每帧时长请输入 20–2000 毫秒，按10毫秒取整。';
    if (['jpeg', 'webp'].includes(format) && options.imageCompression !== undefined && (!Number.isInteger(options.imageCompression) || options.imageCompression < 0 || options.imageCompression > 100))
        return '压缩质量请输入 0–100 的整数，或留空使用默认值。';
    if (format === 'jpeg' && background === 'transparent')
        return 'JPEG 不支持透明背景，请改用 PNG 或 WebP。';
}
exports.imageOutputFields = ['imageOutputFormat', 'imageQuality', 'imageComplexity', 'imageFrameCount', 'imageFrameDurationMs', 'imageCompression', 'imageMarkupId', 'imageSvgModel', 'imageSvgReasoningEffort'];
function pickImageOutputOptions(value) { return value ? Object.fromEntries(exports.imageOutputFields.filter(key => value[key] !== undefined).map(key => [key, value[key]])) : {}; }
function readImageOutputOptions(value) {
    if (!value || typeof value !== 'object')
        return {};
    const input = value, result = {};
    if (['png', 'jpeg', 'webp', 'svg', 'gif'].includes(input.imageOutputFormat || ''))
        result.imageOutputFormat = input.imageOutputFormat;
    if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.imageQuality || ''))
        result.imageQuality = input.imageQuality;
    if (['low', 'medium', 'high'].includes(input.imageComplexity || ''))
        result.imageComplexity = input.imageComplexity;
    for (const key of ['imageFrameCount', 'imageFrameDurationMs', 'imageCompression'])
        if (Number.isFinite(input[key]))
            result[key] = input[key];
    if (typeof input.imageMarkupId === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(input.imageMarkupId))
        result.imageMarkupId = input.imageMarkupId;
    if (typeof input.imageSvgModel === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(input.imageSvgModel))
        result.imageSvgModel = input.imageSvgModel;
    if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.imageSvgReasoningEffort || ''))
        result.imageSvgReasoningEffort = input.imageSvgReasoningEffort;
    return result;
}

},
"../data/wallpaper-devices": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandLabel = exports.wallpaperBrandLabel = exports.WALLPAPER_DEVICES = void 0;
// Official standard-rectangle screen pixels, normalized to portrait.
exports.WALLPAPER_DEVICES = [
    { "id": "iphone-18-pro", "brand": "apple", "name": "iPhone 18 Pro", "aliases": ["iPhone 18 Pro", "iPhone18Pro", "苹果 18 Pro", "苹果18Pro", "苹果 iPhone 18 Pro"], "category": "phone", "screen": "main", "width": 1206, "height": 2622, "sourceUrl": "https://www.apple.com/tw/iphone-18-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "iphone-18-pro-max", "brand": "apple", "name": "iPhone 18 Pro Max", "aliases": ["iPhone 18 Pro Max", "iPhone18ProMax", "苹果 18 Pro Max", "苹果18ProMax", "苹果 iPhone 18 Pro Max"], "category": "phone", "screen": "main", "width": 1320, "height": 2868, "sourceUrl": "https://www.apple.com/tw/iphone-18-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "iphone-17", "brand": "apple", "name": "iPhone 17", "aliases": ["iPhone 17", "iPhone17", "苹果 17", "苹果17", "苹果 iPhone 17"], "category": "phone", "screen": "main", "width": 1206, "height": 2622, "sourceUrl": "https://support.apple.com/zh-cn/125089", "verifiedAt": "2026-11-07" },
    { "id": "iphone-17-pro", "brand": "apple", "name": "iPhone 17 Pro", "aliases": ["iPhone 17 Pro", "iPhone17Pro", "苹果 17 Pro", "苹果17Pro", "苹果 iPhone 17 Pro"], "category": "phone", "screen": "main", "width": 1206, "height": 2622, "sourceUrl": "https://support.apple.com/en-us/125090", "verifiedAt": "2026-11-07" },
    { "id": "iphone-17-pro-max", "brand": "apple", "name": "iPhone 17 Pro Max", "aliases": ["iPhone 17 Pro Max", "iPhone17ProMax", "苹果 17 Pro Max", "苹果17ProMax", "苹果 iPhone 17 Pro Max"], "category": "phone", "screen": "main", "width": 1320, "height": 2868, "sourceUrl": "https://support.apple.com/zh-cn/125091", "verifiedAt": "2026-11-07" },
    { "id": "iphone-air", "brand": "apple", "name": "iPhone Air", "aliases": ["iPhone Air", "iPhoneAir", "苹果 Air", "苹果Air", "苹果 iPhone Air"], "category": "phone", "screen": "main", "width": 1260, "height": 2736, "sourceUrl": "https://www.apple.com/tw/iphone-air/specs/", "verifiedAt": "2026-11-07" },
    { "id": "iphone-17e", "brand": "apple", "name": "iPhone 17e", "aliases": ["iPhone 17e", "iPhone17e", "苹果 17e", "苹果17e", "苹果 iPhone 17e"], "category": "phone", "screen": "main", "width": 1170, "height": 2532, "sourceUrl": "https://support.apple.com/zh-cn/126470", "verifiedAt": "2026-11-07" },
    { "id": "iphone-16", "brand": "apple", "name": "iPhone 16", "aliases": ["iPhone 16", "iPhone16", "苹果 16", "苹果16", "苹果 iPhone 16"], "category": "phone", "screen": "main", "width": 1179, "height": 2556, "sourceUrl": "https://support.apple.com/zh-hk/121029", "verifiedAt": "2026-11-07" },
    { "id": "iphone-16-plus", "brand": "apple", "name": "iPhone 16 Plus", "aliases": ["iPhone 16 Plus", "iPhone16Plus", "苹果 16 Plus", "苹果16Plus", "苹果 iPhone 16 Plus"], "category": "phone", "screen": "main", "width": 1290, "height": 2796, "sourceUrl": "https://support.apple.com/zh-cn/121030", "verifiedAt": "2026-11-07" },
    { "id": "ipad-pro-11-m5", "brand": "apple", "name": "iPad Pro 11 英寸（M5）", "aliases": ["iPad Pro 11 英寸（M5）", "iPadPro11英寸（M5）", "苹果 iPad Pro 11 英寸（M5）", "iPad Pro 11 M5"], "category": "tablet", "screen": "main", "width": 1668, "height": 2420, "sourceUrl": "https://www.apple.com/tw/ipad-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "ipad-pro-13-m5", "brand": "apple", "name": "iPad Pro 13 英寸（M5）", "aliases": ["iPad Pro 13 英寸（M5）", "iPadPro13英寸（M5）", "苹果 iPad Pro 13 英寸（M5）", "iPad Pro 13 M5"], "category": "tablet", "screen": "main", "width": 2064, "height": 2752, "sourceUrl": "https://www.apple.com/tw/ipad-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "ipad-air-11-m4", "brand": "apple", "name": "iPad Air 11 英寸（M4）", "aliases": ["iPad Air 11 英寸（M4）", "iPadAir11英寸（M4）", "苹果 iPad Air 11 英寸（M4）", "iPad Air 11 M4"], "category": "tablet", "screen": "main", "width": 1640, "height": 2360, "sourceUrl": "https://www.apple.com/tw/ipad-air/specs/", "verifiedAt": "2026-11-07" },
    { "id": "ipad-air-13-m4", "brand": "apple", "name": "iPad Air 13 英寸（M4）", "aliases": ["iPad Air 13 英寸（M4）", "iPadAir13英寸（M4）", "苹果 iPad Air 13 英寸（M4）", "iPad Air 13 M4"], "category": "tablet", "screen": "main", "width": 2048, "height": 2732, "sourceUrl": "https://www.apple.com/tw/ipad-air/specs/", "verifiedAt": "2026-11-07" },
    { "id": "ipad-mini-a20-pro", "brand": "apple", "name": "iPad mini 8.5 英寸（A20 Pro）", "aliases": ["iPad mini 8.5 英寸（A20 Pro）", "iPadmini8.5英寸（A20Pro）", "苹果 iPad mini 8.5 英寸（A20 Pro）", "iPad mini 8.5 A20 Pro", "iPad mini A20 Pro"], "category": "tablet", "screen": "main", "width": 1512, "height": 2316, "sourceUrl": "https://www.apple.com/tw/ipad-mini/specs/", "verifiedAt": "2026-11-07" },
    { "id": "ipad-mini-a17-pro", "brand": "apple", "name": "iPad mini 8.3 英寸（A17 Pro）", "aliases": ["iPad mini 8.3 英寸（A17 Pro）", "iPadmini8.3英寸（A17Pro）", "苹果 iPad mini 8.3 英寸（A17 Pro）", "iPad mini 8.3 A17 Pro", "iPad mini A17 Pro"], "category": "tablet", "screen": "main", "width": 1488, "height": 2266, "sourceUrl": "https://support.apple.com/zh-cn/121456", "verifiedAt": "2026-11-07" },
    { "id": "ipad-11-a16", "brand": "apple", "name": "iPad 11 英寸（A16）", "aliases": ["iPad 11 英寸（A16）", "iPad11英寸（A16）", "苹果 iPad 11 英寸（A16）", "iPad 11 A16"], "category": "tablet", "screen": "main", "width": 1640, "height": 2360, "sourceUrl": "https://www.apple.com/tw/ipad-11/specs/", "verifiedAt": "2026-11-07" },
    { "id": "ipad-pro-11-m2", "brand": "apple", "name": "iPad Pro 11 英寸（M2，第4代）", "aliases": ["iPad Pro 11 英寸（M2，第4代）", "iPadPro11英寸（M2，第4代）", "苹果 iPad Pro 11 英寸（M2，第4代）", "iPad Pro 11 M2"], "category": "tablet", "screen": "main", "width": 1668, "height": 2388, "sourceUrl": "https://support.apple.com/en-us/111842", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-s26", "brand": "samsung", "name": "Samsung Galaxy S26", "aliases": ["Samsung Galaxy S26", "SamsungGalaxyS26", "三星 S26", "三星S26", "三星 Samsung Galaxy S26", "S26"], "category": "phone", "screen": "main", "width": 1080, "height": 2340, "sourceUrl": "https://www.samsung.com/de/support/mobile-devices/vergleich-galaxy-s26-ultra-vs-galaxy-s26plus-vs-galaxy-s26/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-s26-plus", "brand": "samsung", "name": "Samsung Galaxy S26+", "aliases": ["Samsung Galaxy S26+", "SamsungGalaxyS26+", "三星 S26+", "三星S26+", "三星 Samsung Galaxy S26+", "S26+"], "category": "phone", "screen": "main", "width": 1440, "height": 3120, "sourceUrl": "https://www.samsung.com/de/support/mobile-devices/vergleich-galaxy-s26-ultra-vs-galaxy-s26plus-vs-galaxy-s26/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-s26-ultra", "brand": "samsung", "name": "Samsung Galaxy S26 Ultra", "aliases": ["Samsung Galaxy S26 Ultra", "SamsungGalaxyS26Ultra", "三星 S26 Ultra", "三星S26Ultra", "三星 Samsung Galaxy S26 Ultra", "S26 Ultra"], "category": "phone", "screen": "main", "width": 1440, "height": 3120, "sourceUrl": "https://www.samsung.com/de/support/mobile-devices/vergleich-galaxy-s26-ultra-vs-galaxy-s26plus-vs-galaxy-s26/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-s25", "brand": "samsung", "name": "Samsung Galaxy S25", "aliases": ["Samsung Galaxy S25", "SamsungGalaxyS25", "三星 S25", "三星S25", "三星 Samsung Galaxy S25", "S25"], "category": "phone", "screen": "main", "width": 1080, "height": 2340, "sourceUrl": "https://www.samsung.com/my/smartphones/galaxy-s25/specs/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-z-fold7-inner", "brand": "samsung", "name": "Samsung Galaxy Z Fold7 内屏", "aliases": ["Samsung Galaxy Z Fold7 内屏", "SamsungGalaxyZFold7内屏", "三星 Z Fold7 内屏", "三星ZFold7内屏", "三星 Samsung Galaxy Z Fold7 内屏", "Z Fold7 内屏", "Samsung Galaxy Z Fold7", "Samsung Galaxy Z Fold7内屏", "Galaxy Z Fold7", "Galaxy Z Fold7内屏", "三星Z Fold7", "三星Z Fold7内屏", "三星Fold7", "三星Fold7内屏"], "category": "foldable", "screen": "inner", "width": 1968, "height": 2184, "sourceUrl": "https://www.samsung.com/us/smartphones/galaxy-z/galaxy-z-fold7-jetblack-256gb-sm-f966uzkavzw/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-z-fold7-cover", "brand": "samsung", "name": "Samsung Galaxy Z Fold7 外屏", "aliases": ["Samsung Galaxy Z Fold7 外屏", "SamsungGalaxyZFold7外屏", "三星 Z Fold7 外屏", "三星ZFold7外屏", "三星 Samsung Galaxy Z Fold7 外屏", "Z Fold7 外屏", "Samsung Galaxy Z Fold7", "Samsung Galaxy Z Fold7外屏", "Galaxy Z Fold7", "Galaxy Z Fold7外屏", "三星Z Fold7", "三星Z Fold7外屏", "三星Fold7", "三星Fold7外屏"], "category": "foldable", "screen": "cover", "width": 1080, "height": 2520, "sourceUrl": "https://www.samsung.com/us/smartphones/galaxy-z/galaxy-z-fold7-jetblack-256gb-sm-f966uzkavzw/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-z-flip7-inner", "brand": "samsung", "name": "Samsung Galaxy Z Flip7 内屏", "aliases": ["Samsung Galaxy Z Flip7 内屏", "SamsungGalaxyZFlip7内屏", "三星 Z Flip7 内屏", "三星ZFlip7内屏", "三星 Samsung Galaxy Z Flip7 内屏", "Z Flip7 内屏", "Samsung Galaxy Z Flip7", "Samsung Galaxy Z Flip7内屏", "Galaxy Z Flip7", "Galaxy Z Flip7内屏", "三星Z Flip7", "三星Z Flip7内屏", "三星Flip7", "三星Flip7内屏"], "category": "foldable", "screen": "inner", "width": 1080, "height": 2520, "sourceUrl": "https://www.samsung.com/us/smartphones/galaxy-z/galaxy-z-flip7-jetblack-512gb-sm-f766uzkexag/", "verifiedAt": "2026-11-07" },
    { "id": "galaxy-z-flip7-cover", "brand": "samsung", "name": "Samsung Galaxy Z Flip7 外屏", "aliases": ["Samsung Galaxy Z Flip7 外屏", "SamsungGalaxyZFlip7外屏", "三星 Z Flip7 外屏", "三星ZFlip7外屏", "三星 Samsung Galaxy Z Flip7 外屏", "Z Flip7 外屏", "Samsung Galaxy Z Flip7", "Samsung Galaxy Z Flip7外屏", "Galaxy Z Flip7", "Galaxy Z Flip7外屏", "三星Z Flip7", "三星Z Flip7外屏", "三星Flip7", "三星Flip7外屏"], "category": "foldable", "screen": "cover", "width": 948, "height": 1048, "sourceUrl": "https://www.samsung.com/us/smartphones/galaxy-z/galaxy-z-flip7-jetblack-512gb-sm-f766uzkexag/", "verifiedAt": "2026-11-07" },
    { "id": "xiaomi-18-pro-max", "brand": "xiaomi", "name": "Xiaomi 18 Pro Max", "aliases": ["Xiaomi 18 Pro Max", "Xiaomi18ProMax", "小米 18 Pro Max", "小米18ProMax", "小米 Xiaomi 18 Pro Max"], "category": "phone", "screen": "main", "width": 1208, "height": 2624, "sourceUrl": "https://m.mi.com/commodity/detail/25526", "verifiedAt": "2026-11-07" },
    { "id": "xiaomi-17", "brand": "xiaomi", "name": "Xiaomi 17", "aliases": ["Xiaomi 17", "Xiaomi17", "小米 17", "小米17", "小米 Xiaomi 17"], "category": "phone", "screen": "main", "width": 1220, "height": 2656, "sourceUrl": "https://m.mi.com/commodity/detail/21931", "verifiedAt": "2026-11-07" },
    { "id": "xiaomi-17-pro", "brand": "xiaomi", "name": "Xiaomi 17 Pro", "aliases": ["Xiaomi 17 Pro", "Xiaomi17Pro", "小米 17 Pro", "小米17Pro", "小米 Xiaomi 17 Pro"], "category": "phone", "screen": "main", "width": 1220, "height": 2656, "sourceUrl": "https://m.mi.com/commodity/detail/21932", "verifiedAt": "2026-11-07" },
    { "id": "xiaomi-17-pro-max", "brand": "xiaomi", "name": "Xiaomi 17 Pro Max", "aliases": ["Xiaomi 17 Pro Max", "Xiaomi17ProMax", "小米 17 Pro Max", "小米17ProMax", "小米 Xiaomi 17 Pro Max"], "category": "phone", "screen": "main", "width": 1200, "height": 2608, "sourceUrl": "https://www.mi.com/prod/xiaomi-17-pro-max", "verifiedAt": "2026-11-07" },
    { "id": "xiaomi-17-ultra", "brand": "xiaomi", "name": "Xiaomi 17 Ultra", "aliases": ["Xiaomi 17 Ultra", "Xiaomi17Ultra", "小米 17 Ultra", "小米17Ultra", "小米 Xiaomi 17 Ultra"], "category": "phone", "screen": "main", "width": 1200, "height": 2608, "sourceUrl": "https://www.mi.com/global/product/xiaomi-17-ultra/specs/", "verifiedAt": "2026-11-07" },
    { "id": "xiaomi-15-pro", "brand": "xiaomi", "name": "Xiaomi 15 Pro", "aliases": ["Xiaomi 15 Pro", "Xiaomi15Pro", "小米 15 Pro", "小米15Pro", "小米 Xiaomi 15 Pro"], "category": "phone", "screen": "main", "width": 1440, "height": 3200, "sourceUrl": "https://www.mi.com/prod/xiaomi-15-pro", "verifiedAt": "2026-11-07" },
    { "id": "mate-90", "brand": "huawei", "name": "HUAWEI Mate 90", "aliases": ["HUAWEI Mate 90", "HUAWEIMate90", "华为 Mate 90", "华为Mate90", "华为 HUAWEI Mate 90", "Mate 90"], "category": "phone", "screen": "main", "width": 1280, "height": 2832, "sourceUrl": "https://consumer.huawei.com/cn/phones/mate90/specs/", "verifiedAt": "2026-11-07" },
    { "id": "mate-90-pro", "brand": "huawei", "name": "HUAWEI Mate 90 Pro", "aliases": ["HUAWEI Mate 90 Pro", "HUAWEIMate90Pro", "华为 Mate 90 Pro", "华为Mate90Pro", "华为 HUAWEI Mate 90 Pro", "Mate 90 Pro"], "category": "phone", "screen": "main", "width": 1280, "height": 2832, "sourceUrl": "https://consumer.huawei.com/cn/phones/mate90-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "mate-90-pro-max", "brand": "huawei", "name": "HUAWEI Mate 90 Pro Max", "aliases": ["HUAWEI Mate 90 Pro Max", "HUAWEIMate90ProMax", "华为 Mate 90 Pro Max", "华为Mate90ProMax", "华为 HUAWEI Mate 90 Pro Max", "Mate 90 Pro Max"], "category": "phone", "screen": "main", "width": 1320, "height": 2848, "sourceUrl": "https://consumer.huawei.com/cn/phones/mate90-pro-max/specs/", "verifiedAt": "2026-11-07" },
    { "id": "mate-80", "brand": "huawei", "name": "HUAWEI Mate 80", "aliases": ["HUAWEI Mate 80", "HUAWEIMate80", "华为 Mate 80", "华为Mate80", "华为 HUAWEI Mate 80", "Mate 80"], "category": "phone", "screen": "main", "width": 1280, "height": 2832, "sourceUrl": "https://consumer.huawei.com/cn/phones/mate80/specs/", "verifiedAt": "2026-11-07" },
    { "id": "pura-90", "brand": "huawei", "name": "HUAWEI Pura 90", "aliases": ["HUAWEI Pura 90", "HUAWEIPura90", "华为 Pura 90", "华为Pura90", "华为 HUAWEI Pura 90", "Pura 90"], "category": "phone", "screen": "main", "width": 1320, "height": 2856, "sourceUrl": "https://consumer.huawei.com/cn/phones/pura90/specs/", "verifiedAt": "2026-11-07" },
    { "id": "pura-90-pro-max", "brand": "huawei", "name": "HUAWEI Pura 90 Pro Max", "aliases": ["HUAWEI Pura 90 Pro Max", "HUAWEIPura90ProMax", "华为 Pura 90 Pro Max", "华为Pura90ProMax", "华为 HUAWEI Pura 90 Pro Max", "Pura 90 Pro Max"], "category": "phone", "screen": "main", "width": 1308, "height": 2880, "sourceUrl": "https://consumer.huawei.com/cn/phones/pura90-pro-max/specs/", "verifiedAt": "2026-11-07" },
    { "id": "pura-80", "brand": "huawei", "name": "HUAWEI Pura 80", "aliases": ["HUAWEI Pura 80", "HUAWEIPura80", "华为 Pura 80", "华为Pura80", "华为 HUAWEI Pura 80", "Pura 80"], "category": "phone", "screen": "main", "width": 1256, "height": 2760, "sourceUrl": "https://consumer.huawei.com/cn/phones/pura80/specs/", "verifiedAt": "2026-11-07" },
    { "id": "pura-80-pro", "brand": "huawei", "name": "HUAWEI Pura 80 Pro", "aliases": ["HUAWEI Pura 80 Pro", "HUAWEIPura80Pro", "华为 Pura 80 Pro", "华为Pura80Pro", "华为 HUAWEI Pura 80 Pro", "Pura 80 Pro"], "category": "phone", "screen": "main", "width": 1276, "height": 2848, "sourceUrl": "https://consumer.huawei.com/cn/phones/pura80-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "pura-80-ultra", "brand": "huawei", "name": "HUAWEI Pura 80 Ultra", "aliases": ["HUAWEI Pura 80 Ultra", "HUAWEIPura80Ultra", "华为 Pura 80 Ultra", "华为Pura80Ultra", "华为 HUAWEI Pura 80 Ultra", "Pura 80 Ultra"], "category": "phone", "screen": "main", "width": 1276, "height": 2848, "sourceUrl": "https://consumer.huawei.com/cn/phones/pura80-ultra/specs/", "verifiedAt": "2026-11-07" },
    { "id": "mate-x6-inner", "brand": "huawei", "name": "HUAWEI Mate X6 内屏", "aliases": ["HUAWEI Mate X6 内屏", "HUAWEIMateX6内屏", "华为 Mate X6 内屏", "华为MateX6内屏", "华为 HUAWEI Mate X6 内屏", "Mate X6 内屏", "HUAWEI Mate X6", "HUAWEI Mate X6内屏", "华为Mate X6", "华为Mate X6内屏"], "category": "foldable", "screen": "inner", "width": 2240, "height": 2440, "sourceUrl": "https://consumer.huawei.com/cn/phones/mate-x6/specs/", "verifiedAt": "2026-11-07" },
    { "id": "mate-x6-cover", "brand": "huawei", "name": "HUAWEI Mate X6 外屏", "aliases": ["HUAWEI Mate X6 外屏", "HUAWEIMateX6外屏", "华为 Mate X6 外屏", "华为MateX6外屏", "华为 HUAWEI Mate X6 外屏", "Mate X6 外屏", "HUAWEI Mate X6", "HUAWEI Mate X6外屏", "华为Mate X6", "华为Mate X6外屏"], "category": "foldable", "screen": "cover", "width": 1080, "height": 2440, "sourceUrl": "https://consumer.huawei.com/cn/phones/mate-x6/specs/", "verifiedAt": "2026-11-07" },
    { "id": "find-x10", "brand": "oppo", "name": "OPPO Find X10", "aliases": ["OPPO Find X10", "OPPOFindX10", "OPPO OPPO Find X10", "Find X10"], "category": "phone", "screen": "main", "width": 1272, "height": 2768, "sourceUrl": "https://www.oppo.com/cn/smartphones/series-find-x/find-x10/specs/", "verifiedAt": "2026-11-07" },
    { "id": "find-x10-pro-max", "brand": "oppo", "name": "OPPO Find X10 Pro Max", "aliases": ["OPPO Find X10 Pro Max", "OPPOFindX10ProMax", "OPPO OPPO Find X10 Pro Max", "Find X10 Pro Max"], "category": "phone", "screen": "main", "width": 1272, "height": 2772, "sourceUrl": "https://www.oppo.com/cn/smartphones/series-find-x/find-x10-pro-max/specs/", "verifiedAt": "2026-11-07" },
    { "id": "find-x9", "brand": "oppo", "name": "OPPO Find X9", "aliases": ["OPPO Find X9", "OPPOFindX9", "OPPO OPPO Find X9", "Find X9"], "category": "phone", "screen": "main", "width": 1256, "height": 2760, "sourceUrl": "https://www.oppo.com/cn/smartphones/series-find-x/find-x9/specs/", "verifiedAt": "2026-11-07" },
    { "id": "find-x9-pro", "brand": "oppo", "name": "OPPO Find X9 Pro", "aliases": ["OPPO Find X9 Pro", "OPPOFindX9Pro", "OPPO OPPO Find X9 Pro", "Find X9 Pro"], "category": "phone", "screen": "main", "width": 1272, "height": 2772, "sourceUrl": "https://www.oppo.com/cn/smartphones/series-find-x/find-x9-pro/specs/", "verifiedAt": "2026-11-07" },
    { "id": "find-x9-ultra", "brand": "oppo", "name": "OPPO Find X9 Ultra", "aliases": ["OPPO Find X9 Ultra", "OPPOFindX9Ultra", "OPPO OPPO Find X9 Ultra", "Find X9 Ultra"], "category": "phone", "screen": "main", "width": 1440, "height": 3168, "sourceUrl": "https://store.oppo.com/cn/app/product/index?skuId=39826", "verifiedAt": "2026-11-07" },
    { "id": "reno16", "brand": "oppo", "name": "OPPO Reno16", "aliases": ["OPPO Reno16", "OPPOReno16", "OPPO OPPO Reno16", "Reno16"], "category": "phone", "screen": "main", "width": 1216, "height": 2640, "sourceUrl": "https://www.oppo.com/cn/smartphones/series-reno/reno16/specs/", "verifiedAt": "2026-11-07" },
    { "id": "x500", "brand": "vivo", "name": "vivo X500", "aliases": ["vivo X500", "vivoX500", "vivo vivo X500", "X500"], "category": "phone", "screen": "main", "width": 1260, "height": 2750, "sourceUrl": "https://www.vivo.com.cn/vivo/param/x500", "verifiedAt": "2026-11-07" },
    { "id": "x500-pro", "brand": "vivo", "name": "vivo X500 Pro", "aliases": ["vivo X500 Pro", "vivoX500Pro", "vivo vivo X500 Pro", "X500 Pro"], "category": "phone", "screen": "main", "width": 1216, "height": 2660, "sourceUrl": "https://www.vivo.com.cn/vivo/param/x500pro", "verifiedAt": "2026-11-07" },
    { "id": "x500-pro-max", "brand": "vivo", "name": "vivo X500 Pro Max", "aliases": ["vivo X500 Pro Max", "vivoX500ProMax", "vivo vivo X500 Pro Max", "X500 Pro Max"], "category": "phone", "screen": "main", "width": 1440, "height": 3168, "sourceUrl": "https://www.vivo.com.cn/vivo/param/x500promax", "verifiedAt": "2026-11-07" },
    { "id": "x300", "brand": "vivo", "name": "vivo X300", "aliases": ["vivo X300", "vivoX300", "vivo vivo X300", "X300"], "category": "phone", "screen": "main", "width": 1216, "height": 2640, "sourceUrl": "https://www.vivo.com.cn/vivo/param/x300", "verifiedAt": "2026-11-07" },
    { "id": "x300-pro", "brand": "vivo", "name": "vivo X300 Pro", "aliases": ["vivo X300 Pro", "vivoX300Pro", "vivo vivo X300 Pro", "X300 Pro"], "category": "phone", "screen": "main", "width": 1260, "height": 2800, "sourceUrl": "https://www.vivo.com.cn/vivo/param/x300pro", "verifiedAt": "2026-11-07" },
    { "id": "magic9", "brand": "honor", "name": "荣耀 Magic9", "aliases": ["荣耀 Magic9", "荣耀Magic9", "荣耀 荣耀 Magic9"], "category": "phone", "screen": "main", "width": 1236, "height": 2664, "sourceUrl": "https://www.honor.com/cn/shop/product/10086099402227.html", "verifiedAt": "2026-11-07" },
    { "id": "magic9-pro-max", "brand": "honor", "name": "荣耀 Magic9 Pro Max", "aliases": ["荣耀 Magic9 Pro Max", "荣耀Magic9ProMax", "荣耀 荣耀 Magic9 Pro Max"], "category": "phone", "screen": "main", "width": 1320, "height": 2868, "sourceUrl": "https://www.honor.com/cn/shop/product/10086407229464.html", "verifiedAt": "2026-11-07" },
    { "id": "magic9-super-power", "brand": "honor", "name": "荣耀 Magic9 超能版", "aliases": ["荣耀 Magic9 超能版", "荣耀Magic9超能版", "荣耀 荣耀 Magic9 超能版"], "category": "phone", "screen": "main", "width": 1280, "height": 2788, "sourceUrl": "https://www.honor.com/cn/phones/honor-magic9-super-power/spec/", "verifiedAt": "2026-11-07" },
    { "id": "magic8-pro", "brand": "honor", "name": "荣耀 Magic8 Pro", "aliases": ["荣耀 Magic8 Pro", "荣耀Magic8Pro", "荣耀 荣耀 Magic8 Pro"], "category": "phone", "screen": "main", "width": 1256, "height": 2808, "sourceUrl": "https://www.honor.com/cn/phones/honor-magic8-pro/spec/", "verifiedAt": "2026-11-07" },
];
const BRAND_LABELS = { apple: '苹果', samsung: '三星', xiaomi: '小米', huawei: '华为', oppo: 'OPPO', vivo: 'vivo', honor: '荣耀' };
const wallpaperBrandLabel = (brand) => BRAND_LABELS[brand] || brand;
exports.wallpaperBrandLabel = wallpaperBrandLabel;
exports.brandLabel = exports.wallpaperBrandLabel;

},
"./bead-intent": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BEAD_WORKSPACE_NOTICE = void 0;
exports.isBeadPatternRequest = isBeadPatternRequest;
exports.BEAD_WORKSPACE_NOTICE = '拼豆图纸需先选择一张底图，在拼豆工作台按真实色卡生成网格、色号与采购表。本地制图不收费。';
const bead = /拼豆|\bperler\b|\b(?:fuse[ds]?\s+)?beads?\b/i;
const technical = /图纸|图样|网格|格子|格数|底板|色号|用量|采购(?:表|清单)?|\bpattern\b|\bpegboard\b|\b(?:colou?r\s*codes?|quantit(?:y|ies)|procurement|shopping\s*list)\b/i;
const marketing = /宣传|海报|营销|广告|文案|招牌|店招|经营|开店|商业计划|\bppt\b|\bpresentation\b|\bposter\b|\bmarketing\b|\badvertis\w*\b|\bcopywriting\b/i;
const explanatory = /^(?:请|帮我|为我|给我)?\s*(?:介绍|讲解|说明|描述|提及|宣传|推广|展示|文案|标题|口号|写上|标明|讲讲|explain\b|describe\b|about\b)/i;
const style = /拼豆\s*(?:风|风格)|\b(?:perler|bead)\s*[- ]?style\b/i;
const action = /做|制作|生成|绘制|设计|转(?:成|为|换)?|制成|拼成|想要|需要|\b(?:make|create|generate|convert|turn)\b/i;
const negated = /(?:不要|不需要|不用|无需|不必|不再|禁止|别|不想|不是要|不做|不制作|不生成)\s*(?:(?:把|将)(?:这|那)?(?:一)?(?:张)?(?:原图|参考图|图片|照片|图)\s*)?(?:(?:帮我|为我|给我|再|继续|进行|设计|做|制作|生成|转换|转成|转为|制成|要|任何|一个|一份|一套|一张|新的|实际的|真的|的)\s*)*(?:\d{1,3}\s*[×xX*]\s*\d{1,3}\s*(?:格|的)?\s*)?(?:拼豆|perler\b|(?:fuse[ds]?\s+)?beads?\b|hama\b)|\b(?:do\s+not|don['’]t|never|no|not)\s+(?:(?:make|create|generate|convert|a|an|any|new|actual|real)\s+)*(?:perler|(?:fuse[ds]?\s+)?beads?|hama)\b|拼豆(?:图纸|图样|网格)?\s*(?:不要|不用|不需要|无需|不必)\s*(?:再)?(?:做|制作|生成|转换)/i;
const join = /\s*(?:和|以及|及|加上|加|[+&]|\band\b)\s*/i;
const contentModifier = /(?:以|用).*(?:为|作)(?:主题|标题|卖点|口号)|介绍|讲解|描述|文案|标题|口号|写上|标明|展示/i;
function actualBeadClause(clause) {
    if (!bead.test(clause) || negated.test(clause) || explanatory.test(clause))
        return false;
    if (!marketing.test(clause)) {
        if (technical.test(clause))
            return true;
        if (style.test(clause))
            return false;
        if (!/拼豆|\bperler\b|\bfuse[ds]?\s+beads?\b/i.test(clause))
            return false;
        return action.test(clause) || /^(?:请)?\s*(?:拼豆|perler(?:\s+beads?)?|(?:fuse[ds]?\s+)?beads?)\s*$/i.test(clause);
    }
    // A poster about patterns stays a poster. Separate requested products may include both.
    if (contentModifier.test(clause))
        return false;
    const parts = clause.split(join);
    return parts.length > 1 && action.test(clause) && parts.some(part => bead.test(part) && technical.test(part) && !marketing.test(part) && !negated.test(part) && !style.test(part));
}
function isBeadPatternRequest(text) {
    if (typeof text !== 'string' || !text.trim() || !bead.test(text))
        return false;
    const content = marketing.test(text) ? text.replace(/“[^”]*”|"[^"]*"|「[^」]*」|『[^』]*』|《[^》]*》/g, '') : text;
    return content.split(/[，,。；;\n!?？！]|但是|不过|而是|然后|另外|并且|同时|(?=(?:再|另|并)(?:做|制作|生成|绘制|转成))/).some(part => actualBeadClause(part.trim()));
}

},
"./animation-workflow": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkedAnimationWorkflowSettings = checkedAnimationWorkflowSettings;
exports.makeAnimationWorkflow = makeAnimationWorkflow;
exports.defaultAnimationWorkflowSettings = defaultAnimationWorkflowSettings;
exports.animationRequestMode = animationRequestMode;
exports.animationStyleForRequest = animationStyleForRequest;
const animation_document_1 = require("./animation-document");
const fields = ['mode', 'style', 'columns', 'rows', 'width', 'height', 'fps', 'loopMs', 'background', 'entries'];
function checkedAnimationWorkflowSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)))
        throw Error('本地动画参数无效，仅支持角色与GIF合成设置。');
    const value = input, rawEntries = value.entries === undefined ? [{ caption: '你好' }] : value.entries;
    if (!Array.isArray(rawEntries) || !rawEntries.length || rawEntries.length > 16 || rawEntries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['caption', 'description', 'motion'].includes(key))))
        throw Error('单张PNG图集最多16个条目；更多角色请在工坊分组批量制作。');
    const entries = rawEntries.map((entry, index) => ({ id: `entry-${index + 1}`, caption: entry.caption, description: entry.description ?? '', motion: entry.motion ?? 'sway', frames: [], status: 'draft' }));
    const document = (0, animation_document_1.checkedAnimationDocument)({ ...(0, animation_document_1.newAnimationDocument)('animation-workflow'), ...value, entries });
    const style = (0, animation_document_1.animationStyle)(document.style);
    if ((document.mode === 'atlas' || style.route === 'light') && entries.length > document.columns * document.rows || document.mode === 'gif' && style.route !== 'light' && (entries.length !== 1 || document.columns * document.rows < style.framesPerEntry))
        throw Error('本地图集格数不足或连续动作混入多个角色条目，请调整来源图集。');
    if (document.mode === 'gif' && style.route !== 'light' && document.loopMs < style.framesPerEntry * 10)
        throw Error('每个连续动作关键姿态至少需要10毫秒，请增加循环时长。');
    return { mode: document.mode, style: document.style, columns: document.columns, rows: document.rows, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, ...(value.entries !== undefined ? { entries: document.entries.map(entry => ({ caption: entry.caption, description: entry.description, motion: entry.motion })) } : {}) };
}
function makeAnimationWorkflow(input, configuration) {
    const document = (0, animation_document_1.checkedAnimationDocument)(input), style = (0, animation_document_1.animationStyle)(document.style), single = document.mode === 'atlas' || style.route === 'light', grid = single ? [1, 1] : style.grid;
    const sample = (0, animation_document_1.checkedAnimationDocument)({ ...document, columns: grid[0], rows: grid[1], entries: [document.entries[0]], acceptedSampleId: undefined });
    const kind = document.referenceArtifactIds.length ? 'image-editing' : 'image-generation';
    const models = configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(kind) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo && ['image', 'openai-chat', 'openai-responses'].includes(connection.protocol)));
    const model = models.find(row => row.id === document.modelConfigId) || (!document.modelConfigId && models.length === 1 ? models[0] : undefined), keys = configuration.credentials.filter(key => key.enabled && key.connectionId === model?.connectionId), key = keys.find(row => row.id === document.credentialId) || (!document.credentialId && keys.length === 1 ? keys[0] : undefined);
    const source = { id: 'animation-source', name: '生成PNG角色样片图集', kind, role: 'producer', prompt: (0, animation_document_1.animationGenerationPrompt)(sample, sample.entries), modelConfigId: model?.id, credentialId: key?.id, inputSource: 'project', enabled: true, referenceArtifactIds: [...document.referenceArtifactIds], count: 1, imageOutputFormat: 'png', imageBackground: (0, animation_document_1.animationSourceBackground)(document), imageSize: grid[0] > grid[1] ? '1536x1024' : grid[1] > grid[0] ? '1024x1536' : '1024x1024' };
    const animation = checkedAnimationWorkflowSettings({ mode: document.mode, style: document.style, columns: grid[0], rows: grid[1], width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, entries: sample.entries.map(entry => ({ caption: entry.caption, description: entry.description, motion: entry.motion })) });
    return { name: `${document.title} · ${document.mode === 'atlas' ? '图集' : 'GIF'}样片`, description: '生成一个角色样片，随后在本地分帧与合成，人工检查后再在工坊扩展批量。图片步骤按真实调用计费；本地合成不调用模型。', outputKind: 'image', steps: [source, { id: 'animation-compose', name: document.mode === 'atlas' ? '本地拆分角色PNG' : '本地合成GIF动画', kind: 'animation-compose', role: 'producer', prompt: '', inputSource: 'previous', imageSourceStepId: source.id, referenceArtifactIds: [], animation, enabled: true }, { id: 'animation-review', name: '播放并检查实际样片', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }] };
}
function defaultAnimationWorkflowSettings() {
    const document = (0, animation_document_1.newAnimationDocument)('animation-workflow');
    return checkedAnimationWorkflowSettings({ mode: document.mode, style: document.style, columns: document.columns, rows: document.rows, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background });
}
function animationRequestMode(input) {
    const negativeGif = /(?:不需要|不用|不制作|不生成|不要|不做|无需|不是)[^，,。；;\n]{0,5}(?:GIF|动图|动画)/i.test(input), negativeAtlas = /(?:不需要|不用|不制作|不生成|不要|不做|无需|不是)[^，,。；;\n]{0,5}(?:角色图集|精灵图)/i.test(input);
    if (!negativeGif && /\bGIF\b|动图|动态(?:表情包|贴纸|(?:宣传|活动|品牌)?海报)|表情包动画|电子光栅|双状态(?:光栅|变画)|(?:制作|生成|让).{0,16}(?:动起来|循环动画)/i.test(input))
        return 'gif';
    if (!negativeAtlas && /角色图集|姿态图集|精灵图|sprite\s*(?:sheet|atlas)/i.test(input))
        return 'atlas';
    return undefined;
}
function animationStyleForRequest(input) {
    if (/光栅|变画|双状态/i.test(input))
        return 'lenticular';
    if (/人物与字体|字体联动|文字.*动|字.*一起动/i.test(input))
        return 'type-linked';
    if (/漫画印刷|整体融合|限定色|网点/i.test(input))
        return 'comic-fusion';
    if (/动态.{0,6}海报/i.test(input))
        return 'type-linked';
    if (/粘土|黏土/i.test(input))
        return 'clay-mascot';
    if (/像素/i.test(input))
        return /完整|连续|展开|关键帧/.test(input) ? 'pixel-actions' : 'pixel-light';
    if (/真人|照片人物|人像/i.test(input))
        return 'photo-people';
    if (/宠物|猫咪|小狗|柯基/i.test(input))
        return 'photo-pets';
    return 'illustrated-actions';
}

},
"./animation-document": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_MAX_PIXELS = exports.ANIMATION_MAX_FRAMES = exports.ANIMATION_MAX_ENTRIES = exports.ANIMATION_MAX_DOCUMENT_BYTES = exports.animationId = exports.ANIMATION_MOTIONS = exports.checkedAnimationDocument = exports.animationStyle = exports.ANIMATION_STYLES = void 0;
exports.newAnimationDocument = newAnimationDocument;
exports.resizeAnimationEntries = resizeAnimationEntries;
exports.animationSourceBackground = animationSourceBackground;
exports.animationArtHash = animationArtHash;
exports.animationRenderHash = animationRenderHash;
exports.animationGenerationPrompt = animationGenerationPrompt;
const animation_hash_1 = require("./animation-hash");
const animation_styles_1 = require("./animation-styles");
const animation_validation_1 = require("./animation-validation");
var animation_styles_2 = require("./animation-styles");
Object.defineProperty(exports, "ANIMATION_STYLES", { enumerable: true, get: function () { return animation_styles_2.ANIMATION_STYLES; } });
Object.defineProperty(exports, "animationStyle", { enumerable: true, get: function () { return animation_styles_2.animationStyle; } });
var animation_validation_2 = require("./animation-validation");
Object.defineProperty(exports, "checkedAnimationDocument", { enumerable: true, get: function () { return animation_validation_2.checkedAnimationDocument; } });
Object.defineProperty(exports, "ANIMATION_MOTIONS", { enumerable: true, get: function () { return animation_validation_2.ANIMATION_MOTIONS; } });
Object.defineProperty(exports, "animationId", { enumerable: true, get: function () { return animation_validation_2.animationId; } });
Object.defineProperty(exports, "ANIMATION_MAX_DOCUMENT_BYTES", { enumerable: true, get: function () { return animation_validation_2.ANIMATION_MAX_DOCUMENT_BYTES; } });
Object.defineProperty(exports, "ANIMATION_MAX_ENTRIES", { enumerable: true, get: function () { return animation_validation_2.ANIMATION_MAX_ENTRIES; } });
Object.defineProperty(exports, "ANIMATION_MAX_FRAMES", { enumerable: true, get: function () { return animation_validation_2.ANIMATION_MAX_FRAMES; } });
Object.defineProperty(exports, "ANIMATION_MAX_PIXELS", { enumerable: true, get: function () { return animation_validation_2.ANIMATION_MAX_PIXELS; } });
function newAnimationDocument(projectId, mode = 'gif', clock = Date.now) {
    const style = (0, animation_styles_1.animationStyle)('illustrated-actions');
    return (0, animation_validation_1.checkedAnimationDocument)({ version: 1, projectId, revision: 0, title: mode === 'atlas' ? '角色图集' : '角色 GIF', mode, style: style.id, prompt: '', referenceArtifactIds: [], modelConfigId: '', credentialId: '', ...style.defaults, columns: style.grid[0], rows: style.grid[1], entries: [{ id: 'entry-1', caption: '你好', description: '抬手问好，保留完整头部、身体和手。', motion: 'sway', frames: [], status: 'draft' }], updatedAt: new Date(clock()).toISOString() });
}
function resizeAnimationEntries(input, count) {
    const document = (0, animation_validation_1.checkedAnimationDocument)(input);
    if (!Number.isSafeInteger(count) || count < 1 || count > 100)
        throw Error('请填写1到100个角色条目。');
    const entries = document.entries.slice(0, count), known = new Set(entries.map(entry => entry.id));
    let number = 1;
    while (entries.length < count) {
        while (known.has(`entry-${number}`))
            number++;
        const id = `entry-${number++}`;
        known.add(id);
        entries.push({ id, caption: `表情 ${entries.length + 1}`, description: '', motion: 'sway', frames: [], status: 'draft' });
    }
    return (0, animation_validation_1.checkedAnimationDocument)({ ...document, entries, ...(document.acceptedSampleId && !known.has(document.acceptedSampleId) ? { acceptedSampleId: undefined } : {}) });
}
function animationSourceBackground(input) { const document = (0, animation_validation_1.checkedAnimationDocument)(input), route = (0, animation_styles_1.animationStyle)(document.style).route; return document.mode === 'atlas' || route === 'light' || route === 'keyframes' ? 'transparent' : 'opaque'; }
function selected(document, ids) {
    if (ids === undefined)
        return document.entries;
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !document.entries.some(entry => entry.id === id)))
        throw Error('请选择当前工程中不重复的有效角色条目。');
    const known = new Set(ids);
    return document.entries.filter(entry => known.has(entry.id));
}
function artSource(document, entries) {
    return { version: 1, projectId: document.projectId, mode: document.mode, style: document.style, prompt: document.prompt, referenceArtifactIds: document.referenceArtifactIds, modelConfigId: document.modelConfigId, credentialId: document.credentialId, entries: entries.map(entry => ({ id: entry.id, description: entry.description })) };
}
function animationArtHash(input, entryIds) { const document = (0, animation_validation_1.checkedAnimationDocument)(input); return (0, animation_hash_1.animationHash)(JSON.stringify(artSource(document, selected(document, entryIds)))); }
function animationRenderHash(input, entryIds) {
    const document = (0, animation_validation_1.checkedAnimationDocument)(input), entries = selected(document, entryIds);
    return (0, animation_hash_1.animationHash)(JSON.stringify({ art: artSource(document, entries), mode: document.mode, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, entries: entries.map(entry => ({ id: entry.id, caption: entry.caption, motion: entry.motion, frames: entry.frames })) }));
}
function animationGenerationPrompt(input, entries, options = {}) {
    const document = (0, animation_validation_1.checkedAnimationDocument)(input), style = (0, animation_styles_1.animationStyle)(document.style), ids = entries.map(entry => entry.id);
    selected(document, ids);
    if (options.refineInstruction !== undefined && (typeof options.refineInstruction !== 'string' || !options.refineInstruction.trim() || options.refineInstruction.length > 4000))
        throw Error('请填写不超过4000字的局部修改要求。');
    if (options.frameId !== undefined && !entries.some(entry => entry.frames.some(frame => frame.id === options.frameId)))
        throw Error('所选局部关键帧不属于当前条目。');
    const wholeRefine = Boolean(options.refineInstruction && !options.frameId), sourceFrames = wholeRefine ? entries[0]?.frames : undefined;
    if (wholeRefine && (entries.length !== 1 || !sourceFrames?.length || sourceFrames.length > document.columns * document.rows))
        throw Error('整条目精修需要已有源状态与足够的输出网格，请选择有效条目或单独精修某一帧。');
    const grid = [document.columns, document.rows];
    const appearance = { pixel: '有明确像素块和阶梯轮廓的像素画，保留像素边缘，不平滑模糊', illustration: '清晰完整的插画，保留参考角色画风、线条与配色', photographic: '保留照片人物或宠物的真实外观、毛色、五官、服饰和光线，不自动美颜或改变身份', clay: '保留粘土角色的体积、材质、柔和光线和标志细节，不宣称生成三维模型' }[style.appearance];
    const route = document.mode === 'atlas' ? '每个格子是一项独立、可识别的角色表情或姿态；不要把同一头像只换装饰当作不同表情。' : style.route === 'light' ? '每个条目只需一个明确的表情和姿势；后续轻动效由本地合成完成，不必画运动模糊。' : style.route === 'keyframes' ? '为同一条目画出连续动作关键姿态：准备、启动、过渡、动作高点、回收、接回初始姿态。头、身体、肩膀和手协调变化；不要只摆动一条手臂或复制相同头像。' : style.route === 'lenticular' ? '画同一角色或产品的两个明确状态，位置、角度、眼鼻下巴或产品轮廓要对齐。保持完整构图，不拉宽脸、不用黑边或模糊色带补缺失部分。' : '画两个完整动态海报关键状态；人物、背景和留给文字的空间统一设计。限定色、墨线、网点和前后层次服务于主体，脸、眼睛和关键道具保持清楚；不得用换衣服或贴大字代替状态设计。';
    const spec = entries.map((entry, index) => `${index + 1}. 条目 ${entry.id}：${entry.description.trim() || '给出与其它条目不同、容易辨认的角色反应'}。画面不绘制文案；本地叠字内容另存。`).join('\n');
    const references = [...new Set((sourceFrames || []).map(frame => frame.atlasArtifactId))];
    const sourceOrder = (sourceFrames || []).map((frame, index) => `${index + 1}. 参考图 ${references.indexOf(frame.atlasArtifactId) + 1} 的 ${frame.grid[0]} 列 × ${frame.grid[1]} 行原网格，第 ${frame.cell[0] + 1} 列、第 ${frame.cell[1] + 1} 行${frame.crop ? `，像素裁切框 [${frame.crop.join(', ')}]` : ''}；保留其姿态和 ${frame.durationMs} 毫秒停顿。`).join('\n');
    return [
        `你是负责可继续编辑的角色图集与动画关键姿态的制作人员。${options.frameId ? '只生成一张静态 PNG 关键姿态' : '只生成静态 PNG 图集'}，不返回 GIF、视频、代码、文字说明或下载链接。`,
        `画风：${style.name}；${appearance}。`,
        `以提供的参考图为身份锚点，固定脸型、发型、肤色或毛色、服装、比例与标志配饰；相邻姿态不得换脸、增加肢体、缺手指或裁掉头发与手。${options.refineInstruction || options.frameId ? '保留已有姿态和用户复制的重复停顿状态，不为制造差异改变已确认动作。' : '新姿态必须有实际可见变化。'}没有参考图时先建立统一的原创角色，不把不同条目画成不同人物；已有认可样片时沿用其身份。`,
        ...(options.frameId ? ['本次只输出一张已选关键姿态的完整静态 PNG，不输出图集，不把其他关键帧拼在同一画面。保持它与相邻姿态的角色身份、构图、尺寸与动作衔接。'] : [wholeRefine ? `仅修复现有条目的 ${sourceFrames.length} 个源状态，输出数量与原源状态逐一对应。以用户现有顺序、复制帧和重复停顿为准，不合并、不重排、不删帧，不按默认动作模板补帧。\n源状态顺序：\n${sourceOrder}` : route,
            `图集按 ${grid[0]} 列 × ${grid[1]} 行等分网格排列，从左到右、从上到下读取。${wholeRefine ? `依原顺序输出恰好 ${sourceFrames.length} 个源状态，每个源状态占一个有效格；剩余格保持空白，不为填满网格新增状态。` : document.mode === 'gif' && style.route !== 'light' ? `本次只有一个动作条目；依次绘制它的 ${style.framesPerEntry} 个关键状态，不把不同表情条目混成连续动作。` : '每个条目占一个格子，依照下方条目顺序排列，不多画或漏画条目。'}每个有效格完整包含一个姿态，构图尺寸稳定，各格间保留宽且均匀的空白安全间距，主体不能跨格或接触相邻角色。`]),
        animationSourceBackground(document) === 'transparent' ? '源稿始终使用真正透明的背景和干净边缘，不把棋盘格、白色底或灰边画进画面；成品背景另由本地合成设置。' : '源稿采用完整、不透明且整洁一致的背景，保持两种状态的构图和光线可衔接。',
        '不要生成汉字、字母、标语、水印、签名、格号或排版标尺。所有文字由本地编辑层添加。保留足够源图细节，不能用放大或模糊掩盖缺陷。',
        `本次条目与顺序：\n${spec}`,
        `用户额外需求（在上述制作约束内实现）：\n${document.prompt.trim() || '保持角色清楚、动作可辨认、适合独立使用。'}`,
        ...(options.refineInstruction ? [`局部修复：${options.refineInstruction.trim()}。${options.frameId ? `仅修复所选关键帧 ${options.frameId} 及衔接需要的邻近区域。` : '仅修复本次选中的条目。'}保留未选条目、已认可的角色身份和未要求变化的画面细节，不为重新导出改变画风。`] : []),
        '生成后须核对实际格数、主体是否完整、姿态顺序、身份一致性与边缘；不能用文件可打开或像素尺寸替代视觉质量判断。',
    ].join('\n\n');
}

},
"./animation-validation": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_MOTIONS = exports.animationId = exports.ANIMATION_MAX_PIXELS = exports.ANIMATION_MAX_FRAMES = exports.ANIMATION_MAX_ENTRIES = exports.ANIMATION_MAX_DOCUMENT_BYTES = void 0;
exports.checkedAnimationDocument = checkedAnimationDocument;
const animation_styles_1 = require("./animation-styles");
exports.ANIMATION_MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
exports.ANIMATION_MAX_ENTRIES = 100;
exports.ANIMATION_MAX_FRAMES = 120;
exports.ANIMATION_MAX_PIXELS = 48000000;
const animationId = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
exports.animationId = animationId;
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit, empty = true) => typeof value === 'string' && value.length <= limit && (empty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
exports.ANIMATION_MOTIONS = ['nod', 'jump', 'sway', 'startle', 'tremble', 'ponder', 'breathe', 'stomp', 'rush', 'peek', 'pulse', 'pop', 'offer', 'lean', 'droop', 'dance'];
function checkedFrame(input) {
    if (!object(input) || !(0, exports.animationId)(input.id) || !(0, exports.animationId)(input.atlasArtifactId) || !Array.isArray(input.cell) || input.cell.length !== 2 || !Array.isArray(input.grid) || input.grid.length !== 2 || input.grid.some(value => !integer(value, 1, 16)) || input.grid[0] * input.grid[1] > 120 || input.cell.some((value, index) => !integer(value, 0, Number(input.grid[index]) - 1)) || !integer(input.durationMs, 10, 6000) || input.durationMs % 10 !== 0)
        throw Error('动画关键帧的来源、格数或时长无效。');
    let crop;
    if (input.crop !== undefined) {
        if (!Array.isArray(input.crop) || input.crop.length !== 4 || input.crop.some(value => !integer(value, 0, 16384)) || input.crop[2] <= input.crop[0] || input.crop[3] <= input.crop[1] || (input.crop[2] - input.crop[0]) * (input.crop[3] - input.crop[1]) > 16777216)
            throw Error('关键帧裁切框无效。');
        crop = [...input.crop];
    }
    return { id: input.id, atlasArtifactId: input.atlasArtifactId, cell: [...input.cell], grid: [...input.grid], ...(crop ? { crop } : {}), durationMs: input.durationMs };
}
function checkedEntry(input) {
    if (!object(input) || !(0, exports.animationId)(input.id) || !text(input.caption, 120) || !text(input.description, 4000) || !exports.ANIMATION_MOTIONS.includes(input.motion) || !Array.isArray(input.frames) || input.frames.length > exports.ANIMATION_MAX_FRAMES || !['draft', 'ready', 'stale', 'failed'].includes(String(input.status)))
        throw Error('角色条目内容、动作或状态无效。');
    for (const key of ['outputArtifactId', 'coverArtifactId'])
        if (input[key] !== undefined && !(0, exports.animationId)(input[key]))
            throw Error('角色条目关联了无效产物。');
    for (const key of ['sourceHash', 'renderedHash'])
        if (input[key] !== undefined && !hash(input[key]))
            throw Error('角色条目版本指纹无效。');
    if (input.error !== undefined && !text(input.error, 2000))
        throw Error('角色条目的错误记录无效。');
    let inspection;
    if (input.inspection !== undefined) {
        const value = input.inspection;
        if (!object(value) || !integer(value.width, 1, 4096) || !integer(value.height, 1, 4096) || !integer(value.frames, 1, exports.ANIMATION_MAX_FRAMES) || value.width * value.height * value.frames > exports.ANIMATION_MAX_PIXELS || !integer(value.loopMs, 0, 6000) || typeof value.transparent !== 'boolean' || !Array.isArray(value.warnings) || value.warnings.length > 20 || value.warnings.some(warning => !text(warning, 500)))
            throw Error('动画实际检查报告无效。');
        inspection = { width: value.width, height: value.height, frames: value.frames, loopMs: value.loopMs, transparent: value.transparent, warnings: [...value.warnings] };
    }
    const frames = input.frames.map(checkedFrame);
    if (new Set(frames.map(frame => frame.id)).size !== frames.length)
        throw Error('动画关键帧编号重复。');
    return { id: input.id, caption: input.caption, description: input.description, motion: input.motion, frames, status: input.status, ...(input.outputArtifactId ? { outputArtifactId: input.outputArtifactId } : {}), ...(input.coverArtifactId ? { coverArtifactId: input.coverArtifactId } : {}), ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}), ...(input.renderedHash ? { renderedHash: input.renderedHash } : {}), ...(input.error ? { error: input.error } : {}), ...(inspection ? { inspection } : {}) };
}
function checkedAnimationDocument(input, projectId) {
    if (!object(input) || input.version !== 1 || !(0, exports.animationId)(input.projectId) || projectId && input.projectId !== projectId || !integer(input.revision, 0, Number.MAX_SAFE_INTEGER - 1) || !text(input.title, 160, false) || !['atlas', 'gif'].includes(String(input.mode)) || !animation_styles_1.ANIMATION_STYLES.some(style => style.id === input.style) || !text(input.prompt, 20000))
        throw Error('角色动画工程无效或不属于当前项目，原稿仍保留。');
    if (!Array.isArray(input.referenceArtifactIds) || input.referenceArtifactIds.length > 12 || input.referenceArtifactIds.some(id => !(0, exports.animationId)(id)) || new Set(input.referenceArtifactIds).size !== input.referenceArtifactIds.length || !(input.modelConfigId === '' || (0, exports.animationId)(input.modelConfigId)) || !(input.credentialId === '' || (0, exports.animationId)(input.credentialId)))
        throw Error('角色参考图或模型配置无效。');
    const gif = input.mode === 'gif', maximumSide = gif ? 3840 : 4096, maximumPixels = gif ? 8294400 : 16777216;
    const style = animation_styles_1.ANIMATION_STYLES.find(style => style.id === input.style), sampled = style.route !== 'keyframes';
    const plannedFrames = gif ? sampled ? Math.ceil(Number(input.loopMs) * Number(input.fps) / 1000) : style.framesPerEntry : 1;
    if (!integer(input.width, 16, maximumSide) || !integer(input.height, 16, maximumSide) || input.width * input.height > maximumPixels || typeof input.fps !== 'number' || !Number.isFinite(input.fps) || input.fps < 1 || input.fps > 50 || !integer(input.loopMs, 100, 6000) || input.loopMs % 10 !== 0 || gif && (sampled && Math.round(input.loopMs * input.fps / 1000) < 2 || plannedFrames > exports.ANIMATION_MAX_FRAMES) || input.width * input.height * plannedFrames > exports.ANIMATION_MAX_PIXELS || !['transparent', 'opaque'].includes(String(input.background)) || !integer(input.columns, 1, 16) || !integer(input.rows, 1, 16) || input.columns * input.rows > 120)
        throw Error('动画尺寸、时长、帧数或累计像素超出支持范围，请降低规格。');
    if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > exports.ANIMATION_MAX_ENTRIES || typeof input.updatedAt !== 'string' || input.updatedAt.length > 40 || !/T/.test(input.updatedAt) || !Number.isFinite(Date.parse(input.updatedAt)))
        throw Error('角色动画条目或保存时间无效。');
    const entries = input.entries.map(checkedEntry);
    if (new Set(entries.map(entry => entry.id)).size !== entries.length)
        throw Error('角色条目编号重复。');
    for (const entry of entries)
        if (entry.frames.length && (input.width * input.height * entry.frames.length > exports.ANIMATION_MAX_PIXELS || entry.frames.reduce((total, frame) => total + frame.durationMs, 0) > 6000))
            throw Error('角色关键帧的累计时长或像素超出支持范围。');
    if (input.acceptedSampleId !== undefined && (!(0, exports.animationId)(input.acceptedSampleId) || !entries.some(entry => entry.id === input.acceptedSampleId)))
        throw Error('认可样片不属于当前角色列表。');
    const document = { version: 1, projectId: input.projectId, revision: input.revision, title: input.title.trim(), mode: input.mode, style: input.style, prompt: input.prompt, referenceArtifactIds: [...input.referenceArtifactIds], modelConfigId: input.modelConfigId, credentialId: input.credentialId, width: input.width, height: input.height, fps: input.fps, loopMs: input.loopMs, background: input.background, columns: input.columns, rows: input.rows, entries, ...(input.acceptedSampleId ? { acceptedSampleId: input.acceptedSampleId } : {}), updatedAt: input.updatedAt };
    if (new TextEncoder().encode(JSON.stringify(document)).length > exports.ANIMATION_MAX_DOCUMENT_BYTES)
        throw Error('角色动画工程超过4MB，请分成不同项目保存。');
    return document;
}

},
"./animation-styles": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_STYLES = void 0;
exports.animationStyle = animationStyle;
const hd = { width: 512, height: 512, fps: 12.5, loopMs: 1920, background: 'transparent' };
const poster = { width: 480, height: 720, fps: 20, loopMs: 6000, background: 'opaque' };
exports.ANIMATION_STYLES = [
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
function animationStyle(id) { const value = exports.ANIMATION_STYLES.find(item => item.id === id); if (!value)
    throw Error('请选择支持的动画风格。'); return value; }

},
"./animation-hash": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.animationHash = animationHash;
// Synchronous SHA-256 keeps renderer and native document fingerprints identical.
function animationHash(text) {
    const data = new TextEncoder().encode(text), length = data.length;
    const bytes = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
    bytes.set(data);
    bytes[length] = 128;
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 8, Math.floor(length / 536870912));
    view.setUint32(bytes.length - 4, length * 8 >>> 0);
    const k = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Uint32Array(64);
    const rotate = (n, bits) => n >>> bits | n << 32 - bits;
    for (let at = 0; at < bytes.length; at += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = view.getUint32(at + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            w[i] = (w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10)) >>> 0;
        }
        let [a, b, c, d, e, f, g, j] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + k[i] + w[i]) >>> 0, t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0;
            j = g;
            g = f;
            f = e;
            e = d + t1 >>> 0;
            d = c;
            c = b;
            b = a;
            a = t1 + t2 >>> 0;
        }
        for (const [i, value] of [a, b, c, d, e, f, g, j].entries())
            h[i] = h[i] + value >>> 0;
    }
    return h.map(value => value.toString(16).padStart(8, '0')).join('');
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
