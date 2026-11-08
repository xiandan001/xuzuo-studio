import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMacDesktop, isMacPlatform, shortcutLabel } from './platform';

afterEach(() => vi.unstubAllGlobals());
describe('platform-specific desktop chrome and shortcut labels', () => {
  it('uses the trusted desktop platform ahead of a browser user agent', () => {
    vi.stubGlobal('window', { desktop: { platform: 'darwin' } });
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    expect(isMacDesktop()).toBe(true); expect(isMacPlatform()).toBe(true);
    expect(shortcutLabel('K')).toBe('⌘K'); expect(shortcutLabel('Shift+Z')).toBe('⌘Shift+Z');
    vi.stubGlobal('window', { desktop: { platform: 'win32' } });
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    expect(isMacDesktop()).toBe(false); expect(shortcutLabel('K')).toBe('Ctrl+K');
  });
  it('shows Mac keyboard hints in browser preview without enabling native desktop chrome', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    expect(isMacDesktop()).toBe(false); expect(shortcutLabel('C')).toBe('⌘C');
    vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined);
    expect(isMacDesktop()).toBe(false); expect(shortcutLabel('C')).toBe('Ctrl+C');
  });
});
