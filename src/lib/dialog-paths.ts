export interface DialogCrumb { name: string; path: string; }
const windowsPath = (value: string) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
export function dialogPathsEqual(left: string, right: string): boolean {
  if (windowsPath(left) !== windowsPath(right)) return false;
  const normalize = windowsPath(left)
    ? (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
    : (value: string) => value.replace(/\/+$/, '') || '/';
  return normalize(left) === normalize(right);
}
export function dialogBasename(value: string): string {
  return value.split(windowsPath(value) ? /[\\/]/ : /\//).filter(Boolean).at(-1) || '';
}
export function dialogBreadcrumbs(value: string): DialogCrumb[] {
  const windows = windowsPath(value), separator = windows && value.includes('\\') ? '\\' : '/';
  const drive = value.match(/^[A-Za-z]:[\\/]/), share = value.match(/^\\\\[^\\]+\\[^\\]+/);
  const root = drive ? drive[0] : share ? `${share[0]}\\` : value.startsWith('/') ? '/' : '';
  if (!root) return value ? [{ name: value, path: value }] : [];
  let path = root; const result = [{ name: root, path: root }];
  for (const name of value.slice(root.length).split(windows ? /[\\/]+/ : /\/+/).filter(Boolean)) { path = path.replace(windows ? /[\\/]+$/ : /\/+$/, '') + separator + name; result.push({ name, path }); }
  return result;
}
export function joinDialogPath(directory: string, name: string): string {
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(name)) return name;
  const windows = windowsPath(directory);
  return directory.replace(windows ? /[\\/]+$/ : /\/+$/, '') + (windows && directory.includes('\\') ? '\\' : '/') + name;
}
export function canCreateOriginalFolder(directory: string, original?: string): boolean {
  if (!original) return true;
  const crumbs = dialogBreadcrumbs(original), parent = crumbs.at(-2)?.path;
  return !!parent && dialogPathsEqual(parent, directory);
}
export function isWorkspaceRootTarget(target: string, root?: string): boolean {
  return !!root && dialogPathsEqual(target, root);
}
export function dialogFileSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function dialogError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，请重试。';
}
