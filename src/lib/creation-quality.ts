import type { ProjectKind } from '../types';
import type { WorkflowDefinition } from '../configuration-types';
import { CREATION_FOUNDATION_VERSION, CREATION_PROFILES } from './creation-profiles';
export function generationQualityInstructions(kind: ProjectKind, capability = 'text', options: { purpose?: string; pageCount?: number; imageSize?: string; imageBackground?: string; hasReferences?: boolean } = {}): string {
  if (['vision', 'video-understanding', 'transcription'].includes(capability)) return '检查实际提供的内容，区分可见事实、推断和无法核实之处；列出可操作的修改建议，不声称已完成实际未执行的检查。';
  const factual = '以可交付成品为目标。保留用户确认的事实、名称、数字和约束，不编造业绩、资质、客户评价、来源或承诺。信息缺失时使用不虚构具体数据的通用表达；确实必需的缺项单列在 meta.missingInputs 数组，不在正文放 XXX、请填写、示例数据等占位。用户明确要求可填写模板时，保留清楚的规范字段标识，示例数字须明确标注，不能冒充真实数据。不要把写作说明、分析过程或自评写入成品。';
  if (kind === 'image' && ['image-generation', 'image-editing'].includes(capability)) return [
    '制作可供实际宣传或设计交付的完整画面；优先满足用户的用途、风格、比例与主体要求，不自行加入装饰性水印或无关标识。',
    options.purpose ? `目标用途：${options.purpose}。` : '', options.imageSize ? `目标输出尺寸：${options.imageSize}；主体和重要文字保持安全边距。` : '',
    '主体清晰，构图有层级，光影、透视和材质统一；检查人物肢体、商品结构、轮廓与背景衔接。只使用用户明确给出的文字，尽量简短清晰，不新增虚构宣传数据。',
    options.hasReferences ? '依据参考图保持商品、人物、服装及用户要求保留的细节；不要擅自改动包装、商标、款式或文字。' : '缺少品牌或人物参考时使用原创通用主体，不假称与某品牌、人物或作品存在授权关系。',
    options.imageBackground === 'transparent' ? '输出真正带 Alpha 透明通道的 PNG，背景不绘制棋盘格或白底，主体边缘干净，避免杂色、缺口和残留阴影。' : '背景服务于主体和排版，保持自然完整；需要文案位置时预留明确留白。',
  ].filter(Boolean).join('\n');
  if (kind === 'ppt') return `${factual}\n必须返回可解析的 JSON 对象 {"title":"演示标题","slides":[{"title":"每页标题","bullets":["可直接上版的完整正文要点"],"notes":"补充讲解与数据依据"}],"meta":{"missingInputs":[]}}，不要 Markdown 围栏。${options.pageCount ? `目标为 ${options.pageCount} 页，遵守用户明确要求的页数。` : '严格遵守用户指定页数；未指定时根据内容组织完整的适量页面。'}每页围绕一个明确结论，通常 2–5 条简洁要点；避免长段堆砌、只有提纲或页码标题。形成封面、背景/问题、核心方案、执行计划与结论的连贯叙事，按用途调整；不要凭空增加无关章节。精修时返回完整修订文稿，保留未要求修改的内容。`;
  if (kind === 'word') return `${factual}\n必须返回可解析的 JSON 对象，不要 Markdown 围栏。纯文字文稿使用 {"title":"文档标题","sections":[{"heading":"章节标题","paragraphs":["可直接交付的完整正文段落"]}],"meta":{"missingInputs":[]}}。需要表格时改用 {"schemaVersion":1,"kind":"word","title":"文档标题","blocks":[{"id":"body-1","type":"paragraph","text":"完整正文","fontSize":12,"align":"left","bold":false,"italic":false},{"id":"table-1","type":"table","text":"","fontSize":12,"align":"left","bold":false,"italic":false,"table":{"columns":[{"id":"column-1"},{"id":"column-2"}],"rows":[{"id":"row-1","cells":[{"id":"cell-1","text":"表头一"},{"id":"cell-2","text":"表头二"}]},{"id":"row-2","cells":[{"id":"cell-3","text":"实际内容"},{"id":"cell-4","text":"实际内容"}]}],"header":true,"borders":true}}],"meta":{"missingInputs":[]}}。blocks 与 sections 只选一种；标题段落 type 为 heading，项目列表为 bullet，均保留同样样式字段。表格必须是原生 table 结构，禁止用图片或竖线文本代替；每表 1–30 行、1–12 列，各行单元格数与 columns 一致，表内行/列/单元格 id 唯一且精修时保留，text 始终为空。章节有清晰层级，段落完整、术语一致，明确目的、范围、安排和结论；根据用户用途取舍，不输出空泛提纲或重复套话。事实来源和需要客户提供的信息单列在 meta，不假造引文。精修时返回整份修订正文，保留未要求修改的表格与稳定编号。`;
  if (kind === 'excel') return `${factual}\n返回可解析的 JSON 对象 {"title":"表格标题","sheets":[{"name":"工作表名","columns":["列名"],"rows":[["实际数据",0,{"formula":"SUM(B2:B3)"}]],"formatting":{"boldRanges":["A1:C1"],"columnWidths":{"A":18},"numberFormats":{"B2":"0.00"}}}]}，不要 Markdown 围栏。软件会将 JSON 写入真实 XLSX 并重算，不要声称交付不能包含表格文件。列名、单位、数据类型明确，逐行数据完整，公式仅引用真实存在的单元格；不要用演示金额冒充用户数据。columns 定义的表头由软件默认加粗；可用 formatting.boldRanges 指定加粗区域、columnWidths 指定8.43–90字符列宽、numberFormats 指定 General、0、0.00 或0.00%格式，每类最多200个区域。也可用 {"value":200,"bold":true,"format":"currency"} 形式指定单元格，format仅支持 general、integer、number、currency、percent；公式对象可带同样样式字段。不要输出其他未支持的格式指令，不能把样式要求只写在文字说明。公式结果由软件在交付前重算核验，不能声称已执行实际未执行的计算。`;
  return factual;
}

