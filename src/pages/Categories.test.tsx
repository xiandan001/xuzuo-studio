import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps } from '../types';
import { Categories } from './Categories';

describe('业务分类工作区', () => {
  it('关联项目直接显示并可调整归属，提示词和工作流各有独立入口', () => {
    const html = renderToStaticMarkup(<Categories {...{
      workspaceId: 'w', workspace: { id: 'w', name: '隔离测试' }, projects: [{ id: 'p', name: '图文提案', description: '', kind: 'ppt', businessCategoryId: 'launch' }],
      prompts: [{ id: 'builtin', builtin: true, name: '内置模板', description: '' }], configuration: { categories: [{ id: 'brand', name: '品牌', archived: false }, { id: 'launch', name: '新品', parentId: 'brand', archived: false }], workflows: [] },
    } as unknown as PageProps} />);
    expect(html).toContain('业务分类目录'); expect(html).toContain('图文提案');
    expect(html).toContain('调整图文提案的分类'); expect(html).toContain('我的提示词'); expect(html).toContain('工作流');
    expect(html).toContain('分类不会移动本地文件'); expect(html).not.toContain('<select');
    expect(html).not.toContain('内置模板');
  });
});
