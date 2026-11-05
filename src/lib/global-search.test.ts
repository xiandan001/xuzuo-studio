import { describe, expect, it } from 'vitest';
import type { PageProps, Project } from '../types';
import { groupedLocalSearch, localSearchIndex, normalizeSearch, searchOwnAssetItems } from './global-search';

function fixture(): PageProps {
  const project = (id: string, workspaceId = 'one'): Project => ({ id, workspaceId, name: `项目 ${id}`, kind: 'word', description: '客户方案', status: 'draft', costCents: 17, version: 1, accent: 'purple', updatedAt: '' });
  return { workspaceId: 'one', projects: [project('a'), project('foreign', 'two'), { ...project('trashed'), trashedAt: 'now' }], activeProject: project('a'), prompts: [{ id: 'prompt', workspaceId: 'one', name: 'API 方案', description: '接口说明', content: '正文要求', category: 'word', mode: 'create', updatedAt: '' }, { id: 'archived', workspaceId: 'one', name: '旧模板', description: '', content: '', archivedAt: 'now' }, { id: 'foreign-prompt', workspaceId: 'two', name: '别区模板', description: '', content: '' }], configuration: { workflows: [{ id: 'flow', workspaceId: 'one', name: '客户交付', description: '保存并导出', outputKind: 'word', steps: [] }, { id: 'foreign-flow', workspaceId: 'two', name: '别区流程', description: '', steps: [] }] }, workflowRunner: { runs: [{ id: 'run', workspaceId: 'one', projectId: 'a', attempts: [{ artifacts: [{ id: 'file', projectId: 'a', name: '方案.txt', kind: 'text', mimeType: 'text/plain', path: '/owned/file', bytes: 10, createdAt: '' }, { id: 'wrong-file', projectId: 'foreign', name: '错误归属文件', kind: 'text', mimeType: 'text/plain', bytes: 10 }] }] }], trashedArtifacts: [] } } as unknown as PageProps;
}
describe('统一搜索只索引当前工作区登记内容并限制渲染', () => {
  it('可按作品格式和常用功能名称找到原路由，不必记住历史页面名称', () => {
    const props = fixture(); props.projects[0] = { ...props.projects[0], name: '本月排期', kind: 'excel', description: '安排交付' };
    const items = localSearchIndex(props, [{ id: 'models', label: '模型中心' }, { id: 'finance', label: '成本与报价' }, { id: 'projects', label: '我的作品' }, { id: 'documents', label: '文档工作台' }]);
    expect(groupedLocalSearch(items, 'Excel').find(group => group.kind === 'project')?.items[0].id).toBe('a');
    expect(groupedLocalSearch(items, 'Excel').find(group => group.kind === 'page')?.items[0].view).toBe('documents');
    expect(groupedLocalSearch(items, 'API Key').find(group => group.kind === 'page')?.items[0].view).toBe('models');
    expect(groupedLocalSearch(items, '费用').find(group => group.kind === 'page')?.items[0].view).toBe('finance');
    expect(groupedLocalSearch(items, '项目').find(group => group.kind === 'page')?.items[0].view).toBe('projects');
  });
  it('排除外区、回收项目/文件和归档模板，保留页面和内置资源', () => {
    const props = fixture(), items = localSearchIndex(props, [{ id: 'settings', label: '偏好设置' }]);
    expect(items.some(item => item.id === 'foreign')).toBe(false); expect(items.some(item => item.id === 'trashed')).toBe(false); expect(items.some(item => item.id === 'wrong-file')).toBe(false); expect(items.some(item => item.id === 'archived')).toBe(false); expect(items.some(item => item.id === 'foreign-prompt')).toBe(false); expect(items.some(item => item.id === 'foreign-flow')).toBe(false);
    expect(items.some(item => item.id === 'file')).toBe(true); expect(items.some(item => item.kind === 'asset' && item.builtin)).toBe(true); expect(items.some(item => item.kind === 'page')).toBe(true);
  });
  it('同一文件只显示一次，当前清单可覆盖旧记录并排除不可用文件', () => {
    const props = fixture(); props.projects[0].referenceFiles = [{ id: 'file', name: '原引用.txt', mimeType: 'text/plain', kind: 'text', bytes: 10 }];
    const fresh = { id: 'file', projectId: 'a', name: '已更新名称.txt', mimeType: 'text/plain', kind: 'text' as const, bytes: 10, path: '', createdAt: '' };
    const items = localSearchIndex(props, [], [fresh]); expect(items.filter(item => item.kind === 'file')).toHaveLength(1); expect(items.find(item => item.id === 'file')?.name).toBe('已更新名称.txt');
    expect(localSearchIndex(props, [], [{ ...fresh, unavailable: true }]).some(item => item.id === 'file')).toBe(false);
  });
  it('永久移除即使迟到快照漏掉trashedAt，也不索引项目或旧产物/引用清单', () => {
    const props = fixture(); props.projects[0] = { ...props.projects[0], purgedAt: '2026-11-04T04:00:00Z', trashedAt: undefined, referenceFiles: [{ id: 'ref-purged', name: '旧引用.png', mimeType: 'image/png', kind: 'image', bytes: 10 }] };
    const items = localSearchIndex(props, [], [{ id: 'inventory-purged', projectId: 'a', name: '旧目录文件.png', mimeType: 'image/png', kind: 'image', bytes: 10, path: '', createdAt: '' }]);
    expect(items.some(item => item.kind === 'project' || item.kind === 'file')).toBe(false);
  });
  it('NFKC大小写与多词搜索一致，每组默认6条，查看更多不超过50', () => {
    const props = fixture(); expect(normalizeSearch('  ＡＰＩ　方案 ')).toBe('api 方案');
    expect(groupedLocalSearch(localSearchIndex(props, []), 'ＡＰＩ 方案').find(group => group.kind === 'prompt')?.items[0].id).toBe('prompt');
    const items = Array.from({ length: 5000 }, (_, index) => ({ key: `project:${index}`, id: String(index), name: `项目 ${index}`, kind: 'project' as const, description: '客户', text: `项目 ${index} 客户` }));
    expect(groupedLocalSearch(items, '项目')[0]).toMatchObject({ total: 5000, items: expect.any(Array) }); expect(groupedLocalSearch(items, '项目')[0].items).toHaveLength(6); expect(groupedLocalSearch(items, '项目', { project: 9999 })[0].items).toHaveLength(50);
  });
  it('精确名称排在包含说明之前，后台素材结果仍按工作区过滤', () => {
    const items = searchOwnAssetItems([{ id: 'a', workspaceId: 'one', name: '宣传图.png', kind: 'image', mimeType: 'image/png', bytes: 10, createdAt: '', favorite: false }, { id: 'b', workspaceId: 'two', name: '别区图.png', kind: 'image', mimeType: 'image/png', bytes: 10, createdAt: '', favorite: false }], 'one');
    expect(items).toHaveLength(1); expect(groupedLocalSearch(items, 'image/png').find(group => group.kind === 'asset')?.items[0].id).toBe('a');
    expect(groupedLocalSearch(localSearchIndex(fixture(), []), '客户交付').find(group => group.kind === 'workflow')?.items[0].name).toBe('客户交付');
  });
});
