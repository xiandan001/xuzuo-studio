// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatBridge, ChatChangedEvent, ChatConversation, ChatQueueManageRequest, ChatQueueRequest, ChatStartRequest, ChatTurn } from '../chat-types';
import type { PageProps } from '../types';
import { ChatMessagePair, WorkspaceChat } from './WorkspaceChat';
const staticReferences = vi.hoisted(() => ({ svg: vi.fn(), gif: vi.fn() }));
vi.mock('../lib/svg-reference', () => ({ prepareSvgReference: staticReferences.svg }));
vi.mock('../lib/generated-animation-reference', () => ({ prepareAnimationReference: staticReferences.gif }));

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { staticReferences.svg.mockReset(); staticReferences.gif.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); localStorage.clear(); host = document.createElement('div'); document.body.append(host); vi.stubGlobal('fetch', vi.fn(() => { throw Error('UI tests must not use the network'); })); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const now = () => new Date().toISOString();
async function input(value: string) {
  const field = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function addFiles() { await click('添加聊天附件'); await click('本机文件'); }
async function fixture(modelId = 'gpt-6.1-terra', vision = false, editTarget = false, targetMime = 'image/png', queueEnabled = false, initial?: { turns: ChatTurn[]; searchIndex: number }) {
  const workspaceId = crypto.randomUUID(), listeners = new Set<(event: ChatChangedEvent) => void>();
  let record: ChatConversation | undefined = initial ? { version: 1, id: 'long-conversation', workspaceId, title: '长聊天验收', createdAt: now(), updatedAt: now(), turnCount: initial.turns.length, turns: initial.turns } : undefined;
  const connection = { id: 'connection', name: 'OpenAI', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
  const model = { id: 'model', connectionId: 'connection', name: '测试对话模型', modelId, capabilities: vision ? ['text', 'vision'] : ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'USD', input: '1', output: '2' } };
  const createProject = vi.fn();
  const read = vi.fn(async ({ conversationId }: { conversationId: string }) => record ||= { version: 1, id: conversationId, workspaceId, title: '新对话', createdAt: now(), updatedAt: now(), turnCount: 0, turns: [] });
  const start = vi.fn(async (request: ChatStartRequest) => {
    const turn: ChatTurn = { id: request.id, userText: request.text, text: '', status: 'running', createdAt: now(), updatedAt: now(), modelName: request.model.name, modelId: request.model.modelId, modelConfigId: request.model.id, credentialId: request.credentialId, reasoningEffort: request.reasoningEffort, mode: request.mode, costCents: 0, costState: 'unknown', ...(request.attachmentIds?.includes('source-chat-material') ? { attachments: [material], contextAttachments: [material] } : {}) };
    record = { ...record!, turns: [...record!.turns, turn], turnCount: record!.turns.length + 1, title: request.text.slice(0, 24) }; return structuredClone(record);
  });
  const cancel = vi.fn(async () => { record!.turns.at(-1)!.status = 'cancelled'; return structuredClone(record!); });
  const target = { projectId: 'source-project', artifactId: 'source-artifact', sha256: 'a'.repeat(64), kind: 'image' }, sourceFile = { id: target.artifactId, projectId: target.projectId, name: '保存的海报.' + (targetMime === 'image/gif' ? 'gif' : targetMime === 'image/svg+xml' ? 'svg' : 'png'), mimeType: targetMime, bytes: 100, kind: 'image', path: 'artifact.png', createdAt: now() };
  const material: ChatAttachment = { id: 'source-chat-material', name: targetMime === 'image/png' ? sourceFile.name : '静态参考.png', mimeType: 'image/png', bytes: sourceFile.bytes, kind: 'image', sha256: target.sha256, createdAt: now() };
  const bridge = { read, start, cancel, selectTarget: vi.fn(async () => ({ target, inspection: { artifact: sourceFile, sha256: target.sha256 } })), inspectTarget: vi.fn(async () => ({ artifact: sourceFile, sha256: target.sha256 })), linkProduction: vi.fn(async (request: Parameters<ChatBridge['linkProduction']>[0]) => { record = { ...record!, productions: [{ ...request, createdAt: now() }] }; return record; }), importProjectArtifact: vi.fn(async () => [material]), importBytes: vi.fn(async () => [material]), search: vi.fn(async () => ({ items: [], total: 0, scanned: 0 })), importAttachments: vi.fn(async () => [] as ChatAttachment[]), previewAttachment: vi.fn(async () => ({ mimeType: 'text/plain', text: '本地原文' })), attachToProject: vi.fn(async () => [{ id: 'project-ref', name: '原图.png', mimeType: 'image/png', bytes: 100, kind: 'image', projectId: 'created-project' }]), list: vi.fn(async () => []), ledger: vi.fn(async () => []), onChanged(listener: (event: ChatChangedEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); } };
  const queueEnqueue = vi.fn(async (request: ChatQueueRequest) => {
    const queue = [...(record!.queue || []), { id: request.id, text: request.text, requestText: request.requestText, sceneName: request.sceneName, modelName: request.model.name, modelConfigId: request.model.id, credentialId: request.credentialId, reasoningEffort: request.reasoningEffort, mode: request.mode || 'chat' as const, attachments: [], status: 'queued' as const, createdAt: now(), updatedAt: now() }];
    record = { ...record!, queue, queuedCount: queue.length }; return structuredClone(record);
  });
  const queueManage = vi.fn(async (request: ChatQueueManageRequest) => {
    const queue = structuredClone(record!.queue || []), item = queue.find(item => item.id === request.id);
    if (request.action === 'withdraw') record = { ...record!, queue: queue.filter(item => item.id !== request.id) };
    else { if (item && request.action === 'pause') { item.status = 'paused'; item.editing = true; } if (item && request.action === 'edit') { item.text = request.text!; item.status = 'queued'; item.editing = false; } record = { ...record!, queue }; }
    return structuredClone(record!);
  });
  if (queueEnabled) Object.assign(bridge, { enqueue: queueEnqueue, manageQueue: queueManage });
  vi.stubGlobal('desktop', { chat: bridge }); Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: bridge } });
  const props = { workspaceId, workspace: { id: workspaceId, name: '无项目工作区' }, workspaces: [], projects: [], purgedProjects: [], activeProject: { id: '' }, configuration: { connections: [connection], models: [model], credentials: [{ id: 'key', connectionId: 'connection', name: '自己的账户', lastFour: '1234', enabled: true }], workflows: [], categories: [] }, workflowRunner: { runs: [] }, ledger: [], preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: createProject, onUpdateProject: vi.fn(), onUsePrompt: vi.fn() } as unknown as PageProps;
  if (initial) { props.searchTarget = { token: 'search-initial', name: '长聊天验收', kind: 'chat', id: 'long-conversation', conversationId: 'long-conversation', turnId: initial.turns[initial.searchIndex]?.id, workspaceId }; props.onSearchTargetConsumed = vi.fn(); }
  const preflight = vi.fn(async () => ({ ok: true, errors: [] })), startLive = vi.fn(async () => ({ status: 'started', runId: 'refinement-run' }));
  if (editTarget) {
    props.chatIntent = { token: 'intent', workspaceId, conversationId: 'target-conversation', projectId: target.projectId, artifactId: target.artifactId, kind: 'image', name: sourceFile.name };
    props.projects = [{ id: target.projectId, workspaceId, name: '原海报项目', kind: 'image', status: 'complete' } as PageProps['activeProject']];
    props.configuration.models.push({ ...model, id: 'image-model', name: '图片精修模型', modelId: 'image-model', capabilities: ['image-editing'] } as PageProps['configuration']['models'][number]);
    props.workflowRunner = { ...props.workflowRunner, preflight, startLive } as unknown as PageProps['workflowRunner'];
  }
  await act(async () => { root = createRoot(host); root.render(<WorkspaceChat props={props} onLegacy={vi.fn()} />); });
  async function update(text: string, status: ChatTurn['status'] = 'running') {
    const turn = { ...record!.turns.at(-1)!, text, status, updatedAt: `${now()}-${text.length}` };
    record = { ...record!, turns: [...record!.turns.slice(0, -1), turn] };
    await act(async () => { for (const listener of listeners) listener({ workspaceId, conversationId: record!.id, turn, updatedAt: turn.updatedAt, title: record!.title, ledgerChanged: status !== 'running' }); });
  }
  return { start, read, cancel, createProject, update, props, bridge, preflight, startLive, queueEnqueue, queueManage };
}
describe('普通聊天的真实组件交互', () => {
  it('制作结果增高时跟随聊天底部，向上阅读时保留当前位置', async () => {
    const resizeCallbacks = new Map<Element, () => void>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly resize: () => void) {}
      observe(element: Element) { resizeCallbacks.set(element, this.resize); }
      disconnect() {
        for (const [element, resize] of resizeCallbacks) if (resize === this.resize) resizeCallbacks.delete(element);
      }
    });
    await fixture();
    await input('保留对话底部');
    await click('发送聊天消息');
    const thread = host.querySelector<HTMLDivElement>('.workspace-chat-thread')!;
    const turn = thread.querySelector('.chat-turn-container')!;
    let height = 500, position = 200;
    Object.defineProperties(thread, {
      clientHeight: { value: 300 },
      scrollHeight: { get: () => height },
      scrollTop: {
        get: () => position,
        set: (value: number) => { position = Math.min(value, height - thread.clientHeight); },
      },
    });
    const resizeTurn = resizeCallbacks.get(turn);
    expect(resizeTurn).toBeDefined();

    height = 720;
    resizeTurn?.();
    expect(thread.scrollTop).toBe(420);

    await act(async () => {
      thread.scrollTop = 100;
      thread.dispatchEvent(new Event('scroll'));
    });
    height = 910;
    resizeTurn?.();
    expect(thread.scrollTop).toBe(100);
  });

  it('copies readable reply content while preserving code and the original stored source', async () => {
    const copied = vi.fn(async (_text: string) => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copied } });
    const f = await fixture(); await input('整理提示词'); await click('发送聊天消息');
    const original = '> **主体：** 手机保持居中。\n>\n> 背景保留海边。\n\n```js\nif (x > 0) power = 2 ** 3;\n```';
    await f.update(original, 'complete'); await click('复制这条回复');
    expect(copied).toHaveBeenCalledOnce(); const value = copied.mock.calls[0][0];
    expect(value).toContain('主体： 手机保持居中。'); expect(value).not.toContain('**主体'); expect(value).not.toMatch(/^>/m); expect(value).not.toContain('```');
    expect(value).toContain('if (x > 0) power = 2 ** 3;');
    expect((await f.read({ conversationId: f.read.mock.calls[0][0].conversationId })).turns.at(-1)?.text).toBe(original);
    expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it.each(['image/svg+xml', 'image/gif'])('讨论 %s 前先免费准备静态参考，成功后才允许带图发送', async mime => {
    const prepared = { sourceSha256: 'a'.repeat(64), reference: { id: 'prepared-reference', projectId: 'source-project', mimeType: 'image/png' } };
    const prepare = mime === 'image/gif' ? staticReferences.gif : staticReferences.svg; prepare.mockResolvedValue(prepared);
    const f = await fixture('gpt-6.1-terra', true, true, mime); expect(f.bridge.importProjectArtifact).not.toHaveBeenCalled(); await click('先讨论');
    expect(prepare).toHaveBeenCalledOnce(); expect(f.bridge.importProjectArtifact).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'source-project', artifactId: 'prepared-reference' })); expect(host.textContent).toContain('静态参考，仅评价画面，不检查动画时序'); expect(f.start).not.toHaveBeenCalled();
    await input('主体配色是否清楚？'); await click('发送聊天消息'); expect(f.start.mock.calls[0][0].attachmentIds).toEqual(['source-chat-material']); expect(f.startLive).not.toHaveBeenCalled();
    await f.update('配色清楚', 'complete'); await input('再讨论标题的位置'); await click('发送聊天消息'); expect(prepare).toHaveBeenCalledOnce(); expect(f.bridge.importProjectArtifact).toHaveBeenCalledOnce(); expect(f.start).toHaveBeenCalledTimes(2);
  });
  it('本地工坊GIF不能准备参考时明确转回工坊，不发空图也不调用模型', async () => {
    staticReferences.gif.mockRejectedValue(Error('这份GIF来自本地工坊，不能作为原生动画继续修改。'));
    const f = await fixture('gpt-6.1-terra', true, true, 'image/gif'); await click('先讨论'); expect(host.textContent).toContain('未发送聊天或调用模型'); expect(f.bridge.importProjectArtifact).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled(); await click('打开 GIF 工坊修改');
    expect(f.props.onUsePrompt).toHaveBeenCalledWith(expect.objectContaining({ imagePreset: 'GIF动画工坊' }), '', 'source-project'); expect(f.startLive).not.toHaveBeenCalled();
  });
  it('历史管理使用独立浮层，关闭后不改变当前对话和输入区', async () => {
    const f = await fixture(); await input('留在输入框里的草稿'); await click('聊天历史');
    expect(document.querySelector('[role="dialog"][aria-label="聊天记录"]')).toBeTruthy(); expect(host.querySelector('.chat-history-sidebar')).toBeNull(); expect(host.querySelector('[aria-label="聊天内容"]')).toBeTruthy();
    await click('关闭聊天记录'); expect(document.querySelector('[role="dialog"][aria-label="聊天记录"]')).toBeNull(); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toBe('留在输入框里的草稿'); expect(f.start).not.toHaveBeenCalled();
  });
  it('附件先选择来源，打开菜单不触发导入，Esc可收起', async () => {
    const f = await fixture(); await click('添加聊天附件'); expect(f.bridge.importAttachments).not.toHaveBeenCalled(); expect(host.textContent).toContain('本机文件'); expect(host.textContent).toContain('素材库'); expect(host.textContent).toContain('项目成品／资料');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(host.querySelector('[aria-label="附件来源"]')).toBeNull(); expect(f.start).not.toHaveBeenCalled();
  });
  it('粘贴截图和拖入附件传真实字节，选入过程不发送或建项目', async () => {
    const f = await fixture(); const file = new File(['pixels'], '截图.png', { type: 'image/png' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer });
    const paste = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { files: [file] } }); await act(async () => host.querySelector('[aria-label="聊天内容"]')!.dispatchEvent(paste));
    expect(f.bridge.importBytes).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: '截图.png', bytes: new Uint8Array([1, 2, 3]) })] }));
    const drop = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } }); await act(async () => host.querySelector('form[aria-label="聊天输入"]')!.dispatchEvent(drop)); expect(f.bridge.importBytes).toHaveBeenCalledTimes(2); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('正在聊天也能进入专用工具，不被停止回复按钮挡住', async () => {
    const f = await fixture(); await input('先继续帮我讨论'); await click('发送聊天消息'); await click('选择使用场景'); await click('使用场景 工程P图');
    f.bridge.importAttachments.mockResolvedValue([{ id: 'original', name: '工程.png', mimeType: 'image/png', bytes: 100, kind: 'image', sha256: 'd'.repeat(64), createdAt: now() }]); await addFiles(); await click('进入工程P图');
    expect(f.createProject).toHaveBeenCalledOnce(); expect(f.cancel).not.toHaveBeenCalled(); expect(f.start).toHaveBeenCalledOnce();
  });
  it('成品精修必须填写指令，直接提交独立修订而不额外发送聊天', async () => {
    const f = await fixture('gpt-6.1-terra', false, true); const button = host.querySelector<HTMLButtonElement>('[aria-label="开始精修选定成品"]')!;
    expect(button).toBeTruthy(); expect(button.disabled).toBe(true); expect(host.textContent).toContain('保存的海报.png'); await input('只把背景换成浅灰，保留产品与标题'); await click('开始精修选定成品');
    expect(f.preflight).toHaveBeenCalledOnce(); expect(f.startLive).toHaveBeenCalledOnce(); expect(f.bridge.linkProduction).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ artifactId: 'source-artifact', sha256: 'a'.repeat(64) }), runId: 'refinement-run' })); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('精修提交等待期间继续输入的新草稿不会被成功回执清除', async () => {
    const f = await fixture('gpt-6.1-terra', false, true); let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
    f.startLive.mockImplementation(async () => { await paused; return { status: 'started', runId: 'refinement-run' }; });
    await input('只调整背景'); await click('开始精修选定成品'); await input('下一轮还想调整标题'); await act(async () => release());
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toBe('下一轮还想调整标题'); expect(f.startLive).toHaveBeenCalledOnce(); expect(f.start).not.toHaveBeenCalled();
  });
  it('专用场景进入时才创建项目，复制真实原图后明确透传，不调用聊天模型', async () => {
    const f = await fixture(); await click('选择使用场景'); await click('使用场景 工程P图'); expect(f.createProject).not.toHaveBeenCalled();
    await click('进入工程P图'); expect(f.createProject).not.toHaveBeenCalled(); expect(host.textContent).toContain('至少 1 张');
    f.bridge.importAttachments.mockResolvedValue([{ id: 'original', name: '工程.png', mimeType: 'image/png', bytes: 100, kind: 'image', sha256: 'd'.repeat(64), createdAt: now() }]); await addFiles(); await click('进入工程P图'); expect(f.createProject).toHaveBeenCalledOnce();
    await act(async () => { f.createProject.mock.calls[0][1].onCreated({ id: 'created-project', workspaceId: f.props.workspaceId, kind: 'image', name: '工程P图' }); });
    expect(f.bridge.attachToProject).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['original'], projectId: 'created-project' }));
    expect(f.props.onUsePrompt).toHaveBeenCalledWith(expect.objectContaining({ imagePreset: '工程P图' }), expect.any(String), 'created-project', expect.objectContaining({ referenceFiles: [expect.objectContaining({ id: 'project-ref' })] })); expect(f.start).not.toHaveBeenCalled();
  });
  it('附件添加和移除不调用模型、不创建项目；仅附件可发送实际ID', async () => {
    const f = await fixture('gpt-6.1-terra', true);
    const image: ChatAttachment = { id: 'original', name: '产品原图.png', mimeType: 'image/png', bytes: 1024, kind: 'image', sha256: 'a'.repeat(64), createdAt: now() };
    f.bridge.importAttachments.mockResolvedValue([image]); await addFiles();
    expect(host.textContent).toContain('产品原图.png'); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
    await click('发送聊天消息'); expect(f.start.mock.calls[0][0].attachmentIds).toEqual(['original']); expect(f.start.mock.calls[0][0].text).toContain('附件'); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('文字模型遇到明确图片附件在收费前拒绝，原图与草稿保留', async () => {
    const f = await fixture(); f.bridge.importAttachments.mockResolvedValue([{ id: 'image', name: '截图.png', mimeType: 'image/png', bytes: 100, kind: 'image', sha256: 'b'.repeat(64), createdAt: now() }]);
    await addFiles(); await input('看一下这张图'); await click('发送聊天消息');
    expect(f.start).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toContain('支持看图'); expect(host.textContent).toContain('截图.png');
    await click('移除附件 截图.png'); expect(host.textContent).not.toContain('截图.png'); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('场景选择不发送，资料解读的基础要求与用户原文分开提交', async () => {
    const f = await fixture(); await click('选择使用场景'); await click('使用场景 资料解读');
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
    f.bridge.importAttachments.mockResolvedValue([{ id: 'doc', name: '需求.txt', mimeType: 'text/plain', bytes: 30, kind: 'text', sha256: 'c'.repeat(64), createdAt: now() }]);
    await addFiles(); await input('列出交付要求'); await click('发送聊天消息');
    expect(f.start.mock.calls[0][0].text).toBe('列出交付要求'); expect(f.start.mock.calls[0][0].requestText).toContain('不补造'); expect(f.start.mock.calls[0][0].attachmentIds).toEqual(['doc']);
  });
  it('发送确认较慢时，保留下一条输入并移除已提交且未更改的附件', async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    f.bridge.importAttachments.mockResolvedValue([{ id: 'reference-text', name: '本轮参考.txt', mimeType: 'text/plain', bytes: 20, kind: 'text', sha256: 'a'.repeat(64), createdAt: now() }]);
    await addFiles();
    let release!: () => void;
    f.start.mockImplementation(async request => { const value = await original(request); await new Promise<void>(resolve => { release = resolve; }); return value; });
    await input('已经提交的问题'); await click('发送聊天消息'); await input('下一条正在打的内容');
    await act(async () => { release(); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toBe('下一条正在打的内容');
    expect(host.querySelector('.workspace-chat-composer [aria-label="移除附件 本轮参考.txt"]')).toBeNull();
    expect(f.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attachmentIds: ['reference-text'] }));
  });
  it('无项目可连续聊天，流式增量不重复读取整段历史，也不创建目录', async () => {
    const f = await fixture(); await input('你好，帮我想一句产品介绍'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.start.mock.calls[0][0].mode).toBe('chat'); expect(f.createProject).not.toHaveBeenCalled();
    for (const text of ['清', '清新', '清新一天']) await f.update(text);
    expect(host.textContent).toContain('清新一天'); expect(f.read).toHaveBeenCalledOnce();
    await f.update('清新一天', 'complete'); await input('再简短一点'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('已排队的尾部跟随在用户上滚阅读后不能把消息和结果再次拉到底部', async () => {
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    const flushFrames = async () => { const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const callback of pending) callback(1); }); };
    const f = await fixture(); await input('保留当前阅读位置'); await click('发送聊天消息');
    const thread = host.querySelector<HTMLDivElement>('.workspace-chat-thread')!;
    Object.defineProperties(thread, { scrollHeight: { configurable: true, value: 2400 }, clientHeight: { configurable: true, value: 400 } });
    thread.scrollTop = 2000; await act(async () => { thread.dispatchEvent(new Event('scroll', { bubbles: true })); });
    await f.update('正在回答，尾部跟随已排进动画帧'); expect(frames.size).toBeGreaterThan(0);
    thread.scrollTop = 800; await act(async () => { thread.dispatchEvent(new Event('scroll', { bubbles: true })); });
    await flushFrames(); expect(thread.scrollTop).toBe(800);
    thread.scrollTop = 2000; await act(async () => { thread.dispatchEvent(new Event('scroll', { bubbles: true })); });
    await f.update('用户主动回到底部后，后续回复仍能正常跟随'); await flushFrames(); expect(thread.scrollTop).toBe(2400);
    expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled(); expect(f.props.ledger).toEqual([]);
  });
  it('停止保留部分回答；再次回答使用新请求编号且明确是重试', async () => {
    const f = await fixture(); await input('写一段介绍'); await click('发送聊天消息'); await f.update('已经写出的内容'); await click('停止回复');
    expect(f.cancel).toHaveBeenCalledOnce(); expect(host.textContent).toContain('已经写出的内容'); await click('重新回答');
    const [first, second] = f.start.mock.calls.map(call => call[0]); expect(second.id).not.toBe(first.id); expect(second.sourceTurnId).toBe(first.id); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('聊天转制作将原要求与答复填入空输入框，按编辑后的文字发送', async () => {
    const f = await fixture();
    const original = '制作好看可爱的微信红包封面', reply = '奶白色小猫趴在红包上。底部加三个铃铛。';
    await input(original); await click('发送聊天消息'); await f.update(reply, 'complete'); await click('转为制作方案');
    const prefilled = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value;
    expect(prefilled).toContain(original); expect(prefilled).toContain(reply);
    expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toBe('场景：微信红包封面');
    expect(host.textContent).toContain('先出方案，确认后才制作');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled();
    const edited = prefilled.replace('底部加三个铃铛。', '底部只放一片柿子叶。');
    await input('');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="发送聊天消息"]')?.disabled).toBe(true);
    await input(edited); await click('转为制作方案');
    expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', edited);
    await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2);
    const request = f.start.mock.calls[1][0];
    expect(request).toMatchObject({ mode: 'plan', outputKind: 'image', imagePreset: '微信红包封面', text: edited });
    expect(request.requestText).toContain('底部只放一片柿子叶。');
    expect(request.requestText).not.toContain('铃铛');
    expect(f.createProject).not.toHaveBeenCalled();
  });
  it('未知模型只提供自动，账户摘要代替单Key下拉', async () => {
    const f = await fixture('unknown-model'); const reasoning = host.querySelector<HTMLButtonElement>('[aria-label="推理强度"]')!;
    expect(reasoning.disabled).toBe(true); expect(reasoning.textContent).toContain('自动'); expect(host.querySelector('[aria-label="对话Key"]')).toBeNull(); expect(host.querySelector('[aria-label="模型与账户详情"]')?.getAttribute('title')).toContain('自己的账户');
    await input('普通问题'); await click('发送聊天消息'); expect(f.start.mock.calls[0][0].reasoningEffort).toBe('auto');
  });
  it('中文输入法确认不误发，Enter发送，Shift+Enter保留换行', async () => {
    const f = await fixture(); await input('中文内容'); const field = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
    expect(f.start).not.toHaveBeenCalled(); await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); expect(f.start).toHaveBeenCalledOnce();
  });
});


