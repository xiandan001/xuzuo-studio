const path = require('node:path');
const savedSuffix = /_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?$/;
const pad = (value, width = 2) => String(value).padStart(width, '0');
function localTimestamp(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}
function stripSavedTimestamp(value) {
  if (typeof value !== 'string') return value;
  const extension = path.extname(value), stem = extension ? value.slice(0, -extension.length) : value;
  return stem.replace(savedSuffix, '') + extension;
}
function safeParts(value) {
  let name = path.win32.basename(String(value || '未命名文件').replaceAll('/', '\\')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/g, '') || '未命名文件';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '文件-' + name;
  const extension = path.extname(name), stem = extension ? name.slice(0, -extension.length) : name;
  return { stem: stem.replace(savedSuffix, '') || '未命名文件', extension };
}
function createSavedFilename(clock = () => new Date()) {
  let previous = '', sequence = 0;
  return value => {
    const { stem, extension } = safeParts(value), stamp = localTimestamp(clock());
    sequence = stamp === previous ? sequence + 1 : 0; previous = stamp;
    const suffix = `_${stamp}${sequence ? '-' + sequence : ''}`, limit = Math.max(1, 255 - suffix.length - extension.length);
    let shortened = ''; for (const character of stem) { if (shortened.length + character.length > limit) break; shortened += character; }
    return shortened + suffix + extension;
  };
}
const timestampedFilename = createSavedFilename();
function timestampedDefaultPath(value) {
  const source = typeof value === 'string' && value ? value : '未命名文件.txt';
  const platform = /^[A-Za-z]:[\\/]|^\\\\/.test(source) ? path.win32 : path;
  const directory = platform.dirname(source), name = timestampedFilename(platform.basename(source));
  return directory === '.' ? name : platform.join(directory, name);
}
module.exports = { createSavedFilename, timestampedFilename, timestampedDefaultPath, stripSavedTimestamp, localTimestamp };
