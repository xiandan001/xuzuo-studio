import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageStudio } from '../../src/pages/ImageStudio';
import { Settings } from '../../src/pages/Settings';
import { CommerceLayerEditor } from '../../src/components/CommerceLayerEditor';
import { INITIAL_PREFERENCES } from '../../src/data';
import { APPEARANCE_KEY, setAppearanceMode, setInterfaceLayout } from '../../src/lib/appearance';
import { imageDraftKey } from '../../src/lib/image-studio';
import { writeDisclosure } from '../../src/lib/disclosure-state';
import { studioPreferenceKey } from '../../src/lib/studio-layout-state';
import { saveWorkspacePreferences } from '../../src/lib/settings-save';
import { WORKSPACE_STORAGE_KEY } from '../../src/lib/workspace-persistence';
import { guardedEditorSessions } from '../../src/lib/editor-session-guard';
import type { PageProps, Preferences, Project } from '../../src/types';
import type { WorkspaceState } from '../../src/lib/workspace-state';
import type { WorkflowRun } from '../../src/configuration-types';
import type { ArtifactMetadata } from '../../src/live-types';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

interface Context { workspaceId: string; project: Project; source: ArtifactMetadata; clearSource: ArtifactMetadata; run: WorkflowRun; workspaceDirectory: string; ledger: PageProps['ledger']; configuration: PageProps['configuration']; }
const calls = { fourK: 0, savedArtifacts: [] as string[], provider: 0, preferenceAttempts: 0, preferenceFailures: 0, preferencesSaved: 0, projectPatches: 0 };
let failNextSave = false;
const snapshot = { current: () => ({}) as object };
Object.defineProperty(window, 'imageSettingsBrowserFixture', { value: Object.freeze({ kind: 'isolated-image-settings-browser', snapshot: () => snapshot.current(), failNextSave: () => { failNextSave = true; } }) });
function Fixture() {
  const [context, setContext] = useState<Context>(), [state, setState] = useState<WorkspaceState>(), [view, setView] = useState<'images' | 'settings' | 'commerce'>('images'), [notice, setNotice] = useState('');
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => {
    let current = true;
    void window.desktop!.runtime.status().then(value => {
      if (!current) return; const input = value as unknown as Context;
      const initial: WorkspaceState = { workspaces: [{ id: input.workspaceId, name: '独立UI验收', description: '隔离测试资料', directory: input.workspaceDirectory, createdAt: '' }], activeWorkspaceId: input.workspaceId, projects: [input.project], ledger: [], preferencesByWorkspace: { [input.workspaceId]: { ...INITIAL_PREFERENCES, studioName: '独立UI验收' } }, customPrompts: [] };
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(initial));
      localStorage.setItem(imageDraftKey(input.project.id), JSON.stringify({ preset: '壁纸', wallpaperEnabled: true, wallpaperTarget: { width: 1920, height: 1080, fit: 'cover' }, mode: 'create', prompt: '隔离样例壁纸', quantity: 1, references: [] }));
      for (const [key, setting] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: input.workspaceId, projectId: input.project.id }, key), setting);
      setAppearanceMode('light'); setInterfaceLayout('professional'); stateRef.current = initial; setState(initial); setContext(input);
    }); return () => { current = false; };
  }, []);
  snapshot.current = () => ({ calls, view, state: stateRef.current, stored: localStorage.getItem(WORKSPACE_STORAGE_KEY), appearance: localStorage.getItem(APPEARANCE_KEY), dirtyPreferences: guardedEditorSessions().filter(session => session.kind === 'preferences').map(session => session.getState()) });
  if (!context || !state) return <p role="status">正在读取独立样例…</p>;
  const workspace = state.workspaces[0];
  const persist = (changes: Partial<Preferences>) => {
    calls.preferenceAttempts++;
    const storage = failNextSave ? { getItem: (key: string) => localStorage.getItem(key), setItem: () => { failNextSave = false; throw Error('Deliberate isolated localStorage write fault'); } } : localStorage;
    const result = saveWorkspacePreferences(storage, stateRef.current!, workspace.id, changes);
    if (!result.ok) { calls.preferenceFailures++; throw Error(result.message); }
    calls.preferencesSaved++; stateRef.current = result.state; setState(result.state); return true;
  };
  const runner = { runs: [context.run], trashedArtifacts: [], runtimeStatus: { available: true }, inventoryRevision: 0,
    previewArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), thumbnailArtifact: (id: string) => window.desktop!.runtime.thumbnailArtifact!(id),
    listProjectArtifacts: (id: string) => window.desktop!.runtime.listProjectArtifacts!(id), listTrashedArtifacts: async () => [],
    exportWallpaper4K: async () => { calls.fourK++; return { artifact: context.source, target: { width: 3840, height: 2160, fit: 'cover' }, locallyAdapted: true }; },
    saveArtifact: async (id: string) => { calls.savedArtifacts.push(id); return { saved: true }; },
  };
  const props = { activeView: view, workspaceId: workspace.id, workspace, workspaces: [workspace], activeProject: context.project, projects: [context.project], trashedProjects: [], ledger: state.ledger, preferences: state.preferencesByWorkspace[workspace.id], configuration: context.configuration, prompts: [], workflowRunner: runner,
    notify: (message: string) => setNotice(message), navigate: (page: string) => { if (page === 'settings') setView('settings'); else if (page === 'images') setView('images'); else setNotice('本验收仅查看图片工具与设置'); },
    onGenerate: () => { calls.provider++; throw Error('Provider execution is forbidden in this UI acceptance'); }, onUpdateProject: () => { calls.projectPatches++; }, onUpdatePreferences: persist, onPromptApplied: () => {}, onGenerationIntentConsumed: () => {}, onUsePrompt: () => {}, onSavePrompt: () => {}, onCreateProject: () => setNotice('独立验收不创建用户项目'),
  } as unknown as PageProps;
  return <><header className="isf-header"><strong>独立样例 · 无Key · 4K另存采用计数替身</strong><nav><button className="btn btn-secondary" onClick={() => setView('images')}>图片工作台</button><button className="btn btn-secondary" onClick={() => setView('settings')}>设置</button><button className="btn btn-secondary" onClick={() => setView('commerce')}>高清编辑样例</button><button className="btn btn-secondary" onClick={() => setAppearanceMode('light')}>白天</button><button className="btn btn-secondary" onClick={() => setAppearanceMode('dark')}>黑夜</button></nav></header><main className={`app-content isf-content isf-${view}`}>{notice && <p className="isf-notice" role="status">{notice}</p>}{view === 'settings' ? <Settings {...props} /> : view === 'commerce' ? <CommerceLayerEditor props={props} projectId={context.project.id} sourceArtifactId={context.clearSource.id} /> : <ImageStudio {...props} />}</main></>;
}
const style = document.createElement('style'); style.textContent = 'html,body,#root{height:100%;min-width:0;margin:0}#root{display:flex;flex-direction:column}.isf-header{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:60px;padding:10px 20px;border-bottom:1px solid var(--ui-border);background:var(--ui-surface);flex-shrink:0}.isf-header>strong{font-size:13px}.isf-header>nav{display:flex;gap:7px;flex-wrap:wrap}.isf-header .btn{font-size:13px}.isf-content{flex:1;min-height:0;min-width:0;overflow:auto;padding:0}.isf-content.isf-images,.isf-content.isf-commerce{display:flex;flex-direction:column}.isf-images>.image-studio-page,.isf-commerce>.commerce-layer-editor{flex:1;min-height:0}.isf-notice{padding:9px 20px;margin:0;font-size:13px;background:var(--ui-info-bg);flex-shrink:0}.isf-settings .op-page{min-width:0}@media(max-width:1100px){.isf-header{flex-wrap:wrap;gap:8px}}'; document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
