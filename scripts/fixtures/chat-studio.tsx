import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageProps, Project } from '../../src/types';
import type { StudioConfiguration } from '../../src/configuration-types';
import { Overview } from '../../src/pages/Overview';
import { setAppearanceMode, setAppearancePalette } from '../../src/lib/appearance';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';
import '../../src/components/home-automation-chat.css';
import '../../src/components/creation-journey.css';
import '../../src/pages/conversation-home.css';

interface Context { workspaceId: string; configuration: StudioConfiguration; }
function Fixture() {
  const [context, setContext] = useState<Context>(), [dark, setDark] = useState(false), [notice, setNotice] = useState(''), [folderRequests, setFolderRequests] = useState(0), [withRecent, setWithRecent] = useState(false), [navigation, setNavigation] = useState('');
  useLayoutEffect(() => { setAppearanceMode(dark ? 'dark' : 'light'); setAppearancePalette('violet'); }, [dark]);
  useEffect(() => { let current = true; void window.desktop!.runtime.status().then(value => { if (current) setContext(value as unknown as Context); }); return () => { current = false; }; }, []);
  const props = useMemo(() => {
    if (!context) return undefined;
    const workspace = { id: context.workspaceId, name: '独立无项目工作区', description: '', createdAt: '' };
    const projects: Project[] = withRecent ? (['image', 'word', 'ppt'] as const).map((kind, index) => ({ id: `fixture-recent-${index + 1}`, workspaceId: workspace.id, kind, name: `合成最近作品 ${index + 1}`, description: '只验证首页布局，不创建目录或真实文件。', costCents: 0, status: 'draft', version: 0, accent: 'blue', updatedAt: '2026-11-09T00:00:00.000Z' })) : [];
    const activeProject = { id: '', workspaceId: workspace.id, kind: 'image', name: '', description: '', costCents: 0, status: 'draft', version: 0, accent: 'blue', updatedAt: '' } as Project;
    return { workspaceId: workspace.id, workspace, workspaces: [workspace], projects, trashedProjects: [], activeProject, ledger: [], configuration: { ...context.configuration, workflows: [], categories: [], studioActions: [], useTemplates: context.configuration.useTemplates || [] }, workflowRunner: { runs: [], runtimeStatus: { available: true } }, preferences: { hourlyRate: 0, confirmGeneration: false, reduceMotion: true }, navigate: (view: string, projectId?: string) => { setNavigation(`${view}:${projectId || ''}`); setNotice('验收保留当前聊天页面'); }, notify: setNotice, onCreateProject: (_kind: Parameters<PageProps['onCreateProject']>[0], options: Parameters<PageProps['onCreateProject']>[1]) => { setFolderRequests(value => value + 1); options?.onCancelled?.(); }, onUpdateProject: () => {} } as unknown as PageProps;
  }, [context, withRecent]);
  return <div className="chat-fixture desktop-shell studio-app-shell next-interface app-layout-studio reduce-motion" data-folder-requests={folderRequests} data-recent-visible={withRecent} data-last-navigation={navigation}>
    <div className="desktop-titlebar"><span className="titlebar-caption">聊天与制作 · 独立离线验收</span><span>合成流式回复 · 无真实账户费用</span></div>
    <div className="app-body"><aside className="sidebar"><div className="brand"><div><strong>序作工作台</strong><small>独立离线验收</small></div></div><nav className="sidebar-nav"><button className="nav-item active" type="button">创作</button></nav><div className="sidebar-bottom"><small>{withRecent ? '3 份合成作品 · 不创建本地项目' : '0 个项目 · 不创建本地项目'}</small>{notice && <p role="status">{notice}</p>}</div></aside><div className="app-main">
      <header className="app-header"><div className="breadcrumb"><span>独立无项目工作区</span><strong>聊天与制作</strong></div><button className="btn btn-secondary" type="button" onClick={() => setDark(value => !value)}>{dark ? '切到白天' : '切到黑夜'}</button><button className="btn btn-secondary" type="button" aria-label="切换最近作品测试数据" aria-pressed={withRecent} onClick={() => setWithRecent(value => !value)}>{withRecent ? '隐藏合成最近作品' : '显示合成最近作品'}</button></header>
      <main className="app-content content-overview"><div className="workspace-panel">{props ? <Overview {...props} /> : <p role="status">正在连接独立离线资料…</p>}</div></main>
      <footer className="statusbar"><span>仅使用独立测试目录</span><span>真实React、preload和聊天服务 · 离线合成数据</span></footer>
    </div></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
