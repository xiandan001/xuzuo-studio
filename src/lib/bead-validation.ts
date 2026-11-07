import type { BeadDocument, BeadPalette, BeadPattern, BeadProcurement, BeadSettings } from '../bead-types';

export const DEFAULT_BEAD_SETTINGS: BeadSettings = { columns: 64, rows: 64, fit: 'contain', maxColors: 32, alphaThreshold: 128, boardColumns: 52, boardRows: 52 };
export const DEFAULT_BEAD_PROCUREMENT: BeadProcurement = { copies: 1, lossPercent: 5, defaultPackSize: 1000, stock: {}, packSizes: {} };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown, maximum: number, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,11}$/;
const idPattern = /^[A-Za-z0-9-]{1,120}$/;

export function beadSettingsIssue(value: unknown): string | undefined {
  if (!object(value)) return '请填写拼豆格数和制图设置。';
  const settings = value as unknown as BeadSettings;
  if (!integer(settings.columns, 8, 256) || !integer(settings.rows, 8, 256)) return '列数和行数都请输入 8–256 的整数。';
  if (!['cover', 'contain'].includes(settings.fit)) return '请选择完整保留或铺满裁切。';
  if (!integer(settings.maxColors, 0, 512)) return '最多用色请输入 1–512 的整数，0 表示使用整套色卡。';
  if (!integer(settings.alphaThreshold, 0, 255)) return '透明阈值请输入 0–255 的整数。';
  if (!integer(settings.boardColumns, 1, 256) || !integer(settings.boardRows, 1, 256)) return '底板列数和行数都请输入 1–256 的整数。';
}

export function beadPaletteIssue(value: unknown): string | undefined {
  if (!object(value)) return '请选择有效的拼豆色卡。';
  const palette = value as unknown as BeadPalette;
  if (typeof palette.id !== 'string' || !idPattern.test(palette.id) || !text(palette.name, 120) || !text(palette.brand, 120) || !text(palette.version, 160)) return '色卡名称、品牌、版本或编号无效。';
  if (!text(palette.sourceUrl, 1000, true) || palette.sourceUrl && !/^https:\/\/[^\s]+$/.test(palette.sourceUrl) || !text(palette.sourceNote, 4000, true) || !text(palette.license, 8000)) return '色卡来源和许可信息无效，请重新导入。';
  if (!Array.isArray(palette.colors) || !palette.colors.length || palette.colors.length > 512) return '色卡需要包含 1–512 个颜色。';
  const codes = new Set<string>(); let automatic = 0;
  for (const color of palette.colors) {
    if (!object(color) || typeof color.code !== 'string' || !codePattern.test(color.code) || codes.has(color.code) || !text(color.name, 80) || typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.hex)) return '色号需唯一且为 1–12 位大写字母、数字或横线；颜色名称和六位 Hex 需有效。';
    codes.add(color.code);
    if (!Array.isArray(color.rgb) || color.rgb.length !== 3) return `色号 ${color.code} 的 RGB 与 Hex 不一致。`;
    for (let index = 0; index < 3; index++) if (!integer(color.rgb[index], 0, 255) || color.rgb[index] !== parseInt(color.hex.slice(1 + index * 2, 3 + index * 2), 16)) return `色号 ${color.code} 的 RGB 与 Hex 不一致。`;
    if (!['solid', 'transparent', 'special'].includes(color.kind) || typeof color.automatic !== 'boolean' || color.kind !== 'solid' && color.automatic) return `色号 ${color.code} 的材质或自动匹配设置无效。`;
    if (color.kind === 'solid' && color.automatic) automatic++;
  }
  if (!automatic) return '色卡至少需要一种可自动匹配的普通实心色。';
}

export function beadPatternIssue(value: unknown): string | undefined {
  if (!object(value)) return '拼豆图纸内容无效。';
  const pattern = value as unknown as BeadPattern;
  if (pattern.type !== 'xuzuo-bead-pattern' || pattern.version !== 1 || !integer(pattern.columns, 8, 256) || !integer(pattern.rows, 8, 256)) return '图纸版本或格数无效。';
  const paletteIssue = beadPaletteIssue(pattern.palette); if (paletteIssue) return paletteIssue;
  if (!Array.isArray(pattern.cells) || pattern.cells.length !== pattern.columns * pattern.rows) return '图纸格子数量或色号索引无效，原文件保留。';
  for (const cell of pattern.cells) if (!integer(cell, 0, pattern.palette.colors.length)) return '图纸格子数量或色号索引无效，原文件保留。';
}

export function beadProcurementIssue(value: unknown): string | undefined {
  if (!object(value)) return '请填写有效的用量与采购设置。';
  const settings = value as unknown as BeadProcurement;
  if (!integer(settings.copies, 1, 10000)) return '制作份数请输入 1–10000 的整数。';
  if (!Number.isFinite(settings.lossPercent) || settings.lossPercent < 0 || settings.lossPercent > 100 || Math.abs(Math.round(settings.lossPercent * 100) / 100 - settings.lossPercent) > 1e-9) return '预留损耗请输入 0–100%，最多两位小数。';
  if (!integer(settings.defaultPackSize, 1, 10000000)) return '每包数量请输入 1–10000000 的整数。';
  for (const [name, map] of [['库存', settings.stock], ['每色包装量', settings.packSizes]] as const) {
    if (!object(map) || Object.keys(map).length > 512) return `${name}记录无效。`;
    for (const [code, count] of Object.entries(map)) if (!codePattern.test(code) || !integer(count, name === '库存' ? 0 : 1, name === '库存' ? 1000000000 : 10000000)) return `${name}中的 ${code} 需要有效的整数数量。`;
  }
}

export function beadDocumentIssue(value: unknown): string | undefined {
  if (!object(value)) return '拼豆工程内容无效。';
  const document = value as unknown as BeadDocument;
  if (document.type !== 'xuzuo-bead-document' || document.version !== 1 || typeof document.id !== 'string' || !idPattern.test(document.id) || typeof document.projectId !== 'string' || !idPattern.test(document.projectId) || !integer(document.revision, 0, Number.MAX_SAFE_INTEGER) || !text(document.title, 120)) return '拼豆工程版本、名称或保存编号无效。';
  if (document.referenceId !== undefined && (typeof document.referenceId !== 'string' || !idPattern.test(document.referenceId)) || document.sourceSha256 !== undefined && (typeof document.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(document.sourceSha256)) || !text(document.updatedAt, 60) || !Number.isFinite(Date.parse(document.updatedAt))) return '拼豆工程的底图来源或时间无效。';
  const issue = beadSettingsIssue(document.settings) || beadPatternIssue(document.pattern) || beadProcurementIssue(document.procurement); if (issue) return issue;
  if (document.settings.columns !== document.pattern.columns || document.settings.rows !== document.pattern.rows) return '制图设置与实际网格大小不一致。';
}
