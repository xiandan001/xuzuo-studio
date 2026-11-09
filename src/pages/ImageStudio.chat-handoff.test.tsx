// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageStudio } from './ImageStudio';
import { beadUiBridge, beadUiPage } from '../lib/bead-ui-fixtures';
import { animationBackend, animationDomSetup } from '../components/animation/animation-test-fixtures';
import { imageDraftKey, imageTaskRequest, readImageDraft } from '../lib/image-studio';
import type { PageProps, PromptApplication } from '../types';

let root: Root | undefined, host: HTMLDivElement, scrollDescriptor: PropertyDescriptor | undefined;
beforeEach(() => { localStorage.clear(); animationDomSetup(); scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView'); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Handoff must not call a provider'); })); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); localStorage.clear(); Reflect.deleteProperty(window, 'desktop'); if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(props: PageProps) { await act(async () => { root ||= createRoot(host); root.render(<ImageStudio {...props} />); }); }
function application(props: PageProps, imagePreset: string, files = props.activeProject.referenceFiles || []): PromptApplication { return { token: crypto.randomUUID(), projectId: props.activeProject.id, category: 'image', content: '让橘猫挥手；仅清理左下角，其他细节保留', mode: 'create', imagePreset, referenceFiles: files }; }
function pictureFixture(projectId = 'handoff-image') {
  const f = beadUiPage(projectId), { props, reference, project } = f;
  props.activeProject = { ...project, referenceFiles: [reference] }; props.projects = [props.activeProject];
  props.workflowRunner.inspectImageArtifact = vi.fn(async id => ({ id, mimeType: 'image/png', bytes: reference.bytes }));
  return { ...f, props };
}

describe('首页场景到实际图片工作台的交互承接', () => {
  it.each(['壁纸', '工程P图'])('%s携带明确的本轮参考图，不再只登记项目资料', async preset => {
    const f = pictureFixture(); f.props.promptToApply = application(f.props, preset); const fees = JSON.stringify(f.ledger);
    await mount(f.props); await vi.waitFor(() => expect(f.props.onPromptApplied).toHaveBeenCalledWith(f.props.promptToApply!.token));
    const draft = readImageDraft(localStorage.getItem(imageDraftKey(f.project.id)), ''); expect(draft.preset).toBe(preset); expect(draft.references).toEqual([{ id: f.reference.id, name: f.reference.name }]);
    expect(imageTaskRequest(draft).parameters.attachmentIds).toContain(f.reference.id); if (preset === '工程P图') expect(host.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain(f.reference.name);
    expect(f.onGenerate).not.toHaveBeenCalled(); expect(JSON.stringify(f.ledger)).toBe(fees); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([['角色图集', 'atlas'], ['GIF动画工坊', 'gif']] as const)('%s真正进入原生工坊并把参考交给实际编辑hook，进入不生成', async (preset, mode) => {
    const backend = animationBackend({ projectId: `handoff-${mode}`, revision: 0 }), props = backend.props;
    props.preferences = {} as PageProps['preferences']; props.prompts = []; props.onGenerate = vi.fn(); props.onPromptApplied = vi.fn(); props.configuration.categories = []; props.configuration.workflows = []; props.configuration.studioActions = []; props.configuration.useTemplates = [];
    props.workflowRunner.runs = []; props.workflowRunner.runtimeStatus = { available: true }; props.workflowRunner.trashedArtifacts = []; props.workflowRunner.inspectImageArtifact = vi.fn(async id => ({ id, mimeType: 'image/png', bytes: 200 }));
    props.activeProject = { ...backend.project, referenceFiles: backend.artifacts }; props.projects = [props.activeProject]; props.promptToApply = application(props, preset);
    Object.defineProperty(window, 'desktop', { configurable: true, value: { animation: backend.bridge } }); await mount(props);
    await vi.waitFor(() => expect(host.querySelector('[aria-label="动画创作需求"]')).not.toBeNull());
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('保存编辑'))!; await act(async () => save.click());
    expect(backend.bridge.read).toHaveBeenCalled(); expect(backend.document.mode).toBe(mode); expect(backend.document.referenceArtifactIds).toEqual(['reference-one']); expect(backend.document.prompt).toContain('让橘猫挥手');
    expect(backend.bridge.generate).not.toHaveBeenCalled(); expect(props.onGenerate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('拼豆实际打开并免费读取本轮底图，不自动制图或调用AI', async () => {
    const f = pictureFixture('handoff-beads'), backend = beadUiBridge(); f.props.promptToApply = application(f.props, '拼豆');
    Object.defineProperty(window, 'desktop', { configurable: true, value: { beads: backend.bridge } }); await mount(f.props);
    await vi.waitFor(() => expect(backend.bridge.source).toHaveBeenCalledWith({ projectId: f.project.id, referenceId: f.reference.id }));
    expect(host.textContent).toContain('拼豆'); expect(backend.bridge.generate).not.toHaveBeenCalled(); expect(f.onGenerate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('拼豆原工程读取异常时，不把它当新工程自动换底图', async () => {
    const f = pictureFixture('handoff-beads-unreadable'), backend = beadUiBridge(); f.props.promptToApply = application(f.props, '拼豆');
    vi.mocked(backend.bridge.read).mockRejectedValueOnce(Error('原工程暂时无法安全读取'));
    Object.defineProperty(window, 'desktop', { configurable: true, value: { beads: backend.bridge } }); await mount(f.props);
    await vi.waitFor(() => expect(host.textContent).toContain('原工程暂时无法安全读取')); expect(backend.bridge.source).not.toHaveBeenCalled(); expect(backend.bridge.generate).not.toHaveBeenCalled(); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('已有手工选择不被场景覆盖，切到精修不混入原始生成参考', async () => {
    const f = pictureFixture('handoff-preserve'), manual = { id: 'manual-reference', name: '用户自己选的图.png' };
    localStorage.setItem(imageDraftKey(f.project.id), JSON.stringify({ preset: '宣传图', mode: 'create', prompt: '已有描述', refinePrompt: '调整当前成品', references: [manual] }));
    f.props.promptToApply = application(f.props, '宣传图'); await mount(f.props); const before = readImageDraft(localStorage.getItem(imageDraftKey(f.project.id)), ''); expect(before.references).toEqual([manual]);
    const refine = [...host.querySelectorAll<HTMLButtonElement>('.ig-mode-tabs button')].find(button => button.textContent?.includes('精修图片'))!; await act(async () => refine.click());
    const after = readImageDraft(localStorage.getItem(imageDraftKey(f.project.id)), ''); expect(after.mode).toBe('refine'); expect(after.references).toEqual([]); expect(after.referenceDrafts?.create?.references).toEqual([manual]); expect(f.onGenerate).not.toHaveBeenCalled();
  });
});
