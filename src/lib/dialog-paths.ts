export interface DialogCrumb { name: string; path: string; }
export function dialogBreadcrumbs(value: string): DialogCrumb[] {
  const separator = value.includes('\\') ? '\\' : '/';
  const drive = value.match(/^[A-Za-z]:[\\/]/), share = value.match(/^\\\\[^\\]+\\[^\\]+/);
  const root = drive ? drive[0] : share ? `${share[0]}\\` : value.startsWith('/') ? '/' : '';
  if (!root) return value ? [{ name: value, path: value }] : [];
  let path = root; const result = [{ name: root, path: root }];
  for (const name of value.slice(root.length).split(/[\\/]+/).filter(Boolean)) { path = path.replace(/[\\/]+$/, '') + separator + name; result.push({ name, path }); }
  return result;
}
export function joinDialogPath(directory: string, name: string): string {
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(name)) return name;
  return directory.replace(/[\\/]+$/, '') + (directory.includes('\\') ? '\\' : '/') + name;
}
export function canCreateOriginalFolder(directory: string, original?: string): boolean {
  if (!original) return true;
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const crumbs = dialogBreadcrumbs(original), parent = crumbs.at(-2)?.path;
  return !!parent && normalize(parent) === normalize(directory);
}
export function isWorkspaceRootTarget(target: string, root?: string): boolean {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return !!root && normalize(target) === normalize(root);
}
export function dialogFileSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function dialogError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，请重试。';
}