const FOUNDATION_MARKER = '【序作内置创作规范 ·';
export function creationPrompt(kind: ProjectKind, userPrompt: string, capability = 'text', options: Parameters<typeof generationQualityInstructions>[2] = {}): string {
  if (userPrompt.startsWith(FOUNDATION_MARKER)) return userPrompt;
  if (['vision', 'video-understanding', 'transcription'].includes(capability)) return `${FOUNDATION_MARKER}内容检查 · ${CREATION_FOUNDATION_VERSION}】\n${generationQualityInstructions(kind, capability, options)}\n\n【用户本次要求】\n${userPrompt.trim()}`;
  if (['image-generation', 'image-editing'].includes(capability)) kind = 'image';
  const profile = CREATION_PROFILES[kind];
  return `${FOUNDATION_MARKER}${profile.name} · ${CREATION_FOUNDATION_VERSION}】\n${profile.instructions}\n${generationQualityInstructions(kind, capability, options)}\n\n【用户本次要求】\n${userPrompt.trim()}`;
}

export function withCreationFoundation(workflow: WorkflowDefinition): WorkflowDefinition {
  const enabled = workflow.steps.filter(step => step.enabled);
  const exporter = enabled.filter(step => step.kind === 'export').at(-1);
  const finalText = exporter?.contentSourceStepId || enabled.filter(step => step.kind === 'text').at(-1)?.id;
  return { ...workflow, steps: workflow.steps.map(step => {
    if (step.role === 'planner' || step.role === 'reviewer') return step;
    if (!step.enabled || step.prompt.startsWith(FOUNDATION_MARKER)) return step;
    const image = ['image-generation', 'image-editing'].includes(step.kind);
    const document = workflow.outputKind !== 'image' && step.kind === 'text' && step.id === finalText;
    if (!image && !document) return step;
    const report = /(?:复核|审查|检查报告|检查清单|review|audit)/i.test(step.name) && !/(?:修订|重写|精修|完整成品)/.test(step.prompt);
    if (report) return step;
    return { ...step, prompt: creationPrompt(image ? 'image' : workflow.outputKind, step.prompt, step.kind, { imageSize: step.imageSize, imageBackground: step.imageBackground }) };
  }) };
}
