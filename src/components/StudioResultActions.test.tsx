import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioResultActions } from './StudioResultActions';

describe('成品优先工作台操作', () => {
  it('四种结果同样突出导出，保存和验收不与主要操作竞争', () => {
    for (const kind of ['Word', 'PPT', 'Excel', '图片']) {
      const html = renderToStaticMarkup(<StudioResultActions kind={kind} canExport canModify onExport={() => undefined} onModify={() => undefined} actions={[{ id: 'save', label: '保存版本', onSelect: () => undefined }, { id: 'delivery', label: '交付检查', onSelect: () => undefined }]} />);
      expect(html).toContain(`导出${kind}`);
      expect(html).toContain('修改');
      expect(html.match(/class="btn btn-primary"/g)).toHaveLength(1);
      expect(html).toContain('aria-label="更多作品操作"');
      expect(html).not.toContain('保存版本');
      expect(html).not.toContain('交付检查');
      expect(html).not.toContain('role="dialog"');
    }
  });
  it('无结果和正在导出时，不能点击重复导出', () => {
    const empty = renderToStaticMarkup(<StudioResultActions kind="图片" canExport={false} canModify={false} onExport={() => undefined} onModify={() => undefined} actions={[]} />);
    expect(empty).toMatch(/<button[^>]*class="btn btn-primary"[^>]*disabled=""/);
    const pending = renderToStaticMarkup(<StudioResultActions kind="Word" canExport canModify disabled exporting onExport={() => undefined} onModify={() => undefined} actions={[]} />);
    expect(pending).toContain('正在导出…');
    expect(pending).toMatch(/<button[^>]*class="btn btn-primary"[^>]*disabled=""/);
  });
});
