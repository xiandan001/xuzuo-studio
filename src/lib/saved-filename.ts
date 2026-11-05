const stampSuffix = /_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?$/;
let lastStamp = '', sequence = 0;
function filenameParts(filename: string) {
  const basename = filename.replaceAll('\\', '/').split('/').at(-1) || '未命名';
  const dot = basename.lastIndexOf('.');
  return { stem: dot > 0 ? basename.slice(0, dot) : basename, extension: dot > 0 ? basename.slice(dot) : '' };
}
export function stripSavedTimestamp(filename: string): string {
  const { stem, extension } = filenameParts(filename);
  return stem.replace(stampSuffix, '') + extension;
}
export function timestampedFilename(filename: string, date = new Date()): string {
  const { stem, extension } = filenameParts(filename);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  sequence = stamp === lastStamp ? sequence + 1 : 0; lastStamp = stamp;
  const title = stem.replace(stampSuffix, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[.\s]+$/g, '') || '未命名';
  return `${title}_${stamp}${sequence ? `-${sequence}` : ''}${extension}`;
}
