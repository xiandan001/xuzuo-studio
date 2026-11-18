import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const load = createRequire(import.meta.url), { createContentSearch, documentText } = load('../../electron/content-search.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), profiles = [], services = [];
const workspaceId = 'workspace';
async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-content-search-')); profiles.push(directory);
  const files = new Map(), expected = new Map(), reads = [], extracts = [], listings = [];
  const projects = [{ id: 'project', workspaceId, name: '登记项目' }];
  async function add(id, text, extras = {}) {
    const buffer = typeof text === 'string' ? Buffer.from(text) : text, filename = path.join(directory, id + '.txt'); await fs.writeFile(filename, buffer);
    const artifact = { id, projectId: 'project', kind: 'text', name: id + '.txt', path: filename, bytes: buffer.length, mimeType: 'text/plain', createdAt: new Date().toISOString(), ...extras }; files.set(id, artifact); expected.set(id, hash(buffer)); return artifact;
  }
  const deps = {
    directory, listProjects: async () => projects,
    listArtifacts: async input => { listings.push(input); return [...files.values()].filter(file => file.projectId === input.projectId); },
    readArtifact: async id => { reads.push(id); const artifact = files.get(id), buffer = await fs.readFile(artifact.path); if (hash(buffer) !== expected.get(id)) throw Error('Managed original changed'); return { ...artifact, buffer }; },
    extractText: async (file, control) => { extracts.push({ id: file.id, signal: control.signal }); return file.buffer.toString('utf8'); }, ...options,
  };
  const service = createContentSearch(deps); services.push(service);
  return { directory, files, projects, add, service, deps, reads, extracts, listings, query: (query, extra = {}) => service.search({ workspaceId, requestId: 'request-' + Math.random().toString(36).slice(2), query, ...extra }) };
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.shutdown();
  for (const directory of profiles.splice(0)) { const real = await fs.realpath(directory); expect(path.dirname(real)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(real)).toMatch(/^xuzuo-content-search-/); await fs.rm(real, { recursive: true, force: true }); }
});
describe('按需受管文档正文索引与真实文件身份', () => {
  it('查询实际文件正文而非名称，重复查找只复用同一文件身份的索引', async () => {
    const f = await fixture(), artifact = await f.add('unrelated-name', '完整用户资料，包含采购清单和预算说明。');
    const first = await f.query('采购清单'); expect(first.items).toHaveLength(1); expect(first.items[0]).toMatchObject({ id: artifact.id, projectId: 'project', artifact, sourceSha256: hash(await fs.readFile(artifact.path)) }); expect(first.items[0].snippet).toContain('采购清单');
    expect(first).toMatchObject({ scanned: 1, indexed: 1, cached: 0, skipped: 0 }); const next = await f.query('预算说明'); expect(next.items).toHaveLength(1); expect(next).toMatchObject({ indexed: 0, cached: 1 }); expect(f.reads).toEqual([artifact.id]); expect(f.extracts).toHaveLength(1);
    expect(f.extracts[0].signal).toBeInstanceOf(AbortSignal);
  });
  it('结构化Word/PPT/Excel提取实际正文、表格和公式，不把ID与排版颜色当正文', () => {
    const word = { kind: 'word', title: '正式报价', blocks: [{ id: 'HIDDEN_BLOCK_ID', text: '客户甲', style: { color: 'HIDDEN_COLOR' } }, { type: 'table', table: { rows: [{ cells: [{ id: 'HIDDEN_CELL_ID', text: '实际用量' }] }] } }] };
    const result = documentText({ documentSource: true, text: JSON.stringify(word) }); expect(result).toContain('正式报价'); expect(result).toContain('客户甲'); expect(result).toContain('实际用量'); expect(result).not.toMatch(/HIDDEN/);
    expect(documentText({ documentSource: true, text: JSON.stringify({ kind: 'ppt', slides: [{ id: 'hidden', title: '第二页标题', body: '实际页面正文', notes: '讲稿说明' }] }) })).toContain('实际页面正文');
    const sheet = documentText({ documentSource: true, text: JSON.stringify({ kind: 'excel', sheets: [{ id: 'hidden', name: '预算', cells: { A1: { value: '真实材料', style: { color: 'HIDDEN_COLOR' } }, B2: { value: 29.9 }, C2: { formula: '=B2*3' } } }] }) }); expect(sheet).toContain('真实材料'); expect(sheet).toContain('29.9'); expect(sheet).toContain('=B2*3'); expect(sheet).not.toContain('HIDDEN_COLOR');
  });
  it('缓存绑定真实字节及来源修订，重开复用，缓存损坏则从原稿重建', async () => {
    const f = await fixture({ documentSourceForArtifact: async () => ({ documentSource: true, sourceRevision: 7, text: JSON.stringify({ kind: 'word', title: '来源修订', blocks: [{ text: '受管正文 CAPTURE-7' }] }) }) });
    await f.add('revision-file', '受管原始文件内容'); expect((await f.query('capture-7')).items[0].sourceRevision).toBe(7); await f.service.shutdown();
    const second = createContentSearch(f.deps); services.push(second); const reused = await second.search({ workspaceId, requestId: 'reopen', query: 'capture-7' }); expect(reused.cached).toBe(1); expect(f.reads).toHaveLength(1);
    await second.shutdown(); const filename = path.join(f.directory, 'content-search-v1', workspaceId + '.json'), cache = JSON.parse(await fs.readFile(filename, 'utf8')); cache.entries[0].text = '伪造缓存文字'; await fs.writeFile(filename, JSON.stringify(cache));
    const third = createContentSearch(f.deps); services.push(third); const rebuilt = await third.search({ workspaceId, requestId: 'rebuild', query: 'capture-7' }); expect(rebuilt.items).toHaveLength(1); expect(rebuilt.indexed).toBe(1); expect(f.reads).toHaveLength(2);
  });
  it('原文件被外部修改或丢失后不返回旧缓存，其他工作区及错归属结果不可见', async () => {
    const f = await fixture(), file = await f.add('original', '原始匹配短语');
    await f.query('原始匹配'); await fs.writeFile(file.path, '外部修改内容');
    const changed = await f.query('原始匹配'); expect(changed.items).toEqual([]); expect(changed.skipped).toBe(1);
    await fs.unlink(file.path); expect((await f.query('原始匹配')).items).toEqual([]);
    f.projects.push({ id: 'foreign-project', workspaceId: 'other', name: '不可检索工作区' }); await f.add('foreign', '秘密外部内容', { projectId: 'foreign-project' });
    expect((await f.query('秘密外部')).items).toEqual([]); expect(f.listings.some(item => item.projectId === 'foreign-project')).toBe(false);
    const spoof = await fixture({ readArtifact: async id => ({ id, projectId: 'foreign-project', mimeType: 'text/plain', buffer: Buffer.from('错误项目内容') }) }); await spoof.add('spoof', '错误项目内容'); expect((await spoof.query('错误项目')).items).toEqual([]);
  });
  it('每批12份文件并提供稳定继续位置，空项目枚举同样有界', async () => {
    const f = await fixture(); for (let n = 0; n < 13; n++) await f.add('file-' + String(n).padStart(2, '0'), n === 12 ? '最后一份含唯一查找目标' : '普通已登记文件');
    const first = await f.query('唯一查找目标'); expect(first).toMatchObject({ scanned: 12, indexed: 12 }); expect(first.items).toEqual([]); expect(first.nextCursor).toEqual(expect.any(String));
    const next = await f.query('唯一查找目标', { cursor: first.nextCursor }); expect(next.scanned).toBe(1); expect(next.items[0].id).toBe('file-12');
    const empty = await fixture(); empty.projects.splice(0, 1, ...Array.from({ length: 25 }, (_, n) => ({ id: 'empty-' + String(n).padStart(2, '0'), workspaceId })));
    const page = await empty.query('没有结果'); expect(empty.listings).toHaveLength(12); expect(page.nextCursor).toEqual(expect.any(String)); expect(page.scanned).toBe(0);
    await expect(async () => empty.query('没有结果', { cursor: '../../not-owned' })).rejects.toThrow(/位置/);
  }, 10000);
  it('改词和关闭可取消正在抽取及尚未开始的请求，不让旧扫描继续读取文件', async () => {
    let started = false, attempts = 0;
    const f = await fixture({ extractText: async (file, { signal }) => { if (++attempts > 1) return file.buffer.toString('utf8'); started = true; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })), { once: true })); } }); await f.add('cancel-file', '实际本地资料');
    const first = f.service.search({ workspaceId, requestId: 'first-search', query: '本地' }); while (!started) await new Promise(resolve => setTimeout(resolve, 2));
    const queued = f.service.search({ workspaceId, requestId: 'queued-search', query: '资料' });
    expect(f.service.cancel({ workspaceId: 'other', requestId: 'first-search' })).toEqual({ cancelled: false }); f.service.cancel({ workspaceId, requestId: 'queued-search' }); f.service.cancel({ workspaceId, requestId: 'first-search' });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' }); await expect(queued).rejects.toMatchObject({ name: 'AbortError' }); expect(f.reads).toHaveLength(1);
    expect((await f.query('本地')).items).toHaveLength(1); expect(f.reads).toHaveLength(2);
  });
  it('空查询不建索引，超大或长文档明确报告未完整覆盖而不造成全盘扫描', async () => {
    const f = await fixture(); expect(await f.query('')).toMatchObject({ items: [], scanned: 0, indexed: 0 }); expect(f.listings).toEqual([]); expect(await fs.readdir(f.directory)).toEqual([]);
    await f.add('large', Buffer.alloc(17 * 1024 * 1024, 65)); await f.add('long', '可见开头' + '正文'.repeat(110000) + '末尾超出缓存的关键字');
    const page = await f.query('可见开头'); expect(page.items).toHaveLength(1); expect(page.skipped).toBe(2); expect(f.reads).toEqual(['long']);
    expect((await f.query('末尾超出缓存的关键字')).items).toEqual([]);
  }, 10000);
});


