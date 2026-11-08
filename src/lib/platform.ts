/** Desktop chrome uses the trusted preload value; browser previews only use it for key labels. */
export function isMacDesktop(): boolean {
  return typeof window !== 'undefined' && window.desktop?.platform === 'darwin';
}

export function isMacPlatform(): boolean {
  if (typeof window !== 'undefined' && window.desktop?.platform) return window.desktop.platform === 'darwin';
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
}

export function shortcutLabel(key: string): string {
  return `${isMacPlatform() ? '⌘' : 'Ctrl+'}${key}`;
}
