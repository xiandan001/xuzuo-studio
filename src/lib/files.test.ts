import { afterEach, expect, it, vi } from 'vitest';
import { downloadFile } from './files';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('desktop saves await the custom destination and propagate cancellation or write failure', async () => {
  let complete!: (value: { saved: boolean }) => void;
  const saveText = vi.fn(() => new Promise<{ saved: boolean }>(resolve => { complete = resolve; }));
  vi.stubGlobal('window', { desktop: { fileDialogs: { saveText } } });
  const saved = downloadFile('报告.json', '{"ok":true}');
  expect(saveText).toHaveBeenCalledWith({ filename: '报告.json', text: '{"ok":true}', mimeType: 'application/json;charset=utf-8' });
  complete({ saved: false }); expect(await saved).toBe(false);
  saveText.mockImplementationOnce(async () => { throw new Error('disk error'); });
  await expect(downloadFile('报告.json', '{}')).rejects.toThrow('disk error');
});
it('browser downloads receive timestamped unique names while preserving file contents and cleanup', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 6, 10, 11, 12, 13));
  const names: string[] = [], links: { href: string; download: string; click: () => void; remove: ReturnType<typeof vi.fn> }[] = [];
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('window', {});
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:owned-download'), revokeObjectURL });
  vi.stubGlobal('document', { body: { appendChild: vi.fn() }, createElement: () => { const link = { href: '', download: '', click: () => { names.push(link.download); }, remove: vi.fn() }; links.push(link); return link; } });
  await downloadFile('报价.json', '{"quoted":true}'); await downloadFile('报价.json', '{"quoted":true}');
  expect(names).toEqual(['报价_2026-11-06_10-11-12-013.json', '报价_2026-11-06_10-11-12-013-1.json']);
  expect(links.every(link => link.remove.mock.calls.length === 1)).toBe(true);
  vi.runAllTimers(); expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});