it('关闭取消正在提取的旧查询，取消退出后仅接受明确的新查询，不恢复旧请求', async () => {
  let began = false, attempts = 0;
  const f = await fixture({ extractText: async (file, { signal }) => { if (++attempts > 1) return file.buffer.toString('utf8'); began = true; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('closed'), { name: 'AbortError' })), { once: true })); } });
  await f.add('lifecycle', '关闭后可重新查询的正文'); const old = f.query('正文'); while (!began) await new Promise(resolve => setTimeout(resolve, 2));
  const stopped = f.service.shutdown(); await expect(old).rejects.toMatchObject({ name: 'AbortError' }); await expect(stopped).resolves.toBeUndefined();
  await expect(f.query('正文')).rejects.toThrow(/退出/); expect(attempts).toBe(1);
  f.service.resume(); expect((await f.query('正文')).items).toHaveLength(1); expect(attempts).toBe(2); expect(f.reads).toHaveLength(2);
});
it('派生索引缓存不能写盘时仍返回原文真实命中，关闭不被该缓存失败阻塞', async () => {
  let ready, fail; const entered = new Promise(resolve => { ready = resolve; });
  const f = await fixture({ fileSystem: { ...fs, rename: async (from, to) => { if (to.endsWith(path.join('content-search-v1', workspaceId + '.json'))) { ready(); await new Promise((_resolve, reject) => { fail = () => reject(Object.assign(Error('derived cache unavailable'), { code: 'EIO' })); }); } else await fs.rename(from, to); } } });
  const source = await f.add('cache-failure', '原文内容保持不变，仍可找到实际客户说明'); const searching = f.query('客户说明'); await entered;
  const closing = f.service.shutdown(); fail(); await expect(closing).resolves.toBeUndefined(); const page = await searching;
  expect(page.items[0].id).toBe(source.id); expect(page.cacheUnavailable).toBe(true); expect(await fs.readFile(source.path, 'utf8')).toContain('原文内容保持不变');
});