describe('连续沟通的明确待发交互', () => {
  it('回复中提交补充进入单独队列，快照当前场景/模型，不强制创建项目', async () => {
    const visibleRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 300, 44));
    try {
      const f = await fixture('gpt-6.1-terra', false, false, 'image/png', true);
      await input('先讨论第一份要求'); await click('发送聊天消息');
      expect(host.querySelector<HTMLButtonElement>('button[aria-label="推理强度"]')!.disabled).toBe(false); await click('推理强度');
      const high = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent?.includes('思考：深入'))!; await act(async () => high.click());
      await input('回复完成后继续这条要求'); await click('排队发送消息');
      expect(f.start).toHaveBeenCalledOnce(); expect(f.queueEnqueue).toHaveBeenCalledOnce(); expect(f.queueEnqueue.mock.calls[0][0]).toMatchObject({ text: '回复完成后继续这条要求', model: { id: 'model' }, credentialId: 'key', mode: 'chat', reasoningEffort: 'high', sceneName: expect.any(String) });
      expect(f.start.mock.calls[0][0].reasoningEffort).toBe('auto');
      await click('推理强度'); const low = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent?.includes('思考：轻度'))!; await act(async () => low.click());
      expect(host.querySelector('.chat-queue-summary small')!.textContent).toContain('思考：深入');
      expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', ''); expect(host.textContent).toContain('待发 1'); expect(host.textContent).toContain('回复完成后继续这条要求'); expect(f.createProject).not.toHaveBeenCalled();
      const id = f.queueEnqueue.mock.calls[0][0].id; await click('撤回待发消息 ' + id); expect(f.queueManage).toHaveBeenLastCalledWith(expect.objectContaining({ id, action: 'withdraw' })); expect(f.start).toHaveBeenCalledOnce();
    } finally { visibleRect.mockRestore(); }
  });
  it('排队确认延迟时继续输入的新草稿不会被旧回包清空', async () => {
    const f = await fixture('gpt-6.1-terra', false, false, 'image/png', true), original = f.queueEnqueue.getMockImplementation()!;
    let release!: () => void; f.queueEnqueue.mockImplementation(async request => { const value = await original(request); return new Promise<ChatConversation>(resolve => { release = () => resolve(value); }); });
    await input('第一条'); await click('发送聊天消息'); await input('已提交的待发要求'); await click('排队发送消息');
    await input('这段是用户正在写的新草稿'); await act(async () => release());
    expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '这段是用户正在写的新草稿'); expect(f.queueEnqueue).toHaveBeenCalledOnce(); expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('排队回包未知时只提供免费核对，不在点击读取后暗中发送', async () => {
    const f = await fixture('gpt-6.1-terra', false, false, 'image/png', true);
    await input('第一条'); await click('发送聊天消息'); f.queueEnqueue.mockRejectedValue(Error('lost acknowledgement')); f.read.mockRejectedValueOnce(Error('temporary read failure'));
    await input('必须保留的待发草稿'); await click('排队发送消息'); expect(host.textContent).toContain('上次排队结果尚未确认'); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '必须保留的待发草稿');
    await click('读取排队状态'); expect(f.queueEnqueue).toHaveBeenCalledOnce(); expect(f.start).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '必须保留的待发草稿'); expect(f.createProject).not.toHaveBeenCalled();
  });
});


