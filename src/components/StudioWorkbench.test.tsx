import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudioWorkbench } from './StudioWorkbench';
import type { useStudioLayout } from '../hooks/useStudioLayout';
import { studioToolRequest } from '../lib/studio-commands';

function fixture(focus: boolean) {
  const layout = { tool: 'ai', leftOpen: true, rightOpen: true, focus, narrow: false, toggleFocus: vi.fn(), toggleLeft: vi.fn(), closePanel: vi.fn(), openPanel: vi.fn(), togglePanel: vi.fn() } as unknown as ReturnType<typeof useStudioLayout>;
  return renderToStaticMarkup(<StudioWorkbench projectName="真实项目" kind="word" layout={layout} onTool={vi.fn()} navigationLabel="文档大纲" navigation={<span>当前结构</span>} panel={<textarea aria-label="唯一AI草稿" defaultValue="保留需求" />} saveStatus="草稿已保留，尚未导出" selectionLabel="当前整段" cost={<span>$0.013</span>} canUndo canRedo canExport onUndo={vi.fn()} onRedo={vi.fn()} onExport={vi.fn()}><article data-editor-instance="one">真实可编辑内容</article></StudioWorkbench>);
}
describe('统一工作台工具与显隐边界', () => {
  it('工具顺序固定，专注只隐藏两侧，编辑器和输入始终各一份', () => {
    const normal = fixture(false), focus = fixture(true);
    for (const html of [normal, focus]) {
      expect(html.match(/data-editor-instance="one"/g)).toHaveLength(1); expect(html.match(/aria-label="唯一AI草稿"/g)).toHaveLength(1);
      const labels = ['撤销编辑', '重做编辑', '插入素材', '打开格式与属性', '打开 AI 创作与修改', '编辑版本与恢复'];
      const order = labels.map(label => html.indexOf(`aria-label="${label}"`)); expect(order.every(index => index >= 0)).toBe(true); expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(html).toContain('导出 Word'); expect(html).toContain('草稿已保留，尚未导出'); expect(html).toContain('$0.013'); expect(html).not.toContain('<select');
    }
    expect(focus).toContain('class="sw-navigation" hidden=""'); expect(focus).toContain('class="sw-panel" hidden=""'); expect(normal).not.toContain('class="sw-panel" hidden=""');
  });
  it('外部交付请求只能打开同一工作区、同一项目的已知工具', () => {
    expect(studioToolRequest({ workspaceId: 'ws', projectId: 'project', tool: 'delivery' }, 'ws', 'project')).toBe('delivery');
    for (const input of [null, { workspaceId: 'other', projectId: 'project', tool: 'delivery' }, { workspaceId: 'ws', projectId: 'other', tool: 'delivery' }, { workspaceId: 'ws', projectId: 'project', tool: 'generate' }]) expect(studioToolRequest(input, 'ws', 'project')).toBeUndefined();
  });
});
