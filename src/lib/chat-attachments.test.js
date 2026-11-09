import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createChatAttachments, attachmentFiles, validateAttachmentPayloads } = require('../../electron/chat-attachments.cjs');
const owned = [];
const scope = { workspaceId: 'workspace', conversationId: 'conversation' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-attachment-')); owned.push(directory);
  const source = path.join(directory, 'selected'); await fs.mkdir(source);
  const store = createChatAttachments({ directory });
  const file = async (name, bytes) => { const filename = path.join(source, name); await fs.writeFile(filename, bytes); return filename; };
  return { directory, source, store, file };
}
afterEach(async () => { for (const directory of owned.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
describe('聊天附件的受控导入与完整内容', () => {
  it('无项目导入中文文字和图片，公开元数据没有本机路径或文件内容', async () => {
    const f = await fixture(), text = await f.file('资料.txt', '品牌：蓝色小熊'), image = await f.file('参考.png', png);
    const metadata = await f.store.importAttachments(scope, [text, image]);
    expect(metadata).toMatchObject([{ name: '资料.txt', kind: 'text', mimeType: 'text/plain' }, { name: '参考.png', kind: 'image', mimeType: 'image/png' }]);
    expect(JSON.stringify(metadata)).not.toContain(f.directory); expect(JSON.stringify(metadata)).not.toContain('蓝色小熊');
    const payloads = await f.store.resolve(scope, metadata.map(file => file.id));
    expect(payloads[0].text).toBe('品牌：蓝色小熊'); expect(attachmentFiles(payloads)[1].buffer.equals(png)).toBe(true);
    const reopened = createChatAttachments({ directory: f.directory }); expect(await reopened.resolve(scope, [metadata[0].id])).toMatchObject([{ text: '品牌：蓝色小熊' }]);
  });
  it('Office在本地提取正文并保留原始文件，PDF保留二进制而不假装提取了文字', async () => {
    const f = await fixture(), JSZip = require('jszip'), zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>产品介绍正文</w:t></w:r></w:p></w:body></w:document>');
    const office = await zip.generateAsync({ type: 'nodebuffer' }), pdf = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF');
    const metadata = await f.store.importAttachments(scope, [await f.file('介绍.docx', office), await f.file('扫描.pdf', pdf)]), payloads = await f.store.resolve(scope, metadata.map(file => file.id));
    expect(payloads[0]).toMatchObject({ kind: 'text', text: expect.stringContaining('产品介绍正文') });
    expect(payloads[1]).toMatchObject({ kind: 'document', mimeType: 'application/pdf' }); expect(payloads[1]).not.toHaveProperty('text');
    expect(attachmentFiles(payloads).map(file => file.buffer)).toEqual([office, pdf]);
  });
  it('附件编号不能跨对话或跨工作区读取，也不能作为路径使用', async () => {
    const f = await fixture(), [file] = await f.store.importAttachments(scope, [await f.file('资料.txt', '正文')]);
    await expect(f.store.resolve({ ...scope, conversationId: 'other' }, [file.id])).rejects.toThrow(/不属于当前对话/);
    await expect(f.store.resolve({ ...scope, workspaceId: 'other' }, [file.id])).rejects.toThrow(/不属于当前对话/);
    await expect(f.store.resolve(scope, ['../secret'])).rejects.toThrow(/选择无效/);
    await expect(f.store.importAttachments({ ...scope, workspaceId: '../secret' }, [])).rejects.toThrow(/编号无效/);
  });
  it('拒绝选中文件和父目录中的符号链接', async () => {
    const f = await fixture(), source = await f.file('资料.txt', '正文');
    const link = path.join(f.source, 'link.txt'); await fs.symlink(source, link);
    await expect(f.store.importAttachments(scope, [link])).rejects.toThrow(/符号链接/);
    const folder = path.join(f.directory, 'linked'); await fs.symlink(f.source, folder);
    await expect(f.store.importAttachments(scope, [path.join(folder, '资料.txt')])).rejects.toThrow(/符号链接/);
  });
  it('全批验证成功才提交，不支持、损坏或过大附件不会留下半批选择', async () => {
    const f = await fixture(), good = await f.file('good.txt', '正文'), bad = await f.file('坏.png', 'not png');
    await expect(f.store.importAttachments(scope, [good, bad])).rejects.toThrow();
    await expect(fs.stat(path.join(f.directory, 'chat-attachments-v1'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(f.store.importAttachments(scope, [await f.file('脚本.exe', 'script')])).rejects.toThrow(/格式暂不支持/);
    await expect(f.store.importAttachments(scope, [await f.file('large.pdf', Buffer.alloc(5 * 1024 * 1024 + 1))])).rejects.toThrow(/5MB/);
    await expect(f.store.importAttachments(scope, [await f.file('坏.docx', 'not zip')])).rejects.toThrow(/Office/);
    await expect(f.store.importAttachments(scope, [await f.file('坏.txt', Buffer.from([255, 255]))])).rejects.toThrow(/UTF-8/);
  });
  it('限制每条数量与总量，不静默截断附件', async () => {
    const f = await fixture(); await expect(f.store.importAttachments(scope, Array(6).fill('/tmp/a'))).rejects.toThrow(/5/);
    const pdf = Buffer.alloc(4 * 1024 * 1024, 32); pdf.write('%PDF-1.4'); pdf.write('%%EOF', pdf.length - 5);
    await expect(f.store.importAttachments(scope, await Promise.all([1, 2, 3].map(n => f.file(`${n}.pdf`, pdf))))).rejects.toThrow(/10MB/);
    await expect(f.store.importAttachments(scope, [await f.file('a.txt', '甲'.repeat(60000)), await f.file('b.txt', '乙'.repeat(60000))])).rejects.toThrow(/正文合计超过10万/);
  });
  it('缓存和备份载荷的内容、哈希和元数据需要一致，拒绝额外路径字段', async () => {
    const f = await fixture(), [metadata] = await f.store.importAttachments(scope, [await f.file('资料.txt', '正文')]);
    const files = await f.store.resolve(scope, [metadata.id]);
    expect(() => validateAttachmentPayloads([{ ...files[0], data: Buffer.from('篡改').toString('base64') }])).toThrow(/校验失败/);
    expect(() => validateAttachmentPayloads([{ ...files[0], path: '/private/user-file' }])).toThrow(/无法识别/);
    expect(() => validateAttachmentPayloads([...files, ...files])).toThrow(/不同附件/);
  });
  it('缓存保存失败保留原有附件与内容', async () => {
    const f = await fixture(), [first] = await f.store.importAttachments(scope, [await f.file('原资料.txt', '原文')]);
    const broken = createChatAttachments({ directory: f.directory, fileSystem: { ...fs, rename: async () => { throw Object.assign(Error(`denied ${f.directory}/private-path`), { code: 'EACCES' }); } } });
    const error = await broken.importAttachments(scope, [await f.file('新资料.txt', '新文')]).catch(value => value);
    expect(error.message).toContain('无法读取或保存'); expect(error.message).not.toContain(f.directory); expect(error.message).not.toContain('private-path');
    expect(await f.store.resolve(scope, [first.id])).toMatchObject([{ text: '原文' }]);
  });
});
