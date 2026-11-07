import type { WallpaperTarget } from '../wallpaper-types';
import { WALLPAPER_DEVICES } from '../data/wallpaper-devices';
import type { WallpaperDevice } from '../data/wallpaper-devices';
import { isModernImage } from './image-output-options';

export type WallpaperParseResult = { status: 'resolved'; target: WallpaperTarget; device?: WallpaperDevice } | { status: 'ambiguous'; candidates: WallpaperDevice[]; message: string } | { status: 'invalid' | 'unknown'; message: string };
const MAX_PIXELS = 16_000_000;
const deviceById = new Map(WALLPAPER_DEVICES.map(device => [device.id, device]));
const targetKeys = new Set(['width', 'height', 'fit', 'deviceId', 'label']);

export function wallpaperTargetIssue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '请先选择机型，或输入壁纸的宽×高像素。';
  if (Object.keys(value).some(key => !targetKeys.has(key))) return '壁纸尺寸设置包含无法识别的内容，请重新选择。';
  const target = value as WallpaperTarget;
  if (!Object.hasOwn(value, 'width') || !Object.hasOwn(value, 'height') || !Number.isInteger(target.width) || !Number.isInteger(target.height) || target.width < 64 || target.height < 64 || target.width > 8192 || target.height > 8192) return '宽和高都请输入 64–8192 的整数像素。';
  if (target.width * target.height > MAX_PIXELS) return '壁纸总像素不能超过 1600 万，请缩小宽或高。';
  if (!Object.hasOwn(value, 'fit') || !['cover', 'contain'].includes(target.fit)) return '请选择填满画面或完整保留，不支持拉伸壁纸。';
  if (target.label !== undefined && (typeof target.label !== 'string' || !target.label.trim() || target.label.length > 160 || /[\u0000-\u001f\u007f]/.test(target.label))) return '壁纸名称无效，请重新选择设备或输入像素。';
  if (target.deviceId !== undefined) {
    if (typeof target.deviceId !== 'string') return '机型信息无效，请重新选择。';
    const device = deviceById.get(target.deviceId);
    if (!device || !(target.width === device.width && target.height === device.height || target.width === device.height && target.height === device.width)) return '尺寸与所选机型不一致，请重新选择机型，或改为自定义像素。';
  }
}

export function readWallpaperTarget(value: unknown): WallpaperTarget | undefined {
  if (wallpaperTargetIssue(value)) return;
  const target = value as WallpaperTarget;
  return { width: target.width, height: target.height, fit: target.fit, ...(target.deviceId ? { deviceId: target.deviceId } : {}), ...(target.label ? { label: target.label.trim() } : {}) };
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\+/g, 'plus').replace(/英寸/g, ' ').replace(/[^a-z0-9\u3400-\u9fff.]/g, ' ');
const compact = (text: string) => normalize(text).replace(/\s+/g, '');
const deviceIndex = WALLPAPER_DEVICES.map(device => ({ device, aliases: [...new Set(device.aliases.map(compact))] }));
const usefulQuery = (query: string) => query.replace(/(?:帮我|给我|我想要?|请|生成|制作|一张|适合|我的|手机|壁纸|的)/g, ' ').replace(/\b(?:wallpaper|for|please|make|create|my|phone)\b/gi, ' ').trim();

export function searchWallpaperDevices(query: string): WallpaperDevice[] {
  if (typeof query !== 'string' || query.length > 4096) return [];
  const key = compact(usefulQuery(query));
  return deviceIndex.filter(item => !key || item.aliases.some(alias => alias.includes(key))).map(item => item.device);
}

interface DeviceMatch { start: number; end: number; device: WallpaperDevice; }
function namedDevices(text: string): WallpaperDevice[] {
  const source = normalize(text), positions: number[] = [];
  let key = '';
  for (let index = 0; index < source.length; index++) if (!/\s/.test(source[index])) { key += source[index]; positions.push(index); }
  const matches: DeviceMatch[] = [];
  for (const { device, aliases } of deviceIndex) for (const alias of aliases) {
    let start = key.indexOf(alias);
    while (start !== -1) {
      const end = start + alias.length, left = source[positions[start] - 1] || '', right = source[positions[end - 1] + 1] || '';
      const tail = source.slice(positions[end - 1] + 1);
      if (!/[a-z0-9]/.test(left) && !/[a-z0-9]/.test(right) && !/^\s*(?:pro|max|ultra|plus|mini|air|fe|se|lite)(?=\s|$|[\u3400-\u9fff])/i.test(tail)) matches.push({ start, end, device });
      start = key.indexOf(alias, start + 1);
    }
  }
  const specific = matches.filter(match => !matches.some(other => other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start));
  const ids = new Set(specific.map(match => match.device.id));
  return WALLPAPER_DEVICES.filter(device => ids.has(device.id));
}