describe('有界长聊天和保留草稿的制作引用', () => {
  function holdFrames() {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
    return async () => { const current = [...frames.values()]; frames.clear(); await act(async () => { for (const callback of current) callback(1); }); };
  }
  it('300轮命中只挂载附近20轮，前后移动和回最新均不扩大DOM，旧稿与费用不变', async () => {
    const turns: ChatTurn[] = Array.from({ length: 300 }, (_, index) => ({ id: 'turn-' + index, userText: '问题 ' + index, text: '回复正文 ' + index, status: 'complete', createdAt: new Date(1700000000000 + index * 1000).toISOString(), updatedAt: new Date(1700000000000 + index * 1000).toISOString(), modelName: '已有模型', modelId: 'gpt-6.1-terra', modelConfigId: 'model', credentialId: 'key', costCents: index + 1, costState: 'calculated' }));
    const original = structuredClone(turns), noAction = () => undefined;
    await act(async () => { root = createRoot(host); root.render(<div className="workspace-chat-thread">{turns.map(turn => <ChatMessagePair key={turn.id} turn={turn} workspaceId="baseline" conversationId="baseline" canRetry={false} onRetry={noAction} onMake={noAction} onCopy={noAction} onSaveFile={noAction} />)}</div>); });
    const before = { turns: host.querySelectorAll('.workspace-chat-turn').length, nodes: host.querySelector('.workspace-chat-thread')!.querySelectorAll('*').length };
    await act(async () => root!.unmount()); root = undefined;
    const flush = holdFrames(), f = await fixture('gpt-6.1-terra', false, false, 'image/png', false, { turns, searchIndex: 0 }); await flush();
    const ids = () => [...host.querySelectorAll<HTMLElement>('[data-chat-turn-id]')].map(node => node.dataset.chatTurnId);
    expect(ids()).toHaveLength(20); expect(ids()[0]).toBe('turn-0'); expect(host.querySelector('[data-chat-turn-id="turn-0"]')?.className).toContain('is-search-match'); expect(f.props.onSearchTargetConsumed).toHaveBeenCalledWith('search-initial');
    const after = { turns: ids().length, nodes: host.querySelector('.workspace-chat-thread')!.querySelectorAll('*').length };
    expect(before.turns).toBe(300); expect(after.nodes).toBeLessThan(before.nodes / 8);
    await input('跨页未发草稿'); await click('转为制作方案');
    const selectedDraft = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value;
    expect(selectedDraft).toContain('回复正文 0'); expect(selectedDraft.endsWith('跨页未发草稿')).toBe(true);
    await click('查看后 20 条'); await flush(); expect(ids()).toHaveLength(20); expect(ids()[0]).toBe('turn-20');
    await click('查看前 20 条'); await flush(); expect(ids()[0]).toBe('turn-0');
    for (const index of [150, 299]) { f.props.searchTarget = { ...f.props.searchTarget!, token: 'search-' + index, turnId: 'turn-' + index }; await act(async () => root!.render(<WorkspaceChat props={f.props} onLegacy={vi.fn()} />)); await flush(); expect(ids()).toHaveLength(20); expect(ids()).toContain('turn-' + index); }
    const readingThread = host.querySelector<HTMLDivElement>('.workspace-chat-thread')!; Object.defineProperty(readingThread, 'scrollHeight', { configurable: true, value: 5000 }); readingThread.scrollTop = 123;
    await click('回到最新回复'); await flush(); expect(readingThread.scrollTop).toBe(5000); expect(ids()).toHaveLength(20); expect(ids()[0]).toBe('turn-280'); expect(ids().at(-1)).toBe('turn-299');
    expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', selectedDraft);
    expect((await f.read({ conversationId: 'long-conversation' })).turns).toEqual(original); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled(); expect(f.props.ledger).toEqual([]);
    console.log('CHAT_WINDOW_DOM_MEASUREMENT ' + JSON.stringify({ totalTurns: 300, before, after, scope: 'Actual ChatMessagePair DOM under the previous search-to-first 300-turn range versus the bounded WorkspaceChat; no provider calls, not native timing' }));
  });
  it('自由聊天转制作自动选中微信红包封面，发送时带入原要求、回复、草稿和附件', async () => {
    const f = await fixture();
    const original = '制作好看可爱的微信红包封面', reply = '可以做一款「接住好运！」小猫红包封面。', draft = '底色用柿子红，保留奶白色小猫。';
    await input(original); await click('发送聊天消息'); await f.update(reply, 'complete');
    f.bridge.importAttachments.mockResolvedValue([{ id: 'cover-palette', name: '配色说明.txt', mimeType: 'text/plain', bytes: 15, kind: 'text', sha256: 'a'.repeat(64), createdAt: now() }]);
    await addFiles(); await input(draft); await click('转为制作方案');
    expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toBe('场景：微信红包封面');
    const combined = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value;
    expect(combined).toContain(original); expect(combined).toContain(reply); expect(combined.endsWith(draft)).toBe(true);
    expect(host.querySelector('[aria-label="本轮附件"]')?.textContent).toContain('配色说明.txt');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled();
    await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2);
    const request = f.start.mock.calls[1][0];
    expect(request).toMatchObject({ mode: 'plan', outputKind: 'image', text: combined, attachmentIds: ['cover-palette'] });
    for (const text of [original, reply, draft]) expect(request.requestText).toContain(text);
    expect(f.createProject).not.toHaveBeenCalled();
  });
  it('转换历史回复按所选轮次识别场景，允许手动改选后发送制作方案', async () => {
    const f = await fixture();
    await input('帮我制作一张 iPad 壁纸'); await click('发送聊天消息'); await f.update('推荐浅蓝色天空。', 'complete');
    await input('现在想做微信红包封面'); await click('发送聊天消息'); await f.update('可以设计小猫红包。', 'complete');
    await click('转为制作方案');
    expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toBe('场景：壁纸');
    expect(host.querySelector('[aria-label="发送聊天消息"]')).toBeTruthy();
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.createProject).not.toHaveBeenCalled();
    await click('选择使用场景'); await click('使用场景 PPT 演示');
    expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toBe('场景：PPT 演示');
    expect(f.start).toHaveBeenCalledTimes(2);
    await click('发送聊天消息');
    expect(f.start.mock.calls[2][0]).toMatchObject({ mode: 'plan', outputKind: 'ppt' });
    expect(f.start.mock.calls[2][0].imagePreset).toBeUndefined();
    expect(f.start.mock.calls[2][0].requestText).toContain('推荐浅蓝色天空。');
    expect(f.start.mock.calls[2][0].requestText).not.toContain('可以设计小猫红包。');
  });
  it('放不进输入框的回复可取消引用并随草稿恢复，发送前不调用模型', async () => {
    const f = await fixture(); await input('先讨论作品'); await click('发送聊天消息'); await f.update('回复中的完整创作方向' + '详细说明'.repeat(2600), 'complete');
    f.bridge.importAttachments.mockResolvedValue([{ id: 'quoted-material', name: '新需求.txt', mimeType: 'text/plain', bytes: 15, kind: 'text', sha256: 'a'.repeat(64), createdAt: now() }]); await addFiles(); await input('我正在写的新要求'); await click('转为制作方案');
    expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '我正在写的新要求'); expect(host.textContent).toContain('新需求.txt'); expect(f.start).toHaveBeenCalledOnce();
    await act(async () => root!.unmount()); root = undefined; await act(async () => { root = createRoot(host); root.render(<WorkspaceChat props={f.props} onLegacy={vi.fn()} />); });
    expect(host.querySelector('[aria-label="引用的沟通内容"]')).toBeTruthy(); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '我正在写的新要求'); expect(host.textContent).toContain('新需求.txt');
    await click('取消回复引用'); expect(host.querySelector('[aria-label="引用的沟通内容"]')).toBeNull(); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '我正在写的新要求'); expect(host.textContent).toContain('新需求.txt'); expect(f.start).toHaveBeenCalledOnce();
    await click('转为制作方案'); const original = f.start.getMockImplementation()!; let release!: () => void; f.start.mockImplementation(async request => { const value = await original(request); return new Promise<ChatConversation>(resolve => { release = () => resolve(value); }); });
    await click('发送聊天消息'); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '我正在写的新要求'); expect(host.textContent).toContain('新需求.txt'); expect(host.querySelector('[aria-label="引用的沟通内容"]')).toBeTruthy();
    const request = f.start.mock.calls[1][0]; expect(request.text).toBe('我正在写的新要求'); expect(request.requestText).toContain('回复中的完整创作方向'); expect(request.requestText!.endsWith(request.text)).toBe(true); expect(request.attachmentIds).toEqual(['quoted-material']); expect(request.mode).toBe('plan');
    await act(async () => release()); expect(host.querySelector('[aria-label="引用的沟通内容"]')).toBeNull(); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', ''); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('超长引用不静默截断或发送，用户明确改用片段后才提交，原文和草稿保持', async () => {
    const f = await fixture(), full = '完整原文'.repeat(5100) + '最后的精确要求 TAIL'; await input('讨论完整内容'); await click('发送聊天消息'); await f.update(full, 'complete'); await input('我补充的需求'); await click('转为制作方案'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledOnce(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('本轮内容过长'); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '我补充的需求'); expect((await f.read({ conversationId: f.read.mock.calls[0][0].conversationId })).turns[0].text).toBe(full);
    await click('调整引用'); const field = host.querySelector<HTMLTextAreaElement>('[aria-label="引用重点片段"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '最后的精确要求 TAIL'); field.dispatchEvent(new Event('input', { bubbles: true })); }); await click('使用此片段'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.start.mock.calls[1][0].requestText).toContain('最后的精确要求 TAIL'); expect(f.start.mock.calls[1][0].requestText!.length).toBeLessThanOrEqual(20000); expect(f.start.mock.calls[1][0].text).toBe('我补充的需求'); expect((await f.read({ conversationId: f.read.mock.calls[0][0].conversationId })).turns[0].text).toBe(full); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('空聊天的无轮次搜索也会消费intent，不反复准备窗口或发送', async () => {
    const flush = holdFrames(), f = await fixture('gpt-6.1-terra', false, false, 'image/png', false, { turns: [], searchIndex: 0 }); await flush();
    expect(f.props.onSearchTargetConsumed).toHaveBeenCalledWith('search-initial'); expect(host.querySelector('[aria-label="聊天内容"]')).toBeTruthy(); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('引用和输入草稿只属于原聊天与工作区，切换不会泄露，返回原聊天可继续', async () => {
    const f = await fixture(); await input('这份资料属于原聊天'); await click('发送聊天消息'); await f.update('原聊天的独立回复', 'complete'); await input('原聊天未发草稿'); await click('转为制作方案');
    const savedDraft = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value;
    expect(savedDraft).toContain('原聊天的独立回复'); expect(savedDraft.endsWith('原聊天未发草稿')).toBe(true);
    const conversationId = f.read.mock.calls[0][0].conversationId, originalWorkspace = f.props.workspaceId;
    await click('新对话'); expect(host.querySelector('[aria-label="引用的沟通内容"]')).toBeNull(); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '');
    f.props.searchTarget = { token: 'return-original', kind: 'chat', id: conversationId, name: '原聊天', conversationId, workspaceId: originalWorkspace }; await act(async () => root!.render(<WorkspaceChat props={f.props} onLegacy={vi.fn()} />));
    expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', savedDraft);
    const other = { ...f.props, workspaceId: 'other-workspace', workspace: { ...f.props.workspace, id: 'other-workspace' }, searchTarget: undefined }; await act(async () => root!.render(<WorkspaceChat props={other} onLegacy={vi.fn()} />));
    expect(host.querySelector('[aria-label="引用的沟通内容"]')).toBeNull(); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', '');
    await act(async () => root!.render(<WorkspaceChat props={f.props} onLegacy={vi.fn()} />)); expect(host.querySelector('[aria-label="聊天内容"]')).toHaveProperty('value', savedDraft); expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled();
  });

  it('调整引用可直接使用原回复内鼠标选中的文字，不把其他区域或按钮文字带入', async () => {
    const f = await fixture(); await input('保留重点'); await click('发送聊天消息'); await f.update('开头不选。需要引用的重点。结尾不选。' + '后文'.repeat(5100), 'complete'); await input('按我选择的重点制作'); await click('转为制作方案'); await click('调整引用');
    const node = host.querySelector('.chat-reply-text p')!.firstChild!;
    const selection = window.getSelection()!, range = document.createRange(); range.setStart(node, 5); range.setEnd(node, 13); selection.removeAllRanges(); selection.addRange(range);
    const exact = selection.toString(); await click('使用选中文字'); expect(host.querySelector('[aria-label="引用的沟通内容"]')?.textContent).toContain('重点片段'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.start.mock.calls[1][0].requestText).toContain(exact); expect(f.start.mock.calls[1][0].requestText).not.toContain('结尾不选'); expect(f.start.mock.calls[1][0].requestText).not.toContain('保存为文件'); expect(f.createProject).not.toHaveBeenCalled(); selection.removeAllRanges();
  });

});
