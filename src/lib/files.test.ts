import { afterEach, expect, it, vi } from 'vitest';
import { downloadFile } from './files';
afterEach(() => vi.unstubAllGlobals());
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