function ipadCandidates(text: string): WallpaperDevice[] {
  const value = normalize(text), family = value.match(/ipad\s*(pro|air|mini)?\s*(\d+(?:\.\d+)?)?/);
  if (!family || /(?:^|[^a-z])(?:m\d+|a\d+)/.test(value)) return [];
  const prefix = compact(`iPad ${family[1] || ''}${family[2] || ''}`);
  return deviceIndex.filter(item => item.device.category === 'tablet' && item.aliases.some(alias => alias.startsWith(prefix))).map(item => item.device);
}

function screenCandidates(devices: WallpaperDevice[], text: string): WallpaperDevice[] {
  if (!devices.some(device => device.category === 'foldable')) return devices;
  const inner = /内屏|主屏|内外屏|\binner\b/i.test(text), cover = /外屏|副屏|\bcover\b/i.test(text);
  if (inner === cover) return devices;
  return devices.filter(device => device.category !== 'foldable' || device.screen === (inner ? 'inner' : 'cover'));
}

interface PixelPair { width: number; height: number; integer: boolean; physical: boolean; }
function pixelPairs(text: string): PixelPair[] {
  const number = '([+-]?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)';
  const patterns = [new RegExp(`${number}\\s*(?:[x×*]|乘以?|\\bby\\b)\\s*${number}`, 'gi'), new RegExp(`(?:宽(?:度)?|width)\\s*(?:为|是|[:：=])?\\s*${number}\\s*(?:像素|px)?\\s*[,，、;；]?\\s*(?:高(?:度)?|height)\\s*(?:为|是|[:：=])?\\s*${number}`, 'gi')];
  const pairs = patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ width: Number(match[1]), height: Number(match[2]), integer: /^\d+$/.test(match[1]) && /^\d+$/.test(match[2]), physical: /^\s*(?:毫米|英寸|mm\b|inches?\b)/i.test(text.slice((match.index || 0) + match[0].length)) })));
  return [...new Map(pairs.map(pair => [`${pair.width}x${pair.height}:${pair.integer}:${pair.physical}`, pair])).values()];
}

function orientation(text: string): 'landscape' | 'portrait' | undefined {
  if (/横屏|横向|\blandscape\b/i.test(text)) return 'landscape';
  if (/竖屏|纵向|\bportrait\b/i.test(text)) return 'portrait';
}
const fitFromText = (text: string): WallpaperTarget['fit'] => /留边|不(?:要)?裁[剪切]|完整保留(?:画面|图片|图像)/.test(text.replace(/不(?:要)?留边/g, '')) ? 'contain' : 'cover';
function orientTarget(target: WallpaperTarget, text: string): WallpaperTarget {
  const direction = orientation(text);
  return direction === 'landscape' && target.width < target.height || direction === 'portrait' && target.width > target.height ? { ...target, width: target.height, height: target.width } : target;
}
function deviceTarget(device: WallpaperDevice, text: string): WallpaperTarget { return orientTarget({ width: device.width, height: device.height, fit: fitFromText(text), deviceId: device.id, label: device.name }, text); }
function ambiguous(candidates: WallpaperDevice[], message = '找到多个匹配，请选择具体机型或屏幕。'): WallpaperParseResult { return { status: 'ambiguous', candidates, message }; }

