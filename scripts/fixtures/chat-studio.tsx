import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageProps, Project } from '../../src/types';
import type { StudioConfiguration, WorkflowRun } from '../../src/configuration-types';
import type { ArtifactMetadata, LiveStartRequest } from '../../src/live-types';
import { createLiveStartCoordinator } from '../../src/lib/live-start';
import { WorkspaceChat } from '../../src/components/WorkspaceChat';
import { setAppearanceMode, setAppearancePalette } from '../../src/lib/appearance';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';
import '../../src/components/home-automation-chat.css';
import '../../src/components/creation-journey.css';
import '../../src/pages/conversation-home.css';

interface Context { workspaceId: string; configuration: StudioConfiguration; project: Project; artifact: ArtifactMetadata; }
function Fixture() {
  const [context, setContext] = useState<Context>(), [dark, setDark] = useState(false), [notice, setNotice] = useState(''), [folderRequests, setFolderRequests] = useState(0);
  const [projectVisible, setProjectVisible] = useState(false), [intent, setIntent] = useState<PageProps['chatIntent']>(), [runs, setRuns] = useState<WorkflowRun[]>([]), [toolPreset, setToolPreset] = useState(''), [toolReferences, setToolReferences] = useState(0), [discussedArtifact, setDiscussedArtifact] = useState('');
  const [starts] = useState(() => createLiveStartCoordinator({ storage: () => localStorage, bridge: () => window.desktop?.runtime, onRun: run => setRuns(current => [run, ...current.filter(item => item.id !== run.id)]) }));
  useEffect(() => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.chatCopiedText = text; document.documentElement.dataset.chatCopyCount = String(Number(document.documentElement.dataset.chatCopyCount || '0') + 1); } } });
    return () => { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); };
  }, []);
  useLayoutEffect(() => { setAppearanceMode(dark ? 'dark' : 'light'); setAppearancePalette('violet'); }, [dark]);
  useEffect(() => { let current = true; void window.desktop!.runtime.status().then(value => { if (current) setContext(value as unknown as Context); }); return () => { current = false; }; }, []);
  useEffect(() => { if (!runs.some(run => run.status === 'running')) return; let current = true; const timer = setInterval(() => { void window.desktop!.runtime.snapshot().then(value => { if (current) setRuns(value.runs); }); }, 300); return () => { current = false; clearInterval(timer); }; }, [runs.some(run => run.status === 'running')]);
  const props = useMemo(() => {
    if (!context) return undefined;
    const workspace = { id: context.workspaceId, name: '独立无项目工作区', description: '', createdAt: '' };
    const activeProject = { id: '', workspaceId: workspace.id, kind: 'image', name: '', description: '', costCents: 0, status: 'draft', version: 0, accent: 'blue', updatedAt: '' } as Project;
    const request = (workflow: LiveStartRequest['workflow'], projectId: string, input: string, variables: Record<string, string>, attachmentIds: string[]): LiveStartRequest => { if (projectId !== context.project.id) throw Error('Fixture forbids foreign projects'); return { workflow, project: context.project, input, variables, attachmentIds, models: context.configuration.models, connections: context.configuration.connections, acknowledgePaidCalls: true, acknowledgeUnknownCost: true }; };
    return { workspaceId: workspace.id, workspace, workspaces: [workspace], projects: projectVisible ? [context.project] : [], trashedProjects: [], activeProject, ledger: [], configuration: { ...context.configuration, workflows: [], categories: [], studioActions: [], useTemplates: [] }, workflowRunner: { runs, runtimeStatus: { available: true }, listProjectArtifacts: (id: string) => window.desktop!.runtime.listProjectArtifacts!(id), previewArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), thumbnailArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), preflight: (...args: Parameters<typeof request>) => window.desktop!.runtime.preflight(request(...args)), startLive: (...args: Parameters<typeof request>) => starts.start(request(...args)), readStartResult: (id: string) => starts.read(id), saveArtifact: async () => ({ saved: false }) }, preferences: { hourlyRate: 0, confirmGeneration: false, reduceMotion: true }, chatIntent: intent, onChatIntentConsumed: (token: string) => setIntent(value => value?.token === token ? undefined : value), onDiscussArtifact: (file: ArtifactMetadata, kind: Project['kind']) => { setDiscussedArtifact(file.id); setIntent({ token: crypto.randomUUID(), conversationId: crypto.randomUUID(), workspaceId: context.workspaceId, projectId: file.projectId!, artifactId: file.id, kind, name: file.name }); }, navigate: () => setNotice('验收保留当前聊天页面'), notify: setNotice, onCreateProject: (_kind: Parameters<PageProps['onCreateProject']>[0], options: Parameters<PageProps['onCreateProject']>[1]) => { setFolderRequests(value => value + 1); options?.onCancelled?.(); }, onUsePrompt: (prompt: { imagePreset?: string }, _text: string, _project: string, options: { referenceFiles?: ArtifactMetadata[] }) => { setToolPreset(prompt.imagePreset || ''); setToolReferences(options.referenceFiles?.length || 0); }, onUpdateProject: () => {} } as unknown as PageProps;
  }, [context, projectVisible, intent, runs, starts]);
  return <div className="chat-fixture desktop-shell studio-app-shell next-interface app-layout-studio reduce-motion" data-folder-requests={folderRequests} data-tool-preset={toolPreset} data-tool-references={toolReferences} data-discussed-artifact={discussedArtifact}>
    <div className="desktop-titlebar"><span className="titlebar-caption">聊天与制作 · 独立离线验收</span><span>合成流式回复 · 无真实账户费用</span></div>
    <div className="app-body"><aside className="sidebar"><div className="brand"><div><strong>序作工作台</strong><small>独立离线验收</small></div></div><nav className="sidebar-nav"><button className="nav-item active" type="button">创作</button></nav><div className="sidebar-bottom"><small>0 个项目 · 不创建本地项目</small>{notice && <p role="status">{notice}</p>}</div></aside><div className="app-main">
      <header className="app-header"><div className="breadcrumb"><span>独立无项目工作区</span><strong>聊天与制作</strong></div><button type="button" className="text-button" onClick={() => setProjectVisible(true)}>载入验收作品</button>{projectVisible && context && <button type="button" className="text-button" onClick={() => setIntent({ token: crypto.randomUUID(), conversationId: crypto.randomUUID(), workspaceId: context.workspaceId, projectId: context.project.id, artifactId: context.artifact.id, kind: 'image', name: context.artifact.name })}>精修验收图</button>}<button className="btn btn-secondary" type="button" onClick={() => setDark(value => !value)}>{dark ? '切到白天' : '切到黑夜'}</button></header>
      <main className="app-content content-overview"><div className="conversation-home">{props ? <WorkspaceChat props={props} onLegacy={() => setNotice('旧创作对话入口已触发')} /> : <p role="status">正在连接独立离线资料…</p>}</div></main>
      <footer className="statusbar"><span>仅使用独立测试目录</span><span>真实React、preload和聊天服务 · 离线合成数据</span></footer>
    </div></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
