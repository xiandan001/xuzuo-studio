import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const { registerChatAttachmentHandlers } = createRequire(import.meta.url)('../../electron/chat-attachment-handlers.cjs');
const { safeName } = createRequire(import.meta.url)('../../electron/artifact-store.cjs');
const scope = { workspaceId: 'workspace', conversationId: 'conversation' };
const transfer = { ...scope, turnId: 'turn', projectId: 'project' };
const bytes = Buffer.from('保留原始附件内容\n第二行', 'utf8');
const digest = data => createHash('sha256').update(data).digest('hex');
const sourceFile = (changes = {}) => ({ id: 'attachment', name: '资料.txt', mimeType: 'text/plain', bytes: bytes.length, kind: 'text', buffer: bytes, ...changes });
const metadata = (id = 'stored', changes = {}) => ({ id, name: '资料.txt', mimeType: 'text/plain', bytes: bytes.length, kind: 'text', projectId: 'project', sha256: digest(bytes), ...changes });

function fixture() {
  const handlers = new Map(), saved = [], storedBytes = new Map();
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/native-selected/资料.txt'] })) };
  const chatService = { importAttachments: vi.fn(async () => [{ id: 'attachment', name: '资料.txt', mimeType: 'text/plain', bytes: bytes.length, kind: 'text' }]), attachmentFiles: vi.fn(async () => [sourceFile()]) };
  const workspaceStorage = { list: vi.fn(async () => ({ projects: [{ projectId: 'project', workspaceId: 'workspace' }] })) };
  const artifactStore = {
    listProject: vi.fn(async () => [...saved]),
    read: vi.fn(async id => { if (!storedBytes.has(id)) throw Error('旧副本不可读'); return { buffer: storedBytes.get(id) }; }),
    write: vi.fn(async value => { const file = metadata(`stored-${saved.length + 1}`, { name: safeName(value.name, value.mimeType), mimeType: value.mimeType, bytes: value.buffer.length, projectId: value.projectId, sha256: digest(value.buffer) }); saved.push(file); storedBytes.set(file.id, Buffer.from(value.buffer)); return file; }),
  };
  const getWindow = vi.fn(() => ({ id: 'window' })), assertProject = vi.fn(async () => undefined);
  const withProjectWrite = vi.fn(async (_projectId, action) => action());
  registerChatAttachmentHandlers({ handle: (name, action) => handlers.set(name, action), dialog, getWindow, chatService, workspaceStorage, artifactStore, withProjectWrite, assertProject });
  return { handlers, call: async (name, input) => handlers.get(name)(input), dialog, chatService, workspaceStorage, artifactStore, assertProject, withProjectWrite, getWindow, saved, storedBytes };
}
const importing = 'chat-importAttachments', copying = 'chat-transferAttachments';

