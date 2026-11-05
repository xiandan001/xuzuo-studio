import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createOfficeExporter } = require('../../electron/office-export.cjs');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="red" d="M0 0h16v16H0z"/></svg>');
const gif = Buffer.from('47494638396101000100800000ff00000000ff21f90400140000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex');
function fixture(values) {
  const sources = new Map(values.map(value => [value.id, value])), write = vi.fn(async value => ({ ...value, id: 'delivery-note', kind: 'text' })), renderOffice = vi.fn();
  return { sources, write, renderOffice, exportImage: createOfficeExporter({ readArtifact: async id => sources.get(id), writeArtifact: write, renderOffice }) };
}
describe('SVG/GIF original image delivery', () => {
  it('returns every unique SVG/GIF original ID and MIME without converting or mutating bytes', async () => {
    const originals = [1, 2, 3].map(index => ({ id: 'svg-' + index, kind: 'image', projectId: 'project', mimeType: 'image/svg+xml', name: index + '.svg', buffer: Buffer.from(svg) }));
    originals.push({ id: 'gif', kind: 'image', projectId: 'project', mimeType: 'image/gif', name: 'animation.gif', buffer: Buffer.from(gif) });
    const f = fixture(originals), before = originals.map(file => Buffer.from(file.buffer));
    const result = await f.exportImage({ kind: 'image', title: '成品', text: '独立图像交付', projectId: 'project', assets: ['svg-1', 'svg-2', 'svg-3', 'gif', 'svg-1'] });
    expect(result.filter(file => file.kind === 'image').map(file => file.id)).toEqual(['svg-1', 'svg-2', 'svg-3', 'gif']);
    expect(result.filter(file => file.kind === 'image').map(file => file.mimeType)).toEqual(['image/svg+xml', 'image/svg+xml', 'image/svg+xml', 'image/gif']);
    expect(originals.map(file => file.buffer)).toEqual(before); expect(f.write).toHaveBeenCalledTimes(1); expect(f.renderOffice).not.toHaveBeenCalled();
    for (const file of originals) expect(f.write.mock.calls[0][0].text).toContain(file.name);
  });
  it('rejects unsafe or forged newly supported bytes before writing the delivery note', async () => {
    for (const file of [{ mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>') }, { mimeType: 'image/gif', buffer: svg }]) {
      const f = fixture([{ id: 'bad', name: 'bad', kind: 'image', ...file }]);
      await expect(f.exportImage({ kind: 'image', title: '保留原文件', assets: ['bad'] })).rejects.toThrow();
      expect(f.write).not.toHaveBeenCalled(); expect(f.renderOffice).not.toHaveBeenCalled(); expect(f.sources.get('bad').buffer).toEqual(file.buffer);
    }
  });
  it.each(['word', 'ppt'])('%s embedding still refuses SVG/GIF rather than silently converting them', async kind => {
    for (const [mimeType, buffer] of [['image/svg+xml', svg], ['image/gif', gif]]) {
      const f = fixture([{ id: 'picture', name: 'picture', kind: 'image', mimeType, buffer }]);
      await expect(f.exportImage({ kind, title: '正文', text: '保持已提供的正文与事实。', assets: ['picture'] })).rejects.toThrow('Office 暂仅嵌入 PNG/JPEG');
      expect(f.renderOffice).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    }
  });
});
