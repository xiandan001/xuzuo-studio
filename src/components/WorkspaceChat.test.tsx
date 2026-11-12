// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatBridge, ChatChangedEvent, ChatConversation, ChatStartRequest, ChatTurn } from '../chat-types';
import type { PageProps } from '../types';
import { WorkspaceChat } from './WorkspaceChat';
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
async function fixture(modelId = 'gpt-6.1-terra', vision = false, editTarget = false, targetMime = 'image/png') {
  const workspaceId = crypto.randomUUID(), listeners = new Set<(event: ChatChangedEvent) => void>();
  let record: ChatConversation | undefined;
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
  vi.stubGlobal('desktop', { chat: bridge }); Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: bridge } });
  const props = { workspaceId, workspace: { id: workspaceId, name: '无项目工作区' }, workspaces: [], projects: [], purgedProjects: [], activeProject: { id: '' }, configuration: { connections: [connection], models: [model], credentials: [{ id: 'key', connectionId: 'connection', name: '自己的账户', lastFour: '1234', enabled: true }], workflows: [], categories: [] }, workflowRunner: { runs: [] }, ledger: [], preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: createProject, onUpdateProject: vi.fn(), onUsePrompt: vi.fn() } as unknown as PageProps;
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
  return { start, read, cancel, createProject, update, props, bridge, preflight, startLive };
}
describe('普通聊天的真实组件交互', () => {
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
  it('发送确认较慢时，不会清掉用户已输入的下一条草稿', async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    let release!: () => void;
    f.start.mockImplementation(async request => { const value = await original(request); await new Promise<void>(resolve => { release = resolve; }); return value; });
    await input('已经提交的问题'); await click('发送聊天消息'); await input('下一条正在打的内容');
    await act(async () => { release(); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toBe('下一条正在打的内容'); expect(f.start).toHaveBeenCalledOnce();
  });
  it('无项目可连续聊天，流式增量不重复读取整段历史，也不创建目录', async () => {
    const f = await fixture(); await input('你好，帮我想一句产品介绍'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.start.mock.calls[0][0].mode).toBe('chat'); expect(f.createProject).not.toHaveBeenCalled();
    for (const text of ['清', '清新', '清新一天']) await f.update(text);
    expect(host.textContent).toContain('清新一天'); expect(f.read).toHaveBeenCalledOnce();
    await f.update('清新一天', 'complete'); await input('再简短一点'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('停止保留部分回答；再次回答使用新请求编号且明确是重试', async () => {
    const f = await fixture(); await input('写一段介绍'); await click('发送聊天消息'); await f.update('已经写出的内容'); await click('停止回复');
    expect(f.cancel).toHaveBeenCalledOnce(); expect(host.textContent).toContain('已经写出的内容'); await click('重新回答');
    const [first, second] = f.start.mock.calls.map(call => call[0]); expect(second.id).not.toBe(first.id); expect(second.sourceTurnId).toBe(first.id); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('聊天回复转制作先填入资料和制作模式，不因切换而创建项目或调用模型', async () => {
    const f = await fixture(); await input('先讨论产品海报'); await click('发送聊天消息'); await f.update('使用白底与蓝色标题', 'complete'); await click('转为制作方案');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toContain('使用白底与蓝色标题'); expect(host.textContent).toContain('先出方案，确认后才制作');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled(); await click('发送聊天消息');
    expect(f.start.mock.calls[1][0].mode).toBe('plan'); expect(f.start.mock.calls[1][0].text).toContain('先讨论产品海报'); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('未知模型只提供自动，账户摘要代替单Key下拉', async () => {
    const f = await fixture('unknown-model'); const reasoning = host.querySelector<HTMLButtonElement>('[aria-label="推理强度"]')!;
    expect(reasoning.disabled).toBe(true); expect(reasoning.textContent).toContain('自动'); expect(host.querySelector('[aria-label="对话Key"]')).toBeNull(); expect(host.textContent).toContain('自己的账户');
    await input('普通问题'); await click('发送聊天消息'); expect(f.start.mock.calls[0][0].reasoningEffort).toBe('auto');
  });
  it('中文输入法确认不误发，Enter发送，Shift+Enter保留换行', async () => {
    const f = await fixture(); await input('中文内容'); const field = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
    expect(f.start).not.toHaveBeenCalled(); await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); expect(f.start).toHaveBeenCalledOnce();
  });
});