describe('聊天附件原生边界与制作项目复制', () => {
  it.each([
    { ...scope, filePaths: ['/renderer/secret.txt'] },
    { ...scope, path: '/renderer/secret.txt' },
    { ...scope, workspaceId: '../workspace' },
    { ...scope, conversationId: 'conversation/path' },
    null,
  ])('不信任渲染端提供的本机路径或无效聊天范围：%j', async input => {
    const f = fixture();
    await expect(f.call(importing, input)).rejects.toThrow(/工作区或对话无效/);
    expect(f.dialog.showOpenDialog).not.toHaveBeenCalled(); expect(f.chatService.importAttachments).not.toHaveBeenCalled();
  });

  it.each([{ canceled: true, filePaths: ['/native-selected/unused.txt'] }, { canceled: false, filePaths: [] }, { canceled: false }])('取消选取或未选中文件不会写入附件：%j', async result => {
    const f = fixture(); f.dialog.showOpenDialog.mockResolvedValue(result);
    await expect(f.call(importing, scope)).resolves.toEqual([]);
    expect(f.chatService.importAttachments).not.toHaveBeenCalled(); expect(f.artifactStore.write).not.toHaveBeenCalled();
  });

  it('只将原生文件选择结果交给附件服务，五份附件仍可整批导入', async () => {
    const f = fixture(), paths = Array.from({ length: 5 }, (_, i) => `/native-selected/附件 ${i + 1}.txt`);
    f.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: paths });
    const result = await f.call(importing, scope);
    expect(f.dialog.showOpenDialog).toHaveBeenCalledWith({ id: 'window' }, expect.objectContaining({ properties: ['openFile', 'multiSelections'], filters: [expect.objectContaining({ extensions: expect.arrayContaining(['txt', 'pdf', 'png', 'docx']) })] }));
    expect(f.chatService.importAttachments).toHaveBeenCalledWith(scope, paths); expect(result[0].name).toBe('资料.txt');
  });

  it('原生选择超过五份时不会导入半批附件', async () => {
    const f = fixture(); f.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: Array.from({ length: 6 }, (_, i) => `/selected/${i}.txt`) });
    await expect(f.call(importing, scope)).rejects.toThrow(/最多添加 5/); expect(f.chatService.importAttachments).not.toHaveBeenCalled();
  });

  it.each([
    { ...transfer, path: '/renderer/secret.txt' },
    { ...transfer, projectId: '../project' },
    { ...transfer, conversationId: 'bad/path' },
    { ...transfer, attachmentIds: ['draft'] },
    { ...scope, projectId: 'project' },
    { ...scope, projectId: 'project', attachmentIds: [] },
    { ...scope, projectId: 'project', attachmentIds: ['same', 'same'] },
    { ...scope, projectId: 'project', attachmentIds: ['../file'] },
    { ...scope, projectId: 'project', attachmentIds: ['1', '2', '3', '4', '5', '6'] },
  ])('无效范围和互斥的草稿/历史参数不会读取或写入附件：%j', async input => {
    const f = fixture(); await expect(f.call(copying, input)).rejects.toThrow();
    expect(f.withProjectWrite).not.toHaveBeenCalled(); expect(f.workspaceStorage.list).not.toHaveBeenCalled(); expect(f.chatService.attachmentFiles).not.toHaveBeenCalled(); expect(f.artifactStore.write).not.toHaveBeenCalled();
  });

  it.each([{ projects: [] }, { projects: [{ projectId: 'project', workspaceId: 'foreign-workspace' }] }])('不存在或跨工作区的项目不读取原附件内容：%j', async locations => {
    const f = fixture(); f.workspaceStorage.list.mockResolvedValue(locations);
    await expect(f.call(copying, transfer)).rejects.toThrow(/当前工作区/);
    expect(f.assertProject).not.toHaveBeenCalled(); expect(f.chatService.attachmentFiles).not.toHaveBeenCalled(); expect(f.artifactStore.listProject).not.toHaveBeenCalled(); expect(f.artifactStore.write).not.toHaveBeenCalled();
  });

  it('项目检查失败时，原聊天附件不被读取或复制', async () => {
    const f = fixture(); f.assertProject.mockRejectedValue(Error('项目已永久删除'));
    await expect(f.call(copying, transfer)).rejects.toThrow('项目已永久删除');
    expect(f.chatService.attachmentFiles).not.toHaveBeenCalled(); expect(f.artifactStore.write).not.toHaveBeenCalled();
  });

  it('同一工作区的历史附件按原始字节复制到指定项目，保留原文件名', async () => {
    const f = fixture(); const result = await f.call(copying, transfer);
    expect(f.assertProject).toHaveBeenCalledWith('project'); expect(f.chatService.attachmentFiles).toHaveBeenCalledWith(scope, 'turn', undefined);
    expect(f.artifactStore.write).toHaveBeenCalledWith({ name: '资料.txt', mimeType: 'text/plain', buffer: bytes, projectId: 'project', preserveOriginalName: true });
    expect(result).toEqual([metadata('stored-1')]); expect(f.storedBytes.get('stored-1').equals(bytes)).toBe(true);
  });

  it('尚未发送的草稿附件使用对话内编号复制，无需伪造历史轮次', async () => {
    const f = fixture(), input = { ...scope, attachmentIds: ['draft-1', 'draft-2'], projectId: 'project' };
    await f.call(copying, input); expect(f.chatService.attachmentFiles).toHaveBeenCalledWith(scope, undefined, ['draft-1', 'draft-2']); expect(f.artifactStore.write).toHaveBeenCalledOnce();
  });

  it('重复复制复用已验证的同名同哈希项目附件，不重复写入', async () => {
    const f = fixture(), first = await f.call(copying, transfer), second = await f.call(copying, transfer);
    expect(second).toEqual(first); expect(f.artifactStore.write).toHaveBeenCalledOnce(); expect(f.artifactStore.read).toHaveBeenCalledWith(first[0].id);
  });

  it.each(['参考照片.PNG', `${'超长参考资料'.repeat(18)}.PNG`])('文件名规范化后重复转存复用同一份图片：%s', async name => {
    const f = fixture(), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
    f.chatService.attachmentFiles.mockResolvedValue([sourceFile({ name, mimeType: 'image/png', kind: 'image', buffer: png, bytes: png.length })]);
    const first = await f.call(copying, transfer), second = await f.call(copying, transfer);
    expect(first[0].name).toBe(`${name.slice(0, -4).slice(0, 80)}.png`); expect(first[0].name).not.toBe(name);
    expect(second).toEqual(first); expect(f.artifactStore.write).toHaveBeenCalledOnce(); expect(f.artifactStore.read).toHaveBeenCalledWith(first[0].id);
    expect(f.storedBytes.get(first[0].id).equals(png)).toBe(true);
  });

  it('账面哈希一致但旧副本已损坏时保留旧文件，重新导入完整内容', async () => {
    const f = fixture(), old = metadata('old-copy'); f.saved.push(old); f.storedBytes.set(old.id, Buffer.from('旧文件已损坏'));
    const result = await f.call(copying, transfer); expect(result[0].id).not.toBe(old.id); expect(f.artifactStore.write).toHaveBeenCalledOnce();
    expect(f.saved[0]).toBe(old); expect(f.storedBytes.get(old.id).toString()).toBe('旧文件已损坏'); expect(f.storedBytes.get(result[0].id).equals(bytes)).toBe(true);
  });

  it('旧副本不可读、已回收或不可用时不把它当作可用的制作资料', async () => {
    const f = fixture(); f.saved.push(metadata('unreadable'), metadata('trashed', { trashedAt: '2026-11-09T00:00:00Z' }), metadata('unavailable', { unavailable: true }));
    await f.call(copying, transfer); expect(f.artifactStore.read).toHaveBeenCalledOnce(); expect(f.artifactStore.read).toHaveBeenCalledWith('unreadable'); expect(f.artifactStore.write).toHaveBeenCalledOnce(); expect(f.saved).toHaveLength(4);
  });

  it('内容相同而文件名不同的资料各自保留，不丢失用户的文件命名', async () => {
    const f = fixture(); f.chatService.attachmentFiles.mockResolvedValue([sourceFile(), sourceFile({ id: 'second', name: '另一份资料.txt' })]);
    const result = await f.call(copying, transfer); expect(result.map(file => file.name)).toEqual(['资料.txt', '另一份资料.txt']); expect(f.artifactStore.write).toHaveBeenCalledTimes(2);
  });

  it('同批相同文件内容只返回一个可用副本', async () => {
    const f = fixture(); f.chatService.attachmentFiles.mockResolvedValue([sourceFile(), sourceFile({ id: 'second' })]);
    const result = await f.call(copying, transfer); expect(result).toHaveLength(1); expect(f.artifactStore.write).toHaveBeenCalledOnce();
  });

  it.each([
    [transfer, { projectId: 'project', turnId: 'turn', conversationId: 'conversation', workspaceId: 'workspace' }],
    [{ ...scope, projectId: 'project', attachmentIds: ['draft-A', 'draft-B'] }, { attachmentIds: ['draft-B', 'draft-A'], projectId: 'project', conversationId: 'conversation', workspaceId: 'workspace' }],
  ])('同一份资料并发转存时，字段顺序或勾选顺序变化不会生成重复副本：%j', async (firstInput, secondInput) => {
    const f = fixture(); let release;
    f.chatService.attachmentFiles.mockImplementation(async () => { await new Promise(resolve => { release = resolve; }); return [sourceFile()]; });
    const first = f.call(copying, firstInput), second = f.call(copying, secondInput);
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); release();
    expect(await second).toEqual(await first); expect(f.chatService.attachmentFiles).toHaveBeenCalledOnce(); expect(f.artifactStore.write).toHaveBeenCalledOnce();
  });

  it('同一转存请求同时到达时共享同一次写入，失败之后仍允许显式重试', async () => {
    const f = fixture(); let release;
    f.chatService.attachmentFiles.mockImplementationOnce(async () => { await new Promise(resolve => { release = resolve; }); return [sourceFile()]; });
    const first = f.call(copying, transfer), second = f.call(copying, { ...transfer });
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); release();
    expect(await second).toEqual(await first); expect(f.chatService.attachmentFiles).toHaveBeenCalledOnce(); expect(f.artifactStore.write).toHaveBeenCalledOnce();
    const broken = fixture(); broken.artifactStore.write.mockRejectedValueOnce(Error('磁盘暂不可写'));
    await expect(broken.call(copying, transfer)).rejects.toThrow('磁盘暂不可写');
    await expect(broken.call(copying, transfer)).resolves.toHaveLength(1); expect(broken.artifactStore.write).toHaveBeenCalledTimes(2);
  });
});
