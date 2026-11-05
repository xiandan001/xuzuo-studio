import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { ProjectPurgeItem } from '../project-purge-types';
import { pendingProjectPurgeGroups, Projects, recycledProjectSelection } from './Projects';

const project = (id: string, changes: Partial<Project> = {}): Project => ({ id, workspaceId: 'a', name: id, kind: 'word', status: 'review', description: '', updatedAt: '2026-11-04', trashedAt: '2026-11-04', version: 1, costCents: 17, accent: 'purple', ...changes });
const pending = (id: string, requestId: string, changes: Partial<ProjectPurgeItem> = {}): ProjectPurgeItem => ({ projectId: id, workspaceId: 'a', name: id, kind: 'word', directory: 'C:/owned/' + id, trashedAt: '2026-11-04', purgedAt: '2026-11-04', updatedAt: '2026-11-04', costCents: 17, requestId, recordPurged: true, filesDeleted: false, folderMissing: false, filesPending: true, retryable: true, ...changes });
function props(changes: Partial<PageProps> = {}): PageProps { return { projects: [], trashedProjects: [project('one'), project('two')], ledger: [], workspace: { id: 'a', name: '工作区A' }, workspaces: [{ id: 'a', name: '工作区A' }], configuration: { categories: [] }, workflowRunner: { runs: [] }, onPurgeProjects: vi.fn(), onRetryProjectPurge: vi.fn(), notify: vi.fn(), ...changes } as unknown as PageProps; }
afterEach(() => vi.unstubAllGlobals());

describe('项目页永久删除入口', () => {
  it('清空取当前工作区全部回收项目，不取24项分页或搜索结果，也排除active/purged/foreign', () => {
    const recycled = Array.from({ length: 65 }, (_, i) => project('p-' + i));
    const values = [...recycled, recycled[0], project('active', { trashedAt: undefined }), project('purged', { purgedAt: '2026-11-04' }), project('foreign', { workspaceId: 'b' })];
    expect(recycledProjectSelection(values, 'a').map(project => project.id)).toEqual(recycled.map(project => project.id));
    expect(recycledProjectSelection(values, 'a', ['p-40', 'foreign', 'active', 'purged', 'p-40']).map(project => project.id)).toEqual(['p-40']);
  });
  it('pending仅显示本区已移除记录的未完文件，按原请求归组，不混入普通trash失败或已清完项目', () => {
    const groups = pendingProjectPurgeGroups([pending('one', 'request-1'), pending('two', 'request-1'), pending('foreign', 'request-2', { workspaceId: 'b' }), pending('guard-failed', 'request-3', { recordPurged: false }), pending('done', 'request-4', { filesPending: false, retryable: false }), pending('metadata', 'request-5', { filesPending: false, retryable: true })], 'a');
    expect(groups).toHaveLength(2); expect(groups[0].requestId).toBe('request-1'); expect(groups[0].items.map(item => item.projectId)).toEqual(['one', 'two']); expect(groups[1].requestId).toBe('request-5');
  });
  it('有回收项目就提供永久删除与清空入口，首次不会自行预览或执行', () => {
    const preview = vi.fn(); vi.stubGlobal('window', { desktop: { projectPurge: { preview } } }); const state = props();
    const html = renderToStaticMarkup(<Projects {...state} />);
    expect(html).toContain('清空回收站'); expect(html).toContain('永久删除项目 one'); expect(html).toContain('永久删除项目 two'); expect(html).not.toContain('role="dialog"');
    expect(preview).not.toHaveBeenCalled(); expect(state.onPurgeProjects).not.toHaveBeenCalled(); expect(state.trashedProjects).toHaveLength(2);
  });
  it('状态加载或错误时危险入口禁用，并提供重新读取入口', () => {
    vi.stubGlobal('window', { desktop: { projectPurge: {} } });
    for (const state of [props({ projectPurgeLoading: true }), props({ projectPurgeError: '删除状态暂不可读', onRefreshProjectPurges: vi.fn() })]) {
      const html = renderToStaticMarkup(<Projects {...state} />);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?清空回收站<\/button>/s);
      expect(html).toMatch(/<button[^>]*aria-label="永久删除项目 one"[^>]*disabled=""/);
      expect(state.onPurgeProjects).not.toHaveBeenCalled();
    }
    expect(renderToStaticMarkup(<Projects {...props({ projectPurgeError: '错误', onRefreshProjectPurges: vi.fn() })} />)).toContain('重新读取删除状态');
  });
  it('部分删除显示独立待清理区和原请求重试，不提供恢复；优先显示Native隔离目录', () => {
    vi.stubGlobal('window', { desktop: { projectPurge: {} } });
    const html = renderToStaticMarkup(<Projects {...props({ trashedProjects: [], pendingProjectPurges: [pending('pending-one', 'frozen-request', { cleanupDirectory: 'C:/owned/.quarantine/native-only', error: '磁盘文件仍被占用' }), pending('foreign', 'foreign-request', { workspaceId: 'b' })] })} />);
    expect(html).toContain('永久删除未完成'); expect(html).toContain('重试清理请求 frozen-request'); expect(html).toContain('C:/owned/.quarantine/native-only'); expect(html).toContain('磁盘文件仍被占用');
    expect(html).not.toContain('foreign-request'); expect(html).not.toContain('恢复项目 pending-one');
    const metadata = renderToStaticMarkup(<Projects {...props({ trashedProjects: [], pendingProjectPurges: [pending('metadata', 'metadata-request', { filesPending: false, retryable: true })] })} />);
    expect(metadata).toContain('重试记录收尾请求 metadata-request'); expect(metadata).toContain('项目已移除，记录登记尚未完成'); expect(metadata).not.toContain('文件清理尚未完成');
  });
});
