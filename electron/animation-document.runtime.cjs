// Generated from shared animation document helpers; run scripts/build-animation-document-runtime.mjs.
'use strict';
const factories = {
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

}
};
const cache = Object.create(null);
function load(id) {
  if (!Object.hasOwn(factories, id)) throw Error('Unknown animation runtime dependency');
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} }; factories[id](module, module.exports, load); return module.exports;
}
module.exports = { ...load('./animation-document'), ...load('./animation-workflow') };
