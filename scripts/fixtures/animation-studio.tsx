import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageProps, Project } from '../../src/types';
import type { StudioConfiguration } from '../../src/configuration-types';
import { AnimationStudio } from '../../src/pages/AnimationStudio';
import { setAppearanceMode, setAppearancePalette } from '../../src/lib/appearance';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

interface Context { project: Project; configuration: StudioConfiguration; }
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
  const runner = useMemo(() => ({ runs: [], importFiles: (projectId?: string) => window.desktop!.runtime.importFiles(projectId), previewArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), thumbnailArtifact: (id: string) => window.desktop!.runtime.thumbnailArtifact(id), listProjectArtifacts: (projectId: string) => window.desktop!.runtime.listProjectArtifacts(projectId), saveArtifact: (id: string) => window.desktop!.runtime.saveArtifact(id) }), []);
  const props = context ? { workspaceId: context.project.workspaceId, project: context.project, activeProject: context.project, projects: [context.project], configuration: context.configuration, ledger, preferences: { hourlyRate: 0, confirmGeneration: false, reduceMotion: true }, workflowRunner: runner, navigate: () => setNotice('本验收不进入正常应用'), notify: setNotice, workspace: { id: context.project.workspaceId, name: '独立原创夹具工作区' }, workflows: [] } as unknown as PageProps : undefined;
  return <div className="animation-fixture next-interface"><header className="animation-fixture-toolbar"><div><strong>原创图集与 GIF · 独立真实界面验收</strong><small>真实 React／原生存储／本地动画工具；模型为 localhost 合成 PNG 响应，不使用真实 Key 或账户费用。</small></div><button type="button" className="btn btn-secondary" onClick={() => setDark(value => !value)}>{dark ? '切到白天' : '切到黑夜'}</button></header>{notice && <p role="status" className="animation-fixture-notice">{notice}</p>}{props && context ? <AnimationStudio props={props} project={context.project} initialMode="atlas" /> : <p role="status">正在连接独立测试资料…</p>}</div>;
}
const style = document.createElement('style'); style.textContent = 'html,body,#root{height:auto!important;min-width:0!important;min-height:100vh}body{background:var(--ui-bg);margin:0}.animation-fixture{min-width:0;max-width:100%;color:var(--ui-fg)}.animation-fixture-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 26px;background:var(--ui-surface);border-bottom:1px solid var(--ui-border)}.animation-fixture-toolbar strong,.animation-fixture-toolbar small{display:block}.animation-fixture-toolbar small{font-size:12px;color:var(--ui-fg-secondary);margin-top:4px}.animation-fixture-notice{padding:10px 24px;font-size:13px}.animation-fixture>.animation-studio{padding:24px}@media(max-width:1000px){.animation-fixture>.animation-studio{padding:16px}.animation-fixture-toolbar{padding:12px 18px}}'; document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
