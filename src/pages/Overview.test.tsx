import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps, Project } from '../types';
import { Overview } from './Overview';
const project: Project = { id: 'one', workspaceId: 'one', name: '最近作品', kind: 'word', status: 'review', description: '', updatedAt: '2026-11-02T01:00:00Z', costCents: 0, version: 1, accent: 'purple' };
function fixture(withProjects = true): PageProps { return { workspaceId: 'one', projects: withProjects ? [project] : [], ledger: [], preferences: {}, workflowRunner: { runs: [] }, navigate: () => {}, onCreateProject: () => {}, onUpdateProject: () => {} } as unknown as PageProps; }
describe('创作对话首页', () => {
  it('已有项目时可直接继续，检查/完成指标对应明确项目集合', () => {
    const html = renderToStaticMarkup(<Overview {...fixture()} />);
    expect(html).toContain('创作对话'); expect(html).toContain('最近作品'); expect(html).toContain('conversation-recent-work'); expect(html).not.toContain('最近动态'); expect(html).not.toContain('待交付检查');
  });
  it('没有项目时提供真正新建入口，不出现无内容的卡片网格', () => {
    const html = renderToStaticMarkup(<Overview {...fixture(false)} />);
    expect(html).toContain('创作对话'); expect(html).not.toContain('最近作品'); expect(html).not.toContain('project-grid');
  });
});
