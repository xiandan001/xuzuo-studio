import type { BeadColor, BeadPalette } from '../bead-types';
import { beadPaletteIssue } from './bead-pattern';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function field(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw Error(`${label}请填写文字。`);
  return value.trim();
}
function rgbValue(value: unknown, code: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) throw Error(`色号 ${code} 的 RGB 需要三个 0–255 的整数。`);
  return [value[0], value[1], value[2]];
}

function readColor(value: unknown, index: number): BeadColor {
  if (!object(value)) throw Error(`第 ${index + 1} 个颜色需要色号和颜色数据。`);
  const rawCode = field(value.code, '', '色号');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/.test(rawCode)) throw Error(`第 ${index + 1} 个色号需为 1–12 位字母、数字或横线。`);
  const code = rawCode.toUpperCase();
  if (value.hex !== undefined && (typeof value.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.hex))) throw Error(`色号 ${code} 需要有效的六位 Hex，例如 #FF0000。`);
  if (value.hex === undefined && value.rgb === undefined) throw Error(`色号 ${code} 缺少六位 Hex 或 RGB。`);
  const hex = typeof value.hex === 'string' ? value.hex.toUpperCase() : undefined;
  const rgb = value.rgb !== undefined ? rgbValue(value.rgb, code) : [1, 3, 5].map(offset => parseInt(hex!.slice(offset, offset + 2), 16)) as [number, number, number];
  const kind = value.kind === undefined ? 'solid' : value.kind;
  if (!['solid', 'transparent', 'special'].includes(kind as string)) throw Error(`色号 ${code} 的材质请选择 solid、transparent 或 special。`);
  if (value.automatic !== undefined && typeof value.automatic !== 'boolean') throw Error(`色号 ${code} 的自动配色设置需要 true 或 false。`);
  return { code, name: field(value.name, code, '颜色名称'), hex: hex || '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase(), rgb, kind: kind as BeadColor['kind'], automatic: kind === 'solid' && value.automatic !== false };
}

export function parseBeadPalette(text: string): BeadPalette {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw Error('色卡文件不能超过 1MB。');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw Error('请导入有效的 JSON 色卡文件。'); }
  if (!object(input) || !Array.isArray(input.colors) || !input.colors.length || input.colors.length > 512) throw Error('JSON 色卡对象需要包含 1–512 个 colors 颜色。');
  const palette: BeadPalette = {
    id: `custom-${crypto.randomUUID()}`,
    name: field(input.name, '自定义色卡', '色卡名称'), brand: field(input.brand, '自定义', '品牌'), version: field(input.version, '用户导入-v1', '版本'),
    sourceUrl: field(input.sourceUrl, '', '来源网址'), sourceNote: field(input.sourceNote, '用户导入色卡，保留原始色号；透明和特殊材质不参与自动配色。', '来源说明'), license: field(input.license, '用户提供', '许可说明'),
    colors: input.colors.map(readColor),
  };
  const issue = beadPaletteIssue(palette); if (issue) throw Error(issue);
  return palette;
}
