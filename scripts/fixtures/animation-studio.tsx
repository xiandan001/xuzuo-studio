import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageProps, Project } from '../../src/types';
import type { StudioConfiguration, WorkflowRun } from '../../src/configuration-types';
import { AnimationStudio } from '../../src/pages/AnimationStudio';
import { StudioRunStatus } from '../../src/components/StudioRunStatus';
import { setAppearanceMode, setAppearancePalette } from '../../src/lib/appearance';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

interface Context { project: Project; configuration: StudioConfiguration; }
function layoutRun(project: Project): WorkflowRun {
  const updatedAt = '2026-01-01T00:00:00.000Z';
  const snapshot = { id: 'layout-only-workflow', workspaceId: project.workspaceId, name: '壳层布局夹具（合成完成记录）', description: '只供真实状态组件展开布局使用，不执行工作流或调用模型。', outputKind: 'image' as const, updatedAt, steps: Array.from({ length: 8 }, (_, index) => ({ id: `layout-step-${index}`, name: `布局夹具步骤 ${index + 1}`, kind: 'image-generation' as const, prompt: '', inputSource: 'project' as const, enabled: true })) };
  return { id: 'layout-only-run', workspaceId: project.workspaceId, projectId: project.id, workflowId: snapshot.id, workflowName: snapshot.name, snapshot, status: 'complete', stepIndex: 7, attempts: [], variables: {}, input: '', createdAt: updatedAt, updatedAt, mode: 'simulation' };
}
function Fixture() {
  const [context, setContext] = useState<Context>(), [ledger, setLedger] = useState<PageProps['ledger']>([]), [dark, setDark] = useState(false), [notice, setNotice] = useState('');
  const sequence = useRef(0);
  useLayoutEffect(() => { setAppearanceMode(dark ? 'dark' : 'light'); setAppearancePalette('violet'); }, [dark]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { const ticket = ++sequence.current; const snapshot = await window.desktop!.runtime.snapshot(); if (alive && ticket === sequence.current) setLedger(snapshot.ledger); };
    void window.desktop!.runtime.status().then(value => { if (alive) setContext(value as unknown as Context); }); void refresh();
    const remove = window.desktop!.animation?.onChanged?.(() => { void refresh(); });
    return () => { alive = false; sequence.current++; remove?.(); };
  }, []);
  const runner = useMemo(() => ({ runs: context ? [layoutRun(context.project)] : [], importFiles: (projectId?: string) => window.desktop!.runtime.importFiles(projectId), previewArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), thumbnailArtifact: (id: string) => window.desktop!.runtime.thumbnailArtifact(id), listProjectArtifacts: (projectId: string) => window.desktop!.runtime.listProjectArtifacts(projectId), saveArtifact: (id: string) => window.desktop!.runtime.saveArtifact(id) }), [context]);
  const props = context ? { workspaceId: context.project.workspaceId, project: context.project, activeProject: context.project, projects: [context.project], configuration: context.configuration, ledger, preferences: { hourlyRate: 0, confirmGeneration: false, reduceMotion: true }, workflowRunner: runner, navigate: () => setNotice('本验收不进入正常应用'), notify: setNotice, workspace: { id: context.project.workspaceId, name: '独立原创夹具工作区' }, workflows: [] } as unknown as PageProps : undefined;
  return <div className="animation-fixture desktop-shell studio-app-shell next-interface app-layout-studio reduce-motion">
    <div className="desktop-titlebar"><span className="titlebar-caption">原创图集与 GIF · 独立真实界面验收</span><span>localhost 合成 PNG · 无真实费用</span></div>
    <div className="app-body">
      <aside className="sidebar"><div className="brand"><div><strong>序作工作台</strong><small>独立验收夹具</small></div></div><nav className="sidebar-nav" aria-label="夹具工作区"><button type="button" className="nav-item active">图片工作台</button></nav><div className="sidebar-bottom"><small>原生存储与本地动画工具</small>{notice && <p role="status">{notice}</p>}</div></aside>
      <div className="app-main">
        <header className="app-header"><div className="breadcrumb"><span>独立原创夹具工作区</span><strong>{context?.project.name || '正在连接'}</strong></div><button type="button" className="btn btn-secondary" onClick={() => setDark(value => !value)}>{dark ? '切到白天' : '切到黑夜'}</button></header>
        <main className="app-content content-images"><div className="workspace-panel">{props && context ? <><StudioRunStatus props={props} /><AnimationStudio props={props} project={context.project} initialMode="atlas" onClose={() => setNotice('已触发返回图片工作台；独立验收保留当前工坊。')} /></> : <p role="status">正在连接独立测试资料…</p>}</div></main>
        <footer className="statusbar"><span>数据仅存于独立测试目录</span><span>独立测试窗口 · 非正式工作区</span></footer>
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
