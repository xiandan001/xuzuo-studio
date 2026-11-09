import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createArtifactStore, safeName } = require('../../electron/artifact-store.cjs');
const { createChatProjectAttachments } = require('../../electron/chat-project-attachments.cjs');
const owned = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = (name = '需求.txt', text = '品牌：山野咖啡') => { const buffer = Buffer.from(text); return { id: 'chat-source', name, mimeType: 'text/plain', buffer, bytes: buffer.length, sha256: hash(buffer) }; };
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-project-')); owned.push(directory); const store = createArtifactStore({ directory: path.join(directory, 'artifacts') }); return { directory, store, transfer: createChatProjectAttachments(store) }; }
afterEach(async () => { for (const directory of owned.splice(0)) { expect(path.dirname(await fs.realpath(directory))).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-chat-project-/); await fs.rm(directory, { recursive: true }); } });

describe('聊天附件向项目的实际文件复用', () => {
  it('同内容、原名与项目重复带入只存一份，丢失映射后新helper仍复用已有受管文件', async () => {
    const f = await fixture(), file = source();
    const [[first], [second]] = await Promise.all([f.transfer.attachFiles([file], 'project'), f.transfer.attachFiles([file], 'project')]);
    expect(first.id).toBe(second.id); expect(first.name).toBe(file.name); expect(first.sha256).toBe(file.sha256); expect(await f.store.listProject('project')).toHaveLength(1);
    const [afterCrash] = await createChatProjectAttachments(f.store).attachFiles([file], 'project'); expect(afterCrash.id).toBe(first.id);
    expect(await f.transfer.verifyProjectAttachment('project', first, file)).toBe(true); expect(await fs.readFile(first.path)).toEqual(file.buffer); await f.store.drain();
  });
  it('超长中文原名使用同一规范名，不因timestamp或截断反复新增文件', async () => {
    const f = await fixture(), file = source('超长中文名称'.repeat(25) + '.txt'); const [first] = await f.transfer.attachFiles([file], 'project'); const [second] = await f.transfer.attachFiles([file], 'project');
    expect(first.name).toBe(safeName(file.name, file.mimeType)); expect(first.name.length).toBe(84); expect(first.id).toBe(second.id); expect(await f.transfer.verifyProjectAttachment('project', first, file)).toBe(true); expect(await f.store.listProject('project')).toHaveLength(1); await f.store.drain();
  });
  it('missing、trashed、内容更改、跨项目不当成可用副本；重建保持旧文件和其他项目独立', async () => {
    const f = await fixture(), file = source(), [first] = await f.transfer.attachFiles([file], 'project');
    expect(await f.transfer.verifyProjectAttachment('other-project', first, file)).toBe(false);
    await f.store.trash(first.id); expect(await f.transfer.verifyProjectAttachment('project', first, file)).toBe(false);
    const [rebuilt] = await f.transfer.attachFiles([file], 'project'); expect(rebuilt.id).not.toBe(first.id);
    await fs.writeFile(rebuilt.path, Buffer.alloc(file.bytes, 65)); expect(await f.transfer.verifyProjectAttachment('project', rebuilt, file)).toBe(false);
    const [repaired] = await f.transfer.attachFiles([file], 'project'); expect(repaired.id).not.toBe(rebuilt.id); expect(await fs.readFile(rebuilt.path)).toEqual(Buffer.alloc(file.bytes, 65));
    await fs.unlink(repaired.path); expect(await f.transfer.verifyProjectAttachment('project', repaired, file)).toBe(false); const [restored] = await f.transfer.attachFiles([file], 'project'); expect(restored.id).not.toBe(repaired.id); expect(await fs.readFile(restored.path)).toEqual(file.buffer); await f.store.drain();
  });
  it('权限/索引读取异常向上传递，不静默认作存在，也不盲目重复复制', async () => {
    const f = await fixture(), file = source(), [existing] = await f.transfer.attachFiles([file], 'project');
    const write = vi.fn(), denied = Object.assign(Error('permission unavailable'), { code: 'EACCES' });
    const guarded = createChatProjectAttachments({ listProject: (...args) => f.store.listProject(...args), read: async () => { throw denied; }, write });
    await expect(guarded.verifyProjectAttachment('project', existing, file)).rejects.toBe(denied); await expect(guarded.attachFiles([file], 'project')).rejects.toBe(denied); expect(write).not.toHaveBeenCalled();
    const corrupt = createChatProjectAttachments({ listProject: async () => { throw Error('bad manifest'); }, read: f.store.read, write });
    await expect(corrupt.attachFiles([file], 'project')).rejects.toThrow('bad manifest'); expect(write).not.toHaveBeenCalled(); await f.store.drain();
  });
  it('只读取最多8个同名候选，且旧文件内容不同不能错误复用', async () => {
    const file = source(), candidates = Array.from({ length: 10 }, (_, index) => ({ id: `candidate-${index}`, name: file.name, mimeType: file.mimeType, bytes: file.bytes, projectId: 'project' }));
    const read = vi.fn(async id => ({ ...candidates.find(item => item.id === id), buffer: Buffer.alloc(file.bytes, 66) }));
    const write = vi.fn(async value => ({ id: 'new', name: value.name, mimeType: value.mimeType, bytes: value.buffer.length, projectId: value.projectId }));
    const transfer = createChatProjectAttachments({ listProject: async () => candidates, read, write }); const [result] = await transfer.attachFiles([file], 'project');
    expect(read).toHaveBeenCalledTimes(8); expect(write).toHaveBeenCalledWith(expect.objectContaining({ preserveOriginalName: true, projectId: 'project' })); expect(result.id).toBe('new');
  });
});
