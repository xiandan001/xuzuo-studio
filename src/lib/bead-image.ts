import type { BeadSettings } from '../bead-types';
export const BEAD_PREPARATION_PROMPT = [
  '以第1张参考图为主底图，为后续拼豆制图整理画面，其他参考图仅辅助理解，不默认拼成新构图。保留源图的主要主体、识别特征和用户明确指定的细节，不编造新的主体。',
  '形成清晰、连续且易辨认的轮廓，将细碎纹理、噪声、复杂阴影和近色渐变简化为适合拼豆的大色块；减少无必要的孤立杂点和毛边，同时保留主体之间的分界与层次。原图已有透明区域时保留其用途，不擅自增加装饰背景。',
  '这一步只输出便于制图的底图，不得绘制网格、格线、色号、坐标、图例、用量、采购清单或说明文字，不绘制软件界面。色卡匹配、逐格色号、用量和采购统计由后续本地算法负责，不由图像模型估算或编写。',
  '用户补充的主题、风格和保留要求用于调整底图表现；没有额外描述时，就按参考图本身整理，不另起主题。',
].join('\n');

function ratio(columns: number, rows: number): string {
  let a = columns, b = rows;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return `${columns / a}:${rows / a}`;
}

export function beadPreparationPrompt(settings: Pick<BeadSettings, 'columns' | 'rows'>, instruction?: string): string {
  if (!Number.isInteger(settings.columns) || !Number.isInteger(settings.rows) || settings.columns < 8 || settings.columns > 256 || settings.rows < 8 || settings.rows > 256) throw Error('列数和行数都请输入 8–256 的整数。');
  const request = instruction?.trim();
  return `${BEAD_PREPARATION_PROMPT}\n\n目标拼豆网格为 ${settings.columns} 列 × ${settings.rows} 行，画面宽高比例为 ${ratio(settings.columns, settings.rows)}。这里的列行是拼豆格数，不是要求模型直接输出的像素大小。按该比例组织主体与留白。${request ? `\n\n【本次补充要求】\n${request}` : ''}`;
}
