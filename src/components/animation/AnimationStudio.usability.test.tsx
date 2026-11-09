// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationStudio } from '../../pages/AnimationStudio';
import type { AnimationDocument } from '../../animation-types';
import type { PageProps } from '../../types';
import { resizeAnimationEntries } from '../../lib/animation-document';
import { animationDraftKey } from './animation-ui';
import { animationArtifact, animationBackend, animationCleanup, animationDomSetup, animationMount, button, click, fill } from './animation-test-fixtures';

beforeEach(() => { animationDomSetup(); vi.useFakeTimers(); });
afterEach(async () => { await animationCleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Backend = ReturnType<typeof animationBackend>;
const attach = (backend: Backend) => Object.defineProperty(window, 'desktop', { configurable: true, value: { animation: backend.bridge } });
const primary = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.animation-primary-actions>.btn-primary')!;
const editing = (host: HTMLElement) => host.querySelector<HTMLDetailsElement>('.animation-entry-tools')!;
async function openEditing(host: HTMLElement) { if (!editing(host).open) await click(editing(host).querySelector('summary')!); }
const noAi = (backend: Backend) => { expect(backend.bridge.generate).not.toHaveBeenCalled(); expect(backend.bridge.refine).not.toHaveBeenCalled(); };

function importedArchive(backend: Backend) {
  return { ...animationArtifact('imported-engineering', 'application/zip', backend.project.id), name: '角色工程.zip', kind: 'other' as const };
}

function prepareImportedDocument(backend: Backend, count = 3) {
  backend.document = { ...resizeAnimationEntries(backend.document, count), title: '导入的角色工程', revision: backend.document.revision + 1 };
  backend.prepare(backend.document.entries.map(entry => entry.id));
  backend.document = { ...backend.document, entries: backend.document.entries.map(entry => ({ ...entry, status: 'stale', outputArtifactId: undefined, coverArtifactId: undefined, sourceHash: undefined, renderedHash: undefined })) };
}

describe('角色与GIF工坊首次使用和本地操作', () => {
  it('空工程有步骤和示例，填入示例只改变草稿且不启动制图', async () => {
    const backend = animationBackend({ revision: 0 }); attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="atlas" />);
    const guide = host.querySelector('[aria-label="制作步骤"]')!;
    expect(guide.textContent).toContain('描述需求');
    expect(guide.textContent).toContain('制作与检查');
    expect(guide.textContent).toContain('导出作品');
    expect(primary(host).textContent).toContain('制作第一份');
    await click(button(host, '填入示例'));
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toContain('原创橘猫');
    expect(backend.bridge.save).not.toHaveBeenCalled();
    noAi(backend);
    await fill(host, '动画创作需求', '我自己写的蓝色企鹅，不要替换');
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('填入示例'))).toBe(false);
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toBe('我自己写的蓝色企鹅，不要替换');
  });

  it('已输入需求的空工程不再提供覆盖文本的示例入口', async () => {
    const backend = animationBackend(); backend.document.prompt = '保留用户自己的需求'; attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('填入示例'))).toBe(false);
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toBe('保留用户自己的需求');
    noAi(backend);
  });

  it('导入类源图缺少sourceHash与模型Key时，主按钮仍只免费更新', async () => {
    const backend = animationBackend({ ready: true });
    backend.document.entries[0].status = 'stale';
    delete backend.document.entries[0].sourceHash;
    backend.props.configuration.models = []; backend.props.configuration.credentials = []; attach(backend);
    const ledger = JSON.stringify(backend.props.ledger);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    expect(primary(host).textContent).toContain('更新预览');
    expect(primary(host).disabled).toBe(false);
    await click(primary(host));
    expect(backend.bridge.compose).toHaveBeenCalledWith({ projectId: backend.project.id, entryIds: [backend.document.entries[0].id] });
    noAi(backend);
    expect(JSON.stringify(backend.props.ledger)).toBe(ledger);
    expect(host.textContent).toContain('¥0.51');
    expect(primary(host).textContent).toContain('导出此 GIF');
  });

  it('已有GIF没有模型Key也可从主按钮导出，不会隐式重新生成', async () => {
    const backend = animationBackend({ ready: true });
    delete backend.document.entries[0].sourceHash;
    backend.props.configuration.models = []; backend.props.configuration.credentials = []; attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    expect(primary(host).disabled).toBe(false);
    await click(primary(host));
    expect(backend.bridge.compose).toHaveBeenCalledTimes(1);
    expect(backend.bridge.export).toHaveBeenCalledWith({ projectId: backend.project.id, format: 'gif', entryIds: [backend.document.entries[0].id] });
    expect(backend.props.workflowRunner.saveArtifact).toHaveBeenCalledWith('export-one');
    noAi(backend);
  });

  it('AI重新制作是显式收费请求，保留逐次确认偏好并按当前条目派发', async () => {
    const backend = animationBackend({ ready: true });
    backend.props.preferences = { ...backend.props.preferences, confirmGeneration: true } as PageProps['preferences']; attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await click(button(host, 'AI 重新制作'));
    noAi(backend);
    expect(document.querySelector('[aria-label="确认本次动画模型调用"]')?.textContent).toContain('已经发生的模型费用');
    await click(button(document, '确认并开始'));
    expect(backend.bridge.generate).toHaveBeenCalledWith({ projectId: backend.project.id, sampleOnly: true, entryIds: [backend.document.entries[0].id], retry: true });
    expect(backend.bridge.compose).not.toHaveBeenCalled();
  });

  it('关闭逐次确认时，显式AI重新制作直接派发且不经过免费更新', async () => {
    const backend = animationBackend({ ready: true });
    backend.props.preferences = { ...backend.props.preferences, confirmGeneration: false } as PageProps['preferences']; attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await click(button(host, 'AI 重新制作'));
    expect(document.querySelector('[aria-label="确认本次动画模型调用"]')).toBeNull();
    expect(backend.bridge.generate).toHaveBeenCalledWith({ projectId: backend.project.id, sampleOnly: true, entryIds: [backend.document.entries[0].id], retry: true });
    expect(backend.bridge.compose).not.toHaveBeenCalled();
  });

  it('当前PNG导出保存的是选中条目最新合成PNG，不是源图集或其它条目', async () => {
    const backend = animationBackend({ ready: true, count: 2 }); backend.document.mode = 'atlas'; attach(backend);
    const targetId = backend.document.entries[1].id;
    vi.mocked(backend.bridge.compose).mockImplementation(async input => {
      expect(input.entryIds).toEqual([targetId]);
      backend.artifacts.push(animationArtifact('latest-selected-png', 'image/png', backend.project.id));
      backend.document = { ...backend.document, revision: backend.document.revision + 1, entries: backend.document.entries.map(entry => entry.id === targetId ? { ...entry, status: 'ready', outputArtifactId: 'latest-selected-png' } : entry) };
      return backend.snapshot();
    });
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="atlas" />);
    await click(host.querySelector('[aria-label="选择角色条目 2"]')!);
    await click(primary(host));
    expect(backend.props.workflowRunner.saveArtifact).toHaveBeenCalledWith('latest-selected-png');
    expect(backend.bridge.export).not.toHaveBeenCalled();
    noAi(backend);
  });

  it('工程导入先保存当前草稿，只自动合成首条，不启动整套或模型', async () => {
    const backend = animationBackend(); const events: string[] = [];
    const save = backend.bridge.save;
    backend.bridge.save = vi.fn(async input => { events.push('save'); return save(input); });
    vi.mocked(backend.props.workflowRunner.importFiles).mockResolvedValue([importedArchive(backend)]);
    backend.bridge.importProject = vi.fn(async input => {
      events.push('import'); expect(input.expectedRevision).toBe(2);
      expect(backend.document.entries[0].caption).toBe('导入前的草稿');
      prepareImportedDocument(backend);
      return backend.snapshot();
    });
    vi.mocked(backend.bridge.compose).mockImplementation(async input => {
      events.push('compose'); expect(input.entryIds).toEqual([backend.document.entries[0].id]);
      backend.prepare(input.entryIds!); backend.document.revision++;
      return backend.snapshot();
    });
    attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await openEditing(host); await fill(host, '当前条目文案', '导入前的草稿');
    await click(button(host, '导入已有工程'));
    expect(events).toEqual(['save', 'import', 'compose']);
    expect(backend.bridge.compose).toHaveBeenCalledTimes(1);
    expect(backend.document.entries.map(entry => entry.status)).toEqual(['ready', 'stale', 'stale']);
    expect((host.querySelector('[aria-label="动画作品名称"]') as HTMLInputElement).value).toBe('导入的角色工程');
    noAi(backend);
  });

  it('导入后的本地预览失败仍采用已导入工程，并明确保留源稿', async () => {
    const backend = animationBackend();
    vi.mocked(backend.props.workflowRunner.importFiles).mockResolvedValue([importedArchive(backend)]);
    backend.bridge.importProject = vi.fn(async () => { prepareImportedDocument(backend); return backend.snapshot(); });
    vi.mocked(backend.bridge.compose).mockRejectedValue(Error('本地编码工具暂不可用'));
    attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await click(button(host, '导入已有工程'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('工程已导入，预览暂未完成');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('源稿已保留');
    expect((host.querySelector('[aria-label="动画作品名称"]') as HTMLInputElement).value).toBe('导入的角色工程');
    expect(backend.document.entries).toHaveLength(3);
    expect(primary(host).textContent).toContain('更新预览');
    noAi(backend);
  });

  it('取消文件选择不会导入或启动本地合成', async () => {
    const backend = animationBackend(); backend.bridge.importProject = vi.fn();
    vi.mocked(backend.props.workflowRunner.importFiles).mockResolvedValue([]); attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await click(button(host, '导入已有工程'));
    expect(backend.bridge.importProject).not.toHaveBeenCalled();
    expect(backend.bridge.compose).not.toHaveBeenCalled();
    noAi(backend);
  });

  it('单份成品可以直接导出，无需先认可样片', async () => {
    const backend = animationBackend({ ready: true }); attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('认可样片'))).toBe(false);
    expect(backend.document.acceptedSampleId).toBeUndefined();
    await click(primary(host));
    expect(backend.props.workflowRunner.saveArtifact).toHaveBeenCalledWith('export-one');
    noAi(backend);
  });

  it('修改当前作品的展开状态会在重新进入后保留', async () => {
    const first = animationBackend({ projectId: 'edit-first', ready: true }); attach(first);
    const { host, root } = await animationMount(<AnimationStudio props={first.props} project={first.project} initialMode="gif" />);
    expect(editing(host).open).toBe(false);
    await openEditing(host);
    expect(editing(host).open).toBe(true);
    await act(async () => root.render(<></>));
    const second = animationBackend({ projectId: 'edit-second', ready: true }); attach(second);
    await act(async () => root.render(<AnimationStudio props={second.props} project={second.project} initialMode="gif" />));
    expect(editing(host).open).toBe(true);
  });

  it('新图集采用项目名称，不沿用后台新文档的GIF默认名称', async () => {
    const backend = animationBackend({ revision: 0 }); backend.project.name = '我的原创角色图集'; attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="atlas" />);
    expect(host.querySelector('h1')?.textContent).toBe('角色图集');
    expect((host.querySelector('[aria-label="动画作品名称"]') as HTMLInputElement).value).toBe('我的原创角色图集');
    await click(button(host, '保存编辑'));
    expect(backend.document.mode).toBe('atlas');
    expect(backend.document.title).toBe('我的原创角色图集');
    noAi(backend);
  });

  it('已保存名称和动作需求不会被入口项目名或初始参数覆盖', async () => {
    const backend = animationBackend({ revision: 4 }); backend.document = { ...backend.document, mode: 'atlas', title: '已确认的工程名称', prompt: '已保存的角色需求' }; backend.project.name = '另一个项目显示名'; attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" initialPrompt="入口临时参数" />);
    expect(host.querySelector('h1')?.textContent).toBe('角色图集');
    expect((host.querySelector('[aria-label="动画作品名称"]') as HTMLInputElement).value).toBe('已确认的工程名称');
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toBe('已保存的角色需求');
    expect(backend.bridge.save).not.toHaveBeenCalled();
  });

  it('已有本地草稿名称不被新工程默认名覆盖', async () => {
    const backend = animationBackend({ revision: 0 }); backend.project.name = '新项目名称';
    const draft: AnimationDocument = { ...backend.document, mode: 'atlas', title: '尚未保存的独立草稿名', prompt: '草稿角色要求' };
    localStorage.setItem(animationDraftKey(backend.project.id), JSON.stringify({ document: draft, baseRevision: 0 })); attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="atlas" />);
    expect((host.querySelector('[aria-label="动画作品名称"]') as HTMLInputElement).value).toBe('尚未保存的独立草稿名');
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toBe('草稿角色要求');
    await click(button(host, '保存编辑'));
    expect(backend.document.title).toBe('尚未保存的独立草稿名');
    expect(backend.document.entries[0].caption).toBe(draft.entries[0].caption);
    noAi(backend);
  });

  it('全新工程不强加你好文案或挥手动作，空需求不会开始收费制作', async () => {
    const backend = animationBackend({ revision: 0 }); attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await openEditing(host);
    expect((host.querySelector('[aria-label="当前条目文案"]') as HTMLInputElement).value).toBe('');
    expect((host.querySelector('[aria-label="当前条目画面要求"]') as HTMLTextAreaElement).value).toBe('');
    expect(primary(host).disabled).toBe(true);
    await click(primary(host));
    noAi(backend);
    await fill(host, '动画创作需求', '原创小鸟轻轻点头，不加文字');
    expect(primary(host).disabled).toBe(false);
  });

  it('只有参考图的新工程可开始制作，不用无关橘猫示例替换参考用途', async () => {
    const backend = animationBackend({ revision: 0 }); attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="atlas" />);
    await click(button(host, '上传参考图'));
    expect(primary(host).disabled).toBe(false);
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('填入示例'))).toBe(false);
    noAi(backend);
  });

  it('已有角色的工程切到空条目时，不展示无法应用的初次示例', async () => {
    const backend = animationBackend({ ready: true, count: 2 });
    backend.document.entries[1] = { ...backend.document.entries[1], frames: [], status: 'draft', outputArtifactId: undefined, coverArtifactId: undefined };
    attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await click(host.querySelector('[aria-label="选择角色条目 2"]')!);
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('填入示例'))).toBe(false);
    expect(host.textContent).toContain('先做一份 GIF 样片');
    noAi(backend);
  });

  it('参考图导入未结束时阻止同一事件批次的旧制作按钮，完成后带参考开始', async () => {
    const backend = animationBackend({ revision: 0 });
    let resolveImport!: (files: typeof backend.artifacts) => void;
    vi.mocked(backend.props.workflowRunner.importFiles).mockImplementation(() => new Promise(resolve => { resolveImport = resolve; }));
    const generate = backend.bridge.generate;
    let referencesAtDispatch: string[] = [];
    backend.bridge.generate = vi.fn(async input => { referencesAtDispatch = [...backend.document.referenceArtifactIds]; return generate(input); });
    attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await fill(host, '动画创作需求', '使用我的橘猫参考图制作挥手动画');
    const staleStart = primary(host), upload = button(host, '上传参考图');
    expect(staleStart.disabled).toBe(false);
    await act(async () => {
      upload.click();
      expect(staleStart.disabled).toBe(false);
      staleStart.click();
    });
    expect(backend.props.notify).toHaveBeenCalledWith('参考图正在导入，准备好后再开始制作。');
    expect(primary(host).disabled).toBe(true);
    expect(host.querySelector('.animation-primary-actions [role="status"]')?.textContent).toContain('正在导入参考图');
    expect(backend.bridge.save).not.toHaveBeenCalled();
    noAi(backend);
    await act(async () => resolveImport([backend.artifacts[0]]));
    expect(primary(host).disabled).toBe(false);
    expect(host.querySelector('.animation-primary-actions [role="status"]')).toBeNull();
    expect(host.querySelectorAll('.animation-reference-list article')).toHaveLength(1);
    await click(primary(host));
    expect(backend.bridge.generate).toHaveBeenCalledTimes(1);
    expect(referencesAtDispatch).toEqual(['reference-one']);
    expect(backend.document.referenceArtifactIds).toEqual(['reference-one']);
    expect(backend.bridge.refine).not.toHaveBeenCalled();
  });

  it('取消未完成的参考图选择后解除制作锁定，不显示错误或调用模型', async () => {
    const backend = animationBackend({ revision: 0 });
    let resolveImport!: (files: typeof backend.artifacts) => void;
    vi.mocked(backend.props.workflowRunner.importFiles).mockImplementation(() => new Promise(resolve => { resolveImport = resolve; }));
    attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="atlas" />);
    await fill(host, '动画创作需求', '保留这个角色图片需求');
    await click(button(host, '上传参考图'));
    expect(primary(host).disabled).toBe(true);
    await act(async () => resolveImport([]));
    expect(primary(host).disabled).toBe(false);
    expect(button(host, '上传参考图').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('.animation-primary-actions [role="status"]')).toBeNull();
    expect(host.querySelectorAll('.animation-reference-list article')).toHaveLength(0);
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toBe('保留这个角色图片需求');
    noAi(backend);
  });

  it('参考图读取失败后解除锁定并保留输入，错误不会启动制图', async () => {
    const backend = animationBackend({ revision: 0 });
    let rejectImport!: (reason: Error) => void;
    vi.mocked(backend.props.workflowRunner.importFiles).mockImplementation(() => new Promise((_resolve, reject) => { rejectImport = reject; }));
    attach(backend);
    const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode="gif" />);
    await fill(host, '动画创作需求', '失败后仍应保留的动作要求');
    await click(button(host, '上传参考图'));
    expect(primary(host).disabled).toBe(true);
    await act(async () => rejectImport(Error('参考文件暂时无法读取')));
    expect(primary(host).disabled).toBe(false);
    expect(button(host, '上传参考图').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('参考文件暂时无法读取');
    expect(host.querySelector('.animation-primary-actions [role="status"]')).toBeNull();
    expect((host.querySelector('[aria-label="动画创作需求"]') as HTMLTextAreaElement).value).toBe('失败后仍应保留的动作要求');
    noAi(backend);
  });
});
