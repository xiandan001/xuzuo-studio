const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const MAX_PIXELS = 16000000;
const TARGET_KEYS = new Set(['width', 'height', 'fit', 'deviceId', 'label']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function ensureActive(input) { if (input.signal?.aborted) throw Object.assign(new Error('壁纸适配已取消，原图与费用保留。'), { name: 'AbortError' }); }

function wallpaperTargetError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !TARGET_KEYS.has(key))) return '请重新选择有效的壁纸设备或像素尺寸。';
  if (![value.width, value.height].every(side => Number.isInteger(side) && side >= 64 && side <= 8192) || value.width * value.height > MAX_PIXELS) return '壁纸每边需要64–8192整数像素，合计不超过1600万像素。';
  if (!['cover', 'contain'].includes(value.fit)) return '请选择填满屏幕或完整保留图片，壁纸不会拉伸变形。';
  if (value.deviceId !== undefined && !validId(value.deviceId)) return '壁纸设备编号无效，请重新选择。';
  if (value.label !== undefined && (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160 || /[\x00-\x1f\x7f]/.test(value.label))) return '壁纸设备名称无效，请重新选择。';
  return undefined;
}
function checkedSource(file, input) {
  if (!file || file.projectId !== input.projectId || file.runId !== input.runId || file.kind !== 'image' || file.mimeType !== 'image/png' || file.trashedAt || file.unavailable) throw Error('壁纸来源必须是本项目、本次制作实际生成的PNG，不能使用参考图或其他项目文件。');
  if (!Buffer.isBuffer(file.buffer) || !file.buffer.length || file.buffer.length > 32 * 1024 * 1024) throw Error('壁纸原图为空或超过32MB，请保留原图并重新选择。');
  const dimensions = rasterDimensions(file.buffer);
  if (imageType(file.buffer).mimeType !== 'image/png' || !dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > MAX_PIXELS) throw Error('壁纸原图格式或像素尺寸无效，原文件与已发生费用保留。');
  return file;
}
function createWallpaperExporter({ writeArtifact, readArtifact, fitWallpaper }) {
  return async input => {
    const issue = wallpaperTargetError(input?.wallpaperTarget);
    if (issue) throw Error(issue);
    if (input.kind !== 'image' || !validId(input.projectId) || !validId(input.runId)) throw Error('壁纸适配仅用于当前图片项目的本地导出步骤。');
    if (typeof fitWallpaper !== 'function') throw Error('当前环境不支持本地壁纸适配，请使用新版桌面应用；原图和费用保留。');
    ensureActive(input);
    const assets = input.assets;
    if (!Array.isArray(assets) || !assets.length || assets.length > 20) throw Error('壁纸导出需要1–20张实际生成的PNG原图。');
    const ids = assets.map(asset => typeof asset === 'string' ? asset : asset?.id);
    if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw Error('壁纸来源编号无效或重复，未将同一张原图重复制作。');
    // Validate every source before writing; do not retain all full-size buffers at once.
    for (const id of ids) { ensureActive(input); checkedSource(await readArtifact(id), input); }
    const artifacts = [], target = { ...input.wallpaperTarget };
    try {
      for (const [index, id] of ids.entries()) {
        ensureActive(input);
        const source = checkedSource(await readArtifact(id), input);
        ensureActive(input);
        const result = await fitWallpaper({ buffer: source.buffer, target }, { signal: input.signal });
        ensureActive(input);
        if (!(result instanceof Uint8Array) || !result.length || result.length > 100 * 1024 * 1024) throw Error('本地适配没有返回有效PNG，原图与费用保留。');
        const buffer = Buffer.from(result), dimensions = rasterDimensions(buffer);
        if (imageType(buffer).mimeType !== 'image/png' || dimensions.width !== target.width || dimensions.height !== target.height) throw Error('壁纸实际像素与所选设备不一致，未作为成品交付。');
        artifacts.push(await writeArtifact({ projectId: input.projectId, runId: input.runId, name: `${input.title || '设备'}-${target.width}x${target.height}-壁纸-${index + 1}.png`, mimeType: 'image/png', buffer }));
      }
      return artifacts;
    } catch (error) { error.artifacts = artifacts; throw error; }
  };
}
module.exports = { wallpaperTargetError, createWallpaperExporter };