export function parseWallpaperTarget(text: string): WallpaperParseResult {
  if (typeof text !== 'string' || !text.trim()) return { status: 'unknown', message: '输入机型或像素即可，例如 iPhone 18 Pro、1170×2532。' };
  if (text.length > 4096) return { status: 'invalid', message: '描述过长，请只填写机型名称或宽×高像素。' };
  if (/横屏|横向|\blandscape\b/i.test(text) && /竖屏|纵向|\bportrait\b/i.test(text)) return { status: 'invalid', message: '同时出现横屏和竖屏，请只保留本次需要的一个方向。' };
  const input = text.normalize('NFKC'), pairs = pixelPairs(input), devices = screenCandidates(namedDevices(input), input);
  if (!pairs.length && /\b(?:4k|uhd)\b/i.test(input)) {
    const direction = orientation(input);
    if (!direction) return { status: 'unknown', message: '4K请选择竖屏 2160×3840 或横屏 3840×2160，也可直接输入像素尺寸。' };
    return { status: 'resolved', target: { width: direction === 'portrait' ? 2160 : 3840, height: direction === 'portrait' ? 3840 : 2160, fit: fitFromText(input), label: direction === 'portrait' ? '4K竖屏' : '4K横屏' } };
  }
  if (pairs.length > 1) return { status: 'invalid', message: '发现多组像素尺寸，请只保留本次壁纸的宽×高。' };
  if (pairs.length) {
    const pair = pairs[0];
    if (pair.physical) return { status: 'unknown', message: '毫米或英寸是物理尺寸，请选择机型或输入屏幕像素分辨率。' };
    const selected = orientTarget({ width: pair.width, height: pair.height, fit: fitFromText(input) }, input), target = { ...selected, label: `自定义 ${selected.width}×${selected.height}` };
    const issue = pair.integer ? wallpaperTargetIssue(target) : '像素尺寸请输入整数，不支持小数、负数或科学记数法。';
    if (issue) return { status: 'invalid', message: issue };
    const device = devices.length === 1 ? devices[0] : undefined;
    if (device && (device.width === target.width && device.height === target.height || device.height === target.width && device.width === target.height)) return { status: 'resolved', device, target: { ...target, deviceId: device.id, label: device.name } };
    return { status: 'resolved', target };
  }
  if (devices.length > 1) return ambiguous(devices);
  if (devices.length === 1) return { status: 'resolved', device: devices[0], target: deviceTarget(devices[0], input) };
  const ipads = ipadCandidates(input);
  if (ipads.length) return ambiguous(ipads, 'iPad 的代际可能影响尺寸，请选择具体型号。');
  if (/^(?:iphone|苹果(?:手机)?|三星|华为|小米|oppo|vivo|荣耀)$/i.test(usefulQuery(input).trim())) return ambiguous(searchWallpaperDevices(input));
  return { status: 'unknown', message: /英寸|毫米|\b(?:inch|inches|mm)\b|\b[248]k\b/i.test(input) ? '英寸、机身尺寸或 2K 等级不能确定像素，请选择机型或输入宽×高像素。' : '未找到明确机型，请从列表选择，或输入自定义像素，例如 1170×2532。' };
}

export function wallpaperPrompt(target: WallpaperTarget): string {
  const issue = wallpaperTargetIssue(target); if (issue) throw Error(issue);
  return `创作完整的原创设备壁纸，最终成品尺寸为 ${target.width} × ${target.height} 像素，按该长宽比安排构图。主体与关键细节集中在画面中部，顶部为系统时钟留出适量干净空间；不要绘制手机边框、设备样机、时间、应用图标、系统界面、品牌商标或水印。${target.fit === 'contain' ? '完整保留主体和画面边缘，不通过拉伸改变主体比例。' : '画面边缘可以适当裁切，重要主体不要贴边。'}主题、色彩与风格按用户本次要求创作。`;
}

export function wallpaperGenerationSize(target: WallpaperTarget, modelId?: string): `${number}x${number}` {
  const issue = wallpaperTargetIssue(target); if (issue) throw Error(issue);
  if (isModernImage(modelId)) {
    const ratio = Math.min(3, Math.max(1 / 3, target.width / target.height)), area = Math.min(3_686_400, Math.max(1_048_576, target.width * target.height));
    let width = Math.min(3840, Math.floor(Math.sqrt(area * ratio) / 16) * 16), height = Math.min(3840, Math.floor(Math.sqrt(area / ratio) / 16) * 16);
    while (width > height * 3) width -= 16;
    while (height > width * 3) height -= 16;
    return `${width}x${height}`;
  }
  if (modelId && !/^gpt-image-1(?:\.5)?(?:-mini)?$/.test(modelId)) return '1024x1024';
  return target.width === target.height ? '1024x1024' : target.width > target.height ? '1536x1024' : '1024x1536';
}
