import type { PromptCategory, PromptTemplate } from './types';

export const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = { ppt: 'PPT 演示', word: 'Word 文档', excel: 'Excel 表格', image: '图像创作', general: '通用精修' };

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    id: 'builtin-ppt-brand', builtin: true, updatedAt: '内置模板', category: 'ppt', mode: 'create',
    name: '品牌提案 · 清晰讲好一个品牌', description: '从定位到视觉与传播，组织一份便于讲解的品牌提案。',
    content: '请为{{主题}}制作一份品牌提案，面向{{受众}}，整体采用{{风格}}。先梳理核心主张，再按“背景与目标—品牌定位—受众需求—视觉方向—落地建议—下一步”组织内容。每页只表达一个重点，标题简短，正文控制在3至5条。将事实、用户提供的数据与建议明确区分；未提供的经营数据标记为待补充，不编造案例或引用。输出可编辑的页面内容与布局建议，并列出需要我确认的信息。',
  },
  {
    id: 'builtin-ppt-review', builtin: true, updatedAt: '内置模板', category: 'ppt', mode: 'create',
    name: '工作复盘 · 结果与下一步', description: '用事实、问题和行动计划串起一次工作复盘。',
    content: '请根据我提供的资料，为{{主题}}整理工作复盘演示，汇报对象为{{受众}}。采用{{风格}}，按“目标—实际完成—关键成果—差距与原因—经验—后续行动”组织。保留原始数字和单位，不将计划当作已完成成果。每个行动项包含动作、责任角色和时间；缺失字段写待确认。图表只能依据已提供数据生成，没有数据时使用结构图，不虚构增长率。',
  },
  {
    id: 'builtin-ppt-outline', builtin: true, updatedAt: '内置模板', category: 'ppt', mode: 'create',
    name: '资料转演示 · 一页一个重点', description: '将长资料整理成简洁的汇报大纲与页面内容。',
    content: '将我提供的{{主题}}资料整理为面向{{受众}}的演示文稿，风格为{{风格}}。先归纳结论，再列出支持结论的依据。每页由一个结论型标题、精简正文和合适的图示建议组成。长段落拆分为层级清楚的要点，保留来源信息、限定条件和原文中的不确定性。不要添加资料之外的事实。最后给出整体叙事顺序和可删除的重复内容。',
  },
  {
    id: 'builtin-word-brief', builtin: true, updatedAt: '内置模板', category: 'word', mode: 'create',
    name: '项目说明书 · 把交付说清楚', description: '整理目标、范围、交付物、时间安排与验收事项。',
    content: '请为{{主题}}整理一份项目说明书，阅读对象为{{受众}}，语气采用{{风格}}。包含项目背景、目标、交付物、包含与不包含的范围、所需输入、阶段安排和验收清单。用标题层级与表格提升可读性，避免模糊的“尽快”“适当”等表述。仅使用已提供的信息；未明确的数量、日期、责任和标准标记为待确认。这是一份工作说明，不代替合同或专业法律意见。',
  },
  {
    id: 'builtin-word-refine', builtin: true, updatedAt: '内置模板', category: 'word', mode: 'refine',
    name: '文稿精修 · 保留事实，改善表达', description: '调整语气、逻辑和段落结构，并列出主要修改。',
    content: '请精修当前{{主题}}文稿，面向{{受众}}，期望风格为{{风格}}。保持事实、姓名、数字、单位、日期与引用含义不变。优先修正歧义、重复和逻辑跳跃，再改善标题、段落衔接和句子长度。不得为了流畅而补造背景信息。对有疑问的事实提出待确认项，不直接猜测改写。输出精修内容及简短修改说明，保留我未要求调整的部分。',
  },
  {
    id: 'builtin-excel-project', builtin: true, updatedAt: '内置模板', category: 'excel', mode: 'create',
    name: '项目管理表 · 排期与交付', description: '用易填写的字段管理项目进度与待办。',
    content: '请为{{主题}}设计一个易上手的Excel管理表，主要使用者是{{受众}}。先给出工作表结构、字段含义、输入区域和计算区域。覆盖项目名称、状态、截止日期、交付进度与备注，使用清晰的下拉选项和到期高亮。示例数据必须注明为虚构，不加入真实个人信息。优先使用常规公式，说明兼容要求；对空白日期、取消项目和重复记录给出可核对的处理规则。',
  },
  {
    id: 'builtin-excel-clean', builtin: true, updatedAt: '内置模板', category: 'excel', mode: 'refine',
    name: '表格整理 · 保留原始数据', description: '检查字段、重复与缺项，输出变更清单。',
    content: '请检查当前{{主题}}表格，按照{{整理要求}}整理。保留原始数据和可追溯的行号，不静默改写姓名、编号、金额、日期或单位。先识别表头、数据类型、重复项与缺失项，再提出标准化建议。无法确定的值标为待人工确认，不补造数据。结果需区分“原值、建议值、原因”，并给出整理前后行数和关键合计的检查清单。',
  },
  {
    id: 'builtin-excel-formula', builtin: true, updatedAt: '内置模板', category: 'excel', mode: 'refine',
    name: '公式检查 · 说明与验算', description: '解释公式依赖，提出检查样本，不声称已经重算通过。',
    content: '请检查当前{{主题}}工作簿中的公式，计算目标是{{计算目标}}。说明每个关键公式引用哪些字段、单位和条件；检查空值、零值、重复记录与引用范围。给出修改建议，并列出带已知结果的验算样本。没有实际计算引擎的重算结果时，不得宣称“已计算正确”或“验证通过”。对不兼容函数、外部链接或宏单独提示，保留原文件副本。',
  },
  {
    id: 'builtin-image-poster', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '宣传图',
    name: '宣传视觉 · 留白与主次', description: '突出主体，预留文案位置，适合产品宣传视觉草稿。',
    content: '为{{主题}}创作一张面向{{受众}}的宣传视觉，整体风格为{{风格}}。主体明确，构图有清楚的视觉层级，保留干净留白用于后续排版。使用和谐、克制的配色，背景不抢主体。若提供商品参考图，保留其外形、颜色、标识与关键细节，不添加不存在的功能、配件、优惠价格或认证。未提供的精确宣传文字不要自行编造；文字区域可留空，方便后续准确叠加。',
  },
  {
    id: 'builtin-image-person', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '人物图',
    name: '人物创作 · 自然光影', description: '以明确的人物、场景和风格组织一张人物图。',
    content: '创作一张{{人物描述}}的人物图，场景为{{场景}}，视觉风格为{{风格}}。人物自然、肢体结构合理，五官与双手细节清楚，光影与环境一致。不要加入未要求的品牌、水印或文字。如果有已获授权的参考图，优先保持参考人物的外观特征，并提醒我核对一致性；没有参考图时生成虚构人物，不冒充具体真实人物。',
  },
  {
    id: 'builtin-image-cartoon', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '卡通图',
    name: '原创卡通 · 清楚的角色轮廓', description: '生成便于延展的原创卡通角色与简洁场景。',
    content: '创作一个以{{角色描述}}为主题的原创卡通形象，采用{{风格}}。轮廓清楚、造型简洁，表情与动作表达{{情绪或动作}}，配色统一，避免过多细碎纹理。使用原创外观，不模仿已有动漫角色、品牌吉祥物或特定创作者的标志性形象。背景简洁，让角色适合后续排版；如果参考了上一版，保持已有角色特征。',
  },
  {
    id: 'builtin-image-tryon', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '试衣图',
    name: '试衣示意 · 保留服装细节', description: '基于已授权人物与服装参考，制作换装视觉示意。',
    content: '基于我已提供且有权使用的人物参考图与服装参考图，制作{{场景}}中的换装视觉示意，画面风格为{{风格}}。尽量保持人物面部特征、体态、姿势及服装版型、颜色、纹理和已有标识。衣服与身体关系自然，光影一致，不添加参考中不存在的饰品或品牌。此结果仅供视觉展示，不代表真实尺码、材质性能或实际穿着保证；输出后需要人工核对人物和服装细节。',
  },
  {
    id: 'builtin-image-avatar', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '头像',
    name: '头像设计 · 小尺寸也清楚', description: '居中、轮廓明确，并考虑圆形裁切。',
    content: '为{{主体描述}}制作头像，采用{{风格}}，主色调为{{主色调}}。使用居中构图，头部或主要主体完整，四周保留适当留白，兼顾正方形与圆形裁切。缩小后仍能清楚辨认，不放细小文字、水印或复杂背景。没有参考图时使用原创虚构形象；有已授权参考图时保留重要外观特征，并列出需要人工核对的一致性细节。',
  },
  {
    id: 'builtin-image-emote', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '表情包',
    name: '角色表情 · 一张一个动作', description: '保留同一角色，明确表达一个情绪或动作。',
    content: '为原创角色{{角色描述}}制作一张表达{{情绪或动作}}的表情图，采用{{风格}}。保持角色的配色、面部结构和标志性特征，情绪清楚，动作简洁，轮廓在小尺寸下仍清晰。仅生成这一个动作，不把多张表情挤在同一画面。背景干净，默认不添加文字；需要透明背景时配合工具的真实透明输出设置。不要套用已有知名表情角色。',
  },
  {
    id: 'builtin-image-transparent', builtin: true, updatedAt: '内置模板', category: 'image', mode: 'create', imagePreset: '透明 PNG',
    name: '透明素材 · 干净的独立元素', description: '主体完整，方便叠加到视频或其他画面。',
    content: '创作一个独立的{{主体描述}}元素，采用{{风格}}，用于{{用途}}。主体完整，周围及镂空处使用真实透明背景，不绘制白底、棋盘格或背景投影。不要添加文字、水印和未要求的物品，轮廓边缘干净，留适当透明边距。请配合图片工具的透明背景设置并输出PNG；仅写“透明”提示词不能代替真实Alpha通道，结果仍需检查边缘。',
  },
  {
    id: 'builtin-general-refine', builtin: true, updatedAt: '内置模板', category: 'general', mode: 'refine',
    name: '指定范围精修 · 保留其余内容', description: '先明确修改范围，再调整指定问题并留下变更说明。',
    content: '请只修改当前作品中的{{修改范围}}，重点解决{{修改目标}}。保留其他内容、事实、数字、人物或商品特征及未指定的版式。先说明计划调整哪些内容，再给出修改结果与简短变更清单。不确定或无法验证的地方单独标注，不编造已经完成的检查。修改应形成新版本，不覆盖原稿；实际调用模型才会形成新的使用费用。',
  },
];
