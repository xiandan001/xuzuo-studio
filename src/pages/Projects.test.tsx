import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps, Project } from '../types';
import { Projects } from './Projects';
const make = (id: string): Project => ({ id, workspaceId: 'one', name: `项目${id}`, kind: 'word', status: 'review', description: '', updatedAt: '2026-11-02T00:00:00Z', costCents: 17, version: 1, accent: 'purple' });
function fixture(projects: Project[]): PageProps { return { projects, trashedProjects: [], ledger: [], workspace: { id: 'one', name: '工作区一' }, workspaces: [{ id: 'one', name: '工作区一' }], configuration: { categories: [] }, workflowRunner: { runs: projects.map(project => ({ id: `run-${project.id}`, projectId: project.id, mode: 'live', status: 'complete', attempts: [{ status: 'complete', artifacts: [{ id: `file-${project.id}`, projectId: project.id, kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100 }] }] })) }, navigate: () => {}, onCreateProject: () => {}, onUpdateProject: () => {}, onMoveProject: async () => false, onTrashProject: () => {}, onRestoreProject: () => {}, notify: () => {} } as unknown as PageProps; }
describe('项目页先呈现可操作范围', () => {
  it('首次只渲染24项目且显示实际生成状态而不替代人工交付', () => {
    const html = renderToStaticMarkup(<Projects {...fixture(Array.from({ length: 65 }, (_, i) => make(String(i))))} />);
    expect(html.match(/class="op-project-card"/g)).toHaveLength(24); expect(html).toContain('项目列表分页'); expect(html).toContain('共 65 个项目'); expect(html).toContain('下一页'); expect(html).toContain('已生成'); expect(html).toContain('仍需核对'); expect(html).not.toContain('>已完成<');
  });
  it('真正空项目有新建入口，不只显示无效的清筛选', () => {
    const html = renderToStaticMarkup(<Projects {...fixture([])} />);
    expect(html).toContain('这里还没有项目'); expect(html).toContain('开始第一份作品');
  });
  it('默认收起状态和业务分类筛选，保留类型、搜索、视图与明确筛选入口', () => {
    const html = renderToStaticMarkup(<Projects {...fixture([make('one')])} />);
    expect(html).toContain('aria-label="作品筛选" aria-expanded="false"');
    expect(html).toContain('aria-label="搜索项目"'); expect(html).toContain('aria-label="网格视图"'); expect(html).toContain('aria-label="列表视图"');
    expect(html).toContain('>PPT</button>'); expect(html).not.toContain('aria-label="筛选项目状态"'); expect(html).not.toContain('aria-label="筛选项目业务分类"');
  });
});
