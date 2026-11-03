const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const rect = (x, y, w, h, fill, radius = 20, stroke = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const circle = (x, y, r, fill, stroke = 'none', width = 2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const line = (x1, y1, x2, y2, stroke = '#CBD6DD', width = 3) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
const text = (x, y, value, size = 30, fill = '#263D4C', anchor = 'start', weight = 600) => `<text x="${x}" y="${y}" font-family="Microsoft YaHei, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
const arrow = (x, y) => `${line(x, y, x + 56, y, '#91A8B7', 4)}<path d="M${x + 44} ${y - 10}L${x + 56} ${y}L${x + 44} ${y + 10}" fill="none" stroke="#91A8B7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
const placeholders = (x, y, width = 150) => [0, 1, 2].map(i => rect(x, y + i * 24, width - i * 20, 8, '#DCE5EB', 4)).join('');
const svg = (width, height, content, name) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(name)}"><title>${esc(name)}</title>${content}</svg>`;

function background(id, name, description, colors, variant = 0, portrait = false) {
  const [base, soft, ink] = colors, width = portrait ? 900 : 1600, height = portrait ? 1200 : 900;
  const decorations = [
    `${circle(width - 80, 90, 300, soft)}${circle(width - 170, 180, 180, 'none', ink, 1.4)}${line(width - 520, height - 100, width - 70, height - 100, ink, 2)}`,
    `<path d="M0 ${height - 180}Q${width / 3} ${height - 10} ${width} ${height - 280}L${width} ${height}H0Z" fill="${soft}"/>${[0, 1, 2].map(i => `<path d="M0 ${height - 110 + i * 25}Q${width / 2} ${height - 290 + i * 25} ${width} ${height - 100 + i * 25}" fill="none" stroke="${ink}" stroke-width="2" opacity=".5"/>`).join('')}`,
    `${rect(width - 390, 0, 260, height, soft, 0)}${line(70, 82, width - 70, 82, ink, 2)}${line(70, height - 80, width - 70, height - 80, ink, 2)}`,
    `${circle(width + 60, height + 50, 470, 'none', ink, 2)}${circle(width + 60, height + 50, 390, 'none', ink, 2)}${circle(width + 60, height + 50, 310, soft)}${[0, 1, 2, 3, 4].map(i => circle(width - 200 + i * 20, 90, 3, ink)).join('')}`,
    `${rect(width - 480, 180, 320, height - 80, soft, 160)}${circle(width - 320, 180, 90, 'none', ink, 2)}${line(75, height - 75, width - 75, height - 75, ink, 2)}`,
    `${rect(width - 260, 0, 260, height, soft, 0)}${rect(65, 90, 75, 10, ink, 5)}${line(65, height - 100, width - 320, height - 100, ink, 1.5)}`,
  ];
  return { id, name, description, collection: '留白背景', tags: [portrait ? '竖版' : '16:9', '背景', '封面', '留白'], width, height, transparent: false, content: svg(width, height, rect(0, 0, width, height, base, 0) + decorations[variant % decorations.length], name) };
}

function diagram(id, name, description, content, tags = []) {
  return { id, name, description, collection: '业务图解', tags: ['PPT', '方案', '图解', ...tags], width: 1400, height: 800, transparent: false, content: svg(1400, 800, rect(0, 0, 1400, 800, '#F8FAFC', 0) + content, name) };
}

function businessDiagrams() {
  const colors = ['#E8EEF9', '#E4F1F1', '#F7EEDC', '#EBE8F5'];
  return [
    diagram('diagram-four-step', '四步交付流程', '从目标到验收的四步通用流程，可用作项目方案中的流程配图。', ['明确目标', '制定方案', '执行跟进', '验收复盘'].map((label, i) => `${rect(80 + 330 * i, 260, 250, 280, '#FFF', 24, '#DFE6ED')}${rect(80 + 330 * i, 260, 250, 14, colors[i], 0)}${text(110 + 330 * i, 340, `0${i + 1}`, 48, '#608398')}${text(110 + 330 * i, 405, label, 30)}${placeholders(110 + 330 * i, 450, 170)}${i < 3 ? arrow(345 + 330 * i, 400) : ''}`).join(''), ['流程', '交付']),
    diagram('diagram-project-timeline', '项目里程碑时间线', '调研、策划、制作、交付四个阶段的非数据型时间线。', `${line(140, 405, 1260, 405, '#BFCFD9', 6)}${['调研', '策划', '制作', '交付'].map((label, i) => `${circle(170 + 350 * i, 405, 29, '#FFF', '#417A95', 5)}${circle(170 + 350 * i, 405, 10, '#417A95')}${text(170 + 350 * i, 320, label, 34, '#263D4C', 'middle')}${text(170 + 350 * i, 492, `阶段 0${i + 1}`, 22, '#627C8D', 'middle')}`).join('')}`, ['时间线', '里程碑']),
    diagram('diagram-before-after', '现状与目标对照', '左右分栏对比图，适合说明方案前后的方向，不包含虚构数据。', `${rect(110, 160, 520, 480, '#FFF', 24, '#DFE6ED')}${rect(770, 160, 520, 480, '#EDF5F3', 24, '#CBDDD6')}${text(155, 235, '现状', 38)}${text(815, 235, '目标', 38, '#2F6A58')}${[0, 1, 2].map(i => `${circle(160, 320 + i * 100, 8, '#9CAEB9')}${placeholders(190, 307 + i * 100, 335)}${circle(820, 320 + i * 100, 8, '#5A967F')}${placeholders(850, 307 + i * 100, 335)}`).join('')}${arrow(670, 400)}`, ['对比', '目标']),
    diagram('diagram-priority-matrix', '任务优先级四象限', '用于讨论任务优先级的四象限底图，没有具体业务结论或统计数值。', `${['重要 · 紧急', '重要 · 不紧急', '不重要 · 紧急', '不重要 · 不紧急'].map((label, i) => { const x = 120 + (i % 2) * 600, y = 115 + Math.floor(i / 2) * 300; return `${rect(x, y, 560, 260, colors[i], 20)}${text(x + 32, y + 62, label, 30)}${placeholders(x + 34, y + 104, 390)}`; }).join('')}`, ['四象限', '任务管理']),
    diagram('diagram-audience-funnel', '沟通路径漏斗', '触达、了解、行动三层沟通路径示意，不表示实际转化率。', `${['触达', '了解', '行动'].map((label, i) => `<path d="M${200 + i * 130} ${150 + i * 180}H${1200 - i * 130}L${1120 - i * 130} ${290 + i * 180}H${280 + i * 130}Z" fill="${colors[i]}"/>${text(700, 235 + i * 180, label, 38, '#365B70', 'middle')}`).join('')}`, ['沟通', '漏斗']),
    diagram('diagram-three-phase-roadmap', '三阶段推进路线', '准备、推进、复盘三阶段路线图，适合项目说明与执行计划。', `${line(140, 220, 1260, 220, '#AFC4D0', 5)}${['准备', '推进', '复盘'].map((label, i) => `${circle(220 + i * 480, 220, 45, '#FFF', '#4D7C92', 4)}${text(220 + i * 480, 232, String(i + 1), 32, '#426A80', 'middle')}${rect(80 + i * 480, 315, 340, 290, '#FFF', 22, '#DCE5EC')}${text(120 + i * 480, 380, label, 34)}${placeholders(120 + i * 480, 430, 240)}${rect(120 + i * 480, 540, 100, 12, colors[i], 6)}`).join('')}`, ['路线图', '阶段']),
    diagram('diagram-project-board', '任务看板底图', '待开始、进行中、已完成三栏任务看板，可配合正文填写项目状态。', `${['待开始', '进行中', '已完成'].map((label, i) => `${rect(90 + i * 440, 110, 380, 580, colors[i], 24)}${text(122 + i * 440, 177, label, 32)}${[0, 1, 2].map(row => `${rect(112 + i * 440, 215 + row * 140, 336, 115, '#FFF', 16)}${placeholders(138 + i * 440, 245 + row * 140, 250)}`).join('')}`).join('')}`, ['看板', '状态']),
    diagram('diagram-goal-map', '目标与四要素', '围绕核心目标组织用户、内容、渠道、指标四要素的通用结构图。', `${[0, 1, 2, 3].map(i => { const x = 140 + i % 2 * 860, y = 135 + Math.floor(i / 2) * 390; return `${line(700, 400, x + 130, y + 65, '#C4D3DC', 4)}${rect(x, y, 260, 130, colors[i], 24)}${text(x + 130, y + 78, ['用户', '内容', '渠道', '指标'][i], 34, '#365B70', 'middle')}`; }).join('')}${circle(700, 400, 130, '#FFF', '#5F899D', 4)}${text(700, 414, '核心目标', 34, '#365B70', 'middle')}`, ['目标', '结构']),
  ];
}

function accents() {
  const accent = (id, name, description, width, height, content, tags) => ({ id, name, description, width, height, transparent: true, collection: '透明装饰', tags: ['透明PNG', '装饰', ...tags], content: svg(width, height, content, name) });
  return [
    accent('accent-warm-dots', '暖色圆点阵列', '透明背景的暖色点阵，适合标题旁和留白角落的轻量装饰。', 720, 500, [0, 1, 2, 3, 4, 5].flatMap(x => [0, 1, 2, 3].map(y => circle(110 + x * 92, 110 + y * 92, 12 + (x + y) % 3 * 4, ['#C6A27B', '#D9C2A6', '#A7B2AA'][(x + y) % 3]))).join(''), ['点阵', '暖色']),
    accent('accent-leaf-corner', '青绿叶片角饰', '两片原创几何叶片与枝线，透明边缘，可用于自然风格封面。', 700, 700, `<path d="M105 600Q270 260 590 100" fill="none" stroke="#779A8C" stroke-width="9" stroke-linecap="round"/><path d="M210 425Q110 135 495 185Q425 445 210 425Z" fill="#BED2B4"/><path d="M316 316Q450 215 580 365Q545 535 316 316Z" fill="#7FA797"/><path d="M210 425Q280 300 495 185M316 316Q460 345 580 365" fill="none" stroke="#5F8978" stroke-width="5"/>`, ['植物', '自然']),
    accent('accent-loop-arrow', '回环指引箭头', '透明背景的弧线箭头，可作行动建议或流程强调，箭头不含文字。', 800, 500, `<path d="M95 370C130 190 370 90 520 170C660 245 610 380 500 330C370 270 520 120 700 150" fill="none" stroke="#58879E" stroke-width="14" stroke-linecap="round"/><path d="M640 95L708 150L645 214" fill="none" stroke="#58879E" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`, ['箭头', '流程']),
    accent('accent-stacked-frames', '叠层圆角边框', '透明背景的叠层边框，可用于照片边饰和版式分区。', 800, 600, `${rect(175, 90, 500, 360, 'none', 36, '#A7BBD0')}${rect(110, 150, 500, 360, 'none', 36, '#527D95')}${circle(650, 450, 36, '#D2E0E8')}${circle(150, 120, 18, '#C5B9D9')}`, ['边框', '叠层']),
  ];
}

export function originalStarterGraphics() {
  return [
    background('background-iris-orbit', '鸢尾留白封面', '浅紫轨道与大面积留白，适合品牌提案和介绍页。', ['#FAF9FD', '#ECE7F8', '#B9A7D7']),
    background('background-sky-stream', '晴空流线背景', '蓝白流线落在底部，正文区域保持干净。', ['#FAFDFF', '#E5F1F7', '#A8C3D5'], 1),
    background('background-oat-editorial', '燕麦分栏背景', '温和米色分栏，适合项目说明、作品集与封面。', ['#FBF9F3', '#EEE6D6', '#B9AA90'], 2),
    background('background-night-signal', '曜夜弧线背景', '深色弧线封面，适合搭配浅色标题制作夜间演示。', ['#080C12', '#12293A', '#3B7799'], 3),
    background('background-forest-arch', '青禾拱形背景', '浅绿拱形构图，适合生活方式、自然主题与产品介绍。', ['#F6F8F2', '#E0E8D7', '#9EB399'], 4),
    background('background-graphite-columns', '石墨简报背景', '黑白灰留白版式，适合正式简报与商务目录。', ['#FFFFFF', '#EFF1F3', '#45525D'], 5),
    background('background-portrait-iris', '鸢尾竖版底图', '竖版浅紫留白，适合作为宣传长图或文档封面配图。', ['#FAF9FD', '#ECE7F8', '#B9A7D7'], 0, true),
    background('background-portrait-sky', '晴空竖版底图', '竖版蓝白流线，适合简洁宣传页与资料封面。', ['#FAFDFF', '#E5F1F7', '#A8C3D5'], 1, true),
    ...businessDiagrams(), ...accents(),
  ];
}
