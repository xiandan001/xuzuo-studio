import type { AnimationDocument, AnimationEntry, AnimationMode } from '../animation-types';
import { animationHash } from './animation-hash';
import { animationStyle } from './animation-styles';
import { checkedAnimationDocument } from './animation-validation';
export { ANIMATION_STYLES, animationStyle } from './animation-styles';
export { checkedAnimationDocument, ANIMATION_MOTIONS, animationId, ANIMATION_MAX_DOCUMENT_BYTES, ANIMATION_MAX_ENTRIES, ANIMATION_MAX_FRAMES, ANIMATION_MAX_PIXELS } from './animation-validation';

export function newAnimationDocument(projectId: string, mode: AnimationMode = 'gif', clock: () => number = Date.now): AnimationDocument {
  const style = animationStyle('illustrated-actions');
  return checkedAnimationDocument({ version: 1, projectId, revision: 0, title: mode === 'atlas' ? '角色图集' : '角色 GIF', mode, style: style.id, prompt: '', referenceArtifactIds: [], modelConfigId: '', credentialId: '', ...style.defaults, columns: style.grid[0], rows: style.grid[1], entries: [{ id: 'entry-1', caption: '你好', description: '抬手问好，保留完整头部、身体和手。', motion: 'sway', frames: [], status: 'draft' }], updatedAt: new Date(clock()).toISOString() });
}

export function resizeAnimationEntries(input: AnimationDocument, count: number): AnimationDocument {
  const document = checkedAnimationDocument(input); if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw Error('请填写1到100个角色条目。');
  const entries = document.entries.slice(0, count), known = new Set(entries.map(entry => entry.id)); let number = 1;
  while (entries.length < count) { while (known.has(`entry-${number}`)) number++; const id = `entry-${number++}`; known.add(id); entries.push({ id, caption: `表情 ${entries.length + 1}`, description: '', motion: 'sway', frames: [], status: 'draft' }); }
  return checkedAnimationDocument({ ...document, entries, ...(document.acceptedSampleId && !known.has(document.acceptedSampleId) ? { acceptedSampleId: undefined } : {}) });
}

export function animationSourceBackground(input: AnimationDocument): 'transparent' | 'opaque' { const document = checkedAnimationDocument(input), route = animationStyle(document.style).route; return document.mode === 'atlas' || route === 'light' || route === 'keyframes' ? 'transparent' : 'opaque'; }

function selected(document: AnimationDocument, ids?: readonly string[]) {
  if (ids === undefined) return document.entries;
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !document.entries.some(entry => entry.id === id))) throw Error('请选择当前工程中不重复的有效角色条目。');
  const known = new Set(ids); return document.entries.filter(entry => known.has(entry.id));
}
function artSource(document: AnimationDocument, entries: readonly AnimationEntry[]) {
  return { version: 1, projectId: document.projectId, mode: document.mode, style: document.style, prompt: document.prompt, referenceArtifactIds: document.referenceArtifactIds, modelConfigId: document.modelConfigId, credentialId: document.credentialId, entries: entries.map(entry => ({ id: entry.id, description: entry.description })) };
}
export function animationArtHash(input: AnimationDocument, entryIds?: readonly string[]): string { const document = checkedAnimationDocument(input); return animationHash(JSON.stringify(artSource(document, selected(document, entryIds)))); }
export function animationRenderHash(input: AnimationDocument, entryIds?: readonly string[]): string {
  const document = checkedAnimationDocument(input), entries = selected(document, entryIds);
  return animationHash(JSON.stringify({ art: artSource(document, entries), mode: document.mode, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, entries: entries.map(entry => ({ id: entry.id, caption: entry.caption, motion: entry.motion, frames: entry.frames })) }));
}

export function animationGenerationPrompt(input: AnimationDocument, entries: readonly AnimationEntry[], options: { refineInstruction?: string; frameId?: string } = {}): string {
  const document = checkedAnimationDocument(input), style = animationStyle(document.style), ids = entries.map(entry => entry.id); selected(document, ids);
  if (options.refineInstruction !== undefined && (typeof options.refineInstruction !== 'string' || !options.refineInstruction.trim() || options.refineInstruction.length > 4000)) throw Error('请填写不超过4000字的局部修改要求。');
  if (options.frameId !== undefined && !entries.some(entry => entry.frames.some(frame => frame.id === options.frameId))) throw Error('所选局部关键帧不属于当前条目。');
  const wholeRefine = Boolean(options.refineInstruction && !options.frameId), sourceFrames = wholeRefine ? entries[0]?.frames : undefined;
  if (wholeRefine && (entries.length !== 1 || !sourceFrames?.length || sourceFrames.length > document.columns * document.rows)) throw Error('整条目精修需要已有源状态与足够的输出网格，请选择有效条目或单独精修某一帧。');
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
    ...(options.frameId ? ['本次只输出一张已选关键姿态的完整静态 PNG，不输出图集，不把其他关键帧拼在同一画面。保持它与相邻姿态的角色身份、构图、尺寸与动作衔接。'] : [wholeRefine ? `仅修复现有条目的 ${sourceFrames!.length} 个源状态，输出数量与原源状态逐一对应。以用户现有顺序、复制帧和重复停顿为准，不合并、不重排、不删帧，不按默认动作模板补帧。\n源状态顺序：\n${sourceOrder}` : route,
      `图集按 ${grid[0]} 列 × ${grid[1]} 行等分网格排列，从左到右、从上到下读取。${wholeRefine ? `依原顺序输出恰好 ${sourceFrames!.length} 个源状态，每个源状态占一个有效格；剩余格保持空白，不为填满网格新增状态。` : document.mode === 'gif' && style.route !== 'light' ? `本次只有一个动作条目；依次绘制它的 ${style.framesPerEntry} 个关键状态，不把不同表情条目混成连续动作。` : '每个条目占一个格子，依照下方条目顺序排列，不多画或漏画条目。'}每个有效格完整包含一个姿态，构图尺寸稳定，各格间保留宽且均匀的空白安全间距，主体不能跨格或接触相邻角色。`]),
    animationSourceBackground(document) === 'transparent' ? '源稿始终使用真正透明的背景和干净边缘，不把棋盘格、白色底或灰边画进画面；成品背景另由本地合成设置。' : '源稿采用完整、不透明且整洁一致的背景，保持两种状态的构图和光线可衔接。',
    '不要生成汉字、字母、标语、水印、签名、格号或排版标尺。所有文字由本地编辑层添加。保留足够源图细节，不能用放大或模糊掩盖缺陷。',
    `本次条目与顺序：\n${spec}`,
    `用户额外需求（在上述制作约束内实现）：\n${document.prompt.trim() || '保持角色清楚、动作可辨认、适合独立使用。'}`,
    ...(options.refineInstruction ? [`局部修复：${options.refineInstruction.trim()}。${options.frameId ? `仅修复所选关键帧 ${options.frameId} 及衔接需要的邻近区域。` : '仅修复本次选中的条目。'}保留未选条目、已认可的角色身份和未要求变化的画面细节，不为重新导出改变画风。`] : []),
    '生成后须核对实际格数、主体是否完整、姿态顺序、身份一致性与边缘；不能用文件可打开或像素尺寸替代视觉质量判断。',
  ].join('\n\n');
}
